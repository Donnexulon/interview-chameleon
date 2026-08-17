import edge_tts
import uuid
import os

class TTSService:
    # Map characters/genders to Edge-TTS voices
    # Use English Neural voices
    VOICE_MAP = {
        "female": "en-US-JennyNeural",
        "male": "en-US-GuyNeural",
        # Default or fallback
        "default": "en-US-AriaNeural"
    }

    @staticmethod
    async def generate_audio(text: str, gender: str) -> str:
        voice = TTSService.VOICE_MAP.get(gender.lower(), TTSService.VOICE_MAP["default"])
        
        # Generate a unique temporary file path for the audio
        output_filename = f"tts_{uuid.uuid4().hex}.mp3"
        output_path = os.path.join(os.path.dirname(__file__), "..", "static", "audio", output_filename)
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        communicate = edge_tts.Communicate(text, voice)
        await communicate.save(output_path)
        
        return output_filename
