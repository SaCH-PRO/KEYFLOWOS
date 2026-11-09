/**
 * PR196-PROJECTS-WEB (WPD-05, WPD-06, WPD-07): the task Kanban moves a task to
 * another column through the status callback, keeps column order, follows its
 * tasks and rolls a refused move back.
 *
 * WHY (verified against PR #196's task-kanban.tsx, which is ours unchanged):
 *   WPD-05  No column registered with useDroppable: each column was a plain div
 *           inside its SortableContext. With closestCorners, `over` could only
 *           be a task card, so `COLUMNS.find(c => c.id === overId)` never
 *           matched, and a drop on a card in another column hit
 *           `if (overTask.status !== activeTask.status) return`. A task could
 *           not change column; the status callback was dead for status moves.
 *   WPD-06  A reorder inside a column sent only the dragged task's index; its
 *           siblings' positions were never written, so the order reverted on
 *           reload.
 *   WPD-07  useState(tasks) was never resynced from props (a task added from
 *           the add bar never appeared), and the local move stayed when the
 *           write failed.
 *
 * Required: every column is a drop target; a drop on a column or on a card of
 * another column calls onUpdate(taskId, newStatus, position); a reorder inside a
 * column calls onReorder with every task of the column and its new position;
 * a refused write (false or a rejection) puts the board back; a new task list
 * from the parent shows at once.
 *
 * dnd-kit's pointer and keyboard sensors measure layout, which jsdom does not
 * do, so the drag itself is driven through DndContext's onDragEnd with the
 * {active, over} dnd-kit reports for each drop; the drop-target registrations
 * are observed on useDroppable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { render, screen, cleanup, act, within } from "@testing-library/react";
import { TaskKanban } from "../task-kanban";

type DragEndHandler = (event: { active: { id: string }; over: { id: string } | null }) => void | Promise<void>;

const dnd = vi.hoisted(() => ({
  onDragEnd: null as null | ((event: unknown) => unknown),
  droppables: [] as string[],
}));

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (props: Parameters<typeof actual.DndContext>[0]) => {
      dnd.onDragEnd = (props.onDragEnd as unknown as (event: unknown) => unknown) ?? null;
      return createElement(actual.DndContext, props);
    },
    useDroppable: (args: Parameters<typeof actual.useDroppable>[0]) => {
      dnd.droppables.push(String(args.id));
      return actual.useDroppable(args);
    },
  };
});

const COLUMN_IDS = ["TODO", "IN_PROGRESS", "REVIEW", "DONE", "BLOCKED"];

function task(id: string, status: string, position: number, title = `Task ${id}`) {
  return {
    id,
    title,
    description: null,
    status,
    position,
    priority: "NORMAL",
    dueDate: null,
    assigneeId: null,
    estimatedHours: null,
    trackedHours: 0,
  };
}

const TASKS = [
  task("t_a", "TODO", 0, "Draft the brief"),
  task("t_b", "TODO", 1, "Collect assets"),
  task("t_c", "TODO", 2, "Book the shoot"),
  task("t_d", "DONE", 0, "Kickoff call"),
];

/** Titles in a column, top to bottom. */
function column(container: HTMLElement, status: string): string[] {
  const el = container.querySelector(`[data-column="${status}"]`) as HTMLElement | null;
  if (!el) throw new Error(`no column ${status}`);
  return [...el.querySelectorAll(".text-sm.font-medium")].map((n) => n.textContent ?? "");
}

async function drop(activeId: string, overId: string | null) {
  if (!dnd.onDragEnd) throw new Error("DndContext not rendered");
  const handler = dnd.onDragEnd as unknown as DragEndHandler;
  await act(async () => {
    await handler({ active: { id: activeId }, over: overId === null ? null : { id: overId } });
  });
  // Let a pending write settle and the board re-render.
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  dnd.onDragEnd = null;
  dnd.droppables = [];
});

afterEach(cleanup);

describe("columns are drop targets (WPD-05)", () => {
  it("each of the five columns registers with useDroppable under its status", () => {
    render(<TaskKanban tasks={TASKS} onUpdate={vi.fn()} onReorder={vi.fn()} />);
    for (const id of COLUMN_IDS) expect(dnd.droppables, `column ${id}`).toContain(id);
  });
});

