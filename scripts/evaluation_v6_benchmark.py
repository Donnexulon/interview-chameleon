"""Run the deterministic categorical V6 evaluator benchmark, including its focused verifier."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.evaluation_benchmark import (  # noqa: E402
    DEFAULT_CASES,
    build_release_case_matrix,
    identity_invariance_checks,
    load_cases,
    ordering_checks,
    summarize_case,
    validate_case,
    variance_checks,
)
from services.evaluation import (  # noqa: E402
    build_evaluation_context,
    build_evaluation_generation_options,
    build_transcript_analysis,
    evaluation_timeout_seconds,
    merge_scores,
)
from services.evaluation_v6 import (  # noqa: E402
    EVALUATION_VERSION,
    MODEL_COLD_START,
    MODEL_KEEP_ALIVE,
    PROMPT_VERSION,
    RUBRIC_VERSION,
    SCORING_ENGINE_VERSION,
    apply_verifications,
    attach_confidence,
    build_evaluation_output_schema,
    build_evaluation_prompt,
    build_recovery_prompt,
    build_recovery_schema,
    build_repair_prompt,
    build_verifier_prompt,
    build_verifier_schema,
    identify_verifier_targets,
    parse_evaluation_response,
    parse_recovery_response,
    parse_verifier_response,
)
from services.ollama_client import ACTIVE_MODEL, OllamaClient  # noqa: E402


def case_matrix_digest(cases: list[dict[str, Any]]) -> str:
    canonical = json.dumps(cases, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def evaluate_once(client: OllamaClient, model: str, case: dict[str, Any]) -> dict[str, Any]:
    settings = dict(case.get("settings") or {})
    analysis = build_transcript_analysis(case["messages"])
    context = build_evaluation_context(
        target_role=case["target_role"],
        module=case["module"],
        **settings,
    )
    prompt = build_evaluation_prompt(
        target_role=case["target_role"],
        module=case["module"],
        evaluation_context=context,
        job_description=case.get("job_description", ""),
    )
    generation_options = build_evaluation_generation_options(len(analysis["pairs"]))
    generation_timeout = evaluation_timeout_seconds(len(analysis["pairs"]))
    messages = [{
        "role": "user",
        "content": "Assess with categorical rubric bands only.\n\n" + json.dumps(analysis, indent=2),
    }]
    started = time.perf_counter()
    raw = client.generate_json(
        model=model,
        messages=messages,
        system_prompt=prompt,
        options=generation_options,
        format_schema=build_evaluation_output_schema(case["module"], len(analysis["pairs"])),
        timeout_seconds=generation_timeout,
        keep_alive=MODEL_KEEP_ALIVE,
        cold_start=MODEL_COLD_START,
    )
    attempts = 1
    repair_used = False
    recovery_used = False
    try:
        feedback = parse_evaluation_response(
            raw,
            transcript_pairs=analysis["pairs"],
            transcript_features=analysis["features"],
            module=case["module"],
        )
    except Exception as first_error:
        attempts = 2
        repair_used = True
        repaired = client.generate_json(
            model=model,
            messages=[{
                "role": "user",
                "content": (
                    f"Validation error:\n{first_error}\n\nTranscript:\n{json.dumps(analysis, indent=2)}"
                    f"\n\nInvalid output:\n{raw}"
                ),
            }],
            system_prompt=build_repair_prompt(case["module"], len(analysis["pairs"])),
            options=generation_options,
            format_schema=build_evaluation_output_schema(case["module"], len(analysis["pairs"])),
            timeout_seconds=generation_timeout,
            keep_alive=MODEL_KEEP_ALIVE,
            cold_start=MODEL_COLD_START,
        )
        try:
            feedback = parse_evaluation_response(
                repaired,
                transcript_pairs=analysis["pairs"],
                transcript_features=analysis["features"],
                module=case["module"],
            )
        except Exception:
            attempts = 3
            recovery_used = True
            recovery = client.generate_json(
                model=model,
                messages=[{"role": "user", "content": json.dumps(analysis, indent=2)}],
                system_prompt=build_recovery_prompt(case["module"], len(analysis["pairs"])),
                options=generation_options,
                format_schema=build_recovery_schema(case["module"], len(analysis["pairs"])),
                timeout_seconds=generation_timeout,
                keep_alive=MODEL_KEEP_ALIVE,
                cold_start=MODEL_COLD_START,
            )
            feedback = parse_recovery_response(
                recovery,
                transcript_pairs=analysis["pairs"],
                transcript_features=analysis["features"],
                module=case["module"],
                base_raw=repaired,
            )

    targets = identify_verifier_targets(feedback, analysis["pairs"], case["module"])
    verifier_valid = False
    if targets:
        raw_verifier = client.generate_json(
            model=model,
            messages=[{"role": "user", "content": build_verifier_prompt(case["module"], targets)}],
            system_prompt="Verify correctness only and return strict JSON.",
            options={"temperature": 0, "seed": 97, "num_predict": 700},
            format_schema=build_verifier_schema(len(targets)),
            timeout_seconds=min(180, generation_timeout),
            keep_alive=MODEL_KEEP_ALIVE,
            cold_start=MODEL_COLD_START,
        )
        verifications = parse_verifier_response(raw_verifier, targets=targets, pairs=analysis["pairs"])
        feedback = apply_verifications(feedback, verifications, module=case["module"], targets=targets)
        verifier_valid = True
    feedback = attach_confidence(feedback, verifier_requested=bool(targets), verifier_valid=verifier_valid)
    merged = merge_scores(feedback, camera_on=False, evaluation_context=context)
    public_score = merged.get("overall_score")
    if public_score is None:
        question_scores = [int(item.get("score", 0)) for item in merged.get("question_evaluations", [])]
        if not question_scores:
            raise ValueError("Evaluator returned no scored question evidence")
        public_score = round(sum(question_scores) / len(question_scores))
    return {
        "evaluation_version": EVALUATION_VERSION,
        "score": int(public_score),
        "evaluator_confidence": int(merged.get("evaluator_confidence", 0)),
        "elapsed_seconds": round(time.perf_counter() - started, 2),
        "attempts": attempts,
        "repair_used": repair_used,
        "focused_recovery_used": recovery_used,
        "verifier_invoked": bool(targets),
        "verifier_valid": verifier_valid,
        "question_scores": [item["score"] for item in merged.get("question_evaluations", [])],
        "question_diagnostics": [{
            "score": item.get("score"),
            "rubric_band": item.get("rubric_band"),
            "answer_type": item.get("answer_type"),
            "correctness": item.get("correctness"),
            "dimension_bands": (item.get("rubric_assessment") or {}).get("dimension_bands", {}),
            "module_bands": (item.get("rubric_assessment") or {}).get("module_bands", {}),
            "limiting_rule": item.get("limiting_rule"),
            "verifier": item.get("verifier"),
            "confidence": item.get("confidence"),
            "evidence_quotes": item.get("evidence_quotes", []),
        } for item in merged.get("question_evaluations", [])],
        "module_scores": merged.get("module_scores", {}),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    parser.add_argument("--case", action="append", dest="case_ids")
    parser.add_argument("--model", default=ACTIVE_MODEL)
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--minimum-gap", type=int, default=20)
    parser.add_argument("--max-score-range", type=int, default=3)
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume completed run numbers from --output and checkpoint after every attempt",
    )
    parser.add_argument("--strict", action="store_true")
    return parser.parse_args()


def build_report(
    *,
    cases: list[dict[str, Any]],
    results: list[dict[str, Any]],
    errors: list[dict[str, Any]],
    model: str,
    model_digest: str,
    runs_per_case: int,
    minimum_gap: int,
    max_score_range: int,
) -> dict[str, Any]:
    """Build a useful report for both in-progress checkpoints and final gates."""
    result_by_id = {item["id"]: item for item in results}
    attempts_by_case: dict[str, set[int]] = {
        str(case["id"]): {
            int(run.get("run_number", index + 1))
            for index, run in enumerate(result_by_id.get(str(case["id"]), {}).get("runs", []))
        }
        for case in cases
    }
    for error in errors:
        if str(error.get("id")) in attempts_by_case:
            attempts_by_case[str(error["id"])].add(int(error.get("run", 0)))

    expected_run_numbers = set(range(1, runs_per_case + 1))
    completed_attempts = sum(len(numbers & expected_run_numbers) for numbers in attempts_by_case.values())
    expected_attempts = len(cases) * runs_per_case
    complete = all(numbers >= expected_run_numbers for numbers in attempts_by_case.values())

    for result in results:
        attempted = attempts_by_case.get(str(result["id"]), set())
        result["runs_expected"] = runs_per_case
        result["attempts_completed"] = len(attempted & expected_run_numbers)
        result["complete"] = attempted >= expected_run_numbers

    completed_results = [item for item in results if item.get("complete")]
    ordering = ordering_checks(completed_results, minimum_gap)
    variance = variance_checks(completed_results, max_score_range)
    identity = identity_invariance_checks(cases, completed_results, max_difference=3)
    range_failures = [item["id"] for item in completed_results if not item["range_pass"]]
    ordering_failures = [item["comparison_group"] for item in ordering if not item["pass"]]
    variance_failures = [item["id"] for item in variance if not item["pass"]]
    identity_failures = [item["identity_group"] for item in identity if not item["pass"]]
    passed = (
        complete
        and not errors
        and not range_failures
        and not ordering_failures
        and not variance_failures
        and not identity_failures
    )
    return {
        "evaluation_version": EVALUATION_VERSION,
        "scoring_engine_version": SCORING_ENGINE_VERSION,
        "rubric_version": RUBRIC_VERSION,
        "prompt_version": PROMPT_VERSION,
        "model_keep_alive": MODEL_KEEP_ALIVE,
        "model_cold_start": MODEL_COLD_START,
        "model": model,
        "model_digest": model_digest,
        "runs_per_case": runs_per_case,
        "case_count": len(cases),
        "case_ids": [case["id"] for case in cases],
        "case_matrix_digest": case_matrix_digest(cases),
        "case_results": results,
        "ordering_checks": ordering,
        "variance_checks": variance,
        "identity_invariance_checks": identity,
        "evidence_grounding": {
            "required": 100,
            "passed": complete and not errors,
            "note": "Every accepted evidence quote is exact-match validated against its paired answer.",
        },
        "errors": errors,
        "progress": {
            "complete": complete,
            "completed_attempts": completed_attempts,
            "expected_attempts": expected_attempts,
        },
        "summary": {
            "range_failures": range_failures,
            "ordering_failures": ordering_failures,
            "variance_failures": variance_failures,
            "identity_invariance_failures": identity_failures,
            "error_count": len(errors),
            "passed": passed,
        },
    }


def write_report(path: Path, report: dict[str, Any]) -> None:
    """Atomically checkpoint a report so interruption cannot leave invalid JSON."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def load_resumable_report(
    path: Path,
    *,
    cases: list[dict[str, Any]],
    model: str,
    model_digest: str,
    runs_per_case: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not path.exists():
        return [], []
    report = json.loads(path.read_text(encoding="utf-8"))
    expected = {
        "evaluation_version": EVALUATION_VERSION,
        "scoring_engine_version": SCORING_ENGINE_VERSION,
        "rubric_version": RUBRIC_VERSION,
        "prompt_version": PROMPT_VERSION,
        "model_keep_alive": MODEL_KEEP_ALIVE,
        "model_cold_start": MODEL_COLD_START,
        "model": model,
        "model_digest": model_digest,
        "runs_per_case": runs_per_case,
        "case_ids": [case["id"] for case in cases],
        "case_matrix_digest": case_matrix_digest(cases),
    }
    mismatches = [key for key, value in expected.items() if report.get(key) != value]
    if mismatches:
        raise SystemExit(
            "Cannot resume an incompatible evaluator report; mismatched: " + ", ".join(mismatches)
        )
    return list(report.get("case_results") or []), list(report.get("errors") or [])


