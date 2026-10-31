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
 * `kf_wt_<id>` on localhost, on the Redis index the provisioner allocated to
 * that packet. The values it judges are the ones a suite will actually see:
 * the worktree .env, overridden by anything the shell exports (dotenv never
 * overrides an exported value). That is how it catches a shell that still
 * exports the main-tree database.
 *
 * Review repair (SEC-R000-1): binding only the database name let two packets
 * share one Redis index (both admitted) and let a worktree be admitted under
 * another packet's id. Admission is now bound to the provisioner's allocation
 * table and to the KF_WT_PACKET line it writes into .env. (CR-3): a file can
 * no longer supply CI=true to the CI manifest.
 *
 * scripts/worktree-resources.sh provisions those resources. Its database work
 * needs a live Postgres and is proven by the integrating session; the parts
 * pinned here run against fake psql and redis-cli executables.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = join(__dirname, '..', '..', '..', '..', '..');
const ADMITTER = join(REPO, 'scripts', 'proof-admission', 'admit-resources.mjs');
const MANIFEST = join(REPO, 'scripts', 'proof-admission', 'manifests', 'local-worktree-resources.json');
const CI_MANIFEST = join(REPO, 'scripts', 'proof-admission', 'manifests', 'ci-resources.json');
const PROVISIONER = join(REPO, 'scripts', 'worktree-resources.sh');

const OWN_DB = 'postgresql://keyflow:secret@localhost:5432/kf_wt_r0_00';
const MAIN_DB = 'postgresql://keyflow:secret@localhost:5432/keyflowos';
const R0_12_DB = 'postgresql://keyflow:secret@localhost:5432/kf_wt_r0_12';

const packetEnv: Record<string, string> = {
  KF_WT_PACKET: 'r0_00',
  DATABASE_URL: OWN_DB,
  DIRECT_URL: OWN_DB,
  REDIS_URL: 'redis://localhost:6379/3',
};

function tempDir(tag: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), `kf-wt-${tag}-`)));
}

/** A worktree directory holding a .env written the way worktree-resources.sh writes it. */
function worktreeWith(vars: Record<string, string>): { dir: string; envFile: string } {
  const dir = tempDir('env');
  const envFile = join(dir, '.env');
  writeFileSync(
    envFile,
    ['# written by scripts/worktree-resources.sh', ...Object.entries(vars).map(([k, v]) => `${k}=${v}`)].join('\n') + '\n',
  );
  return { dir, envFile };
}

type Row = [slug: string, index: number, worktree: string];

/** The provisioner's allocation table, in its state_put format. */
function stateFile(rows: Row[]): string {
  const file = join(tempDir('state'), 'kf-worktree-resources.tsv');
  writeFileSync(file, rows.map((r) => r.join('\t') + '\n').join(''));
  return file;
}

/**
 * Arguments for R0-00 provisioned on Redis index 3 in its own worktree, plus
 * any other rows. Always an explicit --state-file, so no case reads the real
 * allocation table of this clone.
 */
