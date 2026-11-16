/**
 * SWEEP-P0-SCOPES second review repair (finding CRV-2, minor): a plan the server refuses to generate
 * says why.
 *
 * POST .../plans (generate a plan) now needs projects write (membership-only at base). The hook
 * (useProjectPlans.createPlan) records the refusal as its `error`, but PlanGenerator never showed it:
 * a member with projects read clicked "Generate Plan with Key" and nothing happened.
 *
 * Required: a refused generate shows the server's refusal beside the form and keeps the idea typed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { PlanGenerator } from "../plan-generator";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/projects",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }),
  Toaster: () => null,
}));

const REFUSAL = "Insufficient permissions: projects requires write access (you have read)";

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("plan generator: refused generate", () => {
  it("[WEB-PLAN-GEN-01] RED-BEFORE: a refused generate shows the server's refusal and keeps the idea typed", async () => {
    const sent: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      sent.push(`${method} ${new URL(url, "http://localhost").pathname}`);
      if (method !== "GET") return jsonResponse(403, { statusCode: 403, message: REFUSAL, error: "Forbidden" });
      return jsonResponse(200, []);
    }));
    render(<PlanGenerator businessId="biz_1" goals={[]} />);
    const idea = screen.getByPlaceholderText(/launch a new service package/i);
    fireEvent.change(idea, { target: { value: "Open a second shop" } });
    fireEvent.click(screen.getByRole("button", { name: /generate plan with key/i }));
    await waitFor(() => expect(sent).toContain("POST /projects/businesses/biz_1/plans"));
    const alert = await screen.findByText(REFUSAL);
    expect(alert.closest("[role='alert']")).not.toBeNull();
    expect(screen.getByPlaceholderText(/launch a new service package/i)).toHaveValue("Open a second shop");
  });
});
