/**
 * RR-SESSION-STORAGE-CENSUS: every browser-readable place the web app stores a credential or session value.
 *
 * The first safe slice of "HttpOnly session cookies, no refresh token in localStorage". The move itself is an owner
 * question. This spec only pins today's set, so a new store cannot appear without someone writing down why.
 *
 * It reads the web app's browser code (apps/web/src, non-test files, and apps/web/public/*.js) and finds every write to:
 *   - localStorage / sessionStorage: `.setItem(key, …)` on any receiver (`localStorage`, `window.sessionStorage`,
 *     or a wrapper such as `ls?.setItem`);
 *   - a script-readable cookie: `document.cookie = "key=…"`;
 *   - a response cookie: `.cookies.set(key, …)` (middleware or a route handler);
 *   - IndexedDB: `indexedDB.open(name, …)`.
 * A write that only clears (an empty value with Max-Age=0 / maxAge: 0) stores nothing and is not counted.
 *
 * The key is resolved from the source: a string literal, a template literal, or a `const` in the same file (inside
 * templates too). When the key is a parameter of a wrapper function in the same file (presence-sdk.ts writeCookie),
 * the wrapper's call sites are resolved instead. A key that cannot be resolved stays as its source text.
 *
 * A write is a CREDENTIAL write when the resolved key or the key's source text matches CREDENTIAL_PATTERN
 * (token, refresh, secret, session, auth, plus admin, verifier, password, jwt, bearer, credential, api key and sid).
 * Every credential write must have exactly one REGISTRY row (store, key, file) saying why it is there; and every row
 * must still match a write. A new unregistered write fails CSC-02; a stale row fails CSC-03.
 *
 *   CSC-01 the scanner finds the writes it must (self-test on in-memory sources, including a new kf_new_token write).
 *   CSC-02 every credential write in the web app is registered.
 *   CSC-03 every registry row still matches a write (no stale rows).
 *   CSC-04 the stores the plan names are in the registry: kf_token, kf_refresh_token, kf_admin_token,
 *          kf_admin_user_cache, kf_auth_mode and the OAuth state cookie.
 *   CSC-05 no credential is written to IndexedDB, and no response cookie stores a credential (the only server writes
 *          are clears).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.join(__dirname, "..", "..", "..");
const WEB_SRC = path.join(WEB, "src");
const WEB_PUBLIC = path.join(WEB, "public");

type Store = "localStorage" | "sessionStorage" | "storage" | "cookie" | "response-cookie" | "indexedDB";

interface Write {
  store: Store;
  key: string;
  /** The key's source text, before resolution. */
  expr: string;
  file: string;
  line: number;
}

interface RegistryRow {
  store: Store;
  key: string;
  file: string;
  why: string;
  /** Cookie rows: the attributes the write sets, pinned (lower-case, in source order; see cookieAttrs). */
  attrs?: string[];
  /** A credential store that is a known defect, reported as a follow-up and not fixed by this packet. */
  followUp?: string;
}

const CREDENTIAL_PATTERN = /token|refresh|secret|session|auth|admin|verifier|password|passwd|jwt|bearer|credential|api[_-]?key|(?:^|[^a-z])sid(?:[^a-z]|$)/i;

/**
 * The registry. One row per (store, key, file). `storage` is a setItem on a receiver that is neither localStorage
 * nor sessionStorage by name (presence-sdk.ts: `safeStorage()`, which returns window.localStorage).
 */
