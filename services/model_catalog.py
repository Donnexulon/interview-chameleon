"""Approved local AI models exposed by Interview Chameleon."""

from __future__ import annotations

from typing import Any


DEFAULT_MODEL_ID = "qwen2.5:7b"

# Keep this list deliberately small. Model downloads are an executable runtime
# boundary, so API callers may choose only products reviewed for this release.
MODEL_CATALOG: tuple[dict[str, Any], ...] = (
    {
        "id": DEFAULT_MODEL_ID,
        "name": "Qwen 2.5 7B",
        "size_gb": 4.7,
        "badge": "Most reliable",
        "description": "The best choice for this beta. Fully tested for interviews and feedback.",
        "speed": "Balanced",
        "certified": True,
        "experimental": False,
    },
    {
        "id": "qwen3.5:4b",
        "name": "Qwen 3.5 4B",
        "size_gb": 3.4,
        "badge": "Smaller and faster",
        "description": "A newer, lighter option for quicker responses. Still being calibrated.",
        "speed": "Fast",
        "certified": False,
        "experimental": False,
    },
    {
        "id": "granite3.3:8b",
        "name": "Granite 3.3 8B",
        "size_gb": 4.9,
        "badge": "Structured feedback",
        "description": "A strong fit for business interviews and clearly organized feedback.",
        "speed": "Balanced",
        "certified": False,
        "experimental": False,
    },
    {
        "id": "phi4-mini-reasoning:3.8b",
        "name": "Phi-4 Mini Reasoning",
        "size_gb": 3.2,
        "badge": "Deep reasoning",
        "description": "A compact option for technical questions, analysis, and case interviews.",
        "speed": "Thoughtful",
        "certified": False,
        "experimental": False,
    },
)

SUPPORTED_MODEL_IDS = frozenset(item["id"] for item in MODEL_CATALOG)


def public_model_catalog() -> list[dict[str, Any]]:
    """Return copies so request handlers cannot mutate the process catalog."""
    return [dict(item) for item in MODEL_CATALOG]


def normalize_model_id(value: Any, *, fallback: str = DEFAULT_MODEL_ID) -> str:
    candidate = str(value or "").strip()
    return candidate if candidate in SUPPORTED_MODEL_IDS else fallback


def model_names_match(required: str, available: str) -> bool:
    """Match Ollama names case-insensitively, including an implicit latest tag."""
    expected = str(required or "").strip().casefold()
    actual = str(available or "").strip().casefold()
    if not expected or not actual:
        return False
    if actual == expected:
        return True
    final_segment = expected.rsplit("/", 1)[-1]
    return ":" not in final_segment and actual == f"{expected}:latest"


def model_available(model_id: str, available_models: list[str]) -> bool:
    return any(model_names_match(model_id, available) for available in available_models)
