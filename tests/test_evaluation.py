import json
import unittest

from services.evaluation import (
    COMPETENCY_KEYS,
    EVALUATION_VERSION,
    build_evaluation_fallback,
    build_evaluation_generation_options,
    build_evaluation_output_schema,
    build_evaluation_prompt,
    build_evaluation_recovery_schema,
    build_transcript_analysis,
    derive_interview_scores,
    evaluation_timeout_seconds,
    merge_scores,
    parse_evaluation_response,
    parse_evaluation_recovery_response,
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
        # Aggregate scores are derived from the paired question evaluation, not
        # trusted from a separate model-generated top-level summary.
        self.assertEqual(parsed["interview_scores"]["responsiveness"], 74)
        self.assertEqual(parsed["interview_scores"]["depth"], 74)
        self.assertEqual(parsed["question_highlights"][0]["evidence_quote"], "I led the migration and coordinated with QA.")
        self.assertEqual(parsed["transcript_features"]["answer_count"], 1)
        self.assertEqual(parsed["transcript_features"]["evaluation_coverage"], 1.0)

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

    def test_evidence_quote_allows_only_terminal_punctuation_difference(self):
        payload = valid_evaluation_payload()
        payload["question_evaluations"][0]["evidence_quotes"] = [
            "I led the migration and coordinated with QA"
        ]

        parsed = parse_payload(payload)

        self.assertEqual(
            parsed["question_highlights"][0]["evidence_quote"],
            "I led the migration and coordinated with QA",
        )

    def test_near_verbatim_evidence_quote_is_restored_to_exact_source_sentence(self):
        payload = valid_evaluation_payload()
        payload["question_evaluations"][0]["evidence_quotes"] = [
            "I would verify both transaction IDs and confirm whether one is a pending authorization."
        ]
        messages = [
            {"role": "assistant", "content": "How would you handle a duplicate charge?"},
            {
                "role": "user",
                "content": (
                    "I would first verify both transaction IDs and confirm whether one is a pending authorization. "
                    "If both settled, I would start the refund."
                ),
            },
        ]
        payload["question_evaluations"][0]["question"] = "How would you handle a duplicate charge?"
        analysis = build_transcript_analysis(messages)

        parsed = parse_evaluation_response(
            json.dumps(payload),
            transcript_pairs=analysis["pairs"],
            transcript_features=analysis["features"],
        )

        self.assertEqual(
            parsed["question_evaluations"][0]["evidence_quotes"][0],
            "I would first verify both transaction IDs and confirm whether one is a pending authorization.",
        )

    def test_wrapping_quote_marks_are_removed_from_exact_multisentence_evidence(self):
        payload = valid_evaluation_payload()
        payload["question_evaluations"][0]["evidence_quotes"] = [
            '\"I led the migration and coordinated with QA. It finished on time.\"'
        ]
        messages = [
            {"role": "assistant", "content": "Tell me about a difficult project."},
            {
                "role": "user",
                "content": "I led the migration and coordinated with QA. It finished on time.",
            },
        ]
        analysis = build_transcript_analysis(messages)

        parsed = parse_evaluation_response(
            json.dumps(payload),
            transcript_pairs=analysis["pairs"],
            transcript_features=analysis["features"],
        )

        self.assertEqual(
            parsed["question_evaluations"][0]["evidence_quotes"][0],
            "I led the migration and coordinated with QA. It finished on time.",
        )

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

    def test_technical_module_scores_change_question_score(self):
        payload = valid_evaluation_payload(
            module_scores={"problem_solving": 30, "technical_accuracy": 20, "thought_process": 30},
            question_evaluations=[{
                "question": "Tell me about a difficult project.",
                "answer_summary": "Gave a polished but technically incorrect answer.",
                "answer_type": "complete",
                "score": 90,
                "competency_scores": competency_scores(90),
                "module_scores": {
                    "problem_solving": 30,
                    "technical_accuracy": 20,
                    "thought_process": 30,
                },
                "evidence_quotes": ["I led the migration and coordinated with QA."],
                "missed_opportunity": "Correct the technical reasoning.",
                "coaching_note": "Clear delivery cannot compensate for an incorrect solution.",
                "practice_drill": "Solve the problem again and test edge cases.",
            }],
        )

        parsed = parse_evaluation_response(
            json.dumps(payload),
            transcript_pairs=TRANSCRIPT_ANALYSIS["pairs"],
            transcript_features=TRANSCRIPT_ANALYSIS["features"],
            module="technical",
        )

        self.assertEqual(parsed["question_evaluations"][0]["score"], 30)
        self.assertEqual(parsed["module_scores"]["technical_accuracy"], 20)

    def test_technical_critical_error_caps_inflated_accuracy(self):
        payload = valid_evaluation_payload(
            question_evaluations=[{
                "question": "Tell me about a difficult project.",
                "answer_summary": "A confident but centrally incorrect design.",
                "answer_type": "complete",
                "score": 90,
                "competency_scores": competency_scores(90),
                "module_scores": {
                    "problem_solving": 80,
                    "technical_accuracy": 80,
                    "thought_process": 80,
                },
                "critical_error": True,
                "critical_error_reason": "The design cannot enforce a global limit.",
                "evidence_quotes": ["I led the migration and coordinated with QA."],
                "missed_opportunity": "Use shared atomic state.",
                "coaching_note": "The central architecture is invalid.",
                "practice_drill": "Redesign with a distributed counter.",
            }],
        )

        parsed = parse_evaluation_response(
            json.dumps(payload),
            transcript_pairs=TRANSCRIPT_ANALYSIS["pairs"],
            transcript_features=TRANSCRIPT_ANALYSIS["features"],
            module="technical",
        )

        item = parsed["question_evaluations"][0]
        self.assertEqual(item["module_scores"]["technical_accuracy"], 25)
        self.assertEqual(item["score"], 35)

    def test_technical_accuracy_boundary_cannot_be_averaged_into_a_pass(self):
        payload = valid_evaluation_payload(
            question_evaluations=[{
                "question": "Tell me about a difficult project.",
                "answer_summary": "Polished, but major technical corrections are required.",
                "answer_type": "complete",
                "score": 90,
                "competency_scores": competency_scores(90),
                "module_scores": {
                    "problem_solving": 80,
                    "technical_accuracy": 50,
                    "thought_process": 80,
                },
                "evidence_quotes": ["I led the migration and coordinated with QA."],
                "missed_opportunity": "Correct the central design.",
                "coaching_note": "Accuracy is a gating requirement.",
                "practice_drill": "Test the design against its constraints.",
            }],
        )

        parsed = parse_evaluation_response(
            json.dumps(payload),
            transcript_pairs=TRANSCRIPT_ANALYSIS["pairs"],
            transcript_features=TRANSCRIPT_ANALYSIS["features"],
            module="technical",
        )

        self.assertEqual(parsed["question_evaluations"][0]["score"], 35)

    def test_case_study_with_weak_module_reasoning_stays_out_of_passing_band(self):
        payload = valid_evaluation_payload(
            question_evaluations=[{
                "question": "Tell me about a difficult project.",
                "answer_summary": "Made a recommendation without a usable analysis.",
                "answer_type": "complete",
                "score": 75,
                "competency_scores": competency_scores(70),
                "module_scores": {
                    "framework_usage": 20,
                    "quantitative_reasoning": 30,
                    "recommendation_quality": 40,
                },
                "evidence_quotes": ["I led the migration and coordinated with QA."],
                "missed_opportunity": "Quantify the decision.",
                "coaching_note": "Build a structured case.",
                "practice_drill": "Write an issue tree and decision gate.",
            }],
        )

        parsed = parse_evaluation_response(
            json.dumps(payload),
            transcript_pairs=TRANSCRIPT_ANALYSIS["pairs"],
            transcript_features=TRANSCRIPT_ANALYSIS["features"],
            module="casestudy",
        )

        self.assertEqual(parsed["question_evaluations"][0]["score"], 40)

    def test_strong_salary_criteria_override_spurious_essential_gap_flag(self):
        payload = valid_evaluation_payload(
            question_evaluations=[{
                "question": "Tell me about a difficult project.",
                "answer_summary": "Negotiated a complete alternative package.",
                "answer_type": "complete",
                "score": 88,
                "competency_scores": competency_scores(88),
                "module_scores": {
                    "anchoring_strategy": 80,
                    "justification_quality": 75,
                    "composure": 85,
                },
                "essential_gap": True,
                "essential_gap_reason": "The model incorrectly expected more base flexibility.",
                "evidence_quotes": ["I led the migration and coordinated with QA."],
                "missed_opportunity": "None material.",
                "coaching_note": "The package response was substantive.",
                "practice_drill": "Practice prioritizing package components.",
            }],
        )

        parsed = parse_evaluation_response(
            json.dumps(payload),
            transcript_pairs=TRANSCRIPT_ANALYSIS["pairs"],
            transcript_features=TRANSCRIPT_ANALYSIS["features"],
            module="salary",
        )

        self.assertGreater(parsed["question_evaluations"][0]["score"], 52)

    def test_essential_gap_and_professional_red_flag_cap_polished_scores(self):
        gap_payload = valid_evaluation_payload()
        gap_payload["question_evaluations"][0]["essential_gap"] = True
        gap_payload["question_evaluations"][0]["essential_gap_reason"] = "No concrete example or outcome."
        gap_payload["question_evaluations"][0]["competency_scores"] = competency_scores(90)
        red_flag_payload = valid_evaluation_payload()
        red_flag_payload["question_evaluations"][0]["professional_red_flag"] = True
        red_flag_payload["question_evaluations"][0]["professional_red_flag_reason"] = "Advocates coercive behavior."
        red_flag_payload["question_evaluations"][0]["competency_scores"] = competency_scores(
            90,
            role_alignment=30,
            adaptability=30,
        )

        gap = parse_payload(gap_payload)
        red_flag = parse_payload(red_flag_payload)

        self.assertEqual(gap["question_evaluations"][0]["score"], 52)
        self.assertEqual(red_flag["question_evaluations"][0]["score"], 35)

    def test_professional_red_flag_without_supporting_scores_is_cleared(self):
        payload = valid_evaluation_payload()
        payload["question_evaluations"][0]["professional_red_flag"] = True
        payload["question_evaluations"][0]["professional_red_flag_reason"] = (
            "The candidate may be overly focused on technical metrics."
        )
        payload["question_evaluations"][0]["competency_scores"] = competency_scores(90)

        parsed = parse_payload(payload)
        item = parsed["question_evaluations"][0]

        self.assertGreater(item["score"], 35)
        self.assertFalse(item["professional_red_flag"])
        self.assertEqual(item["professional_red_flag_reason"], "")

    def test_technical_output_missing_per_question_module_scores_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "module_scores mismatch"):
            parse_evaluation_response(
                json.dumps(valid_evaluation_payload()),
                transcript_pairs=TRANSCRIPT_ANALYSIS["pairs"],
                transcript_features=TRANSCRIPT_ANALYSIS["features"],
                module="technical",
            )

    def test_missing_question_evaluation_is_rejected_for_repair(self):
        messages = [
            {"role": "assistant", "content": "First question"},
            {"role": "user", "content": "First answer"},
            {"role": "assistant", "content": "Second question"},
            {"role": "user", "content": "Second answer"},
        ]
        analysis = build_transcript_analysis(messages)

        with self.assertRaisesRegex(ValueError, "count mismatch"):
            parse_evaluation_response(
                json.dumps(valid_evaluation_payload()),
                transcript_pairs=analysis["pairs"],
                transcript_features=analysis["features"],
            )

    def test_prompt_contains_session_calibration_without_scoring_persona(self):
        prompt = build_evaluation_prompt(
            target_role="Senior Engineer",
            module="technical",
            difficulty="hard",
            duration="quick",
            industry="software",
            interviewer_style="stress",
            faang_mode=True,
            interruptions_enabled=True,
            transcript_features={"question_count": 2},
        )

        self.assertIn('"difficulty": "hard"', prompt)
        self.assertIn('"industry": "software"', prompt)
        self.assertIn("Interviewer style controls delivery, not the hiring bar", prompt)
        self.assertIn("technical_accuracy", prompt)
        self.assertIn("A long answer is not automatically specific", prompt)
        self.assertIn("exactly 2 supplied question-answer pairs", prompt)

    def test_structured_output_schema_enforces_pair_count_and_module_scores(self):
        schema = build_evaluation_output_schema("technical", question_count=4)
        question_array = schema["properties"]["question_evaluations"]
        question_schema = question_array["items"]

        self.assertEqual(question_array["minItems"], 4)
        self.assertEqual(question_array["maxItems"], 4)
        self.assertEqual(
            question_schema["properties"]["module_scores"]["required"],
            ["problem_solving", "technical_accuracy", "thought_process"],
        )
        self.assertIn("critical_error", question_schema["required"])
        self.assertIn("essential_gap", question_schema["required"])
        self.assertIn("professional_red_flag", question_schema["required"])

    def test_recovery_schema_uses_required_named_questions_instead_of_array_cardinality(self):
        schema = build_evaluation_recovery_schema("technical", question_count=2)

        self.assertEqual(schema["required"], ["question_1", "question_2"])
        self.assertNotIn("question_evaluations", schema["properties"])
        self.assertEqual(
            schema["properties"]["question_1"]["properties"]["module_scores"]["required"],
            ["problem_solving", "technical_accuracy", "thought_process"],
        )

    def test_named_question_recovery_rebuilds_valid_feedback(self):
        item = valid_evaluation_payload()["question_evaluations"][0]
        recovered = parse_evaluation_recovery_response(
            json.dumps({"question_1": item}),
            transcript_pairs=TRANSCRIPT_ANALYSIS["pairs"],
            transcript_features=TRANSCRIPT_ANALYSIS["features"],
            module="general",
            base_raw="[]",
        )

        self.assertEqual(len(recovered["question_evaluations"]), 1)
        self.assertEqual(recovered["question_evaluations"][0]["question"], TRANSCRIPT_MESSAGES[0]["content"])
        self.assertEqual(recovered["transcript_features"]["evaluation_coverage"], 1.0)

    def test_generation_budget_scales_for_extended_sessions(self):
        quick = build_evaluation_generation_options(5)
        extended = build_evaluation_generation_options(20)

        self.assertEqual(quick["temperature"], 0)
        self.assertGreater(extended["num_predict"], quick["num_predict"])
        self.assertEqual(extended["num_predict"], 5200)
        self.assertEqual(evaluation_timeout_seconds(2), 120)
        self.assertEqual(evaluation_timeout_seconds(20), 420)

    def test_shortened_model_question_matches_by_required_output_order(self):
        payload = valid_evaluation_payload()
        payload["question_evaluations"][0]["question"] = "Difficult project?"

        parsed = parse_payload(payload)

        self.assertEqual(
            parsed["question_evaluations"][0]["question"],
            "Tell me about a difficult project.",
        )
        self.assertEqual(parsed["transcript_features"]["evaluation_coverage"], 1.0)

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


