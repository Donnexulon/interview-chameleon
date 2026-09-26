"""Runtime paths and safe first-launch data migration.

Packaged builds keep mutable data out of Program Files. Development keeps the
historic workspace database by default so existing developer workflows and
tests remain predictable. Tests may set INTERVIEW_CHAMELEON_DATA_DIR.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import sqlite3
from contextlib import closing
import sys
from dataclasses import dataclass
from pathlib import Path


APP_NAME = "Interview Chameleon"
APP_VERSION = "1.0.0-beta.1"


def is_packaged() -> bool:
    return bool(getattr(sys, "frozen", False) or os.getenv("INTERVIEW_CHAMELEON_PACKAGED") == "1")


def resource_root() -> Path:
    bundle = getattr(sys, "_MEIPASS", None)
    return Path(bundle).resolve() if bundle else Path(__file__).resolve().parents[1]


def _default_runtime_root() -> Path:
    override = os.getenv("INTERVIEW_CHAMELEON_DATA_DIR")
    if override:
        return Path(override).expanduser().resolve()
    if not is_packaged():
        return resource_root()
    local = os.getenv("LOCALAPPDATA")
    if not local:
        local = str(Path.home() / "AppData" / "Local")
    return (Path(local) / APP_NAME).resolve()


@dataclass(frozen=True)
class AppPaths:
    root: Path
    data: Path
    config: Path
    logs: Path
    models: Path
    cache: Path
    database: Path
    preferences: Path


def get_app_paths(*, create: bool = True) -> AppPaths:
    root = _default_runtime_root()
    external_runtime = is_packaged() or bool(os.getenv("INTERVIEW_CHAMELEON_DATA_DIR"))
    runtime_root = root if external_runtime else root / ".runtime"
    paths = AppPaths(
        root=root,
        data=root / "data" if external_runtime else root,
        config=runtime_root / "config",
        logs=runtime_root / "logs",
        models=runtime_root / "models",
        cache=runtime_root / "cache",
        database=(root / "data" / "interview.db")
        if external_runtime
        else root / "interview.db",
        preferences=runtime_root / "config" / "preferences.json",
    )
    if create:
        for directory in {paths.root, paths.data, paths.config, paths.logs, paths.models, paths.cache}:
            directory.mkdir(parents=True, exist_ok=True)
    return paths


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sqlite_integrity_ok(path: Path) -> bool:
    if not path.exists() or path.stat().st_size == 0:
        return False
    try:
        with closing(sqlite3.connect(str(path), timeout=5)) as conn:
            return conn.execute("PRAGMA quick_check").fetchone()[0] == "ok"
    except sqlite3.Error:
        return False


def migrate_legacy_database() -> dict[str, str | bool]:
    """Copy, verify, and retain the workspace database on first packaged launch."""
    paths = get_app_paths()
    target = paths.database
    if not is_packaged() or target.exists():
        return {"migrated": False, "database": str(target)}

    candidates = []
    configured = os.getenv("INTERVIEW_CHAMELEON_LEGACY_DB")
    if configured:
        candidates.append(Path(configured).expanduser().resolve())
    candidates.append(paths.root / "interview.db")
    candidates.append(Path.cwd().resolve() / "interview.db")
    candidates.append(resource_root() / "interview.db")

    unique_candidates = list(dict.fromkeys(candidate for candidate in candidates if candidate != target))
    source = next((candidate for candidate in unique_candidates if sqlite_integrity_ok(candidate)), None)
    if source is None:
        return {"migrated": False, "database": str(target)}

    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".db.migrating")
    shutil.copy2(source, temporary)
    if sha256_file(source) != sha256_file(temporary) or not sqlite_integrity_ok(temporary):
        temporary.unlink(missing_ok=True)
        raise RuntimeError("The existing database copy could not be verified")
    os.replace(temporary, target)
    backup = source.with_name(f"{source.name}.pre-desktop-backup")
    if not backup.exists():
        shutil.copy2(source, backup)
    return {
        "migrated": True,
        "database": str(target),
        "source": str(source),
        "source_backup": str(backup),
    }
