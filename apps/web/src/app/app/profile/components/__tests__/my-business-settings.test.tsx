/**
 * BIZ-SETTINGS-WEB (re-cut v1 plan, step 3, lane web; owner rulings D-150 'hubs', D-218 'sellsowner', D-11).
 *
 * WHY this test exists: Settings > Business profile did not show what the business sells or the Advanced CRM
 * switch, the two per-business settings that decide the hubs (NAV-A1) and whether Deals and Companies show.
 *
 * Required here, through the real api client (fetch stubbed per route, every request recorded):
 *   - the section shows what the business sells and the Advanced CRM switch as the server holds them
 *     (RED: neither is on the page);
 *   - what you sell is changed through the owner-only profile PATCH, sending sells and nothing else;
 *   - the Advanced CRM switch is changed through the owner-or-admin door (BIZ-SETTINGS-ADMIN-DOOR) and never
 *     through the profile PATCH;
 *   - a refusal is said in plain words (one refusal toast, the same words beside the control), the control
 *     stays as the business has it, and nothing is reported as saved;
 *   - settings that could not be loaded are said so: the defaults are never drawn as the business's answer,
 *     and nothing can be written from them;
 *   - "Save Business Info" still sends the five profile fields and neither setting.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast, Toaster: () => null }));

import MyBusinessSection from "../my-business-section";
import { resetBusinessSettings } from "@/lib/business-settings";

const BIZ = "biz_bsw_profile";
const OTHER = "biz_bsw_other";
const PROFILE = `/identity/businesses/${BIZ}`;
const DOOR = `${PROFILE}/advanced-settings`;

type Sent = { method: string; path: string; body: Record<string, unknown> | null };
type Answer = { status: number; body: unknown; bare?: boolean };
type Routes = Record<string, Answer | (() => Answer | Promise<Answer>)>;

function stubRoutes(routes: Routes): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const pathname = new URL(url, "http://localhost").pathname;
      sent.push({ method, path: pathname, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
      const route = routes[`${method} ${pathname}`];
      const answer = route ? (typeof route === "function" ? await route() : route) : { status: 500, body: { message: `no route ${method} ${pathname}` } };
      return new Response(JSON.stringify(answer.body), {
        status: answer.status,
        statusText: answer.bare ? "" : answer.status === 403 ? "Forbidden" : answer.status >= 400 ? "Error" : "OK",
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return sent;
}

const HUBS = ["today", "customers", "sales", "schedule", "money", "page", "settings"];
const business = (settings: Record<string, unknown> = {}) => ({
  id: BIZ,
  name: "Point Fortin Pastries",
  sells: "both",
  advancedCrm: false,
  depth: Object.fromEntries(HUBS.map((h) => [h, "standard"])),
  ...settings,
});

const OWNER_ONLY = "Only the business owner can edit the business profile";
const OWNER_OR_ADMIN = "Only the business owner, or an admin with settings admin access, can change the Advanced CRM switch and hub depth.";
const forbidden = (message: string) => ({ statusCode: 403, message, error: "Forbidden" });

function mount(businessId: string | null = BIZ) {
  const onStatus = vi.fn();
  render(
    <MyBusinessSection
      businessId={businessId}
      businessData={{ name: "Point Fortin Pastries", tagline: "Fresh daily", description: "A family bakery.", teamSize: "solo", businessHours: null }}
      businessLoading={false}
      onStatus={onStatus}
    />,
  );
  return { onStatus };
}

const sellsGroup = () => screen.getByRole("radiogroup", { name: /what you sell/i });
const sells = (name: string) => within(sellsGroup()).getByRole("radio", { name: new RegExp(`^${name}$`, "i") }) as HTMLInputElement;
const crmSwitch = () => screen.getByRole("switch", { name: /advanced crm/i });
const writes = (sent: Sent[]) => sent.filter((s) => s.method !== "GET");
const successes = (onStatus: ReturnType<typeof vi.fn>) => onStatus.mock.calls.filter(([s]) => s?.type === "success");

/** Waits until the settings have loaded and the controls can be used. */
async function ready() {
  await waitFor(() => expect(crmSwitch()).toBeEnabled());
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("kf_business_id", BIZ);
  resetBusinessSettings();
  for (const fn of Object.values(toast)) fn.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Business profile shows what you sell and the Advanced CRM switch", () => {
  it("shows both as the business holds them", async () => {
    stubRoutes({ [`GET ${PROFILE}`]: { status: 200, body: business({ sells: "products", advancedCrm: true }) } });
    mount();
    await ready();
    expect(sells("Products").checked).toBe(true);
    expect(sells("Services").checked).toBe(false);
    expect(sells("Both").checked).toBe(false);
    expect(crmSwitch()).toHaveAttribute("aria-checked", "true");
  });

  it("a business that never answered shows both, and the switch off", async () => {
    stubRoutes({ [`GET ${PROFILE}`]: { status: 200, body: { id: BIZ, name: "Point Fortin Pastries" } } });
    mount();
    await ready();
    expect(sells("Both").checked).toBe(true);
    expect(crmSwitch()).toHaveAttribute("aria-checked", "false");
  });

  it("reads the settings of the business the page is showing, not another the browser has selected", async () => {
    window.localStorage.setItem("kf_business_id", OTHER);
    const sent = stubRoutes({ [`GET ${PROFILE}`]: { status: 200, body: business({ sells: "services" }) } });
    mount();
    await ready();
    expect(sells("Services").checked).toBe(true);
    expect(sent.some((s) => s.path.includes(OTHER))).toBe(false);
  });
});

