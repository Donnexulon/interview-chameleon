"""Lazy CPU-friendly speech recognition using faster-whisper/PyAV."""

from __future__ import annotations

import asyncio
import importlib.util
import os
from pathlib import Path

from services.app_paths import get_app_paths


class SpeechPackMissing(RuntimeError):
    pass


class STTService:
    def __init__(self, model_size: str = "small.en"):
        self.model_size = model_size
        self.model = None

    def status(self) -> dict:
        runtime_ready = importlib.util.find_spec("faster_whisper") is not None
        configured = os.getenv("INTERVIEW_CHAMELEON_WHISPER_MODEL")
        model_path = Path(configured) if configured else get_app_paths().models / "faster-whisper-small.en"
        return {
            "ready": bool(runtime_ready and model_path.exists()),
            "runtime_ready": runtime_ready,
            "model_installed": model_path.exists(),
            "model": self.model_size,
            "optional": True,
        }

    def _load_model(self):
        if self.model is not None:
            return
        status = self.status()
        if not status["runtime_ready"]:
            raise SpeechPackMissing("Speech input runtime is not installed")
        if not status["model_installed"]:
            raise SpeechPackMissing("The optional English speech pack is not installed")
        from faster_whisper import WhisperModel
        configured = os.getenv("INTERVIEW_CHAMELEON_WHISPER_MODEL")
        model_path = Path(configured) if configured else get_app_paths().models / "faster-whisper-small.en"
        self.model = WhisperModel(str(model_path), device="cpu", compute_type="int8", local_files_only=True)

    async def transcribe_audio(self, file_path: str) -> str:
        self._load_model()
        loop = asyncio.get_running_loop()

        def _transcribe() -> str:
            segments, _ = self.model.transcribe(file_path, language="en", vad_filter=True, beam_size=3)
            return " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()

        return await loop.run_in_executor(None, _transcribe)
