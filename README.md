# Interview Chameleon

Interview Chameleon is a proprietary, local-first Windows interview coach. It
builds role-aware rehearsals, runs the conversation against a local Ollama
model, produces transcript-grounded evaluations, and turns weak areas into
focused practice. It has no accounts, hosted backend, analytics, or telemetry.

## Beta requirements

- Windows 10 or 11, x64
- 16 GB RAM and 10 GB free disk space
- Microsoft Edge WebView2 Runtime (the installer adds it when absent)
- Ollama and at least one supported local model for AI rehearsals and evaluations
- CPU inference is supported; 6 GB or more VRAM is recommended, not required

Python, Node.js, and FFmpeg are **not** required by installed users. The Windows
installer contains the Python backend and audio runtime. Speech input is an
optional offline pack. If it is not installed, the app remains usable with text
input. Interviewer speech uses an installed WebView2 voice marked as local; when
none is available the app falls back to text.

## Installed app

The release build produces:

- `InterviewChameleon-Setup-1.0.0-beta.1.exe`
- an optional offline English speech-model pack
- `SHA256SUMS.txt`, dependency inventory, and an SBOM

The installer creates a dedicated WebView2 desktop window and starts the bundled
backend silently on an available authenticated loopback port. Runtime data lives
under `%LOCALAPPDATA%\Interview Chameleon\`:

```text
data\interview.db
config\preferences.json
logs\
models\
cache\
```

On first launch, an existing workspace database is copied, integrity-checked,
and retained as a recoverable backup before the new location is used. The setup
wizard first checks for Ollama and links to its official Windows installer when
needed. After Ollama is running, the user chooses and installs a local model.
The wizard then checks hardware, storage, local voices, camera/microphone permissions,
optional speech support, and privacy choices. The same AI Models screen remains
available from the home navigation for later downloads and switching.

AI rehearsal cannot begin until one supported model is installed and selected.
The non-AI question library and practice tools remain available in degraded mode.

See [PRIVACY.md](PRIVACY.md) for data handling and network behavior.

## Developer setup

Development requires Python 3.9+ and Node.js. Ollama is required only for live
AI calls and evaluator calibration.

```bat
install.bat
doctor.bat
run_demo.bat
```

Then open `http://127.0.0.1:8000/`. Stop the development server with
`stop_demo.bat`. No system FFmpeg installation is needed.

The first-run screen can install one of four supported models. For development,
install the fully calibrated default with:

```bat
ollama pull qwen2.5:7b
```

The other selectable models are `qwen3.5:4b`, `granite3.3:8b`, and
`phi4-mini-reasoning:3.8b`. They fit below the 5 GB download cap but are marked
as alternatives until they complete the same evaluator calibration gate as the
default model.

## Verification

Run the backend suite and JavaScript parse checks:

```powershell
venv\Scripts\python.exe -m unittest discover -s tests -q
node --check static/js/app.js
node --check static/js/body_language.js
node --check static/js/local_speech.js
node --check static/js/accessibility.js
```

`smoke_demo.bat` adds live health, setup, model, resume-route, and session
save/reload checks when the development server is running.

The release evaluator uses categorical model judgments and deterministic numeric
scoring. Every scored answer must cite exact transcript evidence. Camera coaching
is experimental, is limited to observable framing/visibility/gaze/posture
signals, and never changes readiness scores.

Run the complete six-format evaluator gate after starting Ollama:

```bat
python scripts\evaluation_v6_benchmark.py --runs 3 --strict --output evaluation-v6-benchmark-report.json
```

The matrix covers strong, weak, borderline, mixed, incomplete, contradictory,
irrelevant, overly brief, technically incorrect, prompt-injection, setting
variation, and identity-invariance cases. Strict mode checks score ranges,
strong/weak separation, repeated-run spread, evidence grounding, and schema
recovery.

Local human review cases can be exported and replayed as a release gate:

```bat
python scripts\evaluation_calibration_run.py --calibration calibration.json --output v6-results.json
python scripts\evaluation_regression.py --calibration calibration.json --results v6-results.json --strict --output calibration-gate.json
```

Evaluation feedback never rewrites historical reports. Exports record the model
digest and rubric, prompt, and scoring-engine versions so reviewed cases remain
traceable.

## Release build

Release maintainers need Python, the .NET 8 SDK, Node.js, Inno Setup 6, and the
official Microsoft Evergreen WebView2 bootstrapper at:

```text
installer\prerequisites\MicrosoftEdgeWebview2Setup.exe
```

Use a clean build environment, install `requirements-build.txt`, and run:

```powershell
scripts\build_release.ps1
```

The script installs the pinned Node release-test dependencies and Playwright
Chromium, runs backend, frontend, browser-flow, and accessibility checks, builds
the PyInstaller one-folder backend, publishes the self-contained C# desktop
shell, creates dependency/SBOM records, compiles the Inno Setup installer,
generates its SHA-256 checksum, and builds the matching clean-VM ISO. The first
run needs network access to populate
the npm and Playwright browser caches. Pass a configured Inno signing-tool name
with `-SignToolName` when a certificate is available. The first beta may be
unsigned.

Build the optional speech pack only after placing the approved English
faster-whisper model in the expected source directory:

```powershell
scripts\build_speech_pack.ps1
```

Do not ship until every required item in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)
is complete.

## Reliability model

The saved server-side session is authoritative for transcript ordering and
question metadata. Turn submissions include an idempotent `turn_id` and expected
session revision, preventing retries and double clicks from duplicating
questions. Evaluation runs as a persistent queued job and can resume after a
restart. Legal lifecycle transitions are enforced and late checkpoints cannot
overwrite a completed report.

Session states are `in_progress`, `evaluating`, `completed`,
`evaluation_failed`, and `abandoned`. Only completed scored sessions contribute
to history trends. Raw resume text is removed after completion by default while
the derived role map is retained for focused practice.

Primary runtime interfaces include:

- `GET /api/system/status`
- `GET/PUT /api/preferences`
- `POST /api/sessions/{id}/turns`
- `POST /api/sessions/{id}/evaluation-jobs`
- `GET /api/evaluation-jobs/{job_id}`
- `GET /api/diagnostics/export`

Packaged builds require a per-launch desktop token, validate host/origin, disable
API documentation, and use a common request-ID error envelope. The legacy
interview/evaluation routes remain for development compatibility only.

## Project structure

- `desktop/`: C# WebView2 desktop shell
- `installer/`: Inno Setup definition and prerequisites location
- `packaging/`: PyInstaller specification
- `routes/`: extracted FastAPI route modules
- `services/`: storage, security, AI, evaluation, session, speech, and parsing
- `static/`, `templates/`: local frontend and approved assets
- `tests/`: backend, migration, lifecycle, security, and evaluator tests
- `scripts/`: release, speech-pack, benchmark, and calibration tools

The source and product are proprietary. See `PROPRIETARY_NOTICE.txt` and
`THIRD_PARTY_NOTICES.md` before redistribution.
