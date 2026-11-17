/**
 * SWP-PROFILE-TEAMSIZE (re-cut v1 plan, step 3, lane both; sweep BUG-006; journey A).
 *
 * WHY this test exists: Business Profile > "Save Business Info" never saved. The form's team sizes were
 * SOLO / SMALL_TEAM / GROWING / MEDIUM / LARGE and an untouched select sent teamSize "", while the profile PATCH
 * (apps/server identity/dto/update-business.dto.ts) takes only its TeamSize enum (@IsEnum: solo, small, medium,
 * large, 1, 2-5, 6-10, 11-50, 50+). Every save, with or without a team size, answered 400 "teamSize must be one
 * of: ...", the reason was drawn in the page's banner about 731px above the viewport, and only "You have unsaved
 * changes" stayed in view; a reload showed the old values.
 *
 * Required here, through the real api client (lib/api.ts apiPatch, fetch stubbed and recording each request):
 *   - every team size the form offers is a value of the server's TeamSize enum, read from the DTO itself, and
 *     choosing it sends exactly that value (RED: SOLO, SMALL_TEAM, ... are not);
 *   - no team size chosen sends no teamSize at all (RED: it sent "");
 *   - a value stored by the old form (SMALL_TEAM, ...) or another spelling the server takes (small, 1, ...)
 *     shows as the option it means and is saved as that option's enum value (RED: SMALL_TEAM was sent back);
 *   - a refused save (a 400, the owner-only 403) is loud and kind: one refusal toast with the server's words, the
 *     same words beside the Save button, scrolled into view, and every edit kept (RED: no toast, nothing beside
 *     the button, nothing scrolled);
 *   - a save that goes through says so, sends the five profile fields and nothing else, and is no longer dirty.
 *
 * The server half (each value this form can send is saved by the real PATCH route on a real database) is
 * apps/server/test/business-profile-save.integration.test.ts; the browser half is
 * apps/web/e2e/sweep-profile-save.spec.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast, Toaster: () => null }));

import MyBusinessSection from "../my-business-section";

const BIZ = "biz_pts";
const PATCH_PATH = `/identity/businesses/${BIZ}`;

/** The server's TeamSize enum, read from the DTO the PATCH validates with (not a copy that could drift). */
function serverTeamSizes(): string[] {
  const dto = readFileSync(path.resolve(__dirname, "../../../../../../../server/src/modules/identity/dto/update-business.dto.ts"), "utf8");
  const body = /export enum TeamSize \{([^}]*)\}/.exec(dto);
  if (!body) throw new Error("TeamSize enum not found in update-business.dto.ts");
  return [...body[1].matchAll(/=\s*'([^']*)'/g)].map((m) => m[1]);
}
const TEAM_SIZES = serverTeamSizes();

/** class-validator's refusal as GlobalHttpExceptionFilter sends it. */
function badRequest(message: string[]) {
  return { statusCode: 400, code: "BAD_REQUEST", message, error: "Bad Request", timestamp: new Date().toISOString(), path: PATCH_PATH };
}

type Sent = { method: string; path: string; body: Record<string, unknown> | null };

/** fetch answering every request with `status` and `body`; records each request's method, path and JSON body. */
function stubFetch(status: number, body: unknown): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      sent.push({
        method: (init?.method ?? "GET").toUpperCase(),
        path: new URL(url, "http://localhost").pathname,
        body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      });
      const statusText = status === 400 ? "Bad Request" : status === 403 ? "Forbidden" : "OK";
      return new Response(JSON.stringify(body), { status, statusText, headers: { "content-type": "application/json" } });
    }),
  );
  return sent;
}

const HOURS = Object.fromEntries(
  ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [
    d,
    { open: "08:00", close: "16:00", closed: d === "sunday" },
  ]),
);

function mount(stored: { teamSize?: string | null } = {}) {
  const onStatus = vi.fn();
  const onSaved = vi.fn();
  render(
    <MyBusinessSection
      businessId={BIZ}
      businessData={{
        name: "Point Fortin Pastries",
        tagline: "Fresh daily",
        description: "A family bakery.",
        teamSize: stored.teamSize ?? null,
        businessHours: HOURS,
      }}
      businessLoading={false}
      onStatus={onStatus}
      onSaved={onSaved}
    />,
  );
  return { onStatus, onSaved };
}

