"""Evaluate exported calibration cases with V6 and write candidate regression results."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.evaluation_v6_benchmark import evaluate_once  # noqa: E402
from services.evaluation_v6 import (  # noqa: E402
    EVALUATION_VERSION,
    PROMPT_VERSION,
    RUBRIC_VERSION,
    SCORING_ENGINE_VERSION,
)
from services.ollama_client import ACTIVE_MODEL, OllamaClient  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--calibration", type=Path, required=True)
    parser.add_argument("--model", default=ACTIVE_MODEL)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    exported = json.loads(args.calibration.read_text(encoding="utf-8"))
    cases = exported.get("cases") or []
    if not cases:
        raise SystemExit("Calibration export contains no cases")
    client = OllamaClient()
    if not client.check_connection():
        raise SystemExit("Ollama is not reachable at http://localhost:11434")
    if not client.is_model_available(args.model):
        raise SystemExit(f"Model {args.model!r} is not installed in Ollama")
    model_digest = client.model_digest(args.model)

    results = {}
    errors = []
    for item in cases:
        case_id = str(item.get("id") or "")
        benchmark_case = {
            "id": case_id,
            "target_role": item.get("target_role") or "General Candidate",
            "module": item.get("module") or "general",
            "job_description": "",
            "settings": {},
            "messages": [
                {"role": "assistant", "content": item.get("question") or "Candidate response"},
                {"role": "user", "content": item.get("answer") or ""},
            ],
        }
        try:
            run = evaluate_once(client, args.model, benchmark_case)
            question = (run.get("question_diagnostics") or [{}])[0]
            results[case_id] = {
                "evaluation_version": EVALUATION_VERSION,
                "model_digest": model_digest,
                "rubric_version": RUBRIC_VERSION,
                "prompt_version": PROMPT_VERSION,
                "scoring_engine_version": SCORING_ENGINE_VERSION,
                "score": run["score"],
                "evidence_quotes": question.get("evidence_quotes", []),
                "rubric_band": question.get("rubric_band"),
                "correctness": question.get("correctness"),
                "limiting_rule": question.get("limiting_rule"),
                "verifier": question.get("verifier"),
                "confidence": question.get("confidence"),
            }
            print(f"{case_id}: score={run['score']}", flush=True)
        except Exception as exc:
            errors.append({"id": case_id, "error": str(exc)})
            print(f"{case_id}: ERROR {exc}", flush=True)

    payload = {
        "evaluation_version": EVALUATION_VERSION,
        "model": args.model,
        "model_digest": model_digest,
        "rubric_version": RUBRIC_VERSION,
        "prompt_version": PROMPT_VERSION,
        "scoring_engine_version": SCORING_ENGINE_VERSION,
        "source_calibration_version": exported.get("version") or "unknown",
        "results": results,
        "errors": errors,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {args.output}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
