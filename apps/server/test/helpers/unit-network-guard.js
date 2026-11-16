/**
 * The unit-test network guard (FU-UNIT-MOCK-ISOLATION).
 *
 * A unit spec talks to nothing but this machine. vitest.unit.config.ts runs
 * every src spec with isolate:false, so a spec's vi.mock of a provider SDK
 * binds only the modules evaluated after it; when it misses, the real SDK
 * runs. That is how ai-usage.service.spec.ts sent OpenAI calls out of a unit
 * run. This guard makes such a miss fail loudly instead: it refuses every
 * outbound connection to a host that is not loopback, at each layer a client
 * can use, before anything is resolved or sent:
 *
 *   fetch              the URL's host (a request carrying its own undici
 *                      dispatcher is judged at the socket, below)
 *   http(s).request    the target host; a proxy-form request (an absolute URL
 *   http(s).get        as the path) by that URL's host; a CONNECT tunnel by
 *                      its authority. That covers a client that honours
 *                      HTTPS_PROXY and sends through a loopback proxy.
 *   net.Socket#connect net.connect, tls.connect, http agents and undici all
 *                      end here: the host, or, when the connection carries its
 *                      own lookup (an SSRF pin), every address that lookup
 *                      answers.
 *
 * Loopback is 127.0.0.0/8, ::1, the unspecified addresses (0.0.0.0, ::: a
 * connection to them stays on this machine), `localhost` and `*.localhost`,
 * a missing host (node's default is localhost) and a unix socket path.
 *
 * Every refusal is also recorded, because the clients this guard exists for
 * swallow network errors (supabase-js getUser() answers a failed fetch with
 * an error object; a spec reading that as "session gone" passes). The unit
 * setup (test/unit.setup.js) fails the test that left a record.
 *
 * Installed once per process: the state lives on globalThis, so a module
 * registry reset (vi.resetModules, which re-evaluates this file) neither
 * wraps twice nor loses the record.
 *
 * JavaScript on purpose, like sql-like.js: apps/server/tsconfig.json pins
 * rootDir to ./src and includes test/**, so a TypeScript helper here fails the
 * server typecheck with TS6059.
 */
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';

export const UNIT_NETWORK_REFUSED = 'KF_UNIT_NETWORK_REFUSED';

const STATE = Symbol.for('keyflow.unitNetworkGuard');

/** @returns {{ installedBy: string | null, violations: Array<{ host: string, via: string, test: string | undefined, file: string | undefined }>, fetch?: typeof fetch, guardedFetch?: typeof fetch }} */
function state() {
  if (!globalThis[STATE]) globalThis[STATE] = { installedBy: null, violations: [] };
  return globalThis[STATE];
}

const LOOPBACK = new net.BlockList();
LOOPBACK.addSubnet('127.0.0.0', 8, 'ipv4');
LOOPBACK.addAddress('0.0.0.0', 'ipv4');
LOOPBACK.addAddress('::1', 'ipv6');
LOOPBACK.addAddress('::', 'ipv6');

/** True for a host a unit test may connect to (see the header). */
export function isLoopbackHost(host) {
  if (host === undefined || host === null || host === '') return true;
  let h = String(host).trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h.endsWith('.')) h = h.slice(0, -1);
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  const family = net.isIP(h);
  if (family === 4) return LOOPBACK.check(h, 'ipv4');
  if (family === 6) return LOOPBACK.check(h, 'ipv6');
  return false;
}

export class UnitNetworkRefusedError extends Error {
  constructor(host, via) {
    super(
      `unit tests may not reach the network: ${via} to "${host}" refused (FU-UNIT-MOCK-ISOLATION). ` +
        'Mock the client that made this request. Under vitest.unit.config.ts spec files share one module ' +
        'registry, so a vi.mock binds only modules imported after it: a spec whose mock must reach a ' +
        'service another file may already have imported resets the registry first (vi.resetModules).',
    );
    this.name = 'UnitNetworkRefusedError';
    this.code = UNIT_NETWORK_REFUSED;
    this.host = host;
    this.via = via;
  }
}

function currentTest() {
  try {
    const { currentTestName, testPath } = globalThis.expect?.getState?.() ?? {};
    return { test: currentTestName, file: testPath };
  } catch {
    return { test: undefined, file: undefined };
  }
}

function refuse(host, via) {
  const err = new UnitNetworkRefusedError(String(host), via);
  state().violations.push({ host: String(host), via, ...currentTest() });
  return err;
}

const WEB_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:']);

function fetchTarget(input) {
  try {
    const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input?.url);
    return WEB_PROTOCOLS.has(url.protocol) ? url : null;
  } catch {
    return null; // not an absolute URL: fetch itself refuses it
  }
}

function makeGuardedFetch(original) {
  return function guardedFetch(input, init) {
    const url = fetchTarget(input);
    if (url && !init?.dispatcher && !isLoopbackHost(url.hostname)) {
      return Promise.reject(refuse(url.hostname, `fetch ${url.origin}`));
    }
    return original(input, init);
  };
}

/** The host of `host:port` / `[v6]:port`, as a CONNECT request names its target. */
function authorityHost(authority) {
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(authority);
  return bracketed ? bracketed[1] : authority.replace(/:\d+$/, '');
}

