import json
import unittest

from services.evaluation import (
    COMPETENCY_KEYS,
    EVALUATION_VERSION,
    build_evaluation_fallback,
    build_transcript_analysis,
    derive_interview_scores,
    merge_scores,
    parse_evaluation_response,
)


TRANSCRIPT_MESSAGES = [
    {"role": "assistant", "content": "Tell me about a difficult project.", "timestamp": 1000},
    {"role": "user", "content": "I led the migration and coordinated with QA.", "timestamp": 7000},
]
TRANSCRIPT_ANALYSIS = build_transcript_analysis(TRANSCRIPT_MESSAGES)


def competency_scores(value=75, **overrides):
    scores = {key: value for key in COMPETENCY_KEYS}
    scores.update(overrides)
    return scores


def valid_evaluation_payload(**overrides):
    payload = {
        "evaluation_version": EVALUATION_VERSION,
        "competency_scores": competency_scores(
            answer_relevance=80,
            specificity=70,
            structure=75,
            evidence_quality=65,
            impact_orientation=75,
            role_alignment=85,
            communication_clarity=75,
            adaptability=85,
        ),
        "module_scores": {},
        "readiness": {
            "level": "developing",
            "hire_signal": "lean_no",
            "summary": "Promising but not yet consistently interview-ready.",
            "blockers": ["Needs more measurable impact."],
            "strongest_signals": ["Clear ownership."],
        },
        "weakest_area": "evidence_quality",
        "strongest_area": "role_alignment",
        "improvement_tip": "Use one quantified result in each answer.",
        "coaching_summary": "The candidate answered directly and communicated clearly.",
        "actionable_next_steps": ["Practice STAR answers", "Add metrics"],
        "risk_flags": [],
        "red_flags": [],
        "practice_plan": ["Rewrite the project answer with one metric."],
        "evaluator_confidence": 82,
        "question_evaluations": [
            {
                "question": "Tell me about a difficult project.",
                "answer_summary": "Described a migration project.",
                "answer_type": "partial",
                "score": 74,
                "competency_scores": competency_scores(74),
                "evidence_quotes": ["I led the migration and coordinated with QA."],
                "missed_opportunity": "Add a measurable outcome.",
                "coaching_note": "Clear but light on measurable impact.",
                "practice_drill": "Rewrite this answer with a before/after metric.",
            }
        ],
    }
    payload.update(overrides)
    return payload


def parse_payload(payload):
    return parse_evaluation_response(
        json.dumps(payload),
        transcript_pairs=TRANSCRIPT_ANALYSIS["pairs"],
        transcript_features=TRANSCRIPT_ANALYSIS["features"],
    )