describe("a cross-column drop reaches the status callback (WPD-05)", () => {
  it("a drop on another column's card moves the task there and calls onUpdate with that status", async () => {
    const onUpdate = vi.fn(async () => true);
    const { container } = render(<TaskKanban tasks={TASKS} onUpdate={onUpdate} onReorder={vi.fn()} />);
    await drop("t_b", "t_d");
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0]).toEqual(["t_b", "DONE", 0]);
    expect(column(container, "DONE")).toContain("Collect assets");
    expect(column(container, "TODO")).not.toContain("Collect assets");
  });

  it("a drop on an empty column appends the task there", async () => {
    const onUpdate = vi.fn(async () => true);
    const { container } = render(<TaskKanban tasks={TASKS} onUpdate={onUpdate} onReorder={vi.fn()} />);
    await drop("t_a", "REVIEW");
    expect(onUpdate.mock.calls[0]).toEqual(["t_a", "REVIEW", 0]);
    expect(column(container, "REVIEW")).toEqual(["Draft the brief"]);
  });

  it("a drop on a column with tasks places the task after them", async () => {
    const onUpdate = vi.fn(async () => true);
    render(<TaskKanban tasks={TASKS} onUpdate={onUpdate} onReorder={vi.fn()} />);
    await drop("t_a", "DONE");
    expect(onUpdate.mock.calls[0]).toEqual(["t_a", "DONE", 1]);
  });

  it("a drop where it started, or on nothing, writes nothing", async () => {
    const onUpdate = vi.fn(async () => true);
    const onReorder = vi.fn(async () => true);
    render(<TaskKanban tasks={TASKS} onUpdate={onUpdate} onReorder={onReorder} />);
    await drop("t_a", "t_a");
    await drop("t_a", null);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onReorder).not.toHaveBeenCalled();
  });
});

describe("a refused move is rolled back (WPD-07)", () => {
  it("onUpdate answering false puts the task back in its column", async () => {
    const onUpdate = vi.fn(async () => false);
    const { container } = render(<TaskKanban tasks={TASKS} onUpdate={onUpdate} onReorder={vi.fn()} />);
    await drop("t_b", "DONE");
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(column(container, "TODO")).toEqual(["Draft the brief", "Collect assets", "Book the shoot"]);
    expect(column(container, "DONE")).toEqual(["Kickoff call"]);
  });

  it("onUpdate rejecting puts the task back in its column", async () => {
    const onUpdate = vi.fn(async () => { throw new Error("400 evidence required"); });
    const { container } = render(<TaskKanban tasks={TASKS} onUpdate={onUpdate} onReorder={vi.fn()} />);
    await drop("t_b", "t_d");
    expect(column(container, "TODO")).toEqual(["Draft the brief", "Collect assets", "Book the shoot"]);
    expect(column(container, "DONE")).toEqual(["Kickoff call"]);
  });
});

describe("the board follows its tasks (WPD-07)", () => {
  it("a task the parent adds appears without remounting the board", () => {
    const { container, rerender } = render(<TaskKanban tasks={TASKS} onUpdate={vi.fn()} onReorder={vi.fn()} />);
    rerender(<TaskKanban tasks={[...TASKS, task("t_e", "TODO", 3, "Send the invoice")]} onUpdate={vi.fn()} onReorder={vi.fn()} />);
    expect(column(container, "TODO")).toContain("Send the invoice");
  });
});

describe("column order is kept (WPD-06)", () => {
  it("the board orders a column by position", () => {
    const shuffled = [task("t_x", "TODO", 2, "Third"), task("t_y", "TODO", 0, "First"), task("t_z", "TODO", 1, "Second")];
    const { container } = render(<TaskKanban tasks={shuffled} onUpdate={vi.fn()} onReorder={vi.fn()} />);
    expect(column(container, "TODO")).toEqual(["First", "Second", "Third"]);
  });

  it("a reorder inside a column sends every task of the column with its new position", async () => {
    const onUpdate = vi.fn(async () => true);
    const onReorder = vi.fn(async (_updates: unknown) => true);
    const { container } = render(<TaskKanban tasks={TASKS} onUpdate={onUpdate} onReorder={onReorder} />);
    await drop("t_c", "t_a");
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder.mock.calls[0][0]).toEqual([
      { taskId: "t_c", status: "TODO", position: 0 },
      { taskId: "t_a", status: "TODO", position: 1 },
      { taskId: "t_b", status: "TODO", position: 2 },
    ]);
    expect(column(container, "TODO")).toEqual(["Book the shoot", "Draft the brief", "Collect assets"]);
  });

  it("a refused reorder puts the column back", async () => {
    const onReorder = vi.fn(async () => false);
    const { container } = render(<TaskKanban tasks={TASKS} onUpdate={vi.fn()} onReorder={onReorder} />);
    await drop("t_c", "t_a");
    expect(column(container, "TODO")).toEqual(["Draft the brief", "Collect assets", "Book the shoot"]);
  });
});

describe("cards", () => {
  it("renders each task in its status column", () => {
    render(<TaskKanban tasks={TASKS} onUpdate={vi.fn()} onReorder={vi.fn()} />);
    const done = screen.getByText("Kickoff call").closest("[data-column]") as HTMLElement;
    expect(done.getAttribute("data-column")).toBe("DONE");
    expect(within(done).queryByText("Draft the brief")).toBeNull();
  });
});
