"""System readiness, local preferences, maintenance, and model setup routes."""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from services.app_paths import get_app_paths
from services.logging_config import recent_sanitized_errors
from services.ollama_client import is_ollama_installed
from services.model_catalog import (
    DEFAULT_MODEL_ID,
    SUPPORTED_MODEL_IDS,
    model_available,
    normalize_model_id,
    public_model_catalog,
)
from services.system_status import build_system_status, diagnostics_json


class PreferencesUpdate(BaseModel):
    portfolio_network_consent: Optional[bool] = None
    keep_resume_with_history: Optional[bool] = None
    voice_enabled: Optional[bool] = None
    preferred_voice: Optional[str] = Field(default=None, max_length=240)
    camera_coaching: Optional[bool] = None
    reduced_motion: Optional[bool] = None
    high_contrast: Optional[bool] = None
    text_scale: Optional[int] = Field(default=None, ge=100, le=200)
    setup_completed: Optional[bool] = None
    theme: Optional[Literal["dark", "light"]] = None
    question_favorites: Optional[list[str]] = Field(default=None, max_length=500)
    minigame_runs: Optional[list[dict[str, Any]]] = Field(default=None, max_length=60)
    minigame_bests: Optional[dict[str, dict[str, Any]]] = Field(default=None, max_length=3)
    industries_used: Optional[list[str]] = Field(default=None, max_length=64)
    faang_sessions: Optional[int] = Field(default=None, ge=0, le=1_000_000)
    no_timeout_sessions: Optional[int] = Field(default=None, ge=0, le=1_000_000)
    earned_badges: Optional[list[str]] = Field(default=None, max_length=128)


class ResetRequest(BaseModel):
    confirmation: Literal["DELETE ALL LOCAL DATA"]


class ModelChoiceRequest(BaseModel):
    model: str = Field(min_length=1, max_length=160)


def _approved_model(model_name: str) -> str:
    if model_name not in SUPPORTED_MODEL_IDS:
        raise HTTPException(status_code=422, detail="Choose one of the four models shown in the app")
    return model_name