class TranscriptAnalysisTests(unittest.TestCase):
    def test_structured_question_text_excludes_acknowledgement_from_scoring_pair(self):
        analysis = build_transcript_analysis([
            {
                "role": "assistant",
                "content": "That makes sense. What changed after your decision?",
                "questionText": "What changed after your decision?",
            },
            {"role": "user", "content": "Conversion improved by twelve percent."},
        ])

        self.assertEqual(analysis["pairs"][0]["question"], "What changed after your decision?")

    def test_orchestrator_closing_message_is_not_an_unanswered_question(self):
        analysis = build_transcript_analysis([
            {"role": "assistant", "content": "Tell me about a difficult launch.", "timestamp": 1000},
            {"role": "user", "content": "I cut scope and shipped on time.", "timestamp": 5000},
            {
                "role": "assistant",
                "content": "That concludes the rehearsal. Thank you.",
                "isClosing": True,
                "timestamp": 6000,
            },
        ])

        self.assertEqual(len(analysis["pairs"]), 1)
        self.assertEqual(analysis["pairs"][0]["answer"], "I cut scope and shipped on time.")

    def test_interruption_does_not_replace_pending_question(self):
        analysis = build_transcript_analysis([
            {"role": "assistant", "content": "Describe a difficult launch.", "timestamp": 1000},
            {
                "role": "assistant",
                "content": "Please get to the decision.",
                "isInterruption": True,
                "timestamp": 3000,
            },
            {"role": "user", "content": "I cut scope and shipped on time.", "timestamp": 9000},
        ])

        self.assertEqual(len(analysis["pairs"]), 1)
        self.assertEqual(analysis["pairs"][0]["question"], "Describe a difficult launch.")
        self.assertEqual(analysis["pairs"][0]["interruptions"], ["Please get to the decision."])
        self.assertTrue(analysis["pairs"][0]["is_interruption"])

    def test_consecutive_questions_preserve_the_unanswered_turn(self):
        analysis = build_transcript_analysis([
            {"role": "assistant", "content": "First question", "timestamp": 1000},
            {"role": "assistant", "content": "Second question", "timestamp": 2000},
            {"role": "user", "content": "Second answer", "timestamp": 5000},
        ])

        self.assertEqual([pair["question"] for pair in analysis["pairs"]], ["First question", "Second question"])
        self.assertEqual(analysis["pairs"][0]["answer_type"], "missing")
        self.assertEqual(analysis["pairs"][1]["answer"], "Second answer")

    def test_candidate_ready_timestamp_excludes_ai_latency(self):
        analysis = build_transcript_analysis([
            {
                "role": "assistant",
                "content": "Question",
                "timestamp": 1000,
                "answerReadyTimestamp": 9000,
            },
            {
                "role": "user",
                "content": "Answer",
                "responseStartedTimestamp": 9000,
                "timestamp": 14000,
            },
        ])

        self.assertEqual(analysis["pairs"][0]["response_seconds"], 5.0)


