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
  /** What GET .../task-assignments/options answers (default OPTIONS). */
  options?: unknown[];
}

function stubApi(tasks: BoardTask[], options: StubOptions = {}) {
  const sent: Sent[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    sent.push({ method, path: pathname, body });

    if (method === "GET" && pathname === `/businesses/${BIZ}/task-assignments/options`) return jsonResponse(200, options.options ?? OPTIONS);
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

/**
 * Review SEC-W196-1 / CR-W1. A task completed by the Projects page checkbox (PATCH {isCompleted})
 * or by KEY's projects_complete_task keeps its old status (TODO, isCompleted true); reopened the
 * same way it keeps DONE. The server's reorder reads ANY status sent for such a task as a status
 * change (projects.service.ts reorderTasks: status differs, or DONE disagrees with isCompleted)
 * and sends it through updateTask: reordering other cards reopened it (or re-completed it, with
 * the evidence gate and project_task.completed) and wrote a feed row naming the member. Required:
 * a reorder never carries a status for such a task; its position, when it changes, is saved alone
 * (PATCH .../tasks/:taskId {position}), and a task whose position did not change is not written.
 */
describe("a reorder never writes the status of a task whose status and completion disagree (SEC-W196-1, CR-W1)", () => {
  /** Every request body that names a task, wherever it was sent. */
  const writesFor = (api: ReturnType<typeof stubApi>, taskId: string) =>
    api.sent.filter((r) =>
      r.method !== "GET" &&
      (r.path.includes(`/tasks/${taskId}`) ||
        JSON.stringify(r.body ?? null).includes(`"${taskId}"`)));

  it("reordering To Do does not reopen a task completed by the checkbox: it shows in Done and is not sent", async () => {
    const tasks = [
      boardTask("t_done_by_toggle", "Completed by the checkbox", "TODO", 0, { isCompleted: true }),
      boardTask("t_open_1", "Open one", "TODO", 1),
      boardTask("t_open_2", "Open two", "TODO", 2),
    ];
    const api = stubApi(tasks);
    const { container } = render(<Harness initial={projectWith(tasks)} />);
    openBoard();
    expect(column(container, "DONE")).toEqual(["Completed by the checkbox"]);
    await drop("t_open_2", "t_open_1");
    // To Do is [Open one @1, Open two @2]; after the drop Open two is first (0) and Open one keeps 1.
    expect(api.reorders().map((r) => r.body)).toEqual([{ updates: [{ taskId: "t_open_2", status: "TODO", position: 0 }] }]);
    expect(writesFor(api, "t_done_by_toggle")).toEqual([]);
    expect(api.statusWrites()).toEqual([]);
    await waitFor(() => expect(column(container, "TODO")).toEqual(["Open two", "Open one"]));
  });

  it("reordering Done saves the moved completed-by-checkbox task's position alone, never a status", async () => {
    const tasks = [
      boardTask("t_kick", "Kickoff call", "DONE", 0),
      boardTask("t_ip_done", "Completed while in progress", "IN_PROGRESS", 1, { isCompleted: true }),
    ];
    const api = stubApi(tasks);
    const { container } = render(<Harness initial={projectWith(tasks)} />);
    openBoard();
    expect(column(container, "DONE")).toEqual(["Kickoff call", "Completed while in progress"]);
    await drop("t_kick", "t_ip_done");
    expect(api.reorders().map((r) => r.body)).toEqual([{ updates: [{ taskId: "t_kick", status: "DONE", position: 1 }] }]);
    expect(writesFor(api, "t_ip_done")).toEqual([
      { method: "PATCH", path: `/projects/businesses/${BIZ}/tasks/t_ip_done`, body: { position: 0 } },
    ]);
    expect(api.statusWrites()).toEqual([]);
    await waitFor(() => expect(column(container, "DONE")).toEqual(["Completed while in progress", "Kickoff call"]));
  });

  it("a move from another column re-sends no status for the completed card it lands above", async () => {
    const tasks = [
      boardTask("t_brief", "Draft the brief", "TODO", 0),
      boardTask("t_ip_done", "Completed while in progress", "IN_PROGRESS", 0, { isCompleted: true }),
    ];
    const api = stubApi(tasks);
    render(<Harness initial={projectWith(tasks)} />);
    openBoard();
    await drop("t_brief", "t_ip_done");
    expect(api.statusWrites().map((r) => [r.path, r.body])).toEqual([
      [`/projects/businesses/${BIZ}/tasks/t_brief/status`, { status: "DONE", position: 0 }],
    ]);
    expect(api.reorders()).toEqual([]);
    expect(writesFor(api, "t_ip_done")).toEqual([
      { method: "PATCH", path: `/projects/businesses/${BIZ}/tasks/t_ip_done`, body: { position: 1 } },
    ]);
  });

  it("reordering To Do never sends DONE for a reopened task whose status was left as DONE", async () => {
    const tasks = [
      boardTask("t_reopened", "Reopened by the checkbox", "DONE", 0, { isCompleted: false }),
      boardTask("t_open", "Still open", "TODO", 1),
    ];
    const api = stubApi(tasks);
    const { container } = render(<Harness initial={projectWith(tasks)} />);
    openBoard();
    expect(column(container, "TODO")).toEqual(["Reopened by the checkbox", "Still open"]);
    await drop("t_open", "t_reopened");
    expect(api.reorders().map((r) => r.body)).toEqual([{ updates: [{ taskId: "t_open", status: "TODO", position: 0 }] }]);
    expect(writesFor(api, "t_reopened")).toEqual([
      { method: "PATCH", path: `/projects/businesses/${BIZ}/tasks/t_reopened`, body: { position: 1 } },
    ]);
    expect(JSON.stringify(api.sent.map((r) => r.body))).not.toContain('"DONE"');
  });
});

/**
 * Review SEC-W196-3: GET .../task-assignments/options names a member who has no name by their
 * email (TaskAssignmentService.getAssignableOptions), and any member may read it, including STAFF
 * refused the team list (team:none). The picker shows names only: an email-shaped name is shown
 * under a neutral label. (The server half, not falling back to the email, landed with
 * W9-PROJECTS-SERVER: see the pointer below.)
 */
describe("the assignee picker shows names, not email addresses (SEC-W196-3)", () => {
  it("a member listed by their email is offered under a neutral label", async () => {
    stubApi(TASKS, {
      options: [
        { type: "User", id: "usr_ada", name: "Ada Member" },
        { type: "User", id: "usr_noname_7f3a", name: "private.email@test.local" },
        { type: "StaffMember", id: "stf_sam", name: "Sam Staff" },
      ],
    });
    render(<Harness initial={projectWith(TASKS)} />);
    openTasks();
    const select = await screen.findByRole("combobox", { name: "Assign Draft the brief" });
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(3));
    const labels = within(select).getAllByRole("option").map((o) => o.textContent ?? "");
    expect(labels.join(" | ")).not.toMatch(/@/);
    expect(labels).toEqual(expect.arrayContaining(["Ada Member", "Sam Staff", "Unnamed member (…7f3a)"]));
  });

  // The server half (was it.todo here) is proved by W9-PROJECTS-SERVER in
  // apps/server/test/projects-budget-assignee-scope.integration.test.ts ("SEC-W196-3 (was it.todo): ..."):
  // GET /businesses/:bid/task-assignments/options no longer falls back to a member's email. A member is
  // offered by their name, else their first and last name, else "Unnamed member (…<last 4 of id>)", the
  // label this picker uses; the list stays open to every member (not gated on team:read).
});
