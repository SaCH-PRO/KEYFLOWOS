/**
 * R0-00-WT-ISOLATION: resource admission per packet.
 *
 * At c2f6f46d no repo-root .env existed in the main tree or in any worktree, so
 * every integration suite (release0-journey.integration.test.ts:74 loads
 * ../../../.env) inherited one DATABASE_URL and one REDIS_URL from the shell.
 * admit-resources.mjs had one mode, the CI manifest, which admits the database
 * named `keyflowos`: a worktree pointed at the main-tree database was admitted.
 *
 * `admit-resources.mjs --packet <id>` reads
 * scripts/proof-admission/manifests/local-worktree-resources.json and admits only
 * `kf_wt_<id>` on localhost with a non-zero Redis index. The values it judges are
 * the ones a suite will actually see: the worktree .env, overridden by anything
 * the shell exports (dotenv never overrides an exported value). That is how it
 * catches a shell that still exports the main-tree database.
 *
 * scripts/worktree-resources.sh provisions those resources. Its database work
 * needs a live Postgres and is proven by the integrating session; the parts
 * pinned here are the ones that must agree with the admitter without one.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = join(__dirname, '..', '..', '..', '..', '..');
const ADMITTER = join(REPO, 'scripts', 'proof-admission', 'admit-resources.mjs');
const MANIFEST = join(REPO, 'scripts', 'proof-admission', 'manifests', 'local-worktree-resources.json');
const PROVISIONER = join(REPO, 'scripts', 'worktree-resources.sh');

const OWN_DB = 'postgresql://keyflow:secret@localhost:5432/kf_wt_r0_00';
const MAIN_DB = 'postgresql://keyflow:secret@localhost:5432/keyflowos';

const packetEnv = {
  DATABASE_URL: OWN_DB,
  DIRECT_URL: OWN_DB,
  REDIS_URL: 'redis://localhost:6379/3',
};

/** A worktree .env written the way worktree-resources.sh writes it. */
function envFile(vars: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'kf-wt-env-'));
  const file = join(dir, '.env');
  writeFileSync(
    file,
    ['# written by scripts/worktree-resources.sh', ...Object.entries(vars).map(([k, v]) => `${k}=${v}`)].join('\n') + '\n',
  );
  return file;
}

/**
 * Run the admitter with exactly `shell` as the exported environment (plus
 * PATH), never the developer's own, so DATABASE_URL in this process cannot
 * leak into the case.
 */
function admit(args: string[], shell: Record<string, string> = {}) {
  const child = spawnSync(process.execPath, [ADMITTER, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', ...shell },
  });
  const stdout = child.stdout.trim();
  let result: any = null;
  try {
    result = JSON.parse(stdout);
  } catch {
    /* asserted below */
  }
  return { status: child.status, stdout, result };
}

