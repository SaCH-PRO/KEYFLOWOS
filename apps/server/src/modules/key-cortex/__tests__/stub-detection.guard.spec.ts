/**
 * Stub-detection guard for the KEY Cortex canonical execution surface.
 *
 * Fails the build if the connector or organ adapters contain known
 * placeholder / no-op patterns on the execution path. This is a Phase 0
 * exit-criteria guard; it should expand as new stub patterns are discovered.
 *
 * Note: the connector's "Phase 2 bridge methods" are intentionally out of
 * scope here. They are flagged for Phase 2 organ work and are not part of
 * the canonical tool registry's execution surface.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SRC_ROOT = join(__dirname, '..');
const CONNECTOR_PATH = join(SRC_ROOT, 'key-cortex-connector.service.ts');
const REGISTRY_PATH = join(SRC_ROOT, 'key-cortex-tool-registry.service.ts');
const ORGANS_DIR = join(SRC_ROOT, 'organs');

interface Violation {
  file: string;
  line: number;
  text: string;
  reason: string;
}

function scanFile(path: string, patterns: Array<{ regex: RegExp; reason: string }>): Violation[] {
  const text = readFileSync(path, 'utf-8');
  const lines = text.split('\n');
  const violations: Violation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    for (const pattern of patterns) {
      if (pattern.regex.test(lineText)) {
        violations.push({
          file: path,
          line: i + 1,
          text: lineText.trim(),
          reason: pattern.reason,
        });
      }
    }
  }

  return violations;
}

function tsFilesIn(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.service.ts'))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

describe('KEY Cortex stub-detection guard', () => {
  const connectorExecutionPatterns = [
    {
      regex: /\(service as any\)/,
      reason: 'Unsafe (service as any) cast bypasses type contracts and hides missing integrations.',
    },
    {
      regex: /\(this\.[a-zA-Z_$][a-zA-Z0-9_$]* as any\)/,
      reason: 'Unsafe (this.x as any) cast bypasses type contracts and hides missing integrations.',
    },
  ];

  const placeholderPatterns = [
    {
      regex: /status:\s*['"]placeholder['"]/,
      reason: 'Placeholder status object returned instead of a real result.',
    },
    {
      regex: /return \{\s*businessId,\s*status:\s*['"]placeholder/i,
      reason: 'Placeholder return shape in execution handler.',
    },
    {
      regex: /handler:\s*async?\s*\([^)]*\)\s*=>\s*\{\s*return \{[^}]*status:\s*['"]placeholder/i,
      reason: 'Placeholder tool handler registered in canonical registry.',
    },
  ];

  it('has no (service as any) casts in the connector', () => {
    const violations = scanFile(CONNECTOR_PATH, connectorExecutionPatterns);
    expect(violations).toEqual([]);
  });

  it('has no placeholder handlers in the canonical tool registry', () => {
    const violations = scanFile(REGISTRY_PATH, placeholderPatterns);
    expect(violations).toEqual([]);
  });

  it('has no placeholder handlers in organ adapters', () => {
    const files = tsFilesIn(ORGANS_DIR);

    // Prove the scan had something to scan.
    //
    // `tsFilesIn` ends in `catch { return []; }`, so if ORGANS_DIR is renamed,
    // moved, or emptied, this returns no files, `allViolations` is `[]`, and
    // the assertion below passes while inspecting nothing. A guard against
    // stubs is a poor thing to leave able to become a stub.
    expect(
      files.length,
      `no .service.ts files found under ${ORGANS_DIR} — this test would pass ` +
        'by scanning nothing. The directory has probably moved.',
    ).toBeGreaterThan(0);

    const allViolations = files.flatMap((f) => scanFile(f, placeholderPatterns));
    expect(allViolations).toEqual([]);
  });
});
