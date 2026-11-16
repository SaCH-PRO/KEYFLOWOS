/**
 * FU-UNIT-MOCK-ISOLATION: a unit run can never reach a real provider.
 *
 * vitest.unit.config.ts runs every src spec with `isolate: false`: the files a
 * worker runs share one module registry, so a spec's vi.mock binds only the
 * modules evaluated after it. When an earlier file in the same worker had
 * already imported the service under test, the import returned that copy,
 * bound to the real SDK. ai-usage.service.spec.ts's `openai` mock missed this
 * way and six cases sent their calls to api.openai.com through the real SDK
 * (the sandbox egress proxy refused them; anywhere else they would have been
 * real provider traffic). supabase-auth.service.provider.spec.ts's createClient
 * mock missed the same way: five cases failed, and its two "callers" cases
 * passed only because the real getUser() round trip to the spec's made-up
 * host failed, which they read as "session gone".
 *
 * The unit config therefore runs test/unit.setup.js before every spec. It
 * installs the unit network guard (test/helpers/unit-network-guard.js), which
 * refuses any outbound connection to a host that is not loopback, at every
 * layer a client can use: fetch, http(s).request/get (including a proxy-form
 * request and a CONNECT tunnel through a local proxy), and net.Socket#connect
 * (net.connect, tls.connect and every agent end there; a connection whose
 * lookup is pinned is judged by the address the lookup answers). Every
 * refusal is also recorded, and the setup fails the test that made it, so a
 * client that swallows the error (a provider client that maps a network
 * failure to "null") still fails loudly instead of passing for the wrong
 * reason.
 *
 * A proxy on this machine can relay out: this sandbox's egress proxy listens
 * on loopback (HTTPS_PROXY=http://127.0.0.1:<port>). A client that opens its
 * own tunnel (undici's ProxyAgent or EnvHttpProxyAgent as a fetch dispatcher,
 * an agent that writes its own CONNECT on a raw socket) never passes through
 * http(s).request, and its socket goes only to the loopback proxy. So the
 * guard also judges what is written on a loopback connection (a CONNECT or a
 * proxy-form request line naming a host that is not loopback is refused), and
 * it takes every proxy variable out of the environment and refuses a
 * connection to the loopback port one names (SEC-FU-UMI-1, COR-FUM-1).
 *
 * This spec proves it. Under the unit config (VITEST_KEYFLOW_UNIT=1, set by the
 * config) the guard must already be in place when the spec's module loads;
 * under any other config (test:ci runs `vitest run` with isolation on and no
 * setup file) the spec installs the guard itself, so its behaviour is proved
 * there too. Nothing here leaves the machine even with the guard absent: the
 * refused hosts are an RFC 6761 `.invalid` name (it never resolves) and an
 * RFC 5737 TEST-NET-1 address (it routes nowhere), every request opened
 * while the guard is missing is torn down at once, the proxies here are
 * loopback probes that answer 403 and relay nothing, and the one case that
 * lets a client read the proxy variables first checks that none is left.
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { request as namedHttpsRequest } from 'node:https';
import net, { type AddressInfo } from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { EnvHttpProxyAgent, ProxyAgent, fetch as undiciFetch } from 'undici';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REFUSED = 'KF_UNIT_NETWORK_REFUSED';
/** RFC 6761: a `.invalid` name never resolves. */
const NAME = 'kf-unit-guard-probe.invalid';
/** RFC 5737 TEST-NET-1: documentation only, routed nowhere. */
const ADDR = '192.0.2.10';

const SERVER_DIR = path.resolve(__dirname, '..', '..', '..');
const UNDER_UNIT_CONFIG = process.env.VITEST_KEYFLOW_UNIT === '1';

type ProxyEndpoint = { name: string; host: string; port: number };
type Guard = {
  installUnitNetworkGuard(by?: string): unknown;
  takeUnitNetworkViolations(): Array<{ host: string; via: string }>;
  assertNoUnitNetworkViolations(): void;
  stripProxyEnv(env: Record<string, string | undefined>): ProxyEndpoint[];
  unitNetworkGuardProxyEndpoints(): ProxyEndpoint[];
};
const loadGuard = async (): Promise<Guard> =>
  (await import(/* @vite-ignore */ path.join(SERVER_DIR, 'test', 'helpers', 'unit-network-guard.js'))) as Guard;