/** Every host an http(s).request/get call would reach, by node's (url[, options][, cb]) | (options[, cb]) signature. */
function requestTargets(args) {
  let url = null;
  let options = {};
  if (typeof args[0] === 'string' || args[0] instanceof URL) {
    try {
      url = new URL(String(args[0]));
    } catch {
      url = null; // node throws ERR_INVALID_URL itself
    }
    if (args[1] && typeof args[1] === 'object') options = args[1];
  } else if (args[0] && typeof args[0] === 'object') {
    options = args[0];
  }
  const targets = [];
  // A unix socket stays local; a custom lookup decides the address at the socket (judged there).
  // `||`, as node reads them: an empty hostname is absent and the request goes to `host`.
  if (!options.socketPath && typeof options.lookup !== 'function') {
    targets.push(options.hostname || options.host || url?.hostname);
  }
  const path = typeof options.path === 'string' ? options.path : undefined;
  if (path && /^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    try {
      targets.push(new URL(path).hostname); // proxy form: the absolute URL is the real target
    } catch {
      /* not a URL after all */
    }
  }
  if (path && String(options.method ?? '').toUpperCase() === 'CONNECT') targets.push(authorityHost(path));
  return targets;
}

function guardRequest(original, via) {
  return function guardedRequest(...args) {
    const outside = requestTargets(args).find((host) => !isLoopbackHost(host));
    if (outside !== undefined) throw refuse(outside, via);
    return original.apply(this, args);
  };
}

/** The options object of a Socket#connect call: (options[, cb]) | (port[, host][, cb]) | (path[, cb]) | net's normalized [options, cb]. */
function connectOptions(args) {
  const first = args[0];
  if (Array.isArray(first)) return first[0] && typeof first[0] === 'object' ? first[0] : null;
  if (first && typeof first === 'object') return first;
  if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
    return { port: first, host: typeof args[1] === 'string' ? args[1] : undefined };
  }
  if (typeof first === 'string') return { path: first };
  return null;
}

/** `args` with the connect options replaced by `options`, keeping net's normalized-array marker. */
function withConnectOptions(args, options) {
  if (Array.isArray(args[0])) {
    const normalized = [options, ...args[0].slice(1)];
    for (const key of Object.getOwnPropertySymbols(args[0])) normalized[key] = args[0][key];
    return [normalized, ...args.slice(1)];
  }
  if (args[0] && typeof args[0] === 'object') return [options, ...args.slice(1)];
  return args;
}

/** A lookup that answers what `lookup` answers, unless an answer is not loopback. */
function guardLookup(lookup, hostname) {
  return function guardedLookup(name, options, callback) {
    const cb = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'function' ? {} : options;
    lookup(name, opts, (err, address, family) => {
      if (err) return cb(err, address, family);
      const answers = Array.isArray(address) ? address.map((a) => a.address) : [address];
      const outside = answers.find((a) => !isLoopbackHost(a));
      if (outside !== undefined) return cb(refuse(`${hostname} -> ${outside}`, 'net.Socket#connect (pinned lookup)'));
      return cb(null, address, family);
    });
  };
}

function guardSocketConnect(original) {
  return function guardedConnect(...args) {
    const options = connectOptions(args);
    // IPC (a unix socket or pipe) only when `path` is set: net tests it for truth, and an http agent passes `path: null`.
    if (!options || options.path) return original.apply(this, args);
    const host = options.host || 'localhost';
    if (isLoopbackHost(host)) return original.apply(this, args);
    if (typeof options.lookup === 'function' && net.isIP(String(host)) === 0) {
      // The lookup, not the name, decides where this connection goes (an SSRF pin): judge its answers.
      return original.apply(this, withConnectOptions(args, { ...options, lookup: guardLookup(options.lookup, host) }));
    }
    throw refuse(host, 'net.Socket#connect');
  };
}

/**
 * Installs the guard in this process (once; later calls only re-wrap a fetch
 * that something restored to the unguarded original). `by` names the
 * installer, kept in the state for the meta-test.
 */
export function installUnitNetworkGuard(by = 'unknown') {
  const s = state();
  if (!s.installedBy) {
    s.installedBy = by;
    s.fetch = globalThis.fetch;
    s.guardedFetch = makeGuardedFetch(s.fetch);
    http.request = guardRequest(http.request, 'http.request');
    http.get = guardRequest(http.get, 'http.get');
    https.request = guardRequest(https.request, 'https.request');
    https.get = guardRequest(https.get, 'https.get');
    net.Socket.prototype.connect = guardSocketConnect(net.Socket.prototype.connect);
    // `import { request } from 'node:https'` reads the ESM bindings, which follow the CJS exports only when synced.
    syncBuiltinESMExports();
  }
  if (typeof s.fetch === 'function' && (globalThis.fetch === s.fetch || globalThis.fetch === undefined)) {
    globalThis.fetch = s.guardedFetch;
  }
  return { installedBy: s.installedBy };
}

/** Returns every refusal recorded since the last call, and clears the record. */
export function takeUnitNetworkViolations() {
  const s = state();
  const taken = s.violations;
  s.violations = [];
  return taken;
}

/** Throws (failing the test it runs after) when anything was refused since the last check; clears the record. */
export function assertNoUnitNetworkViolations() {
  const taken = takeUnitNetworkViolations();
  if (taken.length === 0) return;
  const lines = taken.map(
    (v) => `  - ${v.via} to "${v.host}"${v.test ? ` during "${v.test}"` : ''}${v.file ? ` (${v.file})` : ''}`,
  );
  throw new Error(
    `a unit test tried to reach the network (FU-UNIT-MOCK-ISOLATION); the guard refused ${taken.length} ` +
      `request(s), and a refusal fails the test even when the code under test swallowed it:\n${lines.join('\n')}`,
  );
}
