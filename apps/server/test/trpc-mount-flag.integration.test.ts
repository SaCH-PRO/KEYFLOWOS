/**
 * D-68 (owner ruling, 2026-11-03): the tRPC endpoint is unmounted by default.
 * The server serves /trpc only when TRPC_ENABLED=1.
 *
 * WHY. TrpcModule mounts @keyflow/api's appRouter as Express middleware. The
 * router has no web consumer, it runs outside the Nest interceptors that fill
 * the tenant context, and it carries known holes (V1-26: crm.contactDetail reads
 * a contact and its events, notes and tasks without CRM record visibility,
 * pinned as it.fails in packages/api/src/routers/crm.contact-detail.spec.ts).
 * Before D-68 the module was imported unconditionally, so the handler sat on
 * the exact path /trpc in every deployment (GET /trpc answered tRPC's own
 * error) and the procedures were one mount-path change away from live. The
 * public-surface ledger (src/core/auth/public-surface.spec.ts) counts
 * controller handlers only and cannot see a middleware mount.
 *
 * WHAT THIS MEASURES. The pattern of app-module-boots.integration.test.ts: the
 * BUILT server, dist/main.js, spawned as a child process, so the real AppModule
 * graph decides what is mounted. Two boots:
 *
 *   - no TRPC_ENABLED: every /trpc request (the bare path and a procedure path,
 *     GET and POST) answers the same 404 an unknown route answers, and the boot
 *     log never reports TrpcModule's dependencies initialized (the module, and
 *     so its providers and its middleware, is not in the application);
 *   - TRPC_ENABLED=1 (control): TrpcModule initializes and GET /trpc reaches
 *     tRPC's own handler, so the first boot's 404s are the flag, not a broken
 *     probe.
 *
 * The spawned server gets an allow-listed environment, not a copy of
 * process.env, so no runner variable (TRPC_ENABLED included) and no provider
 * key reaches it. It reads no fixture rows and writes none.
 *
 * Runs against dist/: build apps/server first (CI's test job does). Not skipped
 * when dist is missing, for the reason app-module-boots gives.
 */
