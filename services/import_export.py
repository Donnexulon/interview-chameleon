import json
from typing import Dict, Any

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
        try:
            data = json.loads(json_string)
            if not isinstance(data, dict):
                raise ValueError("Invalid format: Root must be a dictionary")
            return {
                "sessions": data.get("sessions", []),
                "questions": data.get("questions", [])
            }
        except Exception as e:
            raise ValueError(f"Failed to parse import data: {str(e)}")
