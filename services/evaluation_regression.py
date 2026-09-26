"""Turn local calibration judgments into an evaluator release gate."""

from __future__ import annotations

from typing import Any


REGRESSION_GATE_VERSION = "v1_calibration_release_gate"


def _normalize(text: str) -> str:
    return " ".join(str(text or "").split()).casefold()


def _evidence_is_grounded(quotes: list[str], answer: str) -> bool:
    normalized_answer = _normalize(answer)
    return all(_normalize(quote) in normalized_answer for quote in quotes if _normalize(quote))


def compare_calibration_case(
    case: dict[str, Any],
    candidate: dict[str, Any],
    *,
    hold_tolerance: int = 3,
) -> dict[str, Any]:
    """Compare one candidate evaluator result with one human-reviewed snapshot."""
    snapshot = case.get("evaluator_snapshot") or {}
    review = case.get("human_review") or {}
    previous_score = snapshot.get("score")
    candidate_score = candidate.get("score")
    direction = review.get("expected_score_direction") or "hold"
    reasons: list[str] = []
    score_pass = True

    if isinstance(previous_score, (int, float)) and isinstance(candidate_score, (int, float)):
        delta = round(float(candidate_score) - float(previous_score), 2)
        if direction == "increase":
            score_pass = delta > 0
            if not score_pass:
                reasons.append("Human feedback expected the score to increase.")
        elif direction == "decrease":
            score_pass = delta < 0
            if not score_pass:
                reasons.append("Human feedback expected the score to decrease.")
        elif direction == "hold":
            score_pass = abs(delta) <= max(0, hold_tolerance)
            if not score_pass:
                reasons.append(f"An approved score moved by {delta:+g}, beyond the {hold_tolerance}-point tolerance.")
    else:
        delta = None
        if direction != "review_evidence":
            score_pass = False
            reasons.append("A comparable numeric score is missing.")

    evidence = [str(item) for item in (candidate.get("evidence_quotes") or []) if str(item).strip()]
    evidence_pass = _evidence_is_grounded(evidence, case.get("answer", ""))
    if not evidence_pass:
        reasons.append("Candidate evidence is not an exact substring of the reviewed answer.")
    if direction == "review_evidence":
        old_evidence = {_normalize(item) for item in (snapshot.get("evidence_quotes") or []) if _normalize(item)}
        new_evidence = {_normalize(item) for item in evidence if _normalize(item)}
        evidence_pass = evidence_pass and bool(new_evidence) and new_evidence != old_evidence
        if not new_evidence:
            reasons.append("The evidence-dispute case still has no replacement evidence.")
        elif new_evidence == old_evidence:
            reasons.append("The disputed evidence was reused unchanged.")

    return {
        "id": case.get("id"),
        "module": case.get("module") or "general",
        "expected_direction": direction,
        "previous_version": snapshot.get("evaluation_version") or "unknown",
        "candidate_version": candidate.get("evaluation_version") or "unknown",
        "previous_model_digest": snapshot.get("model_digest") or "unknown",
        "candidate_model_digest": candidate.get("model_digest") or "unknown",
        "rubric_version": candidate.get("rubric_version") or "unknown",
        "prompt_version": candidate.get("prompt_version") or "unknown",
        "scoring_engine_version": candidate.get("scoring_engine_version") or "unknown",
        "previous_score": previous_score,
        "candidate_score": candidate_score,
        "score_delta": delta,
        "score_pass": score_pass,
        "evidence_pass": evidence_pass,
        "pass": score_pass and evidence_pass,
        "reasons": reasons,
    }


def build_regression_gate(
    calibration_export: dict[str, Any],
    candidate_results: dict[str, dict[str, Any]],
    *,
    hold_tolerance: int = 3,
) -> dict[str, Any]:
    """Produce a version-comparison report suitable for CI or a local release check."""
    cases = calibration_export.get("cases") or []
    comparisons = []
    missing = []
    for case in cases:
        case_id = str(case.get("id") or "")
        candidate = candidate_results.get(case_id)
        if not candidate:
            missing.append(case_id)
            continue
        comparisons.append(compare_calibration_case(case, candidate, hold_tolerance=hold_tolerance))

    failures = [item["id"] for item in comparisons if not item["pass"]]
    ready = bool(cases) and not missing and len(comparisons) == len(cases)
    return {
        "version": REGRESSION_GATE_VERSION,
        "calibration_version": calibration_export.get("version") or "unknown",
        "case_count": len(cases),
        "evaluated_count": len(comparisons),
        "coverage": round(len(comparisons) / len(cases), 3) if cases else 0,
        "hold_tolerance": max(0, hold_tolerance),
        "comparisons": comparisons,
        "missing_case_ids": missing,
        "failed_case_ids": failures,
        "release_ready": ready,
        "passed": ready and not failures,
    }