class ScoreMergeTests(unittest.TestCase):
    @staticmethod
    def scored_feedback(score=75, **overrides):
        payload = valid_evaluation_payload(competency_scores=competency_scores(score), **overrides)
        for item in payload["question_evaluations"]:
            item["score"] = score
            item["competency_scores"] = competency_scores(score)
        payload["transcript_features"] = {
            "answer_count": 2,
            "evaluation_coverage": 1.0,
        }
        return payload

    def test_interview_only(self):
        feedback = self.scored_feedback(75)

        merged = merge_scores(feedback)

        self.assertEqual(merged["overall_score"], 75)
        self.assertEqual(merged["pillars"]["interview"]["weight"], 1.0)
        self.assertEqual(merged["readiness"]["level"], "near_ready")

    def test_interview_and_engagement(self):
        feedback = self.scored_feedback(75)

        merged = merge_scores(feedback, engagement_data={"composite": 85})

        self.assertEqual(merged["overall_score"], 75)
        self.assertEqual(merged["pillars"]["engagement"]["weight"], 0.0)
        self.assertFalse(merged["pillars"]["engagement"]["contributes_to_overall"])

    def test_interview_presence_and_engagement(self):
        feedback = self.scored_feedback(80)

        merged = merge_scores(
            feedback,
            presence_data={"composite": 60},
            engagement_data={"composite": 90},
            camera_on=True,
        )

        self.assertEqual(merged["overall_score"], 80)
        self.assertEqual(merged["pillars"]["presence"]["weight"], 0.0)
        self.assertFalse(merged["pillars"]["presence"]["contributes_to_overall"])

    def test_module_scores_do_not_bypass_question_derived_score(self):
        feedback = self.scored_feedback(
            80,
            module_scores={"technical_accuracy": 60, "problem_solving": 60},
        )

        merged = merge_scores(feedback)

        self.assertEqual(merged["pillars"]["interview"]["score"], 80)
        self.assertEqual(merged["overall_score"], 80)

    def test_too_few_answers_returns_insufficient_evidence(self):
        feedback = self.scored_feedback(92)
        feedback["transcript_features"]["answer_count"] = 1

        merged = merge_scores(feedback)

        self.assertIsNone(merged["overall_score"])
        self.assertEqual(merged["evaluation_status"], "insufficient_evidence")
        self.assertEqual(merged["readiness"]["level"], "insufficient_evidence")
        self.assertEqual(merged["readiness"]["hire_signal"], "no_signal")


if __name__ == "__main__":
    unittest.main()
