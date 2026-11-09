/**
 * PR196-PROJECTS-WEB (F10c; WPD-17, WPD-18): the Projects intelligence panel
 * shows only what the projects the page already loaded say.
 *
 * WHY: on our tree ProjectIntelligencePanel rendered hard-coded demo data
 * ("Sarah Chen", "Mike Ross", "Project Alpha", "12" active projects with
 * "+2 this week") and the page mounted it with no props. PR #196 replaced the
 * arrays with figures from the projects, but kept a weekly trend it never
 * computed (each metric's "change" was the count itself, rendered as
 * "+N this week", WPD-17), and a team load that assumed 6 open tasks = 100%
 * over booking staff only (WPD-18). Placeholder numbers wearing the costume of
 * real data are what no-fabricated-screens.spec.ts forbids.
 *
 * Required: metrics, insights and the open-task count per assignee come from the
 * projects passed in; no "this week" deltas; no load percentage the data does
 * not support; members and booking staff both count (D-87); an empty state
 * when there is nothing to show; the page hands the panel its projects.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import { ProjectIntelligencePanel } from "../project-intelligence-panel";
import type { Project, ProjectTask } from "@/lib/client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/projects",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

const BIZ = "biz_wpd17";
const DEMO_NAMES = ["Sarah Chen", "Mike Ross", "Emma Davis", "James Wilson", "Project Alpha", "Website Redesign", "Q2 Campaign", "Content Migration"];

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString();
};

function t(id: string, extra: Partial<ProjectTask> = {}): ProjectTask {
  return { id, title: `Task ${id}`, isCompleted: false, priority: "NORMAL", sortOrder: 0, ...extra };
}

function project(id: string, name: string, status: string, tasks: ProjectTask[], extra: Partial<Project> = {}): Project {
  return { id, name, status, priority: "NORMAL", createdAt: day(-30), updatedAt: day(-1), tasks, ...extra };
}

const PROJECTS: Project[] = [
  // Active, healthy: one task for a member, one for booking staff.
  project("p_ok", "Brand refresh", "IN_PROGRESS", [t("a1", { assigneeId: "usr_ada" }), t("a2", { assigneeId: "stf_sam" })], { dueDate: day(30) }),
  // Active, at risk: an overdue task, unassigned.
  project("p_late", "Store launch", "IN_PROGRESS", [t("b1", { dueDate: day(-3) }), t("b2", { assigneeId: "usr_ada" })]),
  // Completed.
  project("p_done", "Old campaign", "COMPLETED", [t("c1", { isCompleted: true, assigneeId: "usr_ada" })]),
];

const OPTIONS = [
  { type: "User", id: "usr_ada", name: "Ada Member" },
  { type: "StaffMember", id: "stf_sam", name: "Sam Staff" },
  { type: "KEY", id: "key_ai", name: "KEY AI Assistant" },
];

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
    clone() { return jsonResponse(status, body); },
  } as unknown as Response;
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("kf_token", "tok_wpd17");
  window.localStorage.setItem("kf_business_id", BIZ);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    if (pathname === `/businesses/${BIZ}/task-assignments/options`) return jsonResponse(200, OPTIONS);
    return jsonResponse(200, []);
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A metric tile's value, by its label. */
function metric(label: string): string {
  const tile = screen.getByText(label).closest("[data-metric]") as HTMLElement | null;
  if (!tile) throw new Error(`no metric ${label}`);
  return tile.querySelector("[data-metric-value]")?.textContent ?? "";
}

describe("no demo data and no invented trend (WPD-17)", () => {
  it("shows none of the demo names or projects", () => {
    const { container } = render(<ProjectIntelligencePanel projects={PROJECTS} businessId={BIZ} />);
    for (const name of DEMO_NAMES) expect(container.textContent, name).not.toContain(name);
  });

  it("shows no 'this week' change: nothing computes one", () => {
    const { container } = render(<ProjectIntelligencePanel projects={PROJECTS} businessId={BIZ} />);
    expect(container.textContent).not.toMatch(/this week/i);
  });
});

describe("metrics and insights come from the projects passed in", () => {
  it("counts active, on-track, at-risk and completed projects", () => {
    render(<ProjectIntelligencePanel projects={PROJECTS} businessId={BIZ} />);
    expect(metric("Active Projects")).toBe("2");
    expect(metric("On Track")).toBe("1");
    expect(metric("At Risk")).toBe("1");
    expect(metric("Completed")).toBe("1");
  });

  it("names the project with overdue work", () => {
    render(<ProjectIntelligencePanel projects={PROJECTS} businessId={BIZ} />);
    expect(screen.getAllByText(/Store launch/).length).toBeGreaterThan(0);
  });
});

describe("open tasks per assignee, members and booking staff alike (WPD-18, D-87)", () => {
  it("counts each assignee's open tasks in active projects, with no capacity percentage", async () => {
    render(<ProjectIntelligencePanel projects={PROJECTS} businessId={BIZ} />);
    const team = screen.getByRole("region", { name: /open tasks by assignee/i });
    await waitFor(() => expect(within(team).getByText("Ada Member")).toBeInTheDocument());
    const row = (name: string) => within(team).getByText(name).closest("[data-assignee]") as HTMLElement;
    expect(row("Ada Member").textContent).toMatch(/2 open tasks?/);
    expect(row("Sam Staff").textContent).toMatch(/1 open task/);
    expect(row("Unassigned").textContent).toMatch(/1 open task/);
    expect(team.textContent).not.toMatch(/%/);
  });
});

describe("empty states", () => {
  it("no projects: an empty state, no metrics", () => {
    const { container } = render(<ProjectIntelligencePanel projects={[]} businessId={BIZ} />);
    expect(screen.getByText(/no projects/i)).toBeInTheDocument();
    expect(container.querySelector("[data-metric]")).toBeNull();
  });

  it("projects not loaded: an empty state, no metrics", () => {
    const { container } = render(<ProjectIntelligencePanel projects={undefined} businessId={BIZ} />);
    expect(screen.getByText(/no projects/i)).toBeInTheDocument();
    expect(container.querySelector("[data-metric]")).toBeNull();
  });

  it("projects with no open tasks: the assignee section says so", () => {
    render(<ProjectIntelligencePanel projects={[PROJECTS[2]]} businessId={BIZ} />);
    const team = screen.getByRole("region", { name: /open tasks by assignee/i });
    expect(within(team).getByText(/no open tasks/i)).toBeInTheDocument();
  });
});

describe("the Projects page hands the panel the projects it loaded", () => {
  it("page.tsx mounts <ProjectIntelligencePanel projects={projects} ...>", () => {
    const page = fs.readFileSync(path.join(__dirname, "..", "..", "page.tsx"), "utf8");
    expect(page).toMatch(/<ProjectIntelligencePanel\s+[^>]*projects=\{projects\}/);
  });
});
