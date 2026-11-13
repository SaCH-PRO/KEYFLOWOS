/* Actual-service synthetic proof. No server, database, provider, or network.
 * Usage: node run-flow-safety-proof.cjs [output-directory]
 * Read source-manifest.json for pinned Git blob and SHA-256 identities.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ROOT = __dirname;
const OUTPUT = path.resolve(process.argv[2] || path.join(ROOT, 'results'));
const ts = require('./proof-deps/node_modules/typescript');
const nest = require('./proof-deps/node_modules/@nestjs/common');
const SOURCE_MAIN = '98ee0202499ba87fa4ee13d58a2a9075016225bd';
const SERVICE = 'apps/server/src/modules/ai/ai-oversight.service.ts';
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'source-manifest.json')));
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const gitBlob = bytes => crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const declared = new Map(MANIFEST.verified.filter(x => x.ref === SOURCE_MAIN).map(x => [x.path, x]));
const loadedSources = {};
let networkAttempts = 0;
const rejectNetwork = () => { networkAttempts++; throw new Error('External network is forbidden in this proof'); };
global.fetch = rejectNetwork;
for (const [module, methods] of [
  ['node:http', ['request', 'get']], ['node:https', ['request', 'get']],
  ['node:net', ['connect', 'createConnection']], ['node:tls', ['connect']],
  ['node:dgram', ['createSocket']],
]) for (const method of methods) require(module)[method] = rejectNetwork;
require('node:net').Socket.prototype.connect = rejectNetwork;

function checkedSource(file) {
  const bytes = fs.readFileSync(path.join(ROOT, 'source', file));
  const expected = declared.get(file);
  assert(expected, `Undeclared source: ${file}`);
  assert.equal(bytes.length, expected.size, file);
  assert.equal(gitBlob(bytes), expected.sha, file);
  assert.equal(digest(bytes), expected.sha256, file);
  loadedSources[file] = { git_blob: expected.sha, sha256: expected.sha256, bytes: bytes.length };
  return bytes.toString('utf8');
}

class InjectionToken {}
const tokens = {
  '../../core/prisma/prisma.service': { PrismaService: InjectionToken },
  './ai-execution-log.service': { AiExecutionLogService: InjectionToken },
  './ai-memory.service': { AiMemoryService: InjectionToken },
  './approval-routing.service': { ApprovalRoutingService: InjectionToken },
  '@nestjs/event-emitter': { EventEmitter2: InjectionToken },
};
const acceptedImports = new Set([
  './flow-tool-registry', './role-engine.service', '../structure/job-role-policy.service',
  '../../core/authority/approval-tier', './module-vocabulary',
]);
function loadVariant(serviceText) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const text = file === SERVICE ? serviceText : checkedSource(file);
    const compiled = ts.transpileModule(text, {
      fileName: file,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
        experimentalDecorators: true, emitDecoratorMetadata: false },
      reportDiagnostics: true,
    });
    const errors = (compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
    assert.equal(errors.length, 0, JSON.stringify(errors));
    const module = { exports: {} };
    const context = vm.createContext({ module, exports: module.exports, require: name => {
      if (name === '@nestjs/common') return nest;
      if (tokens[name]) return tokens[name];
      assert(acceptedImports.has(name), `Unexpected import: ${file} -> ${name}`);
      return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), name + '.ts')));
    }});
    new vm.Script(compiled.outputText, { filename: file }).runInContext(context);
    cache.set(file, module.exports);
    return module.exports;
  }
  const { AiOversightService } = load(SERVICE);
  const { RoleEngineService } = load('apps/server/src/modules/ai/role-engine.service.ts');
  const { JobRolePolicyService } = load('apps/server/src/modules/structure/job-role-policy.service.ts');
  const denyDependency = new Proxy({}, { get(_, name) { throw new Error(`Unexpected collaborator: ${String(name)}`); } });
  return function fixture(opts = {}) {
    const trace = [];
    const writes = [];
    const audits = [];
    const logs = [];
    const fail = name => new Error(`Synthetic ${name} policy read failure`);
    const record = (name, args) => trace.push({ operation: name, args: JSON.parse(JSON.stringify(args)) });
    const client = {
      autopilotSettings: { findUnique: async args => {
        record('typed.read', args); assert.equal(args.where.businessId, 'synthetic-business');
        if (opts.typedError) throw fail('typed');
        return opts.typed ?? null;
      } },
      aiMemory: {
        findUnique: async args => {
          record('legacy.read', args);
          assert.equal(args.where.businessId_category_key.businessId, 'synthetic-business');
          if (opts.legacyError) throw fail('legacy');
          return opts.legacy === undefined || opts.legacy === null ? null : { value: opts.legacy };
        },
        upsert: async args => { record('legacy.upsert', args); writes.push(args); return {}; },
      },
      user: { findUnique: async args => {
        record('user.read', args); assert.equal(args.where.id, 'synthetic-user');
        return { id: 'synthetic-user', role: opts.superAdmin ? 'SUPER_ADMIN' : 'USER' };
      } },
      membership: { findFirst: async args => {
        record('membership.read', args);
        assert.equal(args.where.userId, 'synthetic-user'); assert.equal(args.where.businessId, 'synthetic-business');
        return { role: opts.membership ?? 'OWNER' };
      } },
      teamActivityLog: { create: async args => { record('audit.create', args); audits.push(args); return {}; } },
    };
    const roles = new RoleEngineService(denyDependency, denyDependency, denyDependency);
    const service = new AiOversightService({ client }, denyDependency, denyDependency, roles,
      denyDependency, new JobRolePolicyService());
    service.logger = { error: x => logs.push(String(x)), warn: x => logs.push(String(x)) };
    return { service, client, trace, writes, audits, logs };
  };
}

const typedPolicy = (autonomyLevel, blockedTools = []) => ({ autonomyLevel, blockedTools,
  approvedTools: [], approvalTimeoutHours: 36 });
const permissive = JSON.stringify({ mode: 'pro_auto', maxAutoTier: 3, autonomyLevel: 4,
  blockedTools: [], blockedModules: [], approvedTools: [], degraded: false });
const configuredLegacy = JSON.stringify({ mode: 'advisory', maxAutoTier: 1, blockedTools: ['x'],
  blockedModules: ['finance'], approvedTools: [], approvalTimeoutHours: 24 });

async function run(name, source) {
  const fixture = loadVariant(source);
  const cases = [];
  async function proof(id, title, body) {
    const item = { id, title, passed: false };
    try { await body(item); item.passed = true; }
    catch (error) { item.failure = { name: error.name, message: error.message,
      actual: error.actual, expected: error.expected }; }
    cases.push(item);
  }
  const policyCases = [
    ['P1', 'typed advisory policy takes precedence over permissive legacy', { typed: typedPolicy(0), legacy: permissive }, 'advisory', false, false],
    ['P2', 'typed read failure cannot promote permissive legacy, including a false degraded field', { typedError: true, legacy: permissive }, 'restricted', true, false],
    ['P3', 'both reads failing remain restricted', { typedError: true, legacyError: true }, 'restricted', true, false],
    ['P4', 'confirmed typed absence keeps valid legacy support', { legacy: permissive }, 'pro_auto', false, true],
    ['P5', 'failed typed read with malformed legacy remains restricted', { typedError: true, legacy: '{broken' }, 'restricted', true, false],
    ['P6', 'two confirmed absences keep normal defaults', {}, 'assisted', false, true],
    ['P7', 'confirmed typed absence with malformed legacy is degraded', { legacy: '{broken' }, 'restricted', true, false],
    ['P8', 'confirmed typed absence with a legacy read error is degraded', { legacyError: true }, 'restricted', true, false],
    ['P9', 'typed blocklist remains effective over permissive legacy', { typed: typedPolicy(4, ['crm_create_contact']), legacy: permissive }, 'pro_auto', false, false],
  ];
  for (const [id, title, opts, mode, degraded, allowed] of policyCases) await proof(id, title, async item => {
    const f = fixture(opts);
    const settings = await f.service.getAutonomySettings('synthetic-business');
    const verdict = await f.service.evaluate('synthetic-business', 'crm_create_contact', undefined, ['operator']);
    item.observed = { settings: JSON.parse(JSON.stringify(settings)), verdict, trace: f.trace, writes: f.writes.length, audits: f.audits.length };
    assert.equal(settings.mode, mode, title);
    assert.equal(Boolean(settings.degraded), degraded, title);
    assert.equal(verdict.allowed, allowed, title);
    assert.equal(f.writes.length, 0); assert.equal(f.audits.length, 0);
    if (opts.typed) assert.equal(f.trace.filter(x => x.operation === 'legacy.read').length, 0, 'typed policy must win without consulting legacy');
  });
  await proof('W1', 'admin update after typed read failure makes zero policy and audit writes', async item => {
    const f = fixture({ typedError: true, legacy: permissive });
    let outcome; let error;
    try { outcome = await f.service.updateAutonomySettings('synthetic-business', { approvalTimeoutHours: 12 }, 'synthetic-user'); }
    catch (e) { error = e; }
    item.observed = { outcome: outcome ?? null, error: error ? { name: error.name, status: error.getStatus?.(), message: error.message } : null,
      writes: f.writes.length, audits: f.audits.length, trace: f.trace };
    assert.equal(f.writes.length, 0, 'failed authoritative read must not reach AiMemory.upsert');
    assert.equal(f.audits.length, 0, 'a refused update must not produce a success audit');
    assert(error instanceof nest.ServiceUnavailableException, 'the protected write must refuse with ServiceUnavailableException');
  });
  await proof('W2', 'owner update after successful legacy read preserves policy and writes one audit', async item => {
    const f = fixture({ legacy: configuredLegacy });
    const saved = await f.service.updateAutonomySettings('synthetic-business', { approvalTimeoutHours: 12 }, 'synthetic-user');
    const payload = JSON.parse(f.writes[0]?.create?.value ?? '{}');
    item.observed = { saved, payload, writes: f.writes.length, audits: f.audits.length, trace: f.trace };
    assert.equal(f.writes.length, 1); assert.equal(f.audits.length, 1);
    assert.deepEqual(payload.blockedTools, ['x']); assert.deepEqual(payload.blockedModules, ['finance']);
    assert.equal(payload.mode, 'advisory'); assert.equal(payload.approvalTimeoutHours, 12);
    assert.equal(payload.degraded, undefined); assert.equal(f.audits[0].data.userId, 'synthetic-user');
    assert.equal(f.audits[0].data.businessId, 'synthetic-business');
  });
  await proof('W3', 'non-admin refusal occurs before policy reads and writes', async item => {
    const f = fixture({ legacy: permissive, membership: 'MEMBER' });
    let error;
    try { await f.service.updateAutonomySettings('synthetic-business', { approvalTimeoutHours: 12 }, 'synthetic-user'); }
    catch (e) { error = e; }
    item.observed = { error: error ? { name: error.name, status: error.getStatus?.() } : null, writes: f.writes.length, audits: f.audits.length, trace: f.trace };
    assert(error instanceof nest.ForbiddenException);
    assert.deepEqual(f.trace.map(x => x.operation), ['user.read', 'membership.read']);
    assert.equal(f.writes.length, 0); assert.equal(f.audits.length, 0);
  });
  await proof('R1', 'explicit transaction reader cannot promote legacy after typed read failure', async item => {
    const outer = fixture({ typed: typedPolicy(4), legacy: permissive });
    const reader = fixture({ typedError: true, legacy: permissive });
    const verdict = await outer.service.evaluate('synthetic-business', 'crm_create_contact', undefined, ['operator'], undefined, reader.client);
    item.observed = { verdict, transactionTrace: reader.trace, sharedClientTrace: outer.trace };
    assert.equal(verdict.allowed, false);
    assert.equal(outer.trace.length, 0, 'an explicit transaction reader must not fall back to the shared client');
  });
  return { variant: name, service_sha256: digest(source), total: cases.length,
    passed: cases.filter(x => x.passed).length, failed: cases.filter(x => !x.passed).map(x => x.id), cases };
}

async function main() {
  const original = checkedSource(SERVICE);
  const candidate = fs.readFileSync(path.join(ROOT, 'candidate', SERVICE), 'utf8');
  const guard = 'if (!readFailed && memory?.value) {';
  assert.equal(candidate.split(guard).length - 1, 1, 'the narrow candidate must contain exactly one legacy authority guard');
  const mutant = candidate.replace(guard, 'if (memory?.value) {');
  const results = [];
  results.push(await run('unchanged_main', original));
  results.push(await run('candidate', candidate));
  results.push(await run('mutant_restore_unsafe_legacy_return', mutant));
  const expectedFailureIds = ['P2', 'W1', 'R1'];
  assert.deepEqual(results[0].failed, expectedFailureIds, 'unchanged source must expose the three unsafe counterexamples');
  assert.deepEqual(results[1].failed, [], 'candidate must satisfy every unchanged proof obligation');
  assert.deepEqual(results[2].failed, expectedFailureIds, 'restoring the unsafe return must break the same safety obligations');
  assert.equal(networkAttempts, 0);
  const report = {
    disposition: 'LOCAL_CANDIDATE_PROVED_NOT_RELEASED_OR_INTEGRATED', source_main: SOURCE_MAIN,
    runtime: process.version, typescript: ts.version,
    nestjs_common: require('./proof-deps/node_modules/@nestjs/common/package.json').version,
    observed_at: new Date().toISOString(), variants: results, source_identity: loadedSources,
    external_network_attempts: networkAttempts, real_database_or_provider_calls: 0,
    limits: [
      'Full unchanged AiOversightService and its policy helpers execute with real Nest exception classes; dependency tokens and all persistence/admin/audit responses are synthetic.',
      'Governance checks omit the optional caller mode override, matching this selective authoritative-read correction. Caller authority and supervised policy tightening remain separate work.',
      'The protected-write counterexample writes only the synthetic AiMemory and audit doubles. It does not demonstrate alteration of an AutopilotSettings row or production data.',
      'TypeScript transpilation is not a whole-project typecheck. No server boot, HTTP route, real database, provider, concurrency, hosted Node20 CI, merge, deployment, or application checkpoint is claimed.',
      'Baseline and mutant safety failures are intentional counterexamples; successful characterization is not a passing security verdict for main.',
    ],
  };
  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT, 'flow-safety-proof.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ source_main: SOURCE_MAIN, runtime: process.version,
    variants: results.map(({ variant, total, passed, failed }) => ({ variant, total, passed, failed })),
    external_network_attempts: networkAttempts, real_database_or_provider_calls: 0 }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
