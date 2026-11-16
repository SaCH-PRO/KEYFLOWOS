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
 *                      dispatcher, a ProxyAgent among them, is judged at the
 *                      socket, below)
 *   http(s).request    the target host; a proxy-form request (an absolute URL
 *   http(s).get        as the path) by that URL's host; a CONNECT tunnel by
 *                      its authority.
 *   net.Socket#connect net.connect, tls.connect, http agents and undici all
 *                      end here: the host, or, when the connection carries its
 *                      own lookup (an SSRF pin), every address that lookup
 *                      answers. A loopback port that an outbound proxy
 *                      variable names is refused too (PROXIES, below).
 *   net.Socket#write   on a connection to loopback: a CONNECT request line,
 *                      or a proxy-form request line, naming a host that is not
 *                      loopback, before it is sent.
 *
 * PROXIES (SEC-FU-UMI-1, COR-FUM-1). A proxy on this machine can relay out:
 * this sandbox's egress proxy listens on loopback
 * (HTTPS_PROXY=http://127.0.0.1:<port>). A client that opens its own tunnel
 * never passes through http(s).request, and its socket goes only to the
 * loopback proxy: undici's ProxyAgent or EnvHttpProxyAgent as a fetch
 * dispatcher, https-proxy-agent, any agent that writes its own CONNECT. Such a
 * client is judged by what it writes: the CONNECT (or proxy-form) request line
 * names where the proxy is asked to go, and one that names a host outside
 * loopback is refused at net.Socket#write. Installing the guard also takes
 * every proxy variable out of process.env (HTTP_PROXY, HTTPS_PROXY, ALL_PROXY
 * and every other `*_proxy` whose value is a URL or host:port, in either case;
 * NO_PROXY lists stay), so a client that honours them sends direct and is
 * judged by its real target. It remembers the endpoints they named: a
 * connection to one of those loopback ports, or to one a variable names
 * later, is refused at the socket.
 *
 * NOT COVERED: a proxy protocol other than HTTP on a loopback port that no
 * variable names (a SOCKS handshake carries its target in binary), and a
 * request line split across several writes. No client in this tree does
 * either.
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
 * wraps twice nor loses the record (or the proxy endpoints it took out).
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

/** @returns {{ installedBy: string | null, violations: Array<{ host: string, via: string, test: string | undefined, file: string | undefined }>, proxyEndpoints: Array<{ name: string, host: string, port: number }>, fetch?: typeof fetch, guardedFetch?: typeof fetch }} */
function state() {
  if (!globalThis[STATE]) globalThis[STATE] = { installedBy: null, violations: [], proxyEndpoints: [] };
  globalThis[STATE].proxyEndpoints ??= [];
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

/** A variable naming an outbound proxy: a name ending in `proxy`, in either case (a NO_PROXY list is not one). */
const PROXY_VARIABLE = /proxy$/i;
const NO_PROXY_VARIABLE = /(^|_)no_?proxy$/i;
const DEFAULT_PROXY_PORT = { 'http:': 80, 'https:': 443, 'socks:': 1080, 'socks4:': 1080, 'socks4a:': 1080, 'socks5:': 1080, 'socks5h:': 1080 };

/** `{ host, port }` of a proxy variable's value (a URL, or `host:port` as proxy-from-env reads it), or null. */
function proxyEndpoint(value) {
  const v = String(value ?? '').trim();
  let spelled;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) spelled = v;
  else if (/^(\[[^\]]+\]|[^\s:/[\]]+):\d+$/.test(v)) spelled = `http://${v}`;
  else return null;
  try {
    const url = new URL(spelled);
    const port = url.port ? Number(url.port) : DEFAULT_PROXY_PORT[url.protocol];
    if (!url.hostname || !port) return null;
    return { host: url.hostname.replace(/^\[(.*)\]$/, '$1'), port };
  } catch {
    return null;
  }
}

