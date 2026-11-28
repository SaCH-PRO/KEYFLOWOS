/**
 * RR-STRICT-TOOL-SCHEMAS — Caller Census Spec (D-261, D-262)
 *
 * Scans `apps/server/src` for every production caller of
 * `FlowOrchestratorService.executeToolDirectly`, `executeToolDirect`, and
 * `autoExecuteToolForMonitoring` and requires each caller to be registered in
 * `STRICT_TOOL_CALLER_CENSUS` (exported from `flow-tool-registry.ts` or
 * `flow-orchestrator.service.ts`) with its extra-key verdict (`clean` |
 * `exempt-shrink-only`).
 *
 * RED on main: no caller census exists yet.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as flowToolRegistry from './flow-tool-registry';

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
    const census = (
      flowToolRegistry as unknown as {
        STRICT_TOOL_CALLER_CENSUS?: ReadonlyArray<{
          file: string;
          method: string;
          callee: string;
          verdict: 'clean' | 'exempt-shrink-only';
          rationale: string;
        }>;
      }
    ).STRICT_TOOL_CALLER_CENSUS;

    expect(census, 'STRICT_TOOL_CALLER_CENSUS must be exported from flow-tool-registry.ts').toBeDefined();

    const discovered = scanToolExecutionCallers();
    const discoveredKeys = new Set(discovered.map((d) => `${d.file}#${d.method}::${d.callee}`));
    const registeredKeys = new Set((census ?? []).map((c) => `${c.file}#${c.method}::${c.callee}`));

    const unregistered = [...discoveredKeys].filter((k) => !registeredKeys.has(k)).sort();
    const stale = [...registeredKeys].filter((k) => !discoveredKeys.has(k)).sort();

    expect(unregistered, 'Unregistered tool-dispatch caller found').toEqual([]);
    expect(stale, 'Stale tool-dispatch caller entry found').toEqual([]);
  });
});
