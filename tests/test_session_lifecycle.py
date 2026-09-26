import sqlite3
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

import main as app_main
from services.session_history import SESSION_SCHEMA_VERSION, SessionHistory


def session_payload(session_id="lifecycle-session", **overrides):
    payload = {
        "id": session_id,
        "date": "2026-09-07T12:00:00Z",
        "target_role": "Backend Engineer",
        "module": "technical",
        "duration_seconds": 42,
        "messages": [
            {"role": "assistant", "content": "How would you protect an idempotent API?"},
            {"role": "user", "content": "I would use an idempotency key and persist its result."},
        ],
        "status": "in_progress",
        "settings": {
            "difficulty": "hard",
            "duration": "quick",
            "industry": "technology",
            "interviewer_style": "direct",
            "selected_model": "qwen2.5:7b",
            "job_description": "Build reliable APIs.",
            "resume_text": "Built payment APIs.",
        },
        "interview_plan": {"version": "test-plan", "target_questions": 5},
        "role_intelligence": {"version": "test-role", "status": "job_and_resume"},
    }
    payload.update(overrides)
    return payload


class SessionHistoryLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = f"{self.tmpdir.name}/sessions.db"

    def tearDown(self):
        self.tmpdir.cleanup()

    def test_migrates_legacy_database_without_losing_completed_session(self):
        conn = sqlite3.connect(self.db_path)
        conn.execute(
            """CREATE TABLE sessions (
                id TEXT PRIMARY KEY, date TEXT NOT NULL, target_role TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL, messages TEXT NOT NULL, feedback TEXT
            )"""
        )
        conn.execute(
            "INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?)",
            ("legacy", "2026-01-01T00:00:00Z", "Designer", 60, "[]", '{"overall_score":81}'),
        )
        conn.commit()
        conn.close()

        history = SessionHistory(self.db_path)
        saved = history.get_session("legacy")

        self.assertEqual(saved["status"], "completed")
        self.assertEqual(saved["feedback"]["overall_score"], 81)
        self.assertEqual(saved["schema_version"], SESSION_SCHEMA_VERSION)
        self.assertEqual(saved["module"], "general")

    def test_partial_checkpoint_preserves_context_and_advances_revision(self):
        history = SessionHistory(self.db_path)
        created = history.save_session(session_payload())
        updated = history.update_session("lifecycle-session", {
            "duration_seconds": 71,
            "messages": created["messages"] + [{"role": "assistant", "content": "What can go wrong?"}],
        })

        self.assertEqual(updated["duration_seconds"], 71)
        self.assertEqual(updated["settings"]["difficulty"], "hard")
        self.assertEqual(updated["interview_plan"]["target_questions"], 5)
        self.assertEqual(updated["revision"], created["revision"] + 1)
        self.assertEqual(history.get_recoverable_session()["id"], "lifecycle-session")

    def test_comparisons_only_use_equivalent_completed_sessions(self):
        history = SessionHistory(self.db_path)
        for session_id, role, module, difficulty, score in (
            ("one", "Backend Engineer", "technical", "hard", 60),
            ("two", "Backend Engineer", "technical", "hard", 78),
            ("wrong-role", "Product Manager", "technical", "hard", 95),
            ("wrong-module", "Backend Engineer", "general", "hard", 93),
            ("wrong-level", "Backend Engineer", "technical", "easy", 91),
        ):
            history.save_session(session_payload(
                session_id,
                target_role=role,
                module=module,
                status="completed",
                feedback={"overall_score": score},
                settings={"difficulty": difficulty},
            ))

        comparable = history.comparable_sessions("two")
        self.assertEqual({item["id"] for item in comparable}, {"one", "two"})

    def test_evaluation_cache_is_versioned_and_counts_hits(self):
        history = SessionHistory(self.db_path)
        key = "a" * 64
        history.save_evaluation_cache(
            key,
            "v6_deterministic_rubric",
            "qwen2.5:7b",
            {"evaluation_version": "v6_deterministic_rubric", "question_evaluations": []},
        )

        self.assertIsNone(history.get_evaluation_cache(key, "v5_context_calibrated"))
        cached = history.get_evaluation_cache(key, "v6_deterministic_rubric")

        self.assertEqual(cached["evaluation_version"], "v6_deterministic_rubric")


class SessionLifecycleApiTests(unittest.TestCase):
    def setUp(self):
        self.original_history_db = app_main.history_db
        self.tmpdir = tempfile.TemporaryDirectory()
        app_main.history_db = SessionHistory(f"{self.tmpdir.name}/api-sessions.db")
        self.client = TestClient(app_main.app)

    def tearDown(self):
        app_main.history_db = self.original_history_db
        self.tmpdir.cleanup()

    def test_create_patch_get_and_recoverable_round_trip(self):
        create = self.client.post("/api/sessions", json=session_payload())
        self.assertEqual(create.status_code, 200)
        self.assertEqual(create.json()["session"]["status"], "in_progress")

        patch_response = self.client.patch(
            "/api/sessions/lifecycle-session",
            json={"duration_seconds": 90},
        )
        self.assertEqual(patch_response.status_code, 200)
        self.assertEqual(patch_response.json()["session"]["messages"][0]["role"], "assistant")

        recoverable = self.client.get("/api/sessions/recoverable").json()["session"]
        self.assertEqual(recoverable["id"], "lifecycle-session")
        fetched = self.client.get("/api/sessions/lifecycle-session").json()["session"]
        self.assertEqual(fetched["duration_seconds"], 90)

    def test_saved_session_evaluation_retry_updates_lifecycle_and_diagnostics(self):
        self.client.post("/api/sessions", json=session_payload(status="evaluation_failed"))
        feedback = {
            "overall_score": 84,
            "evaluation_version": "test-evaluator",
            "evaluator": {"model": "qwen2.5:7b", "attempts": 1, "output_valid": True},
        }
        with patch("main.evaluate_session", new=AsyncMock(return_value={"feedback": feedback})):
            response = self.client.post(
                "/api/sessions/lifecycle-session/evaluate",
                json={"camera_on": False},
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "completed")
        self.assertEqual(body["session"]["feedback"]["overall_score"], 84)
        self.assertEqual(body["session"]["evaluator_metadata"]["attempts"], 1)
        self.assertEqual(body["session"]["evaluation_error"], "")


if __name__ == "__main__":
    unittest.main()
