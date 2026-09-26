"""Build a deterministic follow-up rehearsal from a completed evaluation."""

from __future__ import annotations

import re
from typing import Any

from services.interview_orchestrator import MODULE_BLUEPRINTS


PRACTICE_FOCUS_VERSION = "v1_evaluation_to_rehearsal"
PRACTICE_PROGRESS_VERSION = "v1_competency_delta"
MEANINGFUL_DELTA = 5
CORE_COMPETENCIES = (
    "answer_relevance",
    "specificity",
    "structure",
    "evidence_quality",
    "impact_orientation",
    "role_alignment",
    "communication_clarity",
    "adaptability",
)

CORE_TO_MODULE = {
    "general": {key: key for key in CORE_COMPETENCIES},
    "roleplay": {
        "answer_relevance": "active_listening",
        "specificity": "conflict_resolution",
        "structure": "conflict_resolution",
        "evidence_quality": "active_listening",
        "impact_orientation": "conflict_resolution",
        "role_alignment": "empathy",
        "communication_clarity": "empathy",
        "adaptability": "active_listening",
    },
    "visual": {
        "answer_relevance": "verbal_clarity",
        "specificity": "spatial_reasoning",
        "structure": "verbal_clarity",
        "evidence_quality": "design_justification",
        "impact_orientation": "design_justification",
        "role_alignment": "design_justification",
        "communication_clarity": "verbal_clarity",
        "adaptability": "spatial_reasoning",
    },
    "technical": {
        "answer_relevance": "problem_solving",
        "specificity": "technical_accuracy",
        "structure": "thought_process",
        "evidence_quality": "technical_accuracy",
        "impact_orientation": "problem_solving",
        "role_alignment": "technical_accuracy",
        "communication_clarity": "thought_process",
        "adaptability": "problem_solving",
    },
    "casestudy": {
        "answer_relevance": "recommendation_quality",
        "specificity": "quantitative_reasoning",
        "structure": "framework_usage",
        "evidence_quality": "quantitative_reasoning",
        "impact_orientation": "recommendation_quality",
        "role_alignment": "recommendation_quality",
        "communication_clarity": "framework_usage",
        "adaptability": "framework_usage",
    },
    "salary": {
        "answer_relevance": "composure",
        "specificity": "justification_quality",
        "structure": "composure",
        "evidence_quality": "justification_quality",
        "impact_orientation": "justification_quality",
        "role_alignment": "anchoring_strategy",
        "communication_clarity": "composure",
        "adaptability": "composure",
    },
}


