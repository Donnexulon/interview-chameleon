import json
import asyncio
import requests
from typing import Generator, Dict, Any, Optional
from concurrent.futures import ThreadPoolExecutor

# Shared thread pool for blocking Ollama calls
_ollama_executor = ThreadPoolExecutor(max_workers=4)

ACTIVE_MODEL = "qwen2.5:7b"

# Model role defaults
MODEL_DEFAULTS = {
    "interviewer": ACTIVE_MODEL,
    "evaluator": ACTIVE_MODEL,
    "fallback": ACTIVE_MODEL,
}


class OllamaClient:
    def __init__(self, base_url: str = "http://localhost:11434"):
        self.base_url = base_url
        self.api_url = f"{self.base_url}/api"

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

    def is_model_available(self, model_name: str) -> bool:
        """Check if a specific model is available locally."""
        available = self.list_models()
        # Match with or without :latest tag
        for m in available:
            if m == model_name or m == f"{model_name}:latest" or m.startswith(f"{model_name}:"):
                return True
        return False

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

    def generate_json(self, model: str, messages: list[dict], system_prompt: Optional[str] = None) -> str:
        """Generate a non-streaming chat response (for structured output like JSON).
        
        WARNING: This is a blocking call. Callers in async endpoints should use
        generate_json_async() instead to avoid blocking the event loop.
        """
        payload = {
            "model": model,
            "messages": messages,
            "stream": False,
            "format": "json"
        }
        if system_prompt:
            payload["messages"] = [{"role": "system", "content": system_prompt}] + messages

        try:
            response = requests.post(f"{self.api_url}/chat", json=payload, timeout=120)
            response.raise_for_status()
            data = response.json()
            return data.get("message", {}).get("content", "{}")
        except requests.RequestException as e:
            return json.dumps({"error": str(e)})

    async def generate_json_async(self, model: str, messages: list[dict], system_prompt: Optional[str] = None) -> str:
        """Non-blocking async wrapper around generate_json. Use from async endpoints."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            _ollama_executor,
            lambda: self.generate_json(model, messages, system_prompt)
        )

    async def generate_chat(self, model: str, messages: list[dict], system_prompt: Optional[str] = None) -> dict:
        """Generate a non-streaming, plain-text chat response (for ideal-answer etc)."""
        payload = {
            "model": model,
            "messages": messages,
            "stream": False,
        }
        if system_prompt:
            payload["messages"] = [{"role": "system", "content": system_prompt}] + messages
        try:
            loop = asyncio.get_running_loop()
            response = await loop.run_in_executor(
                _ollama_executor,
                lambda: requests.post(f"{self.api_url}/chat", json=payload, timeout=120)
            )
            response.raise_for_status()
            data = response.json()
            return {"content": data.get("message", {}).get("content", "")}
        except requests.RequestException as e:
            return {"content": f"Error: {str(e)}"}
