"""Small, local-only preference store with atomic writes."""

from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Any

from services.app_paths import get_app_paths
from services.model_catalog import DEFAULT_MODEL_ID, normalize_model_id


DEFAULT_PREFERENCES: dict[str, Any] = {
    "portfolio_network_consent": False,
    "keep_resume_with_history": False,
    "voice_enabled": True,
    "preferred_voice": "",
    "camera_coaching": False,
    "reduced_motion": False,
    "high_contrast": False,
    "text_scale": 100,
    "setup_completed": False,
    "selected_model": DEFAULT_MODEL_ID,
    "model_setup_completed": False,
    # WebView2 is served from a random loopback port on every desktop launch,
    # so browser localStorage alone is not durable across process restarts.
    # These bounded values are the small pieces of UI progress that are not
    # already stored in the session/question databases.
    "theme": "dark",
    "question_favorites": [],
    "minigame_runs": [],
    "minigame_bests": {},
    "industries_used": [],
    "faang_sessions": 0,
    "no_timeout_sessions": 0,
    "earned_badges": [],
}
ALLOWED_KEYS = frozenset(DEFAULT_PREFERENCES)


class PreferencesStore:
    def __init__(self, path: str | Path | None = None):
        self.path = Path(path) if path else get_app_paths().preferences
        self._lock = threading.RLock()

    def get(self) -> dict[str, Any]:
        with self._lock:
            values = dict(DEFAULT_PREFERENCES)
            if self.path.exists():
                try:
                    loaded = json.loads(self.path.read_text(encoding="utf-8"))
                    if isinstance(loaded, dict):
                        values.update({key: value for key, value in loaded.items() if key in ALLOWED_KEYS})
                except (OSError, UnicodeError, json.JSONDecodeError):
                    pass
            return self._validate(values)

    def update(self, changes: dict[str, Any]) -> dict[str, Any]:
        unknown = set(changes) - ALLOWED_KEYS
        if unknown:
            raise ValueError(f"Unsupported preference: {sorted(unknown)[0]}")
        with self._lock:
            values = self.get()
            values.update(changes)
            values = self._validate(values)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            descriptor, temporary = tempfile.mkstemp(prefix="preferences-", suffix=".json", dir=self.path.parent)
            try:
                with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                    json.dump(values, handle, ensure_ascii=False, indent=2, sort_keys=True)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary, self.path)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
            return values

    def reset(self) -> dict[str, Any]:
        with self._lock:
            self.path.unlink(missing_ok=True)
            return dict(DEFAULT_PREFERENCES)

    @staticmethod
    def _validate(values: dict[str, Any]) -> dict[str, Any]:
        for key in (
            "portfolio_network_consent",
            "keep_resume_with_history",
            "voice_enabled",
            "camera_coaching",
            "reduced_motion",
            "high_contrast",
            "setup_completed",
            "model_setup_completed",
        ):
            values[key] = bool(values.get(key, DEFAULT_PREFERENCES[key]))
        values["selected_model"] = normalize_model_id(values.get("selected_model"))
        values["preferred_voice"] = str(values.get("preferred_voice") or "")[:240]
        try:
            values["text_scale"] = max(100, min(200, int(values.get("text_scale", 100))))
        except (TypeError, ValueError):
            values["text_scale"] = 100
        values["theme"] = "light" if values.get("theme") == "light" else "dark"
        values["question_favorites"] = _bounded_string_list(
            values.get("question_favorites"), maximum=500, item_length=128
        )
        values["industries_used"] = _bounded_string_list(
            values.get("industries_used"), maximum=64, item_length=80
        )
        values["earned_badges"] = _bounded_string_list(
            values.get("earned_badges"), maximum=128, item_length=80
        )
        values["faang_sessions"] = _bounded_counter(values.get("faang_sessions"))
        values["no_timeout_sessions"] = _bounded_counter(values.get("no_timeout_sessions"))
        values["minigame_runs"] = _bounded_minigame_runs(values.get("minigame_runs"))
        values["minigame_bests"] = _bounded_minigame_bests(values.get("minigame_bests"))
        return {key: values[key] for key in DEFAULT_PREFERENCES}


def _bounded_counter(value: Any) -> int:
    try:
        return max(0, min(1_000_000, int(value)))
    except (TypeError, ValueError, OverflowError):
        return 0


def _bounded_score(value: Any) -> int:
    try:
        return max(0, min(100, round(float(value))))
    except (TypeError, ValueError, OverflowError):
        return 0


def _bounded_string_list(value: Any, *, maximum: int, item_length: int) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    seen: set[str] = set()
    for item in value[:maximum]:
        text = str(item or "")[:item_length]
        if text and text not in seen:
            result.append(text)
            seen.add(text)
    return result


def _bounded_json(value: Any, *, depth: int = 0) -> Any:
    """Retain useful drill detail without allowing an unbounded preference file."""
    if depth >= 4:
        return None
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value if abs(value) <= 1_000_000_000 else 0
    if isinstance(value, str):
        return value[:1_000]
    if isinstance(value, list):
        return [_bounded_json(item, depth=depth + 1) for item in value[:20]]
    if isinstance(value, dict):
        return {
            str(key)[:80]: _bounded_json(item, depth=depth + 1)
            for key, item in list(value.items())[:30]
        }
    return str(value)[:1_000]


def _bounded_minigame_runs(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    result: list[dict[str, Any]] = []
    for item in value[:60]:
        if not isinstance(item, dict):
            continue
        game = str(item.get("game") or "")[:24]
        if game not in {"blitz", "star", "salary"}:
            continue
        scores = item.get("competency_scores")
        bounded_scores = {
            str(key)[:80]: _bounded_score(score)
            for key, score in list(scores.items())[:24]
        } if isinstance(scores, dict) else {}
        result.append({
            "id": str(item.get("id") or "")[:128],
            "game": game,
            "created_at": str(item.get("created_at") or "")[:64],
            "score": _bounded_score(item.get("score")),
            "competency_scores": bounded_scores,
            "summary": str(item.get("summary") or "")[:1_000],
            "strengths": _bounded_string_list(item.get("strengths"), maximum=4, item_length=400),
            "improvements": _bounded_string_list(item.get("improvements"), maximum=4, item_length=400),
            "raw": _bounded_json(item.get("raw") if isinstance(item.get("raw"), dict) else {}),
        })
    return result


def _bounded_minigame_bests(value: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(value, dict):
        return {}
    result: dict[str, dict[str, Any]] = {}
    for game in ("blitz", "star", "salary"):
        best = value.get(game)
        if not isinstance(best, dict):
            continue
        record: dict[str, Any] = {
            "score": _bounded_score(best.get("score")),
            "date": str(best.get("date") or "")[:64],
        }
        if game == "salary":
            try:
                record["gain"] = max(-1_000_000_000, min(1_000_000_000, round(float(best.get("gain", 0)))))
            except (TypeError, ValueError, OverflowError):
                record["gain"] = 0
        result[game] = record
    return result
