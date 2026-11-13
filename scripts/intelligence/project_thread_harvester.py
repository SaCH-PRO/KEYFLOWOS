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
import os
import re
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

# --- secret redaction ---------------------------------------------------------
#
# Redaction is on by default and is best-effort: it removes the credential
# shapes below, and nothing else. A credential with no recognisable shape and
# no telling name (a bare password in prose, say) still passes through, so the
# outputs are local working files, never something to paste into an issue, a
# pull request or a model prompt without reading them first.
#
# Every rule replaces only the secret itself with REDACTED, keeping any name,
# quote, URL user or host around it so the evidence stays readable. The rules
# are applied in order and are idempotent: REDACTED matches none of them.

REDACTED = "[REDACTED]"

# A value after a sensitive name: quoted (plain, or JSON-escaped inside a
# string), or bare up to whitespace or a delimiter.
_VALUE = r"""(?:\\"(?:[^"\\\n]|\\(?!"))*\\"|"[^"\n]*"|'[^'\n]*'|[^\s,;"'\\]+)"""

# An assignment: "=" or ":", but not "==", "=>", "::" or ":=" (code, not data).
_ASSIGN = r"(?::(?![:=])|=(?![=>]))"

# Names whose value is a secret, matched case-insensitively at the end of an
# identifier (client_secret, apiKey, X-Auth-Token, aws_secret_access_key,
# "password"). "tokens", "max_tokens" and "token_count" do not end in one.
_SENSITIVE_NAME = (
    r"[A-Za-z0-9_.-]*?"
    r"(?:api[_-]?key|access[_-]?key|private[_-]?key|secret|token|passw(?:or)?d|credentials?)"
    r"(?:[_-]?(?:key|value|secret|token|hash))?"
)

# Upper-case environment names with a sensitive underscore-separated segment
# (JWT_SECRET, CREDENTIALS_ENCRYPTION_KEY, SSH_PRIVATE). Whole segments only,
# so KEYFLOW_ENV and MAX_TOKENS are not sensitive.
_ENV_SEGMENT = r"(?:SECRETS?|TOKEN|KEYS?|APIKEY|PASSWORD|PASSWD|PASS|PWD|PRIVATE|CREDENTIALS?|DSN)"
_ENV_NAME = rf"(?:[A-Z0-9]+_)*{_ENV_SEGMENT}(?:_[A-Z0-9]+)*"
_ENV_NAME_COMPOUND = rf"(?:(?:[A-Z0-9]+_)+{_ENV_SEGMENT}(?:_[A-Z0-9]+)*|{_ENV_SEGMENT}(?:_[A-Z0-9]+)+)"


def _keep_quotes(value: str) -> str:
    """REDACTED in place of a value, inside the value's own quotes."""
    for quote in ('\\"', '"', "'"):
        if len(value) >= 2 * len(quote) and value.startswith(quote) and value.endswith(quote):
            return f"{quote}{REDACTED}{quote}"
    return REDACTED


def _redact_value(match: re.Match[str]) -> str:
    return match.group("keep") + _keep_quotes(match.group("value"))


def _redact_whole(match: re.Match[str]) -> str:
    return REDACTED


def _redact_pem(match: re.Match[str]) -> str:
    label = match.group("label")
    return f"-----BEGIN {label}-----{REDACTED}-----END {label}-----"


_PRIVATE_KEY_LABEL = r"(?P<label>[A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?)"