function provisioned(vars: Record<string, string> = packetEnv, otherRows: Row[] = []): string[] {
  const wt = worktreeWith(vars);
  return ['--env-file', wt.envFile, '--state-file', stateFile([['r0_00', 3, wt.dir], ...otherRows])];
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

async function admitter(): Promise<{
  admitResources: (manifest: unknown, env: Record<string, string>, options?: Record<string, unknown>) => any;
  parseStateFile: (text: string) => Array<{ slug: string; index: number; worktree: string }>;
}> {
  return import(ADMITTER);
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

  it('admits kf_wt_<id> on localhost with its allocated non-zero Redis index, from the worktree .env', () => {
    const r = admit(['--packet', 'R0-00', ...provisioned()]);
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
    const r = admit(['--packet', 'R0-00-WT-ISOLATION', ...provisioned()]);
    expect(r.result?.status, r.stdout).toBe('ADMITTED_NONPRODUCTION');
    expect(r.result.packet).toBe('r0_00');
  });

  it('NEGATIVE CONTROL: rejects the main-tree database name', () => {
    const r = admit(['--packet', 'R0-00', ...provisioned({ ...packetEnv, DATABASE_URL: MAIN_DB, DIRECT_URL: MAIN_DB })]);
    expect(r.status).toBe(2);
    expect(r.result?.reasons, r.stdout).toContain('KF_PROOF_RESOURCE_DATABASE_SHARED');
  });

  it('rejects a shell that exports the main-tree database over a correct worktree .env', () => {
    // dotenv does not override an exported value, so the suite would run on
    // `keyflowos` even though .env names kf_wt_r0_00. The admitter must judge
    // the value the suite will see, and say where it came from.
    const r = admit(['--packet', 'R0-00', ...provisioned()], { DATABASE_URL: MAIN_DB });
    expect(r.status).toBe(2);
    expect(r.result?.reasons, r.stdout).toContain('KF_PROOF_RESOURCE_DATABASE_SHARED');
    expect(r.result.source).toBe('shell');
  });

  it("rejects another packet's database", () => {
    const r = admit(['--packet', 'R0-00', ...provisioned({ ...packetEnv, DATABASE_URL: R0_12_DB, DIRECT_URL: R0_12_DB })]);
    expect(r.status).toBe(2);
    expect(r.result?.reasons, r.stdout).toContain('KF_PROOF_RESOURCE_DATABASE_UNSAFE');
  });

  it('rejects Redis index 0, explicit or implied', () => {
    for (const url of ['redis://localhost:6379', 'redis://localhost:6379/0']) {
      const r = admit(['--packet', 'R0-00', ...provisioned({ ...packetEnv, REDIS_URL: url })]);
      expect(r.status, url).toBe(2);
      expect(r.result?.reasons, `${url}: ${r.stdout}`).toContain('KF_PROOF_RESOURCE_REDIS_INDEX_UNSAFE');
    }
  });

  it('rejects a nonlocal database host', () => {
    const remote = 'postgresql://keyflow:secret@db.example.com:5432/kf_wt_r0_00';
    const r = admit(['--packet', 'R0-00', ...provisioned({ ...packetEnv, DATABASE_URL: remote })]);
    expect(r.status).toBe(2);
    expect(r.result?.reasons, r.stdout).toContain('KF_PROOF_RESOURCE_HOST_UNSAFE');
  });

  it('refuses the packet-scoped manifest without --packet, and a malformed packet id', () => {
    const missing = admit(['--manifest', MANIFEST, ...provisioned()]);
    expect(missing.status).toBe(2);
    expect(missing.result?.reasons, missing.stdout).toContain('KF_PROOF_RESOURCE_PACKET_REQUIRED');

    const bad = admit(['--packet', 'not-a-packet', ...provisioned()]);
    expect(bad.status).toBe(2);
    expect(bad.result?.reasons, bad.stdout).toContain('KF_PROOF_RESOURCE_PACKET_INVALID');
  });

  it('never emits resource credentials in its receipt', () => {
    const ok = admit(['--packet', 'R0-00', ...provisioned()]);
    const rejected = admit(['--packet', 'R0-00', ...provisioned()], { DATABASE_URL: MAIN_DB });
    for (const r of [ok, rejected]) {
      expect(r.stdout).toContain('"status"');
      expect(r.stdout).not.toContain('secret');
    }
  });
});