type Closable = { on?: (event: string, cb: (...a: unknown[]) => void) => unknown; destroy(): void };

/** Runs `open` and returns what it threw (undefined when it threw nothing); anything it opened is torn down at once. */
function thrownBy(open: () => Closable | undefined): unknown {
  try {
    const handle = open();
    handle?.on?.('error', () => undefined);
    handle?.destroy();
    return undefined;
  } catch (err) {
    return err;
  }
}

/**
 * Probed while this module loads, before any hook of this file runs: under the
 * unit config the guard must already be in place, installed by the config's
 * setup file, not by anything in this file.
 */
const refusedAtLoad = thrownBy(() => http.request(`http://${NAME}/load-probe`));

/**
 * The variables the guard counts as naming an outbound proxy: a name ending in
 * `proxy` (HTTP_PROXY, https_proxy, ALL_PROXY, npm_config_https_proxy,
 * GLOBAL_AGENT_HTTPS_PROXY, ...) whose value is a URL or `host:port`. A
 * NO_PROXY list is not one.
 */
function proxyVariables(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env).filter(
    (name) =>
      /proxy$/i.test(name) &&
      !/(^|_)no_?proxy$/i.test(name) &&
      /^([a-z][a-z0-9+.-]*:\/\/|(\[[^\]]+\]|[^\s:/[\]]+):\d+$)/i.test(String(env[name] ?? '').trim()),
  );
}

/** Seen while this module loads: under the unit config the setup has already taken them out. */
const proxyVariablesAtLoad = proxyVariables(process.env);

type ProbeProxy = { url: string; port: number; lines: string[]; connections: number; close(): Promise<void> };

/**
 * A loopback stand-in for an egress proxy: it counts the connections it
 * accepts, records the first line each sends, answers 403 and relays nothing.
 * `keepBound` leaves it listening (unref'd) for the life of this worker, so a
 * port the guard now remembers as a proxy's is never handed to a later spec's
 * server in the same process.
 */
async function probeProxy({ keepBound = false } = {}): Promise<ProbeProxy> {
  const sockets = new Set<net.Socket>();
  const probe = { lines: [] as string[], connections: 0 };
  const server = net.createServer((socket) => {
    probe.connections += 1;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let head = '';
    const onData = (buf: Buffer) => {
      head += buf.toString('latin1');
      const end = head.indexOf('\r\n');
      if (end === -1) return;
      socket.off('data', onData);
      probe.lines.push(head.slice(0, end));
      socket.end('HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\nconnection: close\r\n\r\n');
    };
    socket.on('data', onData);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  if (keepBound) server.unref();
  const proxyPort = (server.address() as AddressInfo).port;
  return Object.assign(probe, {
    url: `http://127.0.0.1:${proxyPort}`,
    port: proxyPort,
    close: () =>
      keepBound
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            for (const s of sockets) s.destroy();
            server.close(() => resolve());
          }),
  });
}

