import json
import tempfile
import unittest

from fastapi.testclient import TestClient

import main as app_main
from services.evaluation import COMPETENCY_KEYS
from services.evaluation_v6 import EVALUATION_VERSION
from services.session_history import SessionHistory


def dimension_bands(value="strong", **overrides):
    scores = {key: value for key in COMPETENCY_KEYS}
    scores.update(overrides)
    return scores


def valid_llm_response():
    return json.dumps({
        "evaluation_version": EVALUATION_VERSION,
        "improvement_tip": "Add a measurable result to make the answer stronger.",
        "coaching_summary": "The candidate answered directly and had a clear structure.",
        "actionable_next_steps": ["Add metrics", "Practice concise STAR answers"],
        "risk_flags": [],
        "red_flags": [],
        "practice_plan": ["Rewrite the migration answer with one quantified result."],
        "question_assessments": [
            {
                "question": "Tell me about a difficult project.",
                "answer_summary": "Described coordinating a migration.",
                "answer_type": "partial",
                "correctness": "not_applicable",
                "correctness_reason": "The answer does not make a correctness-sensitive claim.",
                "dimension_bands": dimension_bands(
                    "adequate",
                    answer_relevance="strong",
                    communication_clarity="strong",
                ),
                "module_bands": {},
                "evidence_quotes": ["I coordinated the migration with QA."],
                "missing_dimensions": ["impact_orientation"],
                "coaching_note": "Clear answer, but missing impact metrics.",
                "practice_drill": "Rewrite with a before/after metric.",
                "professional_red_flag": False,
                "professional_red_flag_reason": "",
            }
        ],
    })


def valid_recovery_response():
    question = json.loads(valid_llm_response())["question_assessments"][0]
    return json.dumps({"question_1": question})


class FakeOllamaClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    async def generate_json_async(
        self,
        model,
        messages,
        system_prompt=None,
        options=None,
        format_schema=None,
        timeout_seconds=120,
        keep_alive=None,
        cold_start=False,
    ):
        self.calls.append({
            "model": model,
            "messages": messages,
            "system_prompt": system_prompt,
            "options": options,
            "format_schema": format_schema,
            "timeout_seconds": timeout_seconds,
            "keep_alive": keep_alive,
            "cold_start": cold_start,
        })
        if not self.responses:
            raise AssertionError("No fake Ollama response left")
        return self.responses.pop(0)


