import unittest

from services.evaluation_regression import build_regression_gate, compare_calibration_case


def case(direction="hold", score=70, evidence=None):
    return {
        "id": "local_calibration_001",
        "module": "technical",
        "answer": "I persisted the idempotency key and its committed response.",
        "evaluator_snapshot": {
            "evaluation_version": "v5_context_calibrated",
            "score": score,
            "evidence_quotes": evidence or ["I persisted the idempotency key"],
        },
        "human_review": {"expected_score_direction": direction},
    }


class EvaluationRegressionTests(unittest.TestCase):
    def test_directional_feedback_becomes_a_release_assertion(self):
        result = compare_calibration_case(case("increase"), {
            "evaluation_version": "v6_deterministic_rubric",
            "score": 76,
            "evidence_quotes": ["idempotency key and its committed response"],
        })

        self.assertTrue(result["pass"])
        self.assertEqual(result["score_delta"], 6)
        self.assertEqual(result["previous_version"], "v5_context_calibrated")
        self.assertEqual(result["candidate_version"], "v6_deterministic_rubric")

    def test_wrong_evidence_must_be_replaced_with_grounded_evidence(self):
        unchanged = compare_calibration_case(case("review_evidence"), {
            "evaluation_version": "v6_deterministic_rubric",
            "score": 70,
            "evidence_quotes": ["I persisted the idempotency key"],
        })
        replaced = compare_calibration_case(case("review_evidence"), {
            "evaluation_version": "v6_deterministic_rubric",
            "score": 70,
            "evidence_quotes": ["idempotency key and its committed response"],
        })

        self.assertFalse(unchanged["pass"])
        self.assertTrue(replaced["pass"])

    def test_incomplete_case_coverage_blocks_release(self):
        exported = {"version": "v1_local_calibration", "cases": [case()]}

        gate = build_regression_gate(exported, {})

        self.assertFalse(gate["release_ready"])
        self.assertFalse(gate["passed"])
        self.assertEqual(gate["missing_case_ids"], ["local_calibration_001"])


if __name__ == "__main__":
    unittest.main()
