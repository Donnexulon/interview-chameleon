import json
import unittest

from fastapi.testclient import TestClient

import main as app_main
from services.evaluation import COMPETENCY_KEYS, EVALUATION_VERSION


def competency_scores(value=75, **overrides):
    scores = {key: value for key in COMPETENCY_KEYS}
    scores.update(overrides)
    return scores


def valid_llm_response():
    return json.dumps({
        "evaluation_version": EVALUATION_VERSION,
        "competency_scores": competency_scores(
            answer_relevance=78,
            specificity=68,
            structure=82,
            evidence_quality=64,
            impact_orientation=70,
            role_alignment=80,
            communication_clarity=82,
            adaptability=76,
        ),
        "module_scores": {},
        "readiness": {
            "level": "developing",
            "hire_signal": "lean_no",
            "summary": "Clear but not yet consistently evidence-backed.",
            "blockers": ["Needs measurable impact."],
            "strongest_signals": ["Direct answer."],
        },
        "weakest_area": "evidence_quality",
        "strongest_area": "communication_clarity",
        "improvement_tip": "Add a measurable result to make the answer stronger.",
        "coaching_summary": "The candidate answered directly and had a clear structure.",
        "actionable_next_steps": ["Add metrics", "Practice concise STAR answers"],
        "risk_flags": [],
        "red_flags": [],
        "practice_plan": ["Rewrite the migration answer with one quantified result."],
        "evaluator_confidence": 84,
        "question_evaluations": [
            {
                "question": "Tell me about a difficult project.",
                "answer_summary": "Described coordinating a migration.",
                "answer_type": "partial",
                "score": 72,
                "competency_scores": competency_scores(72),
                "evidence_quotes": ["I coordinated the migration with QA."],
                "missed_opportunity": "Add impact metrics.",
                "coaching_note": "Clear answer, but missing impact metrics.",
                "practice_drill": "Rewrite with a before/after metric.",
            }
        ],
    })


class FakeOllamaClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    async def generate_json_async(self, model, messages, system_prompt=None):
        self.calls.append({
            "model": model,
            "messages": messages,
            "system_prompt": system_prompt,
        })
        if not self.responses:
            raise AssertionError("No fake Ollama response left")
        return self.responses.pop(0)


class EvaluateApiTests(unittest.TestCase):
    def setUp(self):
        self.original_ollama = app_main.ollama_client
        self.client = TestClient(app_main.app)

    def tearDown(self):
        app_main.ollama_client = self.original_ollama

    def post_evaluate(self):
        return self.client.post("/api/evaluate", json={
            "model": "ignored-client-model",
            "target_role": "Support Manager",
            "module": "general",
            "job_description": "",
            "messages": [
                {"role": "assistant", "content": "Tell me about a difficult project.", "timestamp": 1000},
                {"role": "user", "content": "I coordinated the migration with QA.", "timestamp": 7000},
            ],
            "presence_data": None,
            "engagement_data": None,
            "camera_on": False,
        })

    def test_valid_response_returns_v3_feedback(self):
        fake = FakeOllamaClient([valid_llm_response()])
        app_main.ollama_client = fake

        response = self.post_evaluate()

        self.assertEqual(response.status_code, 200)
        feedback = response.json()["feedback"]
        self.assertEqual(feedback["evaluation_version"], EVALUATION_VERSION)
        self.assertIn("competency_scores", feedback)
        self.assertIn("question_evaluations", feedback)
        self.assertEqual(feedback["question_highlights"][0]["evidence_quote"], "I coordinated the migration with QA.")
        self.assertEqual(feedback["transcript_features"]["answer_count"], 1)
        self.assertEqual(len(fake.calls), 1)
        self.assertEqual(fake.calls[0]["model"], "qwen2.5:7b")

    def test_invalid_first_response_triggers_repair(self):
        fake = FakeOllamaClient(["not json", valid_llm_response()])
        app_main.ollama_client = fake

        response = self.post_evaluate()

        self.assertEqual(response.status_code, 200)
        feedback = response.json()["feedback"]
        self.assertEqual(feedback["evaluation_version"], EVALUATION_VERSION)
        self.assertEqual(len(fake.calls), 2)
        self.assertIn("Repair this invalid evaluation output", fake.calls[1]["messages"][0]["content"])

    def test_invalid_repair_returns_structured_fallback(self):
        fake = FakeOllamaClient(["not json", "[]"])
        app_main.ollama_client = fake

        response = self.post_evaluate()

        self.assertEqual(response.status_code, 200)
        feedback = response.json()["feedback"]
        self.assertTrue(feedback["evaluation_error"])
        self.assertEqual(feedback["evaluation_version"], EVALUATION_VERSION)
        self.assertGreater(feedback["overall_score"], 0)
        self.assertIn("competency_scores", feedback)
        self.assertEqual(len(fake.calls), 2)


if __name__ == "__main__":
    unittest.main()
