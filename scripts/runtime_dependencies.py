"""Resolve the installed runtime dependency closure for release records."""

from __future__ import annotations

import argparse
import importlib.metadata
from pathlib import Path

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name


def requirement_file_roots(path: Path) -> list[str]:
    roots: list[str] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line or line.startswith(("-r", "--requirement")):
            continue
        roots.append(canonicalize_name(Requirement(line).name))
    return roots


def installed_runtime_closure(roots: list[str]) -> list[importlib.metadata.Distribution]:
    installed = {
        canonicalize_name(distribution.metadata["Name"]): distribution
        for distribution in importlib.metadata.distributions()
        if distribution.metadata.get("Name")
    }
    selected: dict[str, importlib.metadata.Distribution] = {}
    pending = list(roots)
    while pending:
        name = canonicalize_name(pending.pop())
        if name in selected:
            continue
        distribution = installed.get(name)
        if distribution is None:
            raise RuntimeError(f"Required runtime distribution is not installed: {name}")
        selected[name] = distribution
        for value in distribution.requires or []:
            requirement = Requirement(value)
            if requirement.marker and not requirement.marker.evaluate({"extra": ""}):
                continue
            dependency = canonicalize_name(requirement.name)
            if dependency not in selected:
                pending.append(dependency)
    return [selected[name] for name in sorted(selected)]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--requirements", type=Path, default=Path("requirements.txt"))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--names", action="store_true")
    args = parser.parse_args()
    distributions = installed_runtime_closure(requirement_file_roots(args.requirements))
    lines = [
        distribution.metadata["Name"] if args.names else f"{distribution.metadata['Name']}=={distribution.version}"
        for distribution in distributions
    ]
    content = "\n".join(lines) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(content, encoding="utf-8")
    else:
        print(content, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
