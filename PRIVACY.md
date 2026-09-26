# Interview Chameleon beta privacy notice

Interview Chameleon is a single-user, local-first Windows application. It does
not require an account and it does not include product analytics, advertising,
crash-report uploads, or telemetry.

## Data kept on this computer

Sessions, reports, preferences, derived role maps, logs, models, and caches are
stored under `%LOCALAPPDATA%\Interview Chameleon\`. Logs contain request IDs,
operation names, timing, status codes, and sanitized error types. They are
designed to exclude resumes, transcripts, answers, portfolio URLs, and launch
tokens.

Raw resume text is kept only for recovery of an active session by default. It is
removed when the evaluation completes. A preference can keep it with session
history. Derived role evidence may remain so focused practice still works.

Camera frames remain in the embedded browser and are not written to the
database. Experimental camera coaching is limited to observable signals such as
visibility, approximate gaze direction, framing, movement, and posture
stability. It does not infer emotion, personality, or hiring readiness.

## Network access

The app communicates with Ollama on the local loopback interface. It does not
silently contact an Interview Chameleon service. Model installation is performed
by Ollama when the user requests it. WebView2 installation is performed by the
installer only when the runtime is absent.

Portfolio analysis is the only optional outbound content feature. The app asks
for consent before first use, then requests the public URL directly from this
computer. The extracted page text is sent only to the local Ollama model.

## User controls

The app exposes export, per-session deletion, delete-all/reset, database
integrity, backup, consent, resume-retention, voice, camera-coaching, and
accessibility preferences. Diagnostics exports exclude user content by default.

This notice describes the beta implementation and should be reviewed for the
laws and distribution regions that apply before a public release.
