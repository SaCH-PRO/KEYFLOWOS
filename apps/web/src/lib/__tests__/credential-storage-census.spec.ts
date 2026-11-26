/**
 * RR-SESSION-STORAGE-CENSUS: every browser-readable place the web app stores a credential or session value.
 *
 * The first safe slice of "HttpOnly session cookies, no refresh token in localStorage". The move itself is an owner
 * question. This spec only pins today's set, so a new store cannot appear without someone writing down why.
 *
 * It reads the web app's browser code (apps/web/src, non-test files, and apps/web/public, recursively). Each file is
 * parsed once by the TypeScript parser and its writes are found on the AST (scanSourceAst, repair round 6, D-274): a
 * call's method, receiver and argument nodes, an assignment's target, a Set-Cookie property and a Headers tuple are
 * nodes, so no comment, line break or regex literal can hide or cut one. A file with parse diagnostics is scanned by
 * the text scanner instead (scanSourceText), with no comment exclusions, so every match in it counts; CSC-30 pins that
 * the tree has no such file. It finds every write to:
 *   - localStorage / sessionStorage: `.setItem(key, …)` on any receiver (`localStorage`, `window.sessionStorage`,
 *     or a wrapper such as `ls?.setItem`), and property or bracket assignment (`localStorage["k"] = v`);
 *   - a script-readable cookie: `document.cookie = "key=…"`, and the Cookie Store API (`cookieStore.set`);
 *   - a response cookie: `.cookies.set(…)`, `cookies().set(…)` or a `cookies()` jar's `.set(…)` (middleware, route
 *     handlers, server actions), and a `Set-Cookie` header (`headers.set/append`, `res.setHeader`, a string or an
 *     array, `{ "Set-Cookie": … }`, `new Headers([["Set-Cookie", …]])`);
 *   - IndexedDB: `indexedDB.open(name, …)`, and, in any file that works with object stores (the database opened there
 *     or elsewhere): `put` / `add` on a store (a variable bound from `.objectStore(…)`, a parameter typed
 *     IDBObjectStore, a chained `.objectStore(<any expression>)`, or, in a file that opens a database, any store-named
 *     receiver) and `update` on a cursor (a name holding "cursor", `cur`, or a parameter typed IDBCursor[WithValue]);
 *   - Cache Storage: the names opened (`[self.]caches.open`) and what is `put` into a cache bound from it (`const`,
 *     `let` or a later assignment, `.then((c) => …)`, `.then(function (c) …)`, or `(await caches.open(n)).put(…)`);
 *   - `window.name` (=, and the logical assignments ||= ??= &&=, as for document.cookie and storage).
 * Code inside a string or template literal that names any store the scanners know (CODE_HINT: setItem,
 * localStorage, sessionStorage, indexedDB, objectStore, caches, cookieStore, document.cookie / document[, .cookies,
 * cookies(, set-cookie, window/self/globalThis .name) is parsed as JS by the same scanner (the text scanner if it does
 * not parse) and reported at host-file lines mapped through the raw text (CSC-37, CSC-43, CSC-48); so is the JSX
 * text of a <script> / <Script> element (CSC-45). A template substitution is resolved in the host file (a const, a
 * JSON.stringify of one); one that cannot be resolved in full, or whose own source names a credential, stands for a
 * secret, so the write fails closed (CSC-44, CSC-52, CSC-54). This
 * path errs toward counting: a string that only quotes a write (help text, an error message) counts as that write, a
 * deliberate, known false positive (CSC-47).
 * Response cookie jars include aliases (`const jar = res.cookies`, `res["cookies"]`, an aliased next/headers
 * `cookies` import); a Set-Cookie header name may be a const or a concatenation (CSC-38). In public/, a two-argument
 * put of request headers or the authorization header on any receiver is a Cache write, as is a put on a parameter
 * typed Cache anywhere (CSC-39). Keys resolve one hop through a same-file const object or enum (CSC-40).
 * A cookie may be built with `+`, a template or `[…].join("")`. A match inside a real comment is not a write; the
 * comments are the ones the TypeScript parser finds (commentRanges: the file parsed as TSX/TS/JSX/JS by its extension,
 * leading and trailing comment ranges at every node and token, none read where JSX text starts), so "/*" or "//" in a
 * string, a template, a regex literal or JSX text hides nothing.
 * A write that only clears (an empty value with Max-Age=0 / maxAge: 0) stores nothing and is not counted.
 *
 * Keys and names. Every key or name position (storage keys, cookieStore / response-cookie / document.cookie names,
 * cache names, wrapper calls, string code) goes through one resolver, resolveKeySet (rounds 12-13), on the host
 * file's AST: it either proves a finite set of runtime key strings or gives "*" for what it cannot prove, and a key
 * holding "*" is a credential write (fail closed). See resolveKeySet for the rules: scope-correct identifiers (only an
 * initialised const resolves; let / var / destructured / for / catch are "*"), parameters through their callers,
 * defaults and "undefined" (plus "*" when the function can be called from elsewhere or reassigns them), ternaries,
 * ||, ??, &&, +, templates, null / undefined as JS prints them, const-object members (last property wins) and enums,
 * same-file function returns, capped at 64 candidates. An empty set is never "no write".
 *
 * A write is a CREDENTIAL write when a resolved key holds "*", when it or the key's source text matches
 * CREDENTIAL_PATTERN (token, refresh, secret, session, auth, plus admin, verifier, password, jwt, bearer, credential,
 * api key and sid), when the VALUE's source text names a credential (VALUE_PATTERN: token, refresh, secret, session,
 * auth, password, bearer, jwt, credential, api / private / signing / access key, verifier; through JSON.stringify(x)
 * and a const one hop away), when an IndexedDB or Cache Storage write keeps request headers, and always for
 * window.name. Every credential write must have a REGISTRY row (store, key, file) saying why it is there, and every
 * row must still match a write: a new unregistered write fails CSC-02, a stale row CSC-03. A row whose key holds "*"
 * is also pinned to the key's and the value's source text of the write it was read for (CSC-71), so another write of
 * that key shape in the file is unregistered. Every cookie row pins the attributes the source writes (CSC-12).
 *
 *   CSC-01 the scanner finds the writes it must (self-test on in-memory sources, including a new kf_new_token write).
 *   CSC-02 every credential write in the web app is registered.
 *   CSC-03 every registry row still matches a write (no stale rows).
 *   CSC-04 the stores the plan names are in the registry: kf_token, kf_refresh_token, kf_admin_token,
 *          kf_admin_user_cache, kf_auth_mode and the OAuth state cookie.
 *   CSC-05 no credential is written to IndexedDB, Cache Storage or window.name, and no response cookie stores a
 *          credential (the only server writes are clears); the one known exception, kf-sync-queue, is a registered
 *          follow-up.
 *   CSC-06..12 repair round 1, CSC-13..17 repair round 2, below.
 *
 * Known gaps, recorded as follow-ups (FU-CENSUS-HARDENING), not closed here:
 *   - receivers and channels: a storage wrapper defined in another file (only same-file wrappers and callers are
 *     followed; an exported function's parameters do take "*"); a bracket write on an aliased receiver
 *     (`const ls = localStorage; ls["k"] = v`); `Object.assign(localStorage, …)`; `Object.defineProperty` on a store;
 *     `self.name` / `globalThis.name` writes; computed method names (`ls[m](k, v)`); `.call` / `.apply` / `.bind` /
 *     `Reflect.apply` on a write; a destructured `setItem`; a comma call (`(0, ls.setItem)(k, v)`); an aliased
 *     `document` (`d = document`); a destructured jar; a Headers tuple held in its own variable; `cache.add` /
 *     `cache.addAll`; `globalThis.Cache` types; `with` blocks; Dexie / idb library databases (contacts-db.ts
 *     `new Dexie(name)`);
 *   - cookie strings: a cookie built up in a variable (`let c = …; c += …; document.cookie = c`); a cookie string's
 *     VALUE and ATTRIBUTES still take a ternary's first resolvable branch (parseCookie), so `document.cookie =
 *     \`kf_session=${on ? token : ""}; Max-Age=${on ? age : 0}\`` reads as a clear (its NAME goes through the
 *     resolver);
 *   - string code: code built by concatenating strings, `new Function(args, body)` with its parameters as keys,
 *     srcDoc HTML, data: URLs, minified dynamic code, comments inside string code, string code nested deeper than 3;
 *   - values are classed by pattern on their source text (VALUE_PATTERN), not resolved: a credential reached only
 *     through an opaque name in a value is not seen.
 * Known false positives (fail closed): a string that only quotes a write counts as that write (CSC-47); in the text
 * scanner only (a file with parse errors), a type literal `{ 'set-cookie': string }` reads as a response-cookie
 * write named "*", which is now classed as a credential write (CSC-30 pins that the tree has no such file).
 *
 * Counting (CSC_DUMP=1 prints one line per write found, sorted by file, line, store and key): a write reached through a
 * wrapper is one line per call site,
 * so the same id can print twice (cookie kf_sid @ presence-sdk.ts:93, once per writeCookie call). The registry has one
 * row per credential id.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const WEB = path.join(__dirname, "..", "..", "..");
const WEB_SRC = path.join(WEB, "src");
const WEB_PUBLIC = path.join(WEB, "public");

type Store =
  | "localStorage"
  | "sessionStorage"
  | "storage"
  | "cookie"
  | "response-cookie"
  | "indexedDB"
  | "cacheStorage"
  | "window.name";

interface Write {
  store: Store;
  key: string;
  /** The key's source text, before resolution. */
  expr: string;
  /** The value's source text (an identifier with its own const text, one hop), for value matching (CSC-08). */
  value: string;
  /** Cookie writes: the attributes, lower-case, in source order; Secure set only on https is "secure-on-https". */
  attrs?: string[];
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
  /**
   * Rows whose key holds "*" (round 13): the key's and the value's source text of the write the row was read for, so
   * another write of the same key shape in that file is unregistered (CSC-71).
   */
  keyExpr?: string;
  valueExpr?: string;
}

const UNRESOLVED = "__kf_unresolved_secret__";

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
  // writeCookie(name, value, maxAgeSec) is a wrapper: its name and Max-Age are parameters, so neither is proven (round
  // 14). Its four callers (lines 102, 117, 128, 138) pass VISITOR_KEY (kf_vid, 365 days) and SESSION_KEY (kf_sid, 30
  // minutes), both top-level consts of the file.
  { store: "cookie", key: UNRESOLVED, file: "src/app/_lib/presence-sdk.ts", why: "writeCookie's cookie: the presence visitor id (kf_vid) and analytics session id (kf_sid), passed by its four callers; grants nothing.", attrs: ["path=/", "max-age=*", "samesite=lax", "secure-on-https"], keyExpr: "`${name}", valueExpr: "${encodeURIComponent(value)}" },

  // The public booking page's pending checkout, app/book/[slug]/page.tsx. Matched on its VALUE (CSC-08): the record
  // is built with withoutTokenLinks(bookingRefs), which strips the bookings' token links (SEC-W9WCN-1).
  {
    store: "localStorage",
    key: "kf_pending_checkout_*",
    file: "src/app/book/[slug]/page.tsx",
    why: "Pending public checkout (bookings, order) kept for the return from payment; withoutTokenLinks drops the booking token links, so no credential is stored.",
    keyExpr: "`kf_pending_checkout_${slug}`",
    valueExpr: "JSON.stringify({\n            bookingResults: withoutTokenLinks(bookingRefs),\n            bookingReuseKey: reuseKey,\n            orderPayload,\n            orderNumber: storeOrder?.order?.orderNumber ?? null,\n            orderId: storeOrder?.order?.id ?? null,\n            orderTotal: storeOrder?.order?.total ?? cartTotal,\n            paymentMethod: paymentMethodUI,\n            shippingZoneId,\n            items: [...cart],\n            customerEmail: orderPayload?.customer?.email ?? null,\n            confirmedDetails: serviceDetails,\n          })",
  },

  // Keys with a runtime part (repair round 12): the key resolver cannot resolve the suffix (a business id, a slug,
  // a route), so the write fails closed and must be written down. Each was read: it holds UI state, not a credential.
  { store: "localStorage", key: "kf_dunning_rules_*", file: "src/app/app/commerce/components/dunning-rules.tsx", why: "Dunning rule settings per business (JSON of the rules the owner set); the suffix is the business id.", keyExpr: "`kf_dunning_rules_${businessId}`", valueExpr: "JSON.stringify(rules)" },
  { store: "localStorage", key: "dismissed-prompts-*", file: "src/app/app/profile/components/progressive-prompts.tsx", why: "Dismissed profile prompt ids per business.", keyExpr: "`dismissed-prompts-${businessId}`", valueExpr: "JSON.stringify([...next])" },
  { store: "localStorage", key: "kf_cart_*", file: "src/app/book/[slug]/components/utils.ts", why: "Public booking-page cart per business slug.", keyExpr: "`kf_cart_${slug}`", valueExpr: "JSON.stringify(cart)" },
  { store: "localStorage", key: "kf_promo_*", file: "src/app/book/[slug]/components/utils.ts", why: "Applied promo code details per business slug.", keyExpr: "`kf_promo_${slug}`", valueExpr: "JSON.stringify(promo)" },
  { store: "sessionStorage", key: "kf-scroll-*", file: "src/lib/use-return-navigation.ts", why: "Scroll position per route, to restore it on return.", keyExpr: "SCROLL_STORAGE_PREFIX + route", valueExpr: "String(scrollY)" },

  // Keys from a call, a parameter or a block-scoped const (round 14: not proven, so UNRESOLVED). Each was read.
  { store: "localStorage", key: UNRESOLVED, file: "src/app/app/control-tower/components/morning-briefing.tsx", why: `Morning briefing dismissed flag ("1"): getDismissKey(businessId) is kf:morning-briefing:dismissed:<business>:<day>.`, keyExpr: "getDismissKey(businessId)", valueExpr: "\"1\"" },
  { store: "localStorage", key: UNRESOLVED, file: "src/app/app/control-tower/components/priority-queue.tsx", why: "Pinned control-tower item ids: getPinKey(businessId) is kf-tower-pinned-<business>.", keyExpr: "getPinKey(businessId)", valueExpr: "JSON.stringify([...ids])" },
  { store: "localStorage", key: UNRESOLVED, file: "src/app/app/control-tower/components/priority-queue.tsx", why: "Dismissed control-tower item ids and dates: getDismissKey(businessId) is kf-tower-dismissed-<business>.", keyExpr: "getDismissKey(businessId)", valueExpr: "JSON.stringify(Object.fromEntries(ids))" },
  { store: "localStorage", key: UNRESOLVED, file: "src/app/app/control-tower/components/priority-queue.tsx", why: "Snoozed control-tower item ids and wake times: getSnoozedKey(businessId) is kf-tower-snoozed-<business>.", keyExpr: "getSnoozedKey(businessId)", valueExpr: "JSON.stringify(Object.fromEntries(ids))" },
  { store: "localStorage", key: UNRESOLVED, file: "src/app/app/finance/components/finance-banner.tsx", why: `Finance banner dismissed flag ("1"): storageKey is the component const kf_finance_banner_dismissed_<from>.`, keyExpr: "storageKey", valueExpr: "\"1\"" },
  { store: "localStorage", key: UNRESOLVED, file: "src/app/app/marketing/components/unified/channel-selector.tsx", why: "Default marketing destination ids: PREF_KEY is the component const kf_default_destinations_<business>.", keyExpr: "PREF_KEY", valueExpr: "JSON.stringify(selectedDestinations.map((d) => d.id))" },
  { store: "sessionStorage", key: UNRESOLVED, file: "src/app/app/profile/components/business-genome/genome-milestone.tsx", why: `Business-genome milestone shown flag ("1"): storageKey(businessId, threshold) is kf-genome-milestone-<business or anon>-<threshold>.`, keyExpr: "key", valueExpr: "\"1\"" },
  { store: "localStorage", key: UNRESOLVED, file: "src/app/app/reports/components/shared-components.tsx", why: `Report section open/closed state ("1"/"0"): storageKey is kf-section-<persistKey>, written only when set.`, keyExpr: "storageKey", valueExpr: "next ? \"1\" : \"0\"" },
  { store: "localStorage", key: UNRESOLVED, file: "src/app/book/[slug]/components/use-wishlist.ts", why: "Public booking-page wishlist items: getStorageKey(slug) is WISHLIST_KEY_PREFIX + slug.", keyExpr: "getStorageKey(slug)", valueExpr: "JSON.stringify(items)" },
  { store: "localStorage", key: UNRESOLVED, file: "src/hooks/use-app-layout.ts", why: `Recent command-palette pages (label, href, time; at most 5): key is the block const "kf-command-recent".`, keyExpr: "key", valueExpr: "JSON.stringify(filtered.slice(0, 5))" },
  { store: "localStorage", key: UNRESOLVED, file: "src/lib/contacts-db.ts", why: "Last contacts sync time (an ISO date): key is lastSyncStorageKey(owner), LAST_SYNC_KEY_PREFIX:<cache owner>, written only when set.", keyExpr: "key", valueExpr: "new Date().toISOString()" },

  // public/sw.js: the cache names are consts inside the production `else` block, and the helpers take the name as a
  // parameter (cacheFirst / networkFirstWithTimeout(request, cacheName)), so no name is proven. Each was read: the
  // caches hold the app shell, static assets and uncredentialed API GETs (a request with an authorization header is
  // never stored, line 276).
  { store: "cacheStorage", key: UNRESOLVED, file: "public/sw.js", why: "caches.open(SHELL_CACHE), kf-shell-v3: the app shell, on install and on navigation.", keyExpr: "SHELL_CACHE", valueExpr: "" },
  { store: "cacheStorage", key: UNRESOLVED, file: "public/sw.js", why: "The app shell put on a navigation response (SHELL_CACHE, kf-shell-v3).", keyExpr: "SHELL_CACHE", valueExpr: "request clone response.clone()" },
  { store: "cacheStorage", key: UNRESOLVED, file: "public/sw.js", why: "caches.open(cacheName) in cacheFirst and networkFirstWithTimeout: STATIC_CACHE (kf-static-v3) or API_CACHE (kf-api-v4).", keyExpr: "cacheName", valueExpr: "" },
  { store: "cacheStorage", key: UNRESOLVED, file: "public/sw.js", why: "The 200 responses those two helpers put: static assets, and API GETs with no authorization header.", keyExpr: "cacheName", valueExpr: "request response.clone()" },

  // The service worker's offline write queue, public/sw.js. enqueue() stores each queued request's headers, so the
  // user's Authorization bearer is written to IndexedDB in clear (security review follow-up, not fixed here).
  {
    store: "indexedDB",
    // DB_NAME ('kf-sync-queue') is a const inside the production `else` block, so the name is not proven (round 14).
    key: UNRESOLVED,
    file: "public/sw.js",
    why: "Offline mutation queue (DB_NAME, kf-sync-queue): each entry keeps the request's headers, so the Authorization bearer lands in IndexedDB.",
    keyExpr: "DB_NAME",
    valueExpr: "entry {\n    url: request.url,\n    method: request.method,\n    headers: Array.from(request.headers.entries()),\n    body: null,\n    timestamp: Date.now(),\n  }",
    followUp: "public/sw.js enqueue() must not store the Authorization header (security review of RR-SESSION-STORAGE-CENSUS)",
  },
];

/* ------------------------------------------------------------------ scanner */

/**
 * How the scanner reads a file. `read` returns another file's source by its path relative to apps/web (for an
 * imported const, one hop); `bindings` maps a wrapper's parameters to one call site's argument text.
 */
interface Ctx {
  file: string;
  src: string;
  read?: (rel: string) => string | null;
  bindings?: Record<string, string>;
  /** Each binding's call-site offset, so its argument text is resolved in the caller's scope. */
  bindAt?: Record<string, number>;
  /** The write's offset in src: a const declared nearest before it wins (constText). */
  at?: number;
}

const MAX_DEPTH = 8;

/** Index of the first character at or after i that is not whitespace or a comment. */
function skipWs(src: string, i: number): number {
  let j = i;
  for (;;) {
    while (j < src.length && /\s/.test(src[j])) j++;
    if (src.startsWith("//", j)) {
      const nl = src.indexOf("\n", j);
      j = nl === -1 ? src.length : nl + 1;
    } else if (src.startsWith("/*", j)) {
      const end = src.indexOf("*/", j + 2);
      j = end === -1 ? src.length : end + 2;
    } else return j;
  }
}

/**
 * Reads one argument or expression starting at i (leading whitespace, line breaks and comments skipped, CSC-1), up
 * to a top-level stop character. Inside a call's parentheses a line break never ends it. In `statement` mode (the
 * right-hand side of an assignment) a line break ends it unless the line ends with an operator or the next line
 * starts with one. Comments are dropped from the returned text.
 */
