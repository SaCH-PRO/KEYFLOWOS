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
 * This spec proves it. Under the unit config (VITEST_KEYFLOW_UNIT=1, set by the
 * config) the guard must already be in place when the spec's module loads;
 * under any other config (test:ci runs `vitest run` with isolation on and no
 * setup file) the spec installs the guard itself, so its behaviour is proved
 * there too. Nothing here leaves the machine even with the guard absent: the
 * refused hosts are an RFC 6761 `.invalid` name (it never resolves) and an
 * RFC 5737 TEST-NET-1 address (it routes nowhere), and every request opened
 * while the guard is missing is torn down at once.
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { request as namedHttpsRequest } from 'node:https';
import net, { type AddressInfo } from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REFUSED = 'KF_UNIT_NETWORK_REFUSED';
/** RFC 6761: a `.invalid` name never resolves. */
const NAME = 'kf-unit-guard-probe.invalid';
/** RFC 5737 TEST-NET-1: documentation only, routed nowhere. */
const ADDR = '192.0.2.10';

const SERVER_DIR = path.resolve(__dirname, '..', '..', '..');
const UNDER_UNIT_CONFIG = process.env.VITEST_KEYFLOW_UNIT === '1';

type Guard = {
  installUnitNetworkGuard(by?: string): unknown;
  takeUnitNetworkViolations(): Array<{ host: string; via: string }>;
  assertNoUnitNetworkViolations(): void;
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

describe('loopback stays open', () => {
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