/** Opens Team & Scale (closed by default) and returns its select. */
function teamSizeSelect(): HTMLSelectElement {
  if (!screen.queryByRole("combobox", { name: "Team size" })) fireEvent.click(screen.getByRole("button", { name: /team & scale/i }));
  return screen.getByRole("combobox", { name: "Team size" }) as HTMLSelectElement;
}

const nameInput = () => screen.getByPlaceholderText("Your Business Name") as HTMLInputElement;
const taglineInput = () => screen.getByPlaceholderText("A short tagline for your business") as HTMLInputElement;
const saveButton = () => screen.getByRole("button", { name: /save business info/i });

async function save(sent: Sent[], count = 1) {
  fireEvent.click(saveButton());
  await waitFor(() => expect(sent.filter((s) => s.method === "PATCH")).toHaveLength(count));
}

const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView);

beforeEach(() => {
  for (const fn of Object.values(toast)) fn.mockReset();
  scrollIntoView.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SWP-PROFILE-TEAMSIZE: the team sizes are the server's (BUG-006)", () => {
  it("[WEB-PTS-00] the server's TeamSize enum is read from the DTO", () => {
    expect(TEAM_SIZES).toEqual(expect.arrayContaining(["solo", "2-5", "6-10", "11-50", "50+"]));
  });

  it("[WEB-PTS-01] RED-BEFORE: every team size the form offers is a value the server takes, and choosing it sends exactly that value", async () => {
    mount();
    const offered = Array.from(teamSizeSelect().options).filter((o) => o.value !== "");
    expect(offered.length, "the form offers team sizes").toBeGreaterThanOrEqual(4);
    for (const option of offered) {
      expect(TEAM_SIZES, `option '${option.text}' sends '${option.value}'`).toContain(option.value);
    }

    for (const [i, option] of offered.entries()) {
      const sent = stubFetch(200, { id: BIZ });
      fireEvent.change(teamSizeSelect(), { target: { value: option.value } });
      if (!saveButton().hasAttribute("disabled")) await save(sent);
      else {
        // The option equals what the last save stored: change the name so there is something to save.
        fireEvent.change(nameInput(), { target: { value: `Point Fortin Pastries ${i}` } });
        await save(sent);
      }
      const patch = sent.find((s) => s.method === "PATCH")!;
      expect(patch.path).toBe(PATCH_PATH);
      expect(patch.body?.teamSize, `'${option.text}'`).toBe(option.value);
      vi.unstubAllGlobals();
    }
  });

  it("[WEB-PTS-02] RED-BEFORE: with no team size chosen the save sends no teamSize ('' is not a team size)", async () => {
    mount({ teamSize: null });
    expect(teamSizeSelect().value).toBe("");
    const sent = stubFetch(200, { id: BIZ });
    fireEvent.change(nameInput(), { target: { value: "Point Fortin Pastries & Bakes" } });
    await save(sent);
    const patch = sent.find((s) => s.method === "PATCH")!;
    expect(patch.body).not.toHaveProperty("teamSize");
    expect(patch.body?.name).toBe("Point Fortin Pastries & Bakes");
  });

  it.each([
    ["SOLO", "solo"],
    ["SMALL_TEAM", "2-5"],
    ["GROWING", "6-10"],
    ["MEDIUM", "11-50"],
    ["LARGE", "50+"],
    ["1", "solo"],
    ["small", "2-5"],
    ["medium", "11-50"],
    ["large", "50+"],
  ])("[WEB-PTS-03] RED-BEFORE: a stored '%s' shows as the option it means and is saved as '%s'", async (stored, expected) => {
    mount({ teamSize: stored });
    const select = teamSizeSelect();
    expect(select.value).toBe(expected);
    expect(TEAM_SIZES).toContain(expected);
    expect(screen.queryByText("You have unsaved changes"), "reading a stored value is not an edit").toBeNull();

    const sent = stubFetch(200, { id: BIZ });
    fireEvent.change(taglineInput(), { target: { value: "Baked before sunrise" } });
    await save(sent);
    expect(sent.find((s) => s.method === "PATCH")!.body?.teamSize).toBe(expected);
  });

  it("[WEB-PTS-04] RED-BEFORE: a stored value the form cannot name is left as it is: no option is invented and no teamSize is sent", async () => {
    mount({ teamSize: "Me and my sister" });
    expect(teamSizeSelect().value).toBe("");
    const sent = stubFetch(200, { id: BIZ });
    fireEvent.change(taglineInput(), { target: { value: "Baked before sunrise" } });
    await save(sent);
    expect(sent.find((s) => s.method === "PATCH")!.body).not.toHaveProperty("teamSize");
  });
});

