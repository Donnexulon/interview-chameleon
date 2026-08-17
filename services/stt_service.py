import whisper
import asyncio
import os

class STTService:
    def __init__(self, model_size="small"):
        self.model_size = model_size
        self.model = None

    def _load_model(self):
        if self.model is None:
            print(f"Loading Whisper model '{self.model_size}'...")
            self.model = whisper.load_model(self.model_size)
            print("Whisper model loaded.")

    async def transcribe_audio(self, file_path: str) -> str:
        # Load lazily
        self._load_model()
        
        # Run the transcription in a thread pool to avoid blocking the async event loop
        loop = asyncio.get_running_loop()
        
        def _transcribe():
            result = self.model.transcribe(file_path)
            return result["text"].strip()
            
        return await loop.run_in_executor(None, _transcribe)
