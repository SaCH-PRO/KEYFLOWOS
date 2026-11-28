/**
 * RR-STRICT-TOOL-SCHEMAS — Caller Census Spec (D-261, D-262)
 *
 * Scans `apps/server/src` for every production caller of
 * `FlowOrchestratorService.executeToolDirectly`, `executeToolDirect`, and
 * `autoExecuteToolForMonitoring` and requires each caller to be registered in
 * `STRICT_TOOL_CALLER_CENSUS` with its extra-key verdict (`clean` |
 * `exempt-shrink-only`), plus verifies that a stored plan step with declared
 * keys runs cleanly through `executeToolDirectly` while an undeclared key is
 * refused with HTTP 400.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  PRO_AUTO_MONITOR_EXEMPT_READ_TOOLS,
  STRICT_TOOL_CALLER_CENSUS,
  getToolByName,
} from './flow-tool-registry';
import { FlowOrchestratorService } from './flow-orchestrator.service';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SERVER_SRC_DIR = path.join(REPO_ROOT, 'apps/server/src');
const TARGET_METHODS = new Set([
  'executeToolDirectly',
  'executeToolDirect',
  'autoExecuteToolForMonitoring',
]);

interface DiscoveredCaller {
  file: string;
  method: string;
  callee: string;
}

function walkServerTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkServerTsFiles(full, out);
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out.sort();
}

function enclosingMethodName(node: ts.Node, sf: ts.SourceFile): string {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (ts.isMethodDeclaration(cur) && cur.name) return cur.name.getText(sf);
    if (ts.isFunctionDeclaration(cur) && cur.name) return cur.name.text;
    cur = cur.parent;
  }
  return '<module>';
}

function scanToolExecutionCallers(): DiscoveredCaller[] {
  const found = new Map<string, DiscoveredCaller>();
  for (const abs of walkServerTsFiles(SERVER_SRC_DIR)) {
    const rel = path.relative(REPO_ROOT, abs).replace(/\\/g, '/');
    const src = fs.readFileSync(abs, 'utf8');
    const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    const visit = (node: ts.Node) => {
      if (ts.isJSDoc(node)) return;
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const name = node.expression.name.text;
        if (TARGET_METHODS.has(name)) {
          const method = enclosingMethodName(node, sf);
          const key = `${rel}#${method}::${name}`;
          found.set(key, { file: rel, method, callee: name });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return [...found.values()].sort((a, b) =>
    `${a.file}#${a.method}::${a.callee}`.localeCompare(`${b.file}#${b.method}::${b.callee}`),
  );
}

describe('RR-STRICT-TOOL-SCHEMAS — executeToolDirectly / direct caller census', () => {
  it('registers every production caller of executeToolDirectly, executeToolDirect, and autoExecuteToolForMonitoring with its extra-key verdict', () => {
    expect(STRICT_TOOL_CALLER_CENSUS.length).toBeGreaterThanOrEqual(6);

    const discovered = scanToolExecutionCallers();
    const discoveredKeys = new Set(discovered.map((d) => `${d.file}#${d.method}::${d.callee}`));
    const registeredKeys = new Set(
      STRICT_TOOL_CALLER_CENSUS.map((c) => `${c.file}#${c.method}::${c.callee}`),
    );

    const unregistered = [...discoveredKeys].filter((k) => !registeredKeys.has(k)).sort();
    const stale = [...registeredKeys].filter((k) => !discoveredKeys.has(k)).sort();

    expect(unregistered, 'Unregistered tool-dispatch caller found').toEqual([]);
    expect(stale, 'Stale tool-dispatch caller entry found').toEqual([]);

    for (const entry of STRICT_TOOL_CALLER_CENSUS) {
      expect(entry.rationale.trim().length).toBeGreaterThan(10);
      if (entry.verdict === 'exempt-shrink-only') {
        expect(entry.exemptTools?.length ?? 0).toBeGreaterThan(0);
        expect(entry.exemptKeys?.length ?? 0).toBeGreaterThan(0);
      }
    }

    // Verify every listed ProAutoMonitor read tool exists in FLOW_TOOLS and genuinely lacks businessId
    for (const toolName of PRO_AUTO_MONITOR_EXEMPT_READ_TOOLS) {
      const tool = getToolByName(toolName);
      expect(tool, `Exempt tool ${toolName} must exist in FLOW_TOOLS`).toBeDefined();
      expect(Object.prototype.hasOwnProperty.call(tool!.parameters.properties, 'businessId')).toBe(false);
    }
  });

  it('executes a stored plan step with declared keys cleanly through executeToolDirectly and refuses an undeclared key with 400', async () => {
    const orchestrator = Object.create(FlowOrchestratorService.prototype) as FlowOrchestratorService & {
      memberScopeRefusal: ReturnType<typeof vi.fn>;
      executeToolAction: ReturnType<typeof vi.fn>;
      governance: { getToolTier: ReturnType<typeof vi.fn> };
      executionLog: { logToolExecution: ReturnType<typeof vi.fn> };
      businessGraph: { invalidateCache: ReturnType<typeof vi.fn> };
      attributeExecutionLog: ReturnType<typeof vi.fn>;
    };
    orchestrator.memberScopeRefusal = vi.fn().mockResolvedValue(null);
    orchestrator.executeToolAction = vi.fn().mockResolvedValue({ contacts: [{ id: 'c_1' }] });
    orchestrator.governance = { getToolTier: vi.fn().mockReturnValue(1) };
    orchestrator.executionLog = { logToolExecution: vi.fn().mockResolvedValue('log_1') };
    orchestrator.businessGraph = { invalidateCache: vi.fn() };
    orchestrator.attributeExecutionLog = vi.fn().mockResolvedValue(undefined);

    // Stored plan step with declared keys only -> runs cleanly
    const okResult = await orchestrator.executeToolDirectly(
      'biz_1',
      'crm_search_contacts',
      { query: 'Ada' },
      { planId: 'plan_1', planStepId: 'step_1' },
      { surface: 'PLAN_QUEUE', planId: 'plan_1', planStepId: 'step_1' },
    );
    expect(okResult).toEqual({ contacts: [{ id: 'c_1' }] });
    expect(orchestrator.executeToolAction).toHaveBeenCalledTimes(1);

    // Stored plan step injecting undeclared businessId -> refused 400 before executeToolAction runs
    orchestrator.executeToolAction.mockClear();
    await expect(
      orchestrator.executeToolDirectly(
        'biz_1',
        'crm_search_contacts',
        { query: 'Ada', businessId: 'other_biz' },
        { planId: 'plan_1', planStepId: 'step_2' },
        { surface: 'PLAN_QUEUE', planId: 'plan_1', planStepId: 'step_2' },
      ),
    ).rejects.toThrow(BadRequestException);
    expect(orchestrator.executeToolAction).not.toHaveBeenCalled();
  });
});
