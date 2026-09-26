"""Privacy-safe local capability and diagnostics reporting."""

from __future__ import annotations

import json
import os
import platform
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from services.app_paths import APP_VERSION, get_app_paths, is_packaged, sqlite_integrity_ok
from services.model_catalog import model_names_match, normalize_model_id


def _disk_status(path: Path) -> dict[str, Any]:
    usage = shutil.disk_usage(path)
    gib = 1024 ** 3
    return {
        "free_bytes": usage.free,
        "free_gib": round(usage.free / gib, 1),
        "minimum_free_gib": 10,
        "ready": usage.free >= 10 * gib,
    }


def build_system_status(ollama_client, speech_status: dict[str, Any], preferences: dict[str, Any]) -> dict[str, Any]:
    paths = get_app_paths()
    connected = ollama_client.check_connection()
    models = ollama_client.model_details() if connected else []
    required = normalize_model_id(preferences.get("selected_model"))
    model = next((item for item in models if model_names_match(required, item.get("name", ""))), None)
    disk = _disk_status(paths.root)
    memory_bytes = None
    try:
        import psutil  # Optional in development; included in packaged builds.
        memory_bytes = int(psutil.virtual_memory().total)
    except (ImportError, OSError):
        pass
    memory_ready = memory_bytes is None or memory_bytes >= 16 * 1024 ** 3
    capabilities = {
        "webview2": {"ready": True, "managed_by_desktop_shell": is_packaged()},
        "ollama": {"ready": connected},
        "model": {"ready": model is not None, "required": required, "details": model},
        "speech_input": speech_status,
        "local_voice": {"ready": None, "detected_in_webview": True},
        "portfolio_network": {"enabled": bool(preferences.get("portfolio_network_consent"))},
    }
    return {
        "app": {"name": "Interview Chameleon", "version": APP_VERSION, "packaged": is_packaged()},
        "platform": {"system": platform.system(), "release": platform.release(), "architecture": platform.machine()},
        "hardware": {
            "logical_cpu_count": os.cpu_count(),
            "memory_bytes": memory_bytes,
            "memory_ready": memory_ready,
            "disk": disk,
        },
        "storage": {"root": str(paths.root), "database": str(paths.database)},
        "capabilities": capabilities,
        "ready_for_ai_rehearsal": bool(connected and model is not None and disk["ready"] and memory_ready),
        "degraded_practice_available": True,
        "telemetry": False,
    }


def build_diagnostics(status: dict[str, Any], recent_errors: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    paths = get_app_paths()
    return {
        "schema": "interview-chameleon-diagnostics/v1",
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "status": status,
        "database_integrity": sqlite_integrity_ok(paths.database) if paths.database.exists() else True,
        "python": sys.version.split()[0],
        "recent_errors": list(recent_errors or [])[-100:],
        "privacy": {
            "includes_user_content": False,
            "excluded": ["resumes", "transcripts", "answers", "portfolio_urls", "launch_tokens"],
        },
    }


def diagnostics_json(status: dict[str, Any], recent_errors: list[dict[str, Any]] | None = None) -> str:
    return json.dumps(build_diagnostics(status, recent_errors), ensure_ascii=False, indent=2)
