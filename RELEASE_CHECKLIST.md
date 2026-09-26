# Interview Chameleon 1.0.0-beta.1 release checklist

Do not ship when any required item is unchecked.

## Reproducible artifacts

- [ ] Build from a clean private checkout on Windows 10/11 x64.
- [x] Install `requirements-build.txt`, .NET 8 SDK, Inno Setup 6, and Node.js.
- [x] Place Microsoft's signed Evergreen bootstrapper at `installer/prerequisites/MicrosoftEdgeWebview2Setup.exe` and verify its Authenticode signer during every build.
- [ ] Run `scripts/build_release.ps1` without warnings or failures.
- [x] Run `scripts/build_release.ps1` to successful completion.
- [ ] Retain the complete current-build console output in `build/release-build-persistence.log`.
- [x] Generate the clean-VM ISO from the installer and checksum through the pinned release pipeline.
- [ ] If available, invoke the configured Inno signing hook with the release certificate.
- [ ] Build the optional English speech pack and verify every SHA-256 checksum.
- [x] Archive the SBOM, dependency inventory, evaluator gate report, and this checklist.

## Automated gates

- [x] All backend unit, route, migration, lifecycle, concurrency, and security tests pass (151 tests).
- [x] All frontend JavaScript syntax and unit tests pass.
- [x] Packaged backend token, homepage, status, disabled-docs, and clean-shutdown smoke test passes.
- [x] Packaged WebView2 host renders, exposes keyboard focus and route announcements, persists a demo report to isolated storage, returns to history, and shuts down its backend cleanly.
- [x] Hostile imported report content is escaped in the review UI and printable report.
- [x] Playwright setup → interview → report → history → focused-practice flow passes.
- [x] Browser-origin UI progress is restored from bounded atomic storage after origin data is erased.
- [x] First launch blocks on a four-choice local-model screen; disconnected, simulated download, selection, and later model-manager routes pass without network model transfer.
- [x] Automated accessibility checks pass on every primary page.
- [x] Dependency vulnerability scan has no known vulnerability.
- [x] Six-format evaluator calibration meets the published separation, variance, evidence, and recovery gates.

## Windows acceptance matrix

- [ ] Fresh install with no Python, Node.js, FFmpeg, Ollama, or WebView2.
- [ ] Upgrade copies and verifies the legacy database and retains its backup.
- [x] In-place installer upgrade preserves application data and the upgraded app relaunches cleanly.
- [ ] Missing model and interrupted model download show recoverable states.
- [ ] Denied camera/microphone and missing speech pack fall back cleanly.
- [x] Offline question library and practice tools work without AI rehearsal.
- [ ] CPU-only slow inference is communicated and never freezes navigation.
- [ ] Crash during interview resumes without duplicate turns.
- [ ] Crash during evaluation resumes its queued persistent job.
- [ ] Corrupt database is detected before use and recovery instructions are clear.
- [ ] Uninstall/reinstall is tested once preserving data and once deleting data.

## Visual and accessibility matrix

- [ ] 1024×700, 1280×720, 1366×768, 1920×1080, and 2560×1440.
- [ ] Windows scaling at 100%, 125%, 150%, and 200%.
- [ ] Keyboard-only navigation, visible focus, modal focus traps, and screen-reader announcements.
- [ ] 200% text enlargement and reduced-motion preference.
- [ ] No unintended body scrolling, clipped controls, footer overlap, or empty-space regression.

## Release materials

- [x] Versioned installer and matching SHA-256 file are present.
- [x] Versioned clean-VM ISO contains the exact installer and matching SHA-256 file.
- [ ] Installer, optional speech pack, and SHA-256 file are present.
- [ ] Privacy notice and proprietary notice have been legally reviewed.
- [ ] Third-party notices and user-generated asset provenance are complete.
- [ ] Unsigned-build warning is disclosed to invited testers if no certificate was used.

## Latest automated evidence

Verified on Windows 11 x64 on 2026-09-25. The current beta installer is unsigned, is 137,911,165
bytes, and has SHA-256
`ebf54abf6c76f31b908e8766f2bdb4916a763c56ee1d8d26be9d52f821af8d2a`; it matches
`release/SHA256SUMS.txt`. The canonical clean-VM ISO is 137,975,808 bytes with SHA-256
`1767dd0d8bc11871fc82d3846a979f2f7bdb25514b4a91b0b98087533bafaa35`. The isolated release build passed 151
backend tests, frontend state tests, eighteen Playwright full-flow/accessibility/persistence tests,
and the packaged-backend smoke test. The runtime inventory and CycloneDX SBOM each contain 42
components, and all 42 audited dependencies report zero known vulnerabilities. The six-format
evaluator gate passed 34 cases across three runs each (102/102 attempts), with no range, ordering,
repeat-variance, identity-invariance, grounding, or runtime failures and a maximum observed repeat
spread of zero points. A clean Windows 11 VM installation exposed a cold-start timeout and a
hard-coded runtime-ready label; both defects are fixed in this artifact.