def create_system_router(
    *,
    get_ollama: Callable[[], Any],
    get_history: Callable[[], Any],
    get_preferences: Callable[[], Any],
    get_stt: Callable[[], Any],
) -> APIRouter:
    router = APIRouter()

    @router.get("/api/system/status")
    async def system_status():
        ollama = get_ollama()
        status = build_system_status(ollama, get_stt().status(), get_preferences().get())
        status["model_queue"] = getattr(ollama, "queue_status", {"active": 0, "waiting": 0, "capacity": 1})
        return status

    @router.get("/api/preferences")
    async def preferences():
        return {"preferences": get_preferences().get()}

    @router.put("/api/preferences")
    async def update_preferences(request: PreferencesUpdate):
        changes = request.model_dump(exclude_unset=True)
        try:
            saved = get_preferences().update(changes)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {"preferences": saved}

    @router.get("/api/diagnostics/export")
    async def export_diagnostics():
        status = build_system_status(get_ollama(), get_stt().status(), get_preferences().get())
        recent_errors = recent_sanitized_errors(get_app_paths().logs)
        return StreamingResponse(
            iter([diagnostics_json(status, recent_errors)]),
            media_type="application/json",
            headers={"Content-Disposition": "attachment; filename=interview-chameleon-diagnostics.json"},
        )

    @router.get("/api/system/database/integrity")
    async def database_integrity():
        return get_history().integrity_check()

    @router.post("/api/system/database/backup")
    async def backup_database():
        backup = get_history().backup_database("manual")
        return {"created": bool(backup), "path": backup}

    @router.post("/api/system/reset")
    async def reset_local_data(request: ResetRequest):
        get_history().backup_database("pre-reset")
        get_history().reset_user_data()
        get_preferences().reset()
        return {"status": "reset", "recoverable_backup_created": True}

    @router.post("/api/system/shutdown")
    async def shutdown_local_backend(request: Request):
        callback = getattr(request.app.state, "shutdown_callback", None)
        if callback is None:
            raise HTTPException(status_code=409, detail="Shutdown is controlled by the development server")
        callback()
        return {"status": "shutting_down"}

    @router.get("/api/models")
    async def models():
        ollama = get_ollama()
        connected = ollama.check_connection()
        installed = connected or is_ollama_installed()
        available = ollama.list_models() if connected else []
        preferences = get_preferences().get()
        selected = normalize_model_id(preferences.get("selected_model"))
        catalog = public_model_catalog()
        for item in catalog:
            item["installed"] = model_available(item["id"], available)
        return {
            "ollama_connected": connected,
            "ollama_installed": installed,
            "available": available,
            "catalog": catalog,
            "selected_model": selected,
            "model_setup_completed": bool(preferences.get("model_setup_completed")),
            "selected_ready": connected and model_available(selected, available),
            "has_supported_model": any(item["installed"] for item in catalog),
        }

    @router.get("/api/setup/status")
    async def setup_status():
        ollama = get_ollama()
        connected = ollama.check_connection()
        installed = connected or is_ollama_installed()
        available = ollama.list_models() if connected else []
        preferences = get_preferences().get()
        selected = normalize_model_id(preferences.get("selected_model"))
        has_selected = model_available(selected, available) if connected else False
        installed_supported = [
            item["id"] for item in public_model_catalog() if model_available(item["id"], available)
        ]
        ready = connected and has_selected and bool(preferences.get("model_setup_completed"))
        if ready:
            status_message = "Your selected local AI is installed and ready."
        elif connected:
            status_message = "Choose and download a local AI model to continue."
        elif installed:
            status_message = "Ollama is not reachable. Start Ollama locally, then refresh status."
        else:
            status_message = "Ollama is not installed. Install Ollama, then refresh status."
        return {
            "ollama_connected": connected,
            "ollama_installed": installed,
            "models_available": available,
            "recommended_model": DEFAULT_MODEL_ID,
            "selected_model": selected,
            "has_selected": has_selected,
            "installed_supported_models": installed_supported,
            "has_any_model": bool(available),
            "has_supported_model": bool(installed_supported),
            "model_setup_completed": bool(preferences.get("model_setup_completed")),
            "ready": ready,
            "status_message": status_message,
        }

    @router.post("/api/setup/pull")
    async def pull_model(request: ModelChoiceRequest):
        ollama = get_ollama()
        model_name = _approved_model(request.model)
        if not ollama.check_connection():
            raise HTTPException(status_code=503, detail="Ollama is not running")

        def stream_progress():
            failed = False
            for progress in ollama.pull_model_stream(model_name):
                event = {**progress, "model": model_name}
                if str(progress.get("status") or "").casefold().startswith("error"):
                    failed = True
                yield f"data: {json.dumps(event)}\n\n"
            if not failed:
                yield f"data: {json.dumps({'status': 'complete', 'percent': 100, 'model': model_name})}\n\n"

        return StreamingResponse(
            stream_progress(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @router.post("/api/models/select")
    async def select_model(request: ModelChoiceRequest):
        model_name = _approved_model(request.model)
        ollama = get_ollama()
        if not ollama.check_connection():
            raise HTTPException(status_code=503, detail="Ollama is not running")
        if not ollama.is_model_available(model_name):
            raise HTTPException(status_code=409, detail="Download this model before selecting it")
        saved = get_preferences().update({
            "selected_model": model_name,
            "model_setup_completed": True,
        })
        return {"selected_model": model_name, "preferences": saved}

    @router.post("/api/system/inference-check")
    async def inference_check():
        ollama = get_ollama()
        model = normalize_model_id(get_preferences().get().get("selected_model"))
        if not ollama.check_connection() or not ollama.is_model_available(model):
            raise HTTPException(status_code=503, detail=f"Ollama with {model} is required")
        started = time.monotonic()
        result = await ollama.generate_chat(
            model,
            [{"role": "user", "content": "Reply with exactly: ready"}],
            "This is a local performance check. Follow the user instruction exactly.",
        )
        elapsed = round(time.monotonic() - started, 2)
        succeeded = "ready" in str(result.get("content") or "").casefold()
        return {
            "ready": succeeded,
            "seconds": elapsed,
            "rating": "good" if elapsed <= 8 else "usable" if elapsed <= 20 else "slow",
            "model": model,
        }

    return router