const REGISTRY: RegistryRow[] = [
  // The user session (Supabase access token, refresh token, expiry), lib/workspace.ts.
  { store: "localStorage", key: "kf_token", file: "src/lib/workspace.ts", why: "User access token; api.ts reads it for the Authorization header. Script-readable (the HttpOnly move is an owner question)." },
  { store: "cookie", key: "kf_token", file: "src/lib/workspace.ts", why: "Mirror of the access token so the edge middleware can gate /app/*. Script-readable, SameSite=Lax, Secure on https.", attrs: ["path=/", "max-age=604800", "samesite=lax", "secure-on-https"] },
  { store: "localStorage", key: "kf_refresh_token", file: "src/lib/workspace.ts", why: "User refresh token, used to renew the session. Script-readable: the first thing the HttpOnly move would take out." },
  { store: "localStorage", key: "kf_token_expires_at", file: "src/lib/workspace.ts", why: "Access token expiry (ms), not a secret; read to refresh before expiry." },

  // The admin session, app/admin/login/page.tsx.
  { store: "localStorage", key: "kf_admin_token", file: "src/app/admin/login/page.tsx", why: "Admin bearer from /api/admin/auth/login; api.ts prefers it over kf_token. Script-readable." },
  { store: "cookie", key: "kf_admin_token", file: "src/app/admin/login/page.tsx", why: "Mirror of the admin bearer for the edge middleware. Script-readable, no SameSite or Secure attribute.", attrs: ["path=/", "max-age=86400"] },
  { store: "localStorage", key: "kf_admin_user_cache", file: "src/app/admin/login/page.tsx", why: "Admin user (id, email, role); isSuperAdmin reads it. Not a secret, but it decides what the shell shows." },
  { store: "cookie", key: "kf_admin_user_cache", file: "src/app/admin/login/page.tsx", why: "Cookie mirror of the admin user cache.", attrs: ["path=/", "max-age=86400"] },
  { store: "localStorage", key: "kf_auth_mode", file: "src/app/admin/login/page.tsx", why: "'admin' marks the admin session; admin/layout.tsx reads it. Not a secret." },
  { store: "cookie", key: "kf_auth_mode", file: "src/app/admin/login/page.tsx", why: "Cookie mirror of the auth mode.", attrs: ["path=/", "max-age=86400"] },

  // OAuth sign-in, lib/oauth-state.ts and lib/oauth-pkce.ts.
  { store: "cookie", key: "kf_oauth_state", file: "src/lib/oauth-state.ts", why: "OAuth state (CSRF) for 10 minutes; the client must read it to compare, so not HttpOnly (see the file).", attrs: ["path=/", "max-age=600", "samesite=lax", "secure-on-https"] },
  { store: "localStorage", key: "kf_oauth_code_verifier", file: "src/lib/oauth-pkce.ts", why: "PKCE code verifier for the code exchange; cleared after use." },
  { store: "cookie", key: "kf_oauth_code_verifier", file: "src/lib/oauth-pkce.ts", why: "Cookie fallback for the PKCE verifier (10 minutes), script-readable.", attrs: ["path=/", "max-age=600", "samesite=lax", "secure-on-https"] },

  // Public-site presence analytics, app/_lib/presence-sdk.ts. An analytics session id, not a sign-in credential.
  { store: "storage", key: "kf_sid", file: "src/app/_lib/presence-sdk.ts", why: "Presence analytics session id (30 minutes); grants nothing." },
  { store: "storage", key: "kf_sid_ts", file: "src/app/_lib/presence-sdk.ts", why: "Timestamp of the presence analytics session id." },
  { store: "cookie", key: "kf_sid", file: "src/app/_lib/presence-sdk.ts", why: "Cookie copy of the presence analytics session id (via writeCookie).", attrs: ["path=/", "max-age=1800", "samesite=lax", "secure-on-https"] },

  // The service worker's offline write queue, public/sw.js. enqueue() stores each queued request's headers, so the
  // user's Authorization bearer is written to IndexedDB in clear (security review follow-up, not fixed here).
  {
    store: "indexedDB",
    key: "kf-sync-queue",
    file: "public/sw.js",
    why: "Offline mutation queue: each entry keeps the request's headers, so the Authorization bearer lands in IndexedDB.",
    followUp: "public/sw.js enqueue() must not store the Authorization header (security review of RR-SESSION-STORAGE-CENSUS)",
  },
];

/* ------------------------------------------------------------------ scanner */

/** Reads one argument or expression starting at i, up to a top-level `,`, `)` or `;`. */
function readExpr(src: string, i: number, stops = ",);"): { text: string; end: number } {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'") {
      j = skipString(src, j);
      continue;
    }
    if (c === "`") {
      j = skipTemplate(src, j);
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && stops.includes(c)) break;
    else if (depth === 0 && c === "\n" && stops.includes(";")) {
      // A statement can end at a newline without a semicolon; continue only if the next line carries on the expression.
      const rest = src.slice(j + 1).trimStart();
      if (!/^[+.?:|&]/.test(rest)) break;
    }
    j++;
  }
  return { text: src.slice(i, j).trim(), end: j };
}

