import json
import unittest

from fastapi.testclient import TestClient

import main as app_main


class FakeSetupOllamaClient:
    def __init__(self, connected=True, models=None):
        self.connected = connected
        self.models = models or []
        self.pulled_models = []

    def check_connection(self):
        return self.connected

    def list_models(self):
        return list(self.models)

    def is_model_available(self, model_name):
        return any(
            model == model_name
            or model == f"{model_name}:latest"
            or model.startswith(f"{model_name}:")
            for model in self.models
        )

    def get_best_model(self, role="interviewer"):
        return "qwen2.5:7b"

    def pull_model_stream(self, model_name):
        self.pulled_models.append(model_name)
        yield {"status": f"pulling {model_name}", "percent": 50}


class SetupApiTests(unittest.TestCase):
    def setUp(self):
        self.original_ollama = app_main.ollama_client
        self.client = TestClient(app_main.app)

    def tearDown(self):
        app_main.ollama_client = self.original_ollama

    def test_setup_status_when_ollama_disconnected(self):
        app_main.ollama_client = FakeSetupOllamaClient(connected=False)

        response = self.client.get("/api/setup/status")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertFalse(data["ollama_connected"])
        self.assertFalse(data["ready"])
        self.assertEqual(data["recommended_model"], "qwen2.5:7b")
        self.assertIn("not reachable", data["status_message"])

    def test_setup_status_when_qwen_present(self):
        app_main.ollama_client = FakeSetupOllamaClient(
            connected=True,
            models=["qwen2.5:7b"],
        )

        response = self.client.get("/api/setup/status")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["ollama_connected"])
        self.assertTrue(data["has_recommended"])
        self.assertTrue(data["ready"])
        self.assertIn("Ready", data["status_message"])

    def test_setup_status_when_qwen_missing(self):
        app_main.ollama_client = FakeSetupOllamaClient(
            connected=True,
            models=["mistral:latest"],
        )

        response = self.client.get("/api/setup/status")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["ollama_connected"])
        self.assertFalse(data["has_recommended"])
        self.assertFalse(data["ready"])
        self.assertEqual(data["recommended_model"], "qwen2.5:7b")
        self.assertIn("not installed", data["status_message"])

    def test_pull_endpoint_uses_only_qwen_model(self):
        fake = FakeSetupOllamaClient(connected=True)
        app_main.ollama_client = fake

        response = self.client.post("/api/setup/pull", json={"model": "llama3"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(fake.pulled_models, ["qwen2.5:7b"])
        self.assertIn("qwen2.5:7b", response.text)
        self.assertIn(json.dumps({"status": "complete", "percent": 100}), response.text)


if __name__ == "__main__":
    unittest.main()
