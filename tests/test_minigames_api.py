import json
import unittest

from fastapi.testclient import TestClient

import main as app_main


class FakeMinigameOllamaClient:
    def __init__(self, connected=True, models=None, response=None):
        self.connected = connected
        self.models = models or []
        self.response = response or json.dumps({
            "summary": "Good structure with room for stronger metrics.",
            "strengths": ["Clear ownership"],
            "improvements": ["Add a measurable result"],
            "rewritten_answer": "I owned the action, measured the result, and improved the outcome.",
            "practice_drill": "Rewrite the result with one number.",
        })
        self.calls = []

    def check_connection(self):
        return self.connected

    def is_model_available(self, model_name):
        return any(
            model == model_name
            or model == f"{model_name}:latest"
            or model.startswith(f"{model_name}:")
            for model in self.models
        )

    async def generate_json_async(self, model, messages, system_prompt=None):
        self.calls.append({
            "model": model,
            "messages": messages,
            "system_prompt": system_prompt,
        })
        return self.response


class MinigamesCoachApiTests(unittest.TestCase):
    def setUp(self):
        self.original_ollama = app_main.ollama_client
        self.client = TestClient(app_main.app)

    def tearDown(self):
        app_main.ollama_client = self.original_ollama

    def test_minigame_coach_uses_only_qwen(self):
        fake = FakeMinigameOllamaClient(connected=True, models=["qwen2.5:7b"])
        app_main.ollama_client = fake

        response = self.client.post("/api/minigames/coach", json={
            "game": "star",
            "payload": {
                "question": "Tell me about a conflict.",
                "answers": {"s": "A stakeholder disagreed.", "t": "I owned alignment.", "a": "I set a review.", "r": "We shipped."},
            },
        })

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["available"])
        self.assertEqual(data["model"], "qwen2.5:7b")
        self.assertEqual(fake.calls[0]["model"], "qwen2.5:7b")
        self.assertIn("summary", data["coaching"])

    def test_minigame_coach_returns_unavailable_when_qwen_missing(self):
        fake = FakeMinigameOllamaClient(connected=True, models=["mistral:latest"])
        app_main.ollama_client = fake

        response = self.client.post("/api/minigames/coach", json={
            "game": "star",
            "payload": {},
        })

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertFalse(data["available"])
        self.assertEqual(data["model"], "qwen2.5:7b")
        self.assertEqual(fake.calls, [])

    def test_minigame_coach_rejects_unknown_game(self):
        app_main.ollama_client = FakeMinigameOllamaClient(connected=True, models=["qwen2.5:7b"])

        response = self.client.post("/api/minigames/coach", json={
            "game": "unknown",
            "payload": {},
        })

        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
