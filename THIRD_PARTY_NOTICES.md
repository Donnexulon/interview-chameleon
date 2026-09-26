# Third-party notices

Interview Chameleon includes third-party software distributed under its own
licenses. The release build generates a machine-readable Python dependency
inventory and CycloneDX SBOM beside the installer. Release owners must attach
those generated files and review all license texts before shipping.

Key runtime components include FastAPI, Uvicorn, Pydantic, Jinja2, Requests,
pypdf, python-docx, faster-whisper/CTranslate2/PyAV, Microsoft WebView2, the
Alpine.js CSP build, Tabler Icons, and MediaPipe Tasks Vision. Ollama is a
separately installed local runtime and is invoked through its loopback HTTP API;
the application does not bundle the Ollama Python client.

No ownership claim is made over third-party components or their trademarks.
This file is an inventory aid, not a replacement for the full license texts
generated and bundled during release.
