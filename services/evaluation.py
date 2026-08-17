"""
Evaluation prompt builder for Interview Chameleon.

Evaluation V3 keeps the existing report contract while adding a stricter
job-readiness scorecard, transcript-derived features, and evidence validation.
"""

import json
import re
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


MODULE_CRITERIA = {
    "general": {
        "label": "General Interview",
        "extra_criteria": {},
    },
    "roleplay": {
        "label": "Roleplay & Behavioral",
        "extra_criteria": {
            "empathy": "Empathy and emotional intelligence: acknowledged feelings, showed understanding, and de-escalated.",
            "conflict_resolution": "Conflict resolution: proposed constructive solutions rather than avoiding or escalating.",
            "active_listening": "Active listening: referenced prior context, asked clarifying questions, and built on what was said.",
        },
    },
    "visual": {
        "label": "Visual & Whiteboard",
        "extra_criteria": {
            "verbal_clarity": "Verbal clarity of design: described visual thinking clearly without relying on a canvas.",
            "spatial_reasoning": "Spatial reasoning: communicated relationships, flows, and hierarchy effectively.",
            "design_justification": "Design justification: explained why choices were made, not just what was drawn.",
        },
    },
    "technical": {
        "label": "Technical Assessment",
        "extra_criteria": {
            "problem_solving": "Problem-solving approach: decomposed the problem, considered edge cases, and thought aloud.",
            "technical_accuracy": "Technical accuracy: gave correct, efficient, and well-reasoned solutions.",
            "thought_process": "Thought process: showed trade-offs, alternatives, and complexity or implementation reasoning.",
        },
    },
    "casestudy": {
        "label": "Case Study & Strategy",
        "extra_criteria": {
            "framework_usage": "Framework usage: used structured frameworks such as MECE, market sizing, or issue trees.",
            "quantitative_reasoning": "Quantitative reasoning: used numbers, estimates, and assumptions effectively.",
            "recommendation_quality": "Recommendation quality: gave a specific, justified, and actionable recommendation.",
        },
    },
    "salary": {
        "label": "Salary Negotiation",
        "extra_criteria": {
            "anchoring_strategy": "Anchoring strategy: set a strong but credible counter-offer.",
            "justification_quality": "Justification quality: backed the ask with market data, skills, or achievements.",
            "composure": "Composure under pressure: stayed calm and constructive when challenged.",
        },
    },
}

EVALUATION_VERSION = "v3_readiness_scorecard"

COMPETENCY_KEYS = [
    "answer_relevance",
    "specificity",
    "structure",
    "evidence_quality",
    "impact_orientation",
    "role_alignment",
    "communication_clarity",
    "adaptability",
]

MISSING_ANSWER_TYPES = {"missing", "evasive", "harmful"}
NO_EVIDENCE = "No transcript evidence available."
EVIDENCE_TEXT_KEYS = {"evidence_quote", "evidence_quotes"}


def _mojibake_score(text: str) -> int:
    markers = ["\u00e2", "\u00c3", "\u00c2", "\ufffd"]
    return sum(text.count(marker) for marker in markers) + sum(
        1 for char in text if 0x80 <= ord(char) <= 0x9F
    )


def _clean_display_text(text: str) -> str:
    cleaned = str(text)
    if _mojibake_score(cleaned):
        try:
            repaired = cleaned.encode("latin1").decode("utf-8")
            if _mojibake_score(repaired) < _mojibake_score(cleaned):
                cleaned = repaired
        except UnicodeError:
            pass

    replacements = {
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2013": "-",
        "\u2014": "-",
        "\u2026": "...",
    }
    for source, replacement in replacements.items():
        cleaned = cleaned.replace(source, replacement)
    return cleaned


def clean_feedback_display_text(value: Any, key: str = "") -> Any:
    if key in EVIDENCE_TEXT_KEYS:
        return value
    if isinstance(value, str):
        return _clean_display_text(value)
    if isinstance(value, list):
        return [clean_feedback_display_text(item) for item in value]
    if isinstance(value, dict):
        return {item_key: clean_feedback_display_text(item_value, item_key) for item_key, item_value in value.items()}
    return value


