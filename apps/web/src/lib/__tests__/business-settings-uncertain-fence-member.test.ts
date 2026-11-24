/**
 * FU-NAV-A1-CODEX-224 review round 1 (security nit): the uncertainty fence is raised whoever is acting when the
 * uncertain outcome lands. The write may have been applied on the server whoever sent it, so an older answer is a
 * snapshot from before it for every member. (SEC-3 is about recording an answer, which raises the mark only for the
 * member acting; the fence records nothing, it only discards an older answer and reads again.)
 *
 *   BSUFM-01 B sends write 1; A takes the browser and sends write 2; B is back when write 2 ends in a 5xx and then
 *            write 1's success lands: B is shown the business as read after write 2, never write 1's snapshot.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import * as settings from "../business-settings";

const BIZ = "biz_bsufm_a";

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

/** A session token naming `sub` (business-settings reads the subject only). */
const tokenFor = (sub: string) => `h.${btoa(JSON.stringify({ sub })).replace(/=+$/, "")}.s`;

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("kf_business_id", BIZ);
  settings.resetBusinessSettings();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FU-NAV-A1-CODEX-224 round 2: the uncertainty fence is not the acting member's alone", () => {
  it("BSUFM-01 another member's uncertain write fences the acting member's older answer", async () => {
    window.localStorage.setItem("kf_token", tokenFor("usr_b"));
    let held = business();
    const releases: Array<() => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const method = (init?.method ?? "GET").toUpperCase();
        const path = new URL(url, "http://localhost").pathname;
        const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
        if (method === "GET" && path === `/identity/businesses/${BIZ}`) return json(200, held);
        if (method === "PATCH" && path === `/identity/businesses/${BIZ}`) {
          held = { ...held, sells: body.sells as string };
          const answer = { ...held };
          await new Promise<void>((release) => releases.push(release));
          return json(200, answer);
        }
        if (method === "PATCH" && path === `/identity/businesses/${BIZ}/advanced-settings`) {
          held = { ...held, advancedCrm: body.advancedCrm as boolean };
          await new Promise<void>((release) => releases.push(release));
          return json(502, { message: "Bad gateway" });
        }
        return json(500, { message: "no route" });
      }),
    );
    const { result } = renderHook(() => settings.useBusinessSettings());
    await waitFor(() => expect(result.current.status).toBe("ready"));

    // B sends write 1; A takes the browser and sends write 2 (applied, then answered 502); B signs back in.
    const fromB = settings.saveBusinessSells(BIZ, "services");
    await waitFor(() => expect(releases.length).toBe(1));
    window.localStorage.setItem("kf_token", tokenFor("usr_a"));
    const fromA = settings.saveAdvancedSettings(BIZ, { advancedCrm: true });
    await waitFor(() => expect(releases.length).toBe(2));
    window.localStorage.setItem("kf_token", tokenFor("usr_b"));

    // Write 2 ends uncertain, for nobody acting; its re-read lands.
    releases[1]();
    expect((await fromA).status).toBe(502);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // Then write 1's success: a snapshot from before write 2.
    releases[0]();
    const answerB = await fromB;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(answerB.error, "B's own write went through, and B is told so").toBeNull();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect({ sells: result.current.sells, advancedCrm: result.current.advancedCrm }).toEqual({ sells: "services", advancedCrm: true });
  });
});