function skipString(src: string, i: number): number {
  const q = src[i];
  let j = i + 1;
  while (j < src.length && src[j] !== q) j += src[j] === "\\" ? 2 : 1;
  return j + 1;
}

function skipTemplate(src: string, i: number): number {
  let j = i + 1;
  while (j < src.length && src[j] !== "`") {
    if (src[j] === "\\") j += 2;
    else if (src[j] === "$" && src[j + 1] === "{") {
      let depth = 1;
      j += 2;
      while (j < src.length && depth > 0) {
        if (src[j] === "`") j = skipTemplate(src, j) - 1;
        else if (src[j] === '"' || src[j] === "'") j = skipString(src, j) - 1;
        else if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        j++;
      }
    } else j++;
  }
  return j + 1;
}

/** `const NAME = "x"` / `const NAME: string = \`x\`` in the file, or null. */
function constValue(src: string, name: string): string | null {
  const m = src.match(new RegExp(`\\b(?:const|let|var)\\s+${name}\\b\\s*(?::\\s*[\\w<>\\[\\]| ]+)?=\\s*`));
  if (!m || m.index === undefined) return null;
  const { text } = readExpr(src, m.index + m[0].length, ",;");
  return literalValue(src, text, 0);
}

/** The value of a literal or template expression, with `${x}` resolved where it can be, else "*". */
function literalValue(src: string, text: string, depth: number): string | null {
  const t = text.trim();
  if (/^(["']).*\1$/s.test(t)) return t.slice(1, -1);
  if (t.startsWith("`") && t.endsWith("`")) {
    return t.slice(1, -1).replace(/\$\{([^}]*)\}/g, (_, inner: string) => {
      const id = inner.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(id) && depth < 3) return constValue(src, id) ?? "*";
      return "*";
    });
  }
  if (/^[A-Za-z_$][\w$]*$/.test(t) && depth < 3) return constValue(src, t);
  return null;
}

/** The enclosing function's name when `param` is one of its parameters (`function f(param, …)` or `const f = (param`). */
function wrapperOf(src: string, at: number, param: string): string | null {
  const before = src.slice(0, at);
  const re = new RegExp(`(?:function\\s+([\\w$]+)\\s*\\(|(?:const|let)\\s+([\\w$]+)\\s*=\\s*(?:async\\s*)?\\()([^)]*)\\)`, "g");
  let found: string | null = null;
  for (const m of before.matchAll(re)) {
    const params = m[3].split(",").map((p) => p.trim().split(/[\s:=?]/)[0]);
    if (params.includes(param)) found = m[1] ?? m[2];
  }
  return found;
}

/** Each resolved first argument of the calls to `fn` in the file (one level). */
function callSiteKeys(src: string, fn: string, argIndex: number): string[] {
  const keys: string[] = [];
  const re = new RegExp(`(?<![\\w$.])${fn}\\s*\\(`, "g");
  for (const m of src.matchAll(re)) {
    // Skip the declaration itself.
    if (/function\s+$/.test(src.slice(Math.max(0, m.index! - 20), m.index!))) continue;
    let i = m.index! + m[0].length;
    let arg = "";
    for (let k = 0; k <= argIndex; k++) {
      const r = readExpr(src, i);
      arg = r.text;
      i = r.end + 1;
    }
    keys.push(literalValue(src, arg, 0) ?? arg);
  }
  return keys;
}

function lineOf(src: string, at: number): number {
  return src.slice(0, at).split("\n").length;
}

/** Resolves a key expression; a wrapper parameter expands to its call sites. */
function resolveKeys(src: string, expr: string, at: number, cookieKeyFromTemplate = false): Array<{ key: string; expr: string }> {
  const direct = literalValue(src, expr, 0);
  if (direct !== null && !direct.startsWith("*")) {
    return [{ key: cookieKeyFromTemplate ? direct.split("=")[0].trim() : direct, expr: cookieKeyFromTemplate ? cookieKeySource(expr) : expr }];
  }
  // `${name}=…` or a bare identifier that is a wrapper's parameter.
  const id = cookieKeyFromTemplate
    ? expr.match(/^`\$\{\s*([\w$]+)\s*\}=/)?.[1]
    : /^[A-Za-z_$][\w$]*$/.test(expr.trim())
      ? expr.trim()
      : undefined;
  if (id) {
    const fn = wrapperOf(src, at, id);
    if (fn) {
      const decl = src.slice(0, at).lastIndexOf(fn);
      const params = src.slice(decl).match(/\(([^)]*)\)/)?.[1].split(",").map((p) => p.trim().split(/[\s:=?]/)[0]) ?? [];
      const idx = params.indexOf(id);
      return callSiteKeys(src, fn, idx).map((k) => ({ key: k, expr: `${fn}(${k})` }));
    }
  }
  return [{ key: direct ?? expr, expr: cookieKeyFromTemplate ? cookieKeySource(expr) : expr }];
}

/** The key part of a cookie string's source: everything before the first `=` (the value and attributes are not the key). */
function cookieKeySource(expr: string): string {
  return expr.split("=")[0];
}

export function scanSource(file: string, src: string): Write[] {
  const writes: Write[] = [];

  // setItem on any receiver.
  for (const m of src.matchAll(/([\w$.?\]\)]*?)\??\.setItem\s*\(/g)) {
    const receiver = m[1];
    const store: Store = /sessionStorage/.test(receiver) ? "sessionStorage" : /localStorage/.test(receiver) ? "localStorage" : "storage";
    const start = m.index! + m[0].length;
    const { text } = readExpr(src, start);
    for (const { key, expr } of resolveKeys(src, text, m.index!)) {
      writes.push({ store, key, expr, file, line: lineOf(src, m.index!) });
    }
  }

  // document.cookie = "key=value; …"
  for (const m of src.matchAll(/document\.cookie\s*=(?!=)\s*/g)) {
    const start = m.index! + m[0].length;
    const { text } = readExpr(src, start, ";");
    const raw = text.trim();
    // A clear: `key=;` with Max-Age=0 (or an expiry in the past).
    if (/^[`'"][^=]*=\s*;/.test(raw) && /max-age=0\b|expires=thu, 01 jan 1970/i.test(raw)) continue;
    for (const { key, expr } of resolveKeys(src, raw, m.index!, true)) {
      writes.push({ store: "cookie", key, expr, file, line: lineOf(src, m.index!) });
    }
  }

  // response.cookies.set(key, value, options)
  for (const m of src.matchAll(/\.cookies\.set\s*\(/g)) {
    const start = m.index! + m[0].length;
    const first = readExpr(src, start);
    const second = readExpr(src, first.end + 1);
    const third = src[second.end] === "," ? readExpr(src, second.end + 1) : { text: "" };
    if (/^(["'`])\1$/.test(second.text) && /maxAge\s*:\s*0\b/.test(third.text)) continue;
    for (const { key, expr } of resolveKeys(src, first.text, m.index!)) {
      writes.push({ store: "response-cookie", key, expr, file, line: lineOf(src, m.index!) });
    }
  }

  // indexedDB.open(name, version)
  for (const m of src.matchAll(/indexedDB\.open\s*\(/g)) {
    const { text } = readExpr(src, m.index! + m[0].length);
    for (const { key, expr } of resolveKeys(src, text, m.index!)) {
      writes.push({ store: "indexedDB", key, expr, file, line: lineOf(src, m.index!) });
    }
  }

  return writes;
}

const isCredential = (w: Pick<Write, "key" | "expr">) => CREDENTIAL_PATTERN.test(w.key) || CREDENTIAL_PATTERN.test(w.expr);

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "__tests__" || e.name === "node_modules" || e.name.startsWith(".")) continue;
        walk(p);
      } else if (/\.(?:ts|tsx|js|jsx|mjs)$/.test(e.name) && !/\.(?:test|spec)\.[jt]sx?$/.test(e.name) && !e.name.endsWith(".d.ts")) {
        out.push(p);
      }
    }
  };
  walk(WEB_SRC);
  for (const e of fs.readdirSync(WEB_PUBLIC)) if (/\.(?:js|mjs)$/.test(e)) out.push(path.join(WEB_PUBLIC, e));
  return out;
}

function census(): Write[] {
  return sourceFiles().flatMap((p) => scanSource(path.relative(WEB, p).split(path.sep).join("/"), fs.readFileSync(p, "utf8")));
}

const id = (r: { store: string; key: string; file: string }) => `${r.store} ${r.key} @ ${r.file}`;

/** The census against a registry: credential writes with no row, and rows with no write. */
function compare(writes: Write[], registry: RegistryRow[]) {
  const found = new Map<string, Write>();
  for (const w of writes.filter(isCredential)) if (!found.has(id(w))) found.set(id(w), w);
  const rows = new Set(registry.map(id));
  const unregistered = [...found.values()].filter((w) => !rows.has(id(w))).map((w) => `${id(w)}:${w.line} (key source: ${w.expr})`);
  const stale = registry.filter((r) => !found.has(id(r))).map(id);
  return { unregistered, stale };
}

/* -------------------------------------------------------------------- tests */

describe("CSC-01 the scanner finds the writes it must", () => {
  const fixture = [
    `const TOKEN_KEY = "kf_token";`,
    `const NEW_KEY = 'kf_new_secret';`,
    `export function save(t: string) {`,
    `  localStorage.setItem('kf_new_token', t);`,
    `  window.sessionStorage.setItem(NEW_KEY, t);`,
    `  ls?.setItem(\`\${TOKEN_KEY}_copy\`, t);`,
    `  document.cookie = \`\${TOKEN_KEY}=\${encodeURIComponent(t)}; Path=/; Max-Age=60\`;`,
    `  document.cookie = \`\${TOKEN_KEY}=; Path=/; Max-Age=0\`;`,
    `  document.cookie = "kf_auth_flag=1; path=/";`,
    `  res.cookies.set("kf_server_session", t, { httpOnly: true });`,
    `  res.cookies.set("kf_token", "", { maxAge: 0, path: "/" });`,
    `  indexedDB.open("kf-token-vault", 1);`,
    `  localStorage.setItem("kf-products-view", "grid");`,
    `}`,
    `function writeCookie(name: string, value: string) {`,
    `  document.cookie = \`\${name}=\${value}; Path=/\`;`,
    `}`,
    `writeCookie("kf_wrapped_session", "x");`,
  ].join("\n");
  const writes = scanSource("src/fixture.ts", fixture);
  const keys = writes.map((w) => `${w.store}:${w.key}`);

  it("resolves literals, consts, templates and wrapper call sites", () => {
    expect(keys).toEqual(
      expect.arrayContaining([
        "localStorage:kf_new_token",
        "sessionStorage:kf_new_secret",
        "storage:kf_token_copy",
        "cookie:kf_token",
        "cookie:kf_auth_flag",
        "response-cookie:kf_server_session",
        "indexedDB:kf-token-vault",
        "localStorage:kf-products-view",
        "cookie:kf_wrapped_session",
      ]),
    );
  });

  it("does not count clears", () => {
    expect(keys.filter((k) => k === "cookie:kf_token")).toHaveLength(1);
    expect(keys).not.toContain("response-cookie:kf_token");
  });

  it("a new kf_new_token write is reported as unregistered, and a non-credential key is not", () => {
    const { unregistered } = compare(writes, []);
    expect(unregistered.some((u) => u.startsWith("localStorage kf_new_token @ src/fixture.ts"))).toBe(true);
    expect(unregistered.some((u) => u.includes("kf-products-view"))).toBe(false);
  });
});

describe("CSC-02/03 the census matches the registry", () => {
  const writes = census();
  if (process.env.CSC_DUMP) for (const w of writes) console.log(`CSC ${isCredential(w) ? "CRED" : "----"} ${w.store} ${w.key} @ ${w.file}:${w.line}`);

  it("the scan reads the web app (sanity: it finds the session token writes)", () => {
    expect(writes.length).toBeGreaterThan(50);
    expect(writes.some((w) => w.key === "kf_token" && w.file === "src/lib/workspace.ts")).toBe(true);
  });

  it("CSC-02 every credential write is registered", () => {
    const { unregistered } = compare(writes, REGISTRY);
    expect(unregistered, "a new credential store: add a REGISTRY row saying why it is there, or do not store it").toEqual([]);
  });

  it("CSC-03 every registry row still matches a write", () => {
    const { stale } = compare(writes, REGISTRY);
    expect(stale, "a registry row matches no write: remove it").toEqual([]);
  });

  it("removing any one registry row makes the census fail", () => {
    for (let i = 0; i < REGISTRY.length; i++) {
      const without = REGISTRY.filter((_, j) => j !== i);
      expect(compare(writes, without).unregistered.length, `without row ${id(REGISTRY[i])}`).toBeGreaterThan(0);
    }
  });

  it("every registry row says why", () => {
    for (const r of REGISTRY) expect(r.why.length, id(r)).toBeGreaterThan(10);
    expect(new Set(REGISTRY.map(id)).size, "no duplicate rows").toBe(REGISTRY.length);
  });

  it("CSC-04 the stores the plan names are registered", () => {
    const keys = new Set(REGISTRY.map((r) => r.key));
    for (const k of ["kf_token", "kf_refresh_token", "kf_admin_token", "kf_admin_user_cache", "kf_auth_mode", "kf_oauth_state"]) {
      expect(keys.has(k), k).toBe(true);
    }
  });

  it("CSC-05 no credential in IndexedDB, and server cookie writes only clear", () => {
    const bad = writes.filter((w) => (w.store === "indexedDB" || w.store === "response-cookie") && isCredential(w));
    expect(bad.map((w) => `${id(w)}:${w.line}`)).toEqual([]);
  });
});

/* ------------------------------------------------------- repair round 1 */

/**
 * Repair round 1 (correctness review REPAIR, security review ACCEPT WITH FOLLOW-UPS). Each case plants an in-memory
 * sample the round-0 scanner missed.
 *
 *   CSC-06 (CSC-1, MAJOR) a call split over lines, the shape Prettier writes (key on the next line), resolves its key.
 *   CSC-07 more write channels: storage property / bracket assignment, the Cookie Store API, next/headers cookies(),
 *          a Set-Cookie header, Cache Storage names, window.name, and IndexedDB object-store writes.
 *   CSC-08 value matching: a credential in the VALUE is a credential write, whatever the key is called.
 *   CSC-09 one-hop resolution: `PREFIX + x`, an imported const (one file away), and a same-file key function.
 *   CSC-10 kf-sync-queue (public/sw.js) is a credential store: its entries keep the request headers.
 *   CSC-11 public/ is scanned recursively (public/widgets/v1/loader.js).
 *   CSC-12 every cookie row pins its attributes, and the census reads them from the source.
 */
type ScanOpts = { files?: Record<string, string> };
const scan = (file: string, src: string, opts?: ScanOpts): Write[] =>
  (scanSource as unknown as (f: string, s: string, o?: ScanOpts) => Write[])(file, src, opts);
const keysOf = (ws: Write[]) => ws.map((w) => `${w.store}:${w.key}`);

describe("CSC-06 a multi-line call resolves its key (CSC-1)", () => {
  const fixture = [
    `const MULTI_KEY = "kf_multi_secret";`,
    `export function save(t: string) {`,
    `  localStorage.setItem(`,
    `    "kf_multi_token",`,
    `    JSON.stringify({ t }),`,
    `  );`,
    `  window.sessionStorage.setItem(`,
    `    // a comment before the key`,
    `    MULTI_KEY,`,
    `    t,`,
    `  );`,
    `  res.cookies.set(`,
    `    "kf_multi_session",`,
    `    t,`,
    `    { httpOnly: true },`,
    `  );`,
    `  indexedDB.open(`,
    `    "kf-multi-token-db",`,
    `    1,`,
    `  );`,
    `}`,
  ].join("\n");
  const keys = keysOf(scan("src/fixture-multi.ts", fixture));

  it("resolves keys written on the line after the call", () => {
    expect(keys).toEqual(
      expect.arrayContaining([
        "localStorage:kf_multi_token",
        "sessionStorage:kf_multi_secret",
        "response-cookie:kf_multi_session",
        "indexedDB:kf-multi-token-db",
      ]),
    );
  });

  it("no write in the web app has an empty key", () => {
    const empty = census().filter((w) => w.key.trim() === "" || w.expr.trim() === "");
    expect(empty.map((w) => `${w.store} @ ${w.file}:${w.line}`)).toEqual([]);
  });

  it("the real multi-line write (jarvis-voice.tsx saveLocalVoice) is found with its key", () => {
    const w = census().filter((x) => x.file === "src/app/app/keyflow-command/components/jarvis-voice.tsx");
    expect(w.some((x) => x.store === "localStorage" && x.key !== "" && x.key !== "STORAGE_KEY")).toBe(true);
  });
});

describe("CSC-07 more write channels", () => {
  const fixture = [
    `export async function save(t: string) {`,
    `  localStorage["kf_bracket_token"] = t;`,
    `  sessionStorage.kf_prop_secret = t;`,
    `  await cookieStore.set("kf_cs_session", t);`,
    `  await cookieStore.set({ name: "kf_cs_obj_token", value: t });`,
    `  cookies().set("kf_next_session", t);`,
    `  (await cookies()).set("kf_next2_token", t);`,
    `  const jar = await cookies();`,
    `  jar.set("kf_jar_token", t);`,
    `  headers.append("Set-Cookie", \`kf_hdr_session=\${t}; Path=/; HttpOnly\`);`,
    `  return new Response(null, { headers: { "Set-Cookie": "kf_hdr2_token=x; Path=/" } });`,
    `}`,
    `const cache = await caches.open("kf-token-cache");`,
    `window.name = t;`,
    `const db = indexedDB.open("kf-plain-db", 1);`,
    `store.put({ accessToken: t });`,
  ].join("\n");
  const ws = scan("src/fixture-channels.ts", fixture);
  const keys = keysOf(ws);

  it("finds each channel's key", () => {
    expect(keys).toEqual(
      expect.arrayContaining([
        "localStorage:kf_bracket_token",
        "sessionStorage:kf_prop_secret",
        "cookie:kf_cs_session",
        "cookie:kf_cs_obj_token",
        "response-cookie:kf_next_session",
        "response-cookie:kf_next2_token",
        "response-cookie:kf_jar_token",
        "response-cookie:kf_hdr_session",
        "response-cookie:kf_hdr2_token",
        "cacheStorage:kf-token-cache",
        "window.name:window.name",
      ]),
    );
  });

  it("window.name holding a token and an IndexedDB put of a token are credential writes", () => {
    const { unregistered } = compare(ws, []);
    expect(unregistered.some((u) => u.startsWith("window.name window.name @"))).toBe(true);
    expect(unregistered.some((u) => u.startsWith("indexedDB kf-plain-db @"))).toBe(true);
  });
});

describe("CSC-08 a credential in the value counts", () => {
  const fixture = [
    `export function save(session: { access_token: string }, accessToken: string) {`,
    `  localStorage.setItem("kf_prefs", JSON.stringify({ accessToken }));`,
    `  document.cookie = \`kf_x=\${session.access_token}; Path=/\`;`,
    `  sessionStorage.setItem("kf_draft", refreshToken);`,
    `  localStorage.setItem("kf_view", "grid");`,
    `  localStorage.setItem("kf_count", String(count));`,
    `}`,
  ].join("\n");
  const { unregistered } = compare(scan("src/fixture-values.ts", fixture), []);

  it("flags writes whose value is a token, whatever the key", () => {
    for (const k of ["localStorage kf_prefs", "cookie kf_x", "sessionStorage kf_draft"]) {
      expect(unregistered.some((u) => u.startsWith(`${k} @`)), k).toBe(true);
    }
  });

  it("does not flag plain values", () => {
    expect(unregistered.some((u) => u.includes("kf_view") || u.includes("kf_count"))).toBe(false);
  });
});

describe("CSC-09 one-hop key resolution", () => {
  const files = {
    "src/lib/fixture-keys.ts": `export const STORE_KEY = "kf_refresh_token_copy";\nexport const PLAIN = "kf_plain";`,
  };
  const fixture = [
    `import { STORE_KEY } from "./fixture-keys";`,
    `import { PLAIN as RENAMED } from "@/lib/fixture-keys";`,
    `const PREFIX = "kf-scroll-";`,
    `const keyFor = (id: string) => \`kf_token_\${id}\`;`,
    `function vaultKey(id: string) {`,
    `  return \`kf_vault_secret_\${id}\`;`,
    `}`,
    `export function save(route: string, id: string, t: string) {`,
    `  sessionStorage.setItem(PREFIX + route, t);`,
    `  localStorage.setItem(STORE_KEY, t);`,
    `  localStorage.setItem(RENAMED, "1");`,
    `  localStorage.setItem(keyFor(id), "1");`,
    `  localStorage.setItem(vaultKey(id), "1");`,
    `}`,
  ].join("\n");
  const keys = keysOf(scan("src/lib/fixture-hop.ts", fixture, { files }));

  it("resolves concatenation, imported consts and key functions", () => {
    expect(keys).toEqual(
      expect.arrayContaining([
        "sessionStorage:kf-scroll-*",
        "localStorage:kf_refresh_token_copy",
        "localStorage:kf_plain",
        "localStorage:kf_token_*",
        "localStorage:kf_vault_secret_*",
      ]),
    );
  });

  it("the census resolves the app's own concatenated key (use-return-navigation.ts)", () => {
    expect(census().some((w) => w.file === "src/lib/use-return-navigation.ts" && w.key === "kf-scroll-*")).toBe(true);
  });
});

describe("CSC-10 kf-sync-queue keeps request headers, so it is a credential store", () => {
  it("public/sw.js kf-sync-queue is a credential write, registered with its follow-up", () => {
    const w = census().find((x) => x.store === "indexedDB" && x.key === "kf-sync-queue");
    expect(w, "the census finds kf-sync-queue").toBeTruthy();
    expect(isCredential(w!), "kf-sync-queue counts as a credential store").toBe(true);
    const row = REGISTRY.find((r) => r.key === "kf-sync-queue");
    expect(row?.followUp, "registered as a follow-up").toMatch(/Authorization/);
  });
});

describe("CSC-11 public/ is scanned recursively", () => {
  it("includes public/widgets/v1/loader.js", () => {
    const files = sourceFiles().map((p) => path.relative(WEB, p).split(path.sep).join("/"));
    expect(files).toContain("public/sw.js");
    expect(files).toContain("public/widgets/v1/loader.js");
  });
});

describe("CSC-12 cookie attributes are pinned", () => {
  it("parses attributes, resolving consts and the https-only Secure", () => {
    const fixture = [
      `const K = "kf_attr_token";`,
      `const MAX = 60 * 60 * 24 * 7;`,
      `export function w(t: string) {`,
      `  const secure = isHttps() ? "; Secure" : "";`,
      `  document.cookie = \`\${K}=\${encodeURIComponent(t)}; Path=/; Max-Age=\${MAX}; SameSite=Lax\${secure}\`;`,
      `  document.cookie = "kf_plain_session=1; path=/; max-age=60; Secure; HttpOnly";`,
      `}`,
    ].join("\n");
    const ws = scan("src/fixture-attrs.ts", fixture) as Array<Write & { attrs?: string[] }>;
    expect(ws.find((w) => w.key === "kf_attr_token")?.attrs).toEqual(["path=/", "max-age=604800", "samesite=lax", "secure-on-https"]);
    expect(ws.find((w) => w.key === "kf_plain_session")?.attrs).toEqual(["path=/", "max-age=60", "secure", "httponly"]);
  });

  it("every cookie row's attrs match what the source writes", () => {
    const writes = census() as Array<Write & { attrs?: string[] }>;
    for (const r of REGISTRY.filter((x) => x.store === "cookie")) {
      expect(r.attrs, `${id(r)} pins its attributes`).toBeDefined();
      const w = writes.find((x) => id(x) === id(r));
      expect(w?.attrs, id(r)).toEqual(r.attrs);
    }
  });
});
