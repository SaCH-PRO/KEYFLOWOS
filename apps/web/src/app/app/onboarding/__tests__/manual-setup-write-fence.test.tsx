/**
 * FU-SETTINGS-MANUAL-STEP-FENCE (from the FU-NAV-A1-CODEX-224 security review; plan corrected by the 2026-11-24
 * pre-flight): the manual onboarding step's write joins the business settings' newest-write fence.
 *
 * The settings store (lib/business-settings.ts) numbers every write it sends and records an answer only when no newer
 * write has been answered (`recorded`, review FU-NAV-A1-CODEX-224). The manual step sends its own profile PATCH
 * (lib/api/onboarding-concierge.ts saveBusinessMinimalProfile) and records the answer with noteBusinessSettings, which
 * took no sequence: so an older write that was sent first and answers last (a sells change still in flight) overwrote
 * what the manual step had just saved, and the nav showed the older "what you sell".
 *
 *   MSF-01  RED-BEFORE  an older sequenced write's late answer does not overwrite the manual step's newer save
 *   MSF-02  control     with no write in flight, the manual step's answer is what the store holds
 *   MSF-03  RED-AT-df0b5d0c  the manual save fails with a 500 (it may have been applied): an older write answering
 *                       last is not recorded, and the store shows what the server holds (acceptance review MINOR-1,
 *                       as the store's own writes do: business-settings.ts `recorded`, SEC5-1/SEC6-2)
 *
 * Through the real component, store and api client; only fetch and the router are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { ManualSetupStep, useManualSetup } from "../components/manual-setup-step";
import * as settings from "@/lib/business-settings";

const BIZ = "biz_msf_onb";
const OWNER = "user_msf_owner";
const BUSINESS_PATH = `/identity/businesses/${BIZ}`;
const COMPLETE_PATH = `/onboarding-concierge/businesses/${BIZ}/complete`;
const STORED = { id: BIZ, ownerId: OWNER, name: "", currency: null, timezone: null, sells: "both", advancedCrm: false };

/** What the server holds: every PATCH applies to it, in the order the server receives them. */
let held: Record<string, unknown> = { ...STORED };
/** A PATCH whose body has only `sells` waits for `releaseOlder` (the older write still in flight). */
let releaseOlder: (() => void) | null = null;
let holdOlder = false;
/** When set, the manual step's PATCH is applied by the server but answered with this status (an outcome unknown). */
let manualStatus: number | null = null;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, statusText: status < 400 ? "OK" : "Error", headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  held = { ...STORED };
  releaseOlder = null;
  holdOlder = false;
  manualStatus = null;
  window.localStorage.clear();
  window.localStorage.setItem("kf_business_id", BIZ);
  router.replace.mockReset();
  settings.resetBusinessSettings();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const pathname = new URL(url, "http://localhost").pathname;
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      if (method === "GET" && pathname === BUSINESS_PATH) return json(200, held);
      if (method === "GET" && pathname === "/identity/me") return json(200, { id: OWNER, email: "owner@example.test", role: "USER" });
      if (method === "POST" && pathname === COMPLETE_PATH) return json(201, { complete: true });
      if (method === "PATCH" && pathname === BUSINESS_PATH) {
        const onlySells = body !== null && Object.keys(body).length === 1 && "sells" in body;
        if (onlySells && holdOlder) {
          // The server applied this older write first; its answer is what it held then, and it arrives last.
          held = { ...held, ...body };
          const snapshot = { ...held };
          await new Promise<void>((resolve) => {
            releaseOlder = resolve;
          });
          return json(200, snapshot);
        }
        held = { ...held, ...(body ?? {}) };
        if (manualStatus !== null) return json(manualStatus, { statusCode: manualStatus, message: "Internal server error" });
        return json(200, { ...held });
      }
      return json(500, { message: `no route ${method} ${pathname}` });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Harness() {
  const setup = useManualSetup();
  return <ManualSetupStep setup={setup} />;
}

