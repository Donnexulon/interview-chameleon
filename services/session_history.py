import sqlite3
import json
from typing import List, Dict, Any, Optional

class SessionHistory:
    def __init__(self, db_path: str = "interview.db"):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        """Initialize the SQLite database schema."""
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    date TEXT NOT NULL,
                    target_role TEXT NOT NULL,
                    duration_seconds INTEGER NOT NULL,
                    messages TEXT NOT NULL,
                    feedback TEXT
                )
            ''')
            # Add module column if it doesn't exist
            try:
                cursor.execute("ALTER TABLE sessions ADD COLUMN module TEXT DEFAULT 'general'")
            except sqlite3.OperationalError:
                pass # Column already exists
            conn.commit()
        finally:
            conn.close()

    def save_session(self, session_data: dict):
        """Save a new interview session or update existing."""
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT OR REPLACE INTO sessions (id, date, target_role, module, duration_seconds, messages, feedback)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (
                session_data["id"],
                session_data["date"],
                session_data["target_role"],
                session_data.get("module", "general"),
                session_data["duration_seconds"],
                json.dumps(session_data["messages"]),
                json.dumps(session_data.get("feedback", {}))
            ))
            conn.commit()
        finally:
            conn.close()

    def get_all_sessions(self) -> List[dict]:
        """Retrieve all recorded interview sessions."""
        conn = sqlite3.connect(self.db_path)
        try:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM sessions ORDER BY date DESC")
            rows = cursor.fetchall()

            sessions = []
            for row in rows:
                keys = row.keys()
                sessions.append({
                    "id": row["id"],
                    "date": row["date"],
                    "target_role": row["target_role"],
                    "module": row["module"] if "module" in keys else "general",
                    "duration_seconds": row["duration_seconds"],
                    "messages": json.loads(row["messages"]),
                    "feedback": json.loads(row["feedback"]) if row["feedback"] else None
                })
            return sessions
        finally:
            conn.close()

    def clear_all_sessions(self):
        """Delete all recorded interview sessions."""
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM sessions")
            conn.commit()
        finally:
            conn.close()

    def get_session(self, session_id: str) -> Optional[dict]:
        """Retrieve a specific session by ID."""
        conn = sqlite3.connect(self.db_path)
        try:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
            row = cursor.fetchone()

            if row:
                keys = row.keys()
                return {
                    "id": row["id"],
                    "date": row["date"],
                    "target_role": row["target_role"],
                    "module": row["module"] if "module" in keys else "general",
                    "duration_seconds": row["duration_seconds"],
                    "messages": json.loads(row["messages"]),
                    "feedback": json.loads(row["feedback"]) if row["feedback"] else None
                }
            return None
        finally:
            conn.close()

    def delete_session(self, session_id: str):
        """Delete a specific session."""
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            conn.commit()
        finally:
            conn.close()
