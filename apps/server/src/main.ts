import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'path';
import { createServer } from 'net';
// In monorepo .env lives at repo root; cwd is apps/server when running directly
config({ path: resolve(process.cwd(), '../../.env') });
import { NestFactory } from '@nestjs/core';
import { configureNestApp } from './app-bootstrap';
import { ensureValidServerEnv, assertNoDevAuthBypass } from './core/config/env';
import { getReleaseVersion } from '@keyflow/shared/release-version';
import { setTenantContextProvider } from '@keyflow/db';
import { getCurrentBusinessId } from './core/tenant/tenant-context';

/**
 * Hosts the HTTP server tries to bind, in order.
 *
 * LISTEN_HOST, when set, is an operator pin and is the only candidate.
 * Otherwise the dual-stack wildcard '::' comes first so both IPv4 (127.0.0.1)
 * and IPv6 (::1) localhost clients connect — binding only 0.0.0.0 left
 * IPv6-only resolution paths (localhost's AAAA record) refusing connections in
 * waves. Hosts with no IPv6 address family at all reject '::' outright, and
 * 0.0.0.0 is the only wildcard they have, so it is the second candidate.
 */
export function resolveListenHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const pinned = (env.LISTEN_HOST ?? '').trim();
  if (pinned) return [pinned];
  return ['::', '0.0.0.0'];
}

/** The one slice of INestApplication the listen helper touches. */
export interface ListenableApp {
  listen(port: number, host: string): Promise<unknown>;
}

function isAddressFamilyUnsupported(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === 'EAFNOSUPPORT';
}

/** Answers one question: does this kernel support the address family of `host`? */
export type AddressFamilyProbe = (host: string) => Promise<boolean>;

/**
 * Bind an ephemeral port on `host` and release it at once. Resolves false only
 * on EAFNOSUPPORT ("address family not supported" — the kernel has no IPv6);
 * every other outcome, bound or any other errno (EADDRNOTAVAIL, EACCES, …),
 * resolves true so the real listen reports the real error on the real port.
 *
 * Why probe instead of just retrying after app.listen rejects: Nest logs the
 * rejection itself as `ERROR [NestApplication] Error: listen EAFNOSUPPORT …`
 * before the retry can run, which turns every healthy boot on an IPv6-less
 * host into one that prints an ERROR line — and
 * release0-journey.integration.test.ts reads `EAFNOSUPPORT…` in the spawned
 * server's output as a boot failure.
 */
export function probeAddressFamily(host: string): Promise<boolean> {
  return new Promise((done) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', (err) => done(!isAddressFamilyUnsupported(err)));
    probe.listen(0, host, () => probe.close(() => done(true)));
  });
}

export interface ListenWithFallbackOptions {
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
  probe?: AddressFamilyProbe;
}

/**
 * Bind the server on the first host from resolveListenHosts that the kernel
 * accepts, and resolve with the host actually bound.
 *
 * A candidate is skipped only when the kernel has no address family for it:
 * the probe says so up front, and — belt and braces — an EAFNOSUPPORT
 * rejection from app.listen itself moves on too. The Release 0 journey harness
 * hit exactly that on IPv6-less CI sandboxes: Nest had already logged "Nest
 * application successfully started" and the process then never served a
 * request. Any other error (EADDRINUSE, EACCES, …) is rethrown untouched, and
 * a pinned LISTEN_HOST is never probed or second-guessed.
 *
 * The notice deliberately does not repeat the raw errno token (see
 * probeAddressFamily).
 */
export async function listenWithIpv4Fallback(
  app: ListenableApp,
  port: number,
  { env = process.env, log = (message) => console.warn(message), probe = probeAddressFamily }: ListenWithFallbackOptions = {},
): Promise<string> {
  const hosts = resolveListenHosts(env);
  for (let i = 0; i < hosts.length; i++) {
    const host = hosts[i];
    const next = hosts[i + 1];
    const fallBack = () =>
      log(`[boot] this host has no IPv6 address family — cannot bind [${host}]:${port}; binding ${next}:${port} instead`);
    if (next !== undefined && !(await probe(host))) {
      fallBack();
      continue;
    }
    try {
      await app.listen(port, host);
      return host;
    } catch (err) {
      if (next === undefined || !isAddressFamilyUnsupported(err)) throw err;
      fallBack();
    }
  }
  // resolveListenHosts never returns an empty list: the loop above either
  // returned the bound host or rethrew the last error.
  throw new Error('listenWithIpv4Fallback: no listen host candidates');
}

