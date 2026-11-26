/**
 * CATALOG-1 web, review round 1 (orchestrator ruling on /app/templates; BUG-075, journey B7): a template applied
 * again says so. TemplatesService.applyTemplate (P78, on main) answers a repeat with
 * { success: true, templateName, alreadyApplied: true } and adds nothing; the page said "Template applied
 * successfully!" for it, as if it had added the template's products and services again.
 *
 * The harness is templates-apply-refusal.test.tsx's (the real page and client; apiGet/apiPost stubbed); that file,
 * which pins the 403 refusal text, is unchanged.
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

const ALREADY_TEXT = "Already applied — nothing new was added";

describe("templates page: a repeat apply says it added nothing", () => {
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

  it("alreadyApplied: true says 'Already applied — nothing new was added', not success, and no refusal", async () => {
    api.apiPost.mockResolvedValue({ data: { success: true, templateName: TEMPLATE.displayName, alreadyApplied: true }, error: null });
    await confirmApply();
    expect(await screen.findByText(ALREADY_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(SUCCESS_TEXT)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("control: alreadyApplied: false is the success state", async () => {
    api.apiPost.mockResolvedValue({ data: { success: true, templateName: TEMPLATE.displayName, alreadyApplied: false }, error: null });
    await confirmApply();
    expect(await screen.findByText(SUCCESS_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(ALREADY_TEXT)).not.toBeInTheDocument();
  });

  it("control: the 403 refusal text is unchanged", async () => {
    api.apiPost.mockResolvedValue(forbidden(SERVER_REFUSAL));
    await confirmApply();
    expect(await screen.findByRole("alert")).toHaveTextContent(SERVER_REFUSAL);
    expect(screen.queryByText(ALREADY_TEXT)).not.toBeInTheDocument();
  });
});
