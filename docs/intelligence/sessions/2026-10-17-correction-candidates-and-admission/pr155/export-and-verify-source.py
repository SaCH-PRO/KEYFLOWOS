#!/usr/bin/env python3
"""Export the pinned review source with git archive, or verify existing bytes.

Only Python's standard library and an existing local Git repository are used.
No network request, checkout, source edit, or dependency installation occurs.
"""

import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import subprocess
import tarfile

ARTIFACT = "b30acfa7dcd4fdf96c67747ff8c4a66e4026937e"
PACKAGE = Path(__file__).resolve().parent


def blob_sha(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def verify_bytes(record, data):
    assert len(data) == record["bytes"], f"Size mismatch: {record['path']}"
    assert blob_sha(data) == record["git_blob_sha"], f"Git blob mismatch: {record['path']}"
    assert hashlib.sha256(data).hexdigest() == record["sha256"], f"SHA256 mismatch: {record['path']}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, help="Existing Git repository containing the pinned artifact")
    parser.add_argument("--destination", type=Path, default=PACKAGE / "source")
    parser.add_argument("--verify-only", action="store_true", help="Read and verify an existing export without writing")
    args = parser.parse_args()
    manifest = json.loads((PACKAGE / "source-manifest.json").read_text())
    assert manifest["source_head"] == ARTIFACT, "Unexpected artifact in the source manifest"
    records = manifest["files"]
    assert len(records) == 18, "Expected the complete 18-file control-contract export"
    paths = [record["path"] for record in records]
    assert len(set(paths)) == len(paths), "Duplicate manifest paths"
    for name in paths:
        parsed = PurePosixPath(name)
        assert not parsed.is_absolute() and ".." not in parsed.parts, f"Unsafe path: {name}"
    destination = args.destination.resolve()

    if args.verify_only:
        for record in records:
            verify_bytes(record, (destination / record["path"]).read_bytes())
        print(json.dumps({"artifact": ARTIFACT, "mode": "verify-only", "verified_files": len(records), "destination": str(destination)}))
        return

    if args.repo is None:
        parser.error("--repo is required for export; use --verify-only to check existing source")
    if destination.exists() and (not destination.is_dir() or any(destination.iterdir())):
        parser.error("Export destination must be absent or empty; existing source is never overwritten")

    # Every selected path comes from the pinned manifest. Git archive reads the
    # commit object without changing the repository's branch or working tree.
    command = ["git", "-C", str(args.repo.resolve()), "archive", "--format=tar", ARTIFACT, "--", *paths]
    completed = subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    payloads = {}
    with tarfile.open(fileobj=io.BytesIO(completed.stdout), mode="r:") as archive:
        for member in archive.getmembers():
            if member.isdir():
                continue
            assert member.isfile() and member.name in paths, f"Unexpected archive member: {member.name}"
            assert member.name not in payloads, f"Duplicate archive member: {member.name}"
            reader = archive.extractfile(member)
            assert reader is not None
            payloads[member.name] = reader.read()
    assert set(payloads) == set(paths), "Archive did not contain the complete manifest"
    # Validate the entire export before creating any destination files.
    for record in records:
        verify_bytes(record, payloads[record["path"]])
    for record in records:
        target = destination / record["path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payloads[record["path"]])
    print(json.dumps({"artifact": ARTIFACT, "mode": "git-archive-export", "verified_files": len(records), "destination": str(destination)}))


if __name__ == "__main__":
    main()
