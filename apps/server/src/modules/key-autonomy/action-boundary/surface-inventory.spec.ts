import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Surface inventory (KF-EXEC-ACTION-001, proof P7).
 *
 * The behavioural proof that no surface creates a ticket around the boundary
 * runs against the real database (test/key-action-boundary-surfaces
 * .integration.test.ts). This file is the structural half: it reads the source
 * and fails if a second writer of SupportTicket appears, if the tool handler
 * does anything but hand the call to the boundary, or if a surface stops
 * declaring itself.
 *
 * It reads the files rather than importing them because the property is about
 * what the code says, including code no test happens to execute.
 */

const SRC = resolve(__dirname, '../../..');
const rel = (p: string) => relative(SRC, p).replace(/\\/g, '/');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const FILES = sourceFiles(SRC).map((path) => ({ path: rel(path), text: readFileSync(path, 'utf8').replace(/\r\n/g, '\n') }));
const file = (path: string) => {
  const found = FILES.find((f) => f.path === path);
  if (!found) throw new Error(`surface inventory: ${path} not found under src/`);
  return found.text;
};
const filesMatching = (pattern: RegExp) => FILES.filter((f) => pattern.test(f.text)).map((f) => f.path).sort();

const ORCHESTRATOR = 'modules/ai/flow-orchestrator.service.ts';
const BOUNDARY = 'modules/key-autonomy/action-boundary/key-action-boundary.service.ts';
const HELPDESK = 'modules/helpdesk/helpdesk.service.ts';
const HELPDESK_CONTROLLER = 'modules/helpdesk/helpdesk.controller.ts';

