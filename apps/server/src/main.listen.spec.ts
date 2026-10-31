/**
 * R0-D6-LISTEN-IPV4-FALLBACK — pure spec for the listen-host selection in main.ts.
 *
 * Journey harness defect D6: `app.listen(port, '::')` dies with
 * `listen EAFNOSUPPORT: address family not supported :::<port>` on hosts whose
 * kernel has no IPv6 at all (several CI sandboxes and containers), AFTER Nest
 * has already logged "Nest application successfully started". The boot gate in
 * app-module-boots.integration.test.ts stops at that line and never notices;
 * the Release 0 journey has to talk to the port, so it currently needs a
 * `--require` shim that rewrites '::' to '0.0.0.0'.
 *
 * The contract pinned here (no Nest — the app is a stub, the address-family
 * probe is injected):
 *   - LISTEN_HOST set   -> that host, and only that host (an operator pin is
 *                          never probed or second-guessed, even on EAFNOSUPPORT);
 *   - LISTEN_HOST unset -> '::' first, so dual-stack hosts keep serving both
 *                          127.0.0.1 and ::1 exactly as before;
 *   - no IPv6 address family (probe says so, or '::' rejects with
 *     EAFNOSUPPORT) -> one retry on '0.0.0.0';
 *   - any other error, on any host -> rethrown untouched, no retry.
 *
 * Importing './main' must not boot the server: bootstrap() only runs when
 * main.js is the process entry point.
 */
import net from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { listenWithIpv4Fallback, probeAddressFamily, resolveListenHosts } from './main';

function errnoError(code: string, message = `listen ${code}`): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  err.code = code;
  err.syscall = 'listen';
  return err;
}

/**
 * Stub for the only surface of INestApplication the helper touches. `outcomes`
 * maps host -> error to reject with; a host absent from the map resolves.
 */
function fakeApp(outcomes: Record<string, Error> = {}) {
  const listen = vi.fn(async (_port: number, host: string) => {
    const err = outcomes[host];
    if (err) throw err;
    return {};
  });
  return { listen };
}

/** Probe stub: `unsupported` lists the hosts whose address family is missing. */
function fakeProbe(unsupported: string[] = []) {
  return vi.fn(async (host: string) => !unsupported.includes(host));
}

const PORT = 43110;
const NO_ENV = {} as NodeJS.ProcessEnv;

describe('resolveListenHosts', () => {
  it('uses LISTEN_HOST, and only LISTEN_HOST, when it is set', () => {
    expect(resolveListenHosts({ LISTEN_HOST: '127.0.0.1' } as NodeJS.ProcessEnv)).toEqual(['127.0.0.1']);
  });

  it('trims LISTEN_HOST', () => {
    expect(resolveListenHosts({ LISTEN_HOST: '  0.0.0.0  ' } as NodeJS.ProcessEnv)).toEqual(['0.0.0.0']);
  });

  it('tries the dual-stack wildcard first, then IPv4, when LISTEN_HOST is unset', () => {
    expect(resolveListenHosts(NO_ENV)).toEqual(['::', '0.0.0.0']);
  });

  it('treats a blank LISTEN_HOST as unset', () => {
    expect(resolveListenHosts({ LISTEN_HOST: '   ' } as NodeJS.ProcessEnv)).toEqual(['::', '0.0.0.0']);
  });
});

