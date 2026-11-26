/**
 * RR-ADMIN-SHELL-SERVER-GATE: /admin pages are refused at the edge without an unexpired admin session cookie.
 *
 * Before this packet, middleware.ts matched /app/:path* only, so every /admin page's HTML was served to anyone and
 * the shell decided client-side (app/admin/layout.tsx is "use client" and calls isSuperAdmin). The admin APIs stay
 * the authority (AuthGuard + AdminGuard on the server); the edge check cannot verify the HMAC and grants nothing. It
 * only refuses the shell to a browser that holds no kf_admin_token cookie shaped like one buildAdminToken issues:
 * three parts, payload.type === "admin", payload.exp in MILLISECONDS and in the future (admin-token.util.ts).
 *
 *   MAG-01 config.matcher covers /admin and /admin/* (RED at the base: /app only).
 *   MAG-02 GET /admin/users with no cookie: redirected to /admin/login, cookie cleared (RED at the base: passes).
 *   MAG-03 a malformed cookie, a non-admin payload, a missing exp and an expired exp each redirect and clear.
 *   MAG-04 an unexpired admin-shaped cookie passes, on /admin and on /admin/users.
 *   MAG-05 /admin/login always passes, with or without a cookie (no redirect loop).
 *   MAG-06 guard: the /app branch is unchanged (no cookie and an expired kf_token still go to /auth/login with ?from=).
 */
import { describe, it, expect } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { middleware, config } from "../../middleware";

const ORIGIN = "http://localhost:3000";
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