/** Every variable in `env` that names an outbound proxy, with the endpoint it names. */
function proxyEndpointsIn(env) {
  const found = [];
  for (const name of Object.keys(env)) {
    if (!PROXY_VARIABLE.test(name) || NO_PROXY_VARIABLE.test(name)) continue;
    const endpoint = proxyEndpoint(env[name]);
    if (endpoint) found.push({ name, ...endpoint });
  }
  return found;
}

/** Takes every variable naming an outbound proxy out of `env` (see the header) and returns the endpoints they named. */
export function stripProxyEnv(env) {
  const found = proxyEndpointsIn(env);
  for (const { name } of found) delete env[name];
  return found;
}

/** The endpoints the guard took out of process.env, as `{ name, host, port }` (a copy). */
export function unitNetworkGuardProxyEndpoints() {
  return state().proxyEndpoints.map((e) => ({ ...e }));
}

/** The proxy variable (taken out at install, or set since) that names a loopback endpoint on `port`, if any. */
function loopbackProxyOn(port) {
  const p = Number(port);
  if (!Number.isInteger(p) || p <= 0) return undefined;
  return [...state().proxyEndpoints, ...proxyEndpointsIn(process.env)].find((e) => e.port === p && isLoopbackHost(e.host));
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

/** A lookup that answers what `lookup` answers, unless an answer is not loopback (or is an outbound proxy's port). */
function guardLookup(lookup, hostname, port) {
  return function guardedLookup(name, options, callback) {
    const cb = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'function' ? {} : options;
    lookup(name, opts, (err, address, family) => {
      if (err) return cb(err, address, family);
      const answers = Array.isArray(address) ? address.map((a) => a.address) : [address];
      const outside = answers.find((a) => !isLoopbackHost(a));
      if (outside !== undefined) return cb(refuse(`${hostname} -> ${outside}`, 'net.Socket#connect (pinned lookup)'));
      const proxy = loopbackProxyOn(port);
      if (proxy) return cb(refuse(`${hostname} -> ${answers[0]}:${port}`, `net.Socket#connect (the outbound proxy ${proxy.name} names)`));
      return cb(null, address, family);
    });
  };
}

/** Marks a socket the guard let connect to loopback; its value names the peer, and its writes are judged (guardSocketWrite). */
const LOOPBACK_PEER = Symbol('keyflow.unitNetworkGuard.loopbackPeer');

function guardSocketConnect(original) {
  return function guardedConnect(...args) {
    const options = connectOptions(args);
    // IPC (a unix socket or pipe) only when `path` is set: net tests it for truth, and an http agent passes `path: null`.
    if (!options || options.path) return original.apply(this, args);
    const host = options.host || 'localhost';
    if (isLoopbackHost(host)) {
      const proxy = loopbackProxyOn(options.port);
      if (proxy) throw refuse(`${host}:${options.port}`, `net.Socket#connect (the outbound proxy ${proxy.name} names)`);
      this[LOOPBACK_PEER] = `${host}:${options.port}`;
      return original.apply(this, args);
    }
    if (typeof options.lookup === 'function' && net.isIP(String(host)) === 0) {
      // The lookup, not the name, decides where this connection goes (an SSRF pin): judge its answers.
      this[LOOPBACK_PEER] = `${host}:${options.port}`;
      return original.apply(this, withConnectOptions(args, { ...options, lookup: guardLookup(options.lookup, host, options.port) }));
    }
    throw refuse(host, 'net.Socket#connect');
  };
}

/** A request line asking the peer to open a tunnel (`CONNECT host:port HTTP/1.x`) or to fetch an absolute URL (proxy form). */
const TUNNEL_LINE = /^CONNECT[ \t]+(\S+)[ \t]+HTTP\/\d/i;
const PROXY_FORM_LINE = /^[A-Z][A-Z0-9_-]*[ \t]+([a-z][a-z0-9+.-]*:\/\/\S+)[ \t]+HTTP\/\d/i;
const TEXT_ENCODINGS = new Set([undefined, null, '', 'utf8', 'utf-8', 'latin1', 'binary', 'ascii']);
const HEAD_BYTES = 2048;

/** The start of a chunk handed to Socket#_write, as text (a request line is ASCII). */
function chunkHead(chunk, encoding) {
  try {
    if (typeof chunk === 'string') {
      const text = TEXT_ENCODINGS.has(encoding) ? chunk : Buffer.from(chunk, encoding).toString('latin1');
      return text.slice(0, HEAD_BYTES);
    }
    if (ArrayBuffer.isView(chunk)) {
      return Buffer.from(chunk.buffer, chunk.byteOffset, Math.min(chunk.byteLength, HEAD_BYTES)).toString('latin1');
    }
  } catch {
    /* an encoding Buffer cannot read: not a request line */
  }
  return '';
}

/** The refusal a chunk written to a loopback peer earns when it asks that peer to go to a host that is not loopback; else null. */
function tunnelRefusal(peer, chunk, encoding) {
  const head = chunkHead(chunk, encoding);
  const tunnel = TUNNEL_LINE.exec(head);
  if (tunnel) {
    const target = authorityHost(tunnel[1]);
    return isLoopbackHost(target) ? null : refuse(target, `net.Socket#write (CONNECT ${tunnel[1]} through ${peer})`);
  }
  const proxyForm = PROXY_FORM_LINE.exec(head);
  if (proxyForm) {
    let target;
    try {
      target = new URL(proxyForm[1]).hostname;
    } catch {
      return null; // not a URL: no proxy would act on it
    }
    return isLoopbackHost(target) ? null : refuse(target, `net.Socket#write (proxy-form request through ${peer})`);
  }
  return null;
}

/**
 * Socket#_write and #_writev (every write, plain or TLS, corked or not, ends
 * in one of them): on a socket marked LOOPBACK_PEER, a chunk that opens a
 * tunnel or a proxy-form request to a host outside loopback is not sent; the
 * write fails with the refusal, which destroys the socket.
 */
function guardSocketWrite(original) {
  return function guardedWrite(chunk, encoding, cb) {
    const refusal = this[LOOPBACK_PEER] ? tunnelRefusal(this[LOOPBACK_PEER], chunk, encoding) : null;
    if (refusal) return cb(refusal);
    return original.call(this, chunk, encoding, cb);
  };
}

function guardSocketWritev(original) {
  return function guardedWritev(chunks, cb) {
    if (this[LOOPBACK_PEER]) {
      for (const { chunk, encoding } of chunks) {
        const refusal = tunnelRefusal(this[LOOPBACK_PEER], chunk, encoding);
        if (refusal) return cb(refusal);
      }
    }
    return original.call(this, chunks, cb);
  };
}

/**
 * Installs the guard in this process (once; later calls only take out proxy
 * variables set since, and re-wrap a fetch that something restored to the
 * unguarded original). `by` names the installer, kept in the state for the
 * meta-test.
 */
export function installUnitNetworkGuard(by = 'unknown') {
  const s = state();
  for (const endpoint of stripProxyEnv(process.env)) {
    const known = s.proxyEndpoints.some((e) => e.name === endpoint.name && e.host === endpoint.host && e.port === endpoint.port);
    if (!known) s.proxyEndpoints.push(endpoint);
  }
  if (!s.installedBy) {
    s.installedBy = by;
    s.fetch = globalThis.fetch;
    s.guardedFetch = makeGuardedFetch(s.fetch);
    http.request = guardRequest(http.request, 'http.request');
    http.get = guardRequest(http.get, 'http.get');
    https.request = guardRequest(https.request, 'https.request');
    https.get = guardRequest(https.get, 'https.get');
    net.Socket.prototype.connect = guardSocketConnect(net.Socket.prototype.connect);
    net.Socket.prototype._write = guardSocketWrite(net.Socket.prototype._write);
    net.Socket.prototype._writev = guardSocketWritev(net.Socket.prototype._writev);
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
