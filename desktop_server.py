"""PyInstaller entry point for the desktop-owned FastAPI process."""

from __future__ import annotations

import json
import os
import socket
import sys
from pathlib import Path

import uvicorn


def main() -> int:
    os.environ.setdefault("INTERVIEW_CHAMELEON_PACKAGED", "1")
    from main import app

    ready_file = os.getenv("INTERVIEW_CHAMELEON_READY_FILE")
    if not ready_file:
        raise RuntimeError("INTERVIEW_CHAMELEON_READY_FILE is required")

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", 0))
    listener.listen(2048)
    port = int(listener.getsockname()[1])
    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=port,
        log_config=None,
        access_log=False,
        server_header=False,
        date_header=False,
    )
    server = uvicorn.Server(config)
    app.state.shutdown_callback = lambda: setattr(server, "should_exit", True)

    destination = Path(ready_file)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".tmp")
    temporary.write_text(json.dumps({"port": port, "pid": os.getpid()}), encoding="utf-8")
    os.replace(temporary, destination)
    try:
        server.run(sockets=[listener])
        return 0
    finally:
        destination.unlink(missing_ok=True)
        listener.close()


if __name__ == "__main__":
    sys.exit(main())
