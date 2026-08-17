# Interview Chameleon

Interview Chameleon is a local interview coach for practicing realistic mock interviews, reviewing transcript-backed evaluations, and drilling weak areas with minigames. Live interview chat and evaluation use Ollama with `qwen2.5:7b` as the only supported model.

## Install

Requirements:

- Windows
- Python 3.9+
- Ollama
- FFmpeg on `PATH` for speech-to-text audio features
- Node.js for frontend syntax checks

Run:

```bat
install.bat
```

The installer is idempotent. It creates `venv` if needed, installs `requirements.txt`, checks FFmpeg, and prints the next commands.

Install the local model:

```bat
ollama pull qwen2.5:7b
```

## Doctor

Run diagnostics before a beta session:

```bat
doctor.bat
```

Doctor checks Python, the virtual environment, required Python imports, FFmpeg, Ollama, `qwen2.5:7b`, local SQLite writability, and port `8000`.

## Run

Start the app:

```bat
run_demo.bat
```

Open `http://127.0.0.1:8000/`.

If the script reports an existing server and backend files changed, restart it:

```bat
stop_demo.bat
run_demo.bat
```

## Stop

Stop the app server:

```bat
stop_demo.bat
```

The stop script only stops a `uvicorn main:app` process listening on port `8000`. It skips unrelated processes.

## Smoke Test

Run:

```bat
smoke_demo.bat
```

The smoke script runs doctor checks, backend tests, frontend syntax checks, live health/setup/model checks when the server is running, resume upload route checks, and V3 sample session save/reload.

Manual demo path:

1. Run `run_demo.bat`.
2. Click `Demo Report`.
3. Show Job Readiness, Competency Scorecard, Question Evaluations with evidence quotes, Risk Flags, and Practice Plan.
4. Open `Session History` and reload the seeded Product Manager report.
5. Open `Start Practicing` and show the local AI runtime readiness panel.
6. Open `Minigames` and launch 60-Second Blitz, STAR Builder, and Salary Dare.

## Troubleshooting

- Ollama stopped: start Ollama, then rerun `doctor.bat`.
- qwen missing: run `ollama pull qwen2.5:7b`.
- Port busy: run `doctor.bat`; if it is this app, run `stop_demo.bat`.
- Stale backend after code changes: run `stop_demo.bat`, then `run_demo.bat`.
- venv missing or packages missing: run `install.bat`.
- FFmpeg missing: install FFmpeg and ensure `ffmpeg` works in a new terminal.
- Evaluation/chat fails: confirm `doctor.bat` passes and `/api/setup/status` reports ready.

## Data And Privacy

Session history and question data are stored locally in `interview.db`. Generated audio, local documents, databases, caches, virtual environments, and temp files are ignored by `.gitignore` and should not be committed.

## Project Structure

- `main.py`: FastAPI app and API routes
- `services/`: Ollama, evaluation, resume parsing, session history, speech, and question bank services
- `static/js/app.js`: Vanilla JavaScript frontend
- `static/css/tailwind-compat.css`: Local compatibility utilities replacing the Tailwind CDN
- `templates/index.html`: Main HTML shell
- `tests/`: Backend unit and API tests
- `install.bat`: Idempotent Windows setup
- `doctor.bat` / `doctor.ps1`: Local diagnostics
- `run_demo.bat`: App launcher
- `stop_demo.bat` / `stop_demo.ps1`: Safe app stopper
- `smoke_demo.bat` / `smoke_demo.ps1`: Automated beta smoke checks