describe('per-packet admission is bound to the allocation table and the packet marker (R0-00 review SEC-R000-1)', () => {
  it('NEGATIVE CONTROL: two packets on one Redis index are not both admitted', () => {
    // The review's repro: a.env (kf_wt_r0_00, index 3) and b.env (kf_wt_r0_12,
    // index 3). Both used to be ADMITTED, sharing BullMQ queues, caches and
    // rate-limit windows. The provisioner gave R0-12 index 4, so b.env's index
    // 3 is not R0-12's.
    const a = worktreeWith(packetEnv);
    const b = worktreeWith({ KF_WT_PACKET: 'r0_12', DATABASE_URL: R0_12_DB, DIRECT_URL: R0_12_DB, REDIS_URL: 'redis://localhost:6379/3' });
    const state = stateFile([
      ['r0_00', 3, a.dir],
      ['r0_12', 4, b.dir],
    ]);

    const first = admit(['--packet', 'R0-00', '--env-file', a.envFile, '--state-file', state]);
    expect(first.result?.status, first.stdout).toBe('ADMITTED_NONPRODUCTION');

    const second = admit(['--packet', 'R0-12', '--env-file', b.envFile, '--state-file', state]);
    expect(second.status, second.stdout).toBe(2);
    expect(second.result?.reasons).toContain('KF_PROOF_RESOURCE_REDIS_INDEX_FOREIGN');
    expect(second.result.allocatedDbIndex).toBe(4);
  });

  it('a table that gives one index to two packets admits neither', () => {
    const a = worktreeWith(packetEnv);
    const b = worktreeWith({ KF_WT_PACKET: 'r0_12', DATABASE_URL: R0_12_DB, DIRECT_URL: R0_12_DB, REDIS_URL: 'redis://localhost:6379/3' });
    const state = stateFile([
      ['r0_00', 3, a.dir],
      ['r0_12', 3, b.dir],
    ]);
    for (const [packet, env] of [['R0-00', a.envFile], ['R0-12', b.envFile]]) {
      const r = admit(['--packet', packet, '--env-file', env, '--state-file', state]);
      expect(r.status, `${packet}: ${r.stdout}`).toBe(2);
      expect(r.result?.reasons).toContain('KF_PROOF_RESOURCE_REDIS_INDEX_SHARED');
    }
  });

  it("NEGATIVE CONTROL: a worktree is not admitted under another packet's id", () => {
    // R0-00's worktree, judged as R0-12: its .env was written for r0_00.
    const r = admit(['--packet', 'R0-12', ...provisioned()]);
    expect(r.status).toBe(2);
    expect(r.result?.reasons, r.stdout).toContain('KF_PROOF_RESOURCE_PACKET_MISMATCH');
  });

  it("rejects a .env that claims R0-12 in a worktree the table gives to someone else", () => {
    // A copy of R0-12's .env dropped into this worktree: marker, database and
    // index all say R0-12, but the table says R0-12 lives elsewhere.
    const here = worktreeWith({ KF_WT_PACKET: 'r0_12', DATABASE_URL: R0_12_DB, DIRECT_URL: R0_12_DB, REDIS_URL: 'redis://localhost:6379/4' });
    const elsewhere = tempDir('r0-12');
    const state = stateFile([['r0_12', 4, elsewhere]]);
    const r = admit(['--packet', 'R0-12', '--env-file', here.envFile, '--state-file', state]);
    expect(r.status).toBe(2);
    expect(r.result?.reasons, r.stdout).toContain('KF_PROOF_RESOURCE_WORKTREE_MISMATCH');
  });

  it('rejects a hand-written .env without KF_WT_PACKET, and a shell that exports another packet', () => {
    const handWritten = Object.fromEntries(Object.entries(packetEnv).filter(([k]) => k !== 'KF_WT_PACKET'));
    const noMarker = admit(['--packet', 'R0-00', ...provisioned(handWritten)]);
    expect(noMarker.status).toBe(2);
    expect(noMarker.result?.reasons, noMarker.stdout).toContain('KF_PROOF_RESOURCE_PACKET_MISMATCH');

    const shellMarker = admit(['--packet', 'R0-00', ...provisioned()], { KF_WT_PACKET: 'r0_12' });
    expect(shellMarker.status).toBe(2);
    expect(shellMarker.result?.reasons, shellMarker.stdout).toContain('KF_PROOF_RESOURCE_PACKET_MISMATCH');
  });

  it('rejects a packet the table does not hold, and a missing table', () => {
    const wt = worktreeWith(packetEnv);
    const other = admit(['--packet', 'R0-00', '--env-file', wt.envFile, '--state-file', stateFile([['r0_12', 4, wt.dir]])]);
    expect(other.status).toBe(2);
    expect(other.result?.reasons, other.stdout).toContain('KF_PROOF_RESOURCE_NOT_PROVISIONED');

    const missing = admit(['--packet', 'R0-00', '--env-file', wt.envFile, '--state-file', join(tempDir('none'), 'absent.tsv')]);
    expect(missing.status).toBe(2);
    expect(missing.result?.reasons, missing.stdout).toContain('KF_PROOF_RESOURCE_STATE_UNAVAILABLE');
  });

  it('reads the table from KF_WT_STATE_FILE, as the provisioner does', () => {
    const wt = worktreeWith(packetEnv);
    const r = admit(['--packet', 'R0-00', '--env-file', wt.envFile], { KF_WT_STATE_FILE: stateFile([['r0_00', 3, wt.dir]]) });
    expect(r.result?.status, r.stdout).toBe('ADMITTED_NONPRODUCTION');
  });

  it('parses the state_put format: <slug>\\t<index>\\t<worktree>', async () => {
    const { parseStateFile } = await admitter();
    expect(parseStateFile('r0_00\t3\t/w/a\n\nr0_12\t4\t/w/b\n')).toEqual([
      { slug: 'r0_00', index: 3, worktree: '/w/a' },
      { slug: 'r0_12', index: 4, worktree: '/w/b' },
    ]);
    expect(Number.isNaN(parseStateFile('r0_00\tx\t/w/a')[0].index)).toBe(true);
  });
});

