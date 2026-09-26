"""Rotating structured logs that never intentionally include user content."""

from __future__ import annotations

import json
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any


SENSITIVE_KEYS = {
    "answer", "answers", "messages", "resume", "resume_text", "transcript",
    "url", "portfolio_url", "token", "authorization", "cookie", "system_prompt",
}


def redact(value: Any, key: str = "") -> Any:
    if key.casefold() in SENSITIVE_KEYS:
        return "[REDACTED]"
    if isinstance(value, dict):
        return {str(k): redact(v, str(k)) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, str) and len(value) > 500:
        return f"[TEXT {len(value)} chars]"
    return value


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "time": self.formatTime(record, "%Y-%m-%dT%H:%M:%SZ"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for name in ("request_id", "event", "context"):
            if hasattr(record, name):
                payload[name] = redact(getattr(record, name), name)
        if record.exc_info:
            payload["exception"] = record.exc_info[0].__name__
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def configure_logging(log_dir: Path) -> logging.Logger:
    log_dir.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("interview_chameleon")
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        handler = RotatingFileHandler(
            log_dir / "app.jsonl",
            maxBytes=2 * 1024 * 1024,
            backupCount=5,
            encoding="utf-8",
        )
        handler.setFormatter(JsonFormatter())
        logger.addHandler(handler)
    logger.propagate = False
    return logger


def recent_sanitized_errors(log_dir: Path, limit: int = 100) -> list[dict[str, Any]]:
    """Read only already-redacted error metadata for a diagnostics export."""
    safe_limit = max(1, min(int(limit), 100))
    records: list[dict[str, Any]] = []
    paths = sorted(log_dir.glob("app.jsonl*"), key=lambda path: path.stat().st_mtime)
    for path in paths:
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for line in lines:
            try:
                record = json.loads(line)
            except (json.JSONDecodeError, TypeError):
                continue
            if str(record.get("level") or "").upper() not in {"ERROR", "CRITICAL"}:
                continue
            # Redact again as a defence against a legacy or manually edited log.
            sanitized = redact(record)
            records.append({
                key: sanitized[key]
                for key in ("time", "level", "event", "request_id", "context", "exception")
                if key in sanitized
            })
    return records[-safe_limit:]