function readExpr(src: string, i: number, stops = ",)", statement = false): { text: string; end: number } {
  let depth = 0;
  let j = skipWs(src, i);
  let out = "";
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'") {
      const e = skipString(src, j);
      out += src.slice(j, e);
      j = e;
      continue;
    }
    if (c === "`") {
      const e = skipTemplate(src, j);
      out += src.slice(j, e);
      j = e;
      continue;
    }
    if (src.startsWith("//", j) || src.startsWith("/*", j)) {
      j = skipWs(src, j);
      out += " ";
      continue;
    }
    // A regex literal (a "/" where an expression starts): read whole, so "\/\//" in it is not a comment (CSC4-SEC-3).
    if (c === "/" && (out.trim() === "" || /[(,=:[!&|?{};+\-*%<>~^]$/.test(out.trimEnd()))) {
      const e = skipRegexLiteral(src, j);
      out += src.slice(j, e);
      j = e;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && stops.includes(c)) break;
    else if (depth === 0 && c === "\n" && statement) {
      // The expression carries on when the next line starts with an operator, or (Prettier's shape, CSC-COR-1) when
      // this one ends with one.
      const rest = src.slice(j + 1).trimStart();
      if (!/^[+.?:|&]/.test(rest) && !/[+\-*/|&?:,(=[{]\s*$/.test(out)) break;
    }
    out += c;
    j++;
  }
  return { text: out.trim(), end: j };
}

/** A regex literal from its opening "/": past the closing "/" and its flags (classes and escapes kept), or to the line break. */
function skipRegexLiteral(src: string, i: number): number {
  let j = i + 1;
  let inClass = false;
  while (j < src.length && src[j] !== "\n") {
    const c = src[j];
    if (c === "\\") j += 2;
    else if (c === "[" || c === "]") {
      inClass = c === "[";
      j++;
    } else if (c === "/" && !inClass) {
      j++;
      while (j < src.length && /[a-z]/i.test(src[j])) j++;
      return j;
    } else j++;
  }
  return j;
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

/** Splits text on a top-level separator character (outside strings, templates and brackets). */
function splitTop(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  let j = 0;
  while (j < text.length) {
    const c = text[j];
    if (c === '"' || c === "'") j = skipString(text, j);
    else if (c === "`") j = skipTemplate(text, j);
    else {
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
      else if (depth === 0 && c === sep) {
        parts.push(text.slice(last, j));
        last = j + 1;
      }
      j++;
    }
  }
  parts.push(text.slice(last));
  return parts.map((p) => p.trim());
}

/** `cond ? a : b` at the top level: [a, b], else null (`?.` and `??` are not ternaries). */
function ternaryBranches(text: string): [string, string] | null {
  let depth = 0;
  let q = -1;
  let nested = 0;
  for (let j = 0; j < text.length; j++) {
    const c = text[j];
    if (c === '"' || c === "'") j = skipString(text, j) - 1;
    else if (c === "`") j = skipTemplate(text, j) - 1;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (depth === 0 && c === "?" && text[j + 1] !== "." && text[j + 1] !== "?" && text[j - 1] !== "?") {
      if (q === -1) q = j;
      else nested++;
    } else if (depth === 0 && c === ":" && q !== -1) {
      if (nested > 0) nested--;
      else return [text.slice(q + 1, j).trim(), text.slice(j + 1).trim()];
    }
  }
  return null;
}

/** The `${…}` pieces of a template literal's body, in order: [literal, expr, literal, expr, …, literal]. */
function templateParts(body: string): string[] {
  const parts: string[] = [];
  let j = 0;
  let last = 0;
  while (j < body.length) {
    if (body[j] === "\\") j += 2;
    else if (body[j] === "$" && body[j + 1] === "{") {
      parts.push(body.slice(last, j));
      let depth = 1;
      let k = j + 2;
      while (k < body.length && depth > 0) {
        if (body[k] === "`") k = skipTemplate(body, k) - 1;
        else if (body[k] === '"' || body[k] === "'") k = skipString(body, k) - 1;
        else if (body[k] === "{") depth++;
        else if (body[k] === "}") depth--;
        k++;
      }
      parts.push(body.slice(j + 2, k - 1));
      j = k;
      last = k;
    } else j++;
  }
  parts.push(body.slice(last));
  return parts;
}

const IDENT = /^[A-Za-z_$][\w$]*$/;
/** A `cond ? "; Secure" : ""` attribute: Secure on https only. */
const SECURE_TERNARY = /\?\s*(["'`]);\s*Secure\1\s*:\s*(["'`])\2/i;
const SECURE_MARK = "; secure-on-https";

/**
 * The source text of `const|let|var NAME = …` in the file, or null. With `at` (the write's offset), the nearest
 * declaration before it wins, so a block-scoped `const key` resolves to the one in scope; otherwise the first.
 */
function constText(src: string, name: string, at?: number): string | null {
  const re = new RegExp(`\\b(?:const|let|var)\\s+${name.replace(/\$/g, "\\$")}\\b\\s*(?::\\s*[^=;\\n]+)?=(?!=)\\s*`, "g");
  const all = [...src.matchAll(re)];
  if (all.length === 0) return null;
  const before = at === undefined ? [] : all.filter((m) => m.index! < at);
  const m = before.length > 0 ? before[before.length - 1] : all[0];
  return readExpr(src, m.index! + m[0].length, ",;", true).text;
}

/** Resolves an imported binding one hop: `import { A as B } from "./x"` → the const A in x. */
function importedText(ctx: Ctx, name: string): { text: string; ctx: Ctx } | null {
  if (!ctx.read) return null;
  for (const m of ctx.src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    for (const spec of m[1].split(",")) {
      const [orig, local] = spec.trim().replace(/^type\s+/, "").split(/\s+as\s+/).map((x) => x.trim());
      if ((local ?? orig) !== name) continue;
      const from = m[2];
      let base: string;
      if (from.startsWith("@/")) base = `src/${from.slice(2)}`;
      else if (from.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(ctx.file), from));
      else return null;
      for (const ext of ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"]) {
        const other = ctx.read(base + ext);
        if (other === null) continue;
        const text = constText(other, orig);
        // One hop: the other file's own consts resolve, its imports do not.
        return text === null ? null : { text, ctx: { file: base + ext, src: other } };
      }
      return null;
    }
  }
  return null;
}

/** The index just past the `}` that closes the block opened at `open`. */
function blockEnd(src: string, open: number): number {
  let depth = 0;
  let j = open;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'") j = skipString(src, j);
    else if (c === "`") j = skipTemplate(src, j);
    else if (src.startsWith("//", j) || src.startsWith("/*", j)) j = skipWs(src, j);
    else {
      if (c === "{") depth++;
      else if (c === "}" && --depth === 0) return j + 1;
      j++;
    }
  }
  return j;
}

/**
 * `function fn(…) { … return X` or `const fn = (…) => X`: the texts it can return (an expression body, or each
 * `return` in the block body, in order), or [] when fn is not a function of this file.
 */
function functionReturnTexts(src: string, fn: string): string[] {
  const name = fn.replace(/\$/g, "\\$");
  const returns = (open: number) => {
    const body = src.slice(open, blockEnd(src, open));
    return [...body.matchAll(/\breturn\s+/g)].map((r) => readExpr(body, r.index! + r[0].length, ";", true).text);
  };
  const arrow = src.match(new RegExp(`\\b(?:const|let)\\s+${name}\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[\\w$]+)\\s*(?::\\s*[^=]+)?=>\\s*`));
  if (arrow && arrow.index !== undefined) {
    const at = arrow.index + arrow[0].length;
    return src[at] === "{" ? returns(at) : [readExpr(src, at, ",;", true).text];
  }
  const decl = src.match(new RegExp(`\\bfunction\\s+${name}\\s*\\([^)]*\\)[^{]*\\{`));
  if (decl && decl.index !== undefined) return returns(decl.index + decl[0].length - 1);
  return [];
}

/** `60 * 60 * 24` and the like: digits joined by * and +, else null. */
function numberValue(t: string): string | null {
  if (!/^[\d_\s*+]+$/.test(t) || !/\d/.test(t)) return null;
  const sum = t.split("+").reduce((acc, term) => acc + term.split("*").reduce((p, f) => p * Number(f.trim().replace(/_/g, "")), 1), 0);
  return Number.isFinite(sum) ? String(sum) : null;
}

/**
 * The value of a key or cookie expression, as far as the source tells it: string and template literals, numbers,
 * `a + b`, a same-file const, a const imported one file away, a wrapper's bound argument, and a same-file function
 * that returns a template (CSC-09). An unknown piece is "*"; a wholly unknown expression is null. A `? "; Secure" : ""`
 * piece renders as "; secure-on-https" (CSC-12).
 */
function literalValue(ctx: Ctx, text: string, depth = 0): string | null {
  const t = text.trim().replace(/\s+as\s+const$/, "");
  if (depth > MAX_DEPTH || t === "") return null;
  // One whole string literal only: a yoda `"https:" === p ? "; Secure" : ""` starts and ends with a quote too (CSC-A4).
  if ((t[0] === '"' || t[0] === "'") && skipString(t, 0) === t.length) return t.slice(1, -1);
  if (t.startsWith("`") && t.endsWith("`") && splitTop(t, "+").length === 1) {
    return templateParts(t.slice(1, -1))
      .map((p, i) => (i % 2 === 0 ? p : (literalValue(ctx, p, depth + 1) ?? "*")))
      .join("");
  }
  const sum = splitTop(t, "+");
  if (sum.length > 1) {
    const num = numberValue(t);
    if (num !== null) return num;
    return sum.map((p) => literalValue(ctx, p, depth + 1) ?? "*").join("");
  }
  const num = numberValue(t);
  if (num !== null) return num;
  if (SECURE_TERNARY.test(t)) return SECURE_MARK;
  const branches = ternaryBranches(t);
  if (branches) {
    for (const b of branches) {
      if (/^(?:null|undefined)$/.test(b)) continue;
      const v = literalValue(ctx, b, depth + 1);
      if (v !== null) return v;
    }
    return null;
  }
  // One-hop property access on a same-file const object or enum: K.a, K["a"], E.A (CSC6-SEC-4).
  const member = t.match(/^([A-Za-z_$][\w$]*)\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*(["'])([^"']*)\3\s*\])$/);
  if (member) {
    const [, obj, dotProp, , bracketProp] = member;
    const prop = dotProp ?? bracketProp;
    // Every regex character of the name escaped (COR7-5): K["a(b"] must not throw, K["a.b"] must not match aXb.
    const p = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const propRe = (sep: string) => new RegExp(`(?:^|[{,\\s])(?:${p}|"${p}"|'${p}')\\s*${sep}\\s*`);
    const objText = constText(ctx.src, obj, ctx.at);
    if (objText !== null && objText.trim().startsWith("{")) {
      const m = objText.match(propRe(":"));
      if (m && m.index !== undefined) return literalValue(ctx, readExpr(objText, m.index + m[0].length, ",}").text, depth + 1);
    }
    const en = ctx.src.match(new RegExp(`\\benum\\s+${obj.replace(/\$/g, "\\$")}\\s*\\{`));
    if (en && en.index !== undefined) {
      const open = en.index + en[0].length - 1;
      const body = ctx.src.slice(open, blockEnd(ctx.src, open));
      const m = body.match(propRe("="));
      if (m && m.index !== undefined) return literalValue(ctx, readExpr(body, m.index + m[0].length, ",}").text, depth + 1);
    }
  }
  if (IDENT.test(t)) {
    if (ctx.bindings && Object.hasOwn(ctx.bindings, t)) return literalValue({ ...ctx, bindings: undefined }, ctx.bindings[t], depth + 1);
    const own = constText(ctx.src, t, ctx.at);
    if (own !== null) return literalValue(ctx, own, depth + 1);
    const imported = importedText(ctx, t);
    if (imported) return literalValue(imported.ctx, imported.text, depth + 1);
    return null;
  }
  const call = t.match(/^([A-Za-z_$][\w$]*)\s*\(/);
  if (call && t.endsWith(")")) {
    // The first return that resolves to a key (`if (!owner) return null; return \`kf_…\`` resolves to the second).
    for (const ret of functionReturnTexts(ctx.src, call[1])) {
      if (/^(?:null|undefined|""|''|``)$/.test(ret)) continue;
      const v = literalValue({ ...ctx, bindings: undefined }, ret, depth + 1);
      if (v !== null) return v;
    }
  }
  return null;
}

/** The raw text a value expression stands for, one hop: an identifier's own const text is added (CSC-08). */
function valueText(ctx: Ctx, text: string): string {
  const t = text.trim();
  const hop = (id: string) => (ctx.bindings && Object.hasOwn(ctx.bindings, id) ? ctx.bindings[id] : constText(ctx.src, id, ctx.at));
  if (IDENT.test(t)) {
    const own = hop(t);
    if (own !== null && own !== undefined) return `${t} ${own}`;
  }
  // JSON.stringify(x) / String(x) of a const: x's own text too, one hop (CSC-13).
  const extra = [...t.matchAll(/\b(?:JSON\s*\.\s*stringify|String)\s*\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g)]
    .map((m) => hop(m[1]))
    .filter((x): x is string => typeof x === "string");
  return [t, ...extra].join(" ");
}

/** The parameter names in a parameter list's text (`a: string, b = 1, c?`). */
const paramNames = (list: string) =>
  list
    .split(",")
    .map((p) => p.trim().split(/[\s:=?]/)[0])
    .filter((p) => p !== "");

/**
 * The function that holds offset `at` and has `param` as a parameter (the innermost such, on the AST; round 13: not
 * an earlier function that happens to share the parameter name), its name and parameters, and whether it can be
 * called from elsewhere. A file that does not parse falls back to the nearest earlier regex match.
 */
function wrapperOf(src: string, at: number, param: string): { fn: string; params: string[]; elsewhere: boolean } | null {
  const parsed = parseCacheBySrc(src);
  if (parsed && parsed.ok) {
    const path = pathAt(parsed.sf, at);
    for (let i = path.length - 1; i >= 0; i--) {
      const node = path[i];
      if (!ts.isFunctionLike(node)) continue;
      const params = node.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : ""));
      if (!params.includes(param)) {
        if (node.parameters.some((p) => bindsName(p.name, param))) return null;
        continue;
      }
      const name = functionName(node);
      return name ? { fn: name, params, elsewhere: calledFromElsewhere(parsed.sf, node) || reassignedIn(node, param) } : null;
    }
    return null;
  }
  const before = src.slice(0, at);
  const re = /(?:function\s+([\w$]+)\s*\(|(?:const|let)\s+([\w$]+)\s*=\s*(?:async\s*)?\()([^)]*)\)/g;
  let found: { fn: string; params: string[]; elsewhere: boolean } | null = null;
  for (const m of before.matchAll(re)) {
    const params = paramNames(m[3]);
    if (params.includes(param)) found = { fn: m[1] ?? m[2], params, elsewhere: true };
  }
  return found;
}

/** The argument texts of each call to `fn` in the file (its declaration skipped). */
function callSites(src: string, fn: string): Array<{ args: string[]; at: number }> {
  const sites: Array<{ args: string[]; at: number }> = [];
  const re = new RegExp(`(?<![\\w$.])${fn.replace(/\$/g, "\\$")}\\s*\\(`, "g");
  for (const m of src.matchAll(re)) {
    if (/(?:function|const|let)\s+$/.test(src.slice(Math.max(0, m.index! - 20), m.index!))) continue;
    const args: string[] = [];
    let i = m.index! + m[0].length;
    for (;;) {
      const r = readExpr(src, i);
      if (r.text !== "") args.push(r.text);
      if (src[r.end] !== ",") break;
      i = r.end + 1;
    }
    sites.push({ args, at: m.index! });
  }
  return sites;
}

/**
 * The comments of a file, as the TypeScript parser finds them (CSC-B1..B3, CSC3-COR-1). The file is parsed as TSX,
 * TS, JSX or JS by its extension, and the leading and trailing comment ranges are collected at every node and token
 * (getChildren), so a comment is found wherever the language puts one, a JSX expression comment included. JSX text is text:
 * no range is read from a position where JSX text starts, so "Upload (paths like /* allowed)", a lone backtick or
 * " // " in JSX text opens nothing. Strings, templates and regex literals are tokens, never trivia, so a "/*" or "//"
 * inside them opens nothing either.
 */
/** One parse per file: the SourceFile, and whether it parsed with no diagnostics. */
const parseCache = new Map<string, { sf: ts.SourceFile; ok: boolean }>();
function parseFile(file: string, src: string): { sf: ts.SourceFile; ok: boolean } {
  const cacheKey = `${file}\u0000${src}`;
  const hit = parseCache.get(cacheKey);
  if (hit) return hit;
  const kind = /\.tsx$/.test(file)
    ? ts.ScriptKind.TSX
    : /\.ts$/.test(file)
      ? ts.ScriptKind.TS
      : /\.jsx$/.test(file)
        ? ts.ScriptKind.JSX
        : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  const parsed = { sf, ok: (sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length === 0 };
  parseCache.set(cacheKey, parsed);
  parseBySrc.set(src, parsed);
  return parsed;
}

/** The last parse of a source text, for helpers that only hold the text (wrapperOf), or undefined. */
const parseBySrc = new Map<string, { sf: ts.SourceFile; ok: boolean }>();
const parseCacheBySrc = (src: string) => parseBySrc.get(src);

const commentCache = new Map<string, Array<[number, number]>>();
function commentRanges(file: string, src: string): Array<[number, number]> {
  const cacheKey = `${file}\u0000${src}`;
  const cached = commentCache.get(cacheKey);
  if (cached) return cached;
  const { sf, ok } = parseFile(file, src);
  // Fail closed (CSC4-SEC-2): a file the parser cannot read cleanly gets no comment ranges, so every match the text
  // scanner finds in it counts. CSC-30 pins that the census tree parses with no diagnostics.
  if (!ok) {
    commentCache.set(cacheKey, []);
    return [];
  }
  const jsxTextStarts = new Set<number>();
  const visitText = (node: ts.Node) => {
    if (node.kind === ts.SyntaxKind.JsxText) jsxTextStarts.add(node.pos);
    ts.forEachChild(node, visitText);
  };
  visitText(sf);
  const seen = new Set<string>();
  const ranges: Array<[number, number]> = [];
  const add = (list: ts.CommentRange[] | undefined) => {
    for (const r of list ?? []) {
      const k = `${r.pos}:${r.end}`;
      if (!seen.has(k)) {
        seen.add(k);
        ranges.push([r.pos, r.end]);
      }
    }
  };
  const visit = (node: ts.Node) => {
    if (node.kind === ts.SyntaxKind.JsxText) return;
    // A JSDoc node lies inside its comment: a range read at its pos would start inside the comment and could run past
    // its */ (CSC4-SEC-1). The JSDoc block itself is found as the leading comment of the node it documents.
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    if (!jsxTextStarts.has(node.pos)) add(ts.getLeadingCommentRanges(src, node.pos));
    if (!jsxTextStarts.has(node.end)) add(ts.getTrailingCommentRanges(src, node.end));
    for (const child of node.getChildren(sf)) visit(child);
  };
  visit(sf); // getChildren includes the end-of-file token, so comments after the last token are read too.
  commentCache.set(cacheKey, ranges);
  return ranges;
}

/**
 * The character before `at`, past whitespace and comments, or "" at the start of the file. A file that parses uses
 * its real comment ranges; a file with parse errors (text scanner only) skips comments lexically: a "*\/" goes back to
 * its "/*", and a line whose "//" starts after whitespace, a line start or ; { } ( ) , [ is read only up to the "//"
 * (CSC5-SEC-4, CSC5-COR-1, CSC-35).
 */
function prevSignificant(file: string, src: string, at: number): string {
  const ranges = commentRanges(file, src);
  const lexical = !parseFile(file, src).ok;
  /** In a broken file: where a // comment starts on the line holding j, or -1. */
  const lineCommentStart = (j: number) => {
    const ls = src.lastIndexOf("\n", j) + 1;
    const line = src.slice(ls, j + 1);
    const m = line.match(/(?:^|[\s;{}(),[])\/\//);
    return m && m.index !== undefined ? ls + m.index + (m[0].length - 2) : -1;
  };
  let j = at - 1;
  while (j >= 0) {
    if (/\s/.test(src[j])) {
      j--;
      continue;
    }
    if (lexical) {
      if (src[j] === "/" && src[j - 1] === "*") {
        const open = src.lastIndexOf("/*", j - 2);
        if (open !== -1) {
          j = open - 1;
          continue;
        }
      }
      const lc = lineCommentStart(j);
      if (lc !== -1 && lc <= j) {
        j = lc - 1;
        continue;
      }
      return src[j];
    }
    const r = ranges.find(([a, b]) => a <= j && j < b);
    if (!r) return src[j];
    j = r[0] - 1;
  }
  return "";
}

/** Is offset `at` inside a real comment of the file (commentRanges)? */
function inComment(file: string, src: string, at: number): boolean {
  return commentRanges(file, src).some(([a, b]) => at >= a && at < b);
}

function lineOf(src: string, at: number): number {
  return src.slice(0, at).split("\n").length;
}

/**
 * When `id` is a parameter of the enclosing function, one context per call site with the parameters bound;
 * otherwise the context itself.
 */
function contexts(ctx: Ctx, at: number, id: string | undefined): Ctx[] {
  if (!id || !IDENT.test(id)) return [ctx];
  const w = wrapperOf(ctx.src, at, id);
  if (!w) return [ctx];
  const sites = callSites(ctx.src, w.fn);
  if (sites.length === 0) return [ctx];
  const bound = sites.map((s) => ({
    ...ctx,
    // A missing argument is left unbound: the resolver then takes the parameter's default (or "undefined").
    bindings: Object.fromEntries(w.params.flatMap((p, i) => (s.args[i] !== undefined ? [[p, s.args[i]]] : []))),
    bindAt: Object.fromEntries(w.params.map((p) => [p, s.at])),
  }));
  // A wrapper that can be called from elsewhere also gets the unbound context: its parameter then resolves to "*"
  // too (CSC-70).
  return w.elsewhere ? [...bound, ctx] : bound;
}

/** A cookie string rendered from its source: name, value and the attributes (lower-case, in order). */
function parseCookie(ctx: Ctx, raw: string): { name: string; value: string; attrs: string[] } {
  const rendered = literalValue(ctx, raw) ?? "*";
  const [pair, ...rest] = rendered.split(";");
  const eq = pair.indexOf("=");
  const name = (eq === -1 ? pair : pair.slice(0, eq)).trim();
  const value = eq === -1 ? "" : pair.slice(eq + 1).trim();
  const attrs = rest.map((a) => a.trim().toLowerCase().replace(/\s*=\s*/, "=")).filter((a) => a !== "");
  return { name, value, attrs };
}

/** The options object of a response cookie, as cookie attributes. */
function optionAttrs(ctx: Ctx, opts: string): string[] {
  const attrs: string[] = [];
  const prop = (k: string) => {
    const m = opts.match(new RegExp(`\\b${k}\\s*:\\s*`));
    return m && m.index !== undefined ? readExpr(opts, m.index + m[0].length, ",}").text : null;
  };
  const p = prop("path");
  if (p !== null) attrs.push(`path=${literalValue(ctx, p) ?? "*"}`);
  const age = prop("maxAge");
  if (age !== null) attrs.push(`max-age=${literalValue(ctx, age) ?? "*"}`);
  const same = prop("sameSite");
  if (same !== null) attrs.push(`samesite=${(literalValue(ctx, same) ?? "*").toLowerCase()}`);
  const secure = prop("secure");
  if (secure !== null && secure !== "false") attrs.push(secure === "true" ? "secure" : "secure-on-https");
  const http = prop("httpOnly");
  if (http !== null && http !== "false") attrs.push("httponly");
  return attrs;
}

const isClear = (value: string, attrs: string[]) =>
  value === "" && attrs.some((a) => a === "max-age=0" || /^expires=thu, 01 jan 1970/.test(a));

const KEY_CAP = 64;

/* ------------------------------------------------------------ key resolver (rounds 12-13) */

type Decl =
  | { kind: "const"; init: ts.Expression }
  | { kind: "param"; fn: ts.SignatureDeclaration; index: number; param: ts.ParameterDeclaration }
  | { kind: "function"; fn: ts.FunctionLikeDeclaration }
  | { kind: "enum"; decl: ts.EnumDeclaration }
  | { kind: "import" }
  | { kind: "unknown" }
  | { kind: "none" };

/** The nodes from the file down to the deepest one that holds offset `at`. */
function pathAt(sf: ts.SourceFile, at: number): ts.Node[] {
  const path: ts.Node[] = [sf];
  let node: ts.Node = sf;
  for (;;) {
    let next: ts.Node | undefined;
    ts.forEachChild(node, (c) => {
      if (next === undefined && c.getStart(sf) <= at && at < c.end) next = c;
    });
    if (!next) return path;
    path.push(next);
    node = next;
  }
}

const bindsName = (b: ts.BindingName, name: string): boolean =>
  ts.isIdentifier(b) ? b.text === name : b.elements.some((e) => !ts.isOmittedExpression(e) && bindsName(e.name, name));

/** The declaration of `name` visible at `at`: the innermost scope wins (a parameter before an outer const). */
function lookupDecl(sf: ts.SourceFile, name: string, at: number): Decl {
  const path = pathAt(sf, at);
  const inStatements = (statements: readonly ts.Statement[]): Decl | null => {
    for (const st of statements) {
      if (ts.isVariableStatement(st)) {
        const isConst = (st.declarationList.flags & ts.NodeFlags.Const) !== 0;
        for (const d of st.declarationList.declarations) {
          if (!bindsName(d.name, name)) continue;
          return isConst && ts.isIdentifier(d.name) && d.initializer ? { kind: "const", init: d.initializer } : { kind: "unknown" };
        }
      } else if (ts.isFunctionDeclaration(st) && st.name?.text === name) return { kind: "function", fn: st };
      else if (ts.isEnumDeclaration(st) && st.name.text === name) return { kind: "enum", decl: st };
      else if (ts.isClassDeclaration(st) && st.name?.text === name) return { kind: "unknown" };
      else if (ts.isImportDeclaration(st) && st.importClause) {
        const ic = st.importClause;
        if (ic.name?.text === name) return { kind: "import" };
        const nb = ic.namedBindings;
        if (nb && ts.isNamespaceImport(nb) && nb.name.text === name) return { kind: "import" };
        if (nb && ts.isNamedImports(nb) && nb.elements.some((e) => e.name.text === name)) return { kind: "import" };
      }
    }
    return null;
  };
  for (let i = path.length - 1; i >= 0; i--) {
    const node = path[i];
    if (ts.isFunctionLike(node)) {
      const idx = node.parameters.findIndex((p) => bindsName(p.name, name));
      if (idx !== -1) {
        const p = node.parameters[idx];
        return ts.isIdentifier(p.name) ? { kind: "param", fn: node, index: idx, param: p } : { kind: "unknown" };
      }
      if ((ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) && node.name?.text === name) return { kind: "function", fn: node };
    }
    if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) {
      const d = inStatements(node.statements);
      if (d) return d;
    }
    if ((ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) && node.initializer && ts.isVariableDeclarationList(node.initializer)) {
      if (node.initializer.declarations.some((d) => bindsName(d.name, name))) return { kind: "unknown" };
    }
    if (ts.isCatchClause(node) && node.variableDeclaration && bindsName(node.variableDeclaration.name, name)) return { kind: "unknown" };
  }
  return { kind: "none" };
}

/** A function-like's name as callers write it: its own name, or the const / let it is assigned to. */
function functionName(fn: ts.SignatureDeclaration): string | null {
  if ((ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name) return fn.name.text;
  const p = fn.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  return null;
}

/**
 * Can a function be called from somewhere this file does not show (CSC-70)? Exported (directly, by default, or by
 * name), anonymous, or used as a value (passed, stored, returned) rather than only called.
 */
function calledFromElsewhere(sf: ts.SourceFile, fn: ts.SignatureDeclaration): boolean {
  const name = functionName(fn);
  if (!name) return true;
  const holder = ts.isVariableDeclaration(fn.parent) ? fn.parent.parent?.parent : fn;
  const mods = holder && ts.canHaveModifiers(holder) ? (ts.getModifiers(holder) ?? []) : [];
  if (mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword)) return true;
  let asValue = false;
  const visit = (n: ts.Node) => {
    if (asValue) return;
    if (ts.isIdentifier(n) && n.text === name) {
      const p = n.parent;
      const isOwnName = (ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isVariableDeclaration(p)) && p.name === n;
      const isCallee = ts.isCallExpression(p) && p.expression === n;
      if (!isOwnName && !isCallee) asValue = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return asValue;
}

/** Is `name` assigned (=, op=, ++, --) anywhere inside `fn`? */
function reassignedIn(fn: ts.Node, name: string): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isIdentifier(n.left) && n.left.text === name) found = true;
    if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && ts.isIdentifier(n.operand) && n.operand.text === name) {
      if (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken) found = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(fn);
  return found;
}

/** The expressions a function can return: an expression body, each return (bare → undefined), and undefined when the body can end without one. */
function returnExprs(fn: ts.FunctionLikeDeclaration): Array<ts.Expression | "undefined"> {
  if (!fn.body) return ["undefined"];
  if (!ts.isBlock(fn.body)) return [fn.body];
  const out: Array<ts.Expression | "undefined"> = [];
  const visit = (n: ts.Node) => {
    if (ts.isFunctionLike(n)) return;
    if (ts.isReturnStatement(n)) out.push(n.expression ?? "undefined");
    ts.forEachChild(n, visit);
  };
  fn.body.statements.forEach(visit);
  const last = fn.body.statements[fn.body.statements.length - 1];
  if (!last || !ts.isReturnStatement(last)) out.push("undefined");
  return out;
}

/** A binding of a parameter: the expression it takes (in its own file and scope), or a fixed string. */
type Bind =
  | { expr: ts.Expression; sf: ts.SourceFile; ctx: Ctx; env: Env }
  | { literal: string }
  | { star: true }
  | { text: string; at: number | undefined };
type Env = ReadonlyMap<string, Bind>;

/**
 * The key resolver: one structural resolver for every key or name position the census reads (storage setItem and
 * bracket or property assignment, cookieStore.set and response cookies().set names, document.cookie names,
 * caches.open, wrapper calls, string code). The key TEXT is parsed as a TypeScript expression and every identifier,
 * member and call in it is resolved on the HOST file's AST, scope by scope. It PROVES a finite set of runtime key
 * strings, or gives "*" for what it cannot prove (round 13); an empty set is never "no write":
 *   - a string or no-substitution template: itself; a number: itself; null / undefined / void: the strings JS gives,
 *     "null" and "undefined", as a whole key and inside "+" and templates;
 *   - an identifier: its innermost declaration at that point. An initialised const: its initialiser, in its own
 *     scope. let / var / destructured / for / catch / class: "*". A parameter bound by a call being resolved: the
 *     argument, its default, or "undefined". An unbound parameter: its same-file callers' arguments (default or
 *     "undefined" when one is missing), plus "*" when the function can be called from elsewhere (exported, anonymous,
 *     used as a value) or reassigns it, or has no callers. A const imported one file away: resolved there. Else "*";
 *   - `a ? b : c`: b and c; `a || b`, `a ?? b`, `a && b`: a and b; `+` and templates: the product of the parts;
 *   - `K.a`, `K["a"]` on a same-file const object (the LAST property of that name; a spread after it, a getter or a
 *     method, or no such property: "*") or enum member; String(x): x;
 *   - a call of a same-file function: each of its returns (undefined when its body can end without one), its
 *     parameters bound to the call's arguments or defaults;
 *   - parentheses, as, satisfies, !, <T>x, await: the inner expression; anything else: "*".
 * A union or product over KEY_CAP candidates is "*". A write whose key holds "*" is a credential write
 * (isCredential), so whatever is not proven fails closed. A file that does not parse resolves only `const NAME =`
 * initialisers by text (constText) and gives "*" for the rest.
 */
function resolveKeySet(ctx: Ctx, text: string, depth = 0, seen: ReadonlySet<ts.Node> = new Set()): string[] {
  const t = text.trim();
  if (t === "" || depth > 12) return ["*"];
  const ksf = ts.createSourceFile("key.ts", `(${t}\n);`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const st = ksf.statements[0];
  if (
    ksf.statements.length !== 1 ||
    !st ||
    !ts.isExpressionStatement(st) ||
    !ts.isParenthesizedExpression(st.expression) ||
    (ksf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length > 0
  ) {
    return ["*"];
  }
  // The wrapper bindings of this context (contexts(): one call site's arguments), as an Env.
  const env = new Map<string, Bind>();
  for (const [k, v] of Object.entries(ctx.bindings ?? {})) env.set(k, { text: v, at: ctx.bindAt?.[k] });
  const out = resolveNode(ctx, ksf, st.expression.expression, ctx.at ?? 0, env, depth, seen);
  return out.length === 0 ? ["*"] : out;
}

function resolveNode(ctx: Ctx, nsf: ts.SourceFile, node: ts.Expression, at: number, env: Env, depth: number, seen: ReadonlySet<ts.Node>): string[] {
  const host = parseFile(ctx.file, ctx.src);
  const union = (...sets: string[][]) => {
    const out = [...new Set(sets.flat())];
    return out.length > KEY_CAP ? ["*"] : out;
  };
  const product = (sets: string[][]) => {
    let acc = [""];
    for (const set of sets) {
      if (set.length === 0) return ["*"];
      const next: string[] = [];
      for (const a of acc) for (const b of set) next.push(a + b);
      acc = [...new Set(next)];
      if (acc.length > KEY_CAP) return ["*"];
    }
    return acc;
  };
  /** Resolve a host-file expression at its own position. */
  const hostExpr = (e: ts.Expression, withEnv: Env = new Map(), more: ReadonlySet<ts.Node> = seen) =>
    resolveNode(ctx, host.sf, e, e.getStart(host.sf), withEnv, depth + 1, more);
  const fromBind = (b: Bind, more: ReadonlySet<ts.Node>): string[] => {
    if ("star" in b) return ["*"];
    if ("literal" in b) return [b.literal];
    // A wrapper binding from contexts() is argument TEXT at its call site: resolved there, as a key of its own.
    if ("text" in b) return resolveKeySet({ ...ctx, bindings: undefined, bindAt: undefined, at: b.at }, b.text, depth + 1);
    return resolveNode(b.ctx, b.sf, b.expr, b.expr.getStart(b.sf), b.env, depth + 1, more);
  };
  /** The object literal or enum an expression names, in the host file, or null. */
  const containerOf = (e: ts.Expression): ts.ObjectLiteralExpression | ts.EnumDeclaration | null => {
    let u = e;
    while (ts.isParenthesizedExpression(u) || ts.isAsExpression(u) || ts.isSatisfiesExpression(u) || ts.isNonNullExpression(u)) u = u.expression;
    if (ts.isIdentifier(u)) {
      if (!host.ok) return null;
      const d = lookupDecl(host.sf, u.text, nsf === host.sf ? u.getStart(nsf) : at);
      if (d.kind === "enum") return d.decl;
      if (d.kind !== "const") return null;
      let init = d.init;
      while (ts.isParenthesizedExpression(init) || ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) init = init.expression;
      return ts.isObjectLiteralExpression(init) ? init : null;
    }
    if (ts.isPropertyAccessExpression(u) || (ts.isElementAccessExpression(u) && ts.isStringLiteralLike(u.argumentExpression))) {
      const parent = containerOf(u.expression);
      if (!parent || !ts.isObjectLiteralExpression(parent)) return null;
      const prop = ts.isPropertyAccessExpression(u) ? u.name.text : (u.argumentExpression as ts.StringLiteralLike).text;
      const member = memberOf(parent, prop);
      if (!member || !ts.isPropertyAssignment(member)) return null;
      let init = member.initializer;
      while (ts.isParenthesizedExpression(init) || ts.isAsExpression(init)) init = init.expression;
      return ts.isObjectLiteralExpression(init) ? init : null;
    }
    return null;
  };
  /** The LAST member of an object literal named `prop`, or null when a spread follows it or it is missing. */
  const memberOf = (obj: ts.ObjectLiteralExpression, prop: string): ts.ObjectLiteralElementLike | null => {
    let found: ts.ObjectLiteralElementLike | null = null;
    for (const p of obj.properties) {
      if (ts.isSpreadAssignment(p)) {
        found = null;
        continue;
      }
      const n = p.name;
      const pn = n && (ts.isIdentifier(n) || ts.isStringLiteralLike(n) || ts.isNumericLiteral(n)) ? n.text : undefined;
      if (pn === prop) found = p;
    }
    return found;
  };
  const go = (n: ts.Expression): string[] => {
    if (
      ts.isParenthesizedExpression(n) ||
      ts.isAsExpression(n) ||
      ts.isSatisfiesExpression(n) ||
      ts.isNonNullExpression(n) ||
      ts.isTypeAssertionExpression(n) ||
      ts.isAwaitExpression(n)
    ) {
      return go(n.expression);
    }
    if (ts.isStringLiteralLike(n) || ts.isNumericLiteral(n)) return [n.text];
    if (n.kind === ts.SyntaxKind.NullKeyword) return ["null"];
    if (ts.isVoidExpression(n)) return ["undefined"];
    if (ts.isConditionalExpression(n)) return union(go(n.whenTrue), go(n.whenFalse));
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.AmpersandAmpersandToken) {
        return union(go(n.left), go(n.right));
      }
      if (op === ts.SyntaxKind.PlusToken) return product([go(n.left), go(n.right)]);
      return ["*"];
    }
    if (ts.isTemplateExpression(n)) {
      return product([[n.head.text], ...n.templateSpans.flatMap((sp) => [go(sp.expression), [sp.literal.text]])]);
    }
    if (ts.isIdentifier(n)) {
      const name = n.text;
      if (name === "undefined") return ["undefined"];
      if (env.has(name)) return fromBind(env.get(name)!, seen);
      const pos = nsf === host.sf ? n.getStart(nsf) : at;
      if (!host.ok) {
        // A file that does not parse: only a `const NAME =` initialiser, by text.
        const m = ctx.src.match(new RegExp(`\\bconst\\s+${name.replace(/\$/g, "\\$")}\\s*(?::[^=;\\n]+)?=(?!=)`));
        if (!m) return ["*"];
        const own = constText(ctx.src, name, pos);
        return own === null ? ["*"] : resolveKeySet({ ...ctx, bindings: undefined, at: pos }, own, depth + 1);
      }
      const d = lookupDecl(host.sf, name, pos);
      if (d.kind === "const") {
        if (seen.has(d.init)) return ["*"];
        return hostExpr(d.init, new Map(), new Set([...seen, d.init]));
      }
      if (d.kind === "param") {
        if (seen.has(d.fn)) return ["*"];
        const more = new Set<ts.Node>([...seen, d.fn]);
        const fnName = functionName(d.fn);
        const sets: string[][] = [];
        if (calledFromElsewhere(host.sf, d.fn) || reassignedIn(d.fn, name) || d.param.dotDotDotToken) sets.push(["*"]);
        const calls: ts.CallExpression[] = [];
        if (fnName) {
          const visit = (k: ts.Node) => {
            if (ts.isCallExpression(k) && ts.isIdentifier(k.expression) && k.expression.text === fnName) calls.push(k);
            ts.forEachChild(k, visit);
          };
          visit(host.sf);
        }
        if (calls.length === 0) sets.push(["*"]);
        for (const call of calls) {
          const arg = call.arguments[d.index];
          if (arg && ts.isSpreadElement(arg)) sets.push(["*"]);
          else if (arg) sets.push(hostExpr(arg, new Map(), more));
          else if (d.param.initializer) sets.push(hostExpr(d.param.initializer, new Map(), more));
          else sets.push(["undefined"]);
        }
        return union(...sets);
      }
      if (d.kind === "import") {
        const imported = importedText(ctx, name);
        return imported ? resolveKeySet({ ...imported.ctx, read: ctx.read }, imported.text, depth + 1) : ["*"];
      }
      return ["*"];
    }
    if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
      const prop = ts.isPropertyAccessExpression(n) ? n.name.text : ts.isStringLiteralLike(n.argumentExpression) ? n.argumentExpression.text : null;
      if (prop === null) return ["*"];
      const c = containerOf(n.expression);
      if (!c) return ["*"];
      if (ts.isEnumDeclaration(c)) {
        const m = c.members.find((x) => (ts.isIdentifier(x.name) || ts.isStringLiteral(x.name)) && x.name.text === prop);
        return m?.initializer ? hostExpr(m.initializer) : ["*"];
      }
      const member = memberOf(c, prop);
      if (!member) return ["*"];
      if (ts.isPropertyAssignment(member)) return hostExpr(member.initializer);
      if (ts.isShorthandPropertyAssignment(member)) return hostExpr(member.name);
      return ["*"];
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && !n.questionDotToken) {
      const fnName = n.expression.text;
      const pos = nsf === host.sf ? n.getStart(nsf) : at;
      const d = host.ok ? lookupDecl(host.sf, fnName, pos) : ({ kind: "none" } as Decl);
      if (d.kind === "none" && fnName === "String" && n.arguments.length === 1) return go(n.arguments[0]);
      let fn: ts.FunctionLikeDeclaration | null = null;
      if (d.kind === "function") fn = d.fn;
      if (d.kind === "const") {
        let init = d.init;
        while (ts.isParenthesizedExpression(init)) init = init.expression;
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) fn = init;
      }
      if (!fn || seen.has(fn)) return ["*"];
      const more = new Set<ts.Node>([...seen, fn]);
      const calleeEnv = new Map<string, Bind>();
      fn.parameters.forEach((p, i) => {
        const arg = n.arguments[i];
        const names: string[] = [];
        const collect = (b: ts.BindingName) => {
          if (ts.isIdentifier(b)) names.push(b.text);
          else for (const e of b.elements) if (!ts.isOmittedExpression(e)) collect(e.name);
        };
        collect(p.name);
        if (!ts.isIdentifier(p.name) || p.dotDotDotToken || (arg && ts.isSpreadElement(arg)) || reassignedIn(fn!, names[0])) {
          for (const nm of names) calleeEnv.set(nm, { star: true });
          return;
        }
        if (arg) calleeEnv.set(p.name.text, { expr: arg, sf: nsf, ctx, env });
        else if (p.initializer) calleeEnv.set(p.name.text, { expr: p.initializer, sf: host.sf, ctx, env: new Map(calleeEnv) });
        else calleeEnv.set(p.name.text, { literal: "undefined" });
      });
      return union(
        ...returnExprs(fn).map((r) => (r === "undefined" ? ["undefined"] : resolveNode(ctx, host.sf, r, r.getStart(host.sf), calleeEnv, depth + 1, more))),
      );
    }
    return ["*"];
  };
  if (depth > 12) return ["*"];
  return go(node);
}

/** A resolved key set as the keys a write is recorded under: "*" alone is UNRESOLVED; other "*" parts stay. */
const keysFrom = (set: string[]) => [...new Set((set.length === 0 ? ["*"] : set).map((k) => (k === "*" ? UNRESOLVED : k)))];

/** Each write's offset in the source it was found in (kept out of the Write objects, so they keep their shape). */
const writeOffsets = new WeakMap<Write, number>();

/** The write handlers both scanners share: they resolve keys and values from argument TEXT and push the writes. */
function handlersFor(file: string, src: string, base: Ctx, push: (w: Omit<Write, "file" | "line">, at: number) => void) {
  /** A keyed store write: key expression, value expression. */
  const keyed = (store: Store, keyExpr: string, valueExpr: string, at: number) => {
    const id = IDENT.test(keyExpr.trim()) ? keyExpr.trim() : undefined;
    for (const c of contexts({ ...base, at }, at, id)) {
      // Every candidate the key resolver gives is a write (round 12); a "*" part fails closed (isCredential).
      for (const key of keysFrom(resolveKeySet(c, keyExpr))) {
        const expr = c.bindings && id ? `${wrapperOf(src, at, id)!.fn}(${key})` : keyExpr;
        push({ store, key, expr, value: valueText(c, valueExpr) }, at);
      }
    }
  };

  /** A cookie string write (document.cookie, a Set-Cookie header). */
  const cookieString = (store: Store, rawIn: string, at: number) => {
    // [NAME, "=", t].join("") builds the same string as NAME + "=" + t (CSC-16).
    const joined = rawIn.match(/^\[([\s\S]*)\]\s*\.\s*join\s*\(\s*(?:(["'`])([\s\S]*?)\2)?\s*\)$/);
    const raw = joined ? splitTop(joined[1], ",").filter((x) => x !== "").join(joined[3] ? ` + ${JSON.stringify(joined[3])} + ` : " + ") : rawIn;
    const id = raw.match(/^`\$\{\s*([\w$]+)\s*\}=/)?.[1];
    for (const c of contexts({ ...base, at }, at, id)) {
      const { name: firstName, value, attrs } = parseCookie(c, raw);
      if (isClear(value, attrs)) continue;
      const keySource = raw.split("=")[0];
      const valueSource = raw.slice(raw.indexOf("=") + 1).split(";")[0];
      // The cookie's name through the key resolver (round 12): each candidate string's part before its first "=".
      const names = keysFrom(resolveKeySet(c, raw).map((k) => (k.includes("=") ? k.slice(0, k.indexOf("=")).trim() : "*")));
      for (const name of names.length > 0 ? names : [firstName]) {
        const expr = c.bindings && id ? `${wrapperOf(src, at, id)!.fn}(${name})` : keySource;
        push({ store, key: name, expr, value: valueText(c, valueSource), attrs }, at);
      }
    }
  };

  /** A Set-Cookie value: one cookie string, or an array of them. */
  const setCookieValue = (text: string, at: number) => {
    const t = text.trim();
    const items = t.startsWith("[") && t.endsWith("]") ? splitTop(t.slice(1, -1), ",").filter((x) => x !== "") : [t];
    for (const item of items) cookieString("response-cookie", item, at);
  };

  /** A name/value/options cookie API call, from its argument texts: (name, value, opts) or ({ name, value, … }). */
  const cookieArgs = (store: Store, at: number, args: string[]) => {
    const first = args[0] ?? "";
    if (first.startsWith("{")) {
      const obj = first;
      const prop = (k: string) => {
        const m = obj.match(new RegExp(`\\b${k}\\s*:\\s*`));
        return m && m.index !== undefined ? readExpr(obj, m.index + m[0].length, ",}").text : "";
      };
      const value = prop("value");
      const attrs = optionAttrs(base, obj);
      if (/^(["'`])\1$/.test(value) && attrs.includes("max-age=0")) return;
      for (const key of keysFrom(resolveKeySet({ ...base, at }, prop("name")))) {
        push({ store, key, expr: prop("name"), value: valueText(base, value), attrs }, at);
      }
      return;
    }
    const second = args[1] ?? "";
    const attrs = optionAttrs(base, args[2] ?? "");
    if (/^(["'`])\1$/.test(second) && attrs.includes("max-age=0")) return;
    for (const key of keysFrom(resolveKeySet({ ...base, at }, first))) push({ store, key, expr: first, value: valueText(base, second), attrs }, at);
  };

  /** A Cache Storage put into the cache opened as `nameExpr`. */
  const cachePut = (at: number, reqText: string, resText: string, nameExpr: string) => {
    const c = { ...base, at };
    push({ store: "cacheStorage", key: literalValue(c, nameExpr) ?? nameExpr, expr: nameExpr, value: `${valueText(c, reqText)} ${valueText(c, resText)}` }, at);
  };

  return { keyed, cookieString, setCookieValue, cookieArgs, cachePut };
}

/**
 * The text scanner: regexes over the source. Since repair round 6 it runs only for a file the TypeScript parser cannot
 * read cleanly (scanSource), where every match counts: there are no comment ranges in such a file (commentRanges).
 */
function scanSourceText(file: string, src: string, base: Ctx): Write[] {
  const writes: Write[] = [];
  // A match inside a comment is prose, not a write ("cache.put() below", sw.js). A file with parse errors has no
  // comment ranges, so in the text scanner every match counts.
  const push = (w: Omit<Write, "file" | "line">, at: number) => {
    if (inComment(file, src, at)) return;
    const full: Write = { ...w, file, line: lineOf(src, at) };
    writeOffsets.set(full, at);
    writes.push(full);
  };
  const { keyed, cookieString, setCookieValue, cookieArgs, cachePut: cachePutText } = handlersFor(file, src, base, push);

  /** A name/value/options cookie API call read from the text. */
  const cookieCall = (store: Store, at: number, argsAt: number) => {
    const first = readExpr(src, argsAt);
    if (first.text.startsWith("{")) return cookieArgs(store, at, [first.text]);
    const second = src[first.end] === "," ? readExpr(src, first.end + 1) : { text: "", end: first.end };
    const third = src[second.end] === "," ? readExpr(src, second.end + 1) : { text: "" };
    cookieArgs(store, at, [first.text, second.text, third.text]);
  };

  // localStorage / sessionStorage / any storage-like receiver: .setItem(key, value)
  for (const m of src.matchAll(/([\w$.?\]\)]*?)\??\.setItem\s*\(/g)) {
    let receiver = m[1];
    // A parenthesized receiver, `(localStorage satisfies Storage).setItem`: read the whole group back to its "(", so
    // the store is classed as the AST scanner classes it (COR6-5).
    if (receiver.endsWith(")")) {
      let depth = 0;
      let j = m.index! + receiver.length - 1;
      for (; j >= 0; j--) {
        if (src[j] === ")") depth++;
        else if (src[j] === "(" && --depth === 0) break;
      }
      if (j >= 0) receiver = src.slice(j, m.index! + receiver.length);
    }
    const store: Store = /sessionStorage/.test(receiver) ? "sessionStorage" : /localStorage/.test(receiver) ? "localStorage" : "storage";
    const key = readExpr(src, m.index! + m[0].length);
    const value = src[key.end] === "," ? readExpr(src, key.end + 1).text : "";
    keyed(store, key.text, value, m.index!);
  }

  // Storage property and bracket assignment: localStorage["k"] = v, sessionStorage.k = v (CSC-07)
  for (const m of src.matchAll(/\b(localStorage|sessionStorage)\s*(?:\[([^\]]+)\]|\.([A-Za-z_$][\w$]*))\s*=(?!=)/g)) {
    const store: Store = m[1] === "sessionStorage" ? "sessionStorage" : "localStorage";
    const keyExpr = m[2] !== undefined ? m[2] : JSON.stringify(m[3]);
    const value = readExpr(src, m.index! + m[0].length, ";", true).text;
    keyed(store, keyExpr, value, m.index!);
  }

  // document.cookie = "key=value; …"
  for (const m of src.matchAll(/document\s*(?:\.\s*cookie|\[\s*(["'])cookie\1\s*\])\s*\+?=(?!=)/g)) {
    cookieString("cookie", readExpr(src, m.index! + m[0].length, ";", true).text, m.index!);
  }

  // The Cookie Store API: cookieStore.set(name, value) / cookieStore.set({ name, value }) (CSC-07)
  for (const m of src.matchAll(/\bcookieStore\s*\.\s*set\s*\(/g)) cookieCall("cookie", m.index!, m.index! + m[0].length);

  // Response cookies: res.cookies.set(…), cookies().set(…), (await cookies()).set(…), and a cookies() jar's .set(…)
  const jars = [...src.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*(?:await\s+)?cookies\s*\(\s*\)/g)].map((m) => m[1]);
  const responseCookie = new RegExp(
    `(?:\\.cookies\\s*\\.\\s*set|\\bcookies\\s*\\(\\s*\\)\\s*\\)?\\s*\\.\\s*set${jars.map((j) => `|\\b${j.replace(/\$/g, "\\$")}\\s*\\.\\s*set`).join("")})\\s*\\(`,
    "g",
  );
  for (const m of src.matchAll(responseCookie)) cookieCall("response-cookie", m.index!, m.index! + m[0].length);

  // Set-Cookie headers: headers.set/append(…), res.setHeader(…) (a string or an array of them), { "Set-Cookie": … }
  // and the tuple form new Headers([["Set-Cookie", …]]) (CSC-07, CSC-16)
  for (const m of src.matchAll(/\.(?:set|append|setHeader)\s*\(\s*(["'])set-cookie\1\s*,/gi)) {
    setCookieValue(readExpr(src, m.index! + m[0].length).text, m.index!);
  }
  for (const m of src.matchAll(/(["'])set-cookie\1\s*:/gi)) {
    setCookieValue(readExpr(src, m.index! + m[0].length, ",}").text, m.index!);
  }
  // The tuple form only (CSC2-COR-D): a two-element ["Set-Cookie", value] that is itself an entry of an outer array
  // (its "[" follows "[" or ","), as in new Headers([[…], …]) or headers: [[…]]. A header-name list such as
  // ["set-cookie", "content-length"] is not a write.
  for (const m of src.matchAll(/\[\s*(["'])set-cookie\1\s*,/gi)) {
    if (!/[[,]/.test(prevSignificant(file, src, m.index!))) continue;
    const value = readExpr(src, m.index! + m[0].length);
    if (!/^\s*,?\s*\]/.test(src.slice(value.end))) continue;
    setCookieValue(value.text, m.index!);
  }

  // Cache Storage: the names opened (CSC-07), and what is put into each (CSC-17, CSC-A2). A put's receiver is bound
  // from [self|window|globalThis.]caches.open(name): `const|let c = await …`, a later `c = await …`,
  // `.then((c) => …)` or `.then(function (c) { … })`; or the put is on the opened cache itself,
  // `(await caches.open(name)).put(…)`.
  const cacheVars = new Map<string, string>();
  const cachePut = (at: number, argsAt: number, nameExpr: string) => {
    const req = readExpr(src, argsAt);
    const res = src[req.end] === "," ? readExpr(src, req.end + 1).text : "";
    cachePutText(at, req.text, res, nameExpr);
  };
  for (const m of src.matchAll(/\bcaches\s*\.\s*open\s*\(/g)) {
    const nameExpr = readExpr(src, m.index! + m[0].length);
    keyed("cacheStorage", nameExpr.text, "", m.index!);
    const before = src
      .slice(Math.max(0, m.index! - 80), m.index!)
      .match(/([\w$]+)\s*=\s*(?:await\s+)?(?:(?:self|window|globalThis)\s*\.\s*)?$/);
    if (before) cacheVars.set(before[1], nameExpr.text);
    const after = src.slice(nameExpr.end + 1);
    const then = after.match(/^\s*\.\s*then\s*\(\s*(?:async\s*)?(?:function\b\s*[\w$]*\s*)?\(?\s*([\w$]+)/);
    if (then) cacheVars.set(then[1], nameExpr.text);
    const inline = after.match(/^\s*\)\s*\.\s*put\s*\(/);
    if (inline) cachePut(nameExpr.end + 1, nameExpr.end + 1 + inline[0].length, nameExpr.text);
  }
  for (const [v, nameExpr] of cacheVars) {
    for (const m of src.matchAll(new RegExp(`(?<![\\w$.])${v.replace(/\$/g, "\\$")}\\s*\\.\\s*put\\s*\\(`, "g"))) {
      cachePut(m.index!, m.index! + m[0].length, nameExpr);
    }
  }

  // window.name survives navigations, to other origins too (CSC-07)
  for (const m of src.matchAll(/\bwindow\s*\.\s*name\s*=(?!=)/g)) {
    push({ store: "window.name", key: "window.name", expr: "window.name", value: readExpr(src, m.index! + m[0].length, ";", true).text }, m.index!);
  }

  // IndexedDB: the databases opened, and the writes into object stores: put/add on a store (a variable bound from
  // .objectStore(…), a chained .objectStore(…), or in a file that opens a database any store-named receiver) and
  // cursor.update, in any file that works with object stores, opened there or elsewhere (CSC-17).
  // A file that opens one database: its writes are that database's value, so the database itself is the credential
  // store (kf-sync-queue, CSC-10). Otherwise each write is its own, database "*".
  const opens = [...src.matchAll(/indexedDB\s*\.\s*open\s*\(/g)].map((m) => {
    const { text } = readExpr(src, m.index! + m[0].length);
    return { key: literalValue(base, text) ?? text, expr: text, at: m.index! };
  });
  const idbFile = opens.length > 0 || /\.objectStore\s*\(|\bIDB(?:ObjectStore|Cursor)/.test(src);
  // Store receivers: a variable bound from .objectStore(…), a parameter typed IDBObjectStore, and, in a file that
  // opens a database, any store-named one. Cursor receivers: a name with "cursor" in it, `cur`, or a parameter
  // typed IDBCursor / IDBCursorWithValue (CSC-A3).
  const esc = (v: string) => v.replace(/\$/g, "\\$");
  const storeVars = [
    ...[...src.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*[^;\n]*\.objectStore\s*\(/g)].map((m) => m[1]),
    ...[...src.matchAll(/([\w$]+)\s*\??\s*:\s*IDBObjectStore\b/g)].map((m) => m[1]),
  ].map(esc);
  const cursorVars = [...src.matchAll(/([\w$]+)\s*\??\s*:\s*IDBCursor(?:WithValue)?\b/g)].map((m) => esc(m[1]));
  const receivers = [...storeVars.map((v) => `(?<![\\w$.])${v}`), ...(opens.length > 0 ? ["\\b[\\w$]*[sS]tore[\\w$]*"] : [])];
  const cursors = ["\\b[\\w$]*[cC]ursor[\\w$]*", "(?<![\\w$.])cur", ...cursorVars.map((v) => `(?<![\\w$.])${v}`)];
  const writeRe = new RegExp(
    `(?:${receivers.length ? `(?:${receivers.join("|")})\\s*\\.\\s*(?:put|add)|` : ""}(?:${cursors.join("|")})\\s*\\.\\s*update)\\s*\\(`,
    "g",
  );
  const idbWrite = (at: number, argsAt: number) => ({ value: valueText({ ...base, at }, readExpr(src, argsAt).text), at });
  const puts = !idbFile ? [] : [...src.matchAll(writeRe)].map((m) => idbWrite(m.index!, m.index! + m[0].length));
  // A chained .objectStore(<any expression>).put/add(…): the argument is read whole, so name() does not end it.
  if (idbFile) {
    for (const m of src.matchAll(/\.objectStore\s*\(/g)) {
      const arg = readExpr(src, m.index! + m[0].length);
      const tail = src.slice(arg.end + 1).match(/^\s*\.\s*(?:put|add)\s*\(/);
      if (tail) puts.push(idbWrite(m.index!, arg.end + 1 + tail[0].length));
    }
    puts.sort((x, y) => x.at - y.at);
  }
  if (opens.length === 1) {
    push({ store: "indexedDB", key: opens[0].key, expr: opens[0].expr, value: puts.map((p) => p.value).join(" ") }, opens[0].at);
  } else {
    for (const o of opens) push({ store: "indexedDB", key: o.key, expr: o.expr, value: "" }, o.at);
    for (const p of puts) push({ store: "indexedDB", key: "*", expr: "* put", value: p.value }, p.at);
  }

  return writes;
}

/**
 * `scanSource(file, src, { files })`: `files` (path relative to apps/web → source) serves imported consts.
 * A file the TypeScript parser reads cleanly is scanned on its AST (scanSourceAst); a file with parse diagnostics falls
 * back to the text scanner (scanSourceText), where every match counts (CSC-30, CSC-35).
 */
export function scanSource(
  file: string,
  src: string,
  opts: { files?: Record<string, string>; read?: (rel: string) => string | null; depth?: number } = {},
): Write[] {
  const read = opts.read ?? (opts.files ? (rel: string) => opts.files![rel] ?? null : undefined);
  const base: Ctx = { file, src, read };
  const parsed = parseFile(file, src);
  return parsed.ok ? scanSourceAst(file, src, parsed.sf, base, opts.depth ?? 0) : scanSourceText(file, src, base);
}

/**
 * A string or template whose text looks like code that writes a store (CSC6-SEC-1): an inline script's __html, eval,
 * new Function, a string setTimeout, or any other. Prose that only names a store ("localStorage is full") does not
 * match.
 */
const CODE_HINT =
  /\bsetItem\b|\b(?:localStorage|sessionStorage|indexedDB|objectStore|caches|cookieStore)\b|\bdocument\s*(?:\.\s*cookie\b|\[)|\.cookies\b|\bcookies\s*\(|set-cookie|\b(?:window|self|globalThis)\s*\.\s*name\b/i;

/**
 * The raw offset of cooked offset `cooked` in a string's raw text (COR7-4, COR8-3): an escape is one cooked character
 * for its raw sequence (\\n, \\", \\xHH, \\uHHHH, \\u{…}), a backslash line continuation (LF or CRLF) is none, and a raw
 * CRLF (a template's) is one.
 */
function rawOffsetOf(raw: string, cooked: number): number {
  let i = 0;
  let c = 0;
  while (i < raw.length && c < cooked) {
    const ch = raw[i];
    if (ch === "\\") {
      const nx = raw[i + 1];
      if (nx === "\n") i += 2;
      else if (nx === "\r") i += raw[i + 2] === "\n" ? 3 : 2;
      else {
        if (nx === "x") i += 4;
        else if (nx === "u") i = raw[i + 2] === "{" ? raw.indexOf("}", i) + 1 : i + 6;
        else i += 2;
        c++;
      }
    } else if (ch === "\r" && raw[i + 1] === "\n") {
      i += 2;
      c++;
    } else {
      i++;
      c++;
    }
  }
  // A continuation right at the target is zero cooked characters: the cooked character there starts after it.
  while (raw[i] === "\\" && (raw[i + 1] === "\n" || raw[i + 1] === "\r")) i += raw[i + 1] === "\r" && raw[i + 2] === "\n" ? 3 : 2;
  return i;
}

/** The receiver as written, past parentheses, `!`, `await`, `as` and `satisfies` (and `<T>x` casts). */
function unwrap(e: ts.Expression): ts.Expression {
  for (;;) {
    if (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAwaitExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e)) {
      e = e.expression;
    } else return e;
  }
}

/** The last name of an expression: `x` → x, `a.b.c` → c, `a["c"]` → c, anything else "". */
function lastName(e: ts.Expression): string {
  const u = unwrap(e);
  if (ts.isIdentifier(u)) return u.text;
  if (ts.isPropertyAccessExpression(u)) return u.name.text;
  if (ts.isElementAccessExpression(u) && ts.isStringLiteralLike(u.argumentExpression)) return u.argumentExpression.text;
  return "";
}

/** A "Set-Cookie" name in any quote kind (string, or a template with no substitution), case-insensitive. */
const isSetCookieName = (n: ts.Node | undefined) => !!n && ts.isStringLiteralLike(n) && n.text.toLowerCase() === "set-cookie";

/** A property's name as text: identifier, string, number or a computed literal (`[\`Set-Cookie\`]`). */
function propertyName(n: ts.PropertyName): ts.Node | string | undefined {
  if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) return n.text;
  if (ts.isComputedPropertyName(n)) return n.expression;
  return n;
}

/**
 * The AST scanner (repair round 6, D-274): every write is a node, not a text match. A call's method name, receiver
 * and arguments, an assignment's target, a Set-Cookie property and a Headers tuple are read from the tree, so comments,
 * line breaks (U+2028, CR) and regex literals inside or around them cannot hide or cut a write. The argument TEXT
 * (comments removed) then goes through the same resolution as before (handlersFor: literalValue, valueText,
 * parseCookie), so keys, values, attributes and the census output are unchanged.
 */
function scanSourceAst(file: string, src: string, sf: ts.SourceFile, base: Ctx, depth = 0): Write[] {
  const writes: Write[] = [];
  const push = (w: Omit<Write, "file" | "line">, at: number) => {
    const full: Write = { ...w, file, line: lineOf(src, at) };
    writeOffsets.set(full, at);
    writes.push(full);
  };
  const { keyed, cookieString, cookieArgs, cachePut } = handlersFor(file, src, base, push);

  const ranges = [...commentRanges(file, src)].sort((x, y) => x[0] - y[0]);
  /** A node's source text with its comments blanked out. */
  const text = (n: ts.Node | undefined): string => {
    if (!n) return "";
    const s0 = n.getStart(sf);
    const e0 = n.end;
    let out = "";
    let k = s0;
    for (const [a, b] of ranges) {
      if (b <= s0 || a >= e0) continue;
      if (a > k) out += src.slice(k, a);
      out += " ";
      k = Math.max(k, b);
    }
    if (k < e0) out += src.slice(k, e0);
    return out.trim();
  };
  const at = (n: ts.Node) => n.getStart(sf);
  /** A header name that is "Set-Cookie": any quote kind, a const, or a concatenation (CSC6-SEC-2). */
  const isSetCookieExpr = (n: ts.Node | undefined) =>
    !!n && (isSetCookieName(n) || (literalValue({ ...base, at: n.getStart(sf) }, text(n)) ?? "").toLowerCase() === "set-cookie");
  const setCookieNode = (v: ts.Node | undefined, pos: number) => {
    if (!v) return;
    if (ts.isArrayLiteralExpression(v)) for (const el of v.elements) cookieString("response-cookie", text(el), pos);
    else cookieString("response-cookie", text(v), pos);
  };
  const visitAll = (fn: (n: ts.Node) => void) => {
    const go = (n: ts.Node) => {
      fn(n);
      ts.forEachChild(n, go);
    };
    go(sf);
  };
  const methodOf = (call: ts.CallExpression): { name: string; recv: ts.Expression } | null => {
    const c = call.expression;
    if (ts.isPropertyAccessExpression(c)) return { name: c.name.text, recv: c.expression };
    if (ts.isElementAccessExpression(c) && ts.isStringLiteralLike(c.argumentExpression)) return { name: c.argumentExpression.text, recv: c.expression };
    return null;
  };
  const isCall = (e: ts.Expression, recvName: string, method: string) => {
    const u = unwrap(e);
    if (!ts.isCallExpression(u)) return false;
    const m = methodOf(u);
    return !!m && m.name === method && lastName(m.recv) === recvName;
  };

  // Pass 1: the bindings later writes depend on.
  const jars = new Set<string>(); // const jar = await cookies(), or const jar = res.cookies (CSC6-SEC-2)
  // `cookies` from next/headers, under its own name or an alias (import { cookies as c }).
  const cookieFns = new Set<string>(["cookies"]);
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause?.namedBindings || !ts.isNamedImports(st.importClause.namedBindings)) continue;
    for (const el of st.importClause.namedBindings.elements) if ((el.propertyName ?? el.name).text === "cookies") cookieFns.add(el.name.text);
  }
  const isCookiesCall = (e: ts.Expression) => {
    const u = unwrap(e);
    return ts.isCallExpression(u) && ts.isIdentifier(u.expression) && cookieFns.has(u.expression.text) && u.arguments.length === 0;
  };
  const isCookiesProp = (e: ts.Expression) => {
    const u = unwrap(e);
    return (ts.isPropertyAccessExpression(u) || ts.isElementAccessExpression(u)) && lastName(u) === "cookies";
  };
  const storeVars = new Set<string>(); // bound from .objectStore(…) or typed IDBObjectStore
  const cursorVars = new Set<string>(); // typed IDBCursor / IDBCursorWithValue
  const cacheVars = new Map<string, string>(); // bound from caches.open(name): name text
  const opens: Array<{ key: string; expr: string; at: number }> = [];
  let objectStoreCalls = 0;
  visitAll((n) => {
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n)) && ts.isIdentifier(n.name)) {
      const name = n.name.text;
      // The type's names, through unions and parentheses (`IDBCursorWithValue | null`, COR6-5).
      const typeNames = (t: ts.TypeNode | undefined): string[] =>
        !t
          ? []
          : ts.isTypeReferenceNode(t)
            ? [t.typeName.getText(sf)]
            : ts.isUnionTypeNode(t)
              ? t.types.flatMap(typeNames)
              : ts.isParenthesizedTypeNode(t)
                ? typeNames(t.type)
                : [];
      const types = typeNames(n.type);
      if (types.includes("IDBObjectStore")) storeVars.add(name);
      if (types.includes("IDBCursor") || types.includes("IDBCursorWithValue")) cursorVars.add(name);
      if (types.includes("Cache")) cacheVars.set(name, '"*"'); // a parameter typed Cache (CSC6-SEC-3)
      if (ts.isVariableDeclaration(n) && n.initializer) {
        const init = unwrap(n.initializer);
        if (isCookiesCall(init) || isCookiesProp(init)) jars.add(name);
        let hasObjectStore = false;
        const find = (k: ts.Node) => {
          if (ts.isCallExpression(k) && methodOf(k)?.name === "objectStore") hasObjectStore = true;
          if (!hasObjectStore) ts.forEachChild(k, find);
        };
        find(n.initializer);
        if (hasObjectStore) storeVars.add(name);
      }
    }
    if (!ts.isCallExpression(n)) return;
    const m = methodOf(n);
    if (!m) return;
    if (m.name === "objectStore") objectStoreCalls++;
    if (m.name === "open" && lastName(m.recv) === "indexedDB") {
      const t0 = text(n.arguments[0]);
      opens.push({ key: literalValue({ ...base, at: at(n) }, t0) ?? t0, expr: t0, at: at(n) });
    }
    if (m.name === "open" && lastName(m.recv) === "caches") {
      const nameText = text(n.arguments[0]);
      let up: ts.Node = n.parent;
      while (ts.isParenthesizedExpression(up) || ts.isAwaitExpression(up)) up = up.parent;
      if (ts.isVariableDeclaration(up) && ts.isIdentifier(up.name)) cacheVars.set(up.name.text, nameText);
      if (ts.isBinaryExpression(up) && up.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(up.left)) cacheVars.set(up.left.text, nameText);
      const p = n.parent;
      if (ts.isPropertyAccessExpression(p) && p.name.text === "then" && ts.isCallExpression(p.parent) && p.parent.expression === p) {
        const fn = p.parent.arguments[0];
        if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && fn.parameters[0] && ts.isIdentifier(fn.parameters[0].name)) {
          cacheVars.set(fn.parameters[0].name.text, nameText);
        }
      }
    }
  });
  const idbFile = opens.length > 0 || objectStoreCalls > 0 || storeVars.size > 0 || cursorVars.size > 0;
  const idbWrites: Array<{ value: string; at: number }> = [];

  // Pass 2: the writes, in source order.
  visitAll((n) => {
    if (ts.isCallExpression(n)) {
      const m = methodOf(n);
      if (!m) return;
      const a = n.arguments.map((x) => text(x));
      const pos = at(n);
      const u = unwrap(m.recv);
      const recvText = text(m.recv);
      if (m.name === "setItem") {
        const store: Store = /sessionStorage/.test(recvText) ? "sessionStorage" : /localStorage/.test(recvText) ? "localStorage" : "storage";
        keyed(store, a[0] ?? "", a[1] ?? "", pos);
      }
      if (m.name === "set" && lastName(m.recv) === "cookieStore") cookieArgs("cookie", pos, a);
      if (m.name === "set" && (isCookiesProp(u) || isCookiesCall(u) || (ts.isIdentifier(u) && jars.has(u.text)))) {
        cookieArgs("response-cookie", pos, a);
      }
      if ((m.name === "set" || m.name === "append" || m.name === "setHeader") && isSetCookieExpr(n.arguments[0])) setCookieNode(n.arguments[1], pos);
      if (m.name === "open" && lastName(m.recv) === "caches") keyed("cacheStorage", a[0] ?? "", "", pos);
      if (m.name === "put") {
        if (ts.isIdentifier(u) && cacheVars.has(u.text)) cachePut(pos, a[0] ?? "", a[1] ?? "", cacheVars.get(u.text)!);
        else if (isCall(u, "caches", "open")) cachePut(pos, a[0] ?? "", a[1] ?? "", text((unwrap(u) as ts.CallExpression).arguments[0]));
        // In public/ (the service worker), a two-argument put of request headers or the authorization header on any
        // other receiver, a parameter included, is a Cache write too (CSC6-SEC-3).
        else if (file.startsWith("public/") && n.arguments.length === 2 && /headers|authorization/i.test(`${a[0]} ${a[1]}`)) {
          cachePut(pos, a[0] ?? "", a[1] ?? "", '"*"');
        }
      }
      if (idbFile && (m.name === "put" || m.name === "add")) {
        const name = lastName(u);
        const isStore =
          (ts.isIdentifier(u) && storeVars.has(u.text)) ||
          (ts.isCallExpression(u) && methodOf(u)?.name === "objectStore") ||
          (opens.length > 0 && /[sS]tore/.test(name));
        if (isStore) idbWrites.push({ value: valueText({ ...base, at: pos }, a[0] ?? ""), at: pos });
      }
      if (idbFile && m.name === "update") {
        const name = lastName(u);
        if (/[cC]ursor/.test(name) || name === "cur" || (ts.isIdentifier(u) && cursorVars.has(u.text))) {
          idbWrites.push({ value: valueText({ ...base, at: pos }, a[0] ?? ""), at: pos });
        }
      }
      return;
    }
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      // = and the logical assignments ||= ??= &&= write the target; += appends (document.cookie).
      const assigns =
        op === ts.SyntaxKind.EqualsToken ||
        op === ts.SyntaxKind.BarBarEqualsToken ||
        op === ts.SyntaxKind.QuestionQuestionEqualsToken ||
        op === ts.SyntaxKind.AmpersandAmpersandEqualsToken;
      if (!assigns && op !== ts.SyntaxKind.PlusEqualsToken) return;
      const left = n.left;
      const pos = at(n);
      const isDocCookie =
        (ts.isPropertyAccessExpression(left) && left.name.text === "cookie") ||
        (ts.isElementAccessExpression(left) && ts.isStringLiteralLike(left.argumentExpression) && left.argumentExpression.text === "cookie");
      if (isDocCookie && lastName((left as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression) === "document") {
        cookieString("cookie", text(n.right), pos);
        return;
      }
      if (!assigns) return;
      if (ts.isPropertyAccessExpression(left) && left.name.text === "name" && lastName(left.expression) === "window") {
        push({ store: "window.name", key: "window.name", expr: "window.name", value: text(n.right) }, pos);
        return;
      }
      if ((ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left)) && /^(?:localStorage|sessionStorage)$/.test(lastName(left.expression))) {
        const store: Store = lastName(left.expression) === "sessionStorage" ? "sessionStorage" : "localStorage";
        const keyExpr = ts.isElementAccessExpression(left) ? text(left.argumentExpression) : JSON.stringify(left.name.text);
        keyed(store, keyExpr, text(n.right), pos);
      }
      return;
    }
    if (ts.isPropertyAssignment(n)) {
      const name = propertyName(n.name);
      const isSc = typeof name === "string" ? name.toLowerCase() === "set-cookie" : isSetCookieExpr(name);
      if (isSc) setCookieNode(n.initializer, at(n));
      return;
    }
    // The Headers tuple: a two-element ["Set-Cookie", value] that is an entry of an outer array (CSC2-COR-D).
    if (ts.isArrayLiteralExpression(n) && n.elements.length === 2 && isSetCookieExpr(n.elements[0]) && ts.isArrayLiteralExpression(n.parent)) {
      setCookieNode(n.elements[1], at(n));
      return;
    }
    // Code inside a string or template (CSC6-SEC-1): parsed as JS by this same scanner (the text scanner if it does
    // not parse), its writes reported at host-file lines. A substitution is resolved in the host file (a const, a
    // JSON.stringify of one); one that cannot be resolved becomes UNRESOLVED, so its write fails closed (CSC-44). Lines
    // map through the raw text (COR7-4), a substitution keeping every line break between "${" and "}".
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      scanInline(n.text, src.slice(at(n) + 1, n.end - 1), at(n) + 1, true, true);
      return;
    }
    if (ts.isTemplateExpression(n)) {
      let code = n.head.text;
      let raw = src.slice(at(n) + 1, n.head.end - 2);
      for (const sp of n.templateSpans) {
        const breaks = "\n".repeat((src.slice(sp.expression.pos, sp.literal.getStart(sf)).match(/\n/g) ?? []).length);
        const resolved = resolveSubstitution(sp.expression);
        code += resolved + breaks + sp.literal.text;
        // The raw side stands in for the substitution with as many characters and line breaks, and no escapes.
        const litStart = sp.literal.getStart(sf) + 1;
        // Every character, line breaks included: a resolved value's own line breaks are not host line breaks.
        raw += resolved.replace(/[\s\S]/g, "x") + breaks + src.slice(litStart, sp.literal.end - (ts.isTemplateTail(sp.literal) ? 1 : 2));
      }
      scanInline(code, raw, at(n) + 1, false, true);
      return;
    }
    // JSX text children of <script> / <Script> are code (CSC7-SEC-3); no hint needed.
    if (ts.isJsxElement(n) && /^script$/i.test(n.openingElement.tagName.getText(sf))) {
      for (const child of n.children) if (ts.isJsxText(child)) scanInline(child.text, child.text, child.end - child.text.length, true, false);
    }
  });

  /**
   * A template substitution's text, resolved in the host file; UNRESOLVED (a credential) when it cannot be resolved
   * in full ("*" piece), or when its own source names a credential (CSC8-SEC-1/2: `${token ? token : ""}`,
   * `${AUTH_KEY}`). Otherwise the substitution goes through resolveKeySet: a candidate with a "*" part fails closed;
   * one naming a credential is spliced in; of plain candidates the first is spliced in.
   */
  function resolveSubstitution(e: ts.Expression): string {
    const t = text(e);
    if (CREDENTIAL_PATTERN.test(t) || VALUE_PATTERN.test(t)) return UNRESOLVED;
    const c = { ...base, at: e.getStart(sf) };
    const json = t.match(/^JSON\s*\.\s*stringify\s*\(([\s\S]*)\)$/);
    // Through the key resolver (round 12): a candidate with a "*" part fails closed; otherwise a candidate naming a
    // credential is spliced in (so the inner write is a credential write under its real name), else the first.
    const cands = resolveKeySet(c, json ? json[1] : t);
    if (cands.length === 0 || cands.some((x) => x.includes("*"))) return UNRESOLVED;
    // Several candidates: the code would be scanned with only one of them spliced in, so fail closed (CSC-69).
    if (cands.length > 1 && !cands.some((x) => CREDENTIAL_PATTERN.test(x))) return UNRESOLVED;
    const pick = cands.find((x) => CREDENTIAL_PATTERN.test(x)) ?? cands[0];
    return json ? JSON.stringify(pick) : pick;
  }

  /**
   * Scan `code` (cooked text) as JS. `raw` is the same text as written in the host, starting at host offset
   * `rawStart`; `contiguous` when raw is one slice of the host (a string, JSX text), not a template rebuilt around its
   * substitutions. Each inner write's cooked offset maps to a raw offset through the escapes (rawOffsetOf), and its
   * host line is the raw start's line plus the raw line breaks before it (COR7-4, COR8-3).
   */
  function scanInline(code: string, raw: string, rawStart: number, contiguous: boolean, hinted: boolean) {
    if (depth >= 3 || (hinted && !CODE_HINT.test(code))) return;
    const g = globalThis as unknown as { __kfInlineScans?: number };
    g.__kfInlineScans = (g.__kfInlineScans ?? 0) + 1;
    const firstLine = lineOf(src, rawStart);
    for (const w of scanSource(`${file}.inline.js`, code, { read: base.read, depth: depth + 1 })) {
      const rawIdx = rawOffsetOf(raw, writeOffsets.get(w) ?? 0);
      const mapped: Write = { ...w, file, line: firstLine + (raw.slice(0, rawIdx).match(/\n/g) ?? []).length };
      writeOffsets.set(mapped, contiguous ? rawStart + rawIdx : rawStart);
      writes.push(mapped);
    }
  }

  // IndexedDB, as before: a file that opens one database lends it its writes' values (kf-sync-queue, CSC-10).
  idbWrites.sort((x, y) => x.at - y.at);
  if (opens.length === 1) {
    push({ store: "indexedDB", key: opens[0].key, expr: opens[0].expr, value: idbWrites.map((p) => p.value).join(" ") }, opens[0].at);
  } else {
    for (const o of opens) push({ store: "indexedDB", key: o.key, expr: o.expr, value: "" }, o.at);
    for (const p of idbWrites) push({ store: "indexedDB", key: "*", expr: "* put", value: p.value }, p.at);
  }
  return writes;
}

/** A credential in a value: a token-, session- or auth-like name, in the value's source text (CSC-08, CSC-13). */
const VALUE_PATTERN = /token|refresh|secret|session|auth|password|passwd|bearer|jwt|credential|(?:api|private|signing|access)[_-]?key|verifier/i;
/** A stored request's headers carry its Authorization bearer (kf-sync-queue, CSC-10). */
const HEADERS_PATTERN = /\bheaders\b/;

const isCredential = (w: Pick<Write, "store" | "key" | "expr" | "value">) =>
  w.store === "window.name" ||
  w.key.includes("*") || // a key the resolver could not resolve in full fails closed (round 12)
  CREDENTIAL_PATTERN.test(w.key) ||
  CREDENTIAL_PATTERN.test(w.expr) ||
  VALUE_PATTERN.test(w.value) ||
  ((w.store === "indexedDB" || w.store === "cacheStorage") && HEADERS_PATTERN.test(w.value));

/** Browser code the walk scans: .ts, .tsx, .js, .jsx and .mjs files, not tests and not declaration files. */
const isScannedFile = (name: string) =>
  /\.(?:ts|tsx|js|jsx|mjs)$/.test(name) && !/\.(?:test|spec)\.[jt]sx?$/.test(name) && !name.endsWith(".d.ts");

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "__tests__" || e.name === "node_modules" || e.name.startsWith(".")) continue;
        walk(p);
      } else if (isScannedFile(e.name)) {
        out.push(p);
      }
    }
  };
  walk(WEB_SRC);
  walk(WEB_PUBLIC); // recursively (CSC-11): public/widgets/v1/loader.js is browser code too
  return out;
}

function readWeb(rel: string): string | null {
  const p = path.join(WEB, rel);
  try {
    return fs.statSync(p).isFile() ? fs.readFileSync(p, "utf8") : null;
  } catch {
    return null;
  }
}

let censusCache: Write[] | null = null;
function census(): Write[] {
  censusCache ??= sourceFiles().flatMap((p) =>
    scanSource(path.relative(WEB, p).split(path.sep).join("/"), fs.readFileSync(p, "utf8"), { read: readWeb }),
  );
  return censusCache;
}

const id = (r: { store: string; key: string; file: string }) => `${r.store} ${r.key} @ ${r.file}`;

const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);

/** The CSC_DUMP lines, sorted by file, line, store and key, so two runs compare line for line (COR6-4). */
const dumpLines = (writes: Write[]): string[] =>
  [...writes]
    // A plain code-unit comparison, not localeCompare, so the order is the same on every machine (COR7-7).
    .sort((a, b) => cmp(a.file, b.file) || a.line - b.line || cmp(a.store, b.store) || cmp(a.key, b.key))
    .map((w) => `CSC ${isCredential(w) ? "CRED" : "----"} ${w.store} ${w.key} @ ${w.file}:${w.line}`);

/** Does a registry row cover a write: the same id and, for a pinned row, the same key and value source text? */
const covers = (r: RegistryRow, w: Write) =>
  id(r) === id(w) && (r.keyExpr === undefined || (r.keyExpr === w.expr && r.valueExpr === w.value));

/** The census against a registry: credential writes with no row, and rows with no write. */
function compare(writes: Write[], registry: RegistryRow[]) {
  const cred = writes.filter(isCredential);
  const seenIds = new Set<string>();
  const unregistered: string[] = [];
  for (const w of cred) {
    if (registry.some((r) => covers(r, w))) continue;
    const key = `${id(w)}|${w.expr}|${w.value}`;
    if (seenIds.has(key)) continue;
    seenIds.add(key);
    unregistered.push(`${id(w)}:${w.line} (key source: ${w.expr})`);
  }
  const stale = registry.filter((r) => !cred.some((w) => covers(r, w))).map(id);
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

  it("resolves literals, consts and templates; a wrapper's cookie name is unresolved (round 14)", () => {
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
        `cookie:${UNRESOLVED}`,
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
  if (process.env.CSC_DUMP) for (const line of dumpLines(writes)) console.log(line);
  if (process.env.CSC_PINS) for (const w of writes.filter((x) => isCredential(x) && !REGISTRY.some((r) => covers(r, x)))) console.log("PIN", JSON.stringify({ store: w.store, key: w.key, file: w.file, line: w.line, keyExpr: w.expr, valueExpr: w.value }));

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
    // Rows of one id are told apart by their pins (round 14: several UNRESOLVED writes in one file).
    expect(new Set(REGISTRY.map((r) => `${id(r)}|${r.keyExpr ?? ""}|${r.valueExpr ?? ""}`)).size, "no duplicate rows").toBe(REGISTRY.length);
  });

  it("CSC-04 the stores the plan names are registered", () => {
    const keys = new Set(REGISTRY.map((r) => r.key));
    for (const k of ["kf_token", "kf_refresh_token", "kf_admin_token", "kf_admin_user_cache", "kf_auth_mode", "kf_oauth_state"]) {
      expect(keys.has(k), k).toBe(true);
    }
  });

  it("CSC-05 no credential in IndexedDB, Cache Storage or window.name, and server cookie writes only clear", () => {
    // The one known exception is registered with its follow-up (CSC-10). Round 14: a write there whose NAME is not
    // proven is a credential write too; it passes only when it is registered (pinned) and neither its name's source
    // nor its value names a credential or keeps request headers. Any other fails.
    const followUps = REGISTRY.filter((r) => r.followUp);
    const unprovenOnly = (w: Write) =>
      w.store !== "window.name" &&
      w.store !== "response-cookie" &&
      w.key === UNRESOLVED &&
      REGISTRY.some((r) => covers(r, w)) &&
      !CREDENTIAL_PATTERN.test(w.expr) &&
      !VALUE_PATTERN.test(w.value) &&
      !HEADERS_PATTERN.test(w.value);
    const bad = writes.filter(
      (w) =>
        ["indexedDB", "cacheStorage", "window.name", "response-cookie"].includes(w.store) &&
        isCredential(w) &&
        !followUps.some((r) => covers(r, w)) &&
        !unprovenOnly(w),
    );
    expect(bad.map((w) => `${id(w)}:${w.line}`)).toEqual([]);
    expect(followUps.map((r) => `${id(r)} (${r.keyExpr})`)).toEqual([`indexedDB ${UNRESOLVED} @ public/sw.js (DB_NAME)`]);
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

  it("resolves concatenation; an import or a key function is unresolved (round 14)", () => {
    expect(keys).toEqual([
      "sessionStorage:kf-scroll-*",
      `localStorage:${UNRESOLVED}`,
      `localStorage:${UNRESOLVED}`,
      `localStorage:${UNRESOLVED}`,
      `localStorage:${UNRESOLVED}`,
    ]);
  });

  it("the census resolves the app's own concatenated key (use-return-navigation.ts)", () => {
    expect(census().some((w) => w.file === "src/lib/use-return-navigation.ts" && w.key === "kf-scroll-*")).toBe(true);
  });
});

describe("CSC-10 kf-sync-queue keeps request headers, so it is a credential store", () => {
  it("public/sw.js kf-sync-queue is a credential write, registered with its follow-up", () => {
    // Round 14: DB_NAME is a block-scoped const, so the name is UNRESOLVED; the write is found by its key source.
    const w = census().find((x) => x.store === "indexedDB" && x.file === "public/sw.js" && x.expr === "DB_NAME");
    expect(w, "the census finds kf-sync-queue").toBeTruthy();
    expect(isCredential(w!), "kf-sync-queue counts as a credential store").toBe(true);
    const row = REGISTRY.find((r) => covers(r, w!));
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
      const w = writes.find((x) => covers(r, x));
      expect(w?.attrs, id(r)).toEqual(r.attrs);
    }
  });
});

/* ------------------------------------------------------- repair round 2 */

/**
 * Repair round 2 (both reviews ACCEPT WITH MINORS, #80 7182060236 follow-up). Each case plants an in-memory sample
 * the round-1 scanner (8bc5833) misses, or kills a resolution step that could be removed with every case passing.
 *
 *   CSC-13 (CSC-SEC-1) a session or auth object in the value is a credential write, through JSON.stringify(x) and a
 *          const one hop away too.
 *   CSC-14 (CSC-COR-1) an assignment continued by an operator at the END of the line (Prettier's shape) is read whole.
 *   CSC-15 (CSC-COR-4) the nearest const before the write, ternary branches and an inline https-only Secure each
 *          decide a result.
 *   CSC-16 (CSC-SEC-3 / CSC-COR-2) res.setHeader("Set-Cookie", …), new Headers([["Set-Cookie", …]]) and
 *          document.cookie = [NAME, "=", t].join("").
 *   CSC-17 (CSC-SEC-2) Cache Storage puts and IndexedDB put/add/cursor.update are scanned for their values, also in a
 *          file that does not open the database itself.
 */
describe("CSC-13 a session or auth object in the value counts", () => {
  const fixture = [
    `export function save(data: { session: unknown; auth: unknown }) {`,
    `  localStorage.setItem("kf_cache", JSON.stringify(data.session));`,
    `  localStorage.setItem("kf_cache2", JSON.stringify(data.auth));`,
    `  const blob = JSON.stringify(data.session);`,
    `  localStorage.setItem("kf_cache3", blob);`,
    `  const payload = { s: data.session };`,
    `  localStorage.setItem("kf_cache4", JSON.stringify(payload));`,
    `  localStorage.setItem("kf_plain_view", JSON.stringify({ view: "grid" }));`,
    `}`,
  ].join("\n");
  const { unregistered } = compare(scan("src/fixture-session-value.ts", fixture), []);

  it("flags each, including through JSON.stringify(x) and a const one hop away", () => {
    for (const k of ["kf_cache", "kf_cache2", "kf_cache3", "kf_cache4"]) {
      expect(unregistered.some((u) => u.startsWith(`localStorage ${k} @`)), k).toBe(true);
    }
  });

  it("does not flag a plain value", () => {
    expect(unregistered.some((u) => u.includes("kf_plain_view"))).toBe(false);
  });
});

describe("CSC-14 an operator at the end of the line continues the assignment", () => {
  const fixture = [
    `export function save(session: { access_token: string }, s: { refresh_token: string }) {`,
    `  document.cookie =`,
    `    "kf_mirror=" +`,
    `    session.access_token +`,
    `    "; path=/";`,
    `  localStorage["kf_blob2"] =`,
    `    "v1:" +`,
    `    s.refresh_token;`,
    `  window.name =`,
    `    "x" +`,
    `    s.refresh_token;`,
    `}`,
  ].join("\n");
  const ws = scan("src/fixture-eol.ts", fixture);
  const { unregistered } = compare(ws, []);

  it("reads the cookie's key, value and attributes across the lines", () => {
    const w = ws.find((x) => x.store === "cookie" && x.key === "kf_mirror");
    expect(w, "kf_mirror is found").toBeTruthy();
    expect(w!.attrs).toEqual(["path=/"]);
    expect(unregistered.some((u) => u.startsWith("cookie kf_mirror @"))).toBe(true);
  });

  it("reads a bracket assignment's value across the lines", () => {
    expect(unregistered.some((u) => u.startsWith("localStorage kf_blob2 @"))).toBe(true);
    expect(ws.find((x) => x.key === "window.name")?.value).toMatch(/refresh_token/);
  });
});

describe("CSC-15 each resolution step decides a result", () => {
  it("the const declared nearest before the write wins over an earlier one", () => {
    const fixture = [
      `function a() {`,
      `  const key = "kf_first_view";`,
      `  localStorage.setItem(key, "1");`,
      `}`,
      `function b(t: string) {`,
      `  const key = "kf_second_token";`,
      `  localStorage.setItem(key, t);`,
      `}`,
    ].join("\n");
    // Round 14: a const inside a function is not proven, so both keys are UNRESOLVED (credential writes).
    expect(keysOf(scan("src/fixture-nearest.ts", fixture))).toEqual([`localStorage:${UNRESOLVED}`, `localStorage:${UNRESOLVED}`]);
  });

  // Round 11 (SEC-R10-1): a ternary KEY is every branch (kf_tern_token and kf_other); a function's ternary return
  // still resolves to its first resolvable branch (keyFor → kf_owner_secret:*), which is what this case pins.
  it("a ternary resolves to each branch; a call is unresolved (round 14)", () => {
    const fixture = [
      `const OWNER_KEY = "kf_owner_secret";`,
      `function keyFor(owner: string | null) {`,
      `  return owner ? \`\${OWNER_KEY}:\${owner}\` : null;`,
      `}`,
      `export function save(flag: boolean, owner: string, t: string) {`,
      `  localStorage.setItem(flag ? "kf_tern_token" : "kf_other", t);`,
      `  localStorage.setItem(keyFor(owner), t);`,
      `}`,
    ].join("\n");
    expect(keysOf(scan("src/fixture-ternary.ts", fixture))).toEqual(["localStorage:kf_tern_token", "localStorage:kf_other", `localStorage:${UNRESOLVED}`]);
  });

  it("an inline https-only Secure is recorded as secure-on-https; attributes held in a local const are not read", () => {
    const fixture = [
      `export function w(t: string) {`,
      `  document.cookie = \`kf_inline_token=\${t}; Path=/\${location.protocol === "https:" ? "; Secure" : ""}\`;`,
      `  const attrs = \`; Path=/; SameSite=Lax\${location.protocol === "https:" ? "; Secure" : ""}\`;`,
      `  document.cookie = \`kf_viaconst_token=\${t}\${attrs}\`;`,
      `}`,
    ].join("\n");
    const ws = scan("src/fixture-secure.ts", fixture);
    expect(ws.find((w) => w.key === "kf_inline_token")?.attrs).toEqual(["path=/", "secure-on-https"]);
    // Round 14: `attrs` is a const inside the function, so it is not proven and its attributes are not read.
    expect(ws.find((w) => w.key === "kf_viaconst_token")?.attrs).toEqual([]);
  });
});

describe("CSC-16 more Set-Cookie and cookie-building shapes", () => {
  const fixture = [
    `const NAME = "kf_joined_session";`,
    `export function h(res: { setHeader(n: string, v: unknown): void }, t: string) {`,
    `  res.setHeader("Set-Cookie", \`kf_node_session=\${t}; Path=/; HttpOnly\`);`,
    `  res.setHeader("Set-Cookie", ["kf_arr1_token=a; Path=/", "kf_arr2_token=b; Path=/"]);`,
    `  const h2 = new Headers([["Set-Cookie", "kf_tuple_session=1; Path=/"]]);`,
    `  document.cookie = [NAME, "=", t].join("");`,
    `}`,
  ].join("\n");
  const keys = keysOf(scan("src/fixture-headers.ts", fixture));

  it("finds each", () => {
    expect(keys).toEqual(
      expect.arrayContaining([
        "response-cookie:kf_node_session",
        "response-cookie:kf_arr1_token",
        "response-cookie:kf_arr2_token",
        "response-cookie:kf_tuple_session",
        "cookie:kf_joined_session",
      ]),
    );
  });
});

describe("CSC-17 Cache Storage and IndexedDB values are scanned", () => {
  it("a Cache Storage put that stores a token or the request headers is a credential write, named by its cache", () => {
    const fixture = [
      `async function f(request: Request, token: string) {`,
      `  const cache = await caches.open("kf-api-cache");`,
      `  cache.put(request, new Response(token));`,
      `  caches.open("kf-hdr-cache").then((c) => c.put(request.url, new Response(JSON.stringify(request.headers))));`,
      `  const plain = await caches.open("kf-static-cache");`,
      `  plain.put(request, new Response("ok"));`,
      `}`,
    ].join("\n");
    const { unregistered } = compare(scan("public/fixture-cache.js", fixture), []);
    expect(unregistered.some((u) => u.startsWith("cacheStorage kf-api-cache @"))).toBe(true);
    expect(unregistered.some((u) => u.startsWith("cacheStorage kf-hdr-cache @"))).toBe(true);
    expect(unregistered.some((u) => u.includes("kf-static-cache"))).toBe(false);
  });

  it("IndexedDB put/add/cursor.update are scanned in a file that only uses a database opened elsewhere", () => {
    const fixture = [
      `import { getDb } from "./db";`,
      `export async function save(token: string, refreshToken: string, session: unknown) {`,
      `  const db = await getDb();`,
      `  const store = db.transaction("s", "readwrite").objectStore("s");`,
      `  store.put({ token });`,
      `  db.transaction("t").objectStore("t").add(refreshToken);`,
      `  cursor.update({ session });`,
      `}`,
    ].join("\n");
    const ws = scan("src/fixture-idb-elsewhere.ts", fixture);
    const cred = ws.filter((w) => w.store === "indexedDB" && isCredential(w));
    expect(cred.length, "three credential writes").toBe(3);
    expect(compare(ws, []).unregistered.some((u) => u.startsWith("indexedDB * @ src/fixture-idb-elsewhere.ts"))).toBe(true);
  });

  it("a Set's .add or a state store's .update is not an IndexedDB write", () => {
    const fixture = [
      `const names = new Set<string>();`,
      `names.add(token);`,
      `storeServiceNames.add(token);`,
      `useStore.update({ token });`,
    ].join("\n");
    expect(scan("src/fixture-not-idb.ts", fixture).filter((w) => w.store === "indexedDB")).toEqual([]);
  });
});

describe("CSC-18 a match inside a comment is not a write", () => {
  it("prose that names a write is not counted", () => {
    const fixture = [
      `async function f(request: Request, token: string) {`,
      `  const cache = await caches.open("kf-doc-cache");`,
      `  /* cache.put(request, new Response(token)) would keep the bearer */`,
      `  // localStorage.setItem("kf_doc_token", token);`,
      `  cache.put(request, new Response("ok")); // not localStorage.setItem("kf_tail_token", token)`,
      `}`,
    ].join("\n");
    const ws = scan("public/fixture-comments.js", fixture);
    expect(ws.filter((w) => w.store === "cacheStorage").map((w) => `${w.key}:${w.line}`)).toEqual(["kf-doc-cache:2", "kf-doc-cache:5"]);
    expect(ws.some((w) => w.key === "kf_doc_token" || w.key === "kf_tail_token")).toBe(false);
    expect(compare(ws, []).unregistered).toEqual([]);
  });
});

/* ------------------------------------------------------- repair round 3 */

/**
 * Repair round 3 (security review REJECT, CSC-A1 MAJOR; minors CSC-A2..A5). Each case plants a sample the round-2
 * scanner (2f1399c) gets wrong.
 *
 *   CSC-19 (CSC-A1) a "/*" or "//" that is not a comment (in a string, a template, a regex literal or JSX text) does
 *          not hide the writes after it; a real comment still does (sw.js:265).
 *   CSC-20 (CSC-A2) Cache Storage receivers bound by .then(function (cache) …), self.caches.open,
 *          (await caches.open(N)).put(…) and a later assignment `cache = await caches.open(N)`.
 *   CSC-21 (CSC-A3) IndexedDB: a cursor named `cur`, .objectStore(name()).put(…), and a parameter typed IDBObjectStore.
 *   CSC-22 (CSC-A4) a yoda https-only Secure ternary is recorded as secure-on-https, not as garbage attributes.
 *   CSC-23 (CSC-A5) a private, signing or access key in the value is a credential write.
 */
describe("CSC-19 only a real comment hides a write", () => {
  const cases: Array<[string, string[]]> = [
    ["accept=\"image/*\" in JSX", [`export const F = () => <input type="file" accept="image/*" />;`, `export const save = (t: string) => localStorage.setItem("kf_a1_token", t);`]],
    ["a \"/api/*\" string", [`const ROUTES = ["/api/*"];`, `export const save = (t: string) => localStorage.setItem("kf_a1_token", t);`]],
    ["a regex literal with /*", [`export const trim = (u: string) => u.replace(/\\/*$/, "");`, `export const save = (t: string) => localStorage.setItem("kf_a1_token", t);`]],
    ["a closed doc comment, then \"text/*\"", [`/* doc */`, `const H = { Accept: "text/*" };`, `export const save = (t: string) => localStorage.setItem("kf_a1_token", t);`]],
    ["a regex with // before the write on its line", [`export const save = (u: string, t: string) => /^https?:\\/\\//.test(u) && localStorage.setItem("kf_a1_token", t);`]],
    ["a template line with http://", [`const msg = \`see`, `http://example.test \${1}\`; localStorage.setItem("kf_a1_token", t);`]],
    ["JSX text with https://", [`export const P = ({ t }: { t: string }) => (`, `  <p>Visit https://example.test <button onClick={() => localStorage.setItem("kf_a1_token", t)} /></p>`, `);`]],
  ];
  for (const [name, lines] of cases) {
    it(`a write after ${name} is found`, () => {
      const keys = keysOf(scan("src/fixture-a1.tsx", lines.join("\n")));
      expect(keys).toContain("localStorage:kf_a1_token");
    });
  }

  it("a comment after the last token of a file is a comment", () => {
    const fixture = [`localStorage.setItem("kf_e_token", t);`, `// localStorage.setItem("kf_eof_token", t);`].join("\n");
    expect(keysOf(scan("src/fixture-eof.ts", fixture))).toEqual(["localStorage:kf_e_token"]);
  });

  it("a write inside a real block or line comment is still not counted", () => {
    const fixture = [
      `/* localStorage.setItem("kf_c1_token", t); */`,
      `// localStorage.setItem("kf_c2_token", t);`,
      `const x = 1; // localStorage.setItem("kf_c3_token", t);`,
      `export const P = () => <div>{/* localStorage.setItem("kf_c4_token", t) */}</div>;`,
      `localStorage.setItem("kf_c5_token", t);`,
    ].join("\n");
    expect(keysOf(scan("src/fixture-c.tsx", fixture))).toEqual(["localStorage:kf_c5_token"]);
  });

  it("the census still excludes sw.js:265 (a true comment)", () => {
    expect(census().some((w) => w.file === "public/sw.js" && w.line === 265)).toBe(false);
  });
});

describe("CSC-20 more Cache Storage receivers", () => {
  const fixture = [
    `async function f(request, token) {`,
    `  caches.open("kf-fn-cache").then(function (cache) {`,
    `    cache.put(request, new Response(token));`,
    `  });`,
    `  const sc = await self.caches.open("kf-self-cache");`,
    `  sc.put(request, new Response(token));`,
    `  (await caches.open("kf-inline-cache")).put(request, new Response(token));`,
    `  let later;`,
    `  later = await caches.open("kf-later-cache");`,
    `  later.put(request, new Response(token));`,
    `}`,
  ].join("\n");
  const { unregistered } = compare(scan("public/fixture-a2.js", fixture), []);

  for (const name of ["kf-fn-cache", "kf-self-cache", "kf-inline-cache", "kf-later-cache"]) {
    it(`${name}: a token put is a credential write`, () => {
      expect(unregistered.some((u) => u.startsWith(`cacheStorage ${name} @`))).toBe(true);
    });
  }
});

describe("CSC-21 more IndexedDB writes", () => {
  const fixture = [
    `export function f(tx: IDBTransaction, cur: IDBCursorWithValue, s: IDBObjectStore, token: string) {`,
    `  cur.update({ token });`,
    `  tx.objectStore(storeName()).put({ token });`,
    `  s.put({ token });`,
    `}`,
  ].join("\n");
  const ws = scan("src/fixture-a3.ts", fixture).filter((w) => w.store === "indexedDB" && isCredential(w));

  it("finds the three credential writes", () => {
    expect(ws.map((w) => w.line).sort()).toEqual([2, 3, 4]);
  });
});

describe("CSC-22 a yoda Secure ternary", () => {
  it("is recorded as secure-on-https", () => {
    const fixture = `export const w = (t: string) => { document.cookie = \`kf_yoda_token=\${t}; Path=/\${"https:" === location.protocol ? "; Secure" : ""}\`; };`;
    expect(scan("src/fixture-a4.ts", fixture).find((w) => w.key === "kf_yoda_token")?.attrs).toEqual(["path=/", "secure-on-https"]);
  });
});

describe("CSC-23 a private, signing or access key in the value", () => {
  const fixture = [
    `export function save(privateKey: string, signing_key: string, accessKey: string) {`,
    `  localStorage.setItem("kf_k", privateKey);`,
    `  localStorage.setItem("kf_k2", signing_key);`,
    `  localStorage.setItem("kf_k3", accessKey);`,
    `  localStorage.setItem("kf_k4", sortKey);`,
    `}`,
  ].join("\n");
  const { unregistered } = compare(scan("src/fixture-a5.ts", fixture), []);

  it("flags each", () => {
    for (const k of ["kf_k", "kf_k2", "kf_k3"]) expect(unregistered.some((u) => u.startsWith(`localStorage ${k} @`)), k).toBe(true);
  });

  it("does not flag a plain key name", () => {
    expect(unregistered.some((u) => u.startsWith("localStorage kf_k4 @"))).toBe(false);
  });
});

describe("CSC-24 each of the comment pass's rules decides a case", () => {
  const cases: Array<[string, string]> = [
    ["a double-quoted string holding ' // '", `const s = " // x"; localStorage.setItem("kf_n_token", t);`],
    ["a single-quoted string holding ' // '", `const s = ' // x'; localStorage.setItem("kf_n_token", t);`],
    ["a template holding ' // '", "const s = `a // b`; localStorage.setItem(\"kf_n_token\", t);"],
    ["a regex class holding ' //'", `const r = /[ //]x/; localStorage.setItem("kf_n_token", t);`],
    ["JSX text with an unclosed ' /*'", `export const P = ({ t }: { t: string }) => <p>Files /* any <button onClick={() => localStorage.setItem("kf_n_token", t)} /></p>;`],
  ];
  for (const [name, line] of cases) {
    it(`a write on the line after ${name} is found`, () => {
      expect(keysOf(scan("src/fixture-n.tsx", line))).toContain("localStorage:kf_n_token");
    });
  }

  it("an untyped cursor named cur is an IndexedDB write", () => {
    const fixture = [
      `export function f(tx: IDBTransaction, token: string) {`,
      `  const req = tx.objectStore("s").openCursor();`,
      `  req.onsuccess = () => { const cur = req.result; cur.update({ token }); };`,
      `}`,
    ].join("\n");
    expect(scan("src/fixture-cur.ts", fixture).filter((w) => w.store === "indexedDB" && isCredential(w)).map((w) => w.line)).toEqual([3]);
  });
});

/* ------------------------------------------------------ repair round 3b */

/**
 * Repair round 3b (correctness review of round 2, also REJECT on CSC-A1, plus minors).
 *
 *   CSC-25 (CSC2-COR-A, CSC2-COR-C) more "/*" and "//" shapes that must hide nothing: an object `accept: "image/*"`
 *          then a write at the end of the file; `"/api/*"`, a write, then a real comment later; JSX
 *          `accept="image/*"`, an onClick write, then a JSX comment; and a multi-line template whose later line holds " // "
 *          before a write on that line.
 *   CSC-26 (CSC2-COR-B) the String(x) hop in valueText decides a case.
 *   CSC-27 (CSC2-COR-D) only the Headers tuple shape is a Set-Cookie write: an array that merely starts with
 *          "set-cookie" (a hop-by-hop header list) is not.
 */
// CSC-25 and CSC-26 are pins: they pass at b5a036f, before the round-3b fix, and guard what round 3 closed.
describe("CSC-25 (pin) more shapes that must hide nothing", () => {
  const cases: Array<[string, string[]]> = [
    ['an object accept: "image/*", the write at the end of the file', [`const OPTS = { accept: "image/*", multiple: false };`, `export function a() { return OPTS; }`, `export const save = (t: string) => localStorage.setItem("kf_b_token", t);`]],
    ['"/api/*", the write, then a real comment', [`const R = "/api/*";`, `export const save = (t: string) => localStorage.setItem("kf_b_token", t);`, `/* a real comment */`]],
    ['JSX accept="image/*", an onClick write, then {/* */}', [`export const F = ({ t }: { t: string }) => (`, `  <div><input accept="image/*" /><button onClick={() => localStorage.setItem("kf_b_token", t)} />{/* note */}</div>`, `);`]],
    ["a multi-line template whose later line holds ' // '", ["const s = `line one", "line two // not a comment`; localStorage.setItem(\"kf_b_token\", t);"]],
  ];
  for (const [name, lines] of cases) {
    it(`a write with ${name} is found`, () => {
      expect(keysOf(scan("src/fixture-b.tsx", lines.join("\n")))).toContain("localStorage:kf_b_token");
    });
  }
});

describe("CSC-26 (pin) String(x) of a const is followed one hop", () => {
  it("a session read through String(raw) is a credential write", () => {
    const fixture = [`export function save(data: { session: string }) {`, `  const raw = data.session;`, `  localStorage.setItem("kf_str", String(raw));`, `}`].join("\n");
    expect(compare(scan("src/fixture-str.ts", fixture), []).unregistered.some((u) => u.startsWith("localStorage kf_str @"))).toBe(true);
  });
});

describe("CSC-27 only the Headers tuple shape is a Set-Cookie write", () => {
  it("a header-name list starting with set-cookie is not a cookie write", () => {
    const fixture = [
      `const HOP = ["set-cookie", "content-length"];`,
      `const H2 = ['Set-Cookie', 'x-kf-session'];`,
      `const GROUPS = [["set-cookie", "x-kf-token", "content-length"]];`,
    ].join("\n");
    expect(scan("src/fixture-hop-list.ts", fixture).filter((w) => w.store === "response-cookie")).toEqual([]);
  });

  it("the tuple form still counts, as the first entry or a later one", () => {
    const fixture = [
      `const a = new Headers([["Set-Cookie", "kf_t1_session=1; Path=/"]]);`,
      `const b = new Headers([["X-A", "1"], ["Set-Cookie", "kf_t2_session=1; Path=/"]]);`,
      `const c = { headers: [["set-cookie", "kf_t3_session=1"]] };`,
    ].join("\n");
    expect(keysOf(scan("src/fixture-tuples.ts", fixture))).toEqual([
      "response-cookie:kf_t1_session",
      "response-cookie:kf_t2_session",
      "response-cookie:kf_t3_session",
    ]);
  });
});

/* ------------------------------------------------------- repair round 4 */

/**
 * Repair round 4 (security CSC-B1..B3, correctness CSC3-COR-1): JSX text is text, not code. The hand-written comment
 * pass (b5a036f) does not parse JSX, so JSX text can open a comment that hides real writes.
 *
 *   CSC-28 JSX text holding " /*" with a later JSX comment in the file (CSC-B1), a lone backtick in JSX text (CSC-B2)
 *          and JSX text holding " // " before code on the same line (CSC-B3) each hide nothing.
 */
describe("CSC-28 JSX text never opens a comment", () => {
  const cases: Array<[string, string[]]> = [
    [
      'JSX text " /*" and a later JSX comment',
      [
        `export const F = ({ t }: { t: string }) => (`,
        `  <div>`,
        `    <p>Upload (paths like /* allowed)</p>`,
        `    <button onClick={() => localStorage.setItem("kf_jx_token", t)} />`,
        `    {/* a real comment */}`,
        `  </div>`,
        `);`,
      ],
    ],
    [
      "a lone backtick in JSX text, then a template holding ' // '",
      [
        `export const F = () => <p>Press \` to open the console</p>;`,
        "const s = `a // b`; localStorage.setItem(\"kf_jx_token\", t);",
      ],
    ],
    [
      "a JSX text line that starts with '//'",
      [
        `export const F = ({ t }: { t: string }) => (`,
        `  <p>`,
        `    // not a comment <button onClick={() => localStorage.setItem("kf_jx_token", t)} />`,
        `  </p>`,
        `);`,
      ],
    ],
    [
      "JSX text ' // ' before code on the same line",
      [`export const F = ({ t }: { t: string }) => <p>a // b <button onClick={() => localStorage.setItem("kf_jx_token", t)} /></p>;`],
    ],
  ];
  for (const [name, lines] of cases) {
    it(`a write after ${name} is found`, () => {
      expect(keysOf(scan("src/fixture-jsx.tsx", lines.join("\n")))).toContain("localStorage:kf_jx_token");
    });
  }
});

/* ------------------------------------------------------- repair round 5 */

/**
 * Repair round 5 (security CSC4-SEC-1 MAJOR, CSC4-SEC-2..3 minors).
 *
 *   CSC-29 (CSC4-SEC-1) a JSDoc block holding "//" hides nothing after it: the walk does not read comment ranges at
 *          positions inside JSDoc nodes (each tag shape, in .ts and .js). No comment range of the census tree starts
 *          inside another and ends past it.
 *   CSC-30 (CSC4-SEC-2) a file the parser cannot read cleanly gets no comment ranges at all (fail closed), and the
 *          census tree parses with no diagnostics.
 *   CSC-31 (CSC4-SEC-3) a regex literal in a value does not cut the value short.
 *   CSC-32 (optional probe) the Set-Cookie tuple's outer-array look-back sees past a comment or a line break.
 */
describe("CSC-29 a JSDoc block holding // hides nothing", () => {
  const tags = ["@type {string} //", "@param x //", "@see //", "@returns //", "@template T //", "@typedef {string} Foo //", "@type {// }"];
  for (const ext of ["ts", "js"]) {
    for (const tag of tags) {
      it(`.${ext}: /** ${tag} */ then a write`, () => {
        const fixture = [`/** ${tag} */ localStorage.setItem("kf_jsdoc_token", t);`, `/** ${tag} */ indexedDB.open("kf_jsdoc_session_db", 1);`].join("\n");
        expect(keysOf(scan(`src/fixture-jsdoc.${ext}`, fixture))).toEqual(["localStorage:kf_jsdoc_token", "indexedDB:kf_jsdoc_session_db"]);
      });
    }
  }

  it("a synthetic JSDoc block holding // gives exactly one, non-overlapping comment range (CSC5-COR-2)", () => {
    const src = `/** @type {string} // */ const a = 1;\n/** @see // */ const b = 2;`;
    const ranges = commentRanges("src/fixture-overlap.ts", src);
    const second = src.indexOf("/** @see");
    expect(ranges).toEqual([
      [0, "/** @type {string} // */".length],
      [second, second + "/** @see // */".length],
    ]);
  });

  it("no comment range of the census tree starts inside another and ends past it", () => {
    const bad: string[] = [];
    for (const p of sourceFiles()) {
      const rel = path.relative(WEB, p).split(path.sep).join("/");
      const ranges = [...commentRanges(rel, fs.readFileSync(p, "utf8"))].sort((x, y) => x[0] - y[0]);
      for (let i = 1; i < ranges.length; i++) {
        if (ranges[i][0] < ranges[i - 1][1]) bad.push(`${rel}: [${ranges[i - 1]}] and [${ranges[i]}]`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("CSC-30 a file with parse errors fails closed", () => {
  it("a generic arrow parsed as JSX in a .tsx file: no comment range hides the write", () => {
    const fixture = [`const f = <T>(x: T) => x;`, `const s = "{ /* "; localStorage.setItem("kf_pc_token", t); const z = " */ }";`].join("\n");
    expect(keysOf(scan("src/fixture-pc.tsx", fixture))).toContain("localStorage:kf_pc_token");
  });

  it("every file of the census tree parses with no diagnostics", () => {
    const bad: string[] = [];
    for (const p of sourceFiles()) {
      const rel = path.relative(WEB, p).split(path.sep).join("/");
      // The census's own parse (parseFile, cached), so this reads the same SourceFile the scan used.
      const { sf } = parseFile(rel, fs.readFileSync(p, "utf8"));
      const n = (sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length;
      if (n > 0) bad.push(`${rel}: ${n}`);
    }
    expect(bad).toEqual([]);
  });
});

describe("CSC-31 a regex literal in a value does not cut it short", () => {
  it("a regex class holding slashes does not end the literal early", () => {
    const fixture = `export const s = (session: { access_token: string }) => localStorage.setItem("kf_pd3_plain", /[///]/.source + session.access_token);`;
    expect(compare(scan("src/fixture-pd3.ts", fixture), []).unregistered.some((u) => u.startsWith("localStorage kf_pd3_plain @"))).toBe(true);
  });

  it("a value built from a regex's source and a session token is a credential write", () => {
    const fixture = `export const s = (session: { access_token: string }) => localStorage.setItem("kf_pd2_plain", /a\\/\\//.source + session.access_token);`;
    expect(compare(scan("src/fixture-pd.ts", fixture), []).unregistered.some((u) => u.startsWith("localStorage kf_pd2_plain @"))).toBe(true);
  });
});

describe("CSC-32 the tuple look-back sees past a comment or a line break", () => {
  it("finds each tuple", () => {
    const fixture = [
      `const a = new Headers([ /* first */ ["Set-Cookie", "kf_lb1_session=1; Path=/"]]);`,
      `const b = new Headers([`,
      `  ["Set-Cookie", "kf_lb2_session=1; Path=/"],`,
      `  // the second`,
      `  ["Set-Cookie", "kf_lb3_session=1; Path=/"],`,
      `]);`,
    ].join("\n");
    expect(keysOf(scan("src/fixture-lb.ts", fixture))).toEqual([
      "response-cookie:kf_lb1_session",
      "response-cookie:kf_lb2_session",
      "response-cookie:kf_lb3_session",
    ]);
  });
});

/* ------------------------------------------------------ repair round 5b */

/**
 * Repair round 5b (correctness review of round 4: CSC4-COR-2, CSC4-COR-3). Pins that kill mutants the round-4 cases
 * left alive; each passes at 96537fb, and the commit records the mutant it kills.
 *
 *   CSC-33 a JSX text " // " that ends where a node ends opens nothing (M1b: the trailing-range JSX guard); a .ts file
 *          is parsed as TS, not TSX, so an angle-bracket cast keeps its real comments (M4); the walk covers .mjs (M6).
 */
describe("CSC-33 (pins) parsing by extension and the trailing-range guard", () => {
  it("JSX text ' // x ' right after an opening tag hides nothing (M1b)", () => {
    const fixture = `export const F = ({ t }: { t: string }) => <p> // x <button onClick={() => localStorage.setItem("kf_jx_token", t)} /></p>;`;
    expect(keysOf(scan("src/fixture-m1b.tsx", fixture))).toContain("localStorage:kf_jx_token");
  });

  it("a .ts file with an angle-bracket cast is parsed as TS: its write is found and its real comment still excluded (M4)", () => {
    const fixture = [
      `const w = <string>v;`,
      `localStorage.setItem("kf_cast_token", t);`,
      `// localStorage.setItem("kf_cast_commented_token", t);`,
    ].join("\n");
    expect(keysOf(scan("src/fixture-cast.ts", fixture))).toEqual(["localStorage:kf_cast_token"]);
  });

  it("the correctness review's JSDoc fixture (CSC4-COR-1, closed by CSC4-SEC-1's fix): the write is found", () => {
    const fixture = `/** @type {string} // n */ const x = 1; localStorage.setItem("kf_p_token", t);`;
    expect(keysOf(scan("src/fixture-cor1.ts", fixture))).toEqual(["localStorage:kf_p_token"]);
  });

  it("the walk covers .mjs, and skips tests and declaration files (M6)", () => {
    for (const name of ["a.ts", "a.tsx", "a.js", "a.jsx", "a.mjs"]) expect(isScannedFile(name), name).toBe(true);
    for (const name of ["a.test.ts", "a.spec.tsx", "a.test.js", "a.d.ts", "a.json", "a.css"]) expect(isScannedFile(name), name).toBe(false);
    expect(keysOf(scan("public/fixture.mjs", `localStorage.setItem("kf_mjs_token", t);`))).toEqual(["localStorage:kf_mjs_token"]);
  });
});

/* ------------------------------------------------------- repair round 6 */

/**
 * Repair round 6, the root fix (D-274; security REJECT on round 5, CSC5-SEC-1..4, correctness CSC5-COR-1..2): writes
 * are found on the TypeScript AST, not by regexes over text. Each plant below defeats the text matching at 314056a.
 *
 *   CSC-34 comments inside a write's tokens, template header names, regex literals after keywords, U+2028 and
 *          CR-only line ends, and in-token comments on cookieStore.set, Cache put and IndexedDB put: each write found.
 *   CSC-35 a file with parse errors falls back to the text scanner, and its tuple look-back skips comments lexically.
 */
describe("CSC-34 writes are found on the AST", () => {
  const plants: Array<[string, string, string[]]> = [
    ["a comment line inside headers.append(…)", "headers.append(\n  // the session cookie\n  \"Set-Cookie\",\n  `kf_x_session=${t}; Path=/`,\n);", ["response-cookie:kf_x_session"]],
    ["a comment before a tuple's name", `const h = new Headers([[ /* c */ "Set-Cookie", "kf_x_session=1"]]);`, ["response-cookie:kf_x_session"]],
    ["a comment after a tuple's name", `const h = new Headers([["Set-Cookie" /* c */, "kf_x_session=1"]]);`, ["response-cookie:kf_x_session"]],
    ["a comment after a tuple's value", `const h = new Headers([["Set-Cookie", "kf_x_session=1", /* c */]]);`, ["response-cookie:kf_x_session"]],
    ["a comment before append's first argument", `headers.append(/* c */ "Set-Cookie", "kf_x_session=1");`, ["response-cookie:kf_x_session"]],
    ["a comment after set's first argument", `headers.set("Set-Cookie" /* c */, "kf_x_session=1");`, ["response-cookie:kf_x_session"]],
    ["a comment before a Set-Cookie property's colon", `const o = { headers: { "Set-Cookie" /* c */ : "kf_x_session=1" } };`, ["response-cookie:kf_x_session"]],
    ["a comment inside document.cookie", "document /* c */ .cookie = `kf_x_session=${t}`;", ["cookie:kf_x_session"]],
    ["a comment before document.cookie's =", "document.cookie /* note */ = `kf_x_session=${t}`;", ["cookie:kf_x_session"]],
    ["a comment before setItem's name", `localStorage./* c */setItem("kf_x_token", t);`, ["localStorage:kf_x_token"]],
    ["a comment before setItem's arguments", `localStorage.setItem /* c */ ("kf_x_token", t);`, ["localStorage:kf_x_token"]],
    ["a template header name", "headers.append(`Set-Cookie`, \"kf_x_session=1\");", ["response-cookie:kf_x_session"]],
    ["a template property name", "const o = { [`Set-Cookie`]: \"kf_x_session=1\" };", ["response-cookie:kf_x_session"]],
    ["a // comment ended by U+2028 inside the arguments", `localStorage.setItem(// c "kf_x_token", t);`, ["localStorage:kf_x_token"]],
    ["a // comment ended by a lone CR inside the arguments", `localStorage.setItem(// c\r"kf_x_token", t);`, ["localStorage:kf_x_token"]],
    ["cookieStore.set with in-token comments", `cookieStore /* c */ . /* c */ set(/* c */ "kf_x_session", t);`, ["cookie:kf_x_session"]],
    ["a Cache put with in-token comments", `const cache = await caches.open("kf-x-cache"); cache /* c */ . /* c */ put(request, new Response(token));`, ["cacheStorage:kf-x-cache"]],
    ["an IndexedDB put with in-token comments", `const db = indexedDB.open("kf-x-db", 1); const s = tx.objectStore("s"); s /* c */ . /* c */ put({ token });`, ["indexedDB:kf-x-db"]],
  ];
  for (const [name, fixture, expected] of plants) {
    it(`${name}: found`, () => {
      const keys = keysOf(scan("src/fixture-ast.ts", fixture));
      expect(keys).toEqual(expect.arrayContaining(expected));
    });
  }

  it("IndexedDB put with in-token comments: the database is a credential store", () => {
    const fixture = `const db = indexedDB.open("kf-x-db", 1); const s = tx.objectStore("s"); s /* c */ . /* c */ put({ token });`;
    expect(compare(scan("src/fixture-ast.ts", fixture), []).unregistered.some((u) => u.startsWith("indexedDB kf-x-db @"))).toBe(true);
  });

  it("a Cache put with in-token comments: the cache is a credential store", () => {
    const fixture = `const cache = await caches.open("kf-x-cache"); cache /* c */ . /* c */ put(request, new Response(token));`;
    expect(compare(scan("src/fixture-ast.ts", fixture), []).unregistered.some((u) => u.startsWith("cacheStorage kf-x-cache @"))).toBe(true);
  });

  for (const [name, value] of [
    ["void /[)]/ || session.access_token", "void /[)]/ || session.access_token"],
    ["typeof /[/*]/ && session.access_token", "typeof /[/*]/ && session.access_token"],
  ]) {
    it(`a regex literal after a keyword in a value (${name}): a credential write`, () => {
      const fixture = `localStorage.setItem("kf_rx_plain", ${value});`;
      expect(compare(scan("src/fixture-rx.ts", fixture), []).unregistered.some((u) => u.startsWith("localStorage kf_rx_plain @"))).toBe(true);
    });
  }
});

describe("CSC-35 a file with parse errors falls back to the text scanner", () => {
  it("a broken file's Headers tuple behind a comment is found", () => {
    const fixture = [`const f = <T>(x: T) => x;`, `const h = new Headers([ /* c */ ["Set-Cookie", "kf_e1_session=1; Path=/"]]);`].join("\n");
    expect(keysOf(scan("src/fixture-e1.tsx", fixture))).toContain("response-cookie:kf_e1_session");
  });
});

describe("CSC-36 (round 6) argument text has its comments removed", () => {
  it("a comment inside a cookie string's expression does not become an attribute", () => {
    const fixture = `document.cookie = "kf_cm_session=" /* ; Path=/; Secure */ + t;`;
    const w = scan("src/fixture-cm.ts", fixture).find((x) => x.key === "kf_cm_session");
    expect(w?.attrs).toEqual([]);
  });
});

/* ------------------------------------------------------- repair round 7 */

/**
 * Repair round 7 (security REJECT on round 6: CSC6-SEC-1 regression, CSC6-SEC-2..5).
 *
 *   CSC-37 (CSC6-SEC-1) code inside a string or template literal is scanned: an inline script's __html template, eval,
 *          new Function and a string setTimeout; its writes are reported at their host-file lines.
 *   CSC-38 (CSC6-SEC-2) a cookie jar alias (`const jar = res.cookies`), res["cookies"], an aliased import of
 *          next/headers cookies, and a Set-Cookie header name held in a const or built with "+".
 *   CSC-39 (CSC6-SEC-3) a service-worker Cache put on a parameter (untyped in public/, or typed Cache) that stores
 *          request headers or the authorization header.
 *   CSC-40 (CSC6-SEC-4) a key held in a same-file const object or enum resolves.
 *   CSC-41 logical assignment (||= ??= &&=) to document.cookie, window.name and storage.
 */
describe("CSC-37 code inside a string or template is scanned", () => {
  it("an inline script's __html template: the write is found at its host line", () => {
    const fixture = [
      `export default function Layout() {`,
      `  return (`,
      `    <script`,
      `      dangerouslySetInnerHTML={{`,
      `        __html: \``,
      `          (function () {`,
      `            document.cookie = 'kf_pre_token=' + localStorage.getItem('kf_token') + '; path=/';`,
      `          })();`,
      `        \`,`,
      `      }}`,
      `    />`,
      `  );`,
      `}`,
    ].join("\n");
    const w = scan("src/fixture-inline.tsx", fixture).find((x) => x.key === "kf_pre_token");
    expect(w, "kf_pre_token is found").toBeTruthy();
    expect(w!.store).toBe("cookie");
    expect(w!.line).toBe(7);
  });

  for (const [name, fixture, key] of [
    ["eval", `eval('localStorage.setItem("kf_ev_token", t)');`, "localStorage:kf_ev_token"],
    ["new Function", `const f = new Function("t", 'sessionStorage.setItem("kf_nf_token", t)');`, "sessionStorage:kf_nf_token"],
    ["a string setTimeout", `setTimeout("document.cookie = 'kf_st_session=1; path=/'", 0);`, "cookie:kf_st_session"],
    ["a template with a substitution", "const s = `localStorage.setItem(\"kf_ts_token\", ${t});`;", "localStorage:kf_ts_token"],
  ]) {
    it(`${name}: the write in the string is found`, () => {
      expect(keysOf(scan("src/fixture-str-code.ts", fixture))).toContain(key);
    });
  }

  it("a multi-line substitution keeps the inner lines aligned with the host file", () => {
    const fixture = ["const s = `${", "  a +", "  b", "}", "localStorage.setItem('kf_ml_token', t);`;"].join("\n");
    expect(scan("src/fixture-ml.ts", fixture).find((w) => w.key === "kf_ml_token")?.line).toBe(5);
  });

  it("prose that only names a store is not a write", () => {
    const fixture = `const msg = "localStorage is full; clear the token cache"; const h = "Set-Cookie";`;
    expect(scan("src/fixture-prose.ts", fixture)).toEqual([]);
  });
});

describe("CSC-38 cookie jar aliases and Set-Cookie header names", () => {
  const fixture = [
    `import { cookies as c } from "next/headers";`,
    `const SET_COOKIE = "Set-Cookie";`,
    `export async function h(res: { cookies: { set(n: string, v: string): void }; headers: Headers }, t: string) {`,
    `  const jar = res.cookies;`,
    `  jar.set("kf_rv_session", t);`,
    `  res["cookies"].set("kf_el_session", t);`,
    `  (await c()).set("kf_alias_session", t);`,
    `  res.headers.append(SET_COOKIE, \`kf_const_session=\${t}\`);`,
    `  res.headers.append("Set-" + "Cookie", \`kf_concat_session=\${t}\`);`,
    `  const o = { [SET_COOKIE]: "kf_prop_session=1" };`,
    `  const h2 = new Headers([[SET_COOKIE, "kf_tuple_session=1"]]);`,
    `}`,
  ].join("\n");
  const keys = keysOf(scan("src/fixture-jar.ts", fixture));
  for (const k of ["kf_rv_session", "kf_el_session", "kf_alias_session", "kf_const_session", "kf_concat_session", "kf_prop_session", "kf_tuple_session"]) {
    it(`${k} is found`, () => {
      expect(keys).toContain(`response-cookie:${k}`);
    });
  }
});

describe("CSC-39 a service-worker Cache put on a parameter", () => {
  it("an untyped parameter in public/: a put of the authorization header is a credential write", () => {
    const fixture = `async function stash(cache, req) { await cache.put(req.url, new Response(req.headers.get("authorization"))); }`;
    const ws = scan("public/fixture-stash.js", fixture);
    expect(ws.filter((w) => w.store === "cacheStorage" && isCredential(w)).length).toBe(1);
  });

  it("a parameter typed Cache, anywhere: a put of request headers is a credential write", () => {
    const fixture = `export async function stash(cache: Cache, req: Request) { await cache.put(req.url, new Response(JSON.stringify([...req.headers]))); }`;
    const ws = scan("src/fixture-stash.ts", fixture);
    expect(ws.filter((w) => w.store === "cacheStorage" && isCredential(w)).length).toBe(1);
  });

  it("a Map's put-like call outside public/ on an untyped receiver is not a Cache write", () => {
    const fixture = `export function f(m, req) { m.put(req.url, req.headers); }`;
    expect(scan("src/fixture-map.ts", fixture).filter((w) => w.store === "cacheStorage")).toEqual([]);
  });
});

describe("CSC-40 a key held in a const object or enum", () => {
  const fixture = [
    `const K = { a: "kf_obj_token", b: \`kf_tpl_\${"x"}_secret\` };`,
    `enum E { A = "kf_enum_token", B = "kf_enum_plain" }`,
    `export function save(t: string) {`,
    `  localStorage.setItem(K.a, t);`,
    `  localStorage.setItem(K["b"], t);`,
    `  localStorage.setItem(E.A, t);`,
    `}`,
  ].join("\n");
  it("K.a, K[\"b\"] and E.A are unresolved (round 14: no member access is proven)", () => {
    expect(keysOf(scan("src/fixture-objkey.ts", fixture))).toEqual([`localStorage:${UNRESOLVED}`, `localStorage:${UNRESOLVED}`, `localStorage:${UNRESOLVED}`]);
  });
});

describe("CSC-41 logical assignment", () => {
  const fixture = [
    "document.cookie ||= `kf_la1_session=${t}`;",
    "window.name ??= t;",
    `localStorage["kf_la3_token"] &&= t;`,
  ].join("\n");
  it("finds each", () => {
    expect(keysOf(scan("src/fixture-la.ts", fixture))).toEqual(["cookie:kf_la1_session", "window.name:window.name", "localStorage:kf_la3_token"]);
  });
});

/* ------------------------------------------------------ repair round 7b */

/**
 * Repair round 7b (correctness review of round 6: COR6-2..5).
 *
 *   CSC-42 pins for shapes the AST matcher handles with no case yet (+= on document.cookie, an element-access method
 *          name, element access in a receiver, window.document.cookie); IndexedDB parameters with a union type; both
 *          scanners classify `(localStorage satisfies Storage).setItem` as localStorage; the CSC_DUMP lines are sorted
 *          by file, line, store and key.
 */
describe("CSC-42 round-6 correctness pins", () => {
  for (const [name, fixture, key] of [
    ["+= on document.cookie (pin)", "document.cookie += `kf_pe_session=${t}`;", "cookie:kf_pe_session"],
    ["an element-access method name (pin)", `localStorage['setItem']("kf_em_token", t);`, "localStorage:kf_em_token"],
    ["element access in the receiver (pin)", `window["localStorage"]["setItem"]("kf_er_token", t);`, "localStorage:kf_er_token"],
    ["window.document.cookie (pin)", "window.document.cookie = `kf_wd_session=${t}`;", "cookie:kf_wd_session"],
  ]) {
    it(`${name}: found`, () => {
      expect(keysOf(scan("src/fixture-c6.ts", fixture))).toContain(key);
    });
  }

  it("IndexedDB parameters with a union type are stores and cursors", () => {
    const fixture = [
      `export function f(c: IDBCursorWithValue | null, s: IDBObjectStore | undefined, token: string) {`,
      `  c!.update({ token });`,
      `  s!.put({ token });`,
      `}`,
    ].join("\n");
    expect(scan("src/fixture-union.ts", fixture).filter((w) => w.store === "indexedDB" && isCredential(w)).map((w) => w.line)).toEqual([2, 3]);
  });

  it("both scanners classify (localStorage satisfies Storage).setItem as localStorage", () => {
    const line = `(localStorage satisfies Storage).setItem("kf_sat_token", t);`;
    expect(keysOf(scan("src/fixture-sat.ts", line))).toEqual(["localStorage:kf_sat_token"]);
    // A file with parse errors goes to the text scanner.
    expect(keysOf(scan("src/fixture-sat.tsx", `const f = <T>(x: T) => x;\n${line}`))).toContain("localStorage:kf_sat_token");
  });

  it("the CSC_DUMP lines are sorted by file, line, store and key", () => {
    const ws: Write[] = [
      { store: "localStorage", key: "b", expr: "b", value: "", file: "src/b.ts", line: 2 },
      { store: "cookie", key: "a", expr: "a", value: "", file: "src/a.ts", line: 9 },
      { store: "localStorage", key: "a", expr: "a", value: "", file: "src/b.ts", line: 2 },
      { store: "cookie", key: "z", expr: "z", value: "", file: "src/a.ts", line: 3 },
    ];
    expect((dumpLines as unknown as (w: Write[]) => string[])(ws)).toEqual([
      "CSC ---- cookie z @ src/a.ts:3",
      "CSC ---- cookie a @ src/a.ts:9",
      "CSC ---- localStorage a @ src/b.ts:2",
      "CSC ---- localStorage b @ src/b.ts:2",
    ]);
  });
});

/* ------------------------------------------------------- repair round 8 */

/**
 * Repair round 8 (both reviews REJECT on round 7: CSC7-SEC-1/COR7-1, CSC7-SEC-2/COR7-3; and CSC7-SEC-3, CSC7-SEC-5,
 * COR7-2, COR7-4..7). In the string-code path the census errs toward counting (fail closed), as it does elsewhere.
 *
 *   CSC-43 a string is parsed as code when it names any store the scanners know (storage property and element
 *          assignment included); prose naming none is not parsed (inlineScans counts the parses).
 *   CSC-44 a template substitution is resolved in the host file (a const, JSON.stringify of a const); one that cannot
 *          be resolved makes the write a credential write.
 *   CSC-45 JSX text children of <script> / <Script> are scanned as code.
 *   CSC-46 document["cookie"] = ….
 *   CSC-47 a string that only quotes a write (help text) counts: a deliberate, known false positive.
 *   CSC-48 inner lines map through the raw text, so a "\n" escape does not shift the reported line.
 *   CSC-49 bracketed property names are escaped in full: K["a(b"] does not throw, K["a.b"] is the right property.
 *   CSC-50 a string inside a string (depth 2), and inner code that does not parse (the inner text fallback).
 *   (COR7-7, the dump sort by plain comparison, is pinned in CSC-42's sort case plus one byte-order case here.)
 */
describe("CSC-43 every known store name sends a string to the code scanner", () => {
  for (const [name, fixture, key] of [
    ["__html with a bracket assignment", "const h = { __html: `localStorage[\"kf_ba_token\"] = window.__t;` };", "localStorage:kf_ba_token"],
    ["an IIFE string with a bracket assignment", "const s = \"(function(){ localStorage['kf_pre2_token'] = x; })();\";", "localStorage:kf_pre2_token"],
    ["self.sessionStorage property assignment", "const s = 'self.sessionStorage.kf_x_refresh_token = t;';", "sessionStorage:kf_x_refresh_token"],
    ["eval of a bracket assignment", "eval('localStorage[\"kf_ea_token\"] = t');", "localStorage:kf_ea_token"],
    ["a string setTimeout of a bracket assignment", "setTimeout('localStorage[\"kf_sb_token\"] = window.__t', 0);", "localStorage:kf_sb_token"],
  ]) {
    it(`${name}: found`, () => {
      expect(keysOf(scan("src/fixture-hint.ts", fixture))).toContain(key);
    });
  }

  it("prose that names no store is not parsed; a string that names one is", () => {
    const counter = () => (globalThis as unknown as { __kfInlineScans?: number }).__kfInlineScans ?? 0;
    const before = counter();
    scan("src/fixture-hint2.ts", `const a = "Hello, world (ok) = fine; done."; const b = 'x.y = 1;';`);
    expect(counter() - before, "no store name: not parsed").toBe(0);
    scan("src/fixture-hint3.ts", `const c = "sessionStorage.clear();";`);
    expect(counter() - before, "a store name: parsed once").toBe(1);
  });
});

describe("CSC-44 template substitutions are resolved, and fail closed", () => {
  for (const [name, fixture, key] of [
    ['setItem("${KEY}", …)', 'const KEY = "kf_x_refresh_token";\nconst h = { __html: `localStorage.setItem("${KEY}", window.__t);` };', "localStorage:kf_x_refresh_token"],
    ["setItem(${JSON.stringify(KEY)}, …)", 'const KEY = "kf_x_refresh_token";\nconst h = `localStorage.setItem(${JSON.stringify(KEY)}, t)`;', "localStorage:kf_x_refresh_token"],
    ['document.cookie = "${KEY}=${t}"', 'const KEY = "kf_x_refresh_token";\nconst h = `document.cookie = "${KEY}=${t}"`;', "cookie:kf_x_refresh_token"],
  ]) {
    it(`${name}: the key resolves in the host file`, () => {
      expect(keysOf(scan("src/fixture-sub.ts", fixture))).toContain(key);
    });
  }

  it("an unresolvable substitution in the key makes the write a credential write", () => {
    const fixture = "const h = `localStorage.setItem(\"${pick()}\", \"plain\")`;";
    const ws = scan("src/fixture-sub2.ts", fixture).filter((w) => w.store === "localStorage");
    expect(ws.length).toBe(1);
    expect(isCredential(ws[0])).toBe(true);
  });
});

describe("CSC-45 JSX text children of a script tag are code", () => {
  for (const tag of ["script", "Script"]) {
    it(`<${tag}>…</${tag}>: found`, () => {
      const fixture = `export const P = () => <${tag} id="a">localStorage.setItem("kf_jt_token", window.__t)</${tag}>;`;
      expect(keysOf(scan("src/fixture-jsxscript.tsx", fixture))).toContain("localStorage:kf_jt_token");
    });
  }
});

describe("CSC-46 document[\"cookie\"]", () => {
  it("and in a file with parse errors (the text scanner) too", () => {
    const fixture = `const f = <T>(x: T) => x;\ndocument["cookie"] = "kf_dc2_session=" + t;`;
    expect(keysOf(scan("src/fixture-dc2.tsx", fixture))).toContain("cookie:kf_dc2_session");
  });

  it("document[\"cookie\"] = … is a cookie write", () => {
    expect(keysOf(scan("src/fixture-dc.ts", `document["cookie"] = "kf_dc_session=" + t;`))).toContain("cookie:kf_dc_session");
  });
});

describe("CSC-47 (deliberate false positive) a string that only quotes a write counts", () => {
  it("help text quoting a setItem call is counted as that write", () => {
    const fixture = `const help = "Call localStorage.setItem('kf_help_token', t) to save it.";`;
    expect(keysOf(scan("src/fixture-help.ts", fixture))).toContain("localStorage:kf_help_token");
  });
});

describe("CSC-48 inner lines map through the raw text", () => {
  it("a \\n escape before the write does not shift its line", () => {
    const fixture = `eval("var a = 1;\\nvar b = 2;\\nlocalStorage.setItem('kf_nl_token', t)");`;
    expect(scan("src/fixture-nl.ts", fixture).find((w) => w.key === "kf_nl_token")?.line).toBe(1);
  });
});

describe("CSC-49 bracketed property names are escaped in full", () => {
  it('K["a(b"] and K["a.b"] do not throw, and are unresolved (round 14)', () => {
    const fixture = [`const K = { "a(b": "kf_paren_token", "a.b": "kf_dot_token", aXb: "kf_wrong" };`, `localStorage.setItem(K["a(b"], t);`, `localStorage.setItem(K["a.b"], t);`].join("\n");
    expect(keysOf(scan("src/fixture-esc.ts", fixture))).toEqual([`localStorage:${UNRESOLVED}`, `localStorage:${UNRESOLVED}`]);
  });
});

describe("CSC-50 nested strings and the inner text fallback", () => {
  it("a string inside a string (depth 2) is scanned", () => {
    const fixture = `eval("eval('localStorage.setItem(\\\\'kf_d2_token\\\\', t)')");`;
    expect(keysOf(scan("src/fixture-d2.ts", fixture))).toContain("localStorage:kf_d2_token");
  });

  it("inner code that does not parse is read by the text scanner", () => {
    const fixture = 'eval(`const f = <T>(x: T) => x;\nconst s = "{ /* "; localStorage.setItem("kf_tf_token", t); const z = " */ }";`);';
    expect(keysOf(scan("src/fixture-tf.ts", fixture))).toContain("localStorage:kf_tf_token");
  });
});

describe("CSC-51 the dump sorts by plain comparison (COR7-7)", () => {
  it("upper case sorts before lower case, as bytes do", () => {
    const ws: Write[] = [
      { store: "localStorage", key: "a", expr: "a", value: "", file: "src/a.ts", line: 1 },
      { store: "localStorage", key: "B", expr: "B", value: "", file: "src/a.ts", line: 1 },
    ];
    expect(dumpLines(ws)).toEqual(["CSC ---- localStorage B @ src/a.ts:1", "CSC ---- localStorage a @ src/a.ts:1"]);
  });
});

/* ------------------------------------------------------- repair round 9 */

/**
 * Repair round 9 (both reviews ACCEPT WITH MINORS on round 8: CSC8-SEC-1..3, COR8-1..4).
 *
 *   CSC-52 a substitution whose own text names a credential, or that resolves only partly, fails closed (CSC8-SEC-1/2).
 *   CSC-53 each CODE_HINT branch, one store name per row, and the /i flag (COR8-1).
 *   CSC-54 an unresolvable JSON.stringify(...) substitution fails closed (COR8-2).
 *   CSC-55 line mapping (rawOffsetOf): a backslash continuation, an escaped backslash, CRLF; nesting depth 3 is
 *          scanned, 4 is not
 *          (COR8-3).
 *   CSC-56 the JSX <script> text path needs no hint (COR8-4).
 */
const inlineScans = () => (globalThis as unknown as { __kfInlineScans?: number }).__kfInlineScans ?? 0;
const credentialStorageWrites = (file: string, fixture: string) => scan(file, fixture).filter((w) => w.store === "localStorage" && isCredential(w));

describe("CSC-52 a substitution that names a credential or resolves partly fails closed", () => {
  for (const [name, fixture] of [
    ["${token ? token : \"\"} in the value", 'const h = `localStorage.setItem("kf_plain", "${token ? token : ""}")`;'],
    ['${user ? user.token : "anon"} in the value', 'const h = `localStorage.setItem("kf_plain", "${user ? user.token : "anon"}")`;'],
    ["${a + b} (partly resolved) in the key", 'const h = `localStorage.setItem("${a + b}", "x")`;'],
    ["${`${ns}:boot`} (partly resolved) in the key", 'const h = `localStorage.setItem("${`${ns}:boot`}", "x")`;'],
    ["a resolved const named AUTH_KEY", 'const AUTH_KEY = "kf_a";\nconst h = `localStorage.setItem("${AUTH_KEY}", "x")`;'],
    ["JSON.stringify(REFRESH_STORAGE_KEY)", 'const REFRESH_STORAGE_KEY = "kf_r";\nconst h = `localStorage.setItem(${JSON.stringify(REFRESH_STORAGE_KEY)}, "x")`;'],
  ]) {
    it(`${name}: a credential write`, () => {
      expect(credentialStorageWrites("src/fixture-r9.ts", fixture).length).toBe(1);
    });
  }

  it("a fully resolved, plain const still resolves (pin)", () => {
    const fixture = 'const VIEW_KEY = "kf_view";\nconst h = `localStorage.setItem("${VIEW_KEY}", "grid")`;';
    expect(keysOf(scan("src/fixture-r9b.ts", fixture))).toEqual(["localStorage:kf_view"]);
  });
});

describe("CSC-53 each CODE_HINT branch sends its string to the code scanner", () => {
  for (const [name, fixture, key] of [
    ["document[", `const s = 'document["cookie"] = "kf_h1_session=1"';`, "cookie:kf_h1_session"],
    ["window.name", `const s = "window.name = t";`, "window.name:window.name"],
    ["cookies(", `const s = "cookies().set('kf_h2_session', t)";`, "response-cookie:kf_h2_session"],
    ["objectStore", `const s = "tx.objectStore('s').put({ token })";`, "indexedDB:*"],
    ["cookieStore", `const s = "cookieStore.set('kf_h3_session', t)";`, "cookie:kf_h3_session"],
    ["setItem on an alias", `const s = "storage.setItem('kf_h4_token', t)";`, "storage:kf_h4_token"],
    ["the /i flag (SET-COOKIE)", `const s = "headers.append('SET-COOKIE', 'kf_h5_session=1')";`, "response-cookie:kf_h5_session"],
  ]) {
    it(`${name}: found`, () => {
      expect(keysOf(scan("src/fixture-h.ts", fixture))).toContain(key);
    });
  }

  for (const name of ["self.name", "globalThis.name"]) {
    it(`${name}: the string is parsed`, () => {
      const before = inlineScans();
      scan("src/fixture-h2.ts", `const s = "${name} = t";`);
      expect(inlineScans() - before).toBe(1);
    });
  }
});

describe("CSC-54 an unresolvable JSON.stringify substitution fails closed", () => {
  it("${JSON.stringify(pick())} is a credential write", () => {
    expect(credentialStorageWrites("src/fixture-r9c.ts", "const h = `localStorage.setItem(${JSON.stringify(pick())}, \"x\")`;").length).toBe(1);
  });
});

describe("CSC-55 line mapping and the nesting limit", () => {
  it("a backslash line continuation moves the write to the next host line", () => {
    const fixture = 'eval("var a = 1; \\\nlocalStorage.setItem(\'kf_lc_token\', t)");';
    expect(scan("src/fixture-lc.ts", fixture).find((w) => w.key === "kf_lc_token")?.line).toBe(2);
  });

  it("two continuations before the write move it two host lines", () => {
    const fixture = 'eval("a; \\\nb; \\\nlocalStorage.setItem(\'kf_lc2_token\', t)");';
    expect(scan("src/fixture-lc2.ts", fixture).find((w) => w.key === "kf_lc2_token")?.line).toBe(3);
  });

  it("an escaped backslash before n is not a line break", () => {
    const fixture = `eval("var a = '\\\\\\\\n'; localStorage.setItem('kf_eb_token', t)");`;
    expect(scan("src/fixture-eb.ts", fixture).find((w) => w.key === "kf_eb_token")?.line).toBe(1);
  });

  it("a CRLF line continuation counts as one host line", () => {
    const fixture = 'eval("var a = 1; \\\r\nlocalStorage.setItem(\'kf_crlf_token\', t)");';
    expect(scan("src/fixture-crlf.ts", fixture).find((w) => w.key === "kf_crlf_token")?.line).toBe(2);
  });

  it("a template written with CRLF line ends maps each line once", () => {
    const fixture = "const s = `line1\r\nline2\r\nlocalStorage.setItem('kf_tc_token', t)`;";
    expect(scan("src/fixture-tcrlf.ts", fixture).find((w) => w.key === "kf_tc_token")?.line).toBe(3);
  });

  const wrap = (code: string) => `eval(${JSON.stringify(code)})`;
  const base = 'localStorage.setItem("kf_lv_token", t)';
  it("a write nested three strings deep is found", () => {
    expect(keysOf(scan("src/fixture-lv3.ts", wrap(wrap(wrap(base)))))).toContain("localStorage:kf_lv_token");
  });
  it("a write nested four strings deep is past the limit (documented)", () => {
    expect(keysOf(scan("src/fixture-lv4.ts", wrap(wrap(wrap(wrap(base))))))).not.toContain("localStorage:kf_lv_token");
  });
});

describe("CSC-56 the <script> text path needs no hint", () => {
  it("script text naming no store is still parsed", () => {
    const before = inlineScans();
    scan("src/fixture-s.tsx", `export const P = () => <script>var a = 1</script>;`);
    expect(inlineScans() - before).toBe(1);
  });
});

/* ------------------------------------------------------ repair round 10 */

/**
 * Repair round 10 (both confirmations of round 9 CONFIRMED; two minors).
 *
 *   CSC-57 a substitution whose resolved value holds a line break does not shift the reported line (MINOR 1).
 *   CSC-58 line mapping pins (MINOR 2): inner code that does not parse, nested string code (in a string and in a
 *          template with substitutions), \x / \u / \u{} escapes before a continuation, and the raw placeholder's length.
 */
const lineOfKey = (file: string, fixture: string, key: string) => scan(file, fixture).find((w) => w.key === key)?.line;

describe("CSC-57 a resolved value's line breaks are not host line breaks", () => {
  it("a write after ${A}, A a const holding a newline, is reported on its own host line", () => {
    const fixture = ["const A = `x", "y`;", "const s = `${A}; localStorage.setItem('kf_nl2_token', t)`;"].join("\n");
    expect(lineOfKey("src/fixture-r10a.ts", fixture, "kf_nl2_token")).toBe(3);
  });
});

describe("CSC-58 line mapping pins", () => {
  it("a host file with parse errors (the text scanner) reports host lines", () => {
    const fixture = 'const f = <T>(x: T) => x;\n\nlocalStorage.setItem("kf_hb_token", t);';
    expect(parseFile("src/fixture-r10g.tsx", fixture).ok, "the host does not parse").toBe(false);
    expect(lineOfKey("src/fixture-r10g.tsx", fixture, "kf_hb_token")).toBe(3);
  });

  it("inner code that does not parse (the inner text scanner) maps its lines", () => {
    const fixture = 'eval(`const f = <T>(x: T) => x;\nlocalStorage.setItem("kf_pe_token", t);`);';
    expect(lineOfKey("src/fixture-r10b.ts", fixture, "kf_pe_token")).toBe(2);
  });

  it("nested string code inside a plain template maps through both levels", () => {
    const fixture = ["const s = `a;", "eval(\"localStorage.setItem('kf_nest_token', t)\");`;"].join("\n");
    expect(lineOfKey("src/fixture-r10c.ts", fixture, "kf_nest_token")).toBe(2);
  });

  it("nested string code inside a template with a substitution maps through both levels", () => {
    const fixture = ['const V = "v";', "const s = `${V};", "eval(\"localStorage.setItem('kf_nest2_token', t)\");`;"].join("\n");
    expect(lineOfKey("src/fixture-r10d.ts", fixture, "kf_nest2_token")).toBe(3);
  });

  for (const [name, esc] of [
    ["\\x", "\\x41"],
    ["\\u", "\\u0042"],
    ["\\u{}", "\\u{43}"],
  ]) {
    it(`a ${name} escape before a continuation keeps the write on the next line`, () => {
      // The host source holds the escape itself (\x41, \u0042, \u{43}) and a real backslash line continuation.
      const fixture = `eval("${esc}${esc}; \\\nlocalStorage.setItem('kf_esc_token', t)");`;
      expect(parseFile("src/fixture-r10e.ts", fixture).ok, "the host parses").toBe(true);
      expect(lineOfKey("src/fixture-r10e.ts", fixture, "kf_esc_token")).toBe(2);
    });
  }

  it("the raw placeholder is as long as the resolved value", () => {
    const long = "kf_" + "a".repeat(80);
    const fixture = [`const KEY = "${long}";`, 'const s = `var a = "${KEY}"; \\', 'localStorage.setItem("kf_ph_token", t);', "var b = 1;`;"].join("\n");
    expect(lineOfKey("src/fixture-r10f.ts", fixture, "kf_ph_token")).toBe(3);
  });
});

/* ------------------------------------------------------ repair round 11 */

/**
 * Repair round 11 (security SEC-R10-1): a ternary key resolves to the set of all its branches. If any branch cannot
 * be resolved the key is unresolved and the write fails closed; otherwise each branch is a write, so a credential
 * branch makes a credential write. A null / undefined branch is no key and is skipped.
 *
 *   CSC-59 separate const declarations (q2), a ternary const one hop away (p7), string code (q3), a parameter branch
 *          (p2/p3), and a ternary inside a template substitution in string code (q5).
 */
describe("CSC-59 a ternary key resolves to all its branches", () => {
  const credentialWrites = (file: string, fixture: string) => scan(file, fixture).filter((w) => w.store === "localStorage" && isCredential(w));

  it("q2: separate declarations, `on ? B : A`, the credential branch is seen", () => {
    const fixture = ['const A = "kf_x_token";', 'const B = "kf_x_prefs";', "export const save = (on: boolean, v: string) => localStorage.setItem(on ? B : A, v);"].join("\n");
    expect(keysOf(scan("src/fixture-q2.ts", fixture))).toEqual(expect.arrayContaining(["localStorage:kf_x_prefs", "localStorage:kf_x_token"]));
    expect(credentialWrites("src/fixture-q2.ts", fixture).length).toBeGreaterThan(0);
  });

  it("p7: a ternary const one hop away", () => {
    const fixture = ['const A = "kf_x_token";', 'const B = "kf_x_prefs";', "const K = on ? B : A;", "localStorage.setItem(K, v);"].join("\n");
    expect(credentialWrites("src/fixture-p7.ts", fixture).length).toBeGreaterThan(0);
  });

  it("q3: in string code, a ternary of names the string does not define fails closed", () => {
    const fixture = `eval("localStorage.setItem(on ? B : A, v)");`;
    expect(credentialWrites("src/fixture-q3.ts", fixture).length).toBe(1);
  });

  it("p2/p3: a parameter branch fails closed (save(k) called with a session key)", () => {
    const fixture = `export function save(k: string, flag: boolean, tok: string) { localStorage.setItem(flag ? "kf_prefs" : k, tok); }`;
    expect(credentialWrites("src/fixture-p2.ts", fixture).length).toBe(1);
  });

  it("q5: a ternary inside a template substitution in string code fails closed", () => {
    const fixture = ['const A = "kf_x_token";', 'const B = "kf_x_prefs";', 'const h = `localStorage.setItem("${on ? B : A}", "x")`;'].join("\n");
    expect(credentialWrites("src/fixture-q5.ts", fixture).length).toBe(1);
  });

  // Round 13 (an empty set is never no write): a null branch is the key "null", as JS stores it.
  it("pins: a ternary of two plain keys gives both, and a null branch is the key null", () => {
    const fixture = ['const A = "kf_view_a";', 'const B = "kf_view_b";', "localStorage.setItem(on ? B : A, v);", 'localStorage.setItem(id ? `kf-section-${"x"}` : null, v);'].join("\n");
    expect(keysOf(scan("src/fixture-tp.ts", fixture))).toEqual(["localStorage:kf_view_b", "localStorage:kf_view_a", "localStorage:kf-section-x", "localStorage:null"]);
    expect(credentialWrites("src/fixture-tp.ts", fixture)).toEqual([]);
  });
});

/* ------------------------------------------------------ repair round 12 */

/**
 * Repair round 12, the root fix for key and name positions (security NOT CONFIRMED on round 11; correctness F1-F3):
 * one structural key resolver (resolveKeySet) for every key or name the census reads. It returns a finite set of
 * candidates, a "*" standing for any part it cannot resolve; a key with any "*" part, or naming a credential, makes
 * a credential write (fail closed).
 *
 *   CSC-60 cookie names through the resolver (cookieStore.set, cookies().set).
 *   CSC-61 a ternary inside a template or "+" key (with a parameter branch, with and without a literal caller; also in
 *          string code).
 *   CSC-62 `||` and `??` keys (a caller passing a credential name to the parameter side).
 *   CSC-63 `as`, `!` around a ternary key.
 *   CSC-64 parentheses are structural: `(K1) || (…)`, `(K1) + (…)`, `(getKey)(…)` (correctness F1, F3).
 *   CSC-65 pins: plain branches stay plain writes; the product is capped (over 64 → unresolved).
 */
const credWrites = (file: string, fixture: string, store?: Store) =>
  scan(file, fixture).filter((w) => (store === undefined || w.store === store) && isCredential(w));
const AB = ['const A = "kf_x_token";', 'const B = "kf_x_prefs";'];

describe("CSC-60 cookie names go through the resolver", () => {
  it("cookieStore.set(on ? B : A, v) is a credential write", () => {
    expect(credWrites("src/fixture-r12a.ts", [...AB, "cookieStore.set(on ? B : A, v);"].join("\n"), "cookie").length).toBeGreaterThan(0);
  });
  it("cookies().set(on ? B : A, v) is a credential write", () => {
    expect(credWrites("src/fixture-r12b.ts", [...AB, "cookies().set(on ? B : A, v);"].join("\n"), "response-cookie").length).toBeGreaterThan(0);
  });
});

describe("CSC-61 a ternary inside a template or + key", () => {
  const AB2 = ['const A = "x_token";', 'const B = "x_prefs";'];
  it("`kf_${on ? B : A}` is a credential write", () => {
    expect(credWrites("src/fixture-r12c.ts", [...AB2, "localStorage.setItem(`kf_${on ? B : A}`, v);"].join("\n"), "localStorage").length).toBeGreaterThan(0);
  });
  it("`kf_${on ? \"prefs\" : k}` with k a parameter and no caller is a credential write", () => {
    const fixture = 'export function s(k: string, on: boolean, v: string) { localStorage.setItem(`kf_${on ? "prefs" : k}`, v); }';
    expect(credWrites("src/fixture-r12d.ts", fixture, "localStorage").length).toBeGreaterThan(0);
  });
  it("…and with a caller s(\"session_token\", …) the parameter is still unresolved (round 14)", () => {
    const fixture = 'function s(k: string, on: boolean, v: string) { localStorage.setItem(`kf_${on ? "prefs" : k}`, v); }\ns("session_token", true, "v");';
    expect(keysOf(scan("src/fixture-r12e.ts", fixture))).toEqual(["localStorage:kf_prefs", "localStorage:kf_*"]);
  });
  it('"kf_" + (on ? B : A) is a credential write', () => {
    expect(credWrites("src/fixture-r12f.ts", [...AB2, 'localStorage.setItem("kf_" + (on ? B : A), v);'].join("\n"), "localStorage").length).toBeGreaterThan(0);
  });
  it("the same in string code is a credential write", () => {
    const fixture = 'eval("localStorage.setItem(`kf_${on ? \\"p\\" : A}`, v)");';
    expect(credWrites("src/fixture-r12g.ts", fixture, "localStorage").length).toBeGreaterThan(0);
  });
});

describe("CSC-62 || and ?? keys", () => {
  for (const op of ["||", "??"]) {
    it(`setItem(B ${op} A, v) is a credential write`, () => {
      expect(credWrites("src/fixture-r12h.ts", [...AB, `localStorage.setItem(B ${op} A, v);`].join("\n"), "localStorage").length).toBeGreaterThan(0);
    });
  }
  it('setItem(k || "kf_prefs", v) with a caller passing "kf_session_token" is a credential write', () => {
    const fixture = 'function s(k: string, v: string) { localStorage.setItem(k || "kf_prefs", v); }\ns("kf_session_token", "v");';
    // Round 14: the parameter is unresolved whatever its callers pass.
    expect(keysOf(scan("src/fixture-r12i.ts", fixture))).toEqual([`localStorage:${UNRESOLVED}`, "localStorage:kf_prefs"]);
  });
});

describe("CSC-63 as and ! around a ternary key", () => {
  for (const wrapped of ["(on ? B : A) as string", "(on ? B : A)!"]) {
    it(`setItem(${wrapped}, v) is a credential write`, () => {
      expect(credWrites("src/fixture-r12j.ts", [...AB, `localStorage.setItem(${wrapped}, v);`].join("\n"), "localStorage").length).toBeGreaterThan(0);
    });
  }
});

describe("CSC-64 parentheses are structural", () => {
  const K1 = 'const K1 = "kf_session_token";';
  it('(K1) || (on ? "kf_a" : "kf_b") is a credential write', () => {
    expect(credWrites("src/fixture-r12k.ts", [K1, 'localStorage.setItem((K1) || (on ? "kf_a" : "kf_b"), v);'].join("\n"), "localStorage").length).toBeGreaterThan(0);
  });
  it('(K1) + (on ? "_a" : "_b") is kf_session_token_a and _b, credential writes', () => {
    const fixture = [K1, 'localStorage.setItem((K1) + (on ? "_a" : "_b"), v);'].join("\n");
    expect(keysOf(scan("src/fixture-r12l.ts", fixture))).toEqual(["localStorage:kf_session_token_a", "localStorage:kf_session_token_b"]);
  });
  it('(getKey)(on ? "kf_a" : "kf_b"): a call the resolver cannot follow is a credential write', () => {
    expect(credWrites("src/fixture-r12m.ts", 'localStorage.setItem((getKey)(on ? "kf_a" : "kf_b"), v);', "localStorage").length).toBe(1);
  });
});

describe("CSC-65 pins", () => {
  it("document.cookie's name goes through the resolver: `${on ? B : A}=1` is a credential write", () => {
    expect(credWrites("src/fixture-r12p.ts", [...AB, "document.cookie = `${on ? B : A}=1; Path=/`;"].join("\n"), "cookie").length).toBeGreaterThan(0);
  });
  it("`as` and `!` are unwrapped: a plain key under them stays a plain write", () => {
    const fixture = ['const K = "kf_plain_nn";', 'localStorage.setItem("kf_plain_as" as string, v);', "localStorage.setItem(K!, v);"].join("\n");
    const ws = scan("src/fixture-r12r.ts", fixture);
    expect(keysOf(ws)).toEqual(["localStorage:kf_plain_as", "localStorage:kf_plain_nn"]);
    expect(ws.filter(isCredential)).toEqual([]);
  });
  it("a union over 64 candidates is unresolved (a credential write)", () => {
    const chain = Array.from({ length: 65 }, (_, i) => `x === ${i} ? "kf_p${i}"`).join(" : ") + ' : "kf_q"';
    expect(credWrites("src/fixture-r12s.ts", `localStorage.setItem(${chain}, v);`, "localStorage").length).toBe(1);
  });
  it("a const cycle resolves to unresolved, not a hang", () => {
    const fixture = ["const P = Q;", "const Q = P;", "localStorage.setItem(P, v);"].join("\n");
    expect(credWrites("src/fixture-r12q.ts", fixture, "localStorage").length).toBe(1);
  });
  it('on ? "kf_a" : "kf_b" gives two plain writes', () => {
    const ws = scan("src/fixture-r12n.ts", 'localStorage.setItem(on ? "kf_a" : "kf_b", v);');
    expect(keysOf(ws)).toEqual(["localStorage:kf_a", "localStorage:kf_b"]);
    expect(ws.filter(isCredential)).toEqual([]);
  });
  it("a product over 64 candidates is unresolved (a credential write)", () => {
    const t = (n: number) => `(${Array.from({ length: n }, (_, i) => `x === ${i} ? "p${i}"`).join(" : ")} : "q")`;
    const fixture = `localStorage.setItem(\`kf_\${${t(9)}}_\${${t(9)}}\`, v);`;
    expect(credWrites("src/fixture-r12o.ts", fixture, "localStorage").length).toBe(1);
  });
});

/* ------------------------------------------------------ repair round 13 */

/**
 * Repair round 13 (both lenses NOT CONFIRMED on round 12). The governing rule: the resolver either PROVES a finite
 * set of runtime key strings or returns "*"; an empty set is never "no write"; anything not proven fails closed.
 *
 *   CSC-66 empty candidate sets: null / undefined / void are the JS strings "null" / "undefined" (whole key, in "+"
 *          and templates), a missing argument is its default or "undefined", an empty top-level set is UNRESOLVED.
 *   CSC-67 scope: innermost binding wins (a parameter before an outer const; a const in another function never
 *          resolves); only const resolves, let / var are "*".
 *   CSC-68 const-object members through the resolver: the last property wins, a spread after it is "*".
 *   CSC-69 string code with several plain substitution candidates fails closed.
 *   CSC-70 exported (or passed-as-value) functions: their parameters also take "*"; the enclosing function is the one
 *          that holds the write.
 *   CSC-71 wildcard registry rows are pinned to the write they were read for (key and value source text).
 *   CSC-72 prototype names in bindings (valueOf) do not throw.
 *   CSC-73 adversarial shapes (round 13's own attack): each could carry a credential, so each is a credential write.
 */
const credIn = (file: string, fixture: string, store: Store) => scan(file, fixture).filter((w) => w.store === store && isCredential(w));

describe("CSC-66 an empty candidate set is never no write", () => {
  for (const [name, fixture, store] of [
    ["setItem(null, token)", "localStorage.setItem(null, token);", "localStorage"],
    ["setItem(undefined, accessToken)", "localStorage.setItem(undefined, accessToken);", "localStorage"],
    ['"kf_" + null', 'localStorage.setItem("kf_" + null, token);', "localStorage"],
    ["`kf_${null}`", "localStorage.setItem(`kf_${null}`, token);", "localStorage"],
    ["a function returning only null / undefined", "function key() { return on ? null : undefined; }\nlocalStorage.setItem(key(), token);", "localStorage"],
    ["cookieStore.set(null, token)", "cookieStore.set(null, token);", "cookie"],
    ["mk(id?) with no argument", "function mk(id?: string) { return `kf_session_${id}`; }\nlocalStorage.setItem(mk(), v);", "localStorage"],
    ['key(s = "x") with no argument', 'function key(s = "x") { return `kf_token_${s}`; }\nlocalStorage.setItem(key(), v);', "localStorage"],
    ["key(s?) + s with no argument", 'function key(s?: string) { return "kf_token_" + s; }\nsessionStorage.setItem(key(), v);', "sessionStorage"],
    ["cookies().set(key(), v), key(s?)", 'function key(s?: string) { return "kf_token_" + s; }\ncookies().set(key(), v);', "response-cookie"],
    ['mk(k = "kf_x_token") with no argument', 'function mk(k = "kf_x_token") { return k; }\nlocalStorage.setItem(mk(), v);', "localStorage"],
    ['cookieStore.set(mk(), v), mk(k = "kf_session")', 'function mk(k = "kf_session") { return k; }\ncookieStore.set(mk(), v);', "cookie"],
  ] as Array<[string, string, Store]>) {
    it(`${name}: a credential write`, () => {
      expect(credIn("src/fixture-r13a.ts", fixture, store).length).toBeGreaterThan(0);
    });
  }
  it("setItem(null, v) and `kf_${null}` are the keys JS stores: null and kf_null", () => {
    expect(keysOf(scan("src/fixture-r13b.ts", 'localStorage.setItem(null, "1");\nlocalStorage.setItem(`kf_${null}`, "1");'))).toEqual(["localStorage:null", "localStorage:kf_null"]);
  });
});

describe("CSC-67 scope", () => {
  for (const [name, fixture, store] of [
    ["let reassigned, setItem", 'let k = "kf_prefs";\nk = "kf_x_token";\nlocalStorage.setItem(k, v);', "localStorage"],
    ["let reassigned, document.cookie", 'let k = "kf_prefs";\nk = "kf_x_token";\ndocument.cookie = `${k}=1`;', "cookie"],
    ["let reassigned, caches.open", 'let k = "kf-prefs";\nk = "kf-x-token-cache";\ncaches.open(k);', "cacheStorage"],
    ["a const in another function", 'function a() { const key = "prefs"; return key; }\nexport function b(key: string, v: string) { localStorage.setItem(`kf_${key}`, v); }', "localStorage"],
    ["a parameter shadows an outer const", 'const k = "kf_prefs";\nexport function s(k: string, v: string) { localStorage.setItem(k, v); }', "localStorage"],
    ["var", 'var k = "kf_prefs";\nlocalStorage.setItem(k, v);', "localStorage"],
  ] as Array<[string, string, Store]>) {
    it(`${name}: a credential write`, () => {
      expect(credIn("src/fixture-r13c.ts", fixture, store).length).toBeGreaterThan(0);
    });
  }
  it("pin: a module const is still resolved inside a function that does not shadow it", () => {
    expect(keysOf(scan("src/fixture-r13d.ts", 'const k = "kf_view";\nfunction s() { localStorage.setItem(k, "1"); }\ns();'))).toEqual(["localStorage:kf_view"]);
  });
});

describe("CSC-68 const-object members through the resolver", () => {
  for (const [name, fixture, store] of [
    ["a ternary member", 'const K = { a: on ? "kf_prefs" : "kf_x_token" };\nlocalStorage.setItem(K.a, v);', "localStorage"],
    ["a ternary member via cookieStore.set", 'const K = { a: on ? "kf_prefs" : "kf_x_token" };\ncookieStore.set(K.a, v);', "cookie"],
    ["a template member with an unresolved part", 'const K = { a: `kf_${on ? "prefs" : T}` };\nlocalStorage.setItem(K.a, v);', "localStorage"],
    ["the last duplicate wins", 'const K = { inner: { a: "kf_prefs" }, a: "kf_x_token" };\nlocalStorage.setItem(K.a, v);', "localStorage"],
    ["a spread after the property", 'const O = {};\nconst K = { a: "kf_prefs", ...O };\nlocalStorage.setItem(K.a, v);', "localStorage"],
  ] as Array<[string, string, Store]>) {
    it(`${name}: a credential write`, () => {
      expect(credIn("src/fixture-r13e.ts", fixture, store).length).toBeGreaterThan(0);
    });
  }
});

describe("CSC-69 string code with several plain substitution candidates", () => {
  it('new Function(`…"kf_${on ? "x" : "au"}th"…`) fails closed', () => {
    const fixture = 'const f = new Function("v", `localStorage.setItem("kf_${on ? "x" : "au"}th", v)`);';
    expect(credIn("src/fixture-r13f.ts", fixture, "localStorage").length).toBeGreaterThan(0);
  });
});

describe("CSC-70 exported functions and the enclosing function", () => {
  it("an exported function's parameter also takes *", () => {
    expect(credIn("src/fixture-r13g.ts", 'export function save(k: string, v: string) { localStorage.setItem(`kf_${k}`, v); }\nsave("prefs", "1");', "localStorage").length).toBeGreaterThan(0);
  });
  it("a function passed as a value: its parameter also takes *", () => {
    expect(credIn("src/fixture-r13h.ts", 'function s(k: string) { localStorage.setItem(k, "1"); }\ns("kf_view");\n["a"].forEach(s);', "localStorage").length).toBeGreaterThan(0);
  });
  it("the enclosing function, not an earlier one with the same parameter name", () => {
    const fixture = 'function a(k: string) { return k; }\na("kf_prefs");\nfunction b() { localStorage.setItem(k, "x"); }';
    expect(credIn("src/fixture-r13i.ts", fixture, "localStorage").length).toBeGreaterThan(0);
  });
});

describe("CSC-71 wildcard registry rows are pinned to their write", () => {
  it("every registry row with a * or UNRESOLVED key names its key and value source text", () => {
    for (const r of REGISTRY.filter((x) => x.key.includes("*") || x.key === UNRESOLVED)) {
      const pinned = r as RegistryRow & { keyExpr?: string; valueExpr?: string };
      expect(pinned.keyExpr, `${id(r)} keyExpr`).toBeTruthy();
      // A caches.open has no value: its pin is the empty value text, which must still be given.
      expect(typeof pinned.valueExpr, `${id(r)} valueExpr`).toBe("string");
    }
  });
  it("a different write of the same key shape in that file is unregistered", () => {
    const planted: Write = { store: "localStorage", key: "kf_cart_*", expr: "`kf_cart_${session.token}`", value: "accessToken", file: "src/app/book/[slug]/components/utils.ts", line: 99 };
    expect(compare([...census(), planted], REGISTRY).unregistered.some((u) => u.includes("kf_cart_*") && u.includes(":99"))).toBe(true);
  });
});

describe("CSC-66b a function that can end without a return", () => {
  it("is a call, so unresolved (round 14)", () => {
    const fixture = 'function key(on: boolean) { if (on) return "kf_p"; }\nlocalStorage.setItem(key(x), "1");';
    expect(keysOf(scan("src/fixture-r13k.ts", fixture))).toEqual([`localStorage:${UNRESOLVED}`]);
  });
});

describe("CSC-72 prototype names in bindings", () => {
  it("`kf_${valueOf}` in a called function does not throw, and fails closed", () => {
    const fixture = 'function key(k: string) { return `kf_${valueOf}`; }\nlocalStorage.setItem(key("a"), "1");';
    expect(() => scan("src/fixture-r13j.ts", fixture)).not.toThrow();
    expect(credIn("src/fixture-r13j.ts", fixture, "localStorage").length).toBe(1);
  });
});

/** Round 14: a write whose key the resolver did not prove (UNRESOLVED, or a key with a "*" part). */
const unproven = (w: Write) => w.key === UNRESOLVED || w.key.includes("*");
/** The fixture's writes to `store`: at least one, and every one of them unproven (and so a credential write). */
const expectUnproven = (file: string, fixture: string, store: Store = "localStorage", files?: Record<string, string>) => {
  const ws = scan(file, fixture, files ? { files } : undefined).filter((w) => w.store === store);
  expect(ws.length, "the write is found").toBeGreaterThan(0);
  for (const w of ws) {
    expect(unproven(w), `${w.key} (key source: ${w.expr}) is not proven`).toBe(true);
    expect(isCredential(w)).toBe(true);
  }
};

describe("CSC-73 adversarial shapes (round 13; round 14: the credential word is out of the key text)", () => {
  // T holds the credential word, so a key's source text never names one (CREDENTIAL_PATTERN on the expression cannot
  // carry the case): each shape passes only because the resolver proves nothing about its key.
  const T = 'const T = "kf_x_token";\n';
  const shapes: Array<[string, string]> = [
    ["a getter member", 'const K = { get a() { return T; } };\nlocalStorage.setItem(K.a, v);'],
    ["a computed member", "const K = { a: T };\nlocalStorage.setItem(K[name], v);"],
    ["an optional call", "const fn = () => T;\nlocalStorage.setItem(fn?.(), v);"],
    ["a comma expression", "localStorage.setItem((0, T), v);"],
    ["an IIFE", "localStorage.setItem((() => T)(), v);"],
    ["a generic call", "function mk<X>(k: X) { return k; }\nlocalStorage.setItem(mk<string>(T), v);"],
    ["a tagged template", "localStorage.setItem(tag`${T}`, v);"],
    ["an assignment as the key", "let k;\nlocalStorage.setItem((k = T), v);"],
    ["an async return awaited", "async function mk() { return T; }\nlocalStorage.setItem(await mk(), v);"],
    ["a reassigned parameter", 'function s(k: string) { k = T; localStorage.setItem(k, v); }\ns("kf_p");'],
    ["a closure over a const", "function outer() { const k = T; return () => localStorage.setItem(k, v); }"],
    ["a default export's parameter", "export default function (k: string, v: string) { localStorage.setItem(k, v); }\nvoid T;"],
    ["a destructured parameter", "function s({ k }: { k: string }) { localStorage.setItem(k, v); }\ns({ k: T });"],
    ["a rest parameter", "function s(...ks: string[]) { localStorage.setItem(ks[0], v); }\ns(T);"],
    ["a method call in a template", "localStorage.setItem(`kf_${T.toString()}`, v);"],
    ["String.raw", "localStorage.setItem(String.raw`${T}`, v);"],
    ["an array literal index", "localStorage.setItem([T][0], v);"],
    ["an optional member", "const K = { a: T };\nlocalStorage.setItem(K?.a, v);"],
    ["new String", "localStorage.setItem(new String(T) as unknown as string, v);"],
    ["&& in a const", "const k = cond && T;\nlocalStorage.setItem(k, v);"],
    ["an inner const shadows an outer plain one", 'const k = "kf_p";\nfunction f() { const k = T; localStorage.setItem(k, v); }'],
    ["var hoisting", "localStorage.setItem(k, v);\nvar k = T;"],
    ["a for-of variable", "for (const k of [T]) localStorage.setItem(k, v);"],
    ["a catch parameter", "try { f(T); } catch (k) { localStorage.setItem(k as string, v); }"],
    ["a class field via this", "class C { k = T; s() { localStorage.setItem(this.k, v); } }"],
    ["an enum built with +", 'enum E { A = "kf_x" + "_y" }\nlocalStorage.setItem(E.A, v);\nvoid T;'],
    ["a spread override", 'const O = { a: T };\nconst K = { a: "kf_p", ...O };\nlocalStorage.setItem(K.a, v);'],
    ["an imported function", 'import { mk } from "./keys";\nlocalStorage.setItem(mk(T), v);'],
    ["String(param) with no callers", "function s(k: string) { localStorage.setItem(String(k), v); }\nvoid T;"],
    ["a method on a template", "localStorage.setItem(`${T}`.trim(), v);"],
    ["an arrow default", "const s = (k = T) => localStorage.setItem(k, v);\ns();"],
    ["an exported const arrow", "export const s = (k: string) => localStorage.setItem(k, v);\ns(T);"],
    ["a function passed to forEach", "function s(k: string) { localStorage.setItem(k, v); }\n[T].forEach(s);"],
  ];
  for (const [name, fixture] of shapes) {
    it(`${name}: unproven`, () => expectUnproven("src/fixture-adv.ts", T + fixture));
  }
  // Two round-13 shapes are inside the grammar: the resolver proves the credential key itself.
  it("a template of two consts is proven: kf_x_token, through the resolver", () => {
    const ws = scan("src/fixture-adv2.ts", 'const A = "kf_x";\nconst B = "_token";\nlocalStorage.setItem(`${A}${B}`, v);');
    expect(keysOf(ws)).toEqual(["localStorage:kf_x_token"]);
    expect(ws.filter(isCredential).length).toBe(1);
  });
  it("globalThis.localStorage with a top-level const is proven: kf_x_token", () => {
    expect(keysOf(scan("src/fixture-adv3.ts", T + "globalThis.localStorage.setItem(T, v);"))).toEqual(["localStorage:kf_x_token"]);
  });
});

/**
 * Repair round 14 (both lenses NOT CONFIRMED on round 13: 20 security and 3 correctness shapes where the resolver
 * claimed a key it had not proven). The approach is inverted: the resolver proves only a small grammar (see
 * resolveKeySet) and everything else is "*".
 *
 *   CSC-76 the reviewers' shapes, and every way a top-level const can stop being proven (provenConsts), are unproven.
 *   CSC-77 each grammar rule proves its keys (pins: with the rule off, a plain key would read as a credential).
 *   CSC-78 names and attributes: database and cache names, Set-Cookie header names, and cookie attributes.
 */
describe("CSC-76 the round-13 review shapes and the const rules: unproven", () => {
  const T = 'const T = "kf_x_token";\n';
  const shapes: Array<[string, string]> = [
    // The security lens.
    ["var hoisting from a nested block", 'const k = "kf_p";\nfunction f() { { var k = T; } localStorage.setItem(k, v); }'],
    ["a const object mutated: K.a = …", 'const K = { a: "kf_p" };\nK.a = T;\nlocalStorage.setItem(K.a, v);'],
    ["a const object mutated: Object.assign", 'const K = { a: "kf_p" };\nObject.assign(K, { a: T });\nlocalStorage.setItem(K.a, v);'],
    ["a const object mutated: defineProperty", 'const K = { a: "kf_p" };\nObject.defineProperty(K, "a", { value: T });\nlocalStorage.setItem(K.a, v);'],
    ['a const object mutated: K["a"] = …', 'const K = { a: "kf_p" };\nK["a"] = T;\nlocalStorage.setItem(K["a"], v);'],
    ["an enum mutated: (E as any).A = …", 'enum E { A = "kf_p" }\n(E as any).A = T;\nlocalStorage.setItem(E.A, v);'],
    ["a computed property name", 'const K = { [N]: T, a: "kf_p" };\nlocalStorage.setItem(K.a, v);'],
    ["a wrapper's bound name shadowed by an inner const", 'function w(k: string) { { const k = T; localStorage.setItem(k, v); } }\nw("kf_p");'],
    ["a parameter reassigned by destructuring", 'function s(k: string) { [k] = [T]; localStorage.setItem(k, v); }\ns("kf_p");'],
    ["a parameter reassigned by for…of", 'function s(k: string) { for (k of [T]) localStorage.setItem(k, v); }\ns("kf_p");'],
    ["a call site s?.(T)", 'function s(k: string) { localStorage.setItem(k, v); }\ns("kf_p");\ns?.(T);'],
    ["a call site s<number>(T)", 'function s<X>(k: string) { localStorage.setItem(k, v); }\ns("kf_p");\ns<number>(T);'],
    ["a named function expression called through an alias", 'const alias = function s(k: string) { localStorage.setItem(k, v); };\nalias(T);'],
    ["an imported `export let`", 'import { K } from "./keys";\nlocalStorage.setItem(K, v);\nvoid T;'],
    ["an imported inner-scope const", 'import { K } from "./inner";\nlocalStorage.setItem(K, v);\nvoid T;'],
    ["an imported `export { REAL as KEY }`", 'import { KEY } from "./reexport";\nlocalStorage.setItem(KEY, v);\nvoid T;'],
    ["a commented-out import", '/* import { K } from "./plain"; */\nimport { K } from "./secret";\nlocalStorage.setItem(K, v);\nvoid T;'],
    ["duplicate function declarations", 'function key() { return "kf_p"; }\nfunction key() { return T; }\nlocalStorage.setItem(key(), v);'],
    ["sloppy arguments[0] = …", 'function s(k) { arguments[0] = T; localStorage.setItem(k, v); }\ns("kf_p");'],
    ["a spread argument before the parameter's index", 'function s(a: string, k: string) { localStorage.setItem(k, v); }\ns(...xs, "kf_p");\nvoid T;'],
    // The const rules (provenConsts): a top-level const stops being proven when it is written or declared twice.
    ["a top-level const reassigned", 'const k = "kf_p";\nk = T;\nlocalStorage.setItem(k, v);'],
    ["a top-level const += ", 'const k = "kf_p";\nk += T;\nlocalStorage.setItem(k, v);'],
    ["a top-level const ++", 'const k = "kf_p";\nk++;\nlocalStorage.setItem(k, v);\nvoid T;'],
    ["a top-level const --", 'const k = "kf_p";\n--k;\nlocalStorage.setItem(k, v);\nvoid T;'],
    ["a top-level const in an array pattern", 'const k = "kf_p";\n[k] = [T];\nlocalStorage.setItem(k, v);'],
    ["a top-level const in a rest pattern", 'const k = "kf_p";\n[...k] = [T];\nlocalStorage.setItem(k, v);'],
    ["a top-level const in a shorthand pattern", 'const k = "kf_p";\n({ k } = { k: T });\nlocalStorage.setItem(k, v);'],
    ["a top-level const in a property pattern", 'const k = "kf_p";\n({ a: k } = { a: T });\nlocalStorage.setItem(k, v);'],
    ["a top-level const in a nested pattern", 'const k = "kf_p";\n({ a: [k] } = { a: [T] });\nlocalStorage.setItem(k, v);'],
    ["a top-level const in a parenthesised target", 'const k = "kf_p";\n(k as string) = T;\nlocalStorage.setItem(k, v);'],
    ["a top-level const as a for…of head", 'const k = "kf_p";\nfor (k of [T]) localStorage.setItem(k, v);'],
    ["a top-level const as a for…in head", 'const k = "kf_p";\nfor (k in { [T]: 1 }) localStorage.setItem(k, v);'],
    ["a top-level const deleted", 'const k = "kf_p";\ndelete k;\nlocalStorage.setItem(k, v);\nvoid T;'],
    ["a top-level const and a parameter of the same name", 'const k = "kf_p";\nfunction g(k: string) { return k; }\nlocalStorage.setItem(k, v);\nvoid T;'],
    ["a top-level const and a catch variable of the same name", 'const k = "kf_p";\ntry { f(T); } catch (k) { g(k); }\nlocalStorage.setItem(k, v);'],
    ["a top-level const and an import of the same name", 'import { k } from "./keys";\nconst k = "kf_p";\nlocalStorage.setItem(k, v);\nvoid T;'],
    ["a top-level const and a function of the same name", 'const k = "kf_p";\nfunction k() { return T; }\nlocalStorage.setItem(k, v);'],
    ["a top-level const in a file with a with statement", 'const k = "kf_p";\nwith (o) { localStorage.setItem(k, v); }\nvoid T;'],
    ["a top-level const in a file with an eval call", 'const k = "kf_p";\neval(src);\nlocalStorage.setItem(k, v);\nvoid T;'],
    ["a top-level let", 'let k = "kf_p";\nlocalStorage.setItem(k, v);\nvoid T;'],
    ["a top-level var", 'var k = "kf_p";\nlocalStorage.setItem(k, v);\nvoid T;'],
    ["a top-level using", 'using k = "kf_p";\nlocalStorage.setItem(k, v);\nvoid T;'],
    ["a destructured top-level const", 'const { k } = { k: "kf_p" };\nlocalStorage.setItem(k, v);\nvoid T;'],
    ["a top-level const holding an array", 'const k = ["kf_p"];\nlocalStorage.setItem(k as unknown as string, v);\nvoid T;'],
    ["a top-level const holding a call", 'const k = String("kf_p");\nlocalStorage.setItem(k, v);\nvoid T;'],
    // Outside the grammar.
    ["a number", "localStorage.setItem(1 as unknown as string, v);\nvoid T;"],
    ['"kf_" + a number', 'localStorage.setItem("kf_" + 1, v);\nvoid T;'],
    ["&&", 'localStorage.setItem(on && "kf_p", v);\nvoid T;'],
    ["void 0", "localStorage.setItem(void 0 as unknown as string, v);\nvoid T;"],
    ["<string> assertion", 'localStorage.setItem(<string>"kf_p", v);\nvoid T;'],
    ["await", 'localStorage.setItem(await "kf_p", v);\nvoid T;'],
    ["a shadowed undefined", 'function f(undefined: string) { return undefined; }\nlocalStorage.setItem(undefined as unknown as string, v);\nvoid T;'],
  ];
  for (const [name, fixture] of shapes) {
    it(`${name}: unproven`, () => expectUnproven("src/fixture-r14.ts", T + fixture));
  }
  it("a const in a file that does not parse: unproven", () => {
    const fixture = 'const k = "kf_p";\nlocalStorage.setItem(k, v);\nconst broken = ;';
    expect(parseFile("src/fixture-r14b.ts", fixture).ok).toBe(false);
    expectUnproven("src/fixture-r14b.ts", fixture);
  });
  it("an import is unproven even when the imported file holds a plain const", () => {
    expectUnproven("src/fixture-r14c.ts", 'import { K } from "./keys";\nlocalStorage.setItem(K, v);', "localStorage", { "src/keys.ts": 'export const K = "kf_p";' });
  });
});

describe("CSC-77 the proven grammar: each rule proves its keys", () => {
  for (const [name, fixture, keys] of [
    ["a string literal", 'localStorage.setItem("kf_a", "1");', ["kf_a"]],
    ["a no-substitution template", 'localStorage.setItem(`kf_b`, "1");', ["kf_b"]],
    ["a top-level const", 'const K = "kf_c";\nlocalStorage.setItem(K, "1");', ["kf_c"]],
    ["an exported top-level const", 'export const K = "kf_c2";\nlocalStorage.setItem(K, "1");', ["kf_c2"]],
    ["a top-level const read in a function", 'const K = "kf_c3";\nfunction f() { localStorage.setItem(K, "1"); }', ["kf_c3"]],
    ["a const of consts", 'const A = "kf_";\nconst B = A + "d";\nlocalStorage.setItem(B, "1");', ["kf_d"]],
    ["+", 'localStorage.setItem((on ? "kf_e1" : "kf_e2") + "_x", "1");', ["kf_e1_x", "kf_e2_x"]],
    ["a template", 'localStorage.setItem(`kf_${on ? "f1" : "f2"}`, "1");', ["kf_f1", "kf_f2"]],
    ["a ternary", 'localStorage.setItem(on ? "kf_g1" : "kf_g2", "1");', ["kf_g1", "kf_g2"]],
    ["||", 'const H = "kf_h0";\nlocalStorage.setItem(H || "kf_h1", "1");', ["kf_h0", "kf_h1"]],
    ["??", 'const H = "kf_i0";\nlocalStorage.setItem(H ?? "kf_i1", "1");', ["kf_i0", "kf_i1"]],
    ["parentheses", 'localStorage.setItem(("kf_j"), "1");', ["kf_j"]],
    ["as", 'localStorage.setItem("kf_k" as string, "1");', ["kf_k"]],
    ["satisfies", 'localStorage.setItem("kf_l" satisfies string, "1");', ["kf_l"]],
    ["!", 'const K = "kf_m";\nlocalStorage.setItem(K!, "1");', ["kf_m"]],
    ["null as a whole key", 'localStorage.setItem(null as unknown as string, "1");', ["null"]],
    ["null in +", 'localStorage.setItem("kf_" + null, "1");', ["kf_null"]],
    ["null in a template", 'localStorage.setItem(`kf_${null}`, "1");', ["kf_null"]],
    ["undefined as a whole key", 'localStorage.setItem(undefined as unknown as string, "1");', ["undefined"]],
    ["undefined in a template", 'localStorage.setItem(`kf_${undefined}`, "1");', ["kf_undefined"]],
    ["a const read as an argument and exported by name", 'const K = "kf_n";\nexport { K };\ng(K);\nlocalStorage.setItem(K, "1");', ["kf_n"]],
    ["a const used as a destructuring default", 'const K = "kf_o";\nconst { a = K } = o;\nlocalStorage.setItem(K, "1");', ["kf_o"]],
    ["a const inside a type position", 'const K = "kf_q";\ntype X = typeof K;\nlocalStorage.setItem(K, "1");', ["kf_q"]],
  ] as Array<[string, string, string[]]>) {
    it(`${name}: ${keys.join(", ")}`, () => {
      const ws = scan("src/fixture-r14g.ts", fixture);
      expect(keysOf(ws)).toEqual(keys.map((k) => `localStorage:${k}`));
      expect(ws.filter(isCredential)).toEqual([]);
    });
  }
  it("a member name, property name or label equal to a const's name does not unprove it", () => {
    const fixture = 'const K = "kf_r";\nconst o = { K: 1 };\no.K = 2;\nK: for (;;) break K;\nlocalStorage.setItem(K, "1");';
    expect(keysOf(scan("src/fixture-r14h.ts", fixture))).toEqual(["localStorage:kf_r"]);
  });
  it("a const cycle is unproven", () => {
    expectUnproven("src/fixture-r14i.ts", "const A = B;\nconst B = A;\nlocalStorage.setItem(A, v);");
  });
});

describe("CSC-78 names and attributes (round 14)", () => {
  it("indexedDB.open and caches.open names: one proven name, else UNRESOLVED", () => {
    const fixture = 'const DB = "kf-db";\nindexedDB.open(DB, 1);\nindexedDB.open(on ? "kf-a" : "kf-b", 1);\ncaches.open(DB);\nfunction c(n: string) { return caches.open(n); }';
    const ws = scan("src/fixture-r14n.ts", fixture);
    expect(ws.filter((w) => w.store === "indexedDB").map((w) => w.key)).toEqual(["kf-db", UNRESOLVED]);
    expect(ws.filter((w) => w.store === "cacheStorage").map((w) => w.key)).toEqual(["kf-db", UNRESOLVED]);
  });
  it("a cache put into a cache whose name is a parameter is UNRESOLVED, not the parameter's name", () => {
    const fixture = "async function put(cacheName: string, r: Request, res: Response) { const c = await caches.open(cacheName); c.put(r, res); }";
    const puts = scan("public/fixture-r14p.js", fixture).filter((w) => w.store === "cacheStorage");
    expect(puts.map((w) => w.key)).toEqual([UNRESOLVED, UNRESOLVED]);
  });
  it("a Set-Cookie header name: a proven const, and an unproven name whose source names a set-cookie", () => {
    const fixture = [
      'const SC = "Set-Cookie";',
      'h.set(SC, "kf_h1_session=1");',
      'h.set(H.SET_COOKIE, "kf_h2_session=1");',
      'h.append(imported.setCookie, "kf_h3_session=1");',
      'h.set(name, "kf_h4_view=1");',
    ].join("\n");
    expect(keysOf(scan("src/fixture-r14s.ts", fixture))).toEqual(["response-cookie:kf_h1_session", "response-cookie:kf_h2_session", "response-cookie:kf_h3_session"]);
  });
  it("cookie attributes: a proven Max-Age, the exact local https-only Secure, and nothing else from a local const", () => {
    const fixture = [
      "const AGE = 60;",
      "function w(t: string) {",
      '  const secure = isHttps() ? "; Secure" : "";',
      '  const loose = isHttps() ? "; Secure; Path=/x" : "";',
      "  document.cookie = `kf_a1_view=1; Max-Age=${AGE}${secure}`;",
      "  document.cookie = `kf_a2_view=1; Max-Age=${AGE}${loose}`;",
      "}",
    ].join("\n");
    const ws = scan("src/fixture-r14a.ts", fixture);
    expect(ws.find((w) => w.key === "kf_a1_view")?.attrs).toEqual(["max-age=60", "secure-on-https"]);
    expect(ws.find((w) => w.key === "kf_a2_view")?.attrs).toEqual(["max-age=60*"]);
  });
  it("a local let cannot make a write read as a clear (its value and Max-Age are not proven)", () => {
    const fixture = 'function f(t: string) {\n  let e = "";\n  e = t;\n  let z = 0;\n  z = 600;\n  document.cookie = `kf_view=${e}; Max-Age=${z}`;\n}';
    expect(keysOf(scan("src/fixture-r14c2.ts", fixture))).toEqual(["cookie:kf_view"]);
  });
});

describe("CSC-74 (pins) round-13 rules a fail-closed '*' would otherwise hide", () => {
  it("undefined as a whole key is the key undefined (N2)", () => {
    expect(keysOf(scan("src/fixture-r13l.ts", 'localStorage.setItem(undefined, "1");'))).toEqual(["localStorage:undefined"]);
  });
  it("a duplicate property: unresolved (round 14: no member access is proven)", () => {
    expect(keysOf(scan("src/fixture-r13m.ts", 'const K = { a: "kf_prefs", a: "kf_x_token" };\nlocalStorage.setItem(K.a, "1");'))).toEqual([`localStorage:${UNRESOLVED}`]);
  });
  it("a wrapper's cookie template naming valueOf does not throw (N12, literalValue bindings)", () => {
    const fixture = 'function w(name: string, value: string) { document.cookie = `${name}=${valueOf}`; }\nw("kf_a", "1");';
    expect(() => scan("src/fixture-r13n.ts", fixture)).not.toThrow();
  });
  it("a parameter of the function that holds the write is unresolved, whatever its callers pass (round 14)", () => {
    const fixture = 'function b(k: string) {\n  function c(k: string) { return k; }\n  c("kf_x_token");\n  localStorage.setItem(k, "1");\n}\nb("kf_view");';
    const ws = scan("src/fixture-r13o.ts", fixture);
    expect(keysOf(ws)).toEqual([`localStorage:${UNRESOLVED}`]);
    expect(ws.filter(isCredential).length).toBe(1);
  });
  it("a parameter with no callers takes * even beside a plain fallback (N17)", () => {
    expect(credIn("src/fixture-r13p.ts", 'function s(k: string) { localStorage.setItem(k || "kf_view", "1"); }', "localStorage").length).toBe(1);
  });
  for (const [name, fixture] of [
    ["a rest parameter returned", 'function mk(...k: string[]) { return k; }\nlocalStorage.setItem(mk("kf_view") as unknown as string, "1");'],
    ["a parameter reassigned before it is returned", 'function mk(k: string) { k = "kf_x_token"; return k; }\nlocalStorage.setItem(mk("kf_view"), "1");'],
  ]) {
    it(`${name}: not bound to the call's argument (N19)`, () => {
      expect(credIn("src/fixture-r13q.ts", fixture, "localStorage").length).toBe(1);
    });
  }
});

describe("CSC-75 (pin) a const cycle stops at the cycle guard, not at the depth cap (R14)", () => {
  it("a four-way const cycle fails closed at once", () => {
    const fixture = "const A = B + B + B + B;\nconst B = A + A + A + A;\nlocalStorage.setItem(A, \"1\");";
    const t0 = Date.now();
    const n = credIn("src/fixture-r13r.ts", fixture, "localStorage").length;
    expect(n).toBe(1);
    // Without the guard each hop re-expands four ways until the depth cap (4^12 paths): far slower than this bound.
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
