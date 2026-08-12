#!/usr/bin/env python3
"""
Deterministic repository inventory scanner.

Outputs a JSON document describing files, directories, imports, exports, and
basic metrics while excluding build/vendor/runtime artifacts.

Usage:
    python .agents/skills/codebase-architect/scripts/inventory.py > architecture/inventory.json
"""
from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from typing import Any

EXCLUDED_DIRS = {
    "node_modules",
    ".git",
    ".next",
    "dist",
    "build",
    ".turbo",
    "coverage",
    ".cache",
    "logs",
    "attached_assets",
    "audit-output",
    "artifacts",
    ".venv",
}

EXCLUDED_DIR_PREFIXES = (
    ".venv-",
)

EXCLUDED_FILE_PATTERNS = (
    r"\.log$",
    r"\.tmp$",
    r"\.lock$",
    r"pnpm-lock\.yaml$",
    r"package-lock\.json$",
    r"yarn\.lock$",
)

SOURCE_EXTENSIONS = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}

IMPORT_RE = re.compile(
    r"""
    ^\s*                                     # leading whitespace
    (?:import\s+                             # ES import
        (?:\{[^}]*\}|[^'"]*)                 # named or default imports
        \s+from\s+['"]([^'"]+)['"]           # module specifier
    |import\s*\(['"]([^'"]+)['"]\)          # dynamic import
    |require\s*\(\s*['"]([^'"]+)['"]\s*\)   # CommonJS require
    )
    """,
    re.VERBOSE | re.MULTILINE,
)

EXPORT_RE = re.compile(
    r"""
    ^\s*                                     # leading whitespace
    export\s+(?:
        (?:default\s+)?(?:class|function|const|let|var|enum|interface|type)\s+
        (\w+)                               # declaration name
    |\{(?:[^}]*)\}\s+from\s+['"][^'"]+['"]  # re-export (skip name)
 |\*\s+from\s+['"][^'"]+['"]              # namespace re-export
    )
    """,
    re.VERBOSE | re.MULTILINE,
)


def is_excluded_dir(part: str) -> bool:
    if part in EXCLUDED_DIRS:
        return True
    return any(part.startswith(prefix) for prefix in EXCLUDED_DIR_PREFIXES)


def is_excluded_file(path: Path) -> bool:
    name = path.name
    for pattern in EXCLUDED_FILE_PATTERNS:
        if re.search(pattern, name):
            return True
    return False


def read_text_limited(path: Path, limit: int = 2_000_000) -> str:
    try:
        data = path.read_bytes()
        if len(data) > limit:
            return ""
        return data.decode("utf-8", errors="replace")
    except (OSError, UnicodeDecodeError):
        return ""


def extract_imports(content: str) -> list[str]:
    results: list[str] = []
    for match in IMPORT_RE.finditer(content):
        specifier = match.group(1) or match.group(2) or match.group(3)
        if specifier:
            results.append(specifier)
    return results


def extract_exports(content: str) -> list[str]:
    results: list[str] = []
    for match in EXPORT_RE.finditer(content):
        name = match.group(1)
        if name:
            results.append(name)
    return results


def scan(root: Path) -> dict[str, Any]:
    files: list[dict[str, Any]] = []
    directories: list[str] = []
    ext_counter: dict[str, int] = {}
    total_lines = 0
    source_files = 0

    for dirpath, dirnames, filenames in os.walk(root, topdown=True):
        rel_dir = Path(dirpath).relative_to(root).as_posix()
        if rel_dir != ".":
            directories.append(rel_dir)

        # Filter excluded directories in-place
        dirnames[:] = [d for d in dirnames if not is_excluded_dir(d)]

        for filename in filenames:
            file_path = Path(dirpath) / filename
            if is_excluded_file(file_path):
                continue

            rel_path = file_path.relative_to(root).as_posix()
            ext = file_path.suffix.lower()
            ext_counter[ext] = ext_counter.get(ext, 0) + 1

            content = read_text_limited(file_path)
            line_count = content.count("\n") + (1 if content and not content.endswith("\n") else 0)
            total_lines += line_count

            entry: dict[str, Any] = {
                "path": rel_path,
                "extension": ext,
                "lines": line_count,
                "size_bytes": file_path.stat().st_size if file_path.exists() else 0,
            }

            if ext in SOURCE_EXTENSIONS:
                source_files += 1
                entry["imports"] = sorted(set(extract_imports(content)))
                entry["exports"] = sorted(set(extract_exports(content)))

            files.append(entry)

    files.sort(key=lambda f: f["path"])
    directories.sort()

    return {
        "meta": {
            "scanner": "codebase-architect/inventory.py",
            "root": root.resolve().as_posix(),
            "total_files": len(files),
            "source_files": source_files,
            "total_lines": total_lines,
            "extensions": dict(sorted(ext_counter.items())),
        },
        "directories": directories,
        "files": files,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Deterministic repository inventory scanner.")
    parser.add_argument("--root", default=".", help="Repository root (default: current directory)")
    parser.add_argument("--output", default="-", help="Output file (default: stdout)")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    inventory = scan(root)

    output = json.dumps(inventory, indent=2, sort_keys=True)
    if args.output == "-":
        print(output)
    else:
        Path(args.output).write_text(output, encoding="utf-8")


if __name__ == "__main__":
    main()
