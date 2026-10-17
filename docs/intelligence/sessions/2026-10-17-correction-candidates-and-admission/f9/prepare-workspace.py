#!/usr/bin/env python3
"""Reconstruct the pinned baseline and exact three-file candidate without network access."""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile

PACKAGE = Path(__file__).resolve().parent
PIN = "ff49859e70cee65e31c09277b05aca4144ff77ea"

def require(ok, reason):
    if not ok:
        raise ValueError(reason)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def git_blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()

def verify(record, data):
    require(len(data) == record["size"], "size mismatch: " + record["path"])
    require(git_blob(data) == record["sha"], "Git blob mismatch: " + record["path"])
    require(digest(data) == record["sha256"], "SHA256 mismatch: " + record["path"])

def patch_candidate(payloads, patch, expected):
    """Apply this standard unified diff with exact context and no fuzzy matching."""
    output = dict(payloads)
    lines = patch.splitlines(keepends=True)
    changed = []
    index = 0
    while index < len(lines):
        require(lines[index].startswith("--- a/"), "unexpected patch header")
        name = lines[index][6:].rstrip("\n")
        index += 1
        require(lines[index] == "+++ b/" + name + "\n", "patch path mismatch")
        require(name in expected and name not in changed, "unexpected or duplicate patch file")
        index += 1
        source = payloads[name].decode("utf8").splitlines(keepends=True)
        result, cursor = [], 0
        while index < len(lines) and not lines[index].startswith("--- a/"):
            match = re.match(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", lines[index])
            require(match is not None, "invalid hunk header")
            old_start, old_count, new_start, new_count = [
                int(v) if v is not None else 1 for v in match.groups()
            ]
            old_index = old_start - 1 if old_start else 0
            require(cursor <= old_index <= len(source), "overlapping/out-of-range hunk")
            result.extend(source[cursor:old_index])
            cursor = old_index
            require(len(result) == (new_start - 1 if new_start else 0), "new hunk offset mismatch")
            index += 1
            old_seen = new_seen = 0
            while index < len(lines) and not lines[index].startswith(("@@ ", "--- a/")):
                row = lines[index]
                require(row and row[0] in " +-", "unsupported patch line")
                marker, body = row[0], row[1:]
                if marker in " -":
                    require(cursor < len(source) and source[cursor] == body, "patch context mismatch: " + name)
                    cursor += 1
                    old_seen += 1
                if marker in " +":
                    result.append(body)
                    new_seen += 1
                index += 1
            require((old_seen, new_seen) == (old_count, new_count), "hunk length mismatch")
        result.extend(source[cursor:])
        output[name] = "".join(result).encode("utf8")
        changed.append(name)
    require(set(changed) == set(expected), "patch must change exactly the three reviewed files")
    for name, record in expected.items():
        require(git_blob(output[name]) == record["after_git_blob"], "candidate Git blob mismatch: " + name)
        require(digest(output[name]) == record["after_sha256"], "candidate SHA256 mismatch: " + name)
    return output

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    origin = parser.add_mutually_exclusive_group(required=True)
    origin.add_argument("--git-repo", type=Path, help="Existing Git repository containing the pinned commit")
    origin.add_argument("--verified-source", type=Path, help="Existing source directory; every selected byte is reverified")
    parser.add_argument("--work-dir", type=Path, required=True, help="New directory outside this publication package")
    args = parser.parse_args()
    work = args.work_dir.resolve()
    require(not work.exists(), "work directory must not exist")
    require(not work.is_relative_to(PACKAGE), "work directory must be outside the publication package")
    manifest = json.loads((PACKAGE / "source-manifest.json").read_text())
    historical = json.loads((PACKAGE / "proof-summary.json").read_text())
    require(manifest["artifact"] == PIN == historical["artifact"], "wrong pinned artifact")
    records = manifest["files"]
    require(len(records) == 39, "expected all 39 source identities")
    names = [record["path"] for record in records]
    require(len(set(names)) == len(names), "duplicate source path")
    for name in names:
        p = PurePosixPath(name)
        require(not p.is_absolute() and ".." not in p.parts and "\\" not in name, "unsafe source path")
    payloads = {}
    if args.verified_source is not None:
        source = args.verified_source.resolve()
        for name in names:
            file = (source / name).resolve()
            require(file.is_relative_to(source), "source path leaves verified directory")
            payloads[name] = file.read_bytes()
        method = "verified-existing-source"
    else:
        command = ["git", "-C", str(args.git_repo.resolve()), "archive", "--format=tar", PIN, "--", *names]
        result = subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        with tarfile.open(fileobj=io.BytesIO(result.stdout), mode="r:") as archive:
            for member in archive.getmembers():
                if member.isdir():
                    continue
                require(member.isfile() and member.name in names and member.name not in payloads,
                        "unexpected/duplicate Git archive member")
                stream = archive.extractfile(member)
                require(stream is not None, "unreadable archive member")
                payloads[member.name] = stream.read()
        method = "pinned-git-archive"
    require(set(payloads) == set(names), "incomplete source export")
    for record in records:
        verify(record, payloads[record["path"]])
    expected = {record["path"]: record for record in historical["changed_files"]}
    require(len(expected) == 3, "expected three candidate identities")
    patch_bytes = (PACKAGE / "correction.patch").read_bytes()
    candidate = patch_candidate(payloads, patch_bytes.decode("utf8"), expected)
    for kind, contents in (("baseline", payloads), ("candidate", candidate)):
        for name, data in contents.items():
            destination = work / kind / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
    receipt = {
        "artifact": PIN, "method": method, "source_files_verified": len(records),
        "candidate_files_changed": list(expected), "candidate_hashes_match_review": True,
        "patch_sha256": digest(patch_bytes), "network_requests": 0,
        "source_repository_mutations": [], "dependency_installs": [],
    }
    (work / "reconstruction.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt))

if __name__ == "__main__":
    main()
