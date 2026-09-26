"""Local role and candidate-context analysis for grounded interviews.

The analyser deliberately uses deterministic text rules instead of asking the
language model to infer the hiring bar on every turn. Its output is compact,
explainable, cacheable, and shared by question planning and evaluation.
"""

from __future__ import annotations

import copy
import hashlib
import re
from functools import lru_cache
from typing import Any, Optional


ROLE_INTELLIGENCE_VERSION = "v1_role_grounding"
MAX_CONTEXT_CHARS = 60_000


SKILL_CATALOG: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("product strategy", "product", ("product strategy", "product vision", "roadmap", "roadmapping")),
    ("product discovery", "product", ("product discovery", "customer discovery", "user research", "customer interviews")),
    ("prioritization", "product", ("prioritization", "prioritisation", "backlog", "rice framework", "moscow")),
    ("go-to-market", "product", ("go-to-market", "go to market", "gtm", "product launch")),
    ("stakeholder management", "leadership", ("stakeholder management", "stakeholder alignment", "cross-functional", "cross functional")),
    ("people leadership", "leadership", ("people management", "people leadership", "team leadership", "managed a team", "direct reports")),
    ("executive communication", "leadership", ("executive communication", "board presentation", "c-suite", "executive stakeholders")),
    ("project management", "delivery", ("project management", "program management", "delivery management", "project planning")),
    ("agile delivery", "delivery", ("agile", "scrum", "kanban", "sprint planning")),
    ("risk management", "delivery", ("risk management", "risk assessment", "risk mitigation", "controls")),
    ("software architecture", "engineering", ("software architecture", "system architecture", "system design", "distributed systems")),
    ("backend engineering", "engineering", ("backend", "back-end", "server-side", "microservices", "api development")),
    ("frontend engineering", "engineering", ("frontend", "front-end", "react", "vue", "angular")),
    ("mobile engineering", "engineering", ("mobile development", "ios", "android", "react native", "flutter")),
    ("cloud infrastructure", "engineering", ("cloud", "aws", "azure", "gcp", "kubernetes", "terraform")),
    ("devops", "engineering", ("devops", "ci/cd", "continuous integration", "continuous delivery", "sre")),
    ("databases", "engineering", ("database", "databases", "sql", "postgresql", "mysql", "nosql")),
    ("security", "engineering", ("security", "cybersecurity", "application security", "threat modeling", "oauth")),
    ("testing", "engineering", ("software testing", "automated testing", "test automation", "unit tests", "integration tests", "quality assurance")),
    ("observability", "engineering", ("observability", "monitoring", "logging", "tracing", "incident response")),
    ("python", "technology", ("python",)),
    ("javascript", "technology", ("javascript", "typescript", "node.js", "nodejs")),
    ("java", "technology", ("java", "spring boot", "spring framework")),
    ("c#/.net", "technology", ("c#", ".net", "asp.net", "dotnet")),
    ("data analysis", "data", ("data analysis", "analytics", "business intelligence", "tableau", "power bi")),
    ("data engineering", "data", ("data engineering", "etl", "data pipeline", "spark", "airflow")),
    ("machine learning", "data", ("machine learning", "ml engineering", "deep learning", "model training")),
    ("generative ai", "data", ("generative ai", "large language model", "llm", "prompt engineering", "rag")),
    ("experimentation", "data", ("experimentation", "a/b testing", "ab testing", "hypothesis testing")),
    ("statistics", "data", ("statistics", "statistical", "regression analysis", "forecasting")),
    ("ux design", "design", ("ux design", "user experience", "interaction design", "wireframing", "prototyping")),
    ("ui design", "design", ("ui design", "user interface", "visual design", "design system")),
    ("accessibility", "design", ("accessibility", "wcag", "inclusive design", "screen reader")),
    ("service design", "design", ("service design", "journey mapping", "customer journey", "service blueprint")),
    ("sales", "commercial", ("sales", "quota", "pipeline management", "account executive", "business development")),
    ("negotiation", "commercial", ("negotiation", "contract negotiation", "commercial terms", "deal closing")),
    ("customer success", "commercial", ("customer success", "account management", "customer retention", "renewals")),
    ("marketing", "commercial", ("marketing", "growth marketing", "demand generation", "brand strategy")),
    ("financial analysis", "business", ("financial analysis", "financial modeling", "financial modelling", "budgeting", "p&l")),
    ("strategy", "business", ("business strategy", "corporate strategy", "strategic planning", "market analysis")),
    ("operations", "business", ("operations", "operational excellence", "process improvement", "supply chain")),
    ("healthcare compliance", "domain", ("hipaa", "clinical compliance", "patient safety", "healthcare regulation")),
    ("financial compliance", "domain", ("finra", "sec compliance", "aml", "kyc", "basel iii")),
)