/** Resolves when `socket` has closed, or after `ms`. */
function settled(socket: net.Socket | undefined, ms = 1500): Promise<void> {
  return new Promise((resolve) => {
    if (!socket || socket.destroyed) return resolve();
    const timer = setTimeout(resolve, ms);
    socket.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Opens a raw loopback socket to `targetPort` and writes `text` on it; resolves once the socket closes (or 1.5s). */
async function writeOnLoopback(targetPort: number, text: string): Promise<void> {
  const socket = net.connect(targetPort, '127.0.0.1');
  socket.on('error', () => undefined);
  socket.resume(); // drain the answer, so the peer's end closes this socket
  socket.write(text);
  await settled(socket);
  socket.destroy();
}

/** The `code` of `err` and of each error in its `cause` chain (fetch wraps a socket error as `TypeError: fetch failed`). */
function codesIn(err: unknown): unknown[] {
  const codes: unknown[] = [];
  let e = err as { code?: unknown; cause?: unknown } | undefined;
  for (let depth = 0; e && depth < 6; depth += 1) {
    codes.push(e.code);
    e = e.cause as typeof e;
  }
  return codes;
}

/** A lookup pinned to one address, in both callback shapes net uses. */
function pinnedTo(address: string): net.LookupFunction {
  return ((_host: string, options: { all?: boolean }, cb: (...a: unknown[]) => void) => {
    if (options?.all) cb(null, [{ address, family: 4 }]);
    else cb(null, address, 4);
  }) as unknown as net.LookupFunction;
}

/** Connects with `options`; resolves 'connected', the error the socket emitted, or 'timeout'. */
function connectOutcome(options: net.NetConnectOpts): Promise<unknown> {
  return new Promise((resolve) => {
    const socket = net.connect(options);
    socket.setTimeout(1500, () => {
      socket.destroy();
      resolve('timeout');
    });
    socket.on('error', (err) => resolve(err));
    socket.on('connect', () => {
      socket.destroy();
      resolve('connected');
    });
  });
}

let guard: Guard | undefined;
let loadViolations: Array<{ host: string; via: string }> = [];
let server: http.Server;
let port = 0;

beforeAll(async () => {
  if (!UNDER_UNIT_CONFIG) {
    // test:ci (vitest.config.ts) has no setup file: prove the guard's behaviour here by installing it for this process.
    guard = await loadGuard();
    guard.installUnitNetworkGuard('unit-network-guard.spec.ts');
  }
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`pong ${req.method} ${req.url}`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  port = (server.address() as AddressInfo).port;
  if (UNDER_UNIT_CONFIG) {
    // The load-time probe above was refused and recorded before any test ran; keep it for its own case, so the
    // setup's after-each check does not charge it to whichever case the shuffle runs first. A missing helper
    // means nothing installed a guard: the cases below then fail on what was not refused.
    guard = await loadGuard().catch(() => undefined);
    loadViolations = guard?.takeUnitNetworkViolations() ?? [];
  }
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** The refusal `err` must carry, and the one record it must have left (consumed here, so the setup's check stays clean). */
async function expectRefusedAndRecorded(err: unknown, host: string, via: RegExp) {
  expect(err, `expected the guard to refuse ${host}`).toMatchObject({ code: REFUSED, host });
  const recorded = (guard ?? (await loadGuard())).takeUnitNetworkViolations();
  expect(recorded).toHaveLength(1);
  expect(recorded[0]).toMatchObject({ host });
  expect(recorded[0].via).toMatch(via);
}

/** At least one record since the last take (consumed here), each for `host` by `via`: a client that retries leaves one per attempt. */
async function expectRecorded(host: string, via: RegExp) {
  const recorded = (guard ?? (await loadGuard())).takeUnitNetworkViolations();
  expect(recorded.length, `expected the guard to have recorded a refusal of ${host}`).toBeGreaterThanOrEqual(1);
  for (const r of recorded) {
    expect(r).toMatchObject({ host });
    expect(r.via).toMatch(via);
  }
}

describe('the unit config installs the guard before any spec runs', () => {
  it('vitest.unit.config.ts names test/unit.setup.js as its setup file, and the setup installs the guard and fails a test that was refused', () => {
    const config = fs.readFileSync(path.join(SERVER_DIR, 'vitest.unit.config.ts'), 'utf8');
    expect(config).toMatch(/setupFiles:\s*\[\s*'\.\/test\/unit\.setup\.js'\s*\]/);
    expect(config).toMatch(/VITEST_KEYFLOW_UNIT:\s*'1'/);

    const setupPath = path.join(SERVER_DIR, 'test', 'unit.setup.js');
    expect(fs.existsSync(setupPath), 'test/unit.setup.js is missing').toBe(true);
    const setup = fs.readFileSync(setupPath, 'utf8');
    expect(setup).toMatch(/installUnitNetworkGuard\(/);
    expect(setup).toMatch(/afterEach\(\s*\(\)\s*=>\s*assertNoUnitNetworkViolations\(\)\s*\)/);
    expect(setup).toMatch(/afterAll\(\s*\(\)\s*=>\s*assertNoUnitNetworkViolations\(\)\s*\)/);
  });

  it.runIf(UNDER_UNIT_CONFIG)('under the unit config a request made while a spec module loads is already refused and recorded', () => {
    expect(refusedAtLoad, 'http.request to a non-loopback host was not refused at module load').toMatchObject({
      code: REFUSED,
      host: NAME,
    });
    expect(loadViolations).toEqual([expect.objectContaining({ host: NAME, via: expect.stringMatching(/^http\.request/) })]);
  });
});

describe('a request to a host that is not loopback is refused, whichever client makes it', () => {
  it('fetch to a provider-shaped https URL rejects with the guard refusal (nothing is resolved or sent)', async () => {
    const err = await fetch(`https://${NAME}/v1/embeddings`, {
      method: 'POST',
      body: '{}',
      signal: AbortSignal.timeout(1500),
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    await expectRefusedAndRecorded(err, NAME, /^fetch/);
  });

  it('fetch to a non-loopback IP literal is refused', async () => {
    const err = await fetch(`http://${ADDR}/v1/models`, { signal: AbortSignal.timeout(1500) }).then(
      () => undefined,
      (e: unknown) => e,
    );
    await expectRefusedAndRecorded(err, ADDR, /^fetch/);
  });

  it('http.request and http.get throw the guard refusal', async () => {
    await expectRefusedAndRecorded(thrownBy(() => http.request(`http://${NAME}/v1/models`)), NAME, /^http\.request/);
    await expectRefusedAndRecorded(thrownBy(() => http.get({ host: ADDR, port: 80, path: '/' })), ADDR, /^http\.get/);
    // node reads an empty `hostname` as absent and connects to `host`: the request layer judges the same host.
    await expectRefusedAndRecorded(thrownBy(() => http.request({ hostname: '', host: NAME, path: '/' })), NAME, /^http\.request/);
  });

  it('https.request, https.get and the ESM named import of node:https throw the guard refusal (the openai SDK node-fetch path)', async () => {
    await expectRefusedAndRecorded(
      thrownBy(() => https.request(new URL(`https://${NAME}/v1/chat/completions`), { method: 'POST' })),
      NAME,
      /^https\.request/,
    );
    await expectRefusedAndRecorded(thrownBy(() => https.get(`https://${NAME}/`)), NAME, /^https\.get/);
    await expectRefusedAndRecorded(thrownBy(() => namedHttpsRequest(`https://${NAME}/`)), NAME, /^https\.request/);
  });

  it('a proxy-form request and a CONNECT tunnel through a loopback proxy are refused by their real target', async () => {
    await expectRefusedAndRecorded(
      thrownBy(() => http.request({ host: '127.0.0.1', port, path: `https://${NAME}/v1/models` })),
      NAME,
      /^http\.request/,
    );
    await expectRefusedAndRecorded(
      thrownBy(() => http.request({ host: '127.0.0.1', port, method: 'CONNECT', path: `${NAME}:443` })),
      NAME,
      /^http\.request/,
    );
  });

  it('net.connect, tls.connect and Socket#connect to a non-loopback host throw the guard refusal', async () => {
    await expectRefusedAndRecorded(thrownBy(() => net.connect({ host: NAME, port: 443 })), NAME, /^net\.Socket#connect/);
    await expectRefusedAndRecorded(thrownBy(() => tls.connect({ host: NAME, port: 443 })), NAME, /^net\.Socket#connect/);
    await expectRefusedAndRecorded(thrownBy(() => new net.Socket().connect(443, ADDR)), ADDR, /^net\.Socket#connect/);
  });

  it('a request that skips http.request (new ClientRequest through the agent) is refused at the socket', async () => {
    // The agent hands net a request's options with `path: null`; that is not an IPC path, and the socket judges the host.
    await expectRefusedAndRecorded(thrownBy(() => new http.ClientRequest({ host: NAME, port: 80, path: '/v1/models' })), NAME, /^net\.Socket#connect/);
    await expectRefusedAndRecorded(
      thrownBy(() => new http.ClientRequest({ host: NAME, port: 443, path: '/', protocol: 'https:', agent: https.globalAgent as unknown as http.Agent })),
      NAME,
      /^net\.Socket#connect/,
    );
  });

  it('a connection whose lookup is pinned is refused when the lookup answers a non-loopback address', async () => {
    const outcome = await connectOutcome({ host: NAME, port, lookup: pinnedTo(ADDR) });
    await expectRefusedAndRecorded(outcome, `${NAME} -> ${ADDR}`, /^net\.Socket#connect/);
  });

  it('a refusal the caller swallows still fails the test: it is recorded, and the check the setup runs after each test throws', async () => {
    const g = guard ?? (await loadGuard());
    expect(g.takeUnitNetworkViolations()).toEqual([]);

    // A provider client that maps a network failure to "null", as supabase-js getUser() does.
    const answer = await fetch(`https://${NAME}/auth/v1/user`).then(
      () => 'reached',
      () => null,
    );
    expect(answer).toBeNull();

    expect(() => g.assertNoUnitNetworkViolations()).toThrow(/fetch https:\/\/kf-unit-guard-probe\.invalid/);
    expect(g.takeUnitNetworkViolations(), 'the check consumes what it reported').toEqual([]);
    expect(() => g.assertNoUnitNetworkViolations()).not.toThrow();
  });
});

describe('a client that tunnels through a proxy on this machine is judged by where it asks the proxy to go (SEC-FU-UMI-1, COR-FUM-1)', () => {
  it('fetch with an undici ProxyAgent dispatcher on a loopback proxy is refused by the tunnel target, and the proxy receives nothing', async () => {
    for (const [label, doFetch] of [
      ['global fetch', globalThis.fetch],
      ['undici fetch', undiciFetch],
    ] as const) {
      const proxy = await probeProxy();
      const dispatcher = new ProxyAgent(proxy.url);
      try {
        const err = await (doFetch as typeof globalThis.fetch)(`https://${NAME}/v1/chat/completions`, {
          method: 'POST',
          body: '{}',
          dispatcher,
          signal: AbortSignal.timeout(1500),
        } as RequestInit).then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(proxy.lines, `${label}: the proxy was asked to open a tunnel`).toEqual([]);
        expect(codesIn(err), `${label}: the caller did not get the guard refusal`).toContain(REFUSED);
        await expectRecorded(NAME, /^net\.Socket#write \(CONNECT kf-unit-guard-probe\.invalid:443 through 127\.0\.0\.1:\d+\)$/);
      } finally {
        await dispatcher.destroy().catch(() => undefined);
        await proxy.close();
      }
    }
  });

  it('an http agent that writes its own CONNECT over a raw loopback socket is refused by the tunnel target, though the request skips http.request', async () => {
    const proxy = await probeProxy();
    try {
      let tunnel: net.Socket | undefined;
      const agent = new http.Agent();
      (agent as unknown as { createConnection: (o: { host: string }) => net.Socket }).createConnection = (opts) => {
        // The https-proxy-agent shape: a socket to the proxy, then the agent writes the CONNECT itself.
        const socket = net.connect(proxy.port, '127.0.0.1');
        socket.on('error', () => undefined);
        socket.once('connect', () => socket.write(`CONNECT ${opts.host}:443 HTTP/1.1\r\nHost: ${opts.host}:443\r\n\r\n`));
        tunnel = socket;
        return socket;
      };
      const req = new http.ClientRequest({ host: NAME, port: 443, path: '/v1/models', agent });
      req.on('error', () => undefined);
      await settled(tunnel);
      req.destroy();
      agent.destroy();
      expect(proxy.lines, 'the proxy was asked to open a tunnel').toEqual([]);
      await expectRecorded(NAME, /^net\.Socket#write \(CONNECT kf-unit-guard-probe\.invalid:443 through 127\.0\.0\.1:\d+\)$/);
    } finally {
      await proxy.close();
    }
  });

  it('a proxy-form request written on a raw loopback socket is refused by its absolute URL', async () => {
    const proxy = await probeProxy();
    try {
      await writeOnLoopback(proxy.port, `GET http://${NAME}/v1/models HTTP/1.1\r\nHost: ${NAME}\r\n\r\n`);
      await writeOnLoopback(proxy.port, `POST https://${ADDR}:8443/v1/embeddings HTTP/1.1\r\nHost: ${ADDR}\r\ncontent-length: 0\r\n\r\n`);
      expect(proxy.lines, 'the proxy was handed a proxy-form request').toEqual([]);
      const recorded = (guard ?? (await loadGuard())).takeUnitNetworkViolations();
      expect(recorded).toEqual([
        expect.objectContaining({ host: NAME, via: expect.stringMatching(/^net\.Socket#write \(proxy-form request through 127\.0\.0\.1:\d+\)$/) }),
        expect.objectContaining({ host: ADDR, via: expect.stringMatching(/^net\.Socket#write \(proxy-form request through 127\.0\.0\.1:\d+\)$/) }),
      ]);
    } finally {
      await proxy.close();
    }
  });

  it('the guard takes every proxy variable out of the environment, so a client that honours HTTPS_PROXY sends direct and is judged by its real target', async () => {
    if (UNDER_UNIT_CONFIG) {
      expect(proxyVariablesAtLoad, 'proxy variables were still set when this spec module loaded').toEqual([]);
    }
    // Checked before any client reads the variables, so a guard that left them in place fails here and sends nothing.
    expect(proxyVariables(process.env), 'proxy variables are still set').toEqual([]);

    const dispatcher = new EnvHttpProxyAgent();
    try {
      const err = await fetch(`https://${NAME}/v1/models`, { dispatcher, signal: AbortSignal.timeout(1500) } as RequestInit).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(codesIn(err)).toContain(REFUSED);
      await expectRecorded(NAME, /^net\.Socket#connect$/);
    } finally {
      await dispatcher.destroy().catch(() => undefined);
    }
  });

  it('stripProxyEnv takes out each variable naming a proxy (URL or host:port, either case) and returns the endpoints; NO_PROXY lists and other variables stay', async () => {
    const g = guard ?? (await loadGuard());
    const env: Record<string, string | undefined> = {
      HTTPS_PROXY: 'http://127.0.0.1:39157',
      http_proxy: 'http://[::1]:3128/',
      ALL_PROXY: 'socks5://localhost',
      npm_config_https_proxy: '127.0.0.1:8888',
      GLOBAL_AGENT_HTTPS_PROXY: 'https://proxy.example.test',
      NO_PROXY: 'localhost,127.0.0.1',
      no_proxy: 'localhost',
      npm_config_noproxy: 'localhost',
      GLOBAL_AGENT_NO_PROXY: 'localhost',
      ELECTRON_GET_USE_PROXY: '1',
      CLOUDSDK_PROXY_PORT: '39157',
      PATH: '/usr/bin',
    };
    expect(g.stripProxyEnv(env)).toEqual(
      expect.arrayContaining([
        { name: 'HTTPS_PROXY', host: '127.0.0.1', port: 39157 },
        { name: 'http_proxy', host: '::1', port: 3128 },
        { name: 'ALL_PROXY', host: 'localhost', port: 1080 },
        { name: 'npm_config_https_proxy', host: '127.0.0.1', port: 8888 },
        { name: 'GLOBAL_AGENT_HTTPS_PROXY', host: 'proxy.example.test', port: 443 },
      ]),
    );
    expect(Object.keys(env).sort()).toEqual(
      ['CLOUDSDK_PROXY_PORT', 'ELECTRON_GET_USE_PROXY', 'GLOBAL_AGENT_NO_PROXY', 'NO_PROXY', 'PATH', 'no_proxy', 'npm_config_noproxy'].sort(),
    );
  });

  it('a connection to a loopback port a proxy variable names is refused: the variables the guard took out at install, and one a spec sets later', async () => {
    const g = guard ?? (await loadGuard());
    const taken = await probeProxy({ keepBound: true });
    const later = await probeProxy({ keepBound: true });
    const names = ['HTTPS_PROXY', 'npm_config_https_proxy', 'ALL_PROXY'] as const;
    const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
    try {
      process.env.HTTPS_PROXY = taken.url;
      process.env.npm_config_https_proxy = `127.0.0.1:${taken.port}`;
      g.installUnitNetworkGuard('unit-network-guard.spec.ts');
      expect(process.env.HTTPS_PROXY, 'install left HTTPS_PROXY set').toBeUndefined();
      expect(process.env.npm_config_https_proxy, 'install left npm_config_https_proxy set').toBeUndefined();
      expect(g.unitNetworkGuardProxyEndpoints()).toEqual(
        expect.arrayContaining([
          { name: 'HTTPS_PROXY', host: '127.0.0.1', port: taken.port },
          { name: 'npm_config_https_proxy', host: '127.0.0.1', port: taken.port },
        ]),
      );

      // A client still holding the URL it read before install (a ProxyAgent built from it) reaches nothing.
      const dispatcher = new ProxyAgent(taken.url);
      const err = await fetch(`https://${NAME}/v1/models`, { dispatcher, signal: AbortSignal.timeout(1500) } as RequestInit).then(
        () => undefined,
        (e: unknown) => e,
      );
      await dispatcher.destroy().catch(() => undefined);
      expect(codesIn(err)).toContain(REFUSED);
      expect(taken.connections, 'a connection reached the proxy the guard took out').toBe(0);
      await expectRecorded(
        `127.0.0.1:${taken.port}`,
        /^net\.Socket#connect \(the outbound proxy (HTTPS_PROXY|npm_config_https_proxy) names\)$/,
      );

      process.env.ALL_PROXY = `socks5://localhost:${later.port}`;
      await expectRefusedAndRecorded(
        thrownBy(() => net.connect({ host: '127.0.0.1', port: later.port })),
        `127.0.0.1:${later.port}`,
        /^net\.Socket#connect \(the outbound proxy ALL_PROXY names\)$/,
      );
      expect(later.connections, 'a connection reached the proxy ALL_PROXY names').toBe(0);
    } finally {
      for (const n of names) {
        if (saved[n] === undefined) delete process.env[n];
        else process.env[n] = saved[n];
      }
    }
  });
});

describe('loopback stays open', () => {
  it('a tunnel or a proxy-form request to a loopback target still passes through a loopback proxy', async () => {
    const proxy = await probeProxy();
    try {
      await writeOnLoopback(proxy.port, `CONNECT localhost:${port} HTTP/1.1\r\nHost: localhost:${port}\r\n\r\n`);
      await writeOnLoopback(proxy.port, `GET http://127.0.0.1:${port}/ping HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`);
      expect(proxy.lines).toEqual([`CONNECT localhost:${port} HTTP/1.1`, `GET http://127.0.0.1:${port}/ping HTTP/1.1`]);
      expect(guard?.takeUnitNetworkViolations() ?? []).toEqual([]);
    } finally {
      await proxy.close();
    }
  });

  it('fetch, http.get and net.connect reach a server on 127.0.0.1 and on localhost', async () => {
    const byAddress = await fetch(`http://127.0.0.1:${port}/ping`);
    expect(await byAddress.text()).toBe('pong GET /ping');
    const byName = await fetch(`http://localhost:${port}/ping`);
    expect(byName.status).toBe(200);
    await byName.text();

    const viaGet = await new Promise<number | undefined>((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: '/get' }, (res) => {
        res.resume();
        resolve(res.statusCode);
      }).on('error', reject);
    });
    expect(viaGet).toBe(200);

    expect(await connectOutcome({ host: '127.0.0.1', port })).toBe('connected');
    expect(guard?.takeUnitNetworkViolations() ?? []).toEqual([]);
  });

  it('a connection whose lookup is pinned to 127.0.0.1 is allowed whatever name it carries (the SSRF pin pattern)', async () => {
    expect(await connectOutcome({ host: NAME, port, lookup: pinnedTo('127.0.0.1') })).toBe('connected');
    expect(guard?.takeUnitNetworkViolations() ?? []).toEqual([]);
  });
});