describe('surface inventory: who can write a SupportTicket', () => {
  it('reads a real tree', () => {
    expect(FILES.length).toBeGreaterThan(500);
  });

  it('only HelpdeskService inserts a SupportTicket row', () => {
    expect(filesMatching(/supportTicket\s*\.\s*create\s*\(/)).toEqual([HELPDESK]);
    expect(filesMatching(/supportTicket\s*\.\s*(createMany|upsert)\s*\(/)).toEqual([]);
    expect(filesMatching(/INSERT\s+INTO\s+"?support_tickets/i)).toEqual([]);
  });

  it('the transaction-taking insert has two callers: the manual operation and the boundary', () => {
    expect(filesMatching(/\.createTicketRow\s*\(/)).toEqual([HELPDESK, BOUNDARY].sort());
  });

  it('HelpdeskService.createTicket, the manual operation, is called only by the human route', () => {
    // `.createTicket(` on something that is the helpdesk service. The route is
    // W3 of the characterization and stays outside the boundary (ruling Q5).
    const callers = FILES.filter((f) => /(helpdesk|getHelpdesk\(\))\s*\.\s*createTicket\s*\(/i.test(f.text)).map((f) => f.path);
    expect(callers).toEqual([HELPDESK_CONTROLLER]);
  });
});

describe('surface inventory: the tool handler', () => {
  const text = file(ORCHESTRATOR);
  const start = text.indexOf("case 'helpdesk_create_ticket': {");
  const end = text.indexOf("case 'helpdesk_update_ticket': {", start);
  const handler = text.slice(start, end);
  // The handler with its comments removed: what it executes.
  const code = handler
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter(Boolean)
    .join('\n');

  it('exists once, in executeToolAction', () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(text.split("case 'helpdesk_create_ticket': {")).toHaveLength(2);
  });

  it('does one thing: hand the call, with its context, to the boundary', () => {
    expect(code).toBe(
      ["case 'helpdesk_create_ticket': {", 'return this.getActionBoundary().executeFromTool(businessId, toolName, args, action);', '}'].join('\n'),
    );
  });

  it('every caller of executeToolAction passes the action context on', () => {
    const calls = [...text.matchAll(/this\.executeToolAction\(([^\n]*)\)/g)].map((m) => m[1].trim());
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const args of calls) {
      expect(args, `executeToolAction(${args})`).toMatch(/^businessId, toolName, args, (action|\{ surface: '[A-Z_]+' \})$/);
    }
  });

  it('executeTool hands its context to executeToolAction', () => {
    expect(text).toContain('const rawResult = await this.executeToolAction(businessId, toolName, args, action);');
  });
});

describe('surface inventory: each surface declares itself', () => {
  // surface -> the file that owns it. E1 to E11 of the characterization, and
  // the pro-auto monitor, which reached the executor without a number.
  const DECLARED: Array<[surface: string, path: string, label: string]> = [
    ['CHAT', ORCHESTRATOR, 'E1 chat'],
    ['CHAT_STREAM', ORCHESTRATOR, 'E2 streaming chat'],
    ['PHONE_STREAM', 'modules/phone-voice/phone-voice.service.ts', 'E4 phone voice'],
    ['INBOUND_CONVERSATION', 'modules/ai/conversational-ai.service.ts', 'E5 inbound conversational'],
    ['PLAN_HTTP', ORCHESTRATOR, 'E6 plan over HTTP'],
    ['PLAN_QUEUE', 'modules/ai/action-dispatcher.service.ts', 'E7 plan queue'],
    ['PROPOSAL', 'modules/key-cortex/key-cortex-action-executor.plugin.ts', 'E8 proposal executor'],
    ['CORTEX_BRIDGE', 'modules/key-cortex/key-cortex-efferent-bridge.service.ts', 'E9 cortex bridge'],
    ['GRAPH_ACTION', 'modules/ai/graph-actions.controller.ts', 'E10 graph actions'],
    ['CUSTOM_LOGIC', ORCHESTRATOR, 'E11 custom logic'],
    ['PRO_AUTO_MONITOR', ORCHESTRATOR, 'pro-auto monitor'],
  ];

  it.each(DECLARED)('%s is declared by %s (%s)', (surface, path) => {
    expect(file(path)).toMatch(new RegExp(`surface: '${surface}'`));
  });

  it('E3 confirms through the boundary before the legacy confirm path can run', () => {
    const text = file(ORCHESTRATOR);
    const branch = text.indexOf('    if (pendingConfirmation) {');
    const viaBoundary = text.indexOf('await this.confirmThroughBoundary(businessId, pendingConfirmation, userId);', branch);
    const legacyExecute = text.indexOf('await this.executeTool(businessId, pendingConfirmation.toolName', branch);
    expect(branch).toBeGreaterThan(0);
    expect(viaBoundary).toBeGreaterThan(branch);
    expect(legacyExecute).toBeGreaterThan(viaBoundary);
  });

  it('no surface declares a surface the boundary does not know', async () => {
    const { EXECUTION_SURFACES } = await import('./control-clearance');
    const declared = new Set<string>();
    for (const f of FILES) {
      if (f.path.startsWith('modules/key-autonomy/action-boundary/')) continue;
      for (const m of f.text.matchAll(/surface: '([A-Z_]+)'/g)) declared.add(m[1]);
    }
    for (const surface of declared) expect(EXECUTION_SURFACES).toContain(surface);
    // Every surface but the two that are never declared by a caller: CHAT_CONFIRM
    // is the id-only confirm path, and UNDECLARED is the absence of a declaration.
    expect([...declared].sort()).toEqual(EXECUTION_SURFACES.filter((s) => s !== 'CHAT_CONFIRM' && s !== 'UNDECLARED').sort());
  });

  it('the phone stream and the cortex bridge present no principal', () => {
    for (const path of ['modules/phone-voice/phone-voice.service.ts', 'modules/key-cortex/key-cortex-efferent-bridge.service.ts', 'modules/ai/conversational-ai.service.ts', 'modules/ai/action-dispatcher.service.ts']) {
      expect(file(path), path).not.toMatch(/principalUserId/);
    }
  });
});

describe('surface inventory: what is deliberately not touched', () => {
  it('W3, the human helpdesk route, calls the manual operation and not the boundary', () => {
    const text = file(HELPDESK_CONTROLLER);
    expect(text).toContain('return this.helpdesk.createTicket(businessId, body);');
    expect(text).not.toMatch(/KeyActionBoundary|executeFromTool/);
  });

  it('the boundary adopts one capability', async () => {
    const { BOUNDARY_CAPABILITIES } = await import('./action-envelope');
    expect(BOUNDARY_CAPABILITIES).toEqual(['helpdesk_create_ticket']);
  });
});
