#!/usr/bin/env python3
"""
KEYFLOWOS Project Thread Intelligence Harvester

Deterministically ingests exported ChatGPT conversations and plain-text
transcripts into a normalized, deduplicated evidence corpus for later
human/agent review.

It does NOT decide canonical architecture. It produces evidence and candidate
artifacts that must pass the normal KEYFLOWOS reconciliation process.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

SECRET_PATTERNS = [
    re.compile(r"(?i)(api[_-]?key\s*[:=]\s*)[^\s,;]+"),
    re.compile(r"(?i)(token\s*[:=]\s*)[^\s,;]+"),
    re.compile(r"(?i)(password\s*[:=]\s*)[^\s,;]+"),
    re.compile(r"(?i)(secret\s*[:=]\s*)[^\s,;]+"),
]

CATEGORY_PATTERNS: dict[str, list[re.Pattern[str]]] = {
    "vision": [re.compile(p, re.I) for p in [r"vision", r"north star", r"jarvis", r"ciel", r"key should"]],
    "architecture": [re.compile(p, re.I) for p in [r"architecture", r"kernel", r"constellation", r"journey", r"semantic owner", r"source of truth"]],
    "decision": [re.compile(p, re.I) for p in [r"decision", r"we decided", r"option [a-z]", r"do not build", r"canonical"]],
    "finding": [re.compile(p, re.I) for p in [r"finding", r"contradiction", r"gap", r"defect", r"bug", r"issue"]],
    "research": [re.compile(p, re.I) for p in [r"research", r"study", r"evidence", r"paper", r"repo"]],
    "continuity": [re.compile(p, re.I) for p in [r"continuity", r"handoff", r"rollover", r"current-state", r"memory"]],
    "implementation": [re.compile(p, re.I) for p in [r"implement", r"commit", r"pull request", r"pr #", r"branch", r"test"]],
    "reliability": [re.compile(p, re.I) for p in [r"idempot", r"retry", r"replay", r"recovery", r"fail closed", r"no fake green", r"tenant"]],
    "automation": [re.compile(p, re.I) for p in [r"worker", r"control plane", r"autonomous", r"automation", r"dogfood", r"self-develop"]],
    "memory": [re.compile(p, re.I) for p in [r"context genome", r"business genome", r"memory", r"provenance", r"supersed"]],
}

HIGH_VALUE_PATTERNS = [
    re.compile(p, re.I)
    for p in [
        r"we decided",
        r"decision:",
        r"must ",
        r"do not ",
        r"should ",
        r"finding",
        r"contradiction",
        r"root cause",
        r"next step",
        r"architecture",
        r"kernel",
        r"constellation",
        r"journey",
        r"research",
        r"implement",
        r"commit",
        r"pr #",
        r"blocked",
        r"no fake green",
        r"source of truth",
        r"semantic owner",
        r"continuity",
        r"handoff",
    ]
]

PROJECT_TERMS_DEFAULT = ["keyflow", "keyflowos", " key ", "jarvis", "ciel", "business genome"]


@dataclass
class ThreadRecord:
    thread_id: str
    title: str
    source_file: str
    source_kind: str
    created_at: str | None
    updated_at: str | None
    message_count: int
    relevant: bool
    content_hash: str


@dataclass
class MessageRecord:
    thread_id: str
    message_id: str
    role: str
    created_at: str | None
    text: str
    text_hash: str
    source_file: str


@dataclass
class CandidateRecord:
    candidate_id: str
    thread_id: str
    message_id: str
    role: str
    categories: list[str]
    score: int
    excerpt: str
    source_file: str
    disposition: str = "UNREVIEWED"


def iso_time(value: Any) -> str | None:
    if value in (None, ""):
        return None
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()
        return str(value)
    except Exception:
        return None


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()


def redact(text: str) -> str:
    out = text
    for pattern in SECRET_PATTERNS:
        out = pattern.sub(lambda m: f"{m.group(1)}[REDACTED]", out)
    return out


def text_from_message(message: dict[str, Any]) -> str:
    content = message.get("content") or {}
    parts = content.get("parts")
    if isinstance(parts, list):
        values: list[str] = []
        for part in parts:
            if isinstance(part, str):
                values.append(part)
            elif isinstance(part, dict):
                values.append(json.dumps(part, ensure_ascii=False))
        return "\n".join(values).strip()
    if isinstance(content, str):
        return content.strip()
    return ""


def parse_chatgpt_export(data: Any, source_file: Path) -> tuple[list[ThreadRecord], list[MessageRecord]]:
    conversations = data if isinstance(data, list) else data.get("conversations", []) if isinstance(data, dict) else []
    threads: list[ThreadRecord] = []
    messages: list[MessageRecord] = []

    for index, conv in enumerate(conversations):
        if not isinstance(conv, dict):
            continue
        thread_id = str(conv.get("id") or conv.get("conversation_id") or f"{source_file.stem}:{index}")
        title = str(conv.get("title") or "Untitled")
        mapping = conv.get("mapping") or {}
        thread_messages: list[MessageRecord] = []

        if isinstance(mapping, dict):
            for node_id, node in mapping.items():
                if not isinstance(node, dict):
                    continue
                msg = node.get("message")
                if not isinstance(msg, dict):
                    continue
                text = text_from_message(msg)
                if not text:
                    continue
                author = msg.get("author") or {}
                role = str(author.get("role") or "unknown")
                created = iso_time(msg.get("create_time"))
                message_id = str(msg.get("id") or node_id)
                thread_messages.append(
                    MessageRecord(
                        thread_id=thread_id,
                        message_id=message_id,
                        role=role,
                        created_at=created,
                        text=text,
                        text_hash=sha256_text(text),
                        source_file=str(source_file),
                    )
                )

        thread_messages.sort(key=lambda m: (m.created_at or "", m.message_id))
        messages.extend(thread_messages)
        joined = "\n".join(m.text for m in thread_messages)
        threads.append(
            ThreadRecord(
                thread_id=thread_id,
                title=title,
                source_file=str(source_file),
                source_kind="chatgpt_export",
                created_at=iso_time(conv.get("create_time")),
                updated_at=iso_time(conv.get("update_time")),
                message_count=len(thread_messages),
                relevant=False,
                content_hash=sha256_text(joined),
            )
        )
    return threads, messages


def parse_plain_text(path: Path) -> tuple[list[ThreadRecord], list[MessageRecord]]:
    text = path.read_text(encoding="utf-8", errors="replace")
    thread_id = sha256_text(str(path.resolve()))[:20]
    message = MessageRecord(
        thread_id=thread_id,
        message_id=f"{thread_id}:0",
        role="unknown",
        created_at=None,
        text=text,
        text_hash=sha256_text(text),
        source_file=str(path),
    )
    thread = ThreadRecord(
        thread_id=thread_id,
        title=path.stem,
        source_file=str(path),
        source_kind="text_transcript",
        created_at=None,
        updated_at=None,
        message_count=1,
        relevant=False,
        content_hash=message.text_hash,
    )
    return [thread], [message]


def iter_inputs(root: Path) -> Iterable[Path]:
    if root.is_file():
        yield root
        return
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.suffix.lower() in {".json", ".md", ".txt"}:
            yield path


def categories_for(text: str) -> list[str]:
    found: list[str] = []
    for category, patterns in CATEGORY_PATTERNS.items():
        if any(p.search(text) for p in patterns):
            found.append(category)
    return found


def value_score(text: str, categories: list[str]) -> int:
    score = len(categories) * 2
    score += sum(1 for p in HIGH_VALUE_PATTERNS if p.search(text))
    if len(text) > 500:
        score += 1
    if len(text) > 2000:
        score += 1
    return score


def excerpt(text: str, limit: int = 1200) -> str:
    compact = re.sub(r"\s+", " ", text).strip()
    return compact if len(compact) <= limit else compact[: limit - 3] + "..."


def write_jsonl(path: Path, rows: Iterable[Any]) -> None:
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(asdict(row), ensure_ascii=False) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Harvest KEYFLOWOS-relevant project thread intelligence.")
    parser.add_argument("--input", required=True, help="ChatGPT export JSON, transcript file, or directory.")
    parser.add_argument("--output", required=True, help="Output directory.")
    parser.add_argument("--project-term", action="append", dest="project_terms", default=[], help="Additional relevance term.")
    parser.add_argument("--min-score", type=int, default=4, help="Candidate threshold.")
    parser.add_argument("--no-redact", action="store_true", help="Disable basic secret redaction.")
    args = parser.parse_args()

    input_root = Path(args.input)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    project_terms = [t.lower() for t in (PROJECT_TERMS_DEFAULT + args.project_terms)]

    threads: list[ThreadRecord] = []
    messages: list[MessageRecord] = []
    errors: list[dict[str, str]] = []
    scanned_files = 0

    for path in iter_inputs(input_root):
        scanned_files += 1
        try:
            if path.suffix.lower() == ".json":
                data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
                parsed_threads, parsed_messages = parse_chatgpt_export(data, path)
                if not parsed_threads:
                    parsed_threads, parsed_messages = parse_plain_text(path)
            else:
                parsed_threads, parsed_messages = parse_plain_text(path)
            threads.extend(parsed_threads)
            messages.extend(parsed_messages)
        except Exception as exc:
            errors.append({"file": str(path), "error": str(exc)})

    # Exact duplicate messages can occur in repeated exports. Keep the first.
    unique_messages: list[MessageRecord] = []
    seen_message_hashes: set[tuple[str, str]] = set()
    for msg in messages:
        key = (msg.thread_id, msg.text_hash)
        if key in seen_message_hashes:
            continue
        seen_message_hashes.add(key)
        if not args.no_redact:
            msg.text = redact(msg.text)
            msg.text_hash = sha256_text(msg.text)
        unique_messages.append(msg)
    messages = unique_messages

    by_thread: dict[str, list[MessageRecord]] = {}
    for msg in messages:
        by_thread.setdefault(msg.thread_id, []).append(msg)

    relevant_ids: set[str] = set()
    candidates: list[CandidateRecord] = []
    for thread in threads:
        full = " ".join(m.text for m in by_thread.get(thread.thread_id, []))
        low = f"{thread.title} {full}".lower()
        thread.relevant = any(term in low for term in project_terms)
        if thread.relevant:
            relevant_ids.add(thread.thread_id)

    for msg in messages:
        if msg.thread_id not in relevant_ids:
            continue
        cats = categories_for(msg.text)
        score = value_score(msg.text, cats)
        if score < args.min_score:
            continue
        cid = sha256_text(f"{msg.thread_id}|{msg.message_id}|{msg.text_hash}")[:24]
        candidates.append(
            CandidateRecord(
                candidate_id=cid,
                thread_id=msg.thread_id,
                message_id=msg.message_id,
                role=msg.role,
                categories=cats,
                score=score,
                excerpt=excerpt(msg.text),
                source_file=msg.source_file,
            )
        )

    candidates.sort(key=lambda c: (-c.score, c.thread_id, c.message_id))
    write_jsonl(output / "threads.jsonl", threads)
    write_jsonl(output / "messages.jsonl", messages)
    write_jsonl(output / "candidates.jsonl", candidates)

    coverage = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "input": str(input_root),
        "scanned_files": scanned_files,
        "threads_total": len(threads),
        "threads_relevant": len(relevant_ids),
        "messages_total": len(messages),
        "candidates_total": len(candidates),
        "parse_errors": errors,
        "project_terms": project_terms,
        "min_score": args.min_score,
    }
    (output / "coverage.json").write_text(json.dumps(coverage, indent=2), encoding="utf-8")

    review_lines = [
        "# Project Thread Harvest Review Queue",
        "",
        f"- Threads scanned: {len(threads)}",
        f"- Relevant threads: {len(relevant_ids)}",
        f"- Messages normalized: {len(messages)}",
        f"- Candidate artifacts: {len(candidates)}",
        f"- Parse errors: {len(errors)}",
        "",
        "Candidates are evidence only. Reviewers must disposition each candidate as CURRENT, ABSORBED, SUPERSEDED, IMPLEMENTED, DUPLICATE, REJECTED, DEFERRED or ORPHANED.",
        "",
    ]
    for candidate in candidates[:250]:
        review_lines.extend(
            [
                f"## {candidate.candidate_id} — score {candidate.score}",
                f"- Thread: {candidate.thread_id}",
                f"- Role: {candidate.role}",
                f"- Categories: {', '.join(candidate.categories) or 'uncategorized'}",
                f"- Source: {candidate.source_file}",
                "",
                candidate.excerpt,
                "",
            ]
        )
    (output / "review-queue.md").write_text("\n".join(review_lines), encoding="utf-8")

    print(json.dumps(coverage, indent=2))
    return 0 if not errors else 2


if __name__ == "__main__":
    raise SystemExit(main())