The rebuilt artifact was installed and launched from the pristine Windows 11 snapshot on
2026-09-11. Cold launch completed without timing out, and the header settled from `CHECKING` to
`SETUP NEEDED`. Session setup reported Ollama stopped, `qwen2.5:7b` missing, 8 GB memory,
49.8 GB free storage, and the optional speech pack missing; status refresh completed, the AI speed
test returned a clear requirement message, and rehearsal launch remained disabled. The 34-card
offline library loaded and filtered to its 10 technical cards, coaching notes opened, a card could
be filed and remained filed after navigation, and STAR Builder opened and enforced its required
first stage. Session archive, calibration ledger, progress dashboard, and portfolio room also
rendered on the clean guest, and the desktop window exited cleanly.

The final artifact was then installed as an in-place upgrade on the same clean guest. Its empty
home strip correctly reported `No sessions yet`. A practice card was filed, the desktop app was
closed immediately, and the upgraded app was relaunched on a new random loopback origin; the card
returned as `FILED`, proving the new bounded atomic UI-state bridge and shutdown flush. Manual
hardware/permission, legacy-database upgrade, uninstall/reinstall, screen-size/DPI, screen-reader,
signing, legal, and optional speech-pack gates remain open above.

The current artifact adds the first-launch four-model chooser and persistent AI Models manager.
The redesigned flow follows six distinct onboarding states: Ollama installation/start, connection
check, coach choice, dedicated download progress, interrupted-download recovery, and coach-ready
confirmation. It includes the approved Interview Chameleon mark, a focused Ollama-only first step,
automatic missing-versus-installed-versus-running detection, an official Ollama download action,
model choices that appear only after Ollama connects, byte-level download progress, pause/retry
recovery, a safe fixed-action desktop bridge for opening or downloading Ollama, and a branded
Windows executable/installer icon. The Ollama-only step uses the product owner's selected hand-drawn llama while the window
header retains the Interview Chameleon identity. Its browser gate used simulated streaming and interruption, so
no model files were fetched during the build. The model-download/interruption and clean-VM
acceptance rows remain open until this exact artifact is exercised in the pristine guest.

The same artifact adds a 1.8-second dark reveal, a 1.4-second still hold, and a 3.0-second tunnel.
The reversed brand mark and wordmark resolve once, remain still while the destination paints, then
dissolve into a matching transparent cutout during the first 14 percent of the tunnel while the
lockup is still nearly stationary. Only that cutout performs the long zoom, preventing the doubled
wordmark that WebView2/Chromium could produce when two transformed SVG layers overlapped. The
filled left stroke of the capital `C` is the zoom origin; no circle or artificial aperture is drawn.
The cutout expands until the already-rendered app clears every edge, and the dark surface never
cross-fades away midway through the transition. The final MP4, WebM, hold frame, and 16-frame contact
sheet confirm the sequence. The Playwright gate verifies 61 or more monotonic scale keyframes, the
early single-layer handoff, the final viewport-clearing scale, cold logo decoding, and reduced
motion. There is no key/click skip path, a static reduced-motion alternative remains available, and
the earlier ivory treatment is still a one-line fallback. The home header now uses the same reversed ivory/orange mark, and its
main action uses a deeper, subtly textured burnt orange without the previous continuous shimmer.
Setup Step 2 uses the hand-drawn two-pass circle around its selected format number. Step 3 has no
selection circle, and Step 4 opens with no default selection: a correctly aligned circle is drawn
only after the user explicitly chooses difficulty and length. The pressure-mode control is fully
rounded and selects its intended options only when the user turns it on. The old portrait outlines,
check marks, and implicit Step 4 choices are absent. The dark setup header uses the reversed product
mark plus a brief nine-second-period brand pulse with a long quiet interval. The coach-ready screen
can return to Step 2, download another model, and advance to Step 3 again; that formerly stuck path
is covered by the browser release gate. Returning from AI Models restores the exact setup step and
draft selections, and an already-installed active model can continue without starting another
download. The final visual repair pass also keeps interviewer carousel
arrows inside the centre column, decodes portraits before review capture, restores readable resume
and locked-achievement text, makes the Practice Library masthead full width, and resets saved session
reports to their masthead. This exact September 25 installer still requires the unchecked hardware,
DPI, screen-reader, clean-guest model-download, and permission rows above before public release.
