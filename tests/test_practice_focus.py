import copy
import tempfile
import unittest

from fastapi.testclient import TestClient

import main as app_main
from services.interview_orchestrator import build_interview_plan
from services.practice_focus import (
    PRACTICE_FOCUS_VERSION,
    PRACTICE_PROGRESS_VERSION,
    build_practice_focus,
    build_practice_progress,
)
from services.session_history import SessionHistory


def completed_session(session_id="focus-source"):
    competency_scores = {
        "answer_relevance": 90,
        "specificity": 35,
        "structure": 88,
        "evidence_quality": 86,
        "impact_orientation": 84,
        "role_alignment": 90,
        "communication_clarity": 89,
        "adaptability": 85,
    }
    return {
        "id": session_id,
        "date": "2026-09-07T12:00:00Z",
        "target_role": "Backend Engineer",
        "module": "technical",
        "duration_seconds": 420,
        "messages": [
            {"role": "assistant", "content": "How would you make an API idempotent?"},
            {"role": "user", "content": "I would probably cache the request."},
        ],
        "status": "completed",
        "settings": {
            "difficulty": "hard",
            "duration": "quick",
            "industry": "technology",
            "interviewer_style": "direct",
            "job_description": "Build reliable distributed APIs.",
            "resume_text": "Built internal APIs.",
        },
        "feedback": {
            "overall_score": 68,
            "competency_scores": competency_scores,
            "module_scores": {
                "technical_accuracy": 38,
                "problem_solving": 88,
                "thought_process": 89,
            },
            "improvement_tip": "State the persistence and concurrency guarantees explicitly.",
            "practice_plan": ["Re-answer the idempotency question with failure modes."],
            "question_evaluations": [{
                "question": "How would you make an API idempotent?",
                "score": 42,
                "missed_opportunity": "Explain durable idempotency keys and concurrent retries.",
            }],
        },
    }


def focused_session(session_id="focus-current", specificity=56, overall_score=78):
    source = completed_session()
    current = copy.deepcopy(source)
    current["id"] = session_id
    current["date"] = "2026-09-07T13:00:00Z"
    current["feedback"]["overall_score"] = overall_score
    current["feedback"]["competency_scores"]["specificity"] = specificity
    current["feedback"]["module_scores"]["technical_accuracy"] = specificity
    current["settings"]["focus_context"] = build_practice_focus(source)["focus_context"]
    return current


class PracticeFocusTests(unittest.TestCase):
    def test_builds_focus_from_lowest_evidence_and_preserves_launch_settings(self):
        result = build_practice_focus(completed_session())

        self.assertEqual(result["focus_context"]["version"], PRACTICE_FOCUS_VERSION)
        self.assertEqual(result["focus_context"]["focus_keys"], ["technical_accuracy"])
        self.assertIn("concurrent retries", result["focus_context"]["evaluation_gap"])
        self.assertEqual(result["launch_config"]["difficulty"], "hard")
        self.assertEqual(result["launch_config"]["duration"], "quick")

    def test_focused_plan_prioritizes_weak_competency_without_duplicate_fallbacks(self):
        focused = build_practice_focus(completed_session())
        config = {**focused["launch_config"], "focus_context": focused["focus_context"]}
        quick = build_interview_plan(config)
        extended = build_interview_plan({**config, "duration": "extended"})

        self.assertTrue(all(entry["adaptive_focus"] for entry in quick["entries"][:5]))
        self.assertTrue(all(entry["competency"] == "technical_accuracy" for entry in quick["entries"][:5]))
        fallbacks = [entry["fallback_question"] for entry in extended["entries"]]
        self.assertEqual(len(fallbacks), len(set(fallbacks)))

    def test_unscored_session_cannot_create_false_focus(self):
        session = completed_session()
        session["feedback"] = {"readiness": {"level": "insufficient_evidence"}}
        with self.assertRaises(ValueError):
            build_practice_focus(session)

    def test_progress_compares_only_the_original_focus_targets(self):
        progress = build_practice_progress(focused_session(), completed_session())

        self.assertEqual(progress["version"], PRACTICE_PROGRESS_VERSION)
        self.assertEqual(progress["outcome"], "improved")
        self.assertEqual(progress["overall_delta"], 10)
        self.assertEqual(len(progress["comparisons"]), 1)
        self.assertEqual(progress["comparisons"][0]["key"], "technical_accuracy")
        self.assertEqual(progress["comparisons"][0]["source_score"], 35)
        self.assertEqual(progress["comparisons"][0]["current_score"], 56)
        self.assertEqual(progress["comparisons"][0]["delta"], 21)

    def test_small_score_change_is_reported_as_steady(self):
        progress = build_practice_progress(
            focused_session(specificity=39, overall_score=69),
            completed_session(),
        )

        self.assertEqual(progress["outcome"], "steady")
        self.assertEqual(progress["comparisons"][0]["delta"], 4)

    def test_progress_rejects_a_different_source_session(self):
        with self.assertRaises(ValueError):
            build_practice_progress(focused_session(), completed_session("other-source"))


class PracticeFocusApiTests(unittest.TestCase):
    def setUp(self):
        self.original_history_db = app_main.history_db
        self.tmpdir = tempfile.TemporaryDirectory()
        app_main.history_db = SessionHistory(f"{self.tmpdir.name}/focus.db")
        app_main.history_db.save_session(completed_session())
        app_main.history_db.save_session(focused_session())
        self.client = TestClient(app_main.app)

    def tearDown(self):
        app_main.history_db = self.original_history_db
        self.tmpdir.cleanup()

    def test_endpoint_returns_launchable_focused_plan(self):
        response = self.client.get("/api/sessions/focus-source/practice-focus")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["focus_context"]["focus_keys"], ["technical_accuracy"])
        self.assertEqual(body["plan"]["target_questions"], 5)
        self.assertTrue(body["plan"]["entries"][0]["adaptive_focus"])

    def test_progress_endpoint_returns_evidence_matched_deltas(self):
        response = self.client.get("/api/sessions/focus-current/focus-progress")

        self.assertEqual(response.status_code, 200)
        progress = response.json()["progress"]
        self.assertEqual(progress["source_session_id"], "focus-source")
        self.assertEqual(progress["outcome"], "improved")
        self.assertEqual(progress["comparisons"][0]["delta"], 21)

    def test_progress_endpoint_rejects_a_non_focused_session(self):
        response = self.client.get("/api/sessions/focus-source/focus-progress")

        self.assertEqual(response.status_code, 409)


if __name__ == "__main__":
    unittest.main()
