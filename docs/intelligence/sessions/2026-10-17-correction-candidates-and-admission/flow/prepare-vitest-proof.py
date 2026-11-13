"""Build isolated Vitest substrates, retaining real source and explicit token stubs.

This does not change candidate files or repository dependencies. Test scopes are
deliberately limited to the existing fail-closed specification.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SERVICE = 'apps/server/src/modules/ai/ai-oversight.service.ts'
SPEC = 'apps/server/src/modules/ai/ai-oversight-fails-closed.spec.ts'
SUPPORT = [
    'apps/server/src/modules/ai/flow-tool-registry.ts',
    'apps/server/src/modules/ai/role-engine.service.ts',
    'apps/server/src/modules/structure/job-role-policy.service.ts',
    'apps/server/src/core/authority/approval-tier.ts',
    'apps/server/src/core/authority/module-vocabulary.ts',
]
manifest = json.loads((ROOT / 'source-manifest.json').read_text())
expected = {x['path']: x for x in manifest['verified'] if x['ref'] == manifest['main']}
for filename in [SERVICE, SPEC, *SUPPORT]:
    data = (ROOT / 'source' / filename).read_bytes()
    record = expected[filename]
    assert len(data) == record['size']
    assert hashlib.sha256(data).hexdigest() == record['sha256']
    assert hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest() == record['sha']

work = ROOT / 'vitest-work'
work.mkdir(exist_ok=True)
(work / 'event-emitter.stub.ts').write_text('export class EventEmitter2 {}\n')
(work / 'forbid-network.mjs').write_text('''import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
const refuse = () => { throw new Error('Network forbidden in synthetic Flow regression proof'); };
globalThis.fetch = refuse;
http.request = http.get = https.request = https.get = refuse;
net.connect = net.createConnection = net.Socket.prototype.connect = tls.connect = refuse;
dgram.createSocket = refuse;
''')
stub_tokens = {
    'apps/server/src/core/prisma/prisma.service.ts': 'PrismaService',
    'apps/server/src/modules/ai/ai-execution-log.service.ts': 'AiExecutionLogService',
    'apps/server/src/modules/ai/ai-memory.service.ts': 'AiMemoryService',
    'apps/server/src/modules/ai/approval-routing.service.ts': 'ApprovalRoutingService',
}
index = []
for variant in ['original_spec', 'baseline', 'candidate', 'mutant']:
    target = work / variant
    target.mkdir(exist_ok=True)
    # Explicit compiler settings only for this isolated proof; original source
    # decorators and method bodies are not transformed or edited by this script.
    (target / 'tsconfig.json').write_text(json.dumps({'compilerOptions': {
        'target': 'ES2022', 'module': 'ESNext', 'experimentalDecorators': True,
        'emitDecoratorMetadata': False,
    }}, indent=2) + '\n')
    node_modules = target / 'node_modules'
    if not node_modules.exists():
        node_modules.symlink_to(ROOT / 'proof-deps' / 'node_modules', target_is_directory=True)
    for filename in [SERVICE, SPEC, *SUPPORT]:
        src = ROOT / 'source' / filename
        if filename == SPEC and variant != 'original_spec':
            src = ROOT / 'candidate' / filename
        if filename == SERVICE and variant in ['candidate', 'mutant']:
            src = ROOT / 'candidate' / filename
        data = src.read_bytes()
        if filename == SERVICE and variant == 'mutant':
            guard = b'if (!readFailed && memory?.value) {'
            assert data.count(guard) == 1
            data = data.replace(guard, b'if (memory?.value) {')
        dest = target / filename
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        index.append({'variant': variant, 'path': filename, 'sha256': hashlib.sha256(data).hexdigest()})
    for filename, symbol in stub_tokens.items():
        dest = target / filename
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text('export class ' + symbol + ' {}\n')
(work / 'source-copies.json').write_text(json.dumps(index, indent=2) + '\n')
print(json.dumps({'variants': 4, 'verified_source_files': 7, 'source_copies': len(index)}))
