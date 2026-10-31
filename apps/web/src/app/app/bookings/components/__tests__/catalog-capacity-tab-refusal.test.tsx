/**
 * R0-ID-WEB-AUTHORITY-UX (R0-09 review CR-1): the booking setup "Hours" card
 * reports a refused business-hours save as a refusal, not as a success.
 *
 * WHY this test exists: owner ruling D-11 (R0-09-ID-HARDEN) made
 * PATCH /identity/businesses/:businessId OWNER only, so an ADMIN or STAFF who
 * saves business hours now gets 403 "Only the business owner can edit the
 * business profile". apiPatch does not throw on an error response: it returns
 * { data: null, error, status, rawError }. The card awaited updateBusiness
 * inside a try/catch and toasted "Business hours saved" whatever came back, so
 * the refused member was told the save worked.
 *
 * Mounted on the real CatalogCapacityTab and the real client.ts wrappers
 * (getBusinessById, updateBusiness). The write is stubbed at the api module
 * (apiPatch, whose refusal result is the exact shape it produces from the
 * production GlobalHttpExceptionFilter body); the read goes through client.ts's
 * own fetch-based GET, so `fetch` serves the stored business; the toast is
 * stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";

const api = vi.hoisted(() => ({
  apiPatch: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiPatch: api.apiPatch };
});

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), message: vi.fn(),
    warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));

import { toast } from "sonner";
import CatalogCapacityTab from "../catalog-capacity-tab";

const BUSINESS = "biz_hours_1";
const SERVER_REFUSAL = "Only the business owner can edit the business profile";
const OWNER_ONLY_FALLBACK = "Only the business owner can change this.";

type ApiResult = { data: unknown; error: string | null; status?: number; rawError?: Record<string, unknown> | null };

/** apiPatch's result for a 403 the production filter rendered with `message`. */
function forbidden(message: string | undefined): ApiResult {
  const body: Record<string, unknown> = {
    statusCode: 403, code: "FORBIDDEN", error: "Forbidden",
    timestamp: "2026-10-31T00:00:00.000Z", path: `/identity/businesses/${BUSINESS}`,
  };
  if (message !== undefined) body.message = message;
  // handleErrorResponse: message, else error, else statusText.
  return { data: null, error: message ?? "Forbidden", status: 403, rawError: body };
}

function jsonResponse(status: number, body: unknown, statusText = "OK"): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  } as unknown as Response;
}

function renderHours(onBusinessHoursSaved = vi.fn()) {
  render(
    <CatalogCapacityTab
      services={[]}
      staff={[]}
      bookings={[]}
      staffForm={{ name: "", email: "" }}
      setStaffForm={() => {}}
      onCreateStaff={() => {}}
      onDeleteStaff={() => {}}
      calendarConnected={false}
      calendarEmail={null}
      loading={false}
      businessId={BUSINESS}
      businessHoursSet={false}
      onBusinessHoursSaved={onBusinessHoursSaved}
    />,
  );
  return { onBusinessHoursSaved };
}

/**
 * The stored hours the card loads: Sunday 07:00-12:00 only. Its 07:00 shows in
 * the DOM once the load has landed, which is the signal to start editing (the
 * load resets the unsaved flag, so an edit made before it would be discarded).
 */
const STORED_HOURS = {
  sunday: { open: "07:00", close: "12:00", closed: false },
  monday: { open: "09:00", close: "17:00", closed: true },
  tuesday: { open: "09:00", close: "17:00", closed: true },
  wednesday: { open: "09:00", close: "17:00", closed: true },
  thursday: { open: "09:00", close: "17:00", closed: true },
  friday: { open: "09:00", close: "17:00", closed: true },
  saturday: { open: "09:00", close: "17:00", closed: true },
};

/** Opens the Hours card, waits for the stored hours, edits them with a preset, and presses Save Hours. */
async function saveHours() {
  fireEvent.click(screen.getByRole("button", { name: /^Hours$/ }));
  await screen.findByDisplayValue("07:00");
  fireEvent.click(screen.getByRole("button", { name: /Mon–Fri 9–5/ }));
  const save = screen.getByRole("button", { name: /Save Hours/ });
  await waitFor(() => expect(save).not.toBeDisabled());
  fireEvent.click(save);
  await waitFor(() => expect(api.apiPatch).toHaveBeenCalledTimes(1));
  // Let the awaited write's continuation (toast, flags) run.
  await act(async () => {});
  return save;
}

describe("catalog capacity tab: a refused business-hours save shows the refusal, not a success", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(url, "http://localhost");
      if (pathname.endsWith(`/identity/businesses/${BUSINESS}`)) {
        return jsonResponse(200, { id: BUSINESS, businessHours: STORED_HOURS });
      }
      return jsonResponse(404, { message: "Not stubbed" }, "Not Found");
    }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("[R0-ID-UX-H01] 403 from the owner-only profile write shows the server's refusal and no success", async () => {
    api.apiPatch.mockResolvedValue(forbidden(SERVER_REFUSAL));
    const { onBusinessHoursSaved } = renderHours();

    const save = await saveHours();

    expect(toast.success).not.toHaveBeenCalled();
    expect(onBusinessHoursSaved).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(SERVER_REFUSAL);
    expect(toast.error).toHaveBeenCalledWith(SERVER_REFUSAL);
    // Still unsaved: the edit is not marked as persisted.
    await waitFor(() => expect(save).not.toBeDisabled());
    expect(api.apiPatch).toHaveBeenCalledWith(
      `/identity/businesses/${BUSINESS}`,
      expect.objectContaining({ businessHours: expect.any(Object) }),
    );
  });

  it("[R0-ID-UX-H02] a 403 with no usable message falls back to 'Only the business owner can change this.'", async () => {
    api.apiPatch.mockResolvedValue(forbidden(undefined));
    const { onBusinessHoursSaved } = renderHours();

    await saveHours();

    expect(toast.success).not.toHaveBeenCalled();
    expect(onBusinessHoursSaved).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(OWNER_ONLY_FALLBACK);
    expect(toast.error).toHaveBeenCalledWith(OWNER_ONLY_FALLBACK);
  });

  it("[R0-ID-UX-H03] control: an accepted save still reports success and no refusal", async () => {
    api.apiPatch.mockResolvedValue({ data: { id: BUSINESS }, error: null });
    const { onBusinessHoursSaved } = renderHours();

    const save = await saveHours();

    expect(toast.success).toHaveBeenCalledWith("Business hours saved");
    expect(onBusinessHoursSaved).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await waitFor(() => expect(save).toBeDisabled());
  });
});
