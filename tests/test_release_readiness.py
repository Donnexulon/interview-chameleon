import asyncio
import io
import json
import re
import tempfile
import unittest
import sqlite3
import requests
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from fastapi import UploadFile
from fastapi.testclient import TestClient

import main as app_main
from services.portfolio_service import PortfolioFetchError, _validate_public_url, fetch_portfolio
from services.preferences import PreferencesStore
from services.question_bank import QuestionBank
from services.resume_parser import ResumeParseError, ResumeParser
from services.session_history import SessionHistory
from services.app_paths import migrate_legacy_database, sqlite_integrity_ok
from services.logging_config import recent_sanitized_errors
from services.ollama_client import OllamaClient


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]


def session_payload(session_id="session-1", status="in_progress"):
    return {
        "id": session_id,
        "date": "2026-09-08T12:00:00Z",
        "target_role": "Backend Engineer",
        "module": "technical",
        "messages": [],
        "status": status,
        "settings": {"difficulty": "medium", "duration": "standard"},
    }


class PreferencesReleaseTests(unittest.TestCase):
    def test_preferences_are_bounded_and_atomically_reloaded(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config" / "preferences.json"
            store = PreferencesStore(path)
            saved = store.update({"text_scale": 500, "preferred_voice": "x" * 400})
            self.assertEqual(saved["text_scale"], 200)
            self.assertEqual(len(saved["preferred_voice"]), 240)
            self.assertEqual(PreferencesStore(path).get(), saved)

    def test_unknown_preference_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            store = PreferencesStore(Path(directory) / "preferences.json")
            with self.assertRaises(ValueError):
                store.update({"telemetry": True})

    def test_browser_progress_is_bounded_and_survives_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "preferences.json"
            store = PreferencesStore(path)
            saved = store.update({
                "theme": "light",
                "question_favorites": ["technical-1", "technical-1", "x" * 300],
                "industries_used": ["technology"],
                "faang_sessions": 3,
                "earned_badges": ["first_steps"],
                "minigame_runs": [{
                    "id": "run-1",
                    "game": "star",
                    "score": 120,
                    "summary": "useful" * 400,
                    "competency_scores": {"structure": 88},
                    "strengths": ["clear"],
                    "improvements": ["specificity"],
                    "raw": {"answer": "a" * 4_000},
                }],
                "minigame_bests": {"star": {"score": 92, "date": "2026-09-11T00:00:00Z"}},
            })
            self.assertEqual(saved["theme"], "light")
            self.assertEqual(saved["question_favorites"][0], "technical-1")
            self.assertEqual(len(saved["question_favorites"]), 2)
            self.assertEqual(len(saved["question_favorites"][1]), 128)
            self.assertEqual(saved["minigame_runs"][0]["score"], 100)
            self.assertEqual(len(saved["minigame_runs"][0]["summary"]), 1_000)
            self.assertEqual(len(saved["minigame_runs"][0]["raw"]["answer"]), 1_000)
            self.assertEqual(PreferencesStore(path).get(), saved)


class DesktopMigrationTests(unittest.TestCase):
    def test_packaged_first_launch_copies_verifies_and_retains_source_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            legacy = root / "legacy.db"
            with closing(sqlite3.connect(legacy)) as connection:
                connection.execute("CREATE TABLE proof (value TEXT)")
                connection.execute("INSERT INTO proof VALUES ('kept')")
                connection.commit()
            data_root = root / "desktop-data"
            with patch.dict("os.environ", {
                "INTERVIEW_CHAMELEON_PACKAGED": "1",
                "INTERVIEW_CHAMELEON_DATA_DIR": str(data_root),
                "INTERVIEW_CHAMELEON_LEGACY_DB": str(legacy),
            }, clear=False):
                result = migrate_legacy_database()
            target = data_root / "data" / "interview.db"
            self.assertTrue(result["migrated"])
            self.assertTrue(sqlite_integrity_ok(target))
            self.assertTrue(Path(str(legacy) + ".pre-desktop-backup").exists())


class DesktopLauncherReleaseTests(unittest.TestCase):
    def test_clean_machine_backend_timeout_allows_for_cold_antivirus_scan(self):
        source = (REPOSITORY_ROOT / "desktop" / "Program.cs").read_text(encoding="utf-8")
        match = re.search(r"BackendStartupTimeoutSeconds\s*=\s*(\d+)", source)
        self.assertIsNotNone(match)
        self.assertGreaterEqual(int(match.group(1)), 90)

    def test_slow_start_uses_a_quiet_dark_handoff_and_remains_diagnosable(self):
        source = (REPOSITORY_ROOT / "desktop" / "Program.cs").read_text(encoding="utf-8")
        self.assertIn("DefaultBackgroundColor = Color.FromArgb(16, 17, 15)", source)
        self.assertIn("Text = string.Empty", source)
        self.assertNotIn("First launch can take up to two minutes", source)
        self.assertNotIn("Starting your private studio", source)
        self.assertIn('Path.Combine(logDirectory, "launcher.log")', source)
        self.assertIn("backend_start_timeout", source)

    def test_desktop_close_waits_for_browser_checkpoint_completion(self):
        source = (REPOSITORY_ROOT / "desktop" / "Program.cs").read_text(encoding="utf-8")
        self.assertIn("window.icExitCheckpointComplete=false", source)
        self.assertIn("Boolean(window.icExitCheckpointComplete)", source)
        self.assertNotIn("await Task.Delay(400);", source)

    def test_desktop_ollama_bridge_accepts_only_a_fixed_local_action(self):
        source = (REPOSITORY_ROOT / "desktop" / "Program.cs").read_text(encoding="utf-8")
        self.assertIn("core.WebMessageReceived", source)
        self.assertIn('action is not ("open-ollama" or "download-ollama")', source)
        self.assertIn("if (!IsLocalAppUri(args.Source)) return;", source)
        self.assertIn('"Programs", "Ollama", "ollama app.exe"', source)
        self.assertIn('const string downloadUrl = "https://ollama.com/download/windows";', source)
        self.assertNotIn("GetProperty(\"path\")", source)
        self.assertNotIn("GetProperty(\"url\")", source)

class DiagnosticsPrivacyTests(unittest.TestCase):
    def test_diagnostics_reads_only_redacted_error_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            log_dir = Path(directory)
            records = [
                {"level": "INFO", "event": "request", "context": {"path": "/health"}},
                {"level": "ERROR", "event": "failed", "answer": "private", "context": {"token": "secret", "error_type": "TimeoutError"}},
            ]
            (log_dir / "app.jsonl").write_text(
                "\n".join(json.dumps(record) for record in records),
                encoding="utf-8",
            )
            exported = recent_sanitized_errors(log_dir)
            self.assertEqual(len(exported), 1)
            self.assertNotIn("answer", exported[0])
            self.assertEqual(exported[0]["context"]["token"], "[REDACTED]")


class ModelQueueTests(unittest.TestCase):
    @patch("services.ollama_client.requests.post", side_effect=requests.ConnectionError("offline"))
    def test_streaming_request_releases_its_queue_slot(self, _post):
        client = OllamaClient()
        chunks = list(client.generate_chat_stream("qwen2.5:7b", [{"role": "user", "content": "hello"}]))
        self.assertEqual(len(chunks), 1)
        self.assertTrue(chunks[0].startswith("Error connecting to Ollama:"))
        self.assertEqual(client.queue_status["queued"], 0)


class RequestBoundaryTests(unittest.TestCase):
    def test_application_shell_renders_with_current_template_api(self):
        client = TestClient(app_main.app)
        response = client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("Interview Chameleon", response.text)

    def test_content_security_policy_allows_wasm_without_javascript_eval(self):
        client = TestClient(app_main.app)
        response = client.get("/")
        policy = response.headers["Content-Security-Policy"]
        script_tokens = policy.split("script-src ", 1)[1].split(";", 1)[0].split()
        self.assertIn("'wasm-unsafe-eval'", script_tokens)
        self.assertNotIn("'unsafe-eval'", script_tokens)

    def test_global_request_envelope_rejects_oversized_body_before_routing(self):
        client = TestClient(app_main.app)
        response = client.put(
            "/api/preferences",
            content=b"{}",
            headers={"Content-Length": str(app_main.MAX_REQUEST_BYTES + 1)},
        )
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()["error"]["code"], "request_too_large")


