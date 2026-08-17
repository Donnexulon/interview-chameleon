# Product Demo Smoke Test

Run the automated checks first:

```bat
smoke_demo.bat
```

The batch file calls `smoke_demo.ps1`. The script runs `doctor.ps1`, backend tests, frontend syntax checks, and, when the server is already running, verifies health, setup status, qwen-only model defaults, resume parsing on both upload routes, and V3 session save/reload through `/api/sessions`. The smoke session uses a fixed ID and is deleted after verification.

If you prefer individual commands:

```bat
venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
node --check static/js/app.js
```

## Live Endpoint Checks

Start the app with:

```bat
run_demo.bat
```

Then verify:

- `GET /health` returns `{"status":"ok"}`.
- `GET /api/setup/status` reports Ollama status and `qwen2.5:7b` readiness.
- `GET /api/models` reports `qwen2.5:7b` for interviewer, evaluator, and fallback defaults.
- `POST /api/parse-resume` and the compatibility alias `/api/upload-resume` are available.
- `POST /api/sessions` saves a V3 report and `GET /api/sessions` reloads it with readiness/evidence fields intact.

## Manual Browser Checklist

- Home screen renders Tabler icons and the `Demo Report` button.
- Browser console has no Tailwind CDN production warning.
- Click `Demo Report`; the V3 report appears immediately.
- Report shows Job Readiness, Competency Scorecard, Question Evaluations, evidence quotes, Risk Flags, and Practice Plan.
- Click `Session History`; the seeded Product Manager session appears.
- Reopen the seeded report from history; V3 sections still render.
- Open setup; readiness messaging is decisive for ready, Ollama missing, or model missing states.
- If Ollama is running and `qwen2.5:7b` is installed, start a short interview.
- End the interview and confirm a live V3 report renders.
- Open Minigames and launch 60-Second Blitz, STAR Builder, and Salary Dare.
- Confirm best scores persist after a refresh.

## Regression Checks

- Search the codebase for `llama3`; no runtime path should use it.
- Old V2 saved feedback still renders.
- Missing Ollama shows guidance instead of a silent failure.
- Local data files such as `interview.db`, generated audio, and local documents are not committed.
