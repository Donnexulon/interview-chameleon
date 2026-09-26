"""Create the small, reproducible Windows release ISO used for clean-VM tests."""

from __future__ import annotations

import argparse
from pathlib import Path

import pycdlib


def build_iso(installer: Path, checksums: Path, output: Path) -> None:
    for source in (installer, checksums):
        if not source.is_file():
            raise FileNotFoundError(source)

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.unlink(missing_ok=True)

    image = pycdlib.PyCdlib()
    try:
        image.new(interchange_level=3, joliet=3, vol_ident="IC_RELEASE")
        image.add_file(
            str(installer),
            iso_path="/INSTALLER.EXE;1",
            joliet_path=f"/{installer.name}",
        )
        image.add_file(
            str(checksums),
            iso_path="/SHA256.TXT;1",
            joliet_path=f"/{checksums.name}",
        )
        image.write(str(temporary))
    finally:
        image.close()
    temporary.replace(output)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--installer", required=True, type=Path)
    parser.add_argument("--checksums", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    build_iso(args.installer.resolve(), args.checksums.resolve(), args.output.resolve())


if __name__ == "__main__":
    main()
