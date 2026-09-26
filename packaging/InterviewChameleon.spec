# PyInstaller one-folder backend bundle. Run from the repository root.
from pathlib import Path

root = Path(SPECPATH).resolve().parent
assets = [
    "brand/interview-chameleon-mark.png",
    "hero/home-studio-pulled-back-v7.webp",
    "setup/briefing-paper-texture.webp",
    "setup/ollama-llama.png",
    "setup/local-ai-checking-stamp.webp",
    "setup/local-ai-ready-stamp.webp",
    "setup/local-ai-model-missing-stamp.webp",
    "setup/local-ai-stopped-stamp.webp",
    "interviewers/interviewer-female-studio-v2.webp",
    "interviewers/interviewer-male.webp",
    "interviewers/interviewer-female.webp",
    "interviewers/interviewer-maya.webp",
    "interviewers/interviewer-victoria.webp",
    "interviewers/interviewer-sam.webp",
]
datas = [
    (str(root / "templates"), "templates"),
    (str(root / "static" / "css"), "static/css"),
    (str(root / "static" / "js"), "static/js"),
    (str(root / "static" / "vendor"), "static/vendor"),
] + [(str(root / "static" / "assets" / asset), f"static/assets/{Path(asset).parent.as_posix()}") for asset in assets]

a = Analysis(
    [str(root / "desktop_server.py")],
    pathex=[str(root)],
    binaries=[],
    datas=datas,
    hiddenimports=["uvicorn.logging", "uvicorn.loops.auto", "uvicorn.protocols.http.auto", "uvicorn.protocols.websockets.auto", "uvicorn.lifespan.on"],
    # The build machine may contain unrelated data-science and UI packages.
    # Explicit exclusions keep the release bundle reproducible and prevent
    # optional-import hooks from pulling hundreds of megabytes into the app.
    excludes=[
        "torch",
        "whisper",
        "edge_tts",
        "pydub",
        "tkinter",
        "matplotlib",
        "gradio",
        "pandas",
        "scipy",
        "pyarrow",
        "numba",
        "llvmlite",
        "transformers",
        "datasets",
        "tensorflow",
        "sklearn",
        "IPython",
        "notebook",
        "jupyter",
        "pytest",
    ],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="InterviewChameleon.Backend", console=False)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="InterviewChameleon.Backend")