describe("SWP-PROFILE-TEAMSIZE: a refused save is loud and keeps the edits (BUG-006)", () => {
  const REASON = "tagline must be shorter than or equal to 100 characters";

  it("[WEB-PTS-05] RED-BEFORE: a 400 makes one refusal toast with the server's words, says them beside Save in view, and keeps every edit", async () => {
    const { onSaved } = mount({ teamSize: "2-5" });
    const sent = stubFetch(400, badRequest([REASON]));
    fireEvent.change(nameInput(), { target: { value: "Point Fortin Pastries & Bakes" } });
    fireEvent.change(taglineInput(), { target: { value: "Fresh from the oven daily" } });
    fireEvent.change(teamSizeSelect(), { target: { value: "6-10" } });
    await save(sent);

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    const [title, options] = toast.error.mock.calls[0] as [string, { id?: string }];
    expect(title).toBe(REASON);
    expect(options?.id).toBe("kf-refusal");

    // Beside the Save button, not in the page's banner far above it, and brought into view.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(REASON);
    const footer = saveButton().closest("div.border-t") as HTMLElement;
    expect(footer, "the Save button's footer").not.toBeNull();
    expect(within(footer).getByRole("alert")).toBe(alert);
    await waitFor(() => expect(scrollIntoView.mock.contexts).toContain(alert));

    // Every edit is kept and still unsaved; Save can be pressed again.
    expect(nameInput().value).toBe("Point Fortin Pastries & Bakes");
    expect(taglineInput().value).toBe("Fresh from the oven daily");
    expect(teamSizeSelect().value).toBe("6-10");
    expect(screen.getByText("You have unsaved changes")).toBeInTheDocument();
    expect(saveButton()).not.toBeDisabled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("[WEB-PTS-06] RED-BEFORE: the owner-only refusal (D-11, 403) is said the same way, in the server's words", async () => {
    const D11 = "Only the business owner can edit the business profile";
    mount();
    const sent = stubFetch(403, { statusCode: 403, code: "FORBIDDEN", message: D11, error: "Forbidden" });
    fireEvent.change(nameInput(), { target: { value: "Renamed" } });
    await save(sent);
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error.mock.calls[0][0]).toBe(D11);
    expect(await screen.findByRole("alert")).toHaveTextContent(D11);
    expect(nameInput().value).toBe("Renamed");
  });

  it("[WEB-PTS-07] RED-BEFORE: a save that goes through sends the five profile fields, says it saved, and is no longer dirty; the next save clears the old refusal", async () => {
    const { onStatus, onSaved } = mount({ teamSize: "solo" });
    let sent = stubFetch(400, badRequest([REASON]));
    fireEvent.change(taglineInput(), { target: { value: "Fresh from the oven daily" } });
    await save(sent);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    vi.unstubAllGlobals();

    sent = stubFetch(200, { id: BIZ });
    await save(sent);
    const patch = sent.find((s) => s.method === "PATCH")!;
    expect(Object.keys(patch.body ?? {}).sort()).toEqual(["businessHours", "description", "name", "tagline", "teamSize"]);
    expect(patch.body).toEqual({
      name: "Point Fortin Pastries",
      tagline: "Fresh from the oven daily",
      description: "A family bakery.",
      teamSize: "solo",
      businessHours: HOURS,
    });
    await waitFor(() => expect(onStatus).toHaveBeenCalledWith({ type: "success", message: "Business info updated" }));
    expect(onSaved).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByText("You have unsaved changes")).toBeNull();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});
