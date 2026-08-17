import tempfile
import unittest

from fastapi.testclient import TestClient

import main as app_main
from services.session_history import SessionHistory


def demo_session_payload(session_id="test-v3-demo-cert"):
    return {
        "id": session_id,
        "date": "2026-06-22T12:00:00Z",
        "target_role": "Product Manager, AI Collaboration Tools",
        "module": "general",
        "duration_seconds": 90,
        "messages": [
            {"role": "assistant", "content": "Tell me about a product launch you led.", "timestamp": 1000},
            {
                "role": "user",
                "content": "I led an activation analytics launch and improved onboarding conversion from 42% to 61%.",
                "timestamp": 7000,
            },
        ],
        "feedback": {
            "evaluation_version": "v3_readiness_scorecard",
            "overall_score": 87,
            "interview_scores": {
                "responsiveness": 90,
                "depth": 88,
                "clarity": 84,
                "communication_style": 86,
            },
            "competency_scores": {
                "answer_relevance": 90,
                "specificity": 86,
                "structure": 84,
                "evidence_quality": 88,
                "impact_orientation": 90,
                "role_alignment": 89,
                "communication_clarity": 84,
                "adaptability": 86,
            },
            "readiness": {
                "level": "interview_ready",
                "hire_signal": "yes",
                "summary": "Demo data can be saved and reloaded.",
                "blockers": [],
                "strongest_signals": ["Evidence-backed answer"],
            },
            "question_evaluations": [
                {
                    "question": "Tell me about a product launch you led.",
                    "answer_summary": "Described a launch with a measurable conversion lift.",
                    "answer_type": "complete",
                    "score": 90,
                    "competency_scores": {
                        "answer_relevance": 90,
                        "specificity": 86,
                        "structure": 84,
                        "evidence_quality": 88,
                        "impact_orientation": 90,
                        "role_alignment": 89,
                        "communication_clarity": 84,
                        "adaptability": 86,
                    },
                    "evidence_quotes": ["improved onboarding conversion from 42% to 61%"],
                    "missed_opportunity": "Add one tradeoff.",
                    "coaching_note": "Strong quantified answer.",
                    "practice_drill": "Compress to 60 seconds.",
                }
            ],
            "question_highlights": [
                {
                    "question": "Tell me about a product launch you led.",
                    "answer_summary": "Described a launch with a measurable conversion lift.",
                    "assessment": "Strong quantified answer.",
                    "evidence_quote": "improved onboarding conversion from 42% to 61%",
                    "score": 90,
                }
            ],
            "risk_flags": [],
            "practice_plan": ["Repeat the launch story in 90 seconds."],
        },
    }


class DemoCertificationApiTests(unittest.TestCase):
    def setUp(self):
        self.original_history_db = app_main.history_db
        self.tmpdir = tempfile.TemporaryDirectory()
        self.history_db = SessionHistory(f"{self.tmpdir.name}/sessions.db")
        app_main.history_db = self.history_db
        self.client = TestClient(app_main.app)

    def tearDown(self):
        app_main.history_db = self.original_history_db
        self.tmpdir.cleanup()

    def test_v3_demo_session_saves_and_reloads(self):
        payload = demo_session_payload()

        save_response = self.client.post("/api/sessions", json=payload)
        self.assertEqual(save_response.status_code, 200)

        list_response = self.client.get("/api/sessions")
        self.assertEqual(list_response.status_code, 200)
        sessions = list_response.json()["sessions"]
        self.assertEqual(len(sessions), 1)
        saved = sessions[0]
        self.assertEqual(saved["id"], payload["id"])
        self.assertEqual(saved["feedback"]["evaluation_version"], "v3_readiness_scorecard")
        self.assertEqual(saved["feedback"]["readiness"]["level"], "interview_ready")
        self.assertEqual(
            saved["feedback"]["question_highlights"][0]["evidence_quote"],
            "improved onboarding conversion from 42% to 61%",
        )

    def test_resume_parse_alias_matches_parse_resume(self):
        files = {"file": ("resume.txt", b"Demo Candidate\nProduct Manager\nActivation analytics", "text/plain")}

        parse_response = self.client.post("/api/parse-resume", files=files)
        self.assertEqual(parse_response.status_code, 200)
        self.assertIn("Product Manager", parse_response.json()["text"])

        alias_files = {"file": ("resume.txt", b"Demo Candidate\nProduct Manager\nActivation analytics", "text/plain")}
        alias_response = self.client.post("/api/upload-resume", files=alias_files)
        self.assertEqual(alias_response.status_code, 200)
        self.assertEqual(alias_response.json(), parse_response.json())


if __name__ == "__main__":
    unittest.main()