async function bootstrap() {
  // Fail fast on missing/malformed env. Prints a single, readable list and
  // exits non-zero before NestFactory tries to initialize anything.
  ensureValidServerEnv(process.env);

  // The KEYFLOW_DEV_AUTH_BYPASS escape hatch was removed in the Tier 2 auth
  // hardening pass. If anyone still has it set in their env, hard-fail at
  // boot in EVERY environment so they don't silently expect dev auto-login
  // and end up with a half-authenticated session instead.
  assertNoDevAuthBypass(process.env);

  // When email verification is required, signup absolutely cannot work without
  // both the Supabase service-role key (admin createUser / generateLink) and
  // the Resend API key (actual email delivery). Fail fast at boot rather than
  // at first signup attempt.
  const verificationFlag = (process.env.AUTH_REQUIRE_EMAIL_VERIFICATION || '').trim().toLowerCase();
  const verificationRequired =
    verificationFlag === 'true' ||
    verificationFlag === '1' ||
    (verificationFlag === '' && process.env.NODE_ENV === 'production');
  if (verificationRequired) {
    const missing: string[] = [];
    if (!(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()) missing.push('SUPABASE_SERVICE_ROLE_KEY');
    if (!(process.env.RESEND_API_KEY || '').trim()) missing.push('RESEND_API_KEY');
    if (!(process.env.EMAIL_FROM_ADDRESS || '').trim()) missing.push('EMAIL_FROM_ADDRESS');
    if (missing.length) {
      console.error(
        `[FATAL] AUTH_REQUIRE_EMAIL_VERIFICATION is on but required env vars are missing: ${missing.join(', ')}. Refusing to start.`,
      );
      process.exit(1);
    }
  } else if (!(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()) {
    // Even with verification disabled (auto-confirm dev mode), signup still
    // requires the Supabase service-role key for admin createUser. Warn loudly
    // at boot so devs aren't surprised by a runtime "server_misconfigured"
    // response on their first signup attempt.
    console.warn(
      '[WARN] SUPABASE_SERVICE_ROLE_KEY is not set. POST /identity/signup will return server_misconfigured until this is configured.',
    );
  }

  const { AppModule } = await import('./app.module');
  // Install the tenant context provider BEFORE the app starts serving.
  //
  // packages/db ships a Prisma extension that injects `where: { businessId }`
  // into every query on 47 tenant-scoped models. It has been applied to the
  // client since it was written and has never once fired, because
  // tenantOperationAllowed() needs an active businessId and this function —
  // the only thing that supplies one — was called from a test file and nowhere
  // else. A complete isolation mechanism, switched off.
  //
  // It is defence in depth, not the primary control: every query should still
  // scope itself. But three cross-tenant leaks were found in this codebase in a
  // single afternoon, and this is the layer that would have caught all three.
  setTenantContextProvider({ getCurrentBusinessId });

  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureNestApp(app);

  // Graceful shutdown: on SIGTERM/SIGINT finish in-flight requests,
  // close DB connections, and flush logs before exiting.
  app.enableShutdownHooks();

  const port = Number(process.env.PORT) || 3001;
  const host = await listenWithIpv4Fallback(app, port);
  const version = await getReleaseVersion();

  console.log(
    `[boot] API ready on http://localhost:${port} (host=${host}, commit=${version.short}, env=${process.env.NODE_ENV || 'development'})`,
  );
  console.log(`[boot] Health: GET /healthz  Readiness: GET /readyz`);

  // Global uncaught-exception safety net: log and exit cleanly so the
  // process manager (Docker, systemd, PM2) can restart us.
  process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught exception:', err);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] Unhandled rejection:', reason);
    process.exit(1);
  });
}

// Boot only when main.js is the process entry point — `node dist/main.js`,
// which is what the Dockerfile, render.yaml, CI and package.json all run.
// Importing this module (main.listen.spec.ts does, to exercise the listen
// helper above) must not start a server.
if (require.main === module) {
  bootstrap();
}