def main() -> int:
    args = parse_args()
    if args.runs < 1:
        raise SystemExit("--runs must be at least 1")
    if args.resume and not args.output:
        raise SystemExit("--resume requires --output")
    cases = build_release_case_matrix(load_cases(args.cases))
    for case in cases:
        validate_case(case)
    if args.case_ids:
        selected = set(args.case_ids)
        cases = [case for case in cases if case["id"] in selected]
        missing = selected - {case["id"] for case in cases}
        if missing:
            raise SystemExit(f"Unknown case id(s): {', '.join(sorted(missing))}")

    client = OllamaClient()
    if not client.check_connection():
        raise SystemExit("Ollama is not reachable at http://localhost:11434")
    if not client.is_model_available(args.model):
        raise SystemExit(f"Model {args.model!r} is not installed in Ollama")
    model_digest = client.model_digest(args.model)
    if not model_digest or model_digest == "unknown":
        raise SystemExit(f"Could not resolve the installed digest for model {args.model!r}")

    if args.resume:
        results, errors = load_resumable_report(
            args.output,
            cases=cases,
            model=args.model,
            model_digest=model_digest,
            runs_per_case=args.runs,
        )
    else:
        results, errors = [], []
    result_by_id = {item["id"]: item for item in results}
    for case in cases:
        existing = result_by_id.get(case["id"], {})
        runs = list(existing.get("runs") or [])
        completed_run_numbers = {
            int(run.get("run_number", index + 1)) for index, run in enumerate(runs)
        }
        completed_run_numbers.update(
            int(error.get("run", 0)) for error in errors if error.get("id") == case["id"]
        )
        for run_number in range(1, args.runs + 1):
            if run_number in completed_run_numbers:
                continue
            try:
                run = evaluate_once(client, args.model, case)
                run["run_number"] = run_number
                runs.append(run)
                print(
                    f"{case['id']} run {run_number}/{args.runs}: score={run['score']} "
                    f"verifier={run['verifier_invoked']} ({run['elapsed_seconds']}s)",
                    flush=True,
                )
            except Exception as exc:
                errors.append({"id": case["id"], "run": run_number, "error": str(exc)})
                print(f"{case['id']} run {run_number}/{args.runs}: ERROR {exc}", flush=True)
            summarized = summarize_case(case, runs) if runs else None
            if summarized:
                if case["id"] in result_by_id:
                    results[results.index(result_by_id[case["id"]])] = summarized
                else:
                    results.append(summarized)
                result_by_id[case["id"]] = summarized
            if args.output:
                write_report(args.output, build_report(
                    cases=cases,
                    results=results,
                    errors=errors,
                    model=args.model,
                    model_digest=model_digest,
                    runs_per_case=args.runs,
                    minimum_gap=args.minimum_gap,
                    max_score_range=args.max_score_range,
                ))
        if runs:
            summarized = summarize_case(case, runs)
            if case["id"] in result_by_id:
                results[results.index(result_by_id[case["id"]])] = summarized
            else:
                results.append(summarized)
            result_by_id[case["id"]] = summarized

    report = build_report(
        cases=cases,
        results=results,
        errors=errors,
        model=args.model,
        model_digest=model_digest,
        runs_per_case=args.runs,
        minimum_gap=args.minimum_gap,
        max_score_range=args.max_score_range,
    )
    rendered = json.dumps(report, indent=2) + "\n"
    if args.output:
        write_report(args.output, report)
        print(f"Wrote {args.output}")
    else:
        print(rendered, end="")
    return 1 if args.strict and not report["summary"]["passed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
