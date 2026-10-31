/**
 * Listen-host selection for the HTTP server (R0-D6-LISTEN-IPV4-FALLBACK).
 *
 * This module is deliberately side-effect-free and Nest-free: it imports only
 * Node builtins, reads nothing at module scope and starts nothing. main.ts
 * calls into it from bootstrap(); main.listen.spec.ts imports it directly.
 * Keeping it apart from main.ts matters because main.ts's module scope loads
 * the repo-root .env through dotenv and pulls in @nestjs/core and @keyflow/db
 * (a pg Pool) — under the unit suite's shared module registry
 * (vitest.unit.config.ts, isolate: false) an import of main.ts would leak a
 * developer's .env into every spec that runs later in the same worker.
 */
import { createServer } from 'net';

/**
 * Hosts the HTTP server tries to bind, in order.
 *
 * LISTEN_HOST, when set, is an operator pin and is the only candidate.
 * Otherwise the dual-stack wildcard '::' comes first so both IPv4 (127.0.0.1)
 * and IPv6 (::1) localhost clients connect — binding only 0.0.0.0 left
 * IPv6-only resolution paths (localhost's AAAA record) refusing connections in
 * waves. Hosts with no IPv6 address family at all reject '::' outright, and
 * 0.0.0.0 is the only wildcard they have, so it is the second candidate.
 *
 * LISTEN_HOST is an IP literal (e.g. 127.0.0.1, 0.0.0.0, ::). A pinned host is
 * never probed or second-guessed: if it cannot be bound, boot fails with the
 * kernel's own error.
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
