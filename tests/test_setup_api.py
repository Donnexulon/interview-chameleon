import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import main as app_main
from services.ollama_client import is_ollama_installed
from services.preferences import PreferencesStore


class FakeSetupOllamaClient:
    def __init__(self, connected=True, models=None):
        self.connected = connected
        self.models = models or []
        self.pulled_models = []
        self.generated_models = []

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

    async def generate_chat(self, model_name, messages, system_prompt=None):
        self.generated_models.append(model_name)
        return {"content": "ready"}


class SetupApiTests(unittest.TestCase):
    def setUp(self):
        self.original_ollama = app_main.ollama_client
        self.original_preferences = app_main.preferences_db
        self.temporary_directory = tempfile.TemporaryDirectory()
        app_main.preferences_db = PreferencesStore(
            Path(self.temporary_directory.name) / "preferences.json"
        )
        self.client = TestClient(app_main.app)

    def tearDown(self):
        app_main.ollama_client = self.original_ollama
        app_main.preferences_db = self.original_preferences
        self.temporary_directory.cleanup()

    @patch("routes.system.is_ollama_installed", return_value=False)
    def test_setup_status_when_ollama_disconnected(self, _installed):
        app_main.ollama_client = FakeSetupOllamaClient(connected=False)

        response = self.client.get("/api/setup/status")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertFalse(data["ollama_connected"])
        self.assertFalse(data["ollama_installed"])
        self.assertFalse(data["ready"])
        self.assertEqual(data["recommended_model"], "qwen2.5:7b")
        self.assertIn("not installed", data["status_message"])

    def test_setup_status_requires_a_confirmed_model_choice(self):
        app_main.ollama_client = FakeSetupOllamaClient(
            connected=True,
            models=["qwen2.5:7b"],
        )

        response = self.client.get("/api/setup/status")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["ollama_connected"])
        self.assertTrue(data["has_selected"])
        self.assertFalse(data["ready"])

        selected = self.client.post("/api/models/select", json={"model": "qwen2.5:7b"})
        self.assertEqual(selected.status_code, 200)
        self.assertTrue(selected.json()["preferences"]["model_setup_completed"])
        self.assertTrue(self.client.get("/api/setup/status").json()["ready"])

    def test_setup_status_when_qwen_missing(self):
        app_main.ollama_client = FakeSetupOllamaClient(
            connected=True,
            models=["mistral:latest"],
        )

        response = self.client.get("/api/setup/status")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["ollama_connected"])
        self.assertFalse(data["has_selected"])
        self.assertFalse(data["ready"])
        self.assertEqual(data["recommended_model"], "qwen2.5:7b")
        self.assertIn("Choose and download", data["status_message"])

    def test_models_endpoint_exposes_exactly_four_plain_language_choices(self):
        app_main.ollama_client = FakeSetupOllamaClient(
            connected=True,
            models=["granite3.3:8b"],
        )

        response = self.client.get("/api/models")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["catalog"]), 4)
        self.assertEqual(data["selected_model"], "qwen2.5:7b")
        self.assertFalse(data["model_setup_completed"])
        self.assertTrue(next(item for item in data["catalog"] if item["id"] == "granite3.3:8b")["installed"])
        self.assertTrue(data["ollama_installed"])

    @patch("services.ollama_client.shutil.which", return_value=None)
    def test_ollama_install_detection_checks_the_standard_windows_location(self, _which):
        with tempfile.TemporaryDirectory() as directory:
            executable = Path(directory) / "Programs" / "Ollama" / "ollama app.exe"
            executable.parent.mkdir(parents=True)
            executable.touch()
            with patch.dict(os.environ, {"LOCALAPPDATA": directory}, clear=True):
                self.assertTrue(is_ollama_installed())

    def test_pull_endpoint_accepts_an_approved_choice(self):
        fake = FakeSetupOllamaClient(connected=True)
        app_main.ollama_client = fake

        response = self.client.post("/api/setup/pull", json={"model": "granite3.3:8b"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(fake.pulled_models, ["granite3.3:8b"])
        self.assertIn("granite3.3:8b", response.text)
        self.assertIn('"status": "complete"', response.text)

    def test_pull_endpoint_rejects_an_unapproved_model(self):
        fake = FakeSetupOllamaClient(connected=True)
        app_main.ollama_client = fake

        response = self.client.post("/api/setup/pull", json={"model": "llama3"})

        self.assertEqual(response.status_code, 422)
        self.assertEqual(fake.pulled_models, [])

    def test_model_cannot_be_selected_until_it_is_installed(self):
        app_main.ollama_client = FakeSetupOllamaClient(connected=True, models=[])

        response = self.client.post("/api/models/select", json={"model": "qwen3.5:4b"})

        self.assertEqual(response.status_code, 409)
        self.assertFalse(app_main.preferences_db.get()["model_setup_completed"])

    def test_selected_model_drives_the_runtime_check(self):
        fake = FakeSetupOllamaClient(connected=True, models=["qwen3.5:4b"])
        app_main.ollama_client = fake
        selected = self.client.post("/api/models/select", json={"model": "qwen3.5:4b"})
        self.assertEqual(selected.status_code, 200)

        response = self.client.post("/api/system/inference-check")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["model"], "qwen3.5:4b")
        self.assertEqual(fake.generated_models, ["qwen3.5:4b"])


if __name__ == "__main__":
    unittest.main()
