import unittest

from fastapi.testclient import TestClient

import main as app_main
from services.evaluation import build_evaluation_prompt
from services.interview_orchestrator import build_interview_plan, build_turn_system_prompt, choose_next_turn
from services.role_intelligence import (
    ROLE_INTELLIGENCE_VERSION,
    analyze_role_context,
    compact_role_context,
)


JOB_DESCRIPTION = """
We are hiring a Senior Product Manager.
You must own product strategy and the roadmap, lead cross-functional stakeholders, and run A/B testing.
Use customer research and measurable outcomes to prioritize investments.
Five years of relevant experience are required.
SQL is preferred.
"""

RESUME = """
Taylor Morgan
taylor@example.com | +1 555 555 0100 | linkedin.com/in/taylor
Led a product roadmap and launched a checkout redesign that increased conversion by 18%.
Interviewed 24 customers and used the findings to prioritize three releases.
Managed a $2M portfolio and reduced delivery time by 21%.
"""


class RoleIntelligenceTests(unittest.TestCase):
    def test_extracts_role_requirements_resume_evidence_and_alignment(self):
        intelligence = analyze_role_context("Senior Product Manager", JOB_DESCRIPTION, RESUME)

        self.assertEqual(intelligence["version"], ROLE_INTELLIGENCE_VERSION)
        self.assertEqual(intelligence["status"], "job_and_resume")
        self.assertEqual(intelligence["job_profile"]["seniority"], "senior")
        self.assertEqual(intelligence["job_profile"]["minimum_years"], 5)
        self.assertIn("product strategy", intelligence["alignment"]["matched_skills"])
        self.assertIn("experimentation", intelligence["alignment"]["not_evidenced_skills"])
        self.assertIn("Not evidenced means", intelligence["alignment"]["interpretation"])
        self.assertGreater(len(intelligence["candidate_profile"]["evidence_highlights"]), 0)

    def test_contact_details_are_not_promoted_as_candidate_evidence(self):
        intelligence = analyze_role_context("Senior Product Manager", JOB_DESCRIPTION, RESUME)
        evidence = " ".join(
            item["text"] for item in intelligence["candidate_profile"]["evidence_highlights"]
        )

        self.assertNotIn("taylor@example.com", evidence)
        self.assertNotIn("linkedin.com", evidence)
        self.assertNotIn("555 555", evidence)

    def test_preferred_skills_rank_below_required_skills(self):
        intelligence = analyze_role_context("Senior Product Manager", JOB_DESCRIPTION, RESUME)
        skills = intelligence["job_profile"]["skills"]
        sql_skill = next(item for item in skills if item["name"] == "databases")

        self.assertEqual(sql_skill["importance"], "preferred")
        first_preferred = next(index for index, item in enumerate(skills) if item["importance"] == "preferred")
        self.assertTrue(all(item["importance"] == "required" for item in skills[:first_preferred]))

    def test_job_only_analysis_does_not_invent_candidate_gaps(self):
        intelligence = analyze_role_context("Backend Engineer", "Python and cloud infrastructure are required.", "")

        self.assertEqual(intelligence["status"], "job_only")
        self.assertEqual(intelligence["alignment"]["not_evidenced_skills"], [])
        self.assertIsNone(intelligence["alignment"]["skill_coverage_percent"])
        self.assertTrue(any(target["type"] == "requirement_skill" for target in intelligence["question_targets"]))

    def test_cached_result_is_returned_as_a_defensive_copy(self):
        first = analyze_role_context("Backend Engineer", "Python is required.", "Built Python services.")
        first["alignment"]["matched_skills"].append("mutated")
        second = analyze_role_context("Backend Engineer", "Python is required.", "Built Python services.")

        self.assertNotIn("mutated", second["alignment"]["matched_skills"])

    def test_compact_context_is_bounded_and_keeps_evidence_rule(self):
        compact = compact_role_context(analyze_role_context("Senior Product Manager", JOB_DESCRIPTION, RESUME))

        self.assertLessEqual(len(compact["question_targets"]), 8)
        self.assertLessEqual(len(compact["priority_requirements"]), 6)
        self.assertIn("never count as proof", compact["evidence_rule"])

    def test_role_targets_ground_the_plan_and_turn_prompt(self):
        intelligence = analyze_role_context("Senior Product Manager", JOB_DESCRIPTION, RESUME)
        config = {
            "target_role": "Senior Product Manager",
            "module": "general",
            "duration": "quick",
            "difficulty": "medium",
            "role_intelligence": intelligence,
        }
        plan = build_interview_plan(config)
        directive = choose_next_turn(config, [])
        prompt = build_turn_system_prompt("Base interviewer prompt", config, directive, [])

        self.assertIsNotNone(plan["entries"][0]["role_target"])
        self.assertIn(plan["entries"][0]["role_target"]["label"], plan["entries"][0]["objective"])
        self.assertIn("Structured role intelligence", prompt)
        self.assertIn("never claim the candidate lacks", prompt)

    def test_evaluator_uses_role_targets_but_keeps_transcript_authoritative(self):
        intelligence = analyze_role_context("Senior Product Manager", JOB_DESCRIPTION, RESUME)
        prompt = build_evaluation_prompt(
            target_role="Senior Product Manager",
            job_description=JOB_DESCRIPTION,
            transcript_features={"question_count": 1},
            role_intelligence=intelligence,
        )

        self.assertIn("role_intelligence", prompt)
        self.assertIn("only the interview answer is scorable evidence", prompt)
        self.assertIn("not_evidenced", prompt)


class RoleIntelligenceApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app_main.app)

    def test_role_intelligence_endpoint_is_local_and_structured(self):
        response = self.client.post("/api/role-intelligence", json={
            "target_role": "Senior Product Manager",
            "job_description": JOB_DESCRIPTION,
            "resume_text": RESUME,
        })

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["version"], ROLE_INTELLIGENCE_VERSION)
        self.assertTrue(body["job_profile"]["skills"])
        self.assertTrue(body["question_targets"])

    def test_plan_endpoint_includes_grounded_hiring_targets(self):
        response = self.client.post("/api/interview/plan", json={
            "target_role": "Senior Product Manager",
            "module": "general",
            "duration": "quick",
            "job_description": JOB_DESCRIPTION,
            "resume_text": RESUME,
        })

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["role_grounding"]["version"], ROLE_INTELLIGENCE_VERSION)
        self.assertTrue(body["entries"][0]["role_target"])


if __name__ == "__main__":
    unittest.main()
