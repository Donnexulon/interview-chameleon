import tempfile
import unittest

from fastapi.testclient import TestClient

import main as app_main
from services.evaluation_calibration import (
    build_calibration_summary,
    build_review_snapshot,
    export_calibration_cases,
)
from services.session_history import SessionHistory


def completed_session(session_id="calibration-session"):
    return {
        "id": session_id,
        "date": "2026-09-08T12:00:00Z",
        "target_role": "Backend Engineer",
        "module": "technical",
        "duration_seconds": 180,
        "messages": [
            {"role": "assistant", "content": "How do you make payment retries safe?"},
            {
                "role": "user",
                "content": "I store an idempotency key and committed response. Contact me at coach@example.com.",
            },
        ],
        "status": "completed",
        "settings": {"difficulty": "hard"},
        "feedback": {
            "overall_score": 72,
            "evaluation_version": "v5_context_calibrated",
            "evaluator": {
                "model_digest": "sha256:test-model",
                "rubric_version": "rubric-test",
                "prompt_version": "prompt-test",
                "scoring_engine": "engine-test",
            },
            "question_evaluations": [{
                "question": "How do you make payment retries safe?",
                "score": 64,
                "evidence_quotes": ["I store an idempotency key and committed response."],
                "competency_scores": {"specificity": 61, "evidence_quality": 58},
                "module_scores": {"technical_accuracy": 68},
                "rubric_assessment": {
                    "dimension_bands": {"specificity": "adequate"},
                    "module_bands": {"technical_accuracy": "adequate"},
                },
                "correctness": "correct",
                "limiting_rule": "Rubric-weighted score; no limiting gate applied",
                "verifier": {"status": "not_requested"},
                "confidence": {"score": 84, "level": "high"},
            }],
        },
    }


class EvaluationCalibrationTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.history = SessionHistory(f"{self.tmpdir.name}/calibration.db")
        self.session = self.history.save_session(completed_session())

    def tearDown(self):
        self.tmpdir.cleanup()

    def test_review_snapshot_and_storage_preserve_evaluator_evidence(self):
        snapshot = build_review_snapshot(self.session, 0, "too_harsh", "The guarantee was explicit.")
        saved = self.history.save_evaluation_review(snapshot)

        self.assertEqual(saved["verdict"], "too_harsh")
        self.assertEqual(saved["evaluator_score"], 64)
        self.assertEqual(saved["competency_scores"]["specificity"], 61)
        self.assertIn("idempotency key", saved["answer_text"])
        self.assertEqual(saved["correctness"], "correct")
        self.assertEqual(saved["confidence"]["level"], "high")
        self.assertEqual(saved["model_digest"], "sha256:test-model")

    def test_review_upsert_and_session_delete_are_consistent(self):
        first = build_review_snapshot(self.session, 0, "too_harsh")
        self.history.save_evaluation_review(first)
        updated = build_review_snapshot(self.session, 0, "accurate")
        self.history.save_evaluation_review(updated)

        self.assertEqual(len(self.history.get_evaluation_reviews("calibration-session")), 1)
        self.assertEqual(self.history.get_evaluation_reviews()[0]["verdict"], "accurate")
        self.history.delete_session("calibration-session")
        self.assertEqual(self.history.get_evaluation_reviews(), [])

    def test_summary_reports_bias_by_module_and_competency(self):
        harsh = self.history.save_evaluation_review(
            build_review_snapshot(self.session, 0, "too_harsh")
        )
        summary = build_calibration_summary([harsh])

        self.assertEqual(summary["review_count"], 1)
        self.assertEqual(summary["bias"], "Scores trend harsh")
        self.assertEqual(summary["modules"][0]["module"], "technical")
        keys = {item["key"] for item in summary["competencies"]}
        self.assertIn("technical_accuracy", keys)
        self.assertIn("specificity", keys)

    def test_export_excludes_session_identity_and_redacts_contact_data(self):
        review = self.history.save_evaluation_review(
            build_review_snapshot(self.session, 0, "wrong_evidence")
        )
        exported = export_calibration_cases([review])
        case = exported["cases"][0]

        self.assertNotIn("session_id", case)
        self.assertIn("[email]", case["answer"])
        self.assertEqual(case["human_review"]["expected_score_direction"], "review_evidence")
        self.assertEqual(case["evaluator_snapshot"]["model_digest"], "sha256:test-model")


class EvaluationCalibrationApiTests(unittest.TestCase):
    def setUp(self):
        self.original_history_db = app_main.history_db
        self.tmpdir = tempfile.TemporaryDirectory()
        app_main.history_db = SessionHistory(f"{self.tmpdir.name}/calibration-api.db")
        app_main.history_db.save_session(completed_session())
        self.client = TestClient(app_main.app)

    def tearDown(self):
        app_main.history_db = self.original_history_db
        self.tmpdir.cleanup()

    def test_review_summary_and_export_api_flow(self):
        save = self.client.put(
            "/api/sessions/calibration-session/evaluation-reviews/0",
            json={"verdict": "too_generous", "note": "Missing a concurrency guarantee."},
        )
        self.assertEqual(save.status_code, 200)
        self.assertEqual(save.json()["review"]["evaluator_score"], 64)

        reviews = self.client.get(
            "/api/sessions/calibration-session/evaluation-reviews"
        ).json()["reviews"]
        self.assertEqual(reviews[0]["verdict"], "too_generous")

        summary = self.client.get("/api/calibration/summary").json()["calibration"]
        self.assertEqual(summary["bias"], "Scores trend generous")

        exported = self.client.get("/api/calibration/export")
        self.assertEqual(exported.status_code, 200)
        self.assertIn("attachment", exported.headers["content-disposition"])
        self.assertEqual(exported.json()["case_count"], 1)

    def test_draft_session_cannot_create_calibration_review(self):
        draft = completed_session("draft-session")
        draft["status"] = "in_progress"
        app_main.history_db.save_session(draft)

        response = self.client.put(
            "/api/sessions/draft-session/evaluation-reviews/0",
            json={"verdict": "accurate"},
        )

        self.assertEqual(response.status_code, 409)


if __name__ == "__main__":
    unittest.main()