ACTION_VERBS = {
    "achieved", "analyzed", "built", "coached", "created", "cut", "delivered", "designed",
    "developed", "drove", "grew", "implemented", "improved", "increased", "launched", "led",
    "managed", "migrated", "negotiated", "optimized", "owned", "planned", "reduced", "resolved",
    "saved", "scaled", "shipped", "simplified", "transformed",
}
RESPONSIBILITY_VERBS = {
    "build", "collaborate", "create", "define", "deliver", "design", "develop", "drive", "ensure",
    "establish", "evaluate", "improve", "lead", "manage", "mentor", "own", "partner", "prioritize",
    "scale", "support", "test",
}
REQUIREMENT_CUES = ("required", "must", "minimum", "you have", "you will", "responsible for", "qualifications")
PREFERENCE_CUES = ("preferred", "nice to have", "ideally", "bonus")


def _clean_text(value: Any) -> str:
    text = str(value or "").replace("\x00", " ")[:MAX_CONTEXT_CHARS]
    text = re.sub(r"[\t\r ]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _segments(text: str) -> list[str]:
    pieces: list[str] = []
    for line in _clean_text(text).splitlines():
        line = re.sub(r"^[\s•●▪◦*-]+", "", line).strip()
        if not line:
            continue
        for sentence in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9])", line):
            normalized = " ".join(sentence.split()).strip(" -")
            if 2 <= len(normalized.split()) <= 80:
                pieces.append(normalized[:500])
    return pieces


def _contains_alias(text: str, alias: str) -> bool:
    pattern = r"(?<![a-z0-9])" + re.escape(alias.lower()).replace(r"\ ", r"\s+") + r"(?![a-z0-9])"
    return bool(re.search(pattern, text.lower()))


def _skill_matches(text: str) -> list[dict[str, str]]:
    matches = []
    for name, category, aliases in SKILL_CATALOG:
        matched_alias = next((alias for alias in aliases if _contains_alias(text, alias)), None)
        if matched_alias:
            matches.append({"name": name, "category": category, "matched_as": matched_alias})
    return matches


def _seniority(target_role: str, job_description: str) -> str:
    text = f"{target_role} {job_description}".lower()
    if re.search(r"\b(?:chief|c-suite|vice president|vp|head of|executive director)\b", text):
        return "executive"
    if re.search(r"\b(?:principal|staff|lead|senior|sr\.?|director)\b", text):
        return "senior"
    if re.search(r"\b(?:junior|jr\.?|entry[- ]level|graduate|intern)\b", text):
        return "entry"
    return "mid"


def _years_required(job_description: str) -> Optional[int]:
    number_words = {
        "one": 1,
        "two": 2,
        "three": 3,
        "four": 4,
        "five": 5,
        "six": 6,
        "seven": 7,
        "eight": 8,
        "nine": 9,
        "ten": 10,
        "eleven": 11,
        "twelve": 12,
        "fifteen": 15,
        "twenty": 20,
    }
    tokens = re.findall(
        r"\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)"
        r"\s*\+?\s*(?:years?|yrs?)\b",
        job_description,
        re.I,
    )
    values = [int(token) if token.isdigit() else number_words[token.lower()] for token in tokens]
    return max(values) if values else None


def _requirement_score(segment: str) -> int:
    lower = segment.lower()
    words = set(re.findall(r"[a-z][a-z+#.-]+", lower))
    score = 0
    if any(cue in lower for cue in REQUIREMENT_CUES):
        score += 5
    if any(cue in lower for cue in PREFERENCE_CUES):
        score += 2
    score += min(3, len(_skill_matches(segment)))
    if words & RESPONSIBILITY_VERBS:
        score += 3
    if re.search(r"\b\d{1,2}\s*\+?\s*(?:years?|yrs?)\b", lower):
        score += 2
    return score


