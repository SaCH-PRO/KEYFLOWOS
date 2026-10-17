"""Recreate the verified source and two-file candidate from an existing checkout.

No fetch, installation, checkout, provider, or database operation is performed.
Run from a fresh copy of this evidence directory; source/ and candidate/ must not
already exist. The checkout's seven required files must match the pinned manifest.
"""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkout', type=Path)
args = parser.parse_args()
manifest = json.loads((ROOT / 'source-manifest.json').read_text())
candidate = json.loads((ROOT / 'candidate-manifest.json').read_text())
assert manifest['main'] == candidate['base_main'] == '98ee0202499ba87fa4ee13d58a2a9075016225bd'
base = args.checkout.resolve()
source = ROOT / 'source'
out = ROOT / 'candidate'
assert not source.exists() and not out.exists(), 'Use a fresh evidence copy: source/ and candidate/ must be absent'
pending = {}
for record in manifest['verified']:
    name = record['path']
    relative = Path(name)
    assert not relative.is_absolute() and '..' not in relative.parts
    actual = (base / relative).resolve()
    assert actual.is_relative_to(base), 'Source path escapes the supplied checkout'
    assert actual.is_file() and not (base / relative).is_symlink(), name
    data = actual.read_bytes()
    assert len(data) == record['size'], name
    assert hashlib.sha256(data).hexdigest() == record['sha256'], name
    assert hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest() == record['sha'], name
    assert name not in pending, name
    pending[name] = data

changed = {x['path']: x for x in candidate['changed_files']}
assert set(changed) == {
    'apps/server/src/modules/ai/ai-oversight.service.ts',
    'apps/server/src/modules/ai/ai-oversight-fails-closed.spec.ts',
}
patch = ROOT / 'flow-policy-candidate.patch'
paths = subprocess.run(['git', 'apply', '--numstat', str(patch)], capture_output=True, text=True, check=True)
assert {line.split('\t', 2)[2] for line in paths.stdout.splitlines()} == set(changed)
for name, data in pending.items():
    dest = source / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
for name, record in changed.items():
    data = pending[name]
    assert hashlib.sha256(data).hexdigest() == record['base_sha256']
    dest = out / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
subprocess.run(['git', 'apply', '--check', str(patch)], cwd=out, capture_output=True, text=True, check=True)
subprocess.run(['git', 'apply', str(patch)], cwd=out, capture_output=True, text=True, check=True)
for name, record in changed.items():
    data = (out / name).read_bytes()
    assert hashlib.sha256(data).hexdigest() == record['candidate_sha256'], name
    assert hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest() == record['candidate_git_blob'], name
print(json.dumps({'verified_source_files': len(pending), 'recreated_candidate_files': len(changed)}))
