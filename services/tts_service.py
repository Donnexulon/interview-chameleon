"""Compatibility marker for the retired network TTS route."""


class TTSService:
    @staticmethod
    async def generate_audio(text: str, gender: str) -> str:
        raise RuntimeError("Online TTS is disabled; use a local WebView2 voice")