describe('per-packet resource admission (R0-00)', () => {
  it('commits a packet-scoped local manifest', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.packetScoped).toBe(true);
    const db = manifest.resources.find((r: any) => r.env === 'DATABASE_URL');
    expect(db.allowedDatabaseNames).toEqual(['kf_wt_{packet}']);
    expect(manifest.sharedDatabaseNames).toContain('keyflowos');
    const redis = manifest.resources.find((r: any) => r.env === 'REDIS_URL');
    expect(redis.allowedDbIndexes).not.toContain(0);
  });

  it('admits kf_wt_<id> on localhost with a non-zero Redis index, from the worktree .env', () => {
    const r = admit(['--packet', 'R0-00', '--env-file', envFile(packetEnv)]);
    expect(r.result, r.stdout).not.toBeNull();
    expect(r.result.status).toBe('ADMITTED_NONPRODUCTION');
    expect(r.status).toBe(0);
    expect(r.result.packet).toBe('r0_00');
    const db = r.result.resources.find((x: any) => x.env === 'DATABASE_URL');
    expect(db.database).toBe('kf_wt_r0_00');
    expect(db.source).toBe('env-file');
    const redis = r.result.resources.find((x: any) => x.env === 'REDIS_URL');
    expect(redis.dbIndex).toBe(3);
  });

  it('accepts the full packet id and derives the same database name', () => {
    const r = admit(['--packet', 'R0-00-WT-ISOLATION', '--env-file', envFile(packetEnv)]);
    expect(r.result?.status, r.stdout).toBe('ADMITTED_NONPRODUCTION');
    expect(r.result.packet).toBe('r0_00');
  });

  it('NEGATIVE CONTROL: rejects the main-tree database name', () => {
    const r = admit(['--packet', 'R0-00', '--env-file', envFile({ ...packetEnv, DATABASE_URL: MAIN_DB, DIRECT_URL: MAIN_DB })]);
    expect(r.status).toBe(2);
    expect(r.result?.reasons, r.stdout).toContain('KF_PROOF_RESOURCE_DATABASE_SHARED');
  });

  it('rejects a shell that exports the main-tree database over a correct worktree .env', () => {
    // dotenv does not override an exported value, so the suite would run on
    // `keyflowos` even though .env names kf_wt_r0_00. The admitter must judge
    // the value the suite will see, and say where it came from.
    const r = admit(['--packet', 'R0-00', '--env-file', envFile(packetEnv)], { DATABASE_URL: MAIN_DB });
    expect(r.status).toBe(2);
    expect(r.result?.reasons, r.stdout).toContain('KF_PROOF_RESOURCE_DATABASE_SHARED');
    expect(r.result.source).toBe('shell');
  });

  it("rejects another packet's database", () => {
    const other = 'postgresql://keyflow:secret@localhost:5432/kf_wt_r0_12';
    const r = admit(['--packet', 'R0-00', '--env-file', envFile({ ...packetEnv, DATABASE_URL: other, DIRECT_URL: other })]);
    expect(r.status).toBe(2);
    expect(r.result?.reasons, r.stdout).toContain('KF_PROOF_RESOURCE_DATABASE_UNSAFE');
  });

  it('rejects Redis index 0, explicit or implied', () => {
    for (const url of ['redis://localhost:6379', 'redis://localhost:6379/0']) {
      const r = admit(['--packet', 'R0-00', '--env-file', envFile({ ...packetEnv, REDIS_URL: url })]);
      expect(r.status, url).toBe(2);
      expect(r.result?.reasons, `${url}: ${r.stdout}`).toContain('KF_PROOF_RESOURCE_REDIS_INDEX_UNSAFE');
    }
  });

  it('rejects a nonlocal database host', () => {
    const remote = 'postgresql://keyflow:secret@db.example.com:5432/kf_wt_r0_00';
    const r = admit(['--packet', 'R0-00', '--env-file', envFile({ ...packetEnv, DATABASE_URL: remote })]);
    expect(r.status).toBe(2);
    expect(r.result?.reasons, r.stdout).toContain('KF_PROOF_RESOURCE_HOST_UNSAFE');
  });

  it('refuses the packet-scoped manifest without --packet, and a malformed packet id', () => {
    const missing = admit(['--manifest', MANIFEST, '--env-file', envFile(packetEnv)]);
    expect(missing.status).toBe(2);
    expect(missing.result?.reasons, missing.stdout).toContain('KF_PROOF_RESOURCE_PACKET_REQUIRED');

    const bad = admit(['--packet', 'not-a-packet', '--env-file', envFile(packetEnv)]);
    expect(bad.status).toBe(2);
    expect(bad.result?.reasons, bad.stdout).toContain('KF_PROOF_RESOURCE_PACKET_INVALID');
  });

  it('never emits resource credentials in its receipt', () => {
    const ok = admit(['--packet', 'R0-00', '--env-file', envFile(packetEnv)]);
    const rejected = admit(['--packet', 'R0-00', '--env-file', envFile(packetEnv)], { DATABASE_URL: MAIN_DB });
    for (const r of [ok, rejected]) {
      expect(r.stdout).toContain('"status"');
      expect(r.stdout).not.toContain('secret');
    }
  });
});

describe('worktree-resources.sh agrees with the admitter (R0-00)', () => {
  function sh(...args: string[]) {
    return spawnSync('bash', [PROVISIONER, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } });
  }

  it('names the same database for a packet as the admitter', () => {
    for (const [id, slug] of [
      ['R0-00-WT-ISOLATION', 'r0_00'],
      ['R0-00', 'r0_00'],
      ['V1-14-PORTAL-LIMITER', 'v1_14'],
    ]) {
      const out = sh('db-name', id);
      expect(out.status, out.stderr).toBe(0);
      expect(out.stdout.trim()).toBe(`kf_wt_${slug}`);
    }
    expect(sh('db-name', 'not-a-packet').status).not.toBe(0);
  });

  it('offers provision, reprovision and release', () => {
    const out = sh('help');
    expect(out.status).toBe(0);
    for (const cmd of ['provision', 'reprovision', 'release']) expect(out.stdout).toContain(cmd);
  });

  it('every CREATE or DROP DATABASE goes through the kf_wt_ name guard', () => {
    // The main-tree database and the other agents' databases share this server.
    // A destructive statement that can be reached with an unchecked name is the
    // one defect this script must not have.
    const src = readFileSync(PROVISIONER, 'utf8');
    const fns = [...src.matchAll(/^(\w+)\(\)\s*\{([\s\S]*?)^\}/gm)];
    const destructive = fns.filter(([, , body]) => /\b(CREATE|DROP) DATABASE\b/.test(body));
    expect(destructive.length, 'no function issues CREATE/DROP DATABASE').toBeGreaterThan(0);
    for (const [, name, body] of destructive) {
      expect(body, `${name}() issues CREATE/DROP DATABASE without require_wt_db`).toMatch(/require_wt_db\b/);
    }
    // ...and nothing outside those functions does.
    const outside = fns.reduce((s, [whole]) => s.replace(whole, ''), src);
    expect(outside).not.toMatch(/\b(CREATE|DROP) DATABASE\b/);
  });
});
