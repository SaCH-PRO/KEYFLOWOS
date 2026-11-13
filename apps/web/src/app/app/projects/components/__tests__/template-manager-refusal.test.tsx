/**
 * SWEEP-P0-SCOPES second review repair (findings CRV-1, major, and CRV-2, minor): the project
 * template manager never shows a template write the server refused as done.
 *
 * This packet gated the template writes to projects write (ProjectsController: deleteTemplate,
 * createTemplate, createFromTemplate; membership-only at base). A member with projects read (STAFF on
 * role defaults) gets 403 "Insufficient permissions: projects requires write access (you have read)".
 * The api client answers a refusal as { data: null, error } and does not throw, so:
 *   - CRV-1: handleDelete awaited the delete, ignored the answer, dropped the template and said
 *     "Template deleted" (it came back on reload);
 *   - CRV-2: create and "Use Template" acted only on res.data and said nothing.
 *
 * Required: a refused write shows the server's refusal, says no success, keeps the list (and an open
 * create form) as it was; a delete the server applies still removes the template and says so.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { toast } from "sonner";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }),
  Toaster: () => null,
}));

const REFUSAL = "Insufficient permissions: projects requires write access (you have read)";
const TEMPLATE = { id: "t1", name: "Owner template", taskTitles: ["Kickoff"] };

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 400 ? "Forbidden" : "OK",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => JSON.parse(text),
    text: async () => text,
    clone() { return jsonResponse(status, body); },
  } as unknown as Response;
}

function stub(sent: string[], write: { status: number; body: unknown } = { status: 403, body: { statusCode: 403, message: REFUSAL, error: "Forbidden" } }) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    sent.push(`${method} ${new URL(url, "http://localhost").pathname}`);
    if (method !== "GET") return jsonResponse(write.status, write.body);
    return jsonResponse(200, [TEMPLATE]);
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

async function renderManager() {
  const { TemplateManager } = await import("../template-manager");
  const onProjectCreated = vi.fn();
  const utils = render(<TemplateManager businessId="biz_1" onProjectCreated={onProjectCreated} />);
  await screen.findByText("Owner template");
  return { ...utils, onProjectCreated };
}

/** The template card's delete button (the one beside "Use Template"). */
function deleteButton(): HTMLButtonElement {
  const card = screen.getByText("Use Template").parentElement!;
  return card.querySelectorAll("button")[1] as HTMLButtonElement;
}

describe("project templates: refused writes", () => {
  it("[WEB-TPL-01] RED-BEFORE (CRV-1): a refused delete shows the server's refusal, keeps the template and never says 'Template deleted'", async () => {
    const sent: string[] = [];
    stub(sent);
    await renderManager();
    fireEvent.click(deleteButton());
    await waitFor(() => expect(sent).toContain("DELETE /projects/businesses/biz_1/templates/t1"));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(REFUSAL));
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    expect(screen.getByText("Owner template")).toBeInTheDocument();
  });

  it("[WEB-TPL-02] RED-BEFORE (CRV-2): a refused create shows the server's refusal and keeps the form open with what was typed", async () => {
    const sent: string[] = [];
    stub(sent);
    await renderManager();
    fireEvent.click(screen.getByRole("button", { name: /new template/i }));
    fireEvent.change(screen.getByPlaceholderText("Template name"), { target: { value: "Staff template" } });
    fireEvent.change(screen.getByPlaceholderText("Add a task and press Enter"), { target: { value: "Step one" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: /save template/i }));
    await waitFor(() => expect(sent.some((s) => s.startsWith("POST"))).toBe(true));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(REFUSAL));
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("Template name")).toHaveValue("Staff template");
  });

  it("[WEB-TPL-03] RED-BEFORE (CRV-2): a refused 'Use Template' shows the server's refusal and reports no project", async () => {
    const sent: string[] = [];
    stub(sent);
    const { onProjectCreated } = await renderManager();
    fireEvent.click(screen.getByText("Use Template"));
    await waitFor(() => expect(sent.some((s) => s.startsWith("POST"))).toBe(true));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(REFUSAL));
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    expect(onProjectCreated).not.toHaveBeenCalled();
  });

  it("[WEB-TPL-04] a delete the server applies removes the template and says so", async () => {
    const sent: string[] = [];
    stub(sent, { status: 200, body: { success: true } });
    await renderManager();
    fireEvent.click(deleteButton());
    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Template deleted"));
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText("Owner template")).toBeNull());
  });
});