def clean_string_list(value: list[str]) -> list[str]:
    return [" ".join(str(item).split()) for item in value if str(item or "").strip()]


class InterviewScoresV2(BaseModel):
    responsiveness: int = Field(..., ge=0, le=100)
    depth: int = Field(..., ge=0, le=100)
    clarity: int = Field(..., ge=0, le=100)
    communication_style: int = Field(..., ge=0, le=100)


class CompetencyScoresV3(BaseModel):
    answer_relevance: int = Field(..., ge=0, le=100)
    specificity: int = Field(..., ge=0, le=100)
    structure: int = Field(..., ge=0, le=100)
    evidence_quality: int = Field(..., ge=0, le=100)
    impact_orientation: int = Field(..., ge=0, le=100)
    role_alignment: int = Field(..., ge=0, le=100)
    communication_clarity: int = Field(..., ge=0, le=100)
    adaptability: int = Field(..., ge=0, le=100)


class QuestionHighlightV2(BaseModel):
    question: str
    answer_summary: str = ""
    assessment: str = ""
    evidence_quote: str = ""
    score: int = Field(..., ge=0, le=100)


class ReadinessV3(BaseModel):
    level: Literal["not_ready", "developing", "near_ready", "interview_ready"] = "developing"
    hire_signal: Literal["strong_no", "no", "lean_no", "lean_yes", "yes", "strong_yes"] = "lean_no"
    summary: str = ""
    blockers: list[str] = Field(default_factory=list)
    strongest_signals: list[str] = Field(default_factory=list)

    @field_validator("blockers", "strongest_signals")
    @classmethod
    def clean_readiness_lists(cls, value: list[str]) -> list[str]:
        return clean_string_list(value)


class QuestionEvaluationV3(BaseModel):
    question: str
    answer_summary: str = ""
    answer_type: Literal["complete", "partial", "missing", "evasive", "harmful"] = "partial"
    score: int = Field(..., ge=0, le=100)
    competency_scores: CompetencyScoresV3
    evidence_quotes: list[str] = Field(default_factory=list)
    missed_opportunity: str = ""
    coaching_note: str = ""
    practice_drill: str = ""

    @field_validator("evidence_quotes")
    @classmethod
    def clean_evidence_quotes(cls, value: list[str]) -> list[str]:
        return clean_string_list(value)

    @model_validator(mode="after")
    def cap_missing_or_evasive_scores(self) -> "QuestionEvaluationV3":
        if self.answer_type in MISSING_ANSWER_TYPES:
            self.score = min(self.score, 39)
            for key in COMPETENCY_KEYS:
                setattr(self.competency_scores, key, min(getattr(self.competency_scores, key), 39))
        return self