import path from 'node:path';
import net from 'node:net';
import { existsSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const SERVER_DIR = path.resolve(__dirname, '..');
const ENTRY = path.join(SERVER_DIR, 'dist', 'main.js');

/** Idle, not total: a slow boot keeps talking, a stuck one goes silent. */
const IDLE_MS = 45_000;
const HARD_CAP_MS = 300_000;

/** Test-only HS256 secret handed to the spawned server. Not a real secret. */
const JWT_SECRET = 'd68-trpc-mount-test-secret-not-a-real-secret-0123456789';

/** A tRPC procedure path: the V1-26 procedure whose visibility hole is latent. */
const PROCEDURE = '/trpc/crm.contactDetail';
const PROCEDURE_QUERY = `${PROCEDURE}?input=${encodeURIComponent(JSON.stringify({ businessId: 'd68-biz', id: 'd68-contact' }))}`;

interface Booted {
  child: ChildProcess | null;
  baseUrl: string | null;
  diagnosis: string | null;
  log: string;
  exitCode?: number | null;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

async function boot(extraEnv: Record<string, string>): Promise<Booted> {
  const state: Booted = { child: null, baseUrl: null, diagnosis: null, log: '' };
  if (!existsSync(ENTRY)) {
    state.diagnosis = 'dist/main.js is missing: run `pnpm build` in apps/server first';
    return state;
  }
  const port = await freePort();
  const env: Record<string, string> = {
    // allow-list, NOT a copy of process.env: TRPC_ENABLED and provider keys
    // from the runner's shell cannot leak in
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    DATABASE_URL: process.env.DATABASE_URL ?? '',
    DIRECT_URL: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
    REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
    NODE_ENV: 'test',
    PORT: String(port),
    AI_DISABLED: '1',
    KEY_DISABLED: '1',
    DISABLE_SCHEDULERS: '1',
    SUPABASE_JWT_SECRET: JWT_SECRET,
    RATE_LIMIT_MAX_REQUESTS: '100000',
    ...extraEnv,
  };

  await new Promise<void>((resolve) => {
    const child = spawn(process.execPath, [ENTRY], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
    state.child = child;
    let settled = false;
    let idle: NodeJS.Timeout;
    const finish = (diagnosis: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(idle);
      clearTimeout(hardCap);
      clearInterval(poll);
      state.diagnosis = diagnosis;
      if (diagnosis) child.kill('SIGKILL');
      resolve();
    };
    const armIdle = () => {
      clearTimeout(idle);
      idle = setTimeout(() => finish(`no output for ${IDLE_MS}ms: the boot is stuck, not slow`), IDLE_MS);
    };
    armIdle();
    const hardCap = setTimeout(() => finish(`never became ready within ${HARD_CAP_MS}ms`), HARD_CAP_MS);

    const read = (buf: Buffer) => {
      armIdle();
      state.log += stripAnsi(buf.toString());
      const failure = state.log.match(
        /(UndefinedDependencyException|Nest can't resolve dependencies of the [^\n]+|ERROR \[ExceptionHandler\][^\n]+|EAFNOSUPPORT[^\n]+|EADDRINUSE[^\n]+)/,
      );
      if (failure) finish(failure[0]);
    };
    child.stdout!.on('data', read);
    child.stderr!.on('data', read);
    child.on('error', (e) => finish(`spawn failed: ${e.message}`));
    child.on('exit', (code) => {
      state.exitCode = code;
      finish(`exited with code ${code} before serving`);
    });

    const candidate = `http://127.0.0.1:${port}`;
    const poll = setInterval(() => {
      fetch(`${candidate}/readyz`)
        .then((res) => {
          if (res.status === 200) {
            state.baseUrl = candidate;
            finish(null);
          }
        })
        .catch(() => {
          /* not listening yet */
        });
    }, 500);
  });
  return state;
}

async function stop(s: Booted | undefined) {
  const child = s?.child;
  if (!child || s.exitCode !== undefined) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 8_000);
    child.once('exit', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

function serving(s: Booted): string {
  if (!s.baseUrl) {
    throw new Error(
      `the built server is not serving (${s.diagnosis ?? 'not started'})\n` +
        s.log.split('\n').slice(-8).join('\n'),
    );
  }
  return s.baseUrl;
}

interface Answer {
  status: number;
  body: unknown;
}

async function send(base: string, method: 'GET' | 'POST', route: string): Promise<Answer> {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
    body: method === 'POST' ? JSON.stringify({ businessId: 'd68-biz', id: 'd68-contact' }) : undefined,
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body };
}

/**
 * The 404 body with what legitimately differs between two requests removed:
 * the time, the correlation id, and the request path itself.
 */
function shapeOf(a: Answer, route: string): unknown {
  if (!a.body || typeof a.body !== 'object') return a.body;
  const pathOnly = route.split('?')[0];
  const json = JSON.stringify(a.body, (k, v) => (k === 'timestamp' || k === 'correlationId' ? undefined : v));
  return JSON.parse(json.split(route).join('<route>').split(pathOnly).join('<route>'));
}

const TRPC_INIT = /TrpcModule dependencies initialized/;

describe('D-68: /trpc is not mounted unless TRPC_ENABLED=1 (built server)', () => {
  let off: Booted | undefined;
  let on: Booted | undefined;

  beforeAll(async () => {
    off = await boot({});
    // A second process, booted only after the first is serving, so the two
    // boots never contend for the same CPU budget at once.
    on = await boot({ TRPC_ENABLED: '1' });
  }, 2 * (HARD_CAP_MS + 30_000));

  afterAll(async () => {
    await stop(off);
    await stop(on);
  }, 30_000);

  it('dist exists: build before running this', () => {
    expect(
      existsSync(ENTRY),
      'dist/main.js is missing, so the mount was never measured. Locally: `pnpm build` in apps/server. ' +
        'This is a BUILD-ORDER failure, not a tRPC one.',
    ).toBe(true);
  });

  describe('no TRPC_ENABLED (the default)', () => {
    it('[D-68 RED-BEFORE] TrpcModule is not in the application: its dependencies are never initialized', () => {
      serving(off!);
      const line = off!.log.split('\n').find((l) => TRPC_INIT.test(l)) ?? null;
      expect(
        line,
        'TrpcModule was instantiated without TRPC_ENABLED=1, so its middleware and providers are in the default app',
      ).toBeNull();
    });

    it('[D-68 RED-BEFORE] GET and POST /trpc answer the 404 an unknown route answers, not tRPC', async () => {
      const base = serving(off!);
      for (const method of ['GET', 'POST'] as const) {
        const unknown = await send(base, method, '/d68-no-such-route');
        const trpc = await send(base, method, '/trpc');
        expect(unknown.status, `${method} unknown route`).toBe(404);
        expect(
          { status: trpc.status, shape: shapeOf(trpc, '/trpc') },
          `${method} /trpc reached a handler; with TRPC_ENABLED unset it must be indistinguishable from an unknown route`,
        ).toEqual({ status: 404, shape: shapeOf(unknown, '/d68-no-such-route') });
      }
    });

    it('GET and POST /trpc/crm.contactDetail answer the 404 an unknown route answers', async () => {
      const base = serving(off!);
      const cases: Array<['GET' | 'POST', string]> = [
        ['GET', PROCEDURE_QUERY],
        ['POST', PROCEDURE],
      ];
      for (const [method, route] of cases) {
        const unknownRoute = route.replace('/trpc/', '/d68-no-such-route/');
        const unknown = await send(base, method, unknownRoute);
        const trpc = await send(base, method, route);
        expect(unknown.status, `${method} unknown route`).toBe(404);
        expect(
          { status: trpc.status, shape: shapeOf(trpc, route) },
          `${method} ${route} is not answered like an unknown route`,
        ).toEqual({ status: 404, shape: shapeOf(unknown, unknownRoute) });
      }
    });
  });

  describe('TRPC_ENABLED=1 (control)', () => {
    it('TrpcModule is in the application: its dependencies are initialized', () => {
      serving(on!);
      const line = on!.log.split('\n').find((l) => TRPC_INIT.test(l)) ?? null;
      expect(line, 'TRPC_ENABLED=1 did not bring TrpcModule into the application').not.toBeNull();
    });

    it("GET /trpc reaches tRPC's own handler, which no unknown route does", async () => {
      const base = serving(on!);
      const trpc = await send(base, 'GET', '/trpc');
      const unknown = await send(base, 'GET', '/d68-no-such-route');
      const message = (trpc.body as { error?: { message?: string } } | null)?.error?.message ?? '';
      expect(message, `GET /trpc with TRPC_ENABLED=1 answered ${JSON.stringify(trpc.body)}`).toMatch(/procedure/);
      expect(shapeOf(trpc, '/trpc')).not.toEqual(shapeOf(unknown, '/d68-no-such-route'));
    });
  });
});
