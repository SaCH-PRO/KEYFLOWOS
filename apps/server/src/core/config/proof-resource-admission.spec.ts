import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ADMITTER = resolve(process.cwd(), '../../scripts/proof-admission/admit-resources.mjs');

const manifest = {
  manifestVersion: 1,
  environment: 'github-actions-ci-test',
  requiredEnv: { CI: 'true', GITHUB_ACTIONS: 'true' },
  resources: [
    {
      env: 'DATABASE_URL',
      kind: 'postgres',
      allowedProtocols: ['postgresql:', 'postgres:'],
      allowedHosts: ['localhost', '127.0.0.1'],
      allowedPorts: [5432],
      allowedUsernames: ['keyflow'],
      allowedDatabaseNames: ['keyflowos'],
    },
    {
      env: 'DIRECT_URL',
      kind: 'postgres',
      allowedProtocols: ['postgresql:', 'postgres:'],
      allowedHosts: ['localhost', '127.0.0.1'],
      allowedPorts: [5432],
      allowedUsernames: ['keyflow'],
      allowedDatabaseNames: ['keyflowos'],
    },
    {
      env: 'REDIS_URL',
      kind: 'redis',
      allowedProtocols: ['redis:'],
      allowedHosts: ['localhost', '127.0.0.1'],
      allowedPorts: [6379],
    },
  ],
};

const safeEnv = {
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  DATABASE_URL: 'postgresql://keyflow:secret@localhost:5432/keyflowos',
  DIRECT_URL: 'postgresql://keyflow:secret@localhost:5432/keyflowos',
  REDIS_URL: 'redis://localhost:6379',
};

function run(env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'kf-resource-proof-'));
  const manifestPath = join(dir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const child = spawnSync(process.execPath, [ADMITTER, '--manifest', manifestPath], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return {
    status: child.status,
    stdout: child.stdout.trim(),
    result: JSON.parse(child.stdout.trim()),
  };
}

describe('proof resource admission', () => {
  it('[K12-P11] admits explicit local CI postgres and redis resources', () => {
    const result = run(safeEnv);
    expect(result.status).toBe(0);
    expect(result.result.status).toBe('ADMITTED_NONPRODUCTION');
    expect(result.result.resources).toHaveLength(3);
  });

  it('[K12-P12] rejects a nonlocal database host', () => {
    const result = run({ ...safeEnv, DATABASE_URL: 'postgresql://keyflow:secret@db.example.com:5432/keyflowos' });
    expect(result.status).toBe(2);
    expect(result.result.reasons).toContain('KF_PROOF_RESOURCE_HOST_UNSAFE');
  });

  it('[K12-P13] rejects an unexpected database name', () => {
    const result = run({ ...safeEnv, DATABASE_URL: 'postgresql://keyflow:secret@localhost:5432/production' });
    expect(result.status).toBe(2);
    expect(result.result.reasons).toContain('KF_PROOF_RESOURCE_DATABASE_UNSAFE');
  });

  it('[K12-P14] rejects a nonlocal redis host', () => {
    const result = run({ ...safeEnv, REDIS_URL: 'redis://cache.example.com:6379' });
    expect(result.status).toBe(2);
    expect(result.result.reasons).toContain('KF_PROOF_RESOURCE_HOST_UNSAFE');
  });

  it('[K12-P15] rejects an untrusted execution environment', () => {
    const result = run({ ...safeEnv, CI: '', GITHUB_ACTIONS: '' });
    expect(result.status).toBe(2);
    expect(result.result.reasons).toContain('KF_PROOF_RESOURCE_ENVIRONMENT_UNTRUSTED');
  });

  it('[K12-P16] never emits resource credentials in its receipt', () => {
    const result = run(safeEnv);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('secret');
    expect(result.stdout).not.toContain('keyflow:secret');
  });

  // R0-16-PROOF-BINDING review SEC-R016-4: the URL names localhost, but
  // node-postgres and Prisma read ?host= (pg also ?user= and ?port=) in its
  // place, and ioredis fills an index or socket the URL leaves out from ?db= or
  // ?path=. Before the repair each of these was ADMITTED_NONPRODUCTION.
  it('[K12-P43] NEGATIVE CONTROL: a local URL whose query string overrides its connection target is REJECTED, naming the parameter and never its value', () => {
    const overrides: Array<[env: string, url: string, parameters: string[]]> = [
      ['DATABASE_URL', 'postgresql://keyflow:secret@localhost:5432/keyflowos?host=db.prod-example.invalid', ['host']],
      ['DIRECT_URL', 'postgresql://keyflow:secret@localhost:5432/keyflowos?sslmode=disable&hostaddr=192.0.2.10', ['hostaddr']],
      ['DATABASE_URL', 'postgresql://keyflow:secret@localhost:5432/keyflowos?user=postgres&port=6543', ['user', 'port']],
      ['DATABASE_URL', 'postgres://keyflow:secret@127.0.0.1:5432/keyflowos?HOST=db.prod-example.invalid', ['HOST']],
      ['DATABASE_URL', 'postgresql://keyflow:secret@localhost:5432/keyflowos?service=prod-example', ['service']],
      ['REDIS_URL', 'redis://localhost:6379?db=5', ['db']],
      ['REDIS_URL', 'redis://localhost:6379?path=/tmp/prod-example.sock', ['path']],
    ];
    for (const [env, url, parameters] of overrides) {
      const result = run({ ...safeEnv, [env]: url });
      expect(result.status, url).toBe(2);
      expect(result.result.status, url).toBe('REJECTED');
      expect(result.result.reasons, url).toEqual(['KF_PROOF_RESOURCE_TARGET_OVERRIDE']);
      expect(result.result.env, url).toBe(env);
      expect(result.result.parameters, url).toEqual(parameters);
      expect(result.stdout, url).not.toMatch(/prod-example|192\.0\.2\.10|6543|secret/);
    }
  });

  it('[K12-P44] query parameters that do not move the connection target are still admitted', () => {
    const result = run({
      ...safeEnv,
      DATABASE_URL: 'postgresql://keyflow:secret@localhost:5432/keyflowos?schema=public&connection_limit=5&sslmode=disable',
      DIRECT_URL: 'postgresql://keyflow:secret@localhost:5432/keyflowos?application_name=k12',
    });
    expect(result.status, result.stdout).toBe(0);
    expect(result.result.status).toBe('ADMITTED_NONPRODUCTION');
  });
});