describe('CI mode judges only what the runner exported (R0-00 review CR-3)', () => {
  const ciEnv = {
    CI: 'true',
    GITHUB_ACTIONS: 'true',
    DATABASE_URL: 'postgresql://keyflow:keyflow@localhost:5432/keyflowos',
    DIRECT_URL: 'postgresql://keyflow:keyflow@localhost:5432/keyflowos',
    REDIS_URL: 'redis://localhost:6379',
  };

  it('NEGATIVE CONTROL: --env-file cannot supply CI=true to the CI manifest', () => {
    const { envFile } = worktreeWith(ciEnv);
    const r = admit(['--manifest', CI_MANIFEST, '--env-file', envFile]);
    expect(r.status, r.stdout).toBe(2);
    expect(r.result?.status).toBe('REJECTED');
    expect(r.result.reasons).toContain('KF_PROOF_ARGUMENT_INVALID');
  });

  it('the exported environment still admits, as before the packet', () => {
    const r = admit(['--manifest', CI_MANIFEST], ciEnv);
    expect(r.result?.status, r.stdout).toBe('ADMITTED_NONPRODUCTION');
  });

  it('admitResources ignores fileEnv outside per-packet mode, and never reads requiredEnv from it', async () => {
    const { admitResources } = await admitter();
    const ci = JSON.parse(readFileSync(CI_MANIFEST, 'utf8'));
    const notPacket = admitResources(ci, {}, { fileEnv: ciEnv });
    expect(notPacket.reasons).toContain('KF_PROOF_RESOURCE_ENVIRONMENT_UNTRUSTED');

    const local = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    const strict = { ...local, requiredEnv: { CI: 'true' } };
    const packet = admitResources(strict, {}, { packet: 'R0-00', fileEnv: { ...packetEnv, CI: 'true' }, state: [] });
    expect(packet.reasons).toContain('KF_PROOF_RESOURCE_ENVIRONMENT_UNTRUSTED');
  });
});