class EvaluationSchemaTests(unittest.TestCase):
    def test_valid_full_evaluation_parses(self):
        parsed = parse_payload(valid_evaluation_payload())

        self.assertEqual(parsed["evaluation_version"], EVALUATION_VERSION)
        self.assertEqual(parsed["interview_scores"]["responsiveness"], 80)
        self.assertEqual(parsed["interview_scores"]["depth"], 70)
        self.assertEqual(parsed["question_highlights"][0]["evidence_quote"], "I led the migration and coordinated with QA.")
        self.assertEqual(parsed["transcript_features"]["answer_count"], 1)

    def test_missing_optional_fields_use_defaults(self):
        payload = {
            "competency_scores": competency_scores(65),
            "question_evaluations": [],
        }

        parsed = parse_evaluation_response(json.dumps(payload))

        self.assertEqual(parsed["evaluation_version"], EVALUATION_VERSION)
        self.assertEqual(parsed["module_scores"], {})
        self.assertEqual(parsed["actionable_next_steps"], [])
        self.assertEqual(parsed["readiness"]["level"], "developing")

    def test_invalid_score_range_fails_validation(self):
        payload = valid_evaluation_payload(
            competency_scores=competency_scores(answer_relevance=101)
        )

        with self.assertRaises(Exception):
            parse_payload(payload)

    def test_evidence_quote_mismatch_fails_validation(self):
        payload = valid_evaluation_payload(
            question_evaluations=[
                {
                    "question": "Tell me about a difficult project.",
                    "answer_summary": "Described a migration project.",
                    "answer_type": "partial",
                    "score": 74,
                    "competency_scores": competency_scores(74),
                    "evidence_quotes": ["I invented a quote that is not in the answer."],
                    "missed_opportunity": "Add a measurable outcome.",
                    "coaching_note": "Clear but light on measurable impact.",
                    "practice_drill": "Rewrite this answer with a before/after metric.",
                }
            ]
        )

        with self.assertRaises(Exception):
            parse_payload(payload)

    def test_missing_answer_scores_are_capped(self):
        payload = valid_evaluation_payload(
            question_evaluations=[
                {
                    "question": "Tell me about a difficult project.",
                    "answer_summary": "No answer provided.",
                    "answer_type": "missing",
                    "score": 80,
                    "competency_scores": competency_scores(80),
                    "evidence_quotes": [],
                    "missed_opportunity": "Provide any relevant example.",
                    "coaching_note": "No substantive answer was captured.",
                    "practice_drill": "Prepare a 60-second project story.",
                }
            ]
        )

        parsed = parse_payload(payload)

        q_eval = parsed["question_evaluations"][0]
        self.assertEqual(q_eval["score"], 39)
        self.assertEqual(q_eval["competency_scores"]["answer_relevance"], 39)

    def test_legacy_interview_scores_are_derived(self):
        scores = derive_interview_scores(valid_evaluation_payload()["competency_scores"])

        self.assertEqual(scores["responsiveness"], 80)
        self.assertEqual(scores["depth"], 70)
        self.assertEqual(scores["clarity"], 75)
        self.assertEqual(scores["communication_style"], 85)

    def test_fallback_is_non_zero_and_structured(self):
        fallback = build_evaluation_fallback("invalid json", TRANSCRIPT_MESSAGES)

        self.assertTrue(fallback["evaluation_error"])
        self.assertEqual(fallback["evaluation_version"], EVALUATION_VERSION)
        self.assertGreater(fallback["interview_scores"]["responsiveness"], 0)
        self.assertEqual(fallback["question_highlights"][0]["evidence_quote"], "I led the migration and coordinated with QA.")
        self.assertEqual(fallback["transcript_features"]["answer_count"], 1)

    def test_display_text_mojibake_is_cleaned_without_changing_evidence(self):
        payload = valid_evaluation_payload(
            coaching_summary="The candidate\u00e2\u0080\u0099s answer is clear.",
            readiness={
                "level": "developing",
                "hire_signal": "lean_no",
                "summary": "Candidate\u00e2\u0080\u0099s examples need more impact.",
                "blockers": ["Don\u00e2\u0080\u0099t skip metrics."],
                "strongest_signals": ["Clear ownership."],
            },
        )

        parsed = parse_payload(payload)

        self.assertEqual(parsed["coaching_summary"], "The candidate's answer is clear.")
        self.assertEqual(parsed["readiness"]["summary"], "Candidate's examples need more impact.")
        self.assertEqual(parsed["readiness"]["blockers"][0], "Don't skip metrics.")
        self.assertEqual(parsed["question_highlights"][0]["evidence_quote"], "I led the migration and coordinated with QA.")

    def test_blank_display_list_items_are_removed(self):
        payload = valid_evaluation_payload(
            actionable_next_steps=["", "Add metrics"],
            red_flags=[""],
            risk_flags=["", "Answers need stronger evidence."],
            practice_plan=["  ", "Practice one STAR answer."],
            readiness={
                "level": "developing",
                "hire_signal": "lean_no",
                "summary": "Promising but incomplete.",
                "blockers": ["", "Needs measurable impact."],
                "strongest_signals": ["  ", "Clear ownership."],
            },
        )

        parsed = parse_payload(payload)

        self.assertEqual(parsed["actionable_next_steps"], ["Add metrics"])
        self.assertEqual(parsed["red_flags"], ["Answers need stronger evidence."])
        self.assertEqual(parsed["risk_flags"], ["Answers need stronger evidence."])
        self.assertEqual(parsed["practice_plan"], ["Practice one STAR answer."])
        self.assertEqual(parsed["readiness"]["blockers"], ["Needs measurable impact."])
        self.assertEqual(parsed["readiness"]["strongest_signals"], ["Clear ownership."])


class ScoreMergeTests(unittest.TestCase):
    def test_interview_only(self):
        feedback = valid_evaluation_payload(competency_scores=competency_scores(75))

        merged = merge_scores(feedback)

        self.assertEqual(merged["overall_score"], 75)
        self.assertEqual(merged["pillars"]["interview"]["weight"], 1.0)
        self.assertEqual(merged["readiness"]["level"], "near_ready")

    def test_interview_and_engagement(self):
        feedback = valid_evaluation_payload(competency_scores=competency_scores(75))

        merged = merge_scores(feedback, engagement_data={"composite": 85})

        self.assertEqual(merged["overall_score"], 78)
        self.assertEqual(merged["pillars"]["engagement"]["weight"], 0.30)

    def test_interview_presence_and_engagement(self):
        feedback = valid_evaluation_payload(competency_scores=competency_scores(80))

        merged = merge_scores(
            feedback,
            presence_data={"composite": 60},
            engagement_data={"composite": 90},
            camera_on=True,
        )

        self.assertEqual(merged["overall_score"], 77)
        self.assertEqual(merged["pillars"]["presence"]["weight"], 0.25)

    def test_module_scores_affect_interview_score(self):
        feedback = valid_evaluation_payload(
            competency_scores=competency_scores(80),
            module_scores={"technical_accuracy": 60, "problem_solving": 60},
        )

        merged = merge_scores(feedback)

        self.assertEqual(merged["pillars"]["interview"]["score"], 75)
        self.assertEqual(merged["overall_score"], 75)


if __name__ == "__main__":
    unittest.main()