const form = () => screen.getByRole("region", { name: /set up manually/i });
const choice = (name: string) =>
  within(within(form()).getByRole("radiogroup", { name: /what do you sell\?/i })).getByRole("radio", { name: new RegExp(`^${name}$`, "i") });

async function finishWith(sells: string) {
  render(<Harness />);
  await waitFor(() => expect(within(form()).getByLabelText("Business name")).toBeInTheDocument());
  await new Promise((r) => setTimeout(r, 0));
  fireEvent.change(within(form()).getByLabelText("Business name"), { target: { value: "Point Fortin Pastries" } });
  fireEvent.change(within(form()).getByLabelText("Currency"), { target: { value: "TTD" } });
  fireEvent.change(within(form()).getByLabelText("Timezone"), { target: { value: "America/Port_of_Spain" } });
  fireEvent.click(choice(sells));
  fireEvent.click(within(form()).getByRole("button", { name: /finish setup/i }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/app/command-center"));
}

describe("FU-SETTINGS-MANUAL-STEP-FENCE: the manual step's save is fenced like every other settings write", () => {
  it("MSF-01 RED-BEFORE: an older write that answers last does not overwrite what the manual step saved", async () => {
    const reader = renderHook(() => settings.useBusinessSettings(BIZ));
    await waitFor(() => expect(reader.result.current.status).toBe("ready"));
    // An older write, sent first: a sells change to products, still in flight.
    holdOlder = true;
    const older = settings.saveBusinessSells(BIZ, "products");
    await waitFor(() => expect(releaseOlder).not.toBeNull());
    // The owner then finishes setup choosing Services: the server applies it after the older write.
    await finishWith("Services");
    await waitFor(() => expect(reader.result.current.sells).toBe("services"));
    // The older write's answer (a snapshot from before the manual save) now lands.
    releaseOlder!();
    await older;
    await new Promise((r) => setTimeout(r, 20));
    await waitFor(() => expect(reader.result.current.status).toBe("ready"));
    expect(reader.result.current.sells, "the store holds the manual step's newer save, as the server does").toBe("services");
    expect(held.sells).toBe("services");
  });

  it("MSF-02 control: with no write in flight, the manual step's answer is what the store holds", async () => {
    const reader = renderHook(() => settings.useBusinessSettings(BIZ));
    await waitFor(() => expect(reader.result.current.status).toBe("ready"));
    await finishWith("Products");
    await waitFor(() => expect(reader.result.current.sells).toBe("products"));
  });

  it("MSF-03 RED-AT-df0b5d0c: a manual save that fails with a 500 still fences an older write that answers last", async () => {
    const reader = renderHook(() => settings.useBusinessSettings(BIZ));
    await waitFor(() => expect(reader.result.current.status).toBe("ready"));
    holdOlder = true;
    const older = settings.saveBusinessSells(BIZ, "products");
    await waitFor(() => expect(releaseOlder).not.toBeNull());
    // The server applies the manual save (services) but its answer is a 500: the outcome is unknown to the browser.
    manualStatus = 500;
    render(<Harness />);
    await waitFor(() => expect(within(form()).getByLabelText("Business name")).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.change(within(form()).getByLabelText("Business name"), { target: { value: "Point Fortin Pastries" } });
    fireEvent.change(within(form()).getByLabelText("Currency"), { target: { value: "TTD" } });
    fireEvent.change(within(form()).getByLabelText("Timezone"), { target: { value: "America/Port_of_Spain" } });
    fireEvent.click(choice("Services"));
    fireEvent.click(within(form()).getByRole("button", { name: /finish setup/i }));
    await waitFor(() => expect(held.sells).toBe("services"));
    await new Promise((r) => setTimeout(r, 20));
    // The older write's answer (a snapshot from before the manual save) lands last.
    releaseOlder!();
    await older;
    await new Promise((r) => setTimeout(r, 20));
    await waitFor(() => expect(reader.result.current.status).toBe("ready"));
    expect(reader.result.current.sells, "an older answer does not replace what the server holds").toBe("services");
  });
});
