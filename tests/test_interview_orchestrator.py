import unittest

from services.interview_orchestrator import (
    ORCHESTRATION_VERSION,
    build_interview_plan,
    choose_next_turn,
    compact_messages_for_generation,
    validate_generated_turn,
)


def config(**overrides):
    values = {
        "target_role": "Senior Product Manager",
        "module": "general",
        "difficulty": "medium",
        "duration": "standard",
        "industry": "software",
        "interviewer_style": "friendly",
        "faang_mode": False,
        "interruptions_enabled": False,
    }
    values.update(overrides)
    return values


def question_message(directive, text=None):
    return {
        "role": "assistant",
        "content": text or directive["fallback_question"],
        "orchestration": directive,
    }


STRONG_ANSWER = (
    "I led the decision because our conversion rate had fallen 18 percent over six weeks. "
    "I analyzed the funnel, interviewed twelve customers, and prioritized the checkout failure. "
    "We shipped a smaller fix first because the full redesign carried delivery risk, and the result "
    "was a 14 percent conversion improvement and two fewer support tickets per hundred orders."
)


class InterviewOrchestratorTests(unittest.TestCase):
    def test_every_module_has_twenty_unique_valid_fallbacks(self):
        for module in ["general", "roleplay", "visual", "technical", "casestudy", "salary"]:
            with self.subTest(module=module):
                plan = build_interview_plan(config(module=module, duration="extended"))
                fallbacks = [entry["fallback_question"] for entry in plan["entries"]]
                self.assertEqual(len(fallbacks), 20)
                self.assertEqual(len(set(fallbacks)), 20)
                self.assertTrue(all(question.count("?") == 1 and question.endswith("?") for question in fallbacks))

    def test_plan_is_deterministic_and_respects_duration(self):
        first = build_interview_plan(config(duration="quick", module="technical"))
        second = build_interview_plan(config(duration="quick", module="technical"))

        self.assertEqual(first, second)
        self.assertEqual(first["version"], ORCHESTRATION_VERSION)
        self.assertEqual(first["target_questions"], 5)
        self.assertEqual(len(first["entries"]), 5)
        self.assertTrue(all(entry["competency"] in {"technical_accuracy", "problem_solving", "thought_process"} for entry in first["entries"]))

    def test_first_turn_is_a_planned_main_question(self):
        directive = choose_next_turn(config(), [])

        self.assertFalse(directive["complete"])
        self.assertEqual(directive["turn_number"], 1)
        self.assertEqual(directive["turn_type"], "main")
        self.assertTrue(directive["competency"])
        self.assertTrue(directive["fallback_question"].endswith("?"))

    def test_weak_answer_gets_one_targeted_follow_up(self):
        first = choose_next_turn(config(), [])
        messages = [question_message(first), {"role": "user", "content": "We worked together and it went fine."}]

        follow_up = choose_next_turn(config(), messages)

        self.assertEqual(follow_up["turn_type"], "follow_up")
        self.assertEqual(follow_up["plan_index"], first["plan_index"])
        self.assertTrue(follow_up["follow_up_focus"])

    def test_strong_answer_advances_to_unused_plan_entry(self):
        first = choose_next_turn(config(), [])
        messages = [question_message(first), {"role": "user", "content": STRONG_ANSWER}]

        second = choose_next_turn(config(), messages)

        self.assertEqual(second["turn_type"], "main")
        self.assertNotEqual(second["plan_index"], first["plan_index"])

    def test_pressure_curveball_uses_a_deterministic_slot(self):
        hard_config = config(difficulty="hard")
        plan = build_interview_plan(hard_config)
        curveball_slot = plan["curveball_slots"][0]
        messages = []
        for _ in range(curveball_slot - 1):
            directive = choose_next_turn(hard_config, messages)
            messages.extend([question_message(directive), {"role": "user", "content": STRONG_ANSWER}])

        curveball = choose_next_turn(hard_config, messages)

        self.assertEqual(curveball["turn_number"], curveball_slot)
        self.assertEqual(curveball["turn_type"], "curveball")
        self.assertIn("ambiguity", curveball["objective"])
        self.assertIn("constraint", curveball["fallback_question"])

    def test_session_closes_at_exact_question_target(self):
        quick_config = config(duration="quick")
        messages = []
        for _ in range(5):
            directive = choose_next_turn(quick_config, messages)
            messages.extend([question_message(directive), {"role": "user", "content": STRONG_ANSWER}])

        closing = choose_next_turn(quick_config, messages)

        self.assertTrue(closing["complete"])
        self.assertEqual(closing["turn_type"], "closing")
        self.assertEqual(closing["remaining_questions"], 0)

    def test_generated_question_rejects_duplicates_and_multi_questions(self):
        directive = choose_next_turn(config(), [])
        duplicate = {"acknowledgement": "", "question": "Why does this Senior Product Manager opportunity make sense for you now?"}
        valid, warning = validate_generated_turn(duplicate, directive, [duplicate["question"]])
        self.assertFalse(valid)
        self.assertIn("repeats", warning)

        multi = {"acknowledgement": "", "question": "What happened? What did you do?"}
        valid, warning = validate_generated_turn(multi, directive, [])
        self.assertFalse(valid)
        self.assertIn("exactly one", warning)

    def test_generation_context_is_bounded_and_drops_ui_noise(self):
        messages = [{"role": "user", "content": f"answer {index}"} for index in range(15)]
        messages.extend([
            {"role": "assistant", "content": "typing", "isTyping": True},
            {"role": "assistant", "content": "closing", "isClosing": True},
            {"role": "assistant", "content": "nudge", "isNudge": True},
        ])

        compact = compact_messages_for_generation(messages)

        self.assertEqual(len(compact), 12)
        self.assertEqual(compact[0]["content"], "answer 3")
        self.assertEqual(compact[-1]["content"], "answer 14")


if __name__ == "__main__":
    unittest.main()
