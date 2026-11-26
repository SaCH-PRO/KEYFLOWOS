/**
 * RR-ADMIN-SHELL-SERVER-GATE repair round 3 (correctness review #80 7182060236).
 *
 * COR-2 / MINOR-2: at 458243a a pathname that decodeURIComponent cannot decode is sent to /admin/login, and the
 * admin session's cookies are cleared, wherever it points. Only an /admin path may fail closed to the admin sign-in;
 * a malformed /app path keeps the /app rules. "Under /admin" is judged on the path with its valid single-byte
 * escapes decoded, so an encoded /admin prefix with a malformed tail (/%61dmin/%ZZ) still fails closed.
 *   MAG-11 /app/%ZZ with a valid kf_token passes, as an /app path does, and no admin cookie is cleared
 *          (RED at 458243a: 307 to /admin/login).
 *   MAG-12 /app/%ZZ with no kf_token goes to /auth/login, as the /app rules send it (RED at 458243a).
 *   MAG-13 /admin/%ZZ, /admin/users/%E0%A4%A and /%61dmin/%ZZ, malformed /admin paths, still fail closed to
 *          /admin/login with the admin cookies cleared, even with a valid admin cookie (pins).
 *
 * Repair round 4 (correctness confirmation of round 3, MINOR-1): every escape in an undecodable path's /admin prefix
 * is decoded, not only the first (kills the mutant that drops decodeAsciiEscapes' /g flag).
 *   MAG-15 /%61%64min/%ZZ and /%61%64%6d%69%6e/%ZZ with a valid user kf_token and no admin cookie fail closed to
 *          /admin/login with the admin cookies cleared.
 *
 * COR-3: a refused /admin request lands on /admin/login with no query string (kills mutant M19, which drops
 * `adminLogin.search = ""`).
 *   MAG-14 /admin/users?tab=all&from=/x redirects to /admin/login with an empty search (a pin at 458243a).
 */
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../../middleware";

const ORIGIN = "http://localhost:3000";
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const DAY_MS = 24 * 60 * 60 * 1000;
const validAdmin = () =>
  `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: "admin_1", role: "SUPER_ADMIN", exp: Date.now() + DAY_MS, type: "admin" })}.sig`;
const freshUserJwt = () => `${b64url({ alg: "none" })}.${b64url({ sub: "u", exp: Math.floor(Date.now() / 1000) + 3600 })}.x`;

function request(path: string, cookies: Record<string, string> = {}): NextRequest {
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new NextRequest(new URL(path, ORIGIN), { headers: cookie ? { cookie } : {} });
}

const clearedAdminCookies = (res: Response) =>
  ["kf_admin_token", "kf_admin_user_cache", "kf_auth_mode"].filter((n) => new RegExp(`${n}=;`).test(res.headers.get("set-cookie") ?? ""));

describe("COR-2: only a malformed /admin path fails closed to the admin sign-in", () => {
  it("MAG-11 /app/%ZZ with a valid kf_token passes and clears no admin cookie", () => {
    const res = middleware(request("/app/%ZZ", { kf_token: freshUserJwt() }));
    expect(res.headers.get("location"), "no redirect").toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(clearedAdminCookies(res)).toEqual([]);
  });

  it("MAG-12 /app/%ZZ with no kf_token goes to /auth/login, as the /app rules send it", () => {
    const res = middleware(request("/app/%ZZ"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/auth/login");
    expect(clearedAdminCookies(res)).toEqual([]);
  });

  for (const path of ["/admin/%ZZ", "/admin/users/%E0%A4%A", "/%61dmin/%ZZ"]) {
    it(`MAG-13 ${path} still fails closed to /admin/login, even with a valid admin cookie`, () => {
      const res = middleware(request(path, { kf_admin_token: validAdmin() }));
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/admin/login");
      expect(clearedAdminCookies(res)).toEqual(["kf_admin_token", "kf_admin_user_cache", "kf_auth_mode"]);
    });
  }
});

describe("COR-3: the refusal drops the query string", () => {
  it("MAG-14 /admin/users?tab=all&from=/x redirects to a bare /admin/login", () => {
    const res = middleware(request("/admin/users?tab=all&from=/x"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/admin/login");
    expect(location.search).toBe("");
  });
});

describe("Round 4: every escape in the /admin prefix is decoded", () => {
  for (const path of ["/%61%64min/%ZZ", "/%61%64%6d%69%6e/%ZZ"]) {
    it(`MAG-15 ${path} with a valid user kf_token and no admin cookie fails closed to /admin/login`, () => {
      const res = middleware(request(path, { kf_token: freshUserJwt() }));
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/admin/login");
      expect(clearedAdminCookies(res)).toEqual(["kf_admin_token", "kf_admin_user_cache", "kf_auth_mode"]);
    });
  }
});
