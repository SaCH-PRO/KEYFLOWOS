/**
 * PR196-PROJECTS-WEB (F7c, F10a): the project Tasks tab has a working Kanban
 * and an assignee picker that offers the people a task may be given to.
 *
 * WHY:
 *   F7c / WPD-05..07  TaskKanban was orphaned on our tree; PR #196 mounted it in
 *           the Tasks tab, but its columns were not drop targets (a status move
 *           never reached the status callback), it read sortOrder while the
 *           server orders the board by position, it never saved a column
 *           reorder, and it kept a failed move. The server door for a status
 *           change is PATCH .../tasks/:taskId/status (PR196-PROJECTS-SERVER:
 *           updateTask's evidence gate, completion event and actor); a column
 *           reorder is POST .../projects/:projectId/tasks/reorder.
 *   F10a / WPD-10  PR #196's picker listed only booking StaffMembers (fetchStaff).
 *           D-87: a project task's assignee may be a member of the business or
 *           one of its booking staff. A task given to a member showed as
 *           "Unassigned" (no option matched), and editing the row could
 *           silently overwrite the assignment.
 *
 * Rendered for real: ProjectDetail -> TasksTab -> TaskKanban on lib/client.ts
 * and lib/api.ts. Only `fetch`, the router and the toaster are stubbed; the
 * stub answers as PR196-PROJECTS-SERVER does. The drop itself is driven through
 * DndContext's onDragEnd (jsdom has no layout for dnd-kit's sensors).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useState } from "react";
import { render, screen, cleanup, act, fireEvent, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { ProjectDetail } from "../../project-detail";
import type { Project, ProjectTask } from "@/lib/client";

const dnd = vi.hoisted(() => ({ onDragEnd: null as null | ((event: unknown) => unknown) }));

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (props: Parameters<typeof actual.DndContext>[0]) => {
      dnd.onDragEnd = (props.onDragEnd as unknown as (event: unknown) => unknown) ?? null;
      return createElement(actual.DndContext, props);
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/projects",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));

const BIZ = "biz_wpd05";
const PROJECT = "proj_wpd05";

type BoardTask = ProjectTask & { status: string; position: number };

function boardTask(id: string, title: string, status: string, position: number, extra: Partial<BoardTask> = {}): BoardTask {
  return {
    id,
    title,
    isCompleted: status === "DONE",
    priority: "NORMAL",
    sortOrder: 0,
    status,
    position,
    trackedHours: 0,
    ...extra,
  };
}

function projectWith(tasks: BoardTask[]): Project {
  return {
    id: PROJECT,
    name: "Website relaunch",
    status: "IN_PROGRESS",
    priority: "NORMAL",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    tasks,
    milestones: [],
  };
}

/** What GET /businesses/:bid/task-assignments/options answers: members, booking staff and KEY. */
const OPTIONS = [
  { type: "User", id: "usr_ada", name: "Ada Member" },
  { type: "StaffMember", id: "stf_sam", name: "Sam Staff" },
  { type: "KEY", id: "key_ai", name: "KEY AI Assistant" },
];

interface Sent { method: string; path: string; body: unknown }

function jsonResponse(status: number, body: unknown, statusText = "OK"): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
    clone() { return jsonResponse(status, body, statusText); },
  } as unknown as Response;
}

interface StubOptions {
  /** How PATCH .../tasks/:taskId/status answers (default: the task as moved). */
  status?: (taskId: string, body: { status: string; position?: number }) => { status: number; body: unknown };
  /** How POST .../tasks/reorder answers (default 201). */
  reorder?: () => { status: number; body: unknown };
}

function stubApi(tasks: BoardTask[], options: StubOptions = {}) {
  const sent: Sent[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    sent.push({ method, path: pathname, body });

    if (method === "GET" && pathname === `/businesses/${BIZ}/task-assignments/options`) return jsonResponse(200, OPTIONS);
    const statusMatch = pathname.match(new RegExp(`^/projects/businesses/${BIZ}/tasks/([^/]+)/status$`));
    if (method === "PATCH" && statusMatch) {
      const b = body as { status: string; position?: number };
      const answer = options.status?.(statusMatch[1], b);
      if (answer) return jsonResponse(answer.status, answer.body, answer.status >= 400 ? "Bad Request" : "OK");
      const t = tasks.find((x) => x.id === statusMatch[1])!;
      return jsonResponse(200, { ...t, status: b.status, position: b.position ?? t.position, isCompleted: b.status === "DONE" });
    }
    if (method === "POST" && pathname === `/projects/businesses/${BIZ}/projects/${PROJECT}/tasks/reorder`) {
      const answer = options.reorder?.() ?? { status: 201, body: [] };
      return jsonResponse(answer.status, answer.body, answer.status >= 400 ? "Bad Request" : "Created");
    }
    const taskMatch = pathname.match(new RegExp(`^/projects/businesses/${BIZ}/tasks/([^/]+)$`));
    if (method === "PATCH" && taskMatch) {
      const t = tasks.find((x) => x.id === taskMatch[1])!;
      return jsonResponse(200, { ...t, ...(body as object) });
    }
    if (method === "POST" && pathname === `/projects/businesses/${BIZ}/projects/${PROJECT}/tasks`) {
      const b = body as { title: string; assigneeId?: string };
      return jsonResponse(201, boardTask("t_new", b.title, "TODO", 9, { assigneeId: b.assigneeId }));
    }
    if (pathname.includes("/expenses/")) return jsonResponse(200, { expenses: [], total: 0, count: 0 });
    return jsonResponse(200, []);
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    sent,
    statusWrites: () => sent.filter((r) => r.method === "PATCH" && r.path.endsWith("/status")),
    reorders: () => sent.filter((r) => r.method === "POST" && r.path.endsWith("/tasks/reorder")),
    taskPatches: () => sent.filter((r) => r.method === "PATCH" && /\/tasks\/[^/]+$/.test(r.path)),
    creates: () => sent.filter((r) => r.method === "POST" && r.path.endsWith(`/projects/${PROJECT}/tasks`)),
  };
}

