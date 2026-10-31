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
 * The contract pinned here (no Nest, no sockets — the app is a stub):
 *   - LISTEN_HOST set   -> that host, and only that host (an operator pin is
 *                          never second-guessed, even on EAFNOSUPPORT);
 *   - LISTEN_HOST unset -> '::' first, so dual-stack hosts keep serving both
 *                          127.0.0.1 and ::1 exactly as before;
 *   - EAFNOSUPPORT on '::' -> one retry on '0.0.0.0';
 *   - any other error, on any host -> rethrown untouched, no retry.
 *
 * Importing './main' must not boot the server: bootstrap() only runs when
 * main.js is the process entry point.
 */
import { describe, expect, it, vi } from 'vitest';
import { listenWithIpv4Fallback, resolveListenHosts } from './main';

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

const PORT = 43110;

describe('resolveListenHosts', () => {
  it('uses LISTEN_HOST, and only LISTEN_HOST, when it is set', () => {
    expect(resolveListenHosts({ LISTEN_HOST: '127.0.0.1' } as NodeJS.ProcessEnv)).toEqual(['127.0.0.1']);
  });

  it('trims LISTEN_HOST', () => {
    expect(resolveListenHosts({ LISTEN_HOST: '  0.0.0.0  ' } as NodeJS.ProcessEnv)).toEqual(['0.0.0.0']);
  });

  it('tries the dual-stack wildcard first, then IPv4, when LISTEN_HOST is unset', () => {
    expect(resolveListenHosts({} as NodeJS.ProcessEnv)).toEqual(['::', '0.0.0.0']);
  });

  it('treats a blank LISTEN_HOST as unset', () => {
    expect(resolveListenHosts({ LISTEN_HOST: '   ' } as NodeJS.ProcessEnv)).toEqual(['::', '0.0.0.0']);
  });
});

describe('listenWithIpv4Fallback', () => {
  it('binds LISTEN_HOST when it is set and never tries anything else', async () => {
    const app = fakeApp();
    const log = vi.fn();

    const bound = await listenWithIpv4Fallback(app, PORT, { LISTEN_HOST: '127.0.0.1' } as NodeJS.ProcessEnv, log);

    expect(bound).toBe('127.0.0.1');
    expect(app.listen).toHaveBeenCalledTimes(1);
    expect(app.listen).toHaveBeenCalledWith(PORT, '127.0.0.1');
    expect(log).not.toHaveBeenCalled();
  });

  it("binds '::' first when LISTEN_HOST is unset and the host supports IPv6", async () => {
    const app = fakeApp();
    const log = vi.fn();

    const bound = await listenWithIpv4Fallback(app, PORT, {} as NodeJS.ProcessEnv, log);

    expect(bound).toBe('::');
    expect(app.listen).toHaveBeenCalledTimes(1);
    expect(app.listen).toHaveBeenCalledWith(PORT, '::');
    expect(log).not.toHaveBeenCalled();
  });

  it("retries on '0.0.0.0' when '::' fails with EAFNOSUPPORT", async () => {
    const app = fakeApp({ '::': errnoError('EAFNOSUPPORT', 'listen EAFNOSUPPORT: address family not supported :::43110') });
    const log = vi.fn();

    const bound = await listenWithIpv4Fallback(app, PORT, {} as NodeJS.ProcessEnv, log);

    expect(bound).toBe('0.0.0.0');
    expect(app.listen).toHaveBeenCalledTimes(2);
    expect(app.listen).toHaveBeenNthCalledWith(1, PORT, '::');
    expect(app.listen).toHaveBeenNthCalledWith(2, PORT, '0.0.0.0');
  });

  it('announces the fallback without echoing the raw errno token', async () => {
    // release0-journey.integration.test.ts treats any `EAFNOSUPPORT…` line in
    // the spawned server's output as a boot failure and kills the process. The
    // notice has to be readable by an operator AND invisible to that regex.
    const app = fakeApp({ '::': errnoError('EAFNOSUPPORT') });
    const log = vi.fn();

    await listenWithIpv4Fallback(app, PORT, {} as NodeJS.ProcessEnv, log);

    expect(log).toHaveBeenCalledTimes(1);
    const notice = String(log.mock.calls[0][0]);
    expect(notice).toContain('0.0.0.0');
    expect(notice).toContain(String(PORT));
    expect(notice).not.toMatch(/EAFNOSUPPORT|EADDRINUSE/);
  });

  it("rethrows a non-EAFNOSUPPORT error on '::' without retrying", async () => {
    const app = fakeApp({ '::': errnoError('EADDRINUSE', 'listen EADDRINUSE: address already in use :::43110') });
    const log = vi.fn();

    await expect(listenWithIpv4Fallback(app, PORT, {} as NodeJS.ProcessEnv, log)).rejects.toMatchObject({
      code: 'EADDRINUSE',
    });
    expect(app.listen).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });

  it('rethrows an error that carries no errno code', async () => {
    const boom = new Error('socket exploded');
    const app = fakeApp({ '::': boom });

    await expect(listenWithIpv4Fallback(app, PORT, {} as NodeJS.ProcessEnv, vi.fn())).rejects.toBe(boom);
    expect(app.listen).toHaveBeenCalledTimes(1);
  });

  it("rethrows when the IPv4 retry fails too, and does not loop", async () => {
    const app = fakeApp({
      '::': errnoError('EAFNOSUPPORT'),
      '0.0.0.0': errnoError('EADDRINUSE', 'listen EADDRINUSE: address already in use 0.0.0.0:43110'),
    });

    await expect(listenWithIpv4Fallback(app, PORT, {} as NodeJS.ProcessEnv, vi.fn())).rejects.toMatchObject({
      code: 'EADDRINUSE',
    });
    expect(app.listen).toHaveBeenCalledTimes(2);
  });

  it("rethrows EAFNOSUPPORT when it is the last candidate's error", async () => {
    const app = fakeApp({
      '::': errnoError('EAFNOSUPPORT'),
      '0.0.0.0': errnoError('EAFNOSUPPORT'),
    });

    await expect(listenWithIpv4Fallback(app, PORT, {} as NodeJS.ProcessEnv, vi.fn())).rejects.toMatchObject({
      code: 'EAFNOSUPPORT',
    });
    expect(app.listen).toHaveBeenCalledTimes(2);
  });

  it("does not fall back when the operator pinned LISTEN_HOST='::' and it is unsupported", async () => {
    const app = fakeApp({ '::': errnoError('EAFNOSUPPORT') });
    const log = vi.fn();

    await expect(listenWithIpv4Fallback(app, PORT, { LISTEN_HOST: '::' } as NodeJS.ProcessEnv, log)).rejects.toMatchObject(
      { code: 'EAFNOSUPPORT' },
    );
    expect(app.listen).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });

  it('defaults the env to process.env and the logger to console.warn', async () => {
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