describe('listenWithIpv4Fallback', () => {
  it('binds LISTEN_HOST when it is set, without probing and without trying anything else', async () => {
    const app = fakeApp();
    const log = vi.fn();
    const probe = fakeProbe();

    const bound = await listenWithIpv4Fallback(app, PORT, { env: { LISTEN_HOST: '127.0.0.1' } as NodeJS.ProcessEnv, log, probe });

    expect(bound).toBe('127.0.0.1');
    expect(app.listen).toHaveBeenCalledTimes(1);
    expect(app.listen).toHaveBeenCalledWith(PORT, '127.0.0.1');
    expect(probe).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("binds '::' first when LISTEN_HOST is unset and the host has IPv6", async () => {
    const app = fakeApp();
    const log = vi.fn();
    const probe = fakeProbe();

    const bound = await listenWithIpv4Fallback(app, PORT, { env: NO_ENV, log, probe });

    expect(bound).toBe('::');
    expect(app.listen).toHaveBeenCalledTimes(1);
    expect(app.listen).toHaveBeenCalledWith(PORT, '::');
    expect(probe.mock.calls).toEqual([['::']]);
    expect(log).not.toHaveBeenCalled();
  });

  it("skips straight to '0.0.0.0' when the probe reports no IPv6 address family", async () => {
    // The probe exists so that app.listen(port, '::') is never attempted on an
    // IPv6-less host: Nest logs that rejection as an ERROR line itself.
    const app = fakeApp();
    const log = vi.fn();
    const probe = fakeProbe(['::']);

    const bound = await listenWithIpv4Fallback(app, PORT, { env: NO_ENV, log, probe });

    expect(bound).toBe('0.0.0.0');
    expect(app.listen).toHaveBeenCalledTimes(1);
    expect(app.listen).toHaveBeenCalledWith(PORT, '0.0.0.0');
    expect(probe.mock.calls).toEqual([['::']]);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("retries on '0.0.0.0' when the probe passed but '::' still rejects with EAFNOSUPPORT", async () => {
    const app = fakeApp({ '::': errnoError('EAFNOSUPPORT', 'listen EAFNOSUPPORT: address family not supported :::43110') });
    const log = vi.fn();
    const probe = fakeProbe();

    const bound = await listenWithIpv4Fallback(app, PORT, { env: NO_ENV, log, probe });

    expect(bound).toBe('0.0.0.0');
    expect(app.listen).toHaveBeenCalledTimes(2);
    expect(app.listen).toHaveBeenNthCalledWith(1, PORT, '::');
    expect(app.listen).toHaveBeenNthCalledWith(2, PORT, '0.0.0.0');
    // the last candidate is never probed: there is nothing to fall back to
    expect(probe.mock.calls).toEqual([['::']]);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('announces the fallback without echoing the raw errno token', async () => {
    // release0-journey.integration.test.ts treats any `EAFNOSUPPORT…` line in
    // the spawned server's output as a boot failure and kills the process. The
    // notice has to be readable by an operator AND invisible to that regex.
    const app = fakeApp();
    const log = vi.fn();

    await listenWithIpv4Fallback(app, PORT, { env: NO_ENV, log, probe: fakeProbe(['::']) });

    expect(log).toHaveBeenCalledTimes(1);
    const notice = String(log.mock.calls[0][0]);
    expect(notice).toContain('0.0.0.0');
    expect(notice).toContain(String(PORT));
    expect(notice).not.toMatch(/EAFNOSUPPORT|EADDRINUSE/);
  });

  it("rethrows a non-EAFNOSUPPORT error on '::' without retrying", async () => {
    const app = fakeApp({ '::': errnoError('EADDRINUSE', 'listen EADDRINUSE: address already in use :::43110') });
    const log = vi.fn();

    await expect(listenWithIpv4Fallback(app, PORT, { env: NO_ENV, log, probe: fakeProbe() })).rejects.toMatchObject({
      code: 'EADDRINUSE',
    });
    expect(app.listen).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });

  it('rethrows an error that carries no errno code', async () => {
    const boom = new Error('socket exploded');
    const app = fakeApp({ '::': boom });

    await expect(listenWithIpv4Fallback(app, PORT, { env: NO_ENV, log: vi.fn(), probe: fakeProbe() })).rejects.toBe(boom);
    expect(app.listen).toHaveBeenCalledTimes(1);
  });

  it('rethrows when the IPv4 fallback fails too, and does not loop', async () => {
    const app = fakeApp({
      '0.0.0.0': errnoError('EADDRINUSE', 'listen EADDRINUSE: address already in use 0.0.0.0:43110'),
    });

    await expect(
      listenWithIpv4Fallback(app, PORT, { env: NO_ENV, log: vi.fn(), probe: fakeProbe(['::']) }),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect(app.listen).toHaveBeenCalledTimes(1);
    expect(app.listen).toHaveBeenCalledWith(PORT, '0.0.0.0');
  });

  it("rethrows EAFNOSUPPORT when it is the last candidate's error", async () => {
    const app = fakeApp({
      '::': errnoError('EAFNOSUPPORT'),
      '0.0.0.0': errnoError('EAFNOSUPPORT'),
    });

    await expect(
      listenWithIpv4Fallback(app, PORT, { env: NO_ENV, log: vi.fn(), probe: fakeProbe() }),
    ).rejects.toMatchObject({ code: 'EAFNOSUPPORT' });
    expect(app.listen).toHaveBeenCalledTimes(2);
  });

  it("does not fall back when the operator pinned LISTEN_HOST='::' and it is unsupported", async () => {
    const app = fakeApp({ '::': errnoError('EAFNOSUPPORT') });
    const log = vi.fn();
    const probe = fakeProbe(['::']);

    await expect(
      listenWithIpv4Fallback(app, PORT, { env: { LISTEN_HOST: '::' } as NodeJS.ProcessEnv, log, probe }),
    ).rejects.toMatchObject({ code: 'EAFNOSUPPORT' });
    expect(app.listen).toHaveBeenCalledTimes(1);
    expect(probe).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('defaults the env to process.env, the logger to console.warn and the probe to the real one', async () => {
    // Pinned host => no probe runs, so this stays host-independent.
    const previous = process.env.LISTEN_HOST;
    process.env.LISTEN_HOST = '127.0.0.1';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const app = fakeApp();
      await expect(listenWithIpv4Fallback(app, PORT)).resolves.toBe('127.0.0.1');
      expect(app.listen).toHaveBeenCalledWith(PORT, '127.0.0.1');
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      if (previous === undefined) delete process.env.LISTEN_HOST;
      else process.env.LISTEN_HOST = previous;
    }
  });
});

describe('probeAddressFamily', () => {
  // Real ephemeral sockets on loopback/wildcard only — no fixed port, no network.
  it("reports IPv4 as supported ('0.0.0.0' and 127.0.0.1)", async () => {
    await expect(probeAddressFamily('0.0.0.0')).resolves.toBe(true);
    await expect(probeAddressFamily('127.0.0.1')).resolves.toBe(true);
  });

  it('leaves every non-address-family error to the real listen (reports supported)', async () => {
    // TEST-NET-3 is not a local address: bind fails with EADDRNOTAVAIL, which
    // is not the probe's question, so the real listen gets to report it.
    await expect(probeAddressFamily('203.0.113.1')).resolves.toBe(true);
  });

  it("answers for '::' exactly what the kernel answers", async () => {
    // Host-dependent by nature: pin the probe to the kernel's own verdict so
    // the spec passes on IPv6 and IPv6-less hosts alike while still proving
    // the probe reads the real address-family support.
    const kernelSaysSupported = await new Promise<boolean>((done) => {
      const srv = net.createServer();
      srv.unref();
      srv.once('error', (err: NodeJS.ErrnoException) => done(err.code !== 'EAFNOSUPPORT'));
      srv.listen(0, '::', () => srv.close(() => done(true)));
    });

    await expect(probeAddressFamily('::')).resolves.toBe(kernelSaysSupported);
  });
});
