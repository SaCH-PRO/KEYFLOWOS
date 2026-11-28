/**
 * HARNESS-REMOVAL (server half, P1 critical path, r0_impact: KEEP):
 *
 * Verifies the unused fake `MOCK_BUSINESSES` DirectoryModule
 * (`apps/server/src/modules/directory/`) is removed from the codebase,
 * unmounted from `AppModule`, and its stale 2-route allowlist entry is
 * removed from `src/core/auth/public-surface.spec.ts`.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const SERVER_SRC = path.resolve(__dirname, '../..');

describe('HARNESS-REMOVAL (server half): fake MOCK_BUSINESSES directory module removed', () => {
  it('removes directory.controller.ts and directory.module.ts', () => {
    expect(fs.existsSync(path.join(SERVER_SRC, 'modules/directory/directory.controller.ts'))).toBe(false);
    expect(fs.existsSync(path.join(SERVER_SRC, 'modules/directory/directory.module.ts'))).toBe(false);
  });

  it('unmounts DirectoryModule from AppModule', () => {
    const appModule = fs.readFileSync(path.join(SERVER_SRC, 'app.module.ts'), 'utf8');
    expect(appModule).not.toMatch(/\bDirectoryModule\b/);
    expect(appModule).not.toMatch(/modules\/directory\/directory\.module/);
  });

  it('removes modules/directory/directory.controller.ts from public-surface.spec.ts ACKNOWLEDGED_PUBLIC', () => {
    const publicSurface = fs.readFileSync(path.join(SERVER_SRC, 'core/auth/public-surface.spec.ts'), 'utf8');
    expect(publicSurface).not.toContain("'modules/directory/directory.controller.ts'");
  });
});