class ResumeSecurityTests(unittest.TestCase):
    def parse(self, filename, content):
        upload = UploadFile(filename=filename, file=io.BytesIO(content))
        return asyncio.run(ResumeParser.parse(upload))

    def test_txt_requires_utf8(self):
        with self.assertRaises(ResumeParseError) as raised:
            self.parse("resume.txt", b"\xff\xfe")
        self.assertEqual(raised.exception.code, "resume_encoding_invalid")

    def test_pdf_extension_cannot_bypass_signature_check(self):
        with self.assertRaises(ResumeParseError) as raised:
            self.parse("resume.pdf", b"not a pdf")
        self.assertEqual(raised.exception.code, "resume_signature_invalid")

    def test_unsupported_archive_is_rejected(self):
        with self.assertRaises(ResumeParseError) as raised:
            self.parse("resume.zip", b"PK\x03\x04")
        self.assertEqual(raised.exception.status_code, 415)


class PortfolioSecurityTests(unittest.TestCase):
    def test_explicit_consent_is_required_before_network_resolution(self):
        with self.assertRaises(PortfolioFetchError) as raised:
            fetch_portfolio("https://example.com", network_consent=False)
        self.assertEqual(raised.exception.code, "network_consent_required")

    def test_loopback_and_embedded_credentials_are_blocked(self):
        with self.assertRaises(PortfolioFetchError) as loopback:
            _validate_public_url("http://127.0.0.1/private")
        self.assertEqual(loopback.exception.code, "portfolio_private_host_blocked")
        with self.assertRaises(PortfolioFetchError) as credentials:
            _validate_public_url("https://user:secret@example.com")
        self.assertEqual(credentials.exception.code, "portfolio_credentials_blocked")

    @patch("services.portfolio_service.socket.getaddrinfo")
    def test_resolved_private_address_is_blocked(self, resolve):
        resolve.return_value = [(2, 1, 6, "", ("10.0.0.5", 443))]
        with self.assertRaises(PortfolioFetchError):
            _validate_public_url("https://portfolio.example")


class DurableSessionReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.database = str(Path(self.temporary.name) / "sessions.db")
        self.store = SessionHistory(self.database)
        QuestionBank(self.database)

    def tearDown(self):
        self.temporary.cleanup()

    def test_turns_are_idempotent_and_revision_guarded(self):
        saved = self.store.save_session(session_payload())
        response = {"content": "Tell me about a system you designed.", "question_id": "q-1"}
        messages = [
            {"role": "user", "content": "I designed a queue."},
            {"role": "assistant", "content": response["content"], "question_id": "q-1"},
        ]
        first = self.store.save_turn_result(
            "session-1", "turn-1", saved["revision"], "I designed a queue.", response, messages
        )
        replay = self.store.save_turn_result(
            "session-1", "turn-1", saved["revision"], "I designed a queue.", response, messages
        )
        self.assertEqual(first, replay)
        self.assertEqual(self.store.get_session("session-1")["revision"], saved["revision"] + 1)
        with self.assertRaisesRegex(RuntimeError, "revision_conflict"):
            self.store.save_turn_result(
                "session-1", "turn-2", saved["revision"], "A stale answer", response, messages
            )

    def test_evaluation_job_is_requeued_after_interruption(self):
        self.store.save_session(session_payload())
        job = self.store.create_evaluation_job(
            {"id": "job-1", "session_id": "session-1", "request_payload": {"module": "technical"}}
        )
        self.assertEqual(job["status"], "queued")
        self.store.update_evaluation_job("job-1", status="running", progress=25)
        self.assertEqual(self.store.recover_interrupted_evaluation_jobs(), 1)
        recovered = self.store.get_evaluation_job("job-1")
        self.assertEqual((recovered["status"], recovered["progress"]), ("queued", 0))

    def test_completed_session_cannot_return_to_in_progress(self):
        saved = self.store.save_session(session_payload(status="completed"))
        with self.assertRaises(ValueError):
            self.store.update_session(
                "session-1", {"status": "in_progress", "expected_revision": saved["revision"]}
            )

    def test_atomic_import_merges_valid_records(self):
        imported = {
            "sessions": [session_payload("imported-session")],
            "questions": [{
                "id": "imported-question",
                "category": "Technical",
                "text": "How do you make retries idempotent?",
                "difficulty": "medium",
                "tags": ["reliability"],
                "answer": "Use an idempotency key.",
            }],
        }
        counts = self.store.import_atomic(imported)
        self.assertEqual(counts["sessions"], 1)
        self.assertIsNotNone(self.store.get_session("imported-session"))
        self.assertTrue(any(item["id"] == "imported-question" for item in QuestionBank(self.database).get_questions()))


if __name__ == "__main__":
    unittest.main()
