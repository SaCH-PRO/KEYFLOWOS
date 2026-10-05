import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exactRepoPath, verifyPacketCodeLinks } from './verify-atlas-code-links.mjs';

test('exactRepoPath accepts only bounded repository-relative paths', () => {
  assert.equal(exactRepoPath('apps/server/src/a.ts'), 'apps/server/src/a.ts');
  assert.equal(exactRepoPath('.agent-control/programme-state.yaml'), '.agent-control/programme-state.yaml');
  assert.equal(exactRepoPath('/etc/passwd'), null);
  assert.equal(exactRepoPath('../secret'), null);
  assert.equal(exactRepoPath('apps/server/src/file with spaces.ts'), null);
  assert.equal(exactRepoPath('ActionDispatcherService'), null);
});

test('verified exact paths become observed code links while conceptual seams stay unlinked', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-atlas-code-'));
  try {
    fs.mkdirSync(path.join(root, 'apps/server/src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'apps/server/src/live.ts'), 'export {};\n');
    const result = verifyPacketCodeLinks({
      source_ref: 'test-ref',
      packets: [{
        packet_id: 'KF-EXEC-A-001',
        source_file: 'docs/intelligence/execution/a.md',
        source_ref: 'test-ref',
        seams: [
          { value: 'apps/server/src/live.ts', kind: 'path_or_symbol' },
          { value: 'ActionDispatcherService', kind: 'conceptual' },
        ],
      }],
    }, root);
    assert.equal(result.links.length, 1);
    assert.equal(result.links[0].path, 'apps/server/src/live.ts');
    assert.equal(result.links[0].evidence_class, 'observed');
    assert.equal(result.links[0].authority, 'current_code');
    assert.equal(result.stats.conceptual_seams, 1);
    assert.equal(result.contradictions.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('NEGATIVE CONTROL: a declared exact path that is absent remains a contradiction', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-atlas-code-'));
  try {
    const result = verifyPacketCodeLinks({
      packets: [{
        packet_id: 'KF-EXEC-A-001',
        source_file: 'docs/intelligence/execution/a.md',
        seams: [{ value: 'apps/server/src/missing.ts', kind: 'path_or_symbol' }],
      }],
    }, root);
    assert.equal(result.links.length, 0);
    assert.equal(result.status, 'PARTIAL_OR_CONTRADICTED');
    assert.equal(result.contradictions[0].type, 'MISSING_DECLARED_CODE_SEAM');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('NEGATIVE CONTROL: ambiguous symbols never become current-code evidence by name alone', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-atlas-code-'));
  try {
    const result = verifyPacketCodeLinks({
      packets: [{
        packet_id: 'KF-EXEC-A-001',
        seams: [{ value: 'SomeService', kind: 'path_or_symbol' }],
      }],
    }, root);
    assert.equal(result.links.length, 0);
    assert.equal(result.stats.non_exact_path_seams, 1);
    assert.equal(result.contradictions.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
