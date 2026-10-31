/**
 * R0-ID-WEB-AUTHORITY-UX (R0-09 review CR-1): the Message Intake switch reports
 * a refused save as a refusal and does not stay in the state the server refused.
 *
 * WHY this test exists: owner ruling D-11 (R0-09-ID-HARDEN) made
 * PATCH /identity/businesses/:businessId OWNER only, and messageIntakeEnabled is
 * written through that route. An ADMIN or STAFF who flips the switch gets 403
 * "Only the business owner can edit the business profile". apiPatch returns
 * { data: null, error, status, rawError } instead of throwing; the page flipped
 * the switch optimistically and ignored the result, so the refused member saw
 * the setting as changed (the success state) while the server kept the old one.
 *
 * Mounted on the real page; only the api module's apiGet/apiPatch are stubbed
 * (the refusal is the exact shape apiPatch produces from the production
 * GlobalHttpExceptionFilter body) and the intake queue below the switch, which
 * is not under test, is replaced by an empty component.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGet: api.apiGet, apiPatch: api.apiPatch };
});

vi.mock("../components/message-intake-queue", () => ({
  MessageIntakeQueue: () => null,
}));

import MessageIntakePage from "../page";

const BUSINESS = "biz_intake_1";
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

async function renderLoadedSwitch(): Promise<HTMLInputElement> {
  render(<MessageIntakePage />);
  const toggle = (await screen.findByRole("checkbox", { name: "Enable message intake" })) as HTMLInputElement;
  await waitFor(() => expect(toggle).not.toBeDisabled());
  return toggle;
}

describe("message intake page: a refused switch save shows the refusal and keeps the server's state", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_business_id", BUSINESS);
    api.apiGet.mockResolvedValue({ data: { id: BUSINESS, messageIntakeEnabled: false }, error: null });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("[R0-ID-UX-I01] 403 from the owner-only profile write shows the server's refusal and the switch stays off", async () => {
    api.apiPatch.mockResolvedValue(forbidden(SERVER_REFUSAL));
    const toggle = await renderLoadedSwitch();
    expect(toggle.checked).toBe(false);

    fireEvent.click(toggle);
    await waitFor(() => expect(api.apiPatch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toggle).not.toBeDisabled());

    // The refused value is not shown as the current setting.
    expect(toggle.checked).toBe(false);
    expect(await screen.findByRole("alert")).toHaveTextContent(SERVER_REFUSAL);
    expect(api.apiPatch).toHaveBeenCalledWith(`/identity/businesses/${BUSINESS}`, { messageIntakeEnabled: true });
  });

  it("[R0-ID-UX-I02] a 403 with no usable message falls back to 'Only the business owner can change this.'", async () => {
    api.apiPatch.mockResolvedValue(forbidden(undefined));
    const toggle = await renderLoadedSwitch();

    fireEvent.click(toggle);
    await waitFor(() => expect(api.apiPatch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toggle).not.toBeDisabled());

    expect(toggle.checked).toBe(false);
    expect(await screen.findByRole("alert")).toHaveTextContent(OWNER_ONLY_FALLBACK);
  });

  it("[R0-ID-UX-I03] control: an accepted save keeps the new state and shows no refusal", async () => {
    api.apiPatch.mockResolvedValue({ data: { id: BUSINESS, messageIntakeEnabled: true }, error: null });
    const toggle = await renderLoadedSwitch();

    fireEvent.click(toggle);

    await waitFor(() => expect(api.apiPatch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toggle).not.toBeDisabled());
    expect(toggle.checked).toBe(true);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
