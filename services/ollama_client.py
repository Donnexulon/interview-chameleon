import json
import asyncio
import os
import requests
import shutil
import threading
from pathlib import Path
from typing import Generator, Dict, Any, Optional
from concurrent.futures import ThreadPoolExecutor

from services.model_catalog import DEFAULT_MODEL_ID, model_available, model_names_match

# Shared thread pool for blocking Ollama calls
_ollama_executor = ThreadPoolExecutor(max_workers=4)
_heavy_inference_lock = threading.BoundedSemaphore(value=1)


class ModelQueueFull(RuntimeError):
    """Raised before work is submitted when the local inference queue is full."""

ACTIVE_MODEL = DEFAULT_MODEL_ID

# Model role defaults
MODEL_DEFAULTS = {
    "interviewer": ACTIVE_MODEL,
    "evaluator": ACTIVE_MODEL,
    "fallback": ACTIVE_MODEL,
}


def is_ollama_installed() -> bool:
    """Return whether the native Ollama application is present on Windows."""
    if shutil.which("ollama"):
        return True

    roots = []
    for variable, suffix in (
        ("LOCALAPPDATA", ("Programs", "Ollama")),
        ("ProgramFiles", ("Ollama",)),
        ("ProgramFiles(x86)", ("Ollama",)),
    ):
        if value := os.environ.get(variable):
            roots.append(Path(value).joinpath(*suffix))
    return any(
        executable.is_file()
        for root in roots
        for executable in (root / "ollama app.exe", root / "ollama.exe")
    )


