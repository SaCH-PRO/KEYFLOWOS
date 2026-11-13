/**
 * SWEEP-P0-SCOPES review repair (finding CR-1): the project detail page, the one members use,
 * reports a refused projects write as refused.
 *
 * Every projects write now needs projects write (BUG-014). A STAFF member on role defaults holds
 * projects read, so DELETE .../projects/:id, .../tasks/:id and .../milestones/:id answer 403. The
 * api client answers a refusal as { data: null, error } and does not throw, and ProjectDetail
 * dropped the project, the task or the milestone locally whatever the server answered, and said
 * "Project deleted". The project board was fixed in the packet; this is the detail page.
 *
 * The stand-in is the network (fetch): every DELETE answers the server's 403 body.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { ProjectDetail } from "../project-detail";

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

/** The network: every DELETE is the server's projects:write refusal; reads answer empty. */
function stubRefusingDeletes(sent: string[]) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    sent.push(`${method} ${new URL(url, "http://localhost").pathname}`);
    if (method === "DELETE") return jsonResponse(403, { statusCode: 403, message: REFUSAL, error: "Forbidden" });
    if (url.includes("/expenses/")) return jsonResponse(200, { expenses: [], total: 0, count: 0 });
    return jsonResponse(200, []);
  }));
}

const PROJECT = {
  id: "p1",
  name: "Owner launch",
  status: "IN_PROGRESS",
  priority: "NORMAL",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  tasks: [{ id: "t1", projectId: "p1", title: "Owner task one", isCompleted: false, status: "TODO", position: 0, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" }],
  milestones: [{ id: "m1", title: "Owner milestone one", completedAt: null }],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

function renderDetail(onProjectUpdate = vi.fn(), onProjectDelete = vi.fn()) {
  const view = render(
    <ProjectDetail
      project={PROJECT as never}
      businessId="biz_1"
      onBack={() => {}}
      onProjectUpdate={onProjectUpdate}
      onProjectDelete={onProjectDelete}
    />,
  );
  return { ...view, onProjectUpdate, onProjectDelete };
}

describe("CR-1: ProjectDetail says a refused delete was refused", () => {
  it("[PDR-01] RED-BEFORE: a 403 on DELETE project keeps the project, shows the server's reason and claims no deletion", async () => {
    const sent: string[] = [];
    stubRefusingDeletes(sent);
    const { container, onProjectDelete } = renderDetail();
    const icon = container.querySelector('svg[class*="lucide-ellipsis"], svg[class*="lucide-more-horizontal"]');
    fireEvent.click(icon!.closest("button") as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: /delete project/i }));
    await waitFor(() => expect(sent.some((s) => s.startsWith("DELETE /projects/businesses/biz_1/projects/p1"))).toBe(true));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSAL));
    expect(onProjectDelete).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalledWith("Project deleted");
  });

  it("[PDR-02] RED-BEFORE: a 403 on DELETE task keeps the task and shows the server's reason", async () => {
    const sent: string[] = [];
    stubRefusingDeletes(sent);
    const { container, onProjectUpdate } = renderDetail();
    fireEvent.click(screen.getByRole("tab", { name: /tasks/i }));
    await waitFor(() => expect(screen.getByText("Owner task one")).toBeTruthy());
    const trash = container.querySelector('svg[class*="lucide-trash"]');
    fireEvent.click(trash!.closest("button") as HTMLElement);
    await waitFor(() => expect(sent.some((s) => s.startsWith("DELETE /projects/businesses/biz_1/tasks/t1"))).toBe(true));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSAL));
    const dropped = onProjectUpdate.mock.calls.some((call) => {
      const p = call[0] as { tasks?: Array<{ id: string }> } | undefined;
      return Array.isArray(p?.tasks) && !p.tasks.some((t) => t.id === "t1");
    });
    expect(dropped, "the task was dropped from the project").toBe(false);
  });

  it("[PDR-03] RED-BEFORE: a 403 on DELETE milestone keeps the milestone and shows the server's reason", async () => {
    const sent: string[] = [];
    stubRefusingDeletes(sent);
    const { container, onProjectUpdate } = renderDetail();
    fireEvent.click(screen.getByRole("tab", { name: /milestones/i }));
    await waitFor(() => expect(screen.getByText("Owner milestone one")).toBeTruthy());
    const trash = container.querySelector('svg[class*="lucide-trash"]');
    fireEvent.click(trash!.closest("button") as HTMLElement);
    await waitFor(() => expect(sent.some((s) => s.startsWith("DELETE /projects/businesses/biz_1/projects/p1/milestones/m1"))).toBe(true));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSAL));
    expect(screen.getByText("Owner milestone one")).toBeTruthy();
    const dropped = onProjectUpdate.mock.calls.some((call) => {
      const p = call[0] as { milestones?: Array<{ id: string }> } | undefined;
      return Array.isArray(p?.milestones) && !p.milestones.some((m) => m.id === "m1");
    });
    expect(dropped, "the milestone was dropped from the project").toBe(false);
  });
});