describe("what you sell: the owner-only profile PATCH", () => {
  it("a new answer sends sells and nothing else, then shows as saved", async () => {
    const sent = stubRoutes({
      [`GET ${PROFILE}`]: { status: 200, body: business() },
      [`PATCH ${PROFILE}`]: { status: 200, body: business({ sells: "services" }) },
    });
    const { onStatus } = mount();
    await ready();
    fireEvent.click(sells("Services"));
    await waitFor(() => expect(writes(sent)).toHaveLength(1));
    expect(writes(sent)[0]).toEqual({ method: "PATCH", path: PROFILE, body: { sells: "services" } });
    await waitFor(() => expect(sells("Services").checked).toBe(true));
    await waitFor(() => expect(successes(onStatus)).toHaveLength(1));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("a refusal is said in plain words, the answer stays as the business has it, and nothing is saved", async () => {
    const sent = stubRoutes({
      [`GET ${PROFILE}`]: { status: 200, body: business({ sells: "products" }) },
      [`PATCH ${PROFILE}`]: { status: 403, body: forbidden(OWNER_ONLY) },
    });
    const { onStatus } = mount();
    await ready();
    fireEvent.click(sells("Services"));
    await waitFor(() => expect(writes(sent)).toHaveLength(1));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(OWNER_ONLY);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error.mock.calls[0][0]).toBe(OWNER_ONLY);
    await waitFor(() => expect(sells("Products").checked).toBe(true));
    expect(sells("Services").checked).toBe(false);
    expect(successes(onStatus)).toEqual([]);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("a network failure is a refusal too, never a success", async () => {
    stubRoutes({ [`GET ${PROFILE}`]: { status: 200, body: business({ sells: "products" }) } });
    const { onStatus } = mount();
    await ready();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    fireEvent.click(sells("Both"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(sells("Products").checked).toBe(true);
    expect(successes(onStatus)).toEqual([]);
  });
});

describe("the Advanced CRM switch: the owner-or-admin door", () => {
  it("turning it on sends advancedCrm through the door, never the profile PATCH", async () => {
    const sent = stubRoutes({
      [`GET ${PROFILE}`]: { status: 200, body: business() },
      [`PATCH ${DOOR}`]: { status: 200, body: business({ advancedCrm: true }) },
    });
    const { onStatus } = mount();
    await ready();
    fireEvent.click(crmSwitch());
    await waitFor(() => expect(writes(sent)).toHaveLength(1));
    expect(writes(sent)[0]).toEqual({ method: "PATCH", path: DOOR, body: { advancedCrm: true } });
    await waitFor(() => expect(crmSwitch()).toHaveAttribute("aria-checked", "true"));
    await waitFor(() => expect(successes(onStatus)).toHaveLength(1));
  });

  it("turning it off sends advancedCrm false through the door", async () => {
    const sent = stubRoutes({
      [`GET ${PROFILE}`]: { status: 200, body: business({ advancedCrm: true }) },
      [`PATCH ${DOOR}`]: { status: 200, body: business({ advancedCrm: false }) },
    });
    mount();
    await ready();
    fireEvent.click(crmSwitch());
    await waitFor(() => expect(writes(sent)).toHaveLength(1));
    expect(writes(sent)[0]).toEqual({ method: "PATCH", path: DOOR, body: { advancedCrm: false } });
    await waitFor(() => expect(crmSwitch()).toHaveAttribute("aria-checked", "false"));
  });

  it("a refusal is said in plain words, the switch stays as it was, and nothing is saved", async () => {
    const sent = stubRoutes({
      [`GET ${PROFILE}`]: { status: 200, body: business() },
      [`PATCH ${DOOR}`]: { status: 403, body: { ...forbidden(OWNER_OR_ADMIN), code: "BUSINESS_ADVANCED_SETTINGS_FORBIDDEN" } },
    });
    const { onStatus } = mount();
    await ready();
    fireEvent.click(crmSwitch());
    await waitFor(() => expect(writes(sent)).toHaveLength(1));
    expect(await screen.findByRole("alert")).toHaveTextContent(OWNER_OR_ADMIN);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error.mock.calls[0][0]).toBe(OWNER_OR_ADMIN);
    expect(crmSwitch()).toHaveAttribute("aria-checked", "false");
    expect(successes(onStatus)).toEqual([]);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("a second press while one is being saved sends nothing more", async () => {
    let release: (a: Answer) => void = () => {};
    const sent = stubRoutes({
      [`GET ${PROFILE}`]: { status: 200, body: business() },
      [`PATCH ${DOOR}`]: () => new Promise<Answer>((resolve) => (release = resolve)),
    });
    mount();
    await ready();
    fireEvent.click(crmSwitch());
    fireEvent.click(crmSwitch());
    fireEvent.click(sells("Products"));
    await waitFor(() => expect(writes(sent)).toHaveLength(1));
    release({ status: 200, body: business({ advancedCrm: true }) });
    await waitFor(() => expect(crmSwitch()).toHaveAttribute("aria-checked", "true"));
    expect(writes(sent)).toHaveLength(1);
  });
});

describe("settings that could not be loaded", () => {
  it("are said so: the defaults are not drawn as the business's answer and nothing can be written", async () => {
    const sent = stubRoutes({ [`GET ${PROFILE}`]: { status: 403, body: forbidden("No access to this business") } });
    mount();
    expect(await screen.findByText(/couldn't load what you sell and the advanced crm switch/i)).toBeInTheDocument();
    expect(screen.getByText(/No access to this business/)).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: /what you sell/i })).toBeNull();
    expect(screen.queryByRole("switch", { name: /advanced crm/i })).toBeNull();
    expect(writes(sent)).toEqual([]);
    // A failed read is not a refused write: no refusal toast.
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("can be asked for again", async () => {
    let answer: Answer = { status: 500, body: { statusCode: 500, message: "Internal server error" } };
    stubRoutes({ [`GET ${PROFILE}`]: () => answer });
    mount();
    const retry = await screen.findByRole("button", { name: /try again/i });
    answer = { status: 200, body: business({ sells: "services" }) };
    fireEvent.click(retry);
    await ready();
    expect(sells("Services").checked).toBe(true);
  });

  it("with no business there is nothing to show or change", () => {
    const sent = stubRoutes({});
    mount(null);
    expect(screen.queryByRole("switch", { name: /advanced crm/i })).toBeNull();
    expect(sent).toEqual([]);
  });
});

describe("Save Business Info is as it was", () => {
  it("sends the five profile fields and neither setting", async () => {
    const sent = stubRoutes({
      [`GET ${PROFILE}`]: { status: 200, body: business({ sells: "products", advancedCrm: true }) },
      [`PATCH ${PROFILE}`]: { status: 200, body: business({ sells: "products", advancedCrm: true }) },
    });
    mount();
    await ready();
    fireEvent.change(screen.getByPlaceholderText("Your Business Name"), { target: { value: "Point Fortin Pastries Ltd" } });
    fireEvent.click(screen.getByRole("button", { name: /save business info/i }));
    await waitFor(() => expect(writes(sent)).toHaveLength(1));
    expect(Object.keys(writes(sent)[0].body ?? {}).sort()).toEqual(["businessHours", "description", "name", "tagline", "teamSize"]);
  });
});

describe("review SEC-2 / SEC-3: only a change the server confirmed for this business is said as saved", () => {
  const cases: Array<[string, string, () => void, Answer]> = [
    ["what you sell, answered 200 with another business", `PATCH ${PROFILE}`, () => fireEvent.click(sells("Services")), { status: 200, body: { ...business({ sells: "services" }), id: OTHER } }],
    ["what you sell, answered 200 with no body", `PATCH ${PROFILE}`, () => fireEvent.click(sells("Services")), { status: 200, body: null }],
    ["what you sell, refused with no words (HTTP/2)", `PATCH ${PROFILE}`, () => fireEvent.click(sells("Services")), { status: 403, body: { statusCode: 403, message: "" }, bare: true }],
    ["what you sell, answered 200 with the old answer (SEC2-1)", `PATCH ${PROFILE}`, () => fireEvent.click(sells("Services")), { status: 200, body: business({ sells: "products" }) }],
    ["the switch, answered 200 with it unchanged (SEC2-1)", `PATCH ${DOOR}`, () => fireEvent.click(crmSwitch()), { status: 200, body: business({ sells: "products", advancedCrm: false }) }],
    ["the switch, answered 200 with another business", `PATCH ${DOOR}`, () => fireEvent.click(crmSwitch()), { status: 200, body: { ...business({ advancedCrm: true }), id: OTHER } }],
    ["the switch, answered 200 with no body", `PATCH ${DOOR}`, () => fireEvent.click(crmSwitch()), { status: 200, body: null }],
    ["the switch, refused with no words (HTTP/2)", `PATCH ${DOOR}`, () => fireEvent.click(crmSwitch()), { status: 403, body: { statusCode: 403, message: "" }, bare: true }],
  ];
  it.each(cases)("%s: said as not saved, and the control stays as the business has it", async (_name, route, press, answer) => {
    const sent = stubRoutes({ [`GET ${PROFILE}`]: { status: 200, body: business({ sells: "products" }) }, [route]: answer });
    const { onStatus } = mount();
    await ready();
    press();
    await waitFor(() => expect(writes(sent)).toHaveLength(1));
    const alert = await screen.findByRole("alert");
    expect((alert.textContent ?? "").trim()).not.toBe("");
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(successes(onStatus)).toEqual([]);
    await ready();
    expect(sells("Products").checked).toBe(true);
    expect(crmSwitch()).toHaveAttribute("aria-checked", "false");
  });
});

describe("review COR-5: the controls keep the keyboard, and two sections do not collide", () => {
  it("while a change is being saved the control pressed keeps focus (it is not disabled away)", async () => {
    let release: (a: Answer) => void = () => {};
    stubRoutes({
      [`GET ${PROFILE}`]: { status: 200, body: business() },
      [`PATCH ${PROFILE}`]: () => new Promise<Answer>((resolve) => (release = resolve)),
    });
    mount();
    await ready();
    sells("Services").focus();
    fireEvent.click(sells("Services"));
    await waitFor(() => expect(sellsGroup()).toHaveAttribute("aria-busy", "true"));
    expect(sells("Services")).not.toBeDisabled();
    expect(document.activeElement).toBe(sells("Services"));
    release({ status: 200, body: business({ sells: "services" }) });
    await waitFor(() => expect(sells("Services").checked).toBe(true));
    await waitFor(() => expect(sellsGroup()).not.toHaveAttribute("aria-busy", "true"));
  });

  it("two sections on one page have their own labels and radio groups", async () => {
    stubRoutes({ [`GET ${PROFILE}`]: { status: 200, body: business({ sells: "products" }) } });
    mount();
    mount();
    await waitFor(() => expect(screen.getAllByRole("switch", { name: /advanced crm/i })).toHaveLength(2));
    const ids = Array.from(document.querySelectorAll("[id]")).map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    const names = screen.getAllByRole("radiogroup", { name: /what you sell/i }).map((g) => (g.querySelector("input") as HTMLInputElement).name);
    expect(new Set(names).size).toBe(2);
  });
});

describe("review round 2 (COR2-1, COR2-2): the keyboard is not dropped, and a press not taken is said", () => {
  it("'Try again' stays where it is, focused, while the settings are read again and when they fail again", async () => {
    let release: (a: Answer) => void = () => {};
    let reads = 0;
    stubRoutes({
      [`GET ${PROFILE}`]: () => {
        reads += 1;
        if (reads === 1) return { status: 500, body: { statusCode: 500, message: "Internal server error" } };
        return new Promise<Answer>((resolve) => (release = resolve));
      },
    });
    mount();
    const retry = await screen.findByRole("button", { name: /try again/i });
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(reads).toBe(2));
    // Being read again: the same button, still focused, and said to be busy.
    expect(screen.getByRole("button", { name: /try(ing)? again/i })).toBe(retry);
    expect(document.activeElement).toBe(retry);
    await waitFor(() => expect(retry).toHaveAttribute("aria-busy", "true"));
    release({ status: 500, body: { statusCode: 500, message: "Internal server error" } });
    await waitFor(() => expect(retry).not.toHaveAttribute("aria-busy", "true"));
    expect(screen.getByRole("button", { name: /try again/i })).toBe(retry);
    expect(document.activeElement).toBe(retry);
  });

  it("looking at the tab again while the settings are failed does not swap the failed view away", async () => {
    let release: (a: Answer) => void = () => {};
    let reads = 0;
    stubRoutes({
      [`GET ${PROFILE}`]: () => {
        reads += 1;
        if (reads === 1) return { status: 403, body: forbidden("No access to this business") };
        return new Promise<Answer>((resolve) => (release = resolve));
      },
    });
    mount();
    const retry = await screen.findByRole("button", { name: /try again/i });
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(reads).toBe(2));
    expect(screen.getByRole("button", { name: /try(ing)? again/i })).toBe(retry);
    expect(screen.getByText(/No access to this business/)).toBeInTheDocument();
    release({ status: 403, body: forbidden("No access to this business") });
  });

  it("a press while another change is being saved is not sent, and the member is told so", async () => {
    let release: (a: Answer) => void = () => {};
    const sent = stubRoutes({
      [`GET ${PROFILE}`]: { status: 200, body: business() },
      [`PATCH ${PROFILE}`]: () => new Promise<Answer>((resolve) => (release = resolve)),
    });
    mount();
    await ready();
    fireEvent.click(sells("Products"));
    await waitFor(() => expect(writes(sent)).toHaveLength(1));
    fireEvent.click(sells("Services"));
    expect(await screen.findByText(/still saving your last change/i)).toBeInTheDocument();
    release({ status: 200, body: business({ sells: "products" }) });
    await waitFor(() => expect(sells("Products").checked).toBe(true));
    expect(writes(sent)).toHaveLength(1);
    // Once the save is in, the note is gone and the next press is taken.
    await waitFor(() => expect(screen.queryByText(/still saving your last change/i)).toBeNull());
    fireEvent.click(sells("Services"));
    await waitFor(() => expect(writes(sent)).toHaveLength(2));
    expect(writes(sent)[1].body).toEqual({ sells: "services" });
    release({ status: 200, body: business({ sells: "services" }) });
    await waitFor(() => expect(sells("Services").checked).toBe(true));
  });

  it("review COR3-2: the failure is announced, a double press of 'Try again' reads once, and on recovery the keyboard lands on the controls", async () => {
    let release: (a: Answer) => void = () => {};
    let reads = 0;
    stubRoutes({
      [`GET ${PROFILE}`]: () => {
        reads += 1;
        if (reads === 1) return { status: 500, body: { statusCode: 500, message: "Internal server error" } };
        return new Promise<Answer>((resolve) => (release = resolve));
      },
    });
    mount();
    const retry = await screen.findByRole("button", { name: /try again/i });
    expect(screen.getByRole("status")).toHaveTextContent(/couldn't load what you sell and the advanced crm switch/i);
    retry.focus();
    fireEvent.click(retry);
    fireEvent.click(retry);
    await waitFor(() => expect(reads).toBe(2));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(reads).toBe(2);
    release({ status: 200, body: business({ sells: "products" }) });
    await ready();
    await waitFor(() => expect(document.activeElement).toBe(sells("Products")));
  });
});

