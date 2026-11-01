/**
 * R0-09f-D11-FINANCE-TAX-AND-WEB (R0-09d review CR-1): the business templates
 * page reports a refused apply as a refusal and shows no success state.
 *
 * WHY this test exists: owner ruling D-11 made
 * POST /businesses/:businessId/templates/:templateId/apply OWNER only
 * (R0-09d-D11-GENESIS-TEMPLATES): an ADMIN or STAFF who applies a template gets
 * 403 { code: "BUSINESS_PROFILE_OWNER_ONLY", message: "Only the business owner
 * can apply a business template." }. apiPost answers a 403 with
 * { data: null, error, status, rawError } instead of throwing, and handleApply
 * read only res.data and swallowed everything else, so the refused member's
 * click ended with no message at all: the confirm box closed and the card
 * looked as if nothing had been asked.
 *
 * Mounted on the real page with the real client.ts applyTemplate and
 * fetchTemplates; only the api module's apiGet/apiPost are stubbed (the
 * refusal is the exact shape apiPost produces from the production
 * GlobalHttpExceptionFilter body).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGet: api.apiGet, apiPost: api.apiPost };
});

import TemplatesPage from "../page";

const BUSINESS = "biz_templates_1";
const TEMPLATE_ID = "tpl_salon_1";
const TEMPLATE = {
  id: TEMPLATE_ID,
  name: "salon",
  displayName: "Salon Starter",
  description: "Products, services and expense categories for a salon",
  industry: "salon",
  archetype: "LOCAL_SERVICE",
  isPublished: true,
};
const SERVER_REFUSAL = "Only the business owner can apply a business template.";
const OWNER_ONLY_FALLBACK = "Only the business owner can apply a template.";
const SUCCESS_TEXT = "Template applied successfully!";

type ApiResult = { data: unknown; error: string | null; status?: number; rawError?: Record<string, unknown> | null };

/** apiPost's result for a 403 the production filter rendered (with `message`, or with a generic one). */
function forbidden(message: string | undefined): ApiResult {
  const body: Record<string, unknown> = {
    statusCode: 403, code: "BUSINESS_PROFILE_OWNER_ONLY", error: "Forbidden",
    timestamp: "2026-11-01T00:00:00.000Z", path: `/businesses/${BUSINESS}/templates/${TEMPLATE_ID}/apply`,
  };
  if (message !== undefined) body.message = message;
  // handleErrorResponse: message, else error, else statusText.
  return { data: null, error: message ?? "Forbidden", status: 403, rawError: body };
}

/** Mount the page, open the confirm box on the one template and confirm. */
async function confirmApply() {
  render(<TemplatesPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Apply Template" }));
  fireEvent.click(screen.getByRole("button", { name: "Yes, Apply" }));
  await waitFor(() => expect(api.apiPost).toHaveBeenCalledTimes(1));
  // The apply settled: the card is back to its resting button or its success line.
  await waitFor(() => expect(screen.queryByRole("button", { name: /Applying/ })).not.toBeInTheDocument());
}

describe("templates page: a refused apply shows the refusal and no success state", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_business_id", BUSINESS);
    api.apiGet.mockResolvedValue({ data: [TEMPLATE], error: null });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("[R0-09f-W01] RED-BEFORE: 403 BUSINESS_PROFILE_OWNER_ONLY from the owner-only apply shows the server's refusal and no success state", async () => {
    api.apiPost.mockResolvedValue(forbidden(SERVER_REFUSAL));
    await confirmApply();

    expect(api.apiPost).toHaveBeenCalledWith({ path: `/businesses/${BUSINESS}/templates/${TEMPLATE_ID}/apply`, body: {} });
    expect(await screen.findByRole("alert")).toHaveTextContent(SERVER_REFUSAL);
    expect(screen.queryByText(SUCCESS_TEXT)).not.toBeInTheDocument();
  });

  it("[R0-09f-W02] RED-BEFORE: a 403 with no usable message falls back to 'Only the business owner can apply a template.'", async () => {
    api.apiPost.mockResolvedValue(forbidden(undefined));
    await confirmApply();

    expect(await screen.findByRole("alert")).toHaveTextContent(OWNER_ONLY_FALLBACK);
    expect(screen.queryByText(SUCCESS_TEXT)).not.toBeInTheDocument();
  });

  it("[R0-09f-W03] RED-BEFORE: Apply stays offered after a refusal; trying again clears the old refusal while the second apply is in flight, and a second refusal shows again", async () => {
    api.apiPost.mockResolvedValueOnce(forbidden(SERVER_REFUSAL));
    await confirmApply();
    expect(await screen.findByRole("alert")).toHaveTextContent(SERVER_REFUSAL);

    let settle: (value: ApiResult) => void = () => {};
    api.apiPost.mockImplementationOnce(() => new Promise<ApiResult>((resolve) => { settle = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Apply Template" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, Apply" }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    settle(forbidden(SERVER_REFUSAL));
    expect(await screen.findByRole("alert")).toHaveTextContent(SERVER_REFUSAL);
  });

  it("[R0-09f-W04] control: an accepted apply shows the success state and no refusal", async () => {
    api.apiPost.mockResolvedValue({ data: { success: true, templateName: TEMPLATE.displayName }, error: null });
    await confirmApply();

    expect(await screen.findByText(SUCCESS_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