SECRET_RULES: list[tuple[str, re.Pattern[str], Any]] = [
    # PEM private keys: the whole block, BEGIN to END (or, cut off, to the end
    # of the base64 that follows BEGIN).
    (
        "pem-private-key",
        re.compile(rf"-----BEGIN {_PRIVATE_KEY_LABEL}-----(?:[\s\S]*?-----END (?P=label)-----|[A-Za-z0-9+/=\s\\]*)"),
        _redact_pem,
    ),
    # scheme://user:password@host, for any scheme: keep the user and host.
    (
        "url-credentials",
        re.compile(r"(?P<keep>\b[A-Za-z][A-Za-z0-9+.-]*://[^\s:/@\"'<>]*:)(?P<value>[^\s@/\"'<>]+)(?=@)"),
        _redact_value,
    ),
    # Authorization: <scheme> <credential>, as a header or a JSON/YAML field.
    (
        "authorization-header",
        re.compile(
            r"(?i)(?P<keep>\bauthorization[\"']?\s*[:=]\s*[\"']?(?:bearer|basic|token|bot|digest)\s+)(?P<value>[^\s\"',;]+)"
        ),
        _redact_value,
    ),
    # Bearer <token> anywhere else. The token must contain a digit, so prose
    # such as "Bearer authentication" is left alone.
    (
        "bearer-token",
        re.compile(r"(?P<keep>\bBearer\s+)(?P<value>(?=[A-Za-z._~+/-]*\d)[A-Za-z0-9._~+/-]{16,}=*)"),
        _redact_value,
    ),
    # Provider token shapes.
    ("stripe-key", re.compile(r"\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{10,}"), _redact_whole),
    ("stripe-webhook-secret", re.compile(r"\bwhsec_[0-9A-Za-z+/=]{10,}"), _redact_whole),
    ("github-token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}"), _redact_whole),
    ("github-fine-grained-token", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}"), _redact_whole),
    ("gitlab-token", re.compile(r"\bglpat-[A-Za-z0-9_-]{20,}"), _redact_whole),
    ("npm-token", re.compile(r"\bnpm_[A-Za-z0-9]{36,}"), _redact_whole),
    ("aws-access-key-id", re.compile(r"\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[A-Z0-9]{16}\b"), _redact_whole),
    ("slack-token", re.compile(r"\bxox[abposre]-[0-9A-Za-z-]{10,}"), _redact_whole),
    ("slack-app-token", re.compile(r"\bxapp-[0-9]-[0-9A-Za-z-]{10,}"), _redact_whole),
    ("slack-webhook", re.compile(r"(?P<keep>\bhttps://hooks\.slack\.com/(?:services|workflows|triggers)/)(?P<value>[A-Za-z0-9/_-]+)"), _redact_value),
    ("google-api-key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}"), _redact_whole),
    ("google-oauth-secret", re.compile(r"\bGOCSPX-[0-9A-Za-z_-]{20,}"), _redact_whole),
    ("google-oauth-token", re.compile(r"\bya29\.[0-9A-Za-z_-]{20,}"), _redact_whole),
    # OpenAI (sk-, sk-proj-, sk-svcacct-, sk-admin-) and Anthropic (sk-ant-...).
    ("openai-anthropic-key", re.compile(r"\bsk-[A-Za-z0-9_-]{20,}"), _redact_whole),
    ("supabase-token", re.compile(r"\b(?:sbp_[0-9a-f]{40}|sb_secret_[0-9A-Za-z_-]{20,})"), _redact_whole),
    ("sendgrid-key", re.compile(r"\bSG\.[0-9A-Za-z_-]{16,}\.[0-9A-Za-z_-]{16,}"), _redact_whole),
    # Twilio: account SID (AC) and API key SID (SK), each 32 hex. An auth token
    # is 32 bare hex; it is caught by name below, or by context further down.
    ("twilio-sid", re.compile(r"\b(?:AC|SK)[0-9a-fA-F]{32}\b"), _redact_whole),
    # JSON Web Tokens (Supabase anon and service-role keys are JWTs).
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]*)?"), _redact_whole),
    # name = value, name: value, "name": "value", with a sensitive name.
    (
        "sensitive-assignment",
        re.compile(
            rf"""(?ix)
            (?P<keep>
              (?<![A-Za-z0-9_.-])
              (?:\\?["'])?{_SENSITIVE_NAME}(?:\\?["'])?
              \s*{_ASSIGN}\s*
            )
            (?P<value>{_VALUE})
            """
        ),
        _redact_value,
    ),
    # KEY=VALUE environment lines (optionally after "export").
    (
        "env-assignment",
        re.compile(rf"(?P<keep>(?<![A-Za-z0-9_])(?:export\s+)?{_ENV_NAME}\s*=(?![=>])\s*)(?P<value>{_VALUE})"),
        _redact_value,
    ),
    # KEY: VALUE (YAML, compose files). Single-word names are excluded, so
    # "KEY: ..." in prose about the KEY assistant is left alone.
    (
        "env-yaml-assignment",
        re.compile(rf"(?P<keep>(?<![A-Za-z0-9_]){_ENV_NAME_COMPOUND}:(?![:=])[ \t]*)(?P<value>{_VALUE})"),
        _redact_value,
    ),
]