def _is_contact_or_heading(segment: str) -> bool:
    if "@" in segment or re.search(r"(?:https?://|linkedin\.com|github\.com|\+?\d[\d\s().-]{7,}\d)", segment, re.I):
        return True
    return len(segment.split()) <= 3 and not _skill_matches(segment)


def _achievement_score(segment: str) -> int:
    lower = segment.lower()
    words = set(re.findall(r"[a-z]+", lower))
    score = min(2, len(_skill_matches(segment)))
    if words & ACTION_VERBS:
        score += 3
    if re.search(r"(?:\b\d+(?:\.\d+)?\s*%|[$€£]\s*\d|\b\d+(?:\.\d+)?\s*(?:users?|customers?|days?|weeks?|months?|years?|ms)\b)", segment, re.I):
        score += 4
    if any(term in lower for term in ("result", "impact", "revenue", "conversion", "cost", "latency", "retention")):
        score += 2
    return score


def _skill_evidence(skill_name: str, resume_segments: list[str]) -> str:
    definition = next((item for item in SKILL_CATALOG if item[0] == skill_name), None)
    if not definition:
        return ""
    aliases = definition[2]
    candidates = [segment for segment in resume_segments if any(_contains_alias(segment, alias) for alias in aliases)]
    if not candidates:
        return ""
    candidates.sort(key=lambda item: (_achievement_score(item), len(item)), reverse=True)
    return candidates[0][:280]


def _target_id(kind: str, label: str) -> str:
    digest = hashlib.sha256(f"{kind}|{label}".encode("utf-8")).hexdigest()[:10]
    return f"{kind}-{digest}"