class EvaluationV3(BaseModel):
    evaluation_version: str = EVALUATION_VERSION
    competency_scores: CompetencyScoresV3
    module_scores: dict[str, int] = Field(default_factory=dict)
    readiness: ReadinessV3 = Field(default_factory=ReadinessV3)
    weakest_area: str = ""
    strongest_area: str = ""
    improvement_tip: str = ""
    coaching_summary: str = ""
    actionable_next_steps: list[str] = Field(default_factory=list)
    red_flags: list[str] = Field(default_factory=list)
    risk_flags: list[str] = Field(default_factory=list)
    practice_plan: list[str] = Field(default_factory=list)
    question_evaluations: list[QuestionEvaluationV3] = Field(default_factory=list)
    question_highlights: list[QuestionHighlightV2] = Field(default_factory=list)
    transcript_features: dict[str, Any] = Field(default_factory=dict)
    evaluator_confidence: int = Field(default=70, ge=0, le=100)
    interview_scores: Optional[InterviewScoresV2] = None

    @field_validator("actionable_next_steps", "red_flags", "risk_flags", "practice_plan")
    @classmethod
    def clean_display_lists(cls, value: list[str]) -> list[str]:
        return clean_string_list(value)

    @field_validator("module_scores")
    @classmethod
    def validate_module_scores(cls, value: dict[str, int]) -> dict[str, int]:
        for key, score in value.items():
            if not isinstance(score, int) or score < 0 or score > 100:
                raise ValueError(f"module score '{key}' must be an integer from 0 to 100")
        return value

    def to_feedback_dict(self, transcript_features: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        data = self.model_dump(exclude_none=True)
        data["evaluation_version"] = EVALUATION_VERSION
        data["interview_scores"] = derive_interview_scores(data["competency_scores"])
        data["question_highlights"] = derive_question_highlights(data.get("question_evaluations", []))
        data["red_flags"] = data.get("red_flags") or data.get("risk_flags", [])
        data["actionable_next_steps"] = data.get("actionable_next_steps") or data.get("practice_plan", [])
        data["transcript_features"] = transcript_features or data.get("transcript_features", {})
        return data


GRADE_MAP = [
    (95, "S", "Exceptional", "#FFD700"),
    (85, "A", "Excellent", "#4ade80"),
    (70, "B", "Good", "#60a5fa"),
    (55, "C", "Average", "#fbbf24"),
    (40, "D", "Below Average", "#f97316"),
    (0, "F", "Needs Work", "#ef4444"),
]


def get_grade(score: int) -> dict:
    for threshold, grade, label, color in GRADE_MAP:
        if score >= threshold:
            return {"grade": grade, "label": label, "color": color, "score": score}
    return {"grade": "F", "label": "Needs Work", "color": "#ef4444", "score": score}


def _avg(values: list[int]) -> int:
    return round(sum(values) / len(values)) if values else 0


def derive_interview_scores(competency_scores: dict[str, int]) -> dict[str, int]:
    return {
        "responsiveness": int(competency_scores.get("answer_relevance", 0)),
        "depth": _avg([
            int(competency_scores.get("specificity", 0)),
            int(competency_scores.get("evidence_quality", 0)),
            int(competency_scores.get("impact_orientation", 0)),
        ]),
        "clarity": _avg([
            int(competency_scores.get("structure", 0)),
            int(competency_scores.get("communication_clarity", 0)),
        ]),
        "communication_style": _avg([
            int(competency_scores.get("role_alignment", 0)),
            int(competency_scores.get("adaptability", 0)),
        ]),
    }


def derive_question_highlights(question_evaluations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    highlights = []
    for item in question_evaluations:
        quotes = item.get("evidence_quotes") or []
        evidence = quotes[0] if quotes else NO_EVIDENCE
        highlights.append({
            "question": item.get("question", ""),
            "answer_summary": item.get("answer_summary", ""),
            "assessment": item.get("coaching_note") or item.get("missed_opportunity", ""),
            "evidence_quote": evidence,
            "score": item.get("score", 0),
        })
    return highlights


def _build_competency_example(score: int = 75) -> dict[str, int]:
    return {key: score for key in COMPETENCY_KEYS}


def _build_evaluation_json_schema(module_keys: list[str]) -> str:
    schema = {
        "evaluation_version": EVALUATION_VERSION,
        "competency_scores": {
            "answer_relevance": 78,
            "specificity": 70,
            "structure": 74,
            "evidence_quality": 66,
            "impact_orientation": 68,
            "role_alignment": 76,
            "communication_clarity": 82,
            "adaptability": 72,
        },
        "module_scores": {key: 75 for key in module_keys},
        "readiness": {
            "level": "developing",
            "hire_signal": "lean_no",
            "summary": "evidence-backed readiness summary",
            "blockers": ["specific blocker, or an empty array"],
            "strongest_signals": ["specific positive signal, or an empty array"],
        },
        "weakest_area": "specific competency name that most limits readiness",
        "strongest_area": "specific competency name with the clearest evidence",
        "improvement_tip": "one concise, high-impact coaching tip grounded in the transcript",
        "coaching_summary": "2-3 sentences summarizing performance with specific transcript evidence",
        "actionable_next_steps": [
            "specific practice action 1",
            "specific practice action 2",
            "specific practice action 3",
        ],
        "risk_flags": ["specific job-readiness concern from the transcript, or an empty array"],
        "red_flags": ["same high-risk concerns, or an empty array"],
        "practice_plan": ["specific drill 1", "specific drill 2", "specific drill 3"],
        "evaluator_confidence": 78,
        "question_evaluations": [
            {
                "question": "exact interviewer question text",
                "answer_summary": "brief neutral summary of the candidate answer",
                "answer_type": "partial",
                "score": 72,
                "competency_scores": _build_competency_example(72),
                "evidence_quotes": ["exact quote copied from the candidate answer"],
                "missed_opportunity": "what would have improved this answer",
                "coaching_note": "brief coaching assessment",
                "practice_drill": "one practice drill for this question",
            }
        ],
    }
    return json.dumps(schema, indent=2)


def _load_json_object(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            raise
        data = json.loads(text[start:end + 1])
    if not isinstance(data, dict):
        raise ValueError("Evaluation output must be a JSON object")
    return data


def _shorten(text: str, limit: int = 220) -> str:
    clean = " ".join(str(text or "").split())
    if len(clean) <= limit:
        return clean
    return clean[: limit - 3].rstrip() + "..."


def _evidence_snippet(text: str, limit: int = 180) -> str:
    clean = " ".join(str(text or "").split())
    return clean[:limit].rstrip()


def _word_count(text: str) -> int:
    return len(str(text or "").split())


def _timestamp_ms(message: dict[str, Any]) -> Optional[float]:
    value = message.get("timestamp")
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _is_timeout_message(message: dict[str, Any]) -> bool:
    content = str(message.get("content", ""))
    return bool(message.get("isTimeout")) or content.startswith("[TIMEOUT:")


def _skip_transcript_message(message: dict[str, Any]) -> bool:
    if not isinstance(message, dict):
        return True
    if message.get("isTyping") or message.get("isNudge"):
        return True
    content = str(message.get("content", "")).strip()
    if not content or content == "...":
        return True
    role = message.get("role")
    if role not in {"assistant", "user"}:
        return True
    if message.get("isHidden") and not _is_timeout_message(message):
        return True
    return False


def build_transcript_analysis(messages: list[dict]) -> dict[str, Any]:
    """Pair interviewer prompts with candidate answers and compute deterministic features."""
    pairs: list[dict[str, Any]] = []
    pending_question: Optional[dict[str, Any]] = None
    timeout_count = 0
    response_times: list[float] = []

    for message in messages or []:
        if _skip_transcript_message(message):
            continue

        role = message.get("role")
        content = " ".join(str(message.get("content", "")).split())
        timestamp = _timestamp_ms(message)

        if role == "assistant":
            pending_question = {
                "question": content,
                "timestamp": timestamp,
                "is_interruption": bool(message.get("isInterruption")),
                "is_curveball": bool(message.get("isCurveball")),
            }
            continue

        if role == "user":
            is_timeout = _is_timeout_message(message)
            if is_timeout:
                timeout_count += 1

            question = pending_question or {
                "question": "Candidate response",
                "timestamp": None,
                "is_interruption": False,
                "is_curveball": False,
            }
            answer = "" if is_timeout or message.get("isHidden") else content
            response_seconds = None
            if timestamp is not None and question.get("timestamp") is not None:
                response_seconds = max(0, (timestamp - question["timestamp"]) / 1000)
                response_times.append(response_seconds)

            pairs.append({
                "question": question["question"],
                "answer": answer,
                "answer_type": "missing" if not answer else "complete",
                "word_count": _word_count(answer),
                "response_seconds": response_seconds,
                "is_timeout": is_timeout,
                "is_interruption": question.get("is_interruption", False),
                "is_curveball": question.get("is_curveball", False),
            })
            pending_question = None

    if pending_question:
        pairs.append({
            "question": pending_question["question"],
            "answer": "",
            "answer_type": "missing",
            "word_count": 0,
            "response_seconds": None,
            "is_timeout": False,
            "is_interruption": pending_question.get("is_interruption", False),
            "is_curveball": pending_question.get("is_curveball", False),
        })

    answered_pairs = [pair for pair in pairs if pair.get("answer")]
    word_counts = [pair["word_count"] for pair in answered_pairs]
    features = {
        "question_count": len(pairs),
        "answer_count": len(answered_pairs),
        "missing_answer_count": len(pairs) - len(answered_pairs),
        "timeout_count": timeout_count,
        "word_counts": word_counts,
        "avg_word_count": round(sum(word_counts) / len(word_counts)) if word_counts else 0,
        "min_word_count": min(word_counts) if word_counts else 0,
        "max_word_count": max(word_counts) if word_counts else 0,
        "has_timestamps": bool(response_times),
        "avg_response_time_seconds": round(sum(response_times) / len(response_times), 1) if response_times else 0,
        "interruption_count": len([pair for pair in pairs if pair.get("is_interruption")]),
        "curveball_count": len([pair for pair in pairs if pair.get("is_curveball")]),
    }
    return {"pairs": pairs, "features": features}


def _normalize_for_match(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "").strip()).casefold()


def _quote_in_answer(quote: str, answer: str) -> bool:
    normalized_quote = _normalize_for_match(quote)
    if not normalized_quote or normalized_quote == _normalize_for_match(NO_EVIDENCE):
        return True
    return normalized_quote in _normalize_for_match(answer)


def _matching_pairs(question: str, pairs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    q_norm = _normalize_for_match(question)
    exact = [pair for pair in pairs if _normalize_for_match(pair.get("question", "")) == q_norm]
    if exact:
        return exact
    partial = [
        pair for pair in pairs
        if q_norm and (
            q_norm in _normalize_for_match(pair.get("question", "")) or
            _normalize_for_match(pair.get("question", "")) in q_norm
        )
    ]
    return partial or pairs


def validate_evidence_quotes(feedback: dict[str, Any], transcript_pairs: Optional[list[dict[str, Any]]] = None) -> None:
    if not transcript_pairs:
        return
    for item in feedback.get("question_evaluations", []):
        quotes = item.get("evidence_quotes") or []
        if item.get("answer_type") in MISSING_ANSWER_TYPES and not quotes:
            continue
        candidates = _matching_pairs(item.get("question", ""), transcript_pairs)
        for quote in quotes:
            if quote == NO_EVIDENCE:
                continue
            if not any(_quote_in_answer(quote, pair.get("answer", "")) for pair in candidates):
                raise ValueError(
                    f"evidence quote is not present in the paired candidate answer: {quote!r}"
                )


def parse_evaluation_response(
    raw: str,
    transcript_pairs: Optional[list[dict[str, Any]]] = None,
    transcript_features: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    data = _load_json_object(raw)
    feedback = EvaluationV3.model_validate(data).to_feedback_dict(transcript_features=transcript_features)
    validate_evidence_quotes(feedback, transcript_pairs)
    return clean_feedback_display_text(feedback)


def build_evaluation_repair_prompt(module: str = "general") -> str:
    mod = MODULE_CRITERIA.get(module, MODULE_CRITERIA["general"])
    module_keys = list(mod["extra_criteria"].keys())
    return (
        "You repair invalid interview-evaluation JSON. Return ONLY valid JSON, no markdown and no commentary. "
        "Force the result to match the V3 schema exactly. All scores must be integers from 0 to 100. "
        "Every evidence_quotes item must be copied exactly from the paired candidate answer. "
        "If exact evidence is absent, use an empty evidence_quotes array and set answer_type to missing, evasive, or partial. "
        "Missing, evasive, or harmful answers must score 39 or lower.\n\n"
        "Required JSON schema example:\n"
        f"{_build_evaluation_json_schema(module_keys)}"
    )


def _messages_by_role(messages: list[dict], role: str) -> list[str]:
    return [
        str(message.get("content", ""))
        for message in messages
        if isinstance(message, dict)
        and message.get("role") == role
        and message.get("content")
        and not _skip_transcript_message(message)
    ]


def _fallback_competencies(base_score: int) -> dict[str, int]:
    return {key: base_score for key in COMPETENCY_KEYS}


def build_evaluation_fallback(error_detail: str, messages: list[dict]) -> dict[str, Any]:
    analysis = build_transcript_analysis(messages)
    pairs = analysis["pairs"]
    features = analysis["features"]
    answered = [pair for pair in pairs if pair.get("answer")]
    has_answer = bool(answered)
    base_score = 48 if has_answer else 30
    first_pair = pairs[0] if pairs else {
        "question": "Interview response",
        "answer": "",
        "answer_type": "missing",
    }
    first_answer = first_pair.get("answer", "")
    first_question = first_pair.get("question", "Interview response")
    evidence = _evidence_snippet(first_answer) if first_answer else NO_EVIDENCE

    competency_scores = _fallback_competencies(base_score)
    question_score = base_score if first_answer else 30
    question_eval = {
        "question": _shorten(first_question, 220),
        "answer_summary": _shorten(first_answer, 180) if first_answer else "No candidate answer captured.",
        "answer_type": "partial" if first_answer else "missing",
        "score": question_score,
        "competency_scores": _fallback_competencies(question_score),
        "evidence_quotes": [evidence] if first_answer else [],
        "missed_opportunity": "Detailed missed-opportunity analysis unavailable because evaluation validation failed.",
        "coaching_note": "Detailed assessment unavailable because evaluation validation failed.",
        "practice_drill": "Retry evaluation, then practice one concise STAR answer.",
    }

    feedback = {
        "evaluation_version": EVALUATION_VERSION,
        "evaluation_error": True,
        "evaluation_error_detail": _shorten(error_detail, 500),
        "competency_scores": competency_scores,
        "interview_scores": derive_interview_scores(competency_scores),
        "module_scores": {},
        "readiness": {
            "level": "developing" if has_answer else "not_ready",
            "hire_signal": "lean_no" if has_answer else "strong_no",
            "summary": "A structured fallback was generated because the evaluator output could not be validated.",
            "blockers": ["Evaluation output could not be validated."],
            "strongest_signals": ["Session contained candidate answers."] if has_answer else [],
        },
        "weakest_area": "Evaluation Reliability",
        "strongest_area": "Session completed" if has_answer else "",
        "improvement_tip": "Review the transcript manually, confirm qwen2.5:7b is running, then retry evaluation.",
        "coaching_summary": (
            "A structured fallback was generated because qwen2.5:7b did not return valid V3 evaluation JSON. "
            "The score is a conservative placeholder, not a final assessment."
        ),
        "actionable_next_steps": [
            "Retry evaluation after confirming qwen2.5:7b is running.",
            "Review the transcript manually for missed evidence.",
            "Practice one concise STAR answer before the next session.",
        ],
        "risk_flags": ["Evaluation output could not be validated."],
        "red_flags": ["Evaluation output could not be validated."],
        "practice_plan": [
            "Retry the evaluation.",
            "Add one metric to the strongest answer.",
            "Prepare one tighter role-aligned example.",
        ],
        "question_evaluations": [question_eval],
        "question_highlights": derive_question_highlights([question_eval]),
        "transcript_features": features,
        "evaluator_confidence": 25,
    }
    return feedback


def build_evaluation_prompt(
    target_role: str,
    module: str = "general",
    job_description: str = "",
    presence_data: Optional[dict] = None,
    transcript_features: Optional[dict[str, Any]] = None,
) -> str:
    mod = MODULE_CRITERIA.get(module, MODULE_CRITERIA["general"])
    jd_section = f"\n\n## Job Description\n{job_description}" if job_description else ""
    module_keys = list(mod["extra_criteria"].keys())

    module_section = ""
    if module_keys:
        module_section = f"\n### Module-Specific Criteria for {mod['label']} (score each 0-100):\n"
        for i, (key, desc) in enumerate(mod["extra_criteria"].items(), 1):
            module_section += f"{i}. **{key}** - {desc}\n"

    presence_section = ""
    if presence_data and presence_data.get("composite", 0) > 0:
        presence_section = (
            "\n\n## Body Language Summary (pre-scored by camera analysis)\n"
            f"- Eye Contact: {presence_data.get('eye_contact', 0)}/100\n"
            f"- Facial Expression: {presence_data.get('expression', 0)}/100\n"
            f"- Posture: {presence_data.get('posture', 0)}/100\n"
            f"- Gestures: {presence_data.get('gestures', 0)}/100\n"
            f"- Composite Presence Score: {presence_data.get('composite', 0)}/100\n"
            "Reference these in coaching only when relevant. Do not re-score body language.\n"
        )

    feature_section = ""
    if transcript_features:
        feature_section = (
            "\n\n## Deterministic Transcript Features\n"
            f"{json.dumps(transcript_features, indent=2)}\n"
        )

    competency_section = (
        "### Core Competencies (score each 0-100)\n"
        "1. answer_relevance - Directly answers the exact question asked.\n"
        "2. specificity - Uses concrete examples, context, and details.\n"
        "3. structure - Uses STAR or another clear, logical organization.\n"
        "4. evidence_quality - Provides proof, metrics, outcomes, or examples.\n"
        "5. impact_orientation - Connects actions to business, user, team, or technical outcomes.\n"
        "6. role_alignment - Matches the target role and job description.\n"
        "7. communication_clarity - Is concise, understandable, and professional.\n"
        "8. adaptability - Handles follow-ups, pressure, ambiguity, and interruptions.\n"
    )

    return (
        f"You are a strict but practical interview evaluator specializing in {mod['label']} interviews. "
        f"You are evaluating a candidate for the role of '{target_role}'."
        f"{jd_section}\n\n"
        "Use a Job-Readiness + Evidence style: calibrated, direct, useful, and transcript-backed. "
        "Do not inflate scores. A merely okay answer is usually 50-60. "
        "Score calibration: 90-100 exceptional and interview-ready; 75-89 strong with minor gaps; "
        "60-74 adequate but needs polish; 40-59 weak or incomplete; 0-39 missing, evasive, or harmful.\n\n"
        "You will receive paired interviewer questions and candidate answers. Evaluate only those pairs. "
        "Every evidence_quotes item must be an exact quote copied from the paired candidate answer. "
        "Do not invent details or use quotes from the interviewer. If there is no usable quote, use an empty evidence_quotes array. "
        "Missing, evasive, or harmful answers must use answer_type missing/evasive/harmful and score 39 or lower.\n\n"
        "## Evaluation Criteria\n\n"
        f"{competency_section}"
        f"{module_section}"
        f"{presence_section}"
        f"{feature_section}"
        "\n## Output Format\n"
        "Return ONLY valid JSON matching this V3 structure. Do not include markdown or commentary. "
        "Include at most 6 question_evaluations, prioritizing the most important answered, missing, or risky questions:\n"
        f"{_build_evaluation_json_schema(module_keys)}"
    )


def _readiness_from_score(score: int) -> tuple[str, str]:
    if score >= 90:
        return "interview_ready", "strong_yes"
    if score >= 85:
        return "interview_ready", "yes"
    if score >= 75:
        return "near_ready", "lean_yes"
    if score >= 60:
        return "developing", "lean_no"
    if score >= 40:
        return "developing", "no"
    return "not_ready", "strong_no"


def _interview_score_from_feedback(interview_feedback: dict[str, Any]) -> int:
    competency_scores = interview_feedback.get("competency_scores")
    module_scores = interview_feedback.get("module_scores", {})
    module_vals = list(module_scores.values()) if module_scores else []

    if competency_scores:
        competency_avg = _avg([int(competency_scores.get(key, 0)) for key in COMPETENCY_KEYS])
        if module_vals:
            return round(competency_avg * 0.75 + _avg(module_vals) * 0.25)
        return competency_avg

    interview_scores = interview_feedback.get("interview_scores", {})
    base_keys = ["responsiveness", "depth", "clarity", "communication_style"]
    base_scores = [interview_scores.get(key, 0) for key in base_keys if key in interview_scores]
    if module_vals:
        base_avg = sum(base_scores) / len(base_scores) if base_scores else 0
        return round(base_avg * 0.60 + _avg(module_vals) * 0.40)
    return round(sum(base_scores) / len(base_scores)) if base_scores else 0


def merge_scores(
    interview_feedback: dict,
    presence_data: Optional[dict] = None,
    engagement_data: Optional[dict] = None,
    camera_on: bool = True,
) -> dict:
    interview_scores = interview_feedback.get("interview_scores", {})
    competency_scores = interview_feedback.get("competency_scores", {})
    module_scores = interview_feedback.get("module_scores", {})
    interview_score = _interview_score_from_feedback(interview_feedback)

    presence_score = 0
    has_presence = False
    if camera_on and presence_data and presence_data.get("composite", 0) > 0:
        presence_score = presence_data["composite"]
        has_presence = True

    engagement_score = 0
    has_engagement = False
    if engagement_data and engagement_data.get("composite", 0) > 0:
        engagement_score = engagement_data["composite"]
        has_engagement = True

    if has_presence and has_engagement:
        final_score = round(interview_score * 0.55 + presence_score * 0.25 + engagement_score * 0.20)
    elif has_engagement:
        final_score = round(interview_score * 0.70 + engagement_score * 0.30)
    else:
        final_score = interview_score

    readiness = dict(interview_feedback.get("readiness") or {})
    readiness["level"], readiness["hire_signal"] = _readiness_from_score(final_score)

    result = {
        "evaluation_version": interview_feedback.get("evaluation_version", EVALUATION_VERSION),
        "overall_score": final_score,
        "grade": get_grade(final_score),
        "pillars": {
            "interview": {
                "score": interview_score,
                "weight": 0.55 if has_presence else (0.70 if has_engagement else 1.0),
                "scores": interview_scores,
                "competency_scores": competency_scores,
                "module_scores": module_scores,
            },
        },
        "competency_scores": competency_scores,
        "readiness": readiness,
        "weakest_area": interview_feedback.get("weakest_area", ""),
        "strongest_area": interview_feedback.get("strongest_area", ""),
        "improvement_tip": interview_feedback.get("improvement_tip", ""),
        "coaching_summary": interview_feedback.get("coaching_summary", ""),
        "actionable_next_steps": interview_feedback.get("actionable_next_steps", []),
        "red_flags": interview_feedback.get("red_flags", []),
        "risk_flags": interview_feedback.get("risk_flags", []),
        "practice_plan": interview_feedback.get("practice_plan", []),
        "question_evaluations": interview_feedback.get("question_evaluations", []),
        "question_highlights": interview_feedback.get("question_highlights", []),
        "transcript_features": interview_feedback.get("transcript_features", {}),
        "evaluator_confidence": interview_feedback.get("evaluator_confidence", 70),
    }

    if interview_feedback.get("evaluation_error"):
        result["evaluation_error"] = True
        result["evaluation_error_detail"] = interview_feedback.get("evaluation_error_detail", "")

    if has_presence:
        result["pillars"]["presence"] = {
            "score": presence_score,
            "weight": 0.25,
            "metrics": presence_data,
        }

    if has_engagement:
        result["pillars"]["engagement"] = {
            "score": engagement_score,
            "weight": 0.20 if has_presence else 0.30,
            "metrics": engagement_data,
        }

    return result