# Secrets with no shape of their own, redacted only when the same message shows
# whose they are: an AWS secret access key (40 base64 characters, mixed case)
# in a message that names AWS or holds an AWS key id, and a Twilio auth token
# (32 hex) in a message that names Twilio or holds a Twilio account SID.
_CONTEXT_RULES: list[tuple[re.Pattern[str], re.Pattern[str], Any]] = [
    (
        re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|(?i:\baws\b)"),
        re.compile(r"(?<![A-Za-z0-9/+=])[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+=])"),
        lambda token: any(c.isupper() for c in token) and any(c.islower() for c in token) and any(c.isdigit() or c in "/+" for c in token),
    ),
    (
        re.compile(r"\bAC[0-9a-fA-F]{32}\b|(?i:\btwilio\b)"),
        re.compile(r"(?<![0-9A-Za-z])[0-9a-fA-F]{32}(?![0-9A-Za-z])"),
        lambda token: True,
    ),
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
    """Replace the credential shapes SECRET_RULES and _CONTEXT_RULES know with REDACTED.

    Best-effort: a secret with neither a known shape nor a sensitive name
    survives. See the note above SECRET_RULES.
    """
    out = text
    for _name, pattern, replace in SECRET_RULES:
        out = pattern.sub(replace, out)
    # The context is read from the original text, since the rules above have
    # already redacted the key id or SID that establishes it.
    for context, token, accept in _CONTEXT_RULES:
        if context.search(text):
            out = token.sub(lambda m: REDACTED if accept(m.group(0)) else m.group(0), out)
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


OUTPUT_FILES = ("threads.jsonl", "messages.jsonl", "candidates.jsonl", "coverage.json", "review-queue.md")

# Exit status when --output is a path git would offer to commit.
EXIT_UNSAFE_OUTPUT = 3


def _nearest_work_tree(path: Path) -> Path | None:
    """The nearest directory at or above path holding a .git entry (a
    repository, a linked worktree or a submodule), or None."""
    for candidate in (path, *path.parents):
        if (candidate / ".git").exists():
            return candidate
    return None


def unsafe_output_reason(output: Path) -> str | None:
    """Why writing the harvest to output could put it in a commit, or None.

    The outputs hold exported conversation text, so inside a git work tree
    every output file must be one git ignores: otherwise `git add -A` stages
    it. Outside any work tree there is nothing to check. Anything git cannot
    confirm counts as not ignored.
    """
    resolved = output.resolve()
    root = _nearest_work_tree(resolved)
    if root is None:
        return None
    git = shutil.which("git")
    if git is None:
        return f"{resolved} is inside the git work tree at {root}, and git is not on PATH to confirm it is ignored"
    for name in OUTPUT_FILES:
        rel = os.path.relpath(resolved / name, root)
        # Without --no-index, a tracked file is reported as not ignored, which
        # is right: git would commit changes to it.
        result = subprocess.run(
            [git, "-C", str(root), "check-ignore", "-q", "--", rel],
            capture_output=True,
            text=True,
        )
        if result.returncode == 1:
            return f"{resolved / name} is inside the git work tree at {root} and is not ignored by git"
        if result.returncode != 0:
            detail = (result.stderr or "").strip().splitlines()
            return (
                f"{resolved} is inside the git work tree at {root}, and git check-ignore failed"
                f" ({detail[-1] if detail else f'exit {result.returncode}'}), so it is not known to be ignored"
            )
    return None


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
    parser.add_argument(
        "--no-redact",
        action="store_true",
        help="Disable secret redaction. Redaction is on by default and best-effort: it removes known "
        "credential shapes and values with a sensitive name, not every secret, so read the outputs "
        "before sharing any of them.",
    )
    parser.add_argument(
        "--allow-unignored-output",
        action="store_true",
        help="Write even when --output is inside a git work tree and git does not ignore it. "
        "Without it the harvester refuses (exit 3), since git add would stage the conversation text.",
    )
    args = parser.parse_args()

    input_root = Path(args.input)
    output = Path(args.output)
    unsafe = unsafe_output_reason(output)
    if unsafe and not args.allow_unignored_output:
        print(
            f"refusing to write the harvest: {unsafe}, so `git add` would stage exported conversation text.\n"
            "Write it outside the work tree or under an ignored directory (the repository ignores any "
            "`.artifacts/` directory), or pass --allow-unignored-output to write it anyway.",
            file=sys.stderr,
        )
        return EXIT_UNSAFE_OUTPUT
    if unsafe:
        print(
            f"WARNING: {unsafe}. Writing anyway because of --allow-unignored-output; "
            "do not stage or commit these files.",
            file=sys.stderr,
        )
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
    if not args.no_redact:
        for thread in threads:
            thread.title = redact(thread.title)

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
