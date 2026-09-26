"""Compare candidate evaluator output with exported local calibration cases."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.evaluation_regression import build_regression_gate  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--calibration", type=Path, required=True, help="Calibration export JSON")
    parser.add_argument("--results", type=Path, required=True, help="Candidate results keyed by calibration case id")
    parser.add_argument("--output", type=Path, help="Optional comparison report path")
    parser.add_argument("--hold-tolerance", type=int, default=3)
    parser.add_argument("--strict", action="store_true", help="Exit non-zero unless the release gate passes")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    calibration = json.loads(args.calibration.read_text(encoding="utf-8"))
    raw_results = json.loads(args.results.read_text(encoding="utf-8"))
    candidate_results = raw_results.get("results", raw_results)
    if not isinstance(candidate_results, dict):
        raise SystemExit("Candidate results must be an object keyed by calibration case id")
    report = build_regression_gate(
        calibration,
        candidate_results,
        hold_tolerance=args.hold_tolerance,
    )
    rendered = json.dumps(report, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
        print(f"Wrote {args.output}")
    else:
        print(rendered, end="")
    return 1 if args.strict and not report["passed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
