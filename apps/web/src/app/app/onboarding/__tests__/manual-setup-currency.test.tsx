/**
 * BIZ-SETTINGS-WEB (re-cut v1 plan, step 3, lane web; sweep BUG-077; journey A; owner rulings D-03, D-11,
 * D-150 'hubs', D-218 'sellsowner').
 *
 * WHY this test exists: the manual onboarding form took any three letters as a currency ('ABC' was saved on
 * the business and every invoice after it was in a currency that does not exist), and it never asked what the
 * business sells, the one answer that sets the hubs and the phone's bottom bar.
 *
 * Required here, through the real api client (fetch stubbed per route, every request recorded):
 *   - the currency is TTD or USD and nothing else: 'ABC' (RED: accepted and sent) and a real code v1 does not
 *     offer ('EUR') cannot be chosen, and no choice is refused in plain words before anything is sent. Owner
 *     ruling D-242 (2026-11-22): the field is a real <select> offering exactly TTD and USD (it was a text input
 *     that accepted only those two, kept so the Release 0 live spec's fill("TTD") still ran; that one call is
 *     selectOption("TTD") from the same ruling);
 *   - the form asks 'What do you sell?' with Services, Products and Both (RED: no such question), under the
 *     unchanged 'Set up manually' heading and beside the unchanged 'Finish setup' button;
 *   - the answer is saved through the owner-only profile PATCH, in the same request as the name, currency and
 *     timezone, and never through any other route; an owner who does not answer sends no sells at all (the
 *     server's default, both, stands, and the Release 0 onboarding cases are as they were);
 *   - an answer the business already holds is shown, and a refused save is said in the form with nothing
 *     reported as finished.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { ManualSetupStep, useManualSetup } from "../components/manual-setup-step";

const BIZ = "biz_bsw_onb";
const OWNER = "user_bsw_owner";
const BUSINESS_PATH = `/identity/businesses/${BIZ}`;
const COMPLETE_PATH = `/onboarding-concierge/businesses/${BIZ}/complete`;

type Sent = { method: string; path: string; body: Record<string, unknown> | null };
type Answer = { status: number; body: unknown; bare?: boolean };
type Routes = Record<string, Answer | ((body: Record<string, unknown> | null) => Answer)>;

/** fetch answering by "METHOD /path"; an unlisted route is a 500 so nothing passes by accident. */
function stubRoutes(routes: Routes): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const pathname = new URL(url, "http://localhost").pathname;
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      sent.push({ method, path: pathname, body });
      const route = routes[`${method} ${pathname}`];
      const answer = route ? (typeof route === "function" ? route(body) : route) : { status: 500, body: { message: `no route ${method} ${pathname}` } };
      return new Response(JSON.stringify(answer.body), {
        status: answer.status,
        statusText: answer.bare ? "" : answer.status === 403 ? "Forbidden" : answer.status >= 400 ? "Error" : "OK",
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return sent;
}

const STORED = { id: BIZ, ownerId: OWNER, name: "", currency: null, timezone: null, sells: "both", advancedCrm: false };

/** The routes of an owner finishing setup; `business` is what GET answers, `over` replaces routes. */
function ownerRoutes(business: Record<string, unknown> = STORED, over: Routes = {}): Routes {
  return {
    [`GET ${BUSINESS_PATH}`]: { status: 200, body: business },
    "GET /identity/me": { status: 200, body: { id: OWNER, email: "owner@example.test", role: "USER" } },
    // As the server answers a profile PATCH: the business as it now is, a sells it was sent included.
    [`PATCH ${BUSINESS_PATH}`]: (body) => ({ status: 200, body: { sells: "both", ...business, ...(body ?? {}) } }),
    [`POST ${COMPLETE_PATH}`]: { status: 201, body: { complete: true } },
    ...over,
  };
}

function Harness() {
  const setup = useManualSetup();
  return <ManualSetupStep setup={setup} />;
}

/** Mounts the form and waits for the prefill read to land. */
async function mount(sent: Sent[]) {
  render(<Harness />);
  await waitFor(() => expect(sent.some((s) => s.method === "GET" && s.path === BUSINESS_PATH)).toBe(true));
  // Let the prefill settle into the form before it is driven.
  await waitFor(() => expect(screen.getByLabelText("Business name")).toBeInTheDocument());
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const form = () => screen.getByRole("region", { name: /set up manually/i });
const currency = () => within(form()).getByLabelText("Currency") as HTMLInputElement | HTMLSelectElement;
const finish = () => within(form()).getByRole("button", { name: /finish setup/i });
const patches = (sent: Sent[]) => sent.filter((s) => s.method === "PATCH");
const writes = (sent: Sent[]) => sent.filter((s) => s.method !== "GET");

function fill(values: { name?: string; currency?: string; timezone?: string }) {
  if (values.name !== undefined) fireEvent.change(within(form()).getByLabelText("Business name"), { target: { value: values.name } });
  if (values.currency !== undefined) fireEvent.change(currency(), { target: { value: values.currency } });
  if (values.timezone !== undefined) fireEvent.change(within(form()).getByLabelText("Timezone"), { target: { value: values.timezone } });
}

const VALID = { name: "Point Fortin Pastries", timezone: "America/Port_of_Spain" };

/** A "What do you sell?" choice, for tests outside that describe block. */
const choiceOf = (name: string) =>
  within(within(form()).getByRole("radiogroup", { name: /what do you sell\?/i })).getByRole("radio", { name: new RegExp(`^${name}$`, "i") }) as HTMLInputElement;

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("kf_business_id", BIZ);
  router.replace.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BUG-077: the currency is TTD or USD", () => {
  // Owner ruling D-242 (2026-11-22): the field is a real <select> offering exactly TTD and USD, not free text.
  const select = () => currency() as HTMLSelectElement;

  it("is a select offering exactly TTD and USD, with nothing chosen for a business that holds no currency", async () => {
    const sent = stubRoutes(ownerRoutes());
    await mount(sent);
    expect(select().tagName).toBe("SELECT");
    const options = Array.from(select().options);
    // One empty choice ("nothing chosen yet") and the two currencies; no other.
    expect(options.map((o) => o.value)).toEqual(["", "TTD", "USD"]);
    expect(options.filter((o) => o.value).map((o) => o.text.trim())).toEqual(["TTD", "USD"]);
    expect(select().value).toBe("");
    expect(form()).not.toHaveTextContent(/JMD|BBD|XCD|GYD|EUR|GBP|CAD/);
    // No free-text leftovers: nothing to type into, no suggestion list.
    expect(select().getAttribute("list")).toBeNull();
    expect(document.getElementById("manual-setup-currencies")).toBeNull();
  });

  it.each(["ABC", "EUR", "JMD", "TT"])("%j cannot be chosen: the field stays unchosen, is refused in plain words, and nothing is sent", async (value) => {
    const sent = stubRoutes(ownerRoutes());
    await mount(sent);
    fill({ ...VALID, currency: value });
    expect(select().value).toBe("");
    fireEvent.click(finish());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Currency must be TTD or USD.");
    // Refused in the browser: no profile write, no completion, no navigation.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(writes(sent)).toEqual([]);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("finishing with no currency chosen is refused in plain words and sends nothing", async () => {
    const sent = stubRoutes(ownerRoutes());
    await mount(sent);
    fill(VALID);
    fireEvent.click(finish());
    expect(await screen.findByRole("alert")).toHaveTextContent("Currency must be TTD or USD.");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(writes(sent)).toEqual([]);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it.each(["TTD", "USD"])("choosing %s saves it", async (chosen) => {
    const sent = stubRoutes(ownerRoutes());
    await mount(sent);
    fill({ ...VALID, currency: chosen });
    expect(select().value).toBe(chosen);
    fireEvent.click(finish());

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/app/command-center"));
    expect(patches(sent)).toHaveLength(1);
    expect(patches(sent)[0]).toMatchObject({ path: BUSINESS_PATH, body: { name: VALID.name, currency: chosen, timezone: VALID.timezone } });
  });

  it.each([
    ["TTD", "TTD"],
    ["usd", "USD"],
    [" ttd ", "TTD"],
  ])("a business that already holds %j shows it chosen, and it is saved as %s", async (held, saved) => {
    const sent = stubRoutes(ownerRoutes({ ...STORED, name: VALID.name, currency: held, timezone: VALID.timezone }));
    await mount(sent);
    await waitFor(() => expect(select().value).toBe(saved));
    fireEvent.click(choiceOf("Products"));
    fireEvent.click(finish());
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/app/command-center"));
    expect(patches(sent)[0].body).toMatchObject({ currency: saved });
  });

  it("a stored currency v1 does not offer is not offered: nothing is chosen, it is refused until TTD or USD is, and then saved", async () => {
    const sent = stubRoutes(ownerRoutes({ ...STORED, name: VALID.name, currency: "EUR", timezone: VALID.timezone }));
    await mount(sent);
    await waitFor(() => expect((within(form()).getByLabelText("Business name") as HTMLInputElement).value).toBe(VALID.name));
    expect(select().value).toBe("");
    expect(Array.from(select().options).map((o) => o.value)).toEqual(["", "TTD", "USD"]);
    fireEvent.click(finish());
    expect(await screen.findByRole("alert")).toHaveTextContent("Currency must be TTD or USD.");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(writes(sent)).toEqual([]);

    fill({ currency: "USD" });
    fireEvent.click(finish());
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/app/command-center"));
    expect(patches(sent)[0].body).toMatchObject({ currency: "USD" });
  });

  it("the server's own 'currency is missing' refusal is said in the same words", async () => {
    // An actor the browser cannot tell is the owner: completion is asked first, and refused on the profile.
    let completions = 0;
    const sent = stubRoutes(
      ownerRoutes(STORED, {
        "GET /identity/me": { status: 200, body: { id: "user_bsw_other", email: "o@example.test", role: "USER" } },
        [`POST ${COMPLETE_PATH}`]: () => {
          completions += 1;
          return { status: 403, body: { statusCode: 403, code: "ONBOARDING_PROFILE_INCOMPLETE", message: "Profile incomplete", details: { missingFields: ["currency"] } } };
        },
      }),
    );
    await mount(sent);
    fill({ ...VALID, currency: "TTD" });
    fireEvent.click(finish());
    expect(await screen.findByRole("alert")).toHaveTextContent("Currency must be TTD or USD.");
    expect(completions).toBeGreaterThan(0);
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("the form asks what the business sells", () => {
  const question = () => within(form()).getByRole("radiogroup", { name: /what do you sell\?/i });
  const choice = (name: string) => within(question()).getByRole("radio", { name: new RegExp(`^${name}$`, "i") }) as HTMLInputElement;

  it("asks 'What do you sell?' with Services, Products and Both, under the unchanged heading and button", async () => {
    const sent = stubRoutes(ownerRoutes());
    await mount(sent);
    expect(within(form()).getByRole("heading", { name: "Set up manually" })).toBeInTheDocument();
    expect(finish()).toHaveTextContent("Finish setup");
    const radios = within(question()).getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((r) => r.value).sort()).toEqual(["both", "products", "services"]);
    // Each choice is named by its one word (journey A reads the label's text).
    expect(radios.map((r) => r.closest("label")?.textContent?.trim()).sort()).toEqual(["Both", "Products", "Services"]);
  });

  it("an answer is saved through the owner-only profile PATCH, in the one request with the profile", async () => {
    const sent = stubRoutes(ownerRoutes());
    await mount(sent);
    fill({ ...VALID, currency: "TTD" });
    fireEvent.click(choice("Products"));
    expect(choice("Products").checked).toBe(true);
    fireEvent.click(finish());

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/app/command-center"));
    expect(patches(sent)).toEqual([
      { method: "PATCH", path: BUSINESS_PATH, body: { name: VALID.name, currency: "TTD", timezone: VALID.timezone, sells: "products" } },
    ]);
    // Saved before completion is asked, and through no other route.
    expect(writes(sent).map((s) => `${s.method} ${s.path}`)).toEqual([`PATCH ${BUSINESS_PATH}`, `POST ${COMPLETE_PATH}`]);
    expect(sent.some((s) => s.path.includes("advanced-settings"))).toBe(false);
  });

  it.each(["services", "both"])("saves the answer %s as chosen", async (answer) => {
    const sent = stubRoutes(ownerRoutes({ ...STORED, sells: "products" }));
    await mount(sent);
    fill({ ...VALID, currency: "USD" });
    fireEvent.click(choice(answer));
    fireEvent.click(finish());
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(patches(sent)[0].body).toMatchObject({ sells: answer });
  });

  it("an owner who does not answer sends no sells: the stored answer (or the default, both) stands", async () => {
    const sent = stubRoutes(ownerRoutes());
    await mount(sent);
    fill({ ...VALID, currency: "TTD" });
    fireEvent.click(finish());
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/app/command-center"));
    expect(patches(sent)).toEqual([{ method: "PATCH", path: BUSINESS_PATH, body: { name: VALID.name, currency: "TTD", timezone: VALID.timezone } }]);
  });

  it("shows the answer the business holds: both for one that never answered (the server answers its default)", async () => {
    const sent = stubRoutes(ownerRoutes({ ...STORED, sells: "services" }));
    await mount(sent);
    await waitFor(() => expect(choice("Services").checked).toBe(true));
    cleanup();

    const fresh = stubRoutes(ownerRoutes(STORED));
    await mount(fresh);
    await waitFor(() => expect(choice("Both").checked).toBe(true));
  });

  it("review SEC3-4: an answer that carries no 'sells' is not read as 'both': nothing is drawn, and pressing Both is saved", async () => {
    // A read that carries no sells (an older server); the PATCH answers the settings as the server does.
    const stored = { id: BIZ, ownerId: OWNER, name: VALID.name, currency: "TTD", timezone: VALID.timezone };
    const sent = stubRoutes(
      ownerRoutes(stored, {
        [`PATCH ${BUSINESS_PATH}`]: (body) => ({ status: 200, body: { ...stored, advancedCrm: false, ...(body ?? {}) } }),
        "GET /identity/me": { status: 200, body: { id: "user_bsw_coowner", email: "c@example.test", role: "USER" } },
      }),
    );
    await mount(sent);
    await waitFor(() => expect((currency() as HTMLInputElement).value).toBe("TTD"));
    expect((within(question()).getAllByRole("radio") as HTMLInputElement[]).filter((r) => r.checked)).toEqual([]);
    fireEvent.click(choice("Both"));
    fireEvent.click(finish());
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/app/command-center"));
    expect(patches(sent)).toHaveLength(1);
    expect(patches(sent)[0].body).toMatchObject({ sells: "both" });
  });

  it("review COR3-3: on the complete-first path, a save the server did not confirm is said, not passed over", async () => {
    const stored = { ...STORED, name: VALID.name, currency: "TTD", timezone: VALID.timezone };
    const sent = stubRoutes(
      ownerRoutes(stored, {
        "GET /identity/me": { status: 200, body: { id: "user_bsw_coowner", email: "c@example.test", role: "USER" } },
        [`PATCH ${BUSINESS_PATH}`]: { status: 200, body: { ...stored, sells: "both" } },
      }),
    );
    await mount(sent);
    await waitFor(() => expect((currency() as HTMLInputElement).value).toBe("TTD"));
    fireEvent.click(choice("Services"));
    fireEvent.click(finish());
    expect(await screen.findByRole("alert")).toHaveTextContent(/setup is finished, but your changes were not saved/i);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("a late prefill does not overwrite an answer the owner already gave", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const routes = ownerRoutes({ ...STORED, sells: "services" });
    const sent: Sent[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const method = (init?.method ?? "GET").toUpperCase();
        const pathname = new URL(url, "http://localhost").pathname;
        sent.push({ method, path: pathname, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
        if (method === "GET" && pathname === BUSINESS_PATH) await gate;
        const answer = routes[`${method} ${pathname}`] as Answer;
        return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
      }),
    );
    render(<Harness />);
    try {
      fireEvent.click(choice("Products"));
    } finally {
      // Always let the read go, so a failure here leaves no request in flight for the next test.
      release();
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(choice("Products").checked).toBe(true);
    expect(choice("Services").checked).toBe(false);
  });

  it("a member the browser cannot tell is the owner: the answer is saved once the server has accepted the actor", async () => {
    // Completion is asked first (nothing is written before the server decides who is acting); it goes
    // through, and the answer, the only change, is then saved through the owner PATCH.
    const stored = { ...STORED, name: VALID.name, currency: "TTD", timezone: VALID.timezone };
    const sent = stubRoutes(
      ownerRoutes(stored, { "GET /identity/me": { status: 200, body: { id: "user_bsw_coowner", email: "c@example.test", role: "USER" } } }),
    );
    await mount(sent);
    await waitFor(() => expect((currency() as HTMLInputElement).value).toBe("TTD"));
    fireEvent.click(choice("Services"));
    fireEvent.click(finish());
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/app/command-center"));
    expect(writes(sent).map((s) => `${s.method} ${s.path}`)).toEqual([`POST ${COMPLETE_PATH}`, `PATCH ${BUSINESS_PATH}`]);
    expect(patches(sent)[0].body).toMatchObject({ sells: "services" });
  });

  it("someone who may not finish is told to ask the owner, and the answer is never sent", async () => {
    const sent = stubRoutes(
      ownerRoutes(STORED, {
        "GET /identity/me": { status: 200, body: { id: "user_bsw_staff", email: "s@example.test", role: "USER" } },
        [`POST ${COMPLETE_PATH}`]: { status: 403, body: { statusCode: 403, code: "ONBOARDING_COMPLETE_FORBIDDEN", message: "Only the business owner can finish onboarding." } },
      }),
    );
    await mount(sent);
    fill({ ...VALID, currency: "TTD" });
    fireEvent.click(choice("Products"));
    fireEvent.click(finish());
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the business owner can finish onboarding.");
    expect(patches(sent)).toEqual([]);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("a refused save is said in the form: nothing is finished and the answer stays chosen", async () => {
    const sent = stubRoutes(
      ownerRoutes(STORED, {
        [`PATCH ${BUSINESS_PATH}`]: { status: 403, body: { statusCode: 403, message: "Only the business owner can edit the business profile", error: "Forbidden" } },
      }),
    );
    await mount(sent);
    fill({ ...VALID, currency: "TTD" });
    fireEvent.click(choice("Products"));
    fireEvent.click(finish());
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the business owner can edit the business profile");
    expect(sent.some((s) => s.method === "POST" && s.path === COMPLETE_PATH)).toBe(false);
    expect(router.replace).not.toHaveBeenCalled();
    expect(choice("Products").checked).toBe(true);
  });

  it("review SEC-3: a save refused with no words at all (HTTP/2) is still a refusal: nothing is finished", async () => {
    const sent = stubRoutes(
      ownerRoutes(STORED, { [`PATCH ${BUSINESS_PATH}`]: { status: 403, body: { statusCode: 403, message: "" }, bare: true } }),
    );
    await mount(sent);
    fill({ ...VALID, currency: "TTD" });
    fireEvent.click(choice("Products"));
    fireEvent.click(finish());
    const alert = await screen.findByRole("alert");
    expect((alert.textContent ?? "").trim()).not.toBe("");
    expect(sent.some((s) => s.method === "POST" && s.path === COMPLETE_PATH)).toBe(false);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("review OBS-7: a prefill answer naming another business is not taken as this business's answer", async () => {
    const sent = stubRoutes(ownerRoutes({ ...STORED, id: "biz_bsw_someone_else", name: "Someone Else Ltd", sells: "services" }));
    await mount(sent);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Nothing of it is drawn: not its 'services', not its name; and (COR-2) no answer stands in for the unread one.
    expect((within(question()).getAllByRole("radio") as HTMLInputElement[]).filter((r) => r.checked)).toEqual([]);
    expect((within(form()).getByLabelText("Business name") as HTMLInputElement).value).toBe("");
  });

  it("review COR-2: when what the business holds could not be read, no answer is drawn as its own, and none is sent", async () => {
    const sent = stubRoutes(ownerRoutes(STORED, { [`GET ${BUSINESS_PATH}`]: { status: 500, body: { statusCode: 500, message: "Internal server error" } } }));
    await mount(sent);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const radios = within(question()).getAllByRole("radio") as HTMLInputElement[];
    expect(radios.filter((r) => r.checked)).toEqual([]);
    fill({ ...VALID, currency: "TTD" });
    fireEvent.click(finish());
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/app/command-center"));
    expect(patches(sent).every((p) => !("sells" in (p.body ?? {})))).toBe(true);
  });

  it("review COR-2: pressing the answer already shown records it as the owner's answer", async () => {
    const sent = stubRoutes(ownerRoutes());
    await mount(sent);
    await waitFor(() => expect(choice("Both").checked).toBe(true));
    fill({ ...VALID, currency: "TTD" });
    fireEvent.click(choice("Both"));
    fireEvent.click(finish());
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/app/command-center"));
    expect(patches(sent)).toHaveLength(1);
    expect(patches(sent)[0].body).toMatchObject({ sells: "both" });
  });

  it("review COR-5: each choice is a full-size touch target", async () => {
    const sent = stubRoutes(ownerRoutes());
    await mount(sent);
    for (const radio of within(question()).getAllByRole("radio")) expect(radio.closest("label")?.className).toContain("min-h-[44px]");
  });

  it("review SEC2-1: a save answered 200 without the answer the owner gave is not a save: nothing is finished", async () => {
    const sent = stubRoutes(ownerRoutes(STORED, { [`PATCH ${BUSINESS_PATH}`]: { status: 200, body: { ...STORED, sells: "both" } } }));
    await mount(sent);
    fill({ ...VALID, currency: "TTD" });
    fireEvent.click(choice("Products"));
    fireEvent.click(finish());
    const alert = await screen.findByRole("alert");
    expect((alert.textContent ?? "").trim()).not.toBe("");
    expect(sent.some((s) => s.method === "POST" && s.path === COMPLETE_PATH)).toBe(false);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("review OBS4-1: a save answered after someone else signed in here finishes nothing for them", async () => {
    const token = (sub: string) => `h.${btoa(JSON.stringify({ sub }))}.s`;
    window.localStorage.setItem("kf_token", token("user_bsw_owner_session"));
    let release: (a: Answer) => void = () => {};
    const routes = ownerRoutes();
    const sent: Sent[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const method = (init?.method ?? "GET").toUpperCase();
        const pathname = new URL(url, "http://localhost").pathname;
        const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
        sent.push({ method, path: pathname, body });
        const route = routes[`${method} ${pathname}`];
        const answer =
          method === "PATCH" ? await new Promise<Answer>((resolve) => (release = resolve)) : typeof route === "function" ? route(body) : route;
        return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
      }),
    );
    await mount(sent);
    fill({ ...VALID, currency: "TTD" });
    fireEvent.click(choice("Products"));
    fireEvent.click(finish());
    await waitFor(() => expect(patches(sent)).toHaveLength(1));
    window.localStorage.setItem("kf_token", token("user_bsw_someone_else"));
    release({ status: 200, body: { ...STORED, name: VALID.name, currency: "TTD", timezone: VALID.timezone, sells: "products" } });
    const alert = await screen.findByRole("alert");
    expect((alert.textContent ?? "").trim()).not.toBe("");
    expect(sent.some((s) => s.method === "POST" && s.path === COMPLETE_PATH)).toBe(false);
    expect(router.replace).not.toHaveBeenCalled();
  });
});