describe('worktree-resources.sh agrees with the admitter (R0-00)', () => {
  function sh(args: string[], env: Record<string, string> = {}) {
    return spawnSync('bash', [PROVISIONER, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } });
  }

  it('names the same database for a packet as the admitter', () => {
    for (const [id, slug] of [
      ['R0-00-WT-ISOLATION', 'r0_00'],
      ['R0-00', 'r0_00'],
      ['V1-14-PORTAL-LIMITER', 'v1_14'],
    ]) {
      const out = sh(['db-name', id]);
      expect(out.status, out.stderr).toBe(0);
      expect(out.stdout.trim()).toBe(`kf_wt_${slug}`);
    }
    expect(sh(['db-name', 'not-a-packet']).status).not.toBe(0);
  });

  it('offers provision, reprovision and release', () => {
    const out = sh(['help']);
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

  it('FLUSHDB is issued only by flush_owned_index, which checks the owner key first', () => {
    const src = readFileSync(PROVISIONER, 'utf8');
    const fns = [...src.matchAll(/^(\w+)\(\)\s*\{([\s\S]*?)^\}/gm)];
    const flushing = fns.filter(([, , body]) => /\bFLUSHDB\b/.test(body)).map(([, name]) => name);
    expect(flushing).toEqual(['flush_owned_index']);
    const body = fns.find(([, name]) => name === 'flush_owned_index')?.[2] ?? '';
    expect(body.indexOf('REDIS_OWNER_KEY')).toBeGreaterThan(-1);
    expect(body.indexOf('REDIS_OWNER_KEY')).toBeLessThan(body.indexOf('FLUSHDB'));
  });

  describe('against fake psql and redis-cli (no live services)', () => {
    /**
     * redis-cli -u redis://host:port/<index> CMD ...: each index is a directory,
     * each key a file. FLUSHDB is logged. psql logs every statement and answers
     * "1" to the existence probe, so no database is ever built.
     */
    function fakes() {
      const root = tempDir('fakes');
      const bin = join(root, 'bin');
      const redis = join(root, 'redis');
      mkdirSync(bin);
      mkdirSync(redis);
      writeFileSync(
        join(bin, 'redis-cli'),
        [
          '#!/usr/bin/env bash',
          'url=$2; idx=${url##*/}; shift 2',
          'd="$KF_FAKE_REDIS/$idx"; mkdir -p "$d"',
          'cmd=$1; shift',
          'case $cmd in',
          '  DBSIZE) ls -1A "$d" | wc -l | tr -d " " ;;',
          '  GET) if [[ -f "$d/$1" ]]; then cat "$d/$1"; echo; else echo; fi ;;',
          '  SET) if [[ ${3:-} == NX && -f "$d/$1" ]]; then echo; else printf %s "$2" >"$d/$1"; echo OK; fi ;;',
          '  FLUSHDB) rm -f "$d"/*; echo "FLUSHDB $idx" >>"$KF_FAKE_REDIS/log"; echo OK ;;',
          '  *) echo "fake redis-cli: $cmd" >&2; exit 1 ;;',
          'esac',
        ].join('\n') + '\n',
      );
      writeFileSync(
        join(bin, 'psql'),
        [
          '#!/usr/bin/env bash',
          "sql=''",
          'while [[ $# -gt 0 ]]; do case $1 in -c) sql=$2; shift 2 ;; *) shift ;; esac; done',
          'echo "$sql" >>"$KF_FAKE_PG_LOG"',
          'case $sql in "SELECT 1 FROM pg_database"*) echo 1 ;; esac',
        ].join('\n') + '\n',
      );
      chmodSync(join(bin, 'redis-cli'), 0o755);
      chmodSync(join(bin, 'psql'), 0o755);

      const worktree = tempDir('wt');
      spawnSync('git', ['init', '-q', worktree], { env: { PATH: process.env.PATH ?? '', HOME: root } });
      writeFileSync(join(worktree, '.gitignore'), '.env\n');

      const state = join(root, 'kf-worktree-resources.tsv');
      writeFileSync(state, '');
      const env = {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        HOME: root,
        KF_WT_STATE_FILE: state,
        KF_WT_REDIS_INDEXES: '1 2 3 4',
        KF_FAKE_REDIS: redis,
        KF_FAKE_PG_LOG: join(root, 'psql.log'),
      };
      const key = (idx: number) => join(redis, String(idx), 'kf_wt:owner');
      const put = (idx: number, name: string, value: string) => {
        mkdirSync(join(redis, String(idx)), { recursive: true });
        writeFileSync(join(redis, String(idx), name), value);
      };
      const flushed = () => (existsSync(join(redis, 'log')) ? readFileSync(join(redis, 'log'), 'utf8') : '');
      return { env, state, worktree, key, put, flushed };
    }

    it('provision skips claimed and non-empty indexes, claims one with the owner key, and the admitter admits the result', () => {
      const f = fakes();
      f.put(1, 'kf_wt:owner', 'z9_99'); // another allocator's claim
      f.put(2, 'bull:queue:id', '7'); // in use by someone who sets no claim

      const out = sh(['provision', 'R0-00', f.worktree], f.env);
      expect(out.status, out.stderr).toBe(0);
      expect(out.stdout).toContain('redis_index: 3');
      expect(readFileSync(f.key(3), 'utf8')).toBe('r0_00');
      expect(readFileSync(f.state, 'utf8')).toBe(`r0_00\t3\t${f.worktree}\n`);

      // The .env the provisioner wrote, judged against the table it wrote.
      const r = admit(['--packet', 'R0-00', '--env-file', join(f.worktree, '.env'), '--state-file', f.state]);
      expect(r.result?.status, r.stdout).toBe('ADMITTED_NONPRODUCTION');
      expect(r.result.resources.find((x: any) => x.env === 'REDIS_URL').dbIndex).toBe(3);
    });

    it("release never flushes an index whose owner key names another packet", () => {
      const f = fakes();
      const provision = sh(['provision', 'R0-00', f.worktree], f.env);
      expect(provision.status, provision.stderr).toBe(0);
      expect(provision.stdout).toContain('redis_index: 1');
      // A stale or hand-written row puts R0-12 on R0-00's index.
      writeFileSync(f.state, readFileSync(f.state, 'utf8') + `r0_12\t1\t/elsewhere\n`);

      const other = sh(['release', 'R0-12'], f.env);
      expect(other.status, other.stderr).toBe(0);
      expect(other.stderr).toContain('not flushing redis index 1');
      expect(f.flushed()).toBe('');
      expect(readFileSync(f.key(1), 'utf8')).toBe('r0_00');

      const own = sh(['release', 'R0-00'], f.env);
      expect(own.status, own.stderr).toBe(0);
      expect(f.flushed()).toBe('FLUSHDB 1\n');
      expect(existsSync(f.key(1))).toBe(false);
      expect(existsSync(join(f.worktree, '.env'))).toBe(false);
      expect(readFileSync(f.state, 'utf8')).toBe('');
    });
  });
});