function Harness({ initial }: { initial: Project }) {
  const [project, setProject] = useState(initial);
  return (
    <ProjectDetail project={project} businessId={BIZ} onBack={() => {}} onProjectUpdate={setProject} onProjectDelete={() => {}} />
  );
}

function openTasks() {
  fireEvent.click(screen.getByRole("tab", { name: /Tasks/ }));
}

function openBoard() {
  openTasks();
  fireEvent.click(screen.getByRole("button", { name: /kanban/i }));
}

function column(container: HTMLElement, status: string): string[] {
  const el = container.querySelector(`[data-column="${status}"]`) as HTMLElement | null;
  if (!el) throw new Error(`no column ${status}`);
  return [...el.querySelectorAll(".text-sm.font-medium")].map((n) => n.textContent ?? "");
}

async function drop(activeId: string, overId: string) {
  if (!dnd.onDragEnd) throw new Error("the Kanban is not rendered");
  const handler = dnd.onDragEnd;
  await act(async () => {
    await handler({ active: { id: activeId }, over: { id: overId } });
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const TASKS = [
  boardTask("t_brief", "Draft the brief", "TODO", 0),
  boardTask("t_assets", "Collect assets", "TODO", 1),
  boardTask("t_kick", "Kickoff call", "DONE", 0),
];

beforeEach(() => {
  dnd.onDragEnd = null;
  window.localStorage.clear();
  window.localStorage.setItem("kf_token", "tok_wpd05");
  window.localStorage.setItem("kf_business_id", BIZ);
  vi.mocked(toast.error).mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Kanban in the Tasks tab: a cross-column drop goes through the status door (WPD-05)", () => {
  it("dropping a TODO task on the Done column sends PATCH .../tasks/:taskId/status and moves the card", async () => {
    const api = stubApi(TASKS);
    const { container } = render(<Harness initial={projectWith(TASKS)} />);
    openBoard();
    await drop("t_brief", "DONE");
    expect(api.statusWrites()).toEqual([
      { method: "PATCH", path: `/projects/businesses/${BIZ}/tasks/t_brief/status`, body: { status: "DONE", position: 1 } },
    ]);
    expect(api.reorders()).toEqual([]);
    expect(column(container, "DONE")).toContain("Draft the brief");
    expect(column(container, "TODO")).toEqual(["Collect assets"]);
  });

  it("a refused move (400 evidence required) puts the card back and says why (WPD-07)", async () => {
    stubApi(TASKS, {
      status: () => ({ status: 400, body: { statusCode: 400, message: "This task requires evidence before it can be completed" } }),
    });
    const { container } = render(<Harness initial={projectWith(TASKS)} />);
    openBoard();
    await drop("t_brief", "DONE");
    await waitFor(() => expect(column(container, "TODO")).toEqual(["Draft the brief", "Collect assets"]));
    expect(column(container, "DONE")).toEqual(["Kickoff call"]);
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(expect.stringMatching(/requires evidence/));
  });
});

describe("Kanban order is the server's position (WPD-06)", () => {
  it("reads position, not sortOrder", () => {
    stubApi(TASKS);
    const tasks = [
      boardTask("t_one", "Goes second", "TODO", 1, { sortOrder: 0 }),
      boardTask("t_two", "Goes first", "TODO", 0, { sortOrder: 1 }),
    ];
    const { container } = render(<Harness initial={projectWith(tasks)} />);
    openBoard();
    expect(column(container, "TODO")).toEqual(["Goes first", "Goes second"]);
  });

  it("a reorder inside a column is saved through POST .../tasks/reorder with every task's position", async () => {
    const api = stubApi(TASKS);
    render(<Harness initial={projectWith(TASKS)} />);
    openBoard();
    await drop("t_assets", "t_brief");
    expect(api.reorders()).toEqual([
      {
        method: "POST",
        path: `/projects/businesses/${BIZ}/projects/${PROJECT}/tasks/reorder`,
        body: { updates: [{ taskId: "t_assets", status: "TODO", position: 0 }, { taskId: "t_brief", status: "TODO", position: 1 }] },
      },
    ]);
    expect(api.statusWrites()).toEqual([]);
  });

  it("a refused reorder puts the column back", async () => {
    stubApi(TASKS, { reorder: () => ({ status: 400, body: { statusCode: 400, message: "Some tasks do not belong to this project" } }) });
    const { container } = render(<Harness initial={projectWith(TASKS)} />);
    openBoard();
    await drop("t_assets", "t_brief");
    await waitFor(() => expect(column(container, "TODO")).toEqual(["Draft the brief", "Collect assets"]));
    expect(vi.mocked(toast.error)).toHaveBeenCalled();
  });
});

describe("the assignee picker offers members and booking staff (WPD-10, D-87)", () => {
  const ASSIGNED = [
    boardTask("t_brief", "Draft the brief", "TODO", 0),
    boardTask("t_member", "Member's task", "TODO", 1, { assigneeId: "usr_ada" }),
    boardTask("t_gone", "Former assignee's task", "TODO", 2, { assigneeId: "usr_unlisted" }),
  ];

  it("each row offers Unassigned, the business's members and its booking staff, and not KEY", async () => {
    stubApi(ASSIGNED);
    render(<Harness initial={projectWith(ASSIGNED)} />);
    openTasks();
    const select = await screen.findByRole("combobox", { name: "Assign Draft the brief" });
    await waitFor(() => expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(
      expect.arrayContaining(["Unassigned", "Ada Member", "Sam Staff"]),
    ));
    expect(within(select).queryByRole("option", { name: /KEY/ })).toBeNull();
  });

  it("a task given to a member shows that member, not 'Unassigned'", async () => {
    stubApi(ASSIGNED);
    render(<Harness initial={projectWith(ASSIGNED)} />);
    openTasks();
    const select = (await screen.findByRole("combobox", { name: "Assign Member's task" })) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("usr_ada"));
    expect(select.selectedOptions[0].textContent).toBe("Ada Member");
  });

  it("a task given to someone the list does not name keeps that assignment instead of reading 'Unassigned'", async () => {
    stubApi(ASSIGNED);
    render(<Harness initial={projectWith(ASSIGNED)} />);
    openTasks();
    const select = (await screen.findByRole("combobox", { name: "Assign Former assignee's task" })) as HTMLSelectElement;
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(2));
    expect(select.value).toBe("usr_unlisted");
    expect(select.selectedOptions[0].textContent).not.toBe("Unassigned");
  });

  it("choosing a booking staff member sends PATCH .../tasks/:taskId {assigneeId}; Unassigned sends null", async () => {
    const api = stubApi(ASSIGNED);
    render(<Harness initial={projectWith(ASSIGNED)} />);
    openTasks();
    const select = await screen.findByRole("combobox", { name: "Assign Draft the brief" });
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(2));
    fireEvent.change(select, { target: { value: "stf_sam" } });
    await waitFor(() => expect(api.taskPatches()).toEqual([
      { method: "PATCH", path: `/projects/businesses/${BIZ}/tasks/t_brief`, body: { assigneeId: "stf_sam" } },
    ]));
    const member = await screen.findByRole("combobox", { name: "Assign Member's task" });
    fireEvent.change(member, { target: { value: "" } });
    await waitFor(() => expect(api.taskPatches().at(-1)).toEqual(
      { method: "PATCH", path: `/projects/businesses/${BIZ}/tasks/t_member`, body: { assigneeId: null } },
    ));
  });

  it("a new task can be created for a member: POST .../tasks carries assigneeId", async () => {
    const api = stubApi(ASSIGNED);
    render(<Harness initial={projectWith(ASSIGNED)} />);
    openTasks();
    const picker = await screen.findByRole("combobox", { name: "Assign new task" });
    await waitFor(() => expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual(
      expect.arrayContaining(["Ada Member", "Sam Staff"]),
    ));
    fireEvent.change(picker, { target: { value: "usr_ada" } });
    fireEvent.change(screen.getByPlaceholderText("Add a new task..."), { target: { value: "Write the copy" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    await waitFor(() => expect(api.creates()).toHaveLength(1));
    expect(api.creates()[0].body).toMatchObject({ title: "Write the copy", assigneeId: "usr_ada" });
  });
});

describe("the board follows the project's tasks (WPD-07)", () => {
  it("a task added from the add bar while the board is open appears on the board", async () => {
    stubApi(TASKS);
    const { container } = render(<Harness initial={projectWith(TASKS)} />);
    openBoard();
    fireEvent.change(screen.getByPlaceholderText("Add a new task..."), { target: { value: "Write the copy" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    await waitFor(() => expect(column(container, "TODO")).toContain("Write the copy"));
  });
});
