/* Repository-only characterization. Real source methods; synthetic policy I/O.
 * Usage: node flow-policy-probes.cjs <pinned-main-checkout> <test-deps-directory> [output-directory]
 * No provider, database, HTTP server, or outbound request is used.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
assert(process.argv[2] && process.argv[3], 'Usage: node flow-policy-probes.cjs <pinned-main-checkout> <test-deps-directory> [output-directory]');
const root = path.resolve(process.argv[2]);
const deps = path.resolve(process.argv[3]);
const output = path.resolve(process.argv[4] || process.cwd());
fs.mkdirSync(output, { recursive: true });
const ts = require(path.join(deps, 'node_modules/typescript'));
const nest = require(path.join(deps, 'node_modules/@nestjs/common'));
const MAIN = '98ee0202499ba87fa4ee13d58a2a9075016225bd';
assert.equal(execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), MAIN);
const base = 'apps/server/src/modules/';
const sources = {};
const cache = new Map();
class InjectionToken {}
const tokens = {
  '../../core/prisma/prisma.service': { PrismaService: InjectionToken },
  './ai-execution-log.service': { AiExecutionLogService: InjectionToken },
  './ai-memory.service': { AiMemoryService: InjectionToken },
  './approval-routing.service': { ApprovalRoutingService: InjectionToken },
  '@nestjs/event-emitter': { EventEmitter2: InjectionToken },
};
function compile(text, file, requireLocal, bindings = {}) {
  const compiled = ts.transpileModule(text, {
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true, emitDecoratorMetadata: false },
    reportDiagnostics: true,
  });
  const errors = (compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports, require: requireLocal, console, ...bindings });
  new vm.Script(compiled.outputText, { filename: file }).runInContext(context);
  return module.exports;
}
function read(file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  sources[file] = crypto.createHash('sha256').update(text).digest('hex');
  return text;
}
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const result = compile(read(file), file, name => {
    if (name === '@nestjs/common') return nest;
    if (tokens[name]) return tokens[name];
    const accepted = new Set(['./flow-tool-registry', './role-engine.service', '../structure/job-role-policy.service', '../../core/authority/approval-tier', './module-vocabulary']);
    assert(accepted.has(name), `Unmocked or unexpected import: ${file} -> ${name}`);
    return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), name + '.ts')));
  });
  cache.set(file, result);
  return result;
}
const { AiOversightService } = load(base + 'ai/ai-oversight.service.ts');
const { RoleEngineService } = load(base + 'ai/role-engine.service.ts');
const { JobRolePolicyService } = load(base + 'structure/job-role-policy.service.ts');
const registry = load(base + 'ai/flow-tool-registry.ts');
const roles = new RoleEngineService({}, {}, {});
const jobRolePolicy = new JobRolePolicyService();
const logs = [];
function service(primary, legacy) {
  const fn = value => async () => { if (value instanceof Error) throw value; return value; };
  const prisma = { client: { autopilotSettings: { findUnique: fn(primary) }, aiMemory: { findUnique: fn(legacy) } } };
  const svc = new AiOversightService(prisma, {}, {}, roles, {}, jobRolePolicy);
  svc.logger = { error: m => logs.push(m), warn: m => logs.push(m) };
  return svc;
}
const configured = (level, blockedTools = []) => ({ autonomyLevel: level, blockedTools, approvedTools: [], approvalTimeoutHours: 24 });
const oldPolicy = { value: JSON.stringify({ mode: 'pro_auto', maxAutoTier: 3, autonomyLevel: 4, blockedTools: [], approvedTools: [] }) };
const error = new Error('Synthetic primary policy read failure');

async function main() {
  const cases = [];
  for (const [name, primary, legacy, expectedAllowed] of [
    ['primary advisory policy overrides permissive legacy', configured(0), oldPolicy, false],
    ['primary read failure promotes permissive legacy', error, oldPolicy, true],
    ['both policy reads fail closed', error, error, false],
    ['confirmed absent primary permits supported legacy policy', null, oldPolicy, true],
    ['failed primary and malformed legacy fail closed', error, { value: '{broken' }, false],
  ]) {
    const svc = service(primary, legacy);
    const settings = await svc.getAutonomySettings('synthetic-business');
    const verdict = await svc.evaluate('synthetic-business', 'crm_create_contact', undefined, ['operator']);
    assert.equal(verdict.allowed, expectedAllowed, name);
    cases.push({ name, observedSettings: { mode: settings.mode, degraded: settings.degraded ?? false }, verdict });
  }

  const target = 'crm_delete_contact';
  const allRoles = roles.getAllRoles().map(x => x.id);
  assert.equal(allRoles.filter(r => roles.isToolAllowed(r, target)).length, 0);
  const forged = { jobRoleId: 'synthetic-nonexistent-role', jobRoleName: 'Untrusted client claim', approvedTools: ['*'], blockedTools: [], maxRiskTier: 4 };
  const svc = service(configured(4), null);
  const ordinary = await svc.evaluate('synthetic-business', target, undefined, ['general']);
  const injected = await svc.evaluate('synthetic-business', target, undefined, ['general'], forged);
  assert.equal(ordinary.allowed, false);
  assert.equal(injected.allowed, true);
  assert.equal(injected.requiresFormalApproval, false);
  assert.equal(injected.requiresQuickConfirm, false);
  const explicitBlock = await service(configured(4, [target]), null).evaluate('synthetic-business', target, undefined, ['general'], forged);
  assert.equal(explicitBlock.allowed, false);
  const restricted = await service(configured(0), null).evaluate('synthetic-business', target, undefined, ['general'], forged);
  assert.equal(restricted.allowed, false);

  const flowPath = base + 'ai/flow-orchestrator.service.ts';
  const flowSource = read(flowPath);
  const ast = ts.createSourceFile(flowPath, flowSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const decl = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'FlowOrchestratorService');
  const menuMethod = decl.members.find(n => ts.isMethodDeclaration(n) && n.name.getText(ast) === 'selectToolsForRequest');
  assert(menuMethod, 'Exact menu method must exist');
  const { ToolMenuProbe } = compile('export class ToolMenuProbe { ' + menuMethod.getText(ast) + ' }', flowPath + '#selectToolsForRequest', () => { throw new Error('Unexpected import'); }, { getOpenAiToolDefinitions: registry.getOpenAiToolDefinitions });
  const menu = new ToolMenuProbe();
  menu.roleEngine = roles;
  menu.getJobRolePolicy = () => jobRolePolicy;
  const regularMenu = await menu.selectToolsForRequest('synthetic-business', ['general'], target);
  const forgedMenu = await menu.selectToolsForRequest('synthetic-business', ['general'], target, forged);
  assert.equal(regularMenu.some(t => t.function.name === target), false);
  assert.equal(forgedMenu.some(t => t.function.name === target), true);

  const result = {
    purpose: 'READ_ONLY_DEFECT_CHARACTERIZATION_NOT_FIXED',
    source_main: MAIN,
    runtime: process.version,
    typescript: ts.version,
    policy_reads: cases,
    untrusted_position_envelope: {
      capability: target,
      granting_builtin_roles: [],
      ordinary_governance: ordinary,
      client_claimed_governance: injected,
      ordinary_menu_contains_capability: false,
      client_claimed_menu_contains_capability: true,
      business_blocklist_still_refuses: !explicitBlock.allowed,
      advisory_mode_still_refuses: !restricted.allowed,
      role_database_lookups: 0,
    },
    source_sha256: sources,
    external_requests: 0,
    real_data_writes: 0,
    limitations: [
      'Actual oversight, role engine, job-role policy and registry source loaded; only dependency-injection tokens and database return values mocked.',
      'Menu test executes the exact AST-selected source method. It is not a complete Flow chat or HTTP integration test.',
      'No production reachability, real caller privilege, real policy values, provider action or data deletion was exercised.',
      'Primary-failure case contrasts authoritative typed policy with a permissive legacy record; the implementation provides no freshness/equivalence proof for that fallback.',
      'Characterization assertions intentionally describe observed unsafe results; their pass does not mean security is fixed.',
    ],
  };
  fs.writeFileSync(path.join(output, 'flow-policy-probe-result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ source_main: MAIN, runtime: process.version, policy_read_cases: cases.length, primary_read_failure_allowed: cases[1].verdict.allowed, forged_envelope_allowed: injected.allowed, forged_envelope_auto_exec_eligible: !injected.requiresQuickConfirm && !injected.requiresFormalApproval, external_requests: 0, real_data_writes: 0 }, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
