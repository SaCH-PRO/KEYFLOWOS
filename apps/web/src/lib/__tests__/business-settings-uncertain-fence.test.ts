/**
 * FU-NAV-A1-CODEX-224 (b): a newer write whose outcome is uncertain (no status: a dropped connection; or a 5xx)
 * fences every older write's answer. Before it, write N's delayed success, landing after write N+1 ended uncertain,
 * passed the stale-answer check (no newer answer had been recorded) and cached its pre-N+1 snapshot, ahead of or
 * over the forced re-read's answer.
 *
 *   BSUF-01 N+1 answers a 5xx after the server applied it; N's success lands before the forced re-read answers: what
 *           is shown is the re-read's business, never N's snapshot.
 *   BSUF-02 the same with N+1 losing its connection (no status), and N's success landing after the re-read answered.
 *   BSUF-03 N's own caller is still told its write went through (its answer holds what it sent).
 *   BSUF-04 a 4xx on N+1 says nothing changed: N's answer is recorded as before, with no read forced.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import * as settings from "../business-settings";

const BIZ = "biz_bsuf_a";

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

type AdvancedOutcome = "502" | "dropped" | "409";

/**
 * The server applies each PATCH when it arrives. The sells answer is held back until released; the advanced write
 * is applied (unless refused with a 409) and then answered as `advanced` says; GETs can be held back too.
 */
function serve(advanced: AdvancedOutcome) {
  let held = business();
  const gets: number[] = [];
  const sellsHolds: Array<() => void> = [];
  const getHolds: Array<() => void> = [];
  const hold = { gets: false };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const path = new URL(url, "http://localhost").pathname;
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      if (method === "GET" && path === `/identity/businesses/${BIZ}`) {
        gets.push(Date.now());
        if (hold.gets) await new Promise<void>((release) => getHolds.push(release));
        return json(200, held);
      }
      if (method === "PATCH" && path === `/identity/businesses/${BIZ}`) {
        held = { ...held, sells: body.sells as string };
        const answer = { ...held };
        await new Promise<void>((release) => sellsHolds.push(release));
        return json(200, answer);
      }
      if (method === "PATCH" && path === `/identity/businesses/${BIZ}/advanced-settings`) {
        if (advanced === "409") return json(409, { message: "Conflict" });
        held = { ...held, advancedCrm: body.advancedCrm as boolean };
        if (advanced === "dropped") throw new TypeError("Failed to fetch");
        return json(502, { message: "Bad gateway" });
      }
      return json(500, { message: `no route ${method} ${path}` });
    }),
  );
  return { gets, sellsHolds, getHolds, hold, current: () => held };
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("kf_business_id", BIZ);
  window.localStorage.setItem("kf_token", "bsuf-session");
  settings.resetBusinessSettings();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const shown = (s: { sells: string; advancedCrm: boolean }) => ({ sells: s.sells, advancedCrm: s.advancedCrm });

/** Mounts the reader, sends write N (sells products, answer held) then write N+1 (advanced CRM on). */
async function twoWrites(advanced: AdvancedOutcome, opts: { holdReRead: boolean }) {
  const server = serve(advanced);
  const view = renderHook(() => settings.useBusinessSettings());
  await waitFor(() => expect(view.result.current.status).toBe("ready"));
  const readsBefore = server.gets.length;

  let sellsDone!: Promise<Awaited<ReturnType<typeof settings.saveBusinessSells>>>;
  act(() => {
    sellsDone = settings.saveBusinessSells(BIZ, "products");
  });
  await waitFor(() => expect(server.sellsHolds.length).toBe(1));
  server.hold.gets = opts.holdReRead;
  let advancedAnswer!: Awaited<ReturnType<typeof settings.saveAdvancedSettings>>;
  await act(async () => {
    advancedAnswer = await settings.saveAdvancedSettings(BIZ, { advancedCrm: true });
  });
  return { server, view, readsBefore, sellsDone, advancedAnswer };
}

describe("FU-NAV-A1-CODEX-224: an uncertain newer write fences older answers", () => {
  it("BSUF-01 a 5xx on N+1: N's success landing before the re-read answers never shows N's snapshot", async () => {
    const { server, view, readsBefore, sellsDone, advancedAnswer } = await twoWrites("502", { holdReRead: true });
    expect(advancedAnswer.error).not.toBeNull();
    expect(advancedAnswer.status).toBe(502);
    await waitFor(() => expect(server.getHolds.length).toBeGreaterThan(0));

    // N's delayed success lands while the forced re-read is out.
    await act(async () => {
      server.sellsHolds.forEach((release) => release());
      await sellsDone;
    });
    // N's snapshot (sells products, advanced CRM off: from before N+1) is not taken: what was held before stays
    // until the re-read answers.
    expect(shown(view.result.current)).not.toEqual({ sells: "products", advancedCrm: false });

    await act(async () => {
      server.hold.gets = false;
      server.getHolds.splice(0).forEach((release) => release());
    });
    await waitFor(() => expect(view.result.current.status).toBe("ready"));
    await waitFor(() => expect(shown(view.result.current)).toEqual({ sells: "products", advancedCrm: true }));
    expect(server.gets.length).toBeGreaterThan(readsBefore);
    // And it stays so: nothing older lands over it.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(shown(view.result.current)).toEqual({ sells: "products", advancedCrm: true });
  });

  it("BSUF-02 a dropped connection on N+1: N's success landing after the re-read answered does not overwrite it", async () => {
    const { server, view, sellsDone, advancedAnswer } = await twoWrites("dropped", { holdReRead: false });
    expect(advancedAnswer.error).not.toBeNull();
    expect(advancedAnswer.status).toBeUndefined();
    await waitFor(() => expect(shown(view.result.current)).toEqual({ sells: "products", advancedCrm: true }));

    await act(async () => {
      server.sellsHolds.forEach((release) => release());
      await sellsDone;
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    await waitFor(() => expect(view.result.current.status).toBe("ready"));
    expect(shown(view.result.current)).toEqual({ sells: "products", advancedCrm: true });
  });

  it("BSUF-03 N's caller is still told its write went through", async () => {
    const { server, sellsDone } = await twoWrites("502", { holdReRead: false });
    await act(async () => {
      server.sellsHolds.forEach((release) => release());
    });
    const answer = await sellsDone;
    expect(answer.error).toBeNull();
    expect((answer.data as { sells?: string } | null)?.sells).toBe("products");
  });

  it("BSUF-04 a 4xx on N+1 fences nothing: N's answer is recorded, with no read forced", async () => {
    const { server, view, readsBefore, sellsDone, advancedAnswer } = await twoWrites("409", { holdReRead: false });
    expect(advancedAnswer.status).toBe(409);
    await act(async () => {
      server.sellsHolds.forEach((release) => release());
      await sellsDone;
    });
    expect(shown(view.result.current)).toEqual({ sells: "products", advancedCrm: false });
    expect(view.result.current.status).toBe("ready");
    expect(server.gets.length).toBe(readsBefore);
  });
});
