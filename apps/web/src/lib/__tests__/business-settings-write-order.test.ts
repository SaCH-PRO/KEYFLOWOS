/**
 * NAV-A1 (with BIZ-SETTINGS-WEB's review note): the nav mounts useBusinessSettings() app-wide, so what the store holds
 * after two settings writes is what every hub and the bottom bar show. The two doors (the owner's sells PATCH and the
 * owner-or-admin advanced-settings PATCH) each answer the whole business; their answers were recorded in the order
 * they landed, so an older write answered after a newer one put the older business back on screen.
 *
 *   BSWO-01 a write answered after a newer write's answer records nothing of itself; the business is read again,
 *           and what it holds is shown.
 *   BSWO-02 writes answered in the order they were sent are each recorded as before.
 *   BSWO-03 review round 2 (R2-SEC-1): an answer that lands after its sender left raises no mark: the member acting
 *           now has their own older write recorded as it answers, with no read forced by another member's answer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import * as settings from "../business-settings";

const BIZ = "biz_bswo_a";

function business(over: Record<string, unknown> = {}) {
  return {
    id: BIZ,
    name: "Business",
    sells: "both",
    advancedCrm: false,
    depth: { today: "standard", customers: "standard", sales: "standard", schedule: "standard", money: "standard", page: "standard", settings: "standard" },
    ...over,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, statusText: status === 200 ? "OK" : "Error", headers: { "content-type": "application/json" } });
}

/** The server: it applies each PATCH when it arrives and answers the business it then holds; answers can be held back. */
function serve() {
  let held = business();
  const gets: number[] = [];
  const holds: Array<() => void> = [];
  const hold = { sells: false };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const path = new URL(url, "http://localhost").pathname;
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      if (method === "GET" && path === `/identity/businesses/${BIZ}`) {
        gets.push(Date.now());
        return json(200, held);
      }
      if (method === "PATCH" && path === `/identity/businesses/${BIZ}`) {
        held = { ...held, sells: body.sells as string };
        const answer = { ...held };
        if (hold.sells) await new Promise<void>((release) => holds.push(release));
        return json(200, answer);
      }
      if (method === "PATCH" && path === `/identity/businesses/${BIZ}/advanced-settings`) {
        held = { ...held, ...(body.advancedCrm === undefined ? {} : { advancedCrm: body.advancedCrm as boolean }) };
        return json(200, { ...held });
      }
      return json(500, { message: `no route ${method} ${path}` });
    }),
  );
  return { gets, holds, hold, current: () => held };
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("kf_business_id", BIZ);
  window.localStorage.setItem("kf_token", "bswo-session");
  settings.resetBusinessSettings();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NAV-A1: settings writes are recorded in the order they were sent", () => {
  it("BSWO-01 an older write answered last does not put the older business back; the business is read again", async () => {
    const server = serve();
    const { result } = renderHook(() => settings.useBusinessSettings());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const readsBefore = server.gets.length;

    // The sells write is sent first and its answer (sells products, advanced CRM off) is held back; the advanced
    // write is sent second and answered at once (sells products, advanced CRM on).
    server.hold.sells = true;
    let sellsDone!: Promise<unknown>;
    act(() => {
      sellsDone = settings.saveBusinessSells(BIZ, "products");
    });
    await waitFor(() => expect(server.holds.length).toBe(1));
    await act(async () => {
      await settings.saveAdvancedSettings(BIZ, { advancedCrm: true });
    });
    expect(result.current.advancedCrm).toBe(true);

    // The older answer lands last.
    await act(async () => {
      server.holds.forEach((release) => release());
      await sellsDone;
    });
    await waitFor(() => expect(server.gets.length).toBeGreaterThan(readsBefore));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect({ sells: result.current.sells, advancedCrm: result.current.advancedCrm }).toEqual({ sells: "products", advancedCrm: true });
  });

  it("BSWO-02 writes answered in order are each recorded", async () => {
    serve();
    const { result } = renderHook(() => settings.useBusinessSettings());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => {
      const first = await settings.saveBusinessSells(BIZ, "services");
      expect(first.error).toBeNull();
    });
    expect(result.current.sells).toBe("services");
    await act(async () => {
      const second = await settings.saveAdvancedSettings(BIZ, { advancedCrm: true });
      expect(second.error).toBeNull();
    });
    expect({ sells: result.current.sells, advancedCrm: result.current.advancedCrm }).toEqual({ sells: "services", advancedCrm: true });
  });
});

/** A session token naming `sub` (business-settings reads the subject only). */
const tokenFor = (sub: string) => `h.${btoa(JSON.stringify({ sub })).replace(/=+$/, "")}.s`;

describe("NAV-A1 review round 2: the write mark is the acting member's", () => {
  it("BSWO-03 another member's late answer does not make the acting member's older write stale", async () => {
    window.localStorage.setItem("kf_token", tokenFor("usr_b"));
    let held = business();
    const gets: string[] = [];
    const releases: Array<() => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const method = (init?.method ?? "GET").toUpperCase();
        const path = new URL(url, "http://localhost").pathname;
        const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
        if (method === "GET" && path === `/identity/businesses/${BIZ}`) {
          gets.push(path);
          return json(200, held);
        }
        if (method === "PATCH" && path === `/identity/businesses/${BIZ}`) {
          held = { ...held, sells: body.sells as string };
          const answer = { ...held };
          await new Promise<void>((release) => releases.push(release));
          return json(200, answer);
        }
        if (method === "PATCH" && path === `/identity/businesses/${BIZ}/advanced-settings`) {
          held = { ...held, ...(body.advancedCrm === undefined ? {} : { advancedCrm: body.advancedCrm as boolean }) };
          const answer = { ...held };
          await new Promise<void>((release) => releases.push(release));
          return json(200, answer);
        }
        return json(500, { message: "no route" });
      }),
    );
    // A reader is mounted (the nav), so a stale answer forces a read.
    const { result } = renderHook(() => settings.useBusinessSettings());
    await waitFor(() => expect(result.current.status).toBe("ready"));

    // B sends a write (seq 1); A takes the browser and sends one (seq 2); B signs back in.
    const fromB = settings.saveBusinessSells(BIZ, "services");
    await waitFor(() => expect(releases.length).toBe(1));
    window.localStorage.setItem("kf_token", tokenFor("usr_a"));
    const fromA = settings.saveAdvancedSettings(BIZ, { advancedCrm: true });
    await waitFor(() => expect(releases.length).toBe(2));
    window.localStorage.setItem("kf_token", tokenFor("usr_b"));

    // A's answer lands first, for nobody acting; then B's.
    releases[1]();
    await fromA;
    // A's answer, landing for nobody acting, has the business read again for B (as before NAV-A1); let it land.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const readsAfterA = gets.length;
    releases[0]();
    const answerB = await fromB;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(answerB.error, "B's own write is a success").toBeNull();
    // B's answer was recorded as it answered: no read was forced because of A's answer.
    expect(gets.length).toBe(readsAfterA);
  });
});