function adminToken(payload: Record<string, unknown>): string {
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.not-a-real-signature`;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const validAdmin = () =>
  adminToken({ sub: "admin_1", email: "a@example.test", role: "SUPER_ADMIN", iat: Date.now(), exp: Date.now() + DAY_MS, type: "admin", jti: "j1" });

function request(path: string, cookies: Record<string, string> = {}): NextRequest {
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new NextRequest(new URL(path, ORIGIN), { headers: cookie ? { cookie } : {} });
}

/** Mirrors Next's matcher for the patterns this file uses (":path*" = zero or more segments). */
function matched(pathname: string): boolean {
  return config.matcher.some((pattern) => {
    const re = new RegExp("^" + pattern.replace(/\/:path\*$/, "(?:/.*)?") + "$");
    return re.test(pathname);
  });
}

/**
 * What Next does with a request: a path the matcher does not cover never reaches the middleware and is served as is
 * (a pass-through); a covered path gets whatever the middleware returns.
 */
function run(path: string, cookies: Record<string, string> = {}): Response {
  const req = request(path, cookies);
  return matched(req.nextUrl.pathname) ? middleware(req) : NextResponse.next();
}

function expectRefused(res: Response, cookieName: string) {
  expect(res.status, "a redirect, not a pass-through").toBe(307);
  const location = new URL(res.headers.get("location")!);
  expect(location.pathname).toBe("/admin/login");
  const setCookie = res.headers.get("set-cookie") ?? "";
  expect(setCookie, "the cookie is cleared").toMatch(new RegExp(`${cookieName}=;`));
  expect(setCookie).toMatch(/Max-Age=0/i);
}

function expectPassed(res: Response) {
  expect(res.headers.get("location"), "no redirect").toBeNull();
  expect(res.headers.get("x-middleware-next"), "NextResponse.next()").toBe("1");
}

describe("MAG-01 the middleware runs on the admin shell", () => {
  it("config.matcher covers /admin, /admin/users and /admin/login", () => {
    expect(matched("/admin")).toBe(true);
    expect(matched("/admin/users")).toBe(true);
    expect(matched("/admin/businesses/abc")).toBe(true);
    expect(matched("/admin/login")).toBe(true);
  });

  it("still covers /app and does not reach public pages", () => {
    expect(matched("/app")).toBe(true);
    expect(matched("/app/crm/contacts")).toBe(true);
    expect(matched("/auth/login")).toBe(false);
    expect(matched("/")).toBe(false);
    expect(matched("/administrator")).toBe(false);
  });
});

describe("MAG-02 no cookie is refused", () => {
  it("GET /admin/users with no cookie redirects to /admin/login and clears kf_admin_token", () => {
    expectRefused(run("/admin/users"), "kf_admin_token");
  });

  it("GET /admin with no cookie is refused too", () => {
    expectRefused(run("/admin"), "kf_admin_token");
  });

  it("a user kf_token alone does not open the admin shell", () => {
    const userJwt = `${b64url({ alg: "none" })}.${b64url({ sub: "u", exp: Math.floor(Date.now() / 1000) + 3600 })}.x`;
    expectRefused(run("/admin/users", { kf_token: userJwt }), "kf_admin_token");
  });
});

describe("MAG-03 a cookie that is not an unexpired admin token is refused", () => {
  const cases: Array<[string, string]> = [
    ["malformed (one part)", "not-a-token"],
    ["malformed (payload not JSON)", "aaa.%%%%.ccc"],
    // An unexpired admin payload, but not three parts: not what buildAdminToken issues.
    ["two parts (header.payload, no signature)", `${b64url({ alg: "HS256" })}.${b64url({ type: "admin", exp: Date.now() + DAY_MS })}`],
    ["four parts", `${adminToken({ type: "admin", exp: Date.now() + DAY_MS })}.extra`],
    ["empty", ""],
    ["type is not admin", adminToken({ sub: "u", type: "user", exp: Date.now() + DAY_MS })],
    ["no type", adminToken({ sub: "u", exp: Date.now() + DAY_MS })],
    ["no exp", adminToken({ sub: "u", type: "admin" })],
    ["exp not a number", adminToken({ sub: "u", type: "admin", exp: String(Date.now() + DAY_MS) })],
    ["expired (milliseconds, a minute ago)", adminToken({ sub: "u", type: "admin", exp: Date.now() - 60_000 })],
    // exp is milliseconds: a seconds-style exp an hour ahead (~1.7e9) is long past as milliseconds.
    ["exp in seconds (not how buildAdminToken writes it)", adminToken({ sub: "u", type: "admin", exp: Math.floor(Date.now() / 1000) + 3600 })],
  ];
  for (const [name, token] of cases) {
    it(`${name}: redirected to /admin/login, cookie cleared`, () => {
      expectRefused(run("/admin/users", { kf_admin_token: token }), "kf_admin_token");
    });
  }
});

describe("MAG-04 an unexpired admin-shaped cookie passes", () => {
  it("/admin/users passes", () => {
    expectPassed(run("/admin/users", { kf_admin_token: validAdmin() }));
  });
  it("/admin passes", () => {
    expectPassed(run("/admin", { kf_admin_token: validAdmin() }));
  });
});

describe("MAG-05 /admin/login always passes", () => {
  it("with no cookie", () => {
    expectPassed(run("/admin/login"));
  });
  it("with an expired cookie (no redirect loop)", () => {
    expectPassed(run("/admin/login", { kf_admin_token: adminToken({ type: "admin", exp: 1 }) }));
  });
  it("a look-alike path is not exempt", () => {
    expectRefused(run("/admin/login-as"), "kf_admin_token");
  });
});

describe("MAG-06 guard: the /app branch is unchanged", () => {
  it("no kf_token on /app/crm/contacts goes to /auth/login with ?from= and clears kf_token", () => {
    const res = run("/app/crm/contacts?tab=all");
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/auth/login");
    expect(location.searchParams.get("from")).toBe("/app/crm/contacts?tab=all");
    expect(res.headers.get("set-cookie") ?? "").toMatch(/kf_token=;/);
  });

  it("an expired kf_token is refused and an unexpired one passes", () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = `${b64url({ alg: "none" })}.${b64url({ exp: now - 3600 })}.x`;
    const fresh = `${b64url({ alg: "none" })}.${b64url({ exp: now + 3600 })}.x`;
    expect(new URL(run("/app/money", { kf_token: expired }).headers.get("location")!).pathname).toBe("/auth/login");
    expectPassed(run("/app/money", { kf_token: fresh }));
  });

  it("an admin cookie does not open /app", () => {
    const res = run("/app/money", { kf_admin_token: validAdmin() });
    expect(new URL(res.headers.get("location")!).pathname).toBe("/auth/login");
  });
});

/*
 * Repair round 1 (orchestrator reviews of 1c4ff81d):
 *   MAG-07 SEC-GATE-1: an encoded admin path (/%61dmin/users, /admin%2Fusers) is decided on the decoded pathname, so
 *          a user kf_token does not carry it through the /app branch; a pathname that cannot be decoded is refused.
 *   MAG-08 SEC-GATE-2: the static-file early return does not cover /admin (/admin/x.json is gated).
 *   MAG-09 COR-GATE-2: /admin/login/ (trailing slash) is exempt, like /admin/login.
 *   MAG-10 the refusal clears the whole admin session (kf_admin_token, kf_admin_user_cache, kf_auth_mode), as
 *          clearAdminSession does.
 * The MAG-07 cases call the middleware directly: whether Next's matcher hands it an encoded path is the browser
 * check's question; this pins that the middleware refuses it when it does.
 */
const freshUserJwt = () =>
  `${b64url({ alg: "none" })}.${b64url({ sub: "u", exp: Math.floor(Date.now() / 1000) + 3600 })}.x`;

describe("MAG-07 encoded admin paths are gated on the decoded pathname", () => {
  for (const path of ["/%61dmin/users", "/admin%2Fusers", "/%61dmin"]) {
    it(`${path} with a valid user kf_token and no admin cookie is sent to /admin/login`, () => {
      expectRefused(middleware(request(path, { kf_token: freshUserJwt() })), "kf_admin_token");
    });
  }
  it("an encoded path with an unexpired admin cookie passes", () => {
    expectPassed(middleware(request("/%61dmin/users", { kf_admin_token: validAdmin() })));
  });
  it("an encoded /admin/login is still exempt", () => {
    expectPassed(middleware(request("/admin/%6Cogin")));
  });
  // Repair round 3 (COR-2): an undecodable pathname fails closed when it is an /admin path (an encoded prefix
  // counts); a malformed /app path keeps the /app rules (middleware-admin-gate-r3.test.ts MAG-11/12).
  it("an /admin pathname that cannot be decoded is refused to /admin/login", () => {
    const res = middleware(request("/%61dmin/%E0%A4%A", { kf_token: freshUserJwt() }));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/admin/login");
  });
  it("an encoded /app path keeps the /app rules", () => {
    expectPassed(middleware(request("/app/m%6Fney", { kf_token: freshUserJwt() })));
  });
});

describe("MAG-08 the static-file skip does not cover /admin", () => {
  for (const path of ["/admin/x.json", "/admin/users/export.pdf", "/admin/logo.png"]) {
    it(`${path} with no admin cookie is refused`, () => {
      expectRefused(run(path), "kf_admin_token");
    });
  }
  it("/admin/x.json with an unexpired admin cookie passes", () => {
    expectPassed(run("/admin/x.json", { kf_admin_token: validAdmin() }));
  });
});

describe("MAG-09 /admin/login/ is exempt too", () => {
  it("with no cookie", () => {
    expectPassed(run("/admin/login/"));
  });
});

describe("MAG-10 the refusal clears the whole admin session", () => {
  it("kf_admin_token, kf_admin_user_cache and kf_auth_mode are each cleared", () => {
    const res = run("/admin/users", { kf_admin_token: "bad", kf_admin_user_cache: "x", kf_auth_mode: "admin" });
    expect(res.status).toBe(307);
    const setCookie = res.headers.get("set-cookie") ?? "";
    for (const name of ["kf_admin_token", "kf_admin_user_cache", "kf_auth_mode"]) {
      expect(setCookie, name).toMatch(new RegExp(`${name}=;[^,]*Max-Age=0`, "i"));
    }
  });
});
