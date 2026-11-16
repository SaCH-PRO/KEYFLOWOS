/**
 * SWEEP-P0-SCOPES review repair (finding CR-4): two profile surfaces whose writes the packet put
 * behind a module write now say when the server refused them.
 *
 *   - Business builder > intelligence actions > "Create task" posts a project task, which needs
 *     projects write. A STAFF member on role defaults (projects read) got 403, the answer was not
 *     read, and the "Task created" badge rendered.
 *   - Growth trajectory > "Run Assessment" posts a maturity assessment, insights and a revenue
 *     projection, each analytics write now. The answers were not read: a refusal reloaded the
 *     panel with nothing said.
 *
 * The api client answers a refusal as { data: null, error } and does not throw; the stand-ins are
 * the api client modules.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const PROJECTS_REFUSAL = "Insufficient permissions: projects requires write access (you have read)";
const ANALYTICS_REFUSAL = "Insufficient permissions: analytics requires write access (you have read)";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/profile",
  useSearchParams: () => new URLSearchParams(),
}));
const api = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiPostSimple: vi.fn(),
  apiPut: vi.fn(),
}));
vi.mock("@/lib/api", () => api);
const client = vi.hoisted(() => ({
  fetchAnalyticsOverview: vi.fn(),
  fetchAnalyticsSnapshots: vi.fn(),
  fetchLatestMaturity: vi.fn(),
  fetchProjections: vi.fn(),
  fetchInsights: vi.fn(),
  assessMaturity: vi.fn(),
  generateInsights: vi.fn(),
  generateRevenueProjection: vi.fn(),
  dismissInsight: vi.fn(),
}));
vi.mock("@/lib/client", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), ...client }));

import { ActionsView } from "../business-builder-card";
import { GrowthTrajectoryPanel } from "../growth-trajectory-panel";

const ACTION = {
  action: "Owner follow-up plan",
  details: "Call the top ten clients",
  category: "Sales",
  timeframe: "This week",
  priority: "HIGH",
  requiresExternal: false,
} as never;

beforeEach(() => {
  for (const fn of [...Object.values(api), ...Object.values(client)]) fn.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  for (const fn of [client.fetchAnalyticsOverview, client.fetchLatestMaturity]) fn.mockResolvedValue({ data: null, error: null });
  for (const fn of [client.fetchAnalyticsSnapshots]) fn.mockResolvedValue({ data: [], error: null });
  client.fetchProjections.mockResolvedValue({ data: {}, error: null });
  client.fetchInsights.mockResolvedValue({ data: { items: [], total: 0 }, error: null });
});
afterEach(() => cleanup());

describe("business builder: a refused task create is not shown as created (CR-4)", () => {
  it("[WEB-PRF-01] RED-BEFORE: a 403 on the task POST shows the server's reason and no 'Task created' badge", async () => {
    api.apiGet.mockResolvedValue({ data: [{ id: "proj_1" }], error: null });
    api.apiPost.mockResolvedValue({ data: null, error: PROJECTS_REFUSAL, status: 403 });
    render(<ActionsView actions={[ACTION]} businessId="biz_1" />);
    fireEvent.click(screen.getByRole("button", { name: /create task/i }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith(expect.objectContaining({ path: "/projects/businesses/biz_1/projects/proj_1/tasks" })));
    await waitFor(() => expect(screen.getByText(PROJECTS_REFUSAL)).toBeInTheDocument());
    expect(screen.queryByText("Task created")).toBeNull();
  });

  it("[WEB-PRF-02] a task the server creates shows the badge", async () => {
    api.apiGet.mockResolvedValue({ data: [{ id: "proj_1" }], error: null });
    api.apiPost.mockResolvedValue({ data: { id: "task_1" }, error: null });
    render(<ActionsView actions={[ACTION]} businessId="biz_1" />);
    fireEvent.click(screen.getByRole("button", { name: /create task/i }));
    await waitFor(() => expect(screen.getByText("Task created")).toBeInTheDocument());
  });
});

describe("growth trajectory: a refused assessment says so (CR-4)", () => {
  it("[WEB-PRF-03] RED-BEFORE: a 403 on the maturity assessment shows the server's reason and stops there", async () => {
    client.assessMaturity.mockResolvedValue({ data: null, error: ANALYTICS_REFUSAL, status: 403 });
    client.generateInsights.mockResolvedValue({ data: null, error: ANALYTICS_REFUSAL, status: 403 });
    client.generateRevenueProjection.mockResolvedValue({ data: null, error: ANALYTICS_REFUSAL, status: 403 });
    render(<GrowthTrajectoryPanel businessId="biz_1" />);
    fireEvent.click(await screen.findByRole("button", { name: /run assessment/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(ANALYTICS_REFUSAL));
    expect(client.generateInsights).not.toHaveBeenCalled();
    expect(client.generateRevenueProjection).not.toHaveBeenCalled();
  });
});
