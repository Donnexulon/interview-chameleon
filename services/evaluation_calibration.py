"""Human-in-the-loop calibration for locally generated interview evaluations."""

from __future__ import annotations

import re
from collections import Counter
from datetime import datetime, timezone
from typing import Any

from services.evaluation import build_transcript_analysis
from services.session_history import EVALUATION_REVIEW_VERDICTS


CALIBRATION_EXPORT_VERSION = "v2_local_calibration"
SCORE_VERDICTS = {"accurate", "too_harsh", "too_generous"}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _score_map(value: Any) -> dict[str, int]:
    if not isinstance(value, dict):
        return {}
    return {
        str(key): max(0, min(100, int(score)))
        for key, score in value.items()
        if isinstance(score, (int, float))
    }


def build_review_snapshot(
    session: dict[str, Any],
    question_index: int,
    verdict: str,
    note: str = "",
) -> dict[str, Any]:
    """Bind a human judgment to the exact evaluator and transcript evidence shown."""
    if not isinstance(session, dict) or not session.get("id"):
        raise ValueError("Session is unavailable")
    if session.get("status") != "completed":
        raise ValueError("Only completed sessions can calibrate the evaluator")
    verdict = str(verdict or "").strip().lower()
    if verdict not in EVALUATION_REVIEW_VERDICTS:
        raise ValueError("Unsupported evaluation review verdict")

    feedback = session.get("feedback") if isinstance(session.get("feedback"), dict) else {}
    evaluations = feedback.get("question_evaluations")
    if not isinstance(evaluations, list) or not evaluations:
        raise ValueError("This report has no question-level evaluation to review")
    if question_index < 0 or question_index >= len(evaluations):
        raise ValueError("Evaluation question index is out of range")
    evaluation = evaluations[question_index]
    if not isinstance(evaluation, dict):
        raise ValueError("Evaluation question is unavailable")

    pairs = build_transcript_analysis(session.get("messages") or []).get("pairs") or []
    pair = pairs[question_index] if question_index < len(pairs) else {}
    score = evaluation.get("score")
    evaluator = feedback.get("evaluator") if isinstance(feedback.get("evaluator"), dict) else {}
    stored_metadata = session.get("evaluator_metadata") if isinstance(session.get("evaluator_metadata"), dict) else {}
    evaluator = {**stored_metadata, **evaluator}
    return {
        "session_id": session["id"],
        "question_index": question_index,
        "verdict": verdict,
        "note": note,
        "module": session.get("module") or "general",
        "target_role": session.get("target_role") or "General Candidate",
        "question_text": evaluation.get("question") or pair.get("question") or "",
        "answer_text": pair.get("answer") or evaluation.get("answer_summary") or "",
        "evaluator_score": score if isinstance(score, (int, float)) else None,
        "evidence_quotes": [
            str(item) for item in (evaluation.get("evidence_quotes") or []) if str(item).strip()
        ],
        "competency_scores": _score_map(evaluation.get("competency_scores")),
        "module_scores": _score_map(evaluation.get("module_scores")),
        "evaluation_version": feedback.get("evaluation_version") or "unknown",
        "model_digest": str(evaluator.get("model_digest") or ""),
        "rubric_version": str(evaluator.get("rubric_version") or ""),
        "prompt_version": str(evaluator.get("prompt_version") or ""),
        "scoring_engine_version": str(
            evaluator.get("scoring_engine_version") or evaluator.get("scoring_engine") or ""
        ),
        "rubric_assessment": evaluation.get("rubric_assessment") if isinstance(evaluation.get("rubric_assessment"), dict) else {},
        "correctness": str(evaluation.get("correctness") or ""),
        "limiting_rule": str(evaluation.get("limiting_rule") or ""),
        "verifier": evaluation.get("verifier") if isinstance(evaluation.get("verifier"), dict) else {},
        "confidence": evaluation.get("confidence") if isinstance(evaluation.get("confidence"), dict) else {},
    }


def _verdict_counts(reviews: list[dict[str, Any]]) -> dict[str, int]:
    counts = Counter(str(item.get("verdict") or "") for item in reviews)
    return {verdict: counts[verdict] for verdict in sorted(EVALUATION_REVIEW_VERDICTS)}


def _agreement_rate(counts: dict[str, int]) -> float | None:
    score_reviews = sum(counts.get(key, 0) for key in SCORE_VERDICTS)
    if not score_reviews:
        return None
    return round(counts.get("accurate", 0) / score_reviews * 100, 1)


def _bias_label(counts: dict[str, int]) -> str:
    harsh = counts.get("too_harsh", 0)
    generous = counts.get("too_generous", 0)
    if harsh == generous:
        return "Balanced" if harsh else "Not enough feedback"
    return "Scores trend harsh" if harsh > generous else "Scores trend generous"