class EvaluateApiTests(unittest.TestCase):
    def setUp(self):
        self.original_ollama = app_main.ollama_client
        self.original_history = app_main.history_db
        self.tmpdir = tempfile.TemporaryDirectory()
        app_main.history_db = SessionHistory(f"{self.tmpdir.name}/evaluate.db")
        self.client = TestClient(app_main.app)

    def tearDown(self):
        app_main.ollama_client = self.original_ollama
        app_main.history_db = self.original_history
        self.tmpdir.cleanup()

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
            "difficulty": "hard",
            "duration": "quick",
            "industry": "software",
            "interviewer_style": "strict",
            "faang_mode": True,
            "interruptions_enabled": True,
        })

    def test_valid_response_returns_v6_feedback(self):
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
        self.assertEqual(fake.calls[0]["options"]["temperature"], 0)
        self.assertEqual(fake.calls[0]["keep_alive"], 0)
        self.assertTrue(fake.calls[0]["cold_start"])
        self.assertEqual(fake.calls[0]["timeout_seconds"], 120)
        self.assertEqual(fake.calls[0]["format_schema"]["properties"]["question_assessments"]["minItems"], 1)
        self.assertIn('"difficulty": "hard"', fake.calls[0]["system_prompt"])
        self.assertEqual(feedback["evaluation_context"]["industry"], "software")
        self.assertTrue(feedback["evaluator"]["invoked"])
        self.assertEqual(feedback["evaluator"]["model_keep_alive"], 0)
        self.assertTrue(feedback["evaluator"]["model_cold_start"])
        self.assertEqual(feedback["evaluation_provenance"]["model_output"], "categorical_assessments_only")
        self.assertEqual(feedback["question_evaluations"][0]["score"], 72)

    def test_invalid_first_response_triggers_repair(self):
        fake = FakeOllamaClient(["not json", valid_llm_response()])
        app_main.ollama_client = fake

        response = self.post_evaluate()

        self.assertEqual(response.status_code, 200)
        feedback = response.json()["feedback"]
        self.assertEqual(feedback["evaluation_version"], EVALUATION_VERSION)
        self.assertEqual(len(fake.calls), 2)
        self.assertIn("Repair this invalid Evaluator V6 output", fake.calls[1]["messages"][0]["content"])

    def test_invalid_repair_returns_structured_fallback(self):
        fake = FakeOllamaClient(["not json", "[]", "{}"])
        app_main.ollama_client = fake

        response = self.post_evaluate()

        self.assertEqual(response.status_code, 200)
        feedback = response.json()["feedback"]
        self.assertTrue(feedback["evaluation_error"])
        self.assertEqual(feedback["evaluation_version"], EVALUATION_VERSION)
        self.assertIsNone(feedback["overall_score"])
        self.assertEqual(feedback["evaluation_status"], "insufficient_evidence")
        self.assertIn("competency_scores", feedback)
        self.assertEqual(len(fake.calls), 3)
        self.assertTrue(feedback["evaluator"]["focused_recovery_used"])

    def test_invalid_repair_uses_named_question_recovery(self):
        fake = FakeOllamaClient(["not json", "[]", valid_recovery_response()])
        app_main.ollama_client = fake

        response = self.post_evaluate()

        self.assertEqual(response.status_code, 200)
        feedback = response.json()["feedback"]
        self.assertNotIn("evaluation_error", feedback)
        self.assertEqual(len(feedback["question_evaluations"]), 1)
        self.assertEqual(feedback["evaluator"]["attempts"], 3)
        self.assertTrue(feedback["evaluator"]["repair_used"])
        self.assertTrue(feedback["evaluator"]["focused_recovery_used"])
        self.assertEqual(fake.calls[2]["format_schema"]["required"], ["question_1"])

    def test_identical_request_uses_durable_versioned_cache(self):
        fake = FakeOllamaClient([valid_llm_response()])
        app_main.ollama_client = fake

        first = self.post_evaluate()
        second = self.post_evaluate()

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(len(fake.calls), 1)
        self.assertTrue(second.json()["feedback"]["evaluator"]["cache_hit"])

    def test_technical_correctness_gate_runs_one_focused_verifier(self):
        primary = json.loads(valid_llm_response())
        item = primary["question_assessments"][0]
        item["correctness"] = "major_error"
        item["correctness_reason"] = "The central mechanism is incomplete."
        item["module_bands"] = {
            "problem_solving": "adequate",
            "technical_accuracy": "weak",
            "thought_process": "adequate",
        }
        verifier = json.dumps({"verifications": [{
            "question_index": 0,
            "correctness": "correct",
            "evidence_quote": "I coordinated the migration with QA.",
            "verdict_reason": "The claim is technically valid in the narrow question context.",
            "confidence": "high",
            "supports_primary": False,
        }]})
        fake = FakeOllamaClient([json.dumps(primary), verifier])
        app_main.ollama_client = fake

        response = self.client.post("/api/evaluate", json={
            "model": "ignored",
            "target_role": "Engineering Manager",
            "module": "technical",
            "messages": [
                {"role": "assistant", "content": "Tell me about a difficult project."},
                {"role": "user", "content": "I coordinated the migration with QA."},
            ],
            "camera_on": False,
        })

        self.assertEqual(response.status_code, 200)
        feedback = response.json()["feedback"]
        self.assertEqual(len(fake.calls), 2)
        self.assertTrue(feedback["evaluator"]["verifier_invoked"])
        self.assertTrue(feedback["evaluator"]["verifier_valid"])
        self.assertEqual(feedback["question_evaluations"][0]["verifier"]["status"], "overrode")

    def test_transport_error_skips_pointless_repair_and_returns_diagnostics(self):
        fake = FakeOllamaClient([json.dumps({"error": "connection refused"})])
        app_main.ollama_client = fake

        response = self.post_evaluate()

        self.assertEqual(response.status_code, 200)
        feedback = response.json()["feedback"]
        self.assertTrue(feedback["evaluation_error"])
        self.assertIsNone(feedback["overall_score"])
        self.assertEqual(feedback["evaluator"]["attempts"], 1)
        self.assertFalse(feedback["evaluator"]["repair_used"])
        self.assertFalse(feedback["evaluator"]["output_valid"])
        self.assertEqual(len(fake.calls), 1)

    def test_no_answers_skips_model_and_returns_unscored_result(self):
        fake = FakeOllamaClient([])
        app_main.ollama_client = fake

        response = self.client.post("/api/evaluate", json={
            "model": "ignored-client-model",
            "target_role": "Support Manager",
            "module": "general",
            "job_description": "",
            "messages": [
                {"role": "assistant", "content": "Tell me about a difficult project.", "timestamp": 1000},
                {
                    "role": "user",
                    "content": "[TIMEOUT: no answer]",
                    "isHidden": True,
                    "isTimeout": True,
                    "timestamp": 7000,
                },
            ],
            "presence_data": {"composite": 95},
            "engagement_data": {"composite": 95},
            "camera_on": True,
        })

        self.assertEqual(response.status_code, 200)
        feedback = response.json()["feedback"]
        self.assertIsNone(feedback["overall_score"])
        self.assertEqual(feedback["evaluation_status"], "insufficient_evidence")
        self.assertEqual(feedback["question_evaluations"][0]["score"], 0)
        self.assertEqual(len(fake.calls), 0)


if __name__ == "__main__":
    unittest.main()
