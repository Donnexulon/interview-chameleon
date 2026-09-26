import json
from typing import Dict, Any

MAX_IMPORT_BYTES = 10 * 1024 * 1024
MAX_IMPORT_SESSIONS = 5_000
MAX_IMPORT_QUESTIONS = 10_000

class ImportExport:
    @staticmethod
    def export_data(history_data: list, question_data: list) -> str:
        """Export all user data as a JSON string."""
        export_dict = {
            "version": "1.0",
            "sessions": history_data,
            "questions": question_data
        }
        return json.dumps(export_dict, indent=2)

    @staticmethod
    def parse_import_data(json_string: str) -> Dict[str, Any]:
        """Parse uploaded JSON string for importing."""
        if len(json_string.encode("utf-8")) > MAX_IMPORT_BYTES:
            raise ValueError("Import files may not exceed 10 MB")
        try:
            data = json.loads(json_string)
            if not isinstance(data, dict):
                raise ValueError("Invalid format: Root must be a dictionary")
            sessions = data.get("sessions", [])
            questions = data.get("questions", [])
            if not isinstance(sessions, list) or not isinstance(questions, list):
                raise ValueError("Invalid format: sessions and questions must be lists")
            if len(sessions) > MAX_IMPORT_SESSIONS or len(questions) > MAX_IMPORT_QUESTIONS:
                raise ValueError("Import contains too many records")
            for index, session in enumerate(sessions):
                if not isinstance(session, dict) or not session.get("id"):
                    raise ValueError(f"Invalid session at index {index}")
            for index, question in enumerate(questions):
                if not isinstance(question, dict):
                    raise ValueError(f"Invalid question at index {index}")
                if not all(question.get(key) for key in ("id", "category", "text")):
                    raise ValueError(f"Question at index {index} is missing required fields")
            return {
                "sessions": sessions,
                "questions": questions,
            }
        except (json.JSONDecodeError, UnicodeError) as e:
            raise ValueError(f"Failed to parse import data: {str(e)}")
