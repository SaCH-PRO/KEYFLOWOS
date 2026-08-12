#!/usr/bin/env python3
"""
Deterministic dependency scanner for TypeScript/JavaScript source files.

Extracts import edges from .ts/.tsx/.js files and emits a JSON graph of
nodes (files and external/workspace packages) and edges.

Usage:
    python .agents/skills/codebase-architect/scripts/dependency_scan.py > architecture/dependencies.json
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

SOURCE_EXTENSIONS = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}

IMPORT_RE = re.compile(
    r"""
    ^\s*
    (?:import\s+
        (?:\{[^}]*\}|[^'"]*)
        \s+from\s+['"]([^'"]+)['"]
    |import\s*\(['"]([^'"]+)['"]\)
    |require\s*\(\s*['"]([^'"]+)['"]\s*\)
    )
    """,
    re.VERBOSE | re.MULTILINE,
)


def is_excluded_dir(part: str) -> bool:
    if part in EXCLUDED_DIRS:
        return True
    return any(part.startswith(prefix) for prefix in EXCLUDED_DIR_PREFIXES)


def extract_imports(content: str) -> list[str]:
    results: list[str] = []
    for match in IMPORT_RE.finditer(content):
        specifier = match.group(1) or match.group(2) or match.group(3)
        if specifier:
            results.append(specifier)
    return results


def resolve_relative(source_dir: Path, specifier: str, root: Path) -> tuple[str | None, bool]:
    """Resolve a relative specifier to a root-relative file path if it exists."""
    candidate = (source_dir / specifier).resolve()

    # If specifier points to a directory, look for an index file
    suffixes = ("", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")
    index_suffixes = ("index.ts", "index.tsx", "index.js", "index.jsx", "index.mjs", "index.cjs")

    for suffix in suffixes:
        path = candidate.with_suffix(candidate.suffix + suffix) if suffix else candidate
        if path.is_file():
            return path.relative_to(root).as_posix(), True

    if candidate.is_dir():
        for index in index_suffixes:
            path = candidate / index
            if path.is_file():
                return path.relative_to(root).as_posix(), True

    # Return the unresolved relative path for the graph
    rel = candidate.relative_to(root).as_posix() if candidate.is_relative_to(root) else specifier
    return rel, False


def classify_specifier(specifier: str, source_dir: Path, root: Path) -> dict[str, Any]:
    if specifier.startswith("."):
        target, resolved = resolve_relative(source_dir, specifier, root)
        return {
            "type": "relative",
            "target": target or specifier,
            "resolved": resolved,
        }
    if specifier.startswith("@keyflow/"):
        return {
            "type": "workspace",
            "target": specifier,
            "resolved": True,
        }
    return {
        "type": "external",
        "target": specifier,
        "resolved": False,
    }


def scan(root: Path) -> dict[str, Any]:
    nodes: dict[str, dict[str, Any]] = {}
    edges: list[dict[str, Any]] = []

    for dirpath, dirnames, filenames in os.walk(root, topdown=True):
        dirnames[:] = [d for d in dirnames if not is_excluded_dir(d)]

        for filename in filenames:
            file_path = Path(dirpath) / filename
            ext = file_path.suffix.lower()
            if ext not in SOURCE_EXTENSIONS:
                continue

            rel_path = file_path.relative_to(root).as_posix()
            try:
                content = file_path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue

            nodes[rel_path] = {
                "id": rel_path,
                "type": "file",
                "extension": ext,
            }

            source_dir = file_path.parent
            for specifier in set(extract_imports(content)):
                classification = classify_specifier(specifier, source_dir, root)
                target_id = classification["target"]

                if target_id not in nodes:
                    nodes[target_id] = {
                        "id": target_id,
                        "type": classification["type"],
                    }

                edges.append(
                    {
                        "source": rel_path,
                        "target": target_id,
                        "specifier": specifier,
                        "type": classification["type"],
                        "resolved": classification["resolved"],
                    }
                )

    return {
        "meta": {
            "scanner": "codebase-architect/dependency_scan.py",
            "root": root.resolve().as_posix(),
            "nodes": len(nodes),
            "edges": len(edges),
        },
        "nodes": [nodes[k] for k in sorted(nodes)],
        "edges": sorted(edges, key=lambda e: (e["source"], e["target"], e["specifier"])),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Deterministic dependency scanner.")
    parser.add_argument("--root", default=".", help="Repository root (default: current directory)")
    parser.add_argument("--output", default="-", help="Output file (default: stdout)")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    graph = scan(root)

    output = json.dumps(graph, indent=2, sort_keys=True)
    if args.output == "-":
        print(output)
    else:
        Path(args.output).write_text(output, encoding="utf-8")


if __name__ == "__main__":
    main()