@lru_cache(maxsize=96)
def _analyze_cached(target_role: str, job_description: str, resume_text: str) -> dict[str, Any]:
    jd_segments = _segments(job_description)
    resume_segments = [segment for segment in _segments(resume_text) if not _is_contact_or_heading(segment)]
    jd_skill_rows = _skill_matches(job_description)
    resume_skill_rows = _skill_matches(resume_text)
    resume_skill_names = {row["name"] for row in resume_skill_rows}

    requirements = sorted(
        ({"text": segment, "priority": _requirement_score(segment)} for segment in jd_segments),
        key=lambda item: (item["priority"], len(item["text"])),
        reverse=True,
    )
    requirements = [item for item in requirements if item["priority"] >= 3][:10]
    achievements = sorted(
        ({"text": segment, "strength": _achievement_score(segment)} for segment in resume_segments),
        key=lambda item: (item["strength"], len(item["text"])),
        reverse=True,
    )
    achievements = [item for item in achievements if item["strength"] >= 3][:8]

    job_skills = []
    for row in jd_skill_rows:
        matching_requirements = [
            item for item in requirements
            if _contains_alias(item["text"], row["matched_as"])
        ]
        explicitly_required = any(
            any(cue in item["text"].lower() for cue in REQUIREMENT_CUES)
            for item in matching_requirements
        )
        explicitly_preferred = any(
            any(cue in item["text"].lower() for cue in PREFERENCE_CUES)
            for item in matching_requirements
        )
        evidence = _skill_evidence(row["name"], resume_segments)
        job_skills.append({
            "name": row["name"],
            "category": row["category"],
            "importance": "preferred" if explicitly_preferred and not explicitly_required else "required",
            "priority": max((item["priority"] for item in matching_requirements), default=1),
            "resume_evidence": evidence,
            "status": "evidenced" if row["name"] in resume_skill_names else "not_evidenced",
        })
    job_skills.sort(
        key=lambda item: (item["importance"] == "required", item["priority"]),
        reverse=True,
    )
    jd_skill_names = [row["name"] for row in job_skills]

    matched = [row["name"] for row in job_skills if row["status"] == "evidenced"]
    not_evidenced = [row["name"] for row in job_skills if row["status"] == "not_evidenced"] if resume_text else []
    coverage = round(len(matched) / len(job_skills) * 100) if job_skills and resume_text else None

    targets = []
    prioritized_skills = [*not_evidenced[:4], *matched[:3]]
    if job_description and not resume_text:
        prioritized_skills = jd_skill_names[:6]
    elif resume_text and not job_description:
        prioritized_skills = [row["name"] for row in resume_skill_rows[:4]]

    for skill in prioritized_skills:
        row = next((item for item in job_skills if item["name"] == skill), None)
        if row is None:
            resume_row = next(item for item in resume_skill_rows if item["name"] == skill)
            row = {
                "name": skill,
                "category": resume_row["category"],
                "resume_evidence": _skill_evidence(skill, resume_segments),
                "status": "evidenced",
            }
        kind = (
            "not_evidenced" if row["status"] == "not_evidenced" and resume_text
            else "validate_evidence" if row["status"] == "evidenced" or not job_description
            else "requirement_skill"
        )
        targets.append({
            "id": _target_id(kind, skill),
            "type": kind,
            "label": skill,
            "reason": (
                "Important job skill not explicitly evidenced in the supplied resume. Test it without assuming absence."
                if kind == "not_evidenced"
                else "Job skill appears in the resume. Ask for specific proof and measurable impact."
                if kind == "validate_evidence"
                else "Important skill named in the job description. Establish the candidate's applied evidence."
            ),
            "source_text": row["resume_evidence"],
        })
    for requirement in requirements[:4]:
        if len(targets) >= 8:
            break
        label = requirement["text"][:140]
        requirement_words = set(re.findall(r"[a-z]+", label.lower()))
        if not _skill_matches(label) and not (requirement_words & RESPONSIBILITY_VERBS):
            continue
        targets.append({
            "id": _target_id("requirement", label),
            "type": "requirement",
            "label": label,
            "reason": "High-priority responsibility or qualification from the job description.",
            "source_text": label,
        })

    if not targets:
        targets.append({
            "id": _target_id("role", target_role),
            "type": "role_baseline",
            "label": target_role or "professional role",
            "reason": "No detailed job description was supplied; establish role-relevant evidence.",
            "source_text": "",
        })

    status = "job_and_resume" if job_description and resume_text else "job_only" if job_description else "resume_only" if resume_text else "role_only"
    return {
        "version": ROLE_INTELLIGENCE_VERSION,
        "status": status,
        "job_profile": {
            "target_role": target_role or "professional role",
            "seniority": _seniority(target_role, job_description),
            "minimum_years": _years_required(job_description),
            "skills": job_skills,
            "priority_requirements": requirements,
        },
        "candidate_profile": {
            "skills": resume_skill_rows,
            "evidence_highlights": achievements,
        },
        "alignment": {
            "matched_skills": matched,
            "not_evidenced_skills": not_evidenced,
            "skill_coverage_percent": coverage,
            "interpretation": "Not evidenced means absent from the supplied resume, not that the candidate lacks the skill.",
        },
        "question_targets": targets,
    }


def analyze_role_context(
    target_role: str,
    job_description: str = "",
    resume_text: str = "",
) -> dict[str, Any]:
    """Return a defensive copy of cached local role intelligence."""
    return copy.deepcopy(_analyze_cached(
        _clean_text(target_role)[:160],
        _clean_text(job_description),
        _clean_text(resume_text),
    ))


def compact_role_context(role_intelligence: Optional[dict[str, Any]]) -> dict[str, Any]:
    """Reduce the full analysis to the evidence needed inside model prompts."""
    intelligence = role_intelligence or {}
    job = intelligence.get("job_profile") or {}
    candidate = intelligence.get("candidate_profile") or {}
    alignment = intelligence.get("alignment") or {}
    return {
        "version": intelligence.get("version", ROLE_INTELLIGENCE_VERSION),
        "status": intelligence.get("status", "role_only"),
        "seniority": job.get("seniority", "mid"),
        "minimum_years": job.get("minimum_years"),
        "job_skills": [item.get("name") for item in (job.get("skills") or [])[:12]],
        "priority_requirements": [item.get("text") for item in (job.get("priority_requirements") or [])[:6]],
        "resume_evidence_highlights": [item.get("text") for item in (candidate.get("evidence_highlights") or [])[:5]],
        "matched_skills": (alignment.get("matched_skills") or [])[:10],
        "not_evidenced_skills": (alignment.get("not_evidenced_skills") or [])[:10],
        "question_targets": (intelligence.get("question_targets") or [])[:8],
        "evidence_rule": "Resume claims personalize questions but never count as proof of an interview answer.",
    }
