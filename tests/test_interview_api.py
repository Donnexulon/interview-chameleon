import json
import unittest

from fastapi.testclient import TestClient

import main as app_main


class FakeInterviewOllamaClient:
    def __init__(self, response):
        self.response = response
        self.calls = []

    async def generate_json_async(
        self,
        model,
        messages,
        system_prompt=None,
        options=None,
        format_schema=None,
        timeout_seconds=120,
    ):
        self.calls.append({
            "model": model,
            "messages": messages,
            "system_prompt": system_prompt,
            "options": options,
            "format_schema": format_schema,
            "timeout_seconds": timeout_seconds,
        })
        return self.response


BASE_PAYLOAD = {
    "model": "ignored-model",
    "messages": [],
    "system_prompt": "You are a friendly interviewer.",
    "target_role": "Senior Product Manager",
    "module": "general",
    "difficulty": "medium",
    "duration": "quick",
    "industry": "software",
    "interviewer_style": "friendly",
    "faang_mode": False,
    "interruptions_enabled": False,
}


class InterviewApiTests(unittest.TestCase):
    def setUp(self):
        self.original_ollama = app_main.ollama_client
        self.client = TestClient(app_main.app)

    def tearDown(self):
        app_main.ollama_client = self.original_ollama

    def test_plan_endpoint_exposes_session_coverage(self):
        response = self.client.post("/api/interview/plan", json=BASE_PAYLOAD)

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["target_questions"], 5)
        self.assertEqual(len(body["entries"]), 5)
        self.assertTrue(body["competency_targets"])

    def test_turn_endpoint_returns_valid_model_question_and_metadata(self):
        fake = FakeInterviewOllamaClient(json.dumps({
            "acknowledgement": "Welcome.",
            "question": "Which product decision best demonstrates your measurable impact?",
        }))
        app_main.ollama_client = fake

        response = self.client.post("/api/interview/turn", json=BASE_PAYLOAD)

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["source"], "model")
        self.assertEqual(body["acknowledgement"], "")
        self.assertEqual(body["text"], body["question"])
        self.assertEqual(body["orchestration"]["turn_number"], 1)
        self.assertEqual(body["orchestration"]["turn_type"], "main")
        self.assertIn("Authoritative Interview Orchestration Directive", fake.calls[0]["system_prompt"])
        self.assertEqual(fake.calls[0]["model"], "qwen2.5:7b")
        self.assertEqual(fake.calls[0]["options"]["temperature"], 0.25)

    def test_invalid_model_output_uses_planned_fallback(self):
        fake = FakeInterviewOllamaClient(json.dumps({
            "acknowledgement": "",
            "question": "What happened? What did you do?",
        }))
        app_main.ollama_client = fake

        response = self.client.post("/api/interview/turn", json=BASE_PAYLOAD)

        body = response.json()
        self.assertEqual(body["source"], "fallback")
        self.assertIn("exactly one", body["warning"])
        self.assertEqual(body["text"].count("?"), 1)

    def test_transport_error_uses_fallback_instead_of_breaking_session(self):
        app_main.ollama_client = FakeInterviewOllamaClient(json.dumps({"error": "connection refused"}))

        response = self.client.post("/api/interview/turn", json=BASE_PAYLOAD)

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["source"], "fallback")
        self.assertIn("Local model unavailable", body["warning"])

    def test_endpoint_closes_without_calling_model_after_target(self):
        fake = FakeInterviewOllamaClient(json.dumps({"acknowledgement": "", "question": "Unused?"}))
        app_main.ollama_client = fake
        messages = []
        for index in range(5):
            messages.extend([
                {
                    "role": "assistant",
                    "content": f"Question {index + 1}?",
                    "orchestration": {
                        "turn_type": "main",
                        "plan_index": index,
                        "competency": "specificity",
                    },
                },
                {"role": "user", "content": "A complete answer with evidence and a measured result."},
            ])

        response = self.client.post("/api/interview/turn", json={**BASE_PAYLOAD, "messages": messages})

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["complete"])
        self.assertEqual(body["orchestration"]["turn_type"], "closing")
        self.assertEqual(fake.calls, [])


if __name__ == "__main__":
    unittest.main()