def build_calibration_summary(reviews: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate local judgments without changing any historical score."""
    reviews = [item for item in reviews if item.get("verdict") in EVALUATION_REVIEW_VERDICTS]
    counts = _verdict_counts(reviews)

    modules: list[dict[str, Any]] = []
    for module in sorted({str(item.get("module") or "general") for item in reviews}):
        module_reviews = [item for item in reviews if (item.get("module") or "general") == module]
        module_counts = _verdict_counts(module_reviews)
        modules.append({
            "module": module,
            "review_count": len(module_reviews),
            "agreement_rate": _agreement_rate(module_counts),
            "bias": _bias_label(module_counts),
            "counts": module_counts,
        })

    competency_buckets: dict[str, list[dict[str, Any]]] = {}
    for review in reviews:
        keys = {
            *(_score_map(review.get("competency_scores")).keys()),
            *(_score_map(review.get("module_scores")).keys()),
        }
        for key in keys:
            competency_buckets.setdefault(key, []).append(review)

    competencies: list[dict[str, Any]] = []
    for key, key_reviews in competency_buckets.items():
        key_counts = _verdict_counts(key_reviews)
        scores = []
        for review in key_reviews:
            merged = {**_score_map(review.get("competency_scores")), **_score_map(review.get("module_scores"))}
            if key in merged:
                scores.append(merged[key])
        competencies.append({
            "key": key,
            "review_count": len(key_reviews),
            "average_evaluator_score": round(sum(scores) / len(scores), 1) if scores else None,
            "agreement_rate": _agreement_rate(key_counts),
            "bias": _bias_label(key_counts),
            "counts": key_counts,
        })
    competencies.sort(key=lambda item: (-item["review_count"], item["key"]))

    recent = [{
        "session_id": item.get("session_id"),
        "question_index": item.get("question_index"),
        "module": item.get("module") or "general",
        "target_role": item.get("target_role") or "General Candidate",
        "question_text": item.get("question_text") or "",
        "evaluator_score": item.get("evaluator_score"),
        "verdict": item.get("verdict"),
        "note": item.get("note") or "",
        "updated_at": item.get("updated_at"),
    } for item in reviews[:8]]

    return {
        "version": CALIBRATION_EXPORT_VERSION,
        "review_count": len(reviews),
        "reviewed_sessions": len({item.get("session_id") for item in reviews}),
        "agreement_rate": _agreement_rate(counts),
        "bias": _bias_label(counts),
        "evidence_disputes": counts.get("wrong_evidence", 0),
        "counts": counts,
        "modules": modules,
        "competencies": competencies,
        "recent_reviews": recent,
    }


def _redact_personal_data(value: Any) -> str:
    text = " ".join(str(value or "").split())
    text = re.sub(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b", "[email]", text)
    text = re.sub(r"\b(?:https?://|www\.)\S+", "[url]", text, flags=re.IGNORECASE)
    text = re.sub(r"(?<!\w)(?:\+?\d[\d ()-]{7,}\d)(?!\w)", "[phone]", text)
    return text


def _redact_nested(value: Any) -> Any:
    if isinstance(value, str):
        return _redact_personal_data(value)
    if isinstance(value, list):
        return [_redact_nested(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _redact_nested(item) for key, item in value.items()}
    return value


def export_calibration_cases(reviews: list[dict[str, Any]]) -> dict[str, Any]:
    """Create privacy-minimized regression cases from locally approved judgments."""
    direction = {
        "accurate": "hold",
        "too_harsh": "increase",
        "too_generous": "decrease",
        "wrong_evidence": "review_evidence",
    }
    cases = []
    for index, review in enumerate(reviews, start=1):
        verdict = str(review.get("verdict") or "")
        if verdict not in EVALUATION_REVIEW_VERDICTS:
            continue
        cases.append({
            "id": f"local_calibration_{index:03d}",
            "module": review.get("module") or "general",
            "target_role": _redact_personal_data(review.get("target_role") or "General Candidate"),
            "question": _redact_personal_data(review.get("question_text")),
            "answer": _redact_personal_data(review.get("answer_text")),
            "evaluator_snapshot": {
                "evaluation_version": review.get("evaluation_version") or "unknown",
                "model_digest": review.get("model_digest") or "unknown",
                "rubric_version": review.get("rubric_version") or "unknown",
                "prompt_version": review.get("prompt_version") or "unknown",
                "scoring_engine_version": review.get("scoring_engine_version") or "unknown",
                "score": review.get("evaluator_score"),
                "evidence_quotes": [
                    _redact_personal_data(item) for item in (review.get("evidence_quotes") or [])
                ],
                "competency_scores": _score_map(review.get("competency_scores")),
                "module_scores": _score_map(review.get("module_scores")),
                "rubric_assessment": _redact_nested(review.get("rubric_assessment") or {}),
                "correctness": review.get("correctness") or "",
                "limiting_rule": _redact_personal_data(review.get("limiting_rule") or ""),
                "verifier": _redact_nested(review.get("verifier") or {}),
                "confidence": _redact_nested(review.get("confidence") or {}),
            },
            "human_review": {
                "verdict": verdict,
                "expected_score_direction": direction[verdict],
                "note": _redact_personal_data(review.get("note")),
            },
        })
    return {
        "version": CALIBRATION_EXPORT_VERSION,
        "generated_at": _utc_now(),
        "privacy": "Session ids, dates, resume data, job descriptions, email addresses, URLs, and phone numbers are excluded.",
        "case_count": len(cases),
        "cases": cases,
    }