class OllamaClient:
    def __init__(self, base_url: str = "http://localhost:11434"):
        self.base_url = base_url
        self.api_url = f"{self.base_url}/api"
        self._queue_guard = threading.Lock()
        self._queued_jobs = 0
        self._max_queued_jobs = 4

    def check_connection(self) -> bool:
        """Check if Ollama is running and accessible."""
        try:
            response = requests.get(self.base_url, timeout=2)
            return response.status_code == 200
        except requests.RequestException:
            return False

    def list_models(self) -> list[str]:
        """Get available models from local Ollama instance."""
        try:
            response = requests.get(f"{self.api_url}/tags", timeout=2)
            if response.status_code == 200:
                data = response.json()
                return [model["name"] for model in data.get("models", [])]
            return []
        except requests.RequestException:
            return []

    def model_details(self) -> list[dict[str, Any]]:
        """Return the small, non-sensitive subset used for readiness/cache keys."""
        try:
            response = requests.get(f"{self.api_url}/tags", timeout=2)
            response.raise_for_status()
            models = response.json().get("models", [])
            return [
                {
                    "name": str(model.get("name") or ""),
                    "digest": str(model.get("digest") or ""),
                    "size": int(model.get("size") or 0),
                    "modified_at": str(model.get("modified_at") or ""),
                }
                for model in models
                if isinstance(model, dict) and model.get("name")
            ]
        except (requests.RequestException, ValueError, TypeError):
            return []

    def model_digest(self, model_name: str = ACTIVE_MODEL) -> str:
        for model in self.model_details():
            name = model["name"]
            if model_names_match(model_name, name):
                return model.get("digest") or "unknown"
        return "unknown"

    def _reserve_queue_slot(self) -> None:
        with self._queue_guard:
            if self._queued_jobs >= self._max_queued_jobs:
                raise ModelQueueFull("Local AI is busy; retry after the current job finishes")
            self._queued_jobs += 1

    def _release_queue_slot(self) -> None:
        with self._queue_guard:
            self._queued_jobs = max(0, self._queued_jobs - 1)

    @property
    def queue_status(self) -> dict[str, int]:
        with self._queue_guard:
            return {"queued": self._queued_jobs, "limit": self._max_queued_jobs, "concurrency": 1}

    def is_model_available(self, model_name: str) -> bool:
        """Check if a specific model is available locally."""
        return model_available(model_name, self.list_models())

    def _model_is_loaded(self, model_name: str) -> bool:
        """Return whether Ollama currently has this model resident."""
        try:
            response = requests.get(f"{self.api_url}/ps", timeout=2)
            response.raise_for_status()
            models = response.json().get("models", [])
            return any(
                model_names_match(model_name, str(item.get("name") or ""))
                for item in models
                if isinstance(item, dict)
            )
        except (requests.RequestException, ValueError, TypeError):
            # Conservatively reset the model when residency cannot be read.
            return True

    def get_best_model(self, role: str = "interviewer") -> str:
        """Return the single configured local model for the requested role."""
        return MODEL_DEFAULTS.get(role, ACTIVE_MODEL)

    def pull_model_stream(self, model_name: str) -> Generator[dict, None, None]:
        """Pull a model from Ollama with streaming progress updates.
        Yields dicts with: status, completed, total, percent."""
        try:
            with requests.post(
                f"{self.api_url}/pull",
                json={"name": model_name, "stream": True},
                stream=True,
                timeout=600
            ) as response:
                response.raise_for_status()
                for line in response.iter_lines():
                    if line:
                        data = json.loads(line)
                        progress = {}
                        progress["status"] = data.get("status", "")
                        if "completed" in data and "total" in data:
                            progress["completed"] = data["completed"]
                            progress["total"] = data["total"]
                            progress["percent"] = round(
                                (data["completed"] / data["total"]) * 100, 1
                            ) if data["total"] > 0 else 0
                        yield progress
        except requests.RequestException as e:
            yield {"status": f"error: {str(e)}", "percent": 0}

    def _stream_chat_blocking(self, model: str, messages: list[dict], system_prompt: Optional[str] = None) -> list[str]:
        """Internal blocking method: collects streamed chunks from Ollama."""
        payload = {
            "model": model,
            "messages": messages,
            "stream": True
        }

        if system_prompt:
            payload["messages"] = [{"role": "system", "content": system_prompt}] + messages

        chunks = []
        try:
            with requests.post(f"{self.api_url}/chat", json=payload, stream=True) as response:
                response.raise_for_status()
                for line in response.iter_lines():
                    if line:
                        chunk = json.loads(line)
                        if "message" in chunk and "content" in chunk["message"]:
                            chunks.append(chunk["message"]["content"])
        except requests.RequestException as e:
            chunks.append(f"Error connecting to Ollama: {str(e)}")
        return chunks

    def generate_chat_stream(self, model: str, messages: list[dict], system_prompt: Optional[str] = None) -> Generator[str, None, None]:
        """Generate streaming chat response from Ollama.
        
        Note: This is a synchronous generator used inside FastAPI's StreamingResponse,
        which runs it in a threadpool automatically. No event-loop blocking occurs.
        """
        
        payload = {
            "model": model,
            "messages": messages,
            "stream": True
        }
        
        if system_prompt:
            # Prepend system prompt if it exists
            payload["messages"] = [{"role": "system", "content": system_prompt}] + messages

        self._reserve_queue_slot()
        try:
            # Keep the semaphore for the lifetime of the stream. Otherwise a
            # structured evaluation can start while a portfolio/chat response
            # is still consuming the single local model, causing stalls and
            # out-of-order responses on CPU-only machines.
            with _heavy_inference_lock:
                try:
                    with requests.post(f"{self.api_url}/chat", json=payload, stream=True, timeout=(10, 300)) as response:
                        response.raise_for_status()
                        for line in response.iter_lines():
                            if line:
                                chunk = json.loads(line)
                                if "message" in chunk and "content" in chunk["message"]:
                                    yield chunk["message"]["content"]
                except requests.RequestException as e:
                    yield f"Error connecting to Ollama: {str(e)}"
        finally:
            self._release_queue_slot()

    def generate_json(
        self,
        model: str,
        messages: list[dict],
        system_prompt: Optional[str] = None,
        options: Optional[dict[str, Any]] = None,
        format_schema: Optional[dict[str, Any]] = None,
        timeout_seconds: int = 120,
        keep_alive: Optional[Any] = None,
        cold_start: bool = False,
    ) -> str:
        """Generate a non-streaming chat response (for structured output like JSON).
        
        WARNING: This is a blocking call. Callers in async endpoints should use
        generate_json_async() instead to avoid blocking the event loop.
        """
        payload = {
            "model": model,
            "messages": messages,
            "stream": False,
            "format": format_schema or "json"
        }
        if options:
            payload["options"] = dict(options)
        if keep_alive is not None:
            payload["keep_alive"] = keep_alive
        if system_prompt:
            payload["messages"] = [{"role": "system", "content": system_prompt}] + messages

        try:
            if cold_start and self._model_is_loaded(model):
                unload = requests.post(
                    f"{self.api_url}/generate",
                    json={"model": model, "stream": False, "keep_alive": 0},
                    timeout=min(30, timeout_seconds),
                )
                unload.raise_for_status()
            response = requests.post(f"{self.api_url}/chat", json=payload, timeout=timeout_seconds)
            response.raise_for_status()
            data = response.json()
            return data.get("message", {}).get("content", "{}")
        except requests.RequestException as e:
            return json.dumps({"error": str(e)})

    async def generate_json_async(
        self,
        model: str,
        messages: list[dict],
        system_prompt: Optional[str] = None,
        options: Optional[dict[str, Any]] = None,
        format_schema: Optional[dict[str, Any]] = None,
        timeout_seconds: int = 120,
        keep_alive: Optional[Any] = None,
        cold_start: bool = False,
    ) -> str:
        """Non-blocking async wrapper around generate_json. Use from async endpoints."""
        self._reserve_queue_slot()
        loop = asyncio.get_running_loop()
        try:
            def _run_serialized() -> str:
                with _heavy_inference_lock:
                    return self.generate_json(
                        model,
                        messages,
                        system_prompt,
                        options,
                        format_schema,
                        timeout_seconds,
                        keep_alive,
                        cold_start,
                    )
            return await loop.run_in_executor(_ollama_executor, _run_serialized)
        finally:
            self._release_queue_slot()

    async def generate_chat(self, model: str, messages: list[dict], system_prompt: Optional[str] = None) -> dict:
        """Generate a non-streaming, plain-text chat response (for ideal-answer etc)."""
        payload = {
            "model": model,
            "messages": messages,
            "stream": False,
        }
        if system_prompt:
            payload["messages"] = [{"role": "system", "content": system_prompt}] + messages
        self._reserve_queue_slot()
        try:
            loop = asyncio.get_running_loop()
            def _run_serialized():
                with _heavy_inference_lock:
                    return requests.post(f"{self.api_url}/chat", json=payload, timeout=120)
            response = await loop.run_in_executor(_ollama_executor, _run_serialized)
            response.raise_for_status()
            data = response.json()
            return {"content": data.get("message", {}).get("content", "")}
        except requests.RequestException as e:
            return {"content": f"Error: {str(e)}"}
        finally:
            self._release_queue_slot()
