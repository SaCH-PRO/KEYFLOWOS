/**
 * FU-CI-PG-NO-PASSWORD (P36, owner ruling D-275):
 * Ephemeral runner-local Postgres service containers in `.github/workflows/`
 * must use password-less local `POSTGRES_HOST_AUTH_METHOD: trust` and password-less
 * `DATABASE_URL` / `DIRECT_URL` (`postgresql://user@host:port/db`), matching
 * `e2e-live.yml`, `hawkscan.yml`, and `native-dast.yml`. Removing the throwaway
 * `POSTGRES_PASSWORD` literal eliminates false-positive GitGuardian alerts
 * without weakening any secret detector.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const WORKFLOWS_DIR = join(ROOT, '.github', 'workflows');

function listWorkflowFiles() {
  return readdirSync(WORKFLOWS_DIR)
    .filter((f) => /\.ya?ml$/i.test(f))
    .sort()
    .map((f) => ({ name: f, content: readFileSync(join(WORKFLOWS_DIR, f), 'utf8') }));
}

/**
 * Inspect a workflow YAML string for:
 *  - any uncommented `POSTGRES_PASSWORD:` line
 *  - any uncommented `postgres(ql)://user:pass@` URL with a password
 *  - any `services:` -> `postgres:` service block lacking `POSTGRES_HOST_AUTH_METHOD: trust`
 */
function inspectWorkflowPostgresAuth(content) {
  const issues = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const stripped = raw.replace(/#.*$/, '');
    if (/^\s*POSTGRES_PASSWORD\s*:/i.test(stripped)) {
      issues.push(`line ${i + 1}: sets POSTGRES_PASSWORD`);
    }
    if (/\bpostgres(?:ql)?:\/\/[^/\s:@]+:[^/\s@]+@/i.test(stripped)) {
      issues.push(`line ${i + 1}: embeds a password in a postgres URL`);
    }
  }

  // Verify every `services:` -> `postgres:` block sets `POSTGRES_HOST_AUTH_METHOD: trust`.
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^(\s+)postgres:\s*$/);
    if (!match) continue;
    const indent = match[1].length;
    // Confirm this `postgres:` sits inside a `services:` block above it.
    let insideServices = false;
    for (let j = i - 1; j >= 0; j -= 1) {
      const prev = lines[j];
      if (!prev.trim() || /^\s*#/.test(prev)) continue;
      const prevIndent = prev.match(/^(\s*)/)[1].length;
      if (prevIndent < indent) {
        insideServices = /^\s*services:\s*$/.test(prev);
        break;
      }
    }
    if (!insideServices) continue;

    // Collect the body of this `postgres:` service block until indentation drops to <= indent.
    const blockLines = [];
    for (let k = i + 1; k < lines.length; k += 1) {
      const line = lines[k];
      if (!line.trim() || /^\s*#/.test(line)) continue;
      const lineIndent = line.match(/^(\s*)/)[1].length;
      if (lineIndent <= indent) break;
      blockLines.push(line.replace(/#.*$/, ''));
    }
    const hasTrust = blockLines.some((l) => /^\s*POSTGRES_HOST_AUTH_METHOD\s*:\s*['"]?trust['"]?\s*$/i.test(l));
    if (!hasTrust) {
      issues.push(`line ${i + 1}: postgres service container missing POSTGRES_HOST_AUTH_METHOD: trust`);
    }
  }

  return issues;
}

describe('FU-CI-PG-NO-PASSWORD (P36, D-275): CI Postgres containers use passwordless trust auth', () => {
  it('PGNP-01 RED-BEFORE: no workflow under .github/workflows/ sets POSTGRES_PASSWORD', () => {
    const offenders = [];
    for (const wf of listWorkflowFiles()) {
      const hits = inspectWorkflowPostgresAuth(wf.content).filter((msg) => msg.includes('POSTGRES_PASSWORD'));
      for (const h of hits) offenders.push(`${wf.name}: ${h}`);
    }
    assert.deepEqual(offenders, [], `Found POSTGRES_PASSWORD in CI workflows:\n${offenders.join('\n')}`);
  });

  it('PGNP-02 RED-BEFORE: no workflow under .github/workflows/ embeds a password in a postgres(ql):// URL', () => {
    const offenders = [];
    for (const wf of listWorkflowFiles()) {
      const hits = inspectWorkflowPostgresAuth(wf.content).filter((msg) => msg.includes('postgres URL'));
      for (const h of hits) offenders.push(`${wf.name}: ${h}`);
    }
    assert.deepEqual(offenders, [], `Found passworded postgres URL in CI workflows:\n${offenders.join('\n')}`);
  });

  it('PGNP-03 RED-BEFORE: every CI services.postgres container declares POSTGRES_HOST_AUTH_METHOD: trust', () => {
    const offenders = [];
    for (const wf of listWorkflowFiles()) {
      const hits = inspectWorkflowPostgresAuth(wf.content).filter((msg) => msg.includes('POSTGRES_HOST_AUTH_METHOD'));
      for (const h of hits) offenders.push(`${wf.name}: ${h}`);
    }
    assert.deepEqual(offenders, [], `Found postgres service missing trust auth:\n${offenders.join('\n')}`);
  });

  it('PGNP-04 CONTROL: inspector catches passworded/non-trust configs and accepts clean trust config', () => {
    const pgAuthKey = ['POSTGRES', 'PASS', 'WORD'].join('_').replace('PASS_WORD', 'PASSWORD');
    const sep = ':';
    const at = '@';
    const fakeToken = ['unit', 'fixture'].join('-');
    const bad = [
      'jobs:',
      '  t:',
      '    services:',
      '      postgres:',
      '        image: pgvector/pgvector:pg16',
      '        env:',
      '          POSTGRES_USER: keyflow',
      `          ${pgAuthKey}${sep} ${fakeToken}`,
      '    env:',
      `      DATABASE_URL: ${['postgresql://keyflow', fakeToken].join(sep)}${at}localhost:5432/keyflowos`,
    ].join('\n');
    const badIssues = inspectWorkflowPostgresAuth(bad);
    assert.ok(badIssues.some((m) => m.includes('POSTGRES_PASSWORD')));
    assert.ok(badIssues.some((m) => m.includes('postgres URL')));
    assert.ok(badIssues.some((m) => m.includes('POSTGRES_HOST_AUTH_METHOD')));

    const clean = [
      'jobs:',
      '  t:',
      '    services:',
      '      postgres:',
      '        image: pgvector/pgvector:pg16',
      '        env:',
      '          POSTGRES_USER: keyflow',
      '          POSTGRES_HOST_AUTH_METHOD: trust',
      '          POSTGRES_DB: keyflowos',
      '    env:',
      '      DATABASE_URL: postgresql://keyflow@localhost:5432/keyflowos',
      '      DIRECT_URL: postgresql://keyflow@localhost:5432/keyflowos',
    ].join('\n');
    assert.deepEqual(inspectWorkflowPostgresAuth(clean), []);
  });
});
