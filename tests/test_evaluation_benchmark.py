import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from scripts.evaluation_benchmark import (
    DEFAULT_CASES,
    build_release_case_matrix,
    identity_invariance_checks,
    load_cases,
    ordering_checks,
    validate_case,
    variance_checks,
)
from services.evaluation import EVALUATION_GENERATION_OPTIONS
from services.ollama_client import OllamaClient
from scripts.evaluation_v6_benchmark import build_report, load_resumable_report, write_report


class EvaluationBenchmarkFixtureTests(unittest.TestCase):
    def test_fixture_covers_strong_and_weak_examples_for_every_module(self):
        cases = load_cases(DEFAULT_CASES)
        coverage = {}
        for case in cases:
            validate_case(case)
            coverage.setdefault(case["module"], set()).add(case["quality"])

        self.assertEqual(
            set(coverage),
            {"general", "roleplay", "visual", "technical", "casestudy", "salary"},
        )
        self.assertTrue(all(qualities == {"weak", "strong"} for qualities in coverage.values()))

    def test_release_matrix_covers_four_bands_for_every_module_and_adversarial_cases(self):
        cases = build_release_case_matrix(load_cases(DEFAULT_CASES))
        coverage = {}
        for case in cases:
            validate_case(case)
            coverage.setdefault(case["module"], set()).add(case["quality"])
        self.assertTrue(all(qualities == {"weak", "borderline", "mixed", "strong"} for qualities in coverage.values()))
        scenarios = {case.get("scenario") for case in cases}
        self.assertTrue({
            "incomplete", "contradictory", "irrelevant", "overly_brief",
            "technically_incorrect", "prompt_injection", "identity_invariance",
            "role_seniority_industry_difficulty",
        }.issubset(scenarios))
        salary_borderline = next(case for case in cases if case["id"] == "salary_analyst_borderline")
        salary_answers = [
            message["content"] for message in salary_borderline["messages"] if message["role"] == "user"
        ]
        self.assertTrue(all("go somewhere else" not in answer for answer in salary_answers))
        self.assertIn("not prepared a specific target or supporting achievement", salary_answers[0])
        self.assertIn("not decided which trade-off matters most or when I would walk away", salary_answers[1])

    def test_identity_invariance_gate_limits_irrelevant_name_difference(self):
        cases = [
            {"id": "a", "identity_group": "same-evidence"},
            {"id": "b", "identity_group": "same-evidence"},
        ]
        passing = identity_invariance_checks(cases, [
            {"id": "a", "mean_score": 81}, {"id": "b", "mean_score": 83},
        ])
        failing = identity_invariance_checks(cases, [
            {"id": "a", "mean_score": 81}, {"id": "b", "mean_score": 88},
        ])
        self.assertTrue(passing[0]["pass"])
        self.assertFalse(failing[0]["pass"])

    def test_ordering_check_requires_configured_gap(self):
        results = [
            {"comparison_group": "technical", "quality": "weak", "mean_score": 35},
            {"comparison_group": "technical", "quality": "strong", "mean_score": 72},
        ]

        checks = ordering_checks(results, minimum_gap=20)

        self.assertEqual(checks[0]["gap"], 37)
        self.assertTrue(checks[0]["pass"])

    def test_variance_check_flags_unstable_repeated_scores(self):
        checks = variance_checks([
            {"id": "stable", "scores": [78, 80, 79]},
            {"id": "unstable", "scores": [61, 73, 67]},
            {"id": "single", "scores": [82]},
        ], max_score_range=6)

        self.assertEqual([item["id"] for item in checks], ["stable", "unstable"])
        self.assertTrue(checks[0]["pass"])
        self.assertFalse(checks[1]["pass"])

    def test_v6_report_checkpoints_and_resumes_completed_run_numbers(self):
        cases = [{
            "id": "general_partial",
            "comparison_group": "general",
            "quality": "weak",
        }]
        results = [{
            "id": "general_partial",
            "comparison_group": "general",
            "quality": "weak",
            "expected_score": {"min": 0, "max": 60},
            "scores": [42],
            "mean_score": 42,
            "score_range": 0,
            "range_pass": True,
            "runs": [{"run_number": 1, "score": 42}],
        }]
        report = build_report(
            cases=cases,
            results=results,
            errors=[],
            model="qwen2.5:7b",
            model_digest="sha256:test-model",
            runs_per_case=3,
            minimum_gap=20,
            max_score_range=3,
        )

        self.assertFalse(report["progress"]["complete"])
        self.assertEqual(report["progress"]["completed_attempts"], 1)
        self.assertFalse(report["summary"]["passed"])

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "checkpoint.json"
            write_report(output, report)
            loaded_results, loaded_errors = load_resumable_report(
                output,
                cases=cases,
                model="qwen2.5:7b",
                model_digest="sha256:test-model",
                runs_per_case=3,
            )
            self.assertEqual(loaded_results[0]["runs"][0]["run_number"], 1)
            self.assertEqual(loaded_errors, [])
            self.assertFalse(output.with_name(output.name + ".tmp").exists())

            changed_cases = [{**cases[0], "quality": "borderline"}]
            with self.assertRaises(SystemExit):
                load_resumable_report(
                    output,
                    cases=changed_cases,
                    model="qwen2.5:7b",
                    model_digest="sha256:test-model",
                    runs_per_case=3,
                )


class OllamaEvaluationOptionsTests(unittest.TestCase):
    @patch("services.ollama_client.requests.get")
    @patch("services.ollama_client.requests.post")
    def test_json_generation_sends_evaluator_options(self, post, get):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"message": {"content": json.dumps({"ok": True})}}
        post.return_value = response
        residency = Mock()
        residency.raise_for_status.return_value = None
        residency.json.return_value = {"models": [{"name": "qwen2.5:7b"}]}
        get.return_value = residency
        client = OllamaClient()

        client.generate_json(
            "qwen2.5:7b",
            [{"role": "user", "content": "test"}],
            options=EVALUATION_GENERATION_OPTIONS,
            keep_alive=0,
            cold_start=True,
        )

        self.assertEqual(post.call_count, 2)
        unload_payload = post.call_args_list[0].kwargs["json"]
        payload = post.call_args_list[1].kwargs["json"]
        self.assertEqual(unload_payload, {"model": "qwen2.5:7b", "stream": False, "keep_alive": 0})
        self.assertEqual(payload["options"]["temperature"], 0)
        self.assertEqual(payload["options"]["seed"], 42)
        self.assertEqual(payload["format"], "json")
        self.assertEqual(payload["keep_alive"], 0)
        self.assertEqual(post.call_args.kwargs["timeout"], 120)


if __name__ == "__main__":
    unittest.main()