def _score(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return max(0, min(100, round(float(value))))


def _clean(value: Any, limit: int = 280) -> str:
    return " ".join(str(value or "").split())[:limit]


def _label(key: str) -> str:
    return key.replace("_", " ").title()


def _feedback_scores(feedback: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    pillars = feedback.get("pillars") if isinstance(feedback.get("pillars"), dict) else {}
    interview = pillars.get("interview") if isinstance(pillars.get("interview"), dict) else {}
    core = interview.get("competency_scores") or feedback.get("competency_scores") or {}
    module = interview.get("module_scores") or feedback.get("module_scores") or {}
    return (
        core if isinstance(core, dict) else {},
        module if isinstance(module, dict) else {},
    )


def _planner_competency_scores(feedback: dict[str, Any], module: str) -> dict[str, dict[str, Any]]:
    """Project evaluator scores onto the competencies used by the interview planner."""
    allowed = {entry["competency"] for entry in MODULE_BLUEPRINTS[module]}
    core_scores, module_scores = _feedback_scores(feedback)
    candidates: dict[str, dict[str, Any]] = {}

    for key, value in module_scores.items():
        normalized_key = re.sub(r"[^a-z0-9_]+", "_", str(key).strip().lower()).strip("_")
        score = _score(value)
        if normalized_key in allowed and score is not None:
            candidates[normalized_key] = {
                "key": normalized_key,
                "label": _label(normalized_key),
                "score": score,
                "source": "module_score",
            }

    mapping = CORE_TO_MODULE[module]
    for core_key in CORE_COMPETENCIES:
        score = _score(core_scores.get(core_key))
        mapped_key = mapping[core_key]
        if score is None or mapped_key not in allowed:
            continue
        current = candidates.get(mapped_key)
        if current is None or score < current["score"]:
            candidates[mapped_key] = {
                "key": mapped_key,
                "label": _label(mapped_key),
                "score": score,
                "source": core_key,
            }
    return candidates


def _question_gap(feedback: dict[str, Any]) -> str:
    evaluations = feedback.get("question_evaluations") or []
    if not isinstance(evaluations, list):
        return ""
    valid = [item for item in evaluations if isinstance(item, dict) and _score(item.get("score")) is not None]
    if not valid:
        return ""
    weakest = min(valid, key=lambda item: _score(item.get("score")) or 0)
    return _clean(
        weakest.get("missed_opportunity")
        or weakest.get("practice_drill")
        or weakest.get("coaching_note"),
        320,
    )


def build_practice_focus(session: dict[str, Any]) -> dict[str, Any]:
    """Translate scored feedback into safe planner inputs and launch settings."""
    if not isinstance(session, dict):
        raise ValueError("Session must be an object")
    feedback = session.get("feedback")
    if not isinstance(feedback, dict) or _score(feedback.get("overall_score")) is None:
        raise ValueError("A scored evaluation is required to build focused practice")

    module = str(session.get("module") or "general").strip().lower()
    if module not in MODULE_BLUEPRINTS:
        module = "general"
    candidates = _planner_competency_scores(feedback, module)

    ranked = sorted(candidates.values(), key=lambda item: (item["score"], item["key"]))
    selected = [item for item in ranked if item["score"] < 75][:3] or ranked[:3]
    if not selected:
        selected = [{
            "key": MODULE_BLUEPRINTS[module][0]["competency"],
            "label": _label(MODULE_BLUEPRINTS[module][0]["competency"]),
            "score": _score(feedback.get("overall_score")) or 0,
            "source": "overall_score",
        }]

    evaluation_gap = _question_gap(feedback)
    improvement_tip = _clean(feedback.get("improvement_tip"), 320)
    practice_plan = feedback.get("practice_plan") or feedback.get("actionable_next_steps") or []
    objectives = [
        _clean(item, 320)
        for item in practice_plan
        if isinstance(item, str) and _clean(item, 320)
    ][:3]
    default_reason = evaluation_gap or improvement_tip or "Build stronger, more observable evidence in the next answer."
    for item in selected:
        item["reason"] = default_reason

    settings = session.get("settings") if isinstance(session.get("settings"), dict) else {}
    focus_context = {
        "version": PRACTICE_FOCUS_VERSION,
        "source_session_id": _clean(session.get("id"), 160),
        "source_score": _score(feedback.get("overall_score")),
        "focus_keys": [item["key"] for item in selected],
        "focus_competencies": selected,
        "practice_objectives": objectives,
        "evaluation_gap": evaluation_gap,
    }
    launch_config = {
        "target_role": _clean(session.get("target_role"), 240) or "General Candidate",
        "module": module,
        "difficulty": str(settings.get("difficulty") or "medium"),
        "duration": str(settings.get("duration") or "standard"),
        "industry": str(settings.get("industry") or "general"),
        "interviewer_style": str(settings.get("interviewer_style") or "friendly"),
        "interviewer_persona": settings.get("interviewer_persona") if isinstance(settings.get("interviewer_persona"), dict) else None,
        "faang_mode": bool(settings.get("faang_mode", False)),
        "interruptions_enabled": bool(settings.get("interruptions_enabled", False)),
        "camera_enabled": bool(settings.get("camera_enabled", True)),
        "blind_mirror": bool(settings.get("blind_mirror", True)),
        "voice_mode": bool(settings.get("voice_mode", True)),
        "job_description": str(settings.get("job_description") or ""),
        "resume_text": str(settings.get("resume_text") or ""),
        "resume_file_name": str(settings.get("resume_file_name") or ""),
        "resume_file_meta": str(settings.get("resume_file_meta") or ""),
    }
    return {
        "focus_context": focus_context,
        "launch_config": launch_config,
    }


def build_practice_progress(
    current_session: dict[str, Any],
    source_session: dict[str, Any],
) -> dict[str, Any]:
    """Compare a focused rehearsal with the scored session that created it."""
    if not isinstance(current_session, dict) or not isinstance(source_session, dict):
        raise ValueError("Current and source sessions must be objects")

    settings = current_session.get("settings") if isinstance(current_session.get("settings"), dict) else {}
    focus = settings.get("focus_context") if isinstance(settings.get("focus_context"), dict) else None
    if not focus:
        plan = current_session.get("interview_plan")
        focus = plan.get("adaptive_focus") if isinstance(plan, dict) and isinstance(plan.get("adaptive_focus"), dict) else None
    if not focus:
        raise ValueError("This session is not a focused follow-up rehearsal")

    source_id = _clean(focus.get("source_session_id"), 160)
    if not source_id or source_id != _clean(source_session.get("id"), 160):
        raise ValueError("Focused rehearsal source does not match the supplied session")

    current_feedback = current_session.get("feedback")
    source_feedback = source_session.get("feedback")
    current_overall = _score(current_feedback.get("overall_score")) if isinstance(current_feedback, dict) else None
    source_overall = _score(source_feedback.get("overall_score")) if isinstance(source_feedback, dict) else None
    if current_overall is None or source_overall is None:
        raise ValueError("Both sessions need scored evaluations before progress can be measured")

    module = str(current_session.get("module") or "general").strip().lower()
    source_module = str(source_session.get("module") or "general").strip().lower()
    if module not in MODULE_BLUEPRINTS or source_module != module:
        raise ValueError("Focused rehearsal and source session must use the same interview format")

    allowed = {entry["competency"] for entry in MODULE_BLUEPRINTS[module]}
    focus_keys: list[str] = []
    for value in focus.get("focus_keys") or []:
        key = re.sub(r"[^a-z0-9_]+", "_", str(value).strip().lower()).strip("_")
        if key in allowed and key not in focus_keys:
            focus_keys.append(key)
    if not focus_keys:
        raise ValueError("Focused rehearsal has no comparable target competencies")

    source_scores = _planner_competency_scores(source_feedback, module)
    current_scores = _planner_competency_scores(current_feedback, module)
    comparisons: list[dict[str, Any]] = []
    for key in focus_keys:
        before = source_scores.get(key, {}).get("score")
        after = current_scores.get(key, {}).get("score")
        comparable = before is not None and after is not None
        delta = int(after - before) if comparable else None
        if not comparable:
            status = "unavailable"
        elif delta >= MEANINGFUL_DELTA:
            status = "improved"
        elif delta <= -MEANINGFUL_DELTA:
            status = "regressed"
        else:
            status = "steady"
        comparisons.append({
            "key": key,
            "label": _label(key),
            "source_score": before,
            "current_score": after,
            "delta": delta,
            "status": status,
            "comparable": comparable,
        })

    measured = [item for item in comparisons if item["comparable"]]
    improved = [item for item in measured if item["status"] == "improved"]
    regressed = [item for item in measured if item["status"] == "regressed"]
    steady = [item for item in measured if item["status"] == "steady"]
    average_delta = round(sum(item["delta"] for item in measured) / len(measured), 1) if measured else None

    if not measured:
        outcome = "insufficient_evidence"
        recommendation = "Repeat the focused rehearsal so both reports contain comparable competency evidence."
    elif len(improved) == len(measured):
        outcome = "improved"
        recommendation = "The targeted areas improved. Move to the next weak area or raise the difficulty."
    elif improved:
        outcome = "partially_improved"
        remaining = ", ".join(item["label"] for item in [*regressed, *steady])
        recommendation = f"Keep the gains and repeat focused practice for {remaining}."
    elif regressed:
        outcome = "regressed"
        remaining = ", ".join(item["label"] for item in regressed)
        recommendation = f"Repeat {remaining} with one concise example and explicit evidence in each answer."
    else:
        outcome = "steady"
        remaining = ", ".join(item["label"] for item in steady)
        recommendation = f"These scores stayed within the normal variation band. Repeat {remaining} once more."

    return {
        "version": PRACTICE_PROGRESS_VERSION,
        "meaningful_delta": MEANINGFUL_DELTA,
        "source_session_id": source_id,
        "current_session_id": _clean(current_session.get("id"), 160),
        "module": module,
        "source_overall_score": source_overall,
        "current_overall_score": current_overall,
        "overall_delta": current_overall - source_overall,
        "average_target_delta": average_delta,
        "outcome": outcome,
        "comparisons": comparisons,
        "measured_count": len(measured),
        "improved_count": len(improved),
        "recommendation": recommendation,
    }
