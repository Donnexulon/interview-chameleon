"""Durable local interview-session storage.

The store keeps enough state to resume an interrupted rehearsal and reproduce an
evaluation. Migrations are additive so databases created by older app builds
remain readable.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import tempfile
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator, Optional


SESSION_SCHEMA_VERSION = 7
SESSION_STATUSES = {
    "in_progress",
    "evaluating",
    "completed",
    "evaluation_failed",
    "abandoned",
}
RECOVERABLE_STATUSES = ("in_progress", "evaluating", "evaluation_failed")
MAX_SESSION_JSON_BYTES = 6_000_000
EVALUATION_REVIEW_VERDICTS = {
    "accurate",
    "too_harsh",
    "too_generous",
    "wrong_evidence",
}
SESSION_TRANSITIONS = {
    "in_progress": {"in_progress", "evaluating", "completed", "abandoned"},
    "evaluating": {"evaluating", "completed", "evaluation_failed", "in_progress", "abandoned"},
    "evaluation_failed": {"evaluation_failed", "evaluating", "in_progress", "abandoned"},
    "completed": {"completed"},
    "abandoned": {"abandoned", "in_progress"},
}
EVALUATION_JOB_STATUSES = {"queued", "running", "completed", "failed"}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _json_dump(value: Any, expected_type: type, default: Any) -> str:
    if value is None:
        value = default
    if not isinstance(value, expected_type):
        raise ValueError(f"Expected {expected_type.__name__} session data")
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > MAX_SESSION_JSON_BYTES:
        raise ValueError("Session data is too large")
    return encoded


def _json_load(value: Any, expected_type: type, default: Any) -> Any:
    if not value:
        return default
    try:
        parsed = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return default
    return parsed if isinstance(parsed, expected_type) else default


def _clean_text(value: Any, *, fallback: str = "", limit: int = 500) -> str:
    text = " ".join(str(value or "").replace("\x00", " ").split())
    return (text or fallback)[:limit]


def _validate_id(value: Any) -> str:
    session_id = str(value or "").strip()
    if not session_id or len(session_id) > 160 or not re.fullmatch(r"[A-Za-z0-9_.:-]+", session_id):
        raise ValueError("Invalid session id")
    return session_id


class SessionHistory:
    def __init__(self, db_path: str = "interview.db"):
        self.db_path = db_path
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout = 10000")
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        conn = self._connect()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _init_db(self) -> None:
        """Create the current schema and add missing columns in place."""
        self._backup_before_migration()
        with self._connection() as conn:
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    date TEXT NOT NULL,
                    target_role TEXT NOT NULL,
                    module TEXT NOT NULL DEFAULT 'general',
                    duration_seconds INTEGER NOT NULL DEFAULT 0,
                    messages TEXT NOT NULL DEFAULT '[]',
                    feedback TEXT,
                    status TEXT NOT NULL DEFAULT 'in_progress',
                    started_at TEXT,
                    updated_at TEXT,
                    completed_at TEXT,
                    settings TEXT NOT NULL DEFAULT '{}',
                    interview_plan TEXT,
                    role_intelligence TEXT,
                    evaluation_error TEXT,
                    evaluator_metadata TEXT,
                    schema_version INTEGER NOT NULL DEFAULT 3,
                    revision INTEGER NOT NULL DEFAULT 1
                )
                """
            )
            existing = {row["name"] for row in conn.execute("PRAGMA table_info(sessions)").fetchall()}
            migrations = {
                "module": "TEXT NOT NULL DEFAULT 'general'",
                "status": "TEXT NOT NULL DEFAULT 'in_progress'",
                "started_at": "TEXT",
                "updated_at": "TEXT",
                "completed_at": "TEXT",
                "settings": "TEXT NOT NULL DEFAULT '{}'",
                "interview_plan": "TEXT",
                "role_intelligence": "TEXT",
                "evaluation_error": "TEXT",
                "evaluator_metadata": "TEXT",
                "schema_version": f"INTEGER NOT NULL DEFAULT {SESSION_SCHEMA_VERSION}",
                "revision": "INTEGER NOT NULL DEFAULT 1",
            }
            status_was_added = "status" not in existing
            for column, declaration in migrations.items():
                if column not in existing:
                    conn.execute(f"ALTER TABLE sessions ADD COLUMN {column} {declaration}")

            if status_was_added:
                conn.execute(
                    """
                    UPDATE sessions
                    SET status = CASE
                        WHEN feedback IS NOT NULL AND feedback NOT IN ('', '{}', 'null') THEN 'completed'
                        ELSE 'in_progress'
                    END
                    """
                )
            conn.execute("UPDATE sessions SET started_at = COALESCE(started_at, date)")
            conn.execute("UPDATE sessions SET updated_at = COALESCE(updated_at, date)")
            conn.execute(
                "UPDATE sessions SET completed_at = COALESCE(completed_at, date) WHERE status = 'completed'"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_sessions_status_updated ON sessions(status, updated_at DESC)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_sessions_comparison ON sessions(target_role, module, status, date DESC)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS evaluation_reviews (
                    session_id TEXT NOT NULL,
                    question_index INTEGER NOT NULL,
                    verdict TEXT NOT NULL,
                    note TEXT NOT NULL DEFAULT '',
                    module TEXT NOT NULL DEFAULT 'general',
                    target_role TEXT NOT NULL DEFAULT 'General Candidate',
                    question_text TEXT NOT NULL DEFAULT '',
                    answer_text TEXT NOT NULL DEFAULT '',
                    evaluator_score INTEGER,
                    evidence_quotes TEXT NOT NULL DEFAULT '[]',
                    competency_scores TEXT NOT NULL DEFAULT '{}',
                    module_scores TEXT NOT NULL DEFAULT '{}',
                    evaluation_version TEXT NOT NULL DEFAULT '',
                    model_digest TEXT NOT NULL DEFAULT '',
                    rubric_version TEXT NOT NULL DEFAULT '',
                    prompt_version TEXT NOT NULL DEFAULT '',
                    scoring_engine_version TEXT NOT NULL DEFAULT '',
                    rubric_assessment TEXT NOT NULL DEFAULT '{}',
                    correctness TEXT NOT NULL DEFAULT '',
                    limiting_rule TEXT NOT NULL DEFAULT '',
                    verifier TEXT NOT NULL DEFAULT '{}',
                    confidence TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (session_id, question_index),
                    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
                )
                """
            )
            review_existing = {
                row["name"] for row in conn.execute("PRAGMA table_info(evaluation_reviews)").fetchall()
            }
            review_migrations = {
                "model_digest": "TEXT NOT NULL DEFAULT ''",
                "rubric_version": "TEXT NOT NULL DEFAULT ''",
                "prompt_version": "TEXT NOT NULL DEFAULT ''",
                "scoring_engine_version": "TEXT NOT NULL DEFAULT ''",
                "rubric_assessment": "TEXT NOT NULL DEFAULT '{}'",
                "correctness": "TEXT NOT NULL DEFAULT ''",
                "limiting_rule": "TEXT NOT NULL DEFAULT ''",
                "verifier": "TEXT NOT NULL DEFAULT '{}'",
                "confidence": "TEXT NOT NULL DEFAULT '{}'",
            }
            for column, declaration in review_migrations.items():
                if column not in review_existing:
                    conn.execute(f"ALTER TABLE evaluation_reviews ADD COLUMN {column} {declaration}")
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_evaluation_reviews_updated ON evaluation_reviews(updated_at DESC)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS evaluation_cache (
                    cache_key TEXT PRIMARY KEY,
                    evaluation_version TEXT NOT NULL,
                    model TEXT NOT NULL,
                    feedback TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    last_used_at TEXT NOT NULL,
                    hit_count INTEGER NOT NULL DEFAULT 0
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_evaluation_cache_used ON evaluation_cache(last_used_at DESC)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS session_turns (
                    session_id TEXT NOT NULL,
                    turn_id TEXT NOT NULL,
                    expected_revision INTEGER NOT NULL,
                    answer TEXT NOT NULL,
                    response TEXT,
                    created_at TEXT NOT NULL,
                    completed_at TEXT,
                    PRIMARY KEY (session_id, turn_id),
                    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS evaluation_jobs (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    progress INTEGER NOT NULL DEFAULT 0,
                    request_payload TEXT NOT NULL,
                    result TEXT,
                    error_code TEXT NOT NULL DEFAULT '',
                    error_message TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    started_at TEXT,
                    completed_at TEXT,
                    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_evaluation_jobs_status ON evaluation_jobs(status, created_at)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS migration_records (
                    schema_version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL,
                    app_version TEXT NOT NULL DEFAULT ''
                )
                """
            )
            conn.execute(
                "INSERT OR IGNORE INTO migration_records(schema_version, applied_at) VALUES (?, ?)",
                (SESSION_SCHEMA_VERSION, _utc_now()),
            )
            conn.execute("DROP INDEX IF EXISTS idx_evaluation_reviews_module_verdict")
            conn.execute("PRAGMA optimize")
            conn.execute(f"PRAGMA user_version = {SESSION_SCHEMA_VERSION}")

    def _backup_before_migration(self) -> None:
        """Make one verified SQLite backup before upgrading an existing database."""
        if self.db_path == ":memory:":
            return
        source = os.path.abspath(self.db_path)
        if not os.path.isfile(source) or os.path.getsize(source) == 0:
            return
        try:
            with closing(sqlite3.connect(source, timeout=5)) as conn:
                version = int(conn.execute("PRAGMA user_version").fetchone()[0])
                if version >= SESSION_SCHEMA_VERSION:
                    return
                backup_path = f"{source}.pre-v{SESSION_SCHEMA_VERSION}.bak"
                if os.path.exists(backup_path):
                    return
                with closing(sqlite3.connect(backup_path, timeout=5)) as backup:
                    conn.backup(backup)
                    if backup.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                        raise sqlite3.DatabaseError("Backup integrity check failed")
                    backup.commit()
        except sqlite3.Error as exc:
            raise RuntimeError("Database backup failed; migration was not started") from exc

    def _row_to_session(self, row: sqlite3.Row) -> dict[str, Any]:
        settings = _json_load(row["settings"], dict, {})
        feedback = _json_load(row["feedback"], dict, None)
        role_intelligence = _json_load(row["role_intelligence"], dict, None)
        session = {
            "id": row["id"],
            "date": row["date"],
            "target_role": row["target_role"],
            "module": row["module"] or "general",
            "duration_seconds": max(0, int(row["duration_seconds"] or 0)),
            "messages": _json_load(row["messages"], list, []),
            "feedback": feedback,
            "status": row["status"] if row["status"] in SESSION_STATUSES else "in_progress",
            "started_at": row["started_at"] or row["date"],
            "updated_at": row["updated_at"] or row["date"],
            "completed_at": row["completed_at"],
            "settings": settings,
            "interview_plan": _json_load(row["interview_plan"], dict, None),
            "role_intelligence": role_intelligence,
            "evaluation_error": row["evaluation_error"] or "",
            "evaluator_metadata": _json_load(row["evaluator_metadata"], dict, None),
            "schema_version": int(row["schema_version"] or SESSION_SCHEMA_VERSION),
            "revision": int(row["revision"] or 1),
        }
        session["difficulty"] = settings.get("difficulty", "medium")
        session["duration"] = settings.get("duration", "standard")
        session["industry"] = settings.get("industry", "general")
        session["interviewer_style"] = settings.get("interviewer_style", "friendly")
        session["faang_mode"] = bool(settings.get("faang_mode", False))
        session["interruptions_enabled"] = bool(settings.get("interruptions_enabled", False))
        session["resume_used"] = bool(
            settings.get("resume_text")
            or (role_intelligence or {}).get("status") in {"resume_only", "job_and_resume"}
        )
        return session

    def save_session(self, session_data: dict[str, Any]) -> dict[str, Any]:
        """Atomically create or update a session without erasing omitted fields."""
        if not isinstance(session_data, dict):
            raise ValueError("Session must be an object")
        session_id = _validate_id(session_data.get("id"))
        now = _utc_now()

        with self._connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            existing_row = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
            existing = self._row_to_session(existing_row) if existing_row else {}

            expected_revision = session_data.get("expected_revision")
            if expected_revision is not None and existing:
                if int(expected_revision) != int(existing.get("revision", 0)):
                    raise RuntimeError("revision_conflict")

            settings = dict(existing.get("settings") or {})
            incoming_settings = session_data.get("settings")
            if incoming_settings is not None:
                if not isinstance(incoming_settings, dict):
                    raise ValueError("Session settings must be an object")
                if incoming_settings.get("resume_text", object()) is None:
                    settings.pop("resume_text", None)
                    incoming_settings = {key: value for key, value in incoming_settings.items() if key != "resume_text"}
                settings.update(incoming_settings)

            feedback = session_data.get("feedback", existing.get("feedback"))
            if feedback is not None and not isinstance(feedback, dict):
                raise ValueError("Session feedback must be an object")
            messages = session_data.get("messages", existing.get("messages", []))
            if not isinstance(messages, list) or any(not isinstance(item, dict) for item in messages):
                raise ValueError("Session messages must be a list of objects")

            status = str(session_data.get("status") or existing.get("status") or "").strip().lower()
            if not status:
                status = "completed" if feedback else "in_progress"
            if status not in SESSION_STATUSES:
                raise ValueError(f"Unsupported session status: {status}")
            previous_status = existing.get("status")
            if previous_status and status not in SESSION_TRANSITIONS.get(previous_status, set()):
                raise ValueError(f"Invalid session transition: {previous_status} to {status}")

            date = str(session_data.get("date") or existing.get("date") or now)
            started_at = str(session_data.get("started_at") or existing.get("started_at") or date)
            updated_at = str(session_data.get("updated_at") or now)
            completed_at = session_data.get("completed_at", existing.get("completed_at"))
            if status == "completed" and not completed_at:
                completed_at = now

            target_role = _clean_text(
                session_data.get("target_role", existing.get("target_role")),
                fallback="General Candidate",
                limit=240,
            )
            module = _clean_text(
                session_data.get("module", existing.get("module")),
                fallback="general",
                limit=40,
            ).lower()
            duration_seconds = max(
                0,
                min(int(session_data.get("duration_seconds", existing.get("duration_seconds", 0)) or 0), 172800),
            )
            interview_plan = session_data.get("interview_plan", existing.get("interview_plan"))
            role_intelligence = session_data.get("role_intelligence", existing.get("role_intelligence"))
            evaluator_metadata = session_data.get("evaluator_metadata", existing.get("evaluator_metadata"))
            for label, value in (
                ("interview plan", interview_plan),
                ("role intelligence", role_intelligence),
                ("evaluator metadata", evaluator_metadata),
            ):
                if value is not None and not isinstance(value, dict):
                    raise ValueError(f"Session {label} must be an object")
            evaluation_error = _clean_text(
                session_data.get("evaluation_error", existing.get("evaluation_error", "")),
                limit=2000,
            )
            revision = int(existing.get("revision", 0)) + 1

            conn.execute(
                """
                INSERT INTO sessions (
                    id, date, target_role, module, duration_seconds, messages, feedback,
                    status, started_at, updated_at, completed_at, settings,
                    interview_plan, role_intelligence, evaluation_error,
                    evaluator_metadata, schema_version, revision
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    date=excluded.date,
                    target_role=excluded.target_role,
                    module=excluded.module,
                    duration_seconds=excluded.duration_seconds,
                    messages=excluded.messages,
                    feedback=excluded.feedback,
                    status=excluded.status,
                    started_at=excluded.started_at,
                    updated_at=excluded.updated_at,
                    completed_at=excluded.completed_at,
                    settings=excluded.settings,
                    interview_plan=excluded.interview_plan,
                    role_intelligence=excluded.role_intelligence,
                    evaluation_error=excluded.evaluation_error,
                    evaluator_metadata=excluded.evaluator_metadata,
                    schema_version=excluded.schema_version,
                    revision=excluded.revision
                """,
                (
                    session_id,
                    date,
                    target_role,
                    module,
                    duration_seconds,
                    _json_dump(messages, list, []),
                    _json_dump(feedback, dict, {}) if feedback is not None else None,
                    status,
                    started_at,
                    updated_at,
                    str(completed_at) if completed_at else None,
                    _json_dump(settings, dict, {}),
                    _json_dump(interview_plan, dict, {}) if interview_plan is not None else None,
                    _json_dump(role_intelligence, dict, {}) if role_intelligence is not None else None,
                    evaluation_error,
                    _json_dump(evaluator_metadata, dict, {}) if evaluator_metadata is not None else None,
                    SESSION_SCHEMA_VERSION,
                    revision,
                ),
            )
            saved_row = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
            return self._row_to_session(saved_row)

    def update_session(self, session_id: str, changes: dict[str, Any]) -> dict[str, Any]:
        patch = dict(changes or {})
        patch["id"] = _validate_id(session_id)
        if not self.get_session(session_id):
            raise KeyError(session_id)
        return self.save_session(patch)

    def get_turn(self, session_id: str, turn_id: str) -> Optional[dict[str, Any]]:
        session_id = _validate_id(session_id)
        turn_id = _validate_id(turn_id)
        with self._connection() as conn:
            row = conn.execute(
                "SELECT * FROM session_turns WHERE session_id = ? AND turn_id = ?",
                (session_id, turn_id),
            ).fetchone()
            if not row:
                return None
            return {
                "session_id": row["session_id"],
                "turn_id": row["turn_id"],
                "expected_revision": int(row["expected_revision"]),
                "answer": row["answer"],
                "response": _json_load(row["response"], dict, None),
                "created_at": row["created_at"],
                "completed_at": row["completed_at"],
            }

    def save_turn_result(
        self,
        session_id: str,
        turn_id: str,
        expected_revision: int,
        answer: str,
        response: dict[str, Any],
        messages: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Persist an idempotent answer and the server-ordered transcript together."""
        session_id = _validate_id(session_id)
        turn_id = _validate_id(turn_id)
        clean_answer = str(answer or "").strip()
        if not clean_answer or len(clean_answer) > 30_000:
            raise ValueError("Answer must contain between 1 and 30000 characters")
        now = _utc_now()
        with self._connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            duplicate = conn.execute(
                "SELECT response FROM session_turns WHERE session_id = ? AND turn_id = ?",
                (session_id, turn_id),
            ).fetchone()
            if duplicate:
                return _json_load(duplicate["response"], dict, {})
            row = conn.execute("SELECT revision, status FROM sessions WHERE id = ?", (session_id,)).fetchone()
            if not row:
                raise KeyError(session_id)
            if int(row["revision"]) != int(expected_revision):
                raise RuntimeError("revision_conflict")
            if row["status"] not in {"in_progress", "evaluation_failed"}:
                raise ValueError("This session no longer accepts interview turns")
            response_json = _json_dump(response, dict, {})
            conn.execute(
                """
                INSERT INTO session_turns (
                    session_id, turn_id, expected_revision, answer, response, created_at, completed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (session_id, turn_id, int(expected_revision), clean_answer, response_json, now, now),
            )
            conn.execute(
                """
                UPDATE sessions
                SET messages = ?, updated_at = ?, revision = revision + 1, schema_version = ?
                WHERE id = ? AND revision = ?
                """,
                (_json_dump(messages, list, []), now, SESSION_SCHEMA_VERSION, session_id, int(expected_revision)),
            )
            return response

    def create_evaluation_job(self, job: dict[str, Any]) -> dict[str, Any]:
        job_id = _validate_id(job.get("id"))
        session_id = _validate_id(job.get("session_id"))
        now = _utc_now()
        with self._connection() as conn:
            if not conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone():
                raise KeyError(session_id)
            conn.execute(
                """
                INSERT INTO evaluation_jobs (
                    id, session_id, status, progress, request_payload, created_at, updated_at
                ) VALUES (?, ?, 'queued', 0, ?, ?, ?)
                """,
                (job_id, session_id, _json_dump(job.get("request_payload"), dict, {}), now, now),
            )
        return self.get_evaluation_job(job_id)

    def get_evaluation_job(self, job_id: str) -> Optional[dict[str, Any]]:
        with self._connection() as conn:
            row = conn.execute("SELECT * FROM evaluation_jobs WHERE id = ?", (_validate_id(job_id),)).fetchone()
            return self._row_to_evaluation_job(row) if row else None

    def get_evaluation_job_payload(self, job_id: str) -> Optional[dict[str, Any]]:
        with self._connection() as conn:
            row = conn.execute(
                "SELECT request_payload FROM evaluation_jobs WHERE id = ?",
                (_validate_id(job_id),),
            ).fetchone()
            return _json_load(row["request_payload"], dict, {}) if row else None

    def get_pending_evaluation_jobs(self, limit: int = 10) -> list[dict[str, Any]]:
        with self._connection() as conn:
            rows = conn.execute(
                "SELECT * FROM evaluation_jobs WHERE status = 'queued' ORDER BY created_at LIMIT ?",
                (max(1, min(50, int(limit))),),
            ).fetchall()
            return [self._row_to_evaluation_job(row) for row in rows]

    @staticmethod
    def _row_to_evaluation_job(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "session_id": row["session_id"],
            "status": row["status"],
            "progress": int(row["progress"] or 0),
            "result": _json_load(row["result"], dict, None),
            "error": {
                "code": row["error_code"],
                "message": row["error_message"],
                "retryable": row["error_code"] not in {"invalid_session", "invalid_transcript"},
            } if row["error_code"] else None,
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "started_at": row["started_at"],
            "completed_at": row["completed_at"],
        }

    def update_evaluation_job(
        self,
        job_id: str,
        *,
        status: str,
        progress: int,
        result: Optional[dict[str, Any]] = None,
        error_code: str = "",
        error_message: str = "",
    ) -> dict[str, Any]:
        if status not in EVALUATION_JOB_STATUSES:
            raise ValueError("Unsupported evaluation job status")
        now = _utc_now()
        with self._connection() as conn:
            current = conn.execute("SELECT status FROM evaluation_jobs WHERE id = ?", (_validate_id(job_id),)).fetchone()
            if not current:
                raise KeyError(job_id)
            started_at = now if status == "running" and current["status"] == "queued" else None
            completed_at = now if status in {"completed", "failed"} else None
            conn.execute(
                """
                UPDATE evaluation_jobs SET status = ?, progress = ?, result = ?,
                    error_code = ?, error_message = ?, updated_at = ?,
                    started_at = COALESCE(started_at, ?), completed_at = COALESCE(?, completed_at)
                WHERE id = ?
                """,
                (
                    status,
                    max(0, min(100, int(progress))),
                    _json_dump(result, dict, {}) if result is not None else None,
                    _clean_text(error_code, limit=80),
                    _clean_text(error_message, limit=1000),
                    now,
                    started_at,
                    completed_at,
                    job_id,
                ),
            )
        return self.get_evaluation_job(job_id)

    def recover_interrupted_evaluation_jobs(self) -> int:
        """Return interrupted workers to the durable queue after a restart."""
        with self._connection() as conn:
            cursor = conn.execute(
                """
                UPDATE evaluation_jobs
                SET status = 'queued', progress = 0, updated_at = ?, started_at = NULL
                WHERE status = 'running'
                """,
                (_utc_now(),),
            )
            return cursor.rowcount

    def integrity_check(self) -> dict[str, Any]:
        with self._connection() as conn:
            result = str(conn.execute("PRAGMA quick_check").fetchone()[0])
        return {"ok": result == "ok", "result": result}

    def backup_database(self, label: str = "manual") -> Optional[str]:
        if self.db_path == ":memory:":
            return None
        source_path = os.path.abspath(self.db_path)
        if not os.path.exists(source_path):
            return None
        safe_label = re.sub(r"[^a-z0-9_-]+", "-", label.casefold()).strip("-") or "backup"
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup_path = f"{source_path}.{safe_label}-{timestamp}.bak"
        with closing(sqlite3.connect(source_path, timeout=10)) as source, closing(
            sqlite3.connect(backup_path, timeout=10)
        ) as target:
            source.backup(target)
            if target.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise RuntimeError("Database backup integrity check failed")
            target.commit()
        return backup_path

    def preview_import(self, imported: dict[str, Any]) -> dict[str, int]:
        sessions = imported.get("sessions", [])
        questions = imported.get("questions", [])
        session_ids = [_validate_id(item.get("id")) for item in sessions]
        question_ids = [str(item.get("id") or "").strip() for item in questions]
        if any(not item or len(item) > 160 for item in question_ids):
            raise ValueError("Import contains an invalid question id")
        with self._connection() as conn:
            session_conflicts = sum(
                bool(conn.execute("SELECT 1 FROM sessions WHERE id = ?", (item,)).fetchone())
                for item in session_ids
            )
            question_conflicts = sum(
                bool(conn.execute("SELECT 1 FROM questions WHERE id = ?", (item,)).fetchone())
                for item in question_ids
            )
        return {
            "sessions": len(sessions),
            "questions": len(questions),
            "session_conflicts": session_conflicts,
            "question_conflicts": question_conflicts,
        }

    def import_atomic(self, imported: dict[str, Any]) -> dict[str, int]:
        """Validate in a disposable DB, then merge both record types in one commit."""
        preview = self.preview_import(imported)
        from services.question_bank import QuestionBank
        with tempfile.TemporaryDirectory(prefix="interview-chameleon-import-") as temp_dir:
            validation_path = os.path.join(temp_dir, "validated.db")
            validator = SessionHistory(validation_path)
            question_validator = QuestionBank(validation_path)
            for session in imported.get("sessions", []):
                validator.save_session(session)
            for question in imported.get("questions", []):
                question_validator.add_question(question)

            self.backup_database("pre-import")
            with self._connection() as conn:
                conn.execute("ATTACH DATABASE ? AS imported", (validation_path,))
                try:
                    conn.execute("BEGIN IMMEDIATE")
                    session_columns = [row["name"] for row in conn.execute("PRAGMA table_info(sessions)")]
                    columns = ", ".join(session_columns)
                    conn.execute(f"INSERT OR REPLACE INTO sessions ({columns}) SELECT {columns} FROM imported.sessions")
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO questions (id, category, text, difficulty, tags, answer, is_seed)
                        SELECT id, category, text, difficulty, tags, answer, 0
                        FROM imported.questions WHERE is_seed = 0
                        """
                    )
                    conn.commit()
                except Exception:
                    conn.rollback()
                    raise
                finally:
                    conn.execute("DETACH DATABASE imported")
        return preview

    def get_all_sessions(
        self,
        statuses: Optional[list[str]] = None,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        params: list[Any] = []
        query = "SELECT * FROM sessions"
        if statuses:
            normalized = [status for status in statuses if status in SESSION_STATUSES]
            if not normalized:
                return []
            query += f" WHERE status IN ({','.join('?' for _ in normalized)})"
            params.extend(normalized)
        query += " ORDER BY COALESCE(updated_at, date) DESC LIMIT ?"
        params.append(max(1, min(int(limit or 500), 2000)))
        with self._connection() as conn:
            return [self._row_to_session(row) for row in conn.execute(query, params).fetchall()]

    def get_recoverable_session(self) -> Optional[dict[str, Any]]:
        sessions = self.get_all_sessions(list(RECOVERABLE_STATUSES), limit=1)
        return sessions[0] if sessions else None

    def get_session(self, session_id: str) -> Optional[dict[str, Any]]:
        with self._connection() as conn:
            row = conn.execute("SELECT * FROM sessions WHERE id = ?", (_validate_id(session_id),)).fetchone()
            return self._row_to_session(row) if row else None

    def comparable_sessions(self, session_id: str, limit: int = 12) -> list[dict[str, Any]]:
        anchor = self.get_session(session_id)
        if not anchor:
            raise KeyError(session_id)
        role_key = _clean_text(anchor["target_role"], limit=240).casefold()
        module = anchor["module"]
        difficulty = anchor["settings"].get("difficulty", "medium")
        candidates = self.get_all_sessions(["completed"], limit=1000)
        comparable = [
            item for item in candidates
            if _clean_text(item["target_role"], limit=240).casefold() == role_key
            and item["module"] == module
            and item["settings"].get("difficulty", "medium") == difficulty
            and isinstance(item.get("feedback"), dict)
            and isinstance(item["feedback"].get("overall_score"), (int, float))
        ]
        return comparable[: max(1, min(int(limit or 12), 100))]

    def clear_all_sessions(self) -> None:
        with self._connection() as conn:
            conn.execute("DELETE FROM sessions")

    def reset_user_data(self) -> None:
        with self._connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute("DELETE FROM sessions")
            conn.execute("DELETE FROM evaluation_cache")
            conn.execute("DELETE FROM questions WHERE COALESCE(is_seed, 0) = 0")

    def delete_session(self, session_id: str) -> bool:
        with self._connection() as conn:
            cursor = conn.execute("DELETE FROM sessions WHERE id = ?", (_validate_id(session_id),))
            return cursor.rowcount > 0

    @staticmethod
    def _row_to_evaluation_review(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "session_id": row["session_id"],
            "question_index": int(row["question_index"]),
            "verdict": row["verdict"],
            "note": row["note"] or "",
            "module": row["module"] or "general",
            "target_role": row["target_role"] or "General Candidate",
            "question_text": row["question_text"] or "",
            "answer_text": row["answer_text"] or "",
            "evaluator_score": row["evaluator_score"],
            "evidence_quotes": _json_load(row["evidence_quotes"], list, []),
            "competency_scores": _json_load(row["competency_scores"], dict, {}),
            "module_scores": _json_load(row["module_scores"], dict, {}),
            "evaluation_version": row["evaluation_version"] or "",
            "model_digest": row["model_digest"] or "",
            "rubric_version": row["rubric_version"] or "",
            "prompt_version": row["prompt_version"] or "",
            "scoring_engine_version": row["scoring_engine_version"] or "",
            "rubric_assessment": _json_load(row["rubric_assessment"], dict, {}),
            "correctness": row["correctness"] or "",
            "limiting_rule": row["limiting_rule"] or "",
            "verifier": _json_load(row["verifier"], dict, {}),
            "confidence": _json_load(row["confidence"], dict, {}),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def save_evaluation_review(self, review: dict[str, Any]) -> dict[str, Any]:
        """Create or replace one local human judgment for a scored question."""
        if not isinstance(review, dict):
            raise ValueError("Evaluation review must be an object")
        session_id = _validate_id(review.get("session_id"))
        question_index = int(review.get("question_index", -1))
        if question_index < 0 or question_index > 1000:
            raise ValueError("Invalid evaluation question index")
        verdict = _clean_text(review.get("verdict"), limit=40).lower()
        if verdict not in EVALUATION_REVIEW_VERDICTS:
            raise ValueError("Unsupported evaluation review verdict")

        score = review.get("evaluator_score")
        if score is not None:
            score = max(0, min(100, int(score)))
        now = _utc_now()
        with self._connection() as conn:
            if not conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone():
                raise KeyError(session_id)
            existing = conn.execute(
                "SELECT created_at FROM evaluation_reviews WHERE session_id = ? AND question_index = ?",
                (session_id, question_index),
            ).fetchone()
            created_at = existing["created_at"] if existing else now
            conn.execute(
                """
                INSERT INTO evaluation_reviews (
                    session_id, question_index, verdict, note, module, target_role,
                    question_text, answer_text, evaluator_score, evidence_quotes,
                    competency_scores, module_scores, evaluation_version, model_digest,
                    rubric_version, prompt_version, scoring_engine_version, rubric_assessment,
                    correctness, limiting_rule, verifier, confidence, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id, question_index) DO UPDATE SET
                    verdict=excluded.verdict,
                    note=excluded.note,
                    module=excluded.module,
                    target_role=excluded.target_role,
                    question_text=excluded.question_text,
                    answer_text=excluded.answer_text,
                    evaluator_score=excluded.evaluator_score,
                    evidence_quotes=excluded.evidence_quotes,
                    competency_scores=excluded.competency_scores,
                    module_scores=excluded.module_scores,
                    evaluation_version=excluded.evaluation_version,
                    model_digest=excluded.model_digest,
                    rubric_version=excluded.rubric_version,
                    prompt_version=excluded.prompt_version,
                    scoring_engine_version=excluded.scoring_engine_version,
                    rubric_assessment=excluded.rubric_assessment,
                    correctness=excluded.correctness,
                    limiting_rule=excluded.limiting_rule,
                    verifier=excluded.verifier,
                    confidence=excluded.confidence,
                    updated_at=excluded.updated_at
                """,
                (
                    session_id,
                    question_index,
                    verdict,
                    _clean_text(review.get("note"), limit=800),
                    _clean_text(review.get("module"), fallback="general", limit=40).lower(),
                    _clean_text(review.get("target_role"), fallback="General Candidate", limit=240),
                    _clean_text(review.get("question_text"), limit=8000),
                    _clean_text(review.get("answer_text"), limit=20000),
                    score,
                    _json_dump(review.get("evidence_quotes"), list, []),
                    _json_dump(review.get("competency_scores"), dict, {}),
                    _json_dump(review.get("module_scores"), dict, {}),
                    _clean_text(review.get("evaluation_version"), limit=120),
                    _clean_text(review.get("model_digest"), limit=200),
                    _clean_text(review.get("rubric_version"), limit=120),
                    _clean_text(review.get("prompt_version"), limit=120),
                    _clean_text(review.get("scoring_engine_version"), limit=120),
                    _json_dump(review.get("rubric_assessment"), dict, {}),
                    _clean_text(review.get("correctness"), limit=80),
                    _clean_text(review.get("limiting_rule"), limit=600),
                    _json_dump(review.get("verifier"), dict, {}),
                    _json_dump(review.get("confidence"), dict, {}),
                    created_at,
                    now,
                ),
            )
            row = conn.execute(
                "SELECT * FROM evaluation_reviews WHERE session_id = ? AND question_index = ?",
                (session_id, question_index),
            ).fetchone()
            return self._row_to_evaluation_review(row)

    def get_evaluation_reviews(self, session_id: Optional[str] = None) -> list[dict[str, Any]]:
        query = "SELECT * FROM evaluation_reviews"
        params: tuple[Any, ...] = ()
        if session_id is not None:
            query += " WHERE session_id = ?"
            params = (_validate_id(session_id),)
        query += " ORDER BY updated_at DESC, question_index ASC"
        with self._connection() as conn:
            return [
                self._row_to_evaluation_review(row)
                for row in conn.execute(query, params).fetchall()
            ]

    def delete_evaluation_review(self, session_id: str, question_index: int) -> bool:
        with self._connection() as conn:
            cursor = conn.execute(
                "DELETE FROM evaluation_reviews WHERE session_id = ? AND question_index = ?",
                (_validate_id(session_id), max(0, int(question_index))),
            )
            return cursor.rowcount > 0

    def get_evaluation_cache(self, cache_key: str, evaluation_version: str) -> Optional[dict[str, Any]]:
        """Return and touch a version-matched deterministic evaluation result."""
        key = str(cache_key or "").strip()
        version = _clean_text(evaluation_version, limit=120)
        if not re.fullmatch(r"[a-f0-9]{64}", key):
            raise ValueError("Invalid evaluation cache key")
        with self._connection() as conn:
            row = conn.execute(
                "SELECT feedback FROM evaluation_cache WHERE cache_key = ? AND evaluation_version = ?",
                (key, version),
            ).fetchone()
            if not row:
                return None
            conn.execute(
                "UPDATE evaluation_cache SET last_used_at = ?, hit_count = hit_count + 1 WHERE cache_key = ?",
                (_utc_now(), key),
            )
            return _json_load(row["feedback"], dict, None)

    def save_evaluation_cache(
        self,
        cache_key: str,
        evaluation_version: str,
        model: str,
        feedback: dict[str, Any],
        *,
        max_entries: int = 200,
    ) -> None:
        """Persist a reusable model assessment and keep the cache bounded."""
        key = str(cache_key or "").strip()
        if not re.fullmatch(r"[a-f0-9]{64}", key):
            raise ValueError("Invalid evaluation cache key")
        now = _utc_now()
        encoded = _json_dump(feedback, dict, {})
        with self._connection() as conn:
            conn.execute(
                """
                INSERT INTO evaluation_cache (
                    cache_key, evaluation_version, model, feedback, created_at, last_used_at, hit_count
                ) VALUES (?, ?, ?, ?, ?, ?, 0)
                ON CONFLICT(cache_key) DO UPDATE SET
                    evaluation_version=excluded.evaluation_version,
                    model=excluded.model,
                    feedback=excluded.feedback,
                    last_used_at=excluded.last_used_at
                """,
                (
                    key,
                    _clean_text(evaluation_version, limit=120),
                    _clean_text(model, limit=200),
                    encoded,
                    now,
                    now,
                ),
            )
            keep = max(10, min(int(max_entries or 200), 2000))
            conn.execute(
                """
                DELETE FROM evaluation_cache
                WHERE cache_key NOT IN (
                    SELECT cache_key FROM evaluation_cache ORDER BY last_used_at DESC LIMIT ?
                )
                """,
                (keep,),
            )
