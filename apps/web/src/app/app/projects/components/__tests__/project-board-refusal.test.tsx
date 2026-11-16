/**
 * SWEEP-P0-SCOPES (browser sweep BUG-014): the project board tells a member the server refused a
 * project write, and never shows a refused write as done.
 *
 * The server now holds every projects write to the projects module's write scope (apps/server
 * projects.controller.ts); a member with projects read gets 403 "Insufficient permissions: projects
 * requires write access (you have read)". Before: handleDeleteProject ignored the answer and removed
 * the project from the board (the sweep's STAFF member saw the owner's project vanish), and a
 * refused create closed the form with no word.
 *
 * Required: a refused delete keeps the project and shows the server's refusal; a refused create
 * shows the server's refusal and adds nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const REFUSAL = "Insufficient permissions: projects requires write access (you have read)";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const client = vi.hoisted(() => ({
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  createProjectTask: vi.fn(),
  updateProjectTask: vi.fn(),
  deleteProjectTask: vi.fn(),
  fetchContacts: vi.fn(),
}));
vi.mock("@/lib/client", () => client);

import { ProjectBoard } from "../project-board";

const OWNER_PROJECT = {
  id: "p_owner",
  name: "Owner launch",
  status: "IN_PROGRESS",
  priority: "NORMAL",
  color: null,
  dueDate: null,
  contactId: null,
  tasks: [],
} as never;

function renderBoard(onProjectsChange = vi.fn()) {
  render(
    <ProjectBoard
      businessId="biz_1"
      projects={[OWNER_PROJECT]}
      loading={false}
      onProjectsChange={onProjectsChange}
      onOpenProject={vi.fn()}
      onReload={vi.fn()}
    />,
  );
  return onProjectsChange;
}

/** The actions menu button of the card that shows `name`. */
function actionsButtonOf(name: string): HTMLElement {
  const card = screen.getByText(name).closest("div.p-3") as HTMLElement;
  const icon = card.querySelector('svg[class*="lucide-ellipsis"], svg[class*="lucide-more-horizontal"]');
  return icon!.closest("button") as HTMLElement;
}

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  client.fetchContacts.mockResolvedValue({ data: [], error: null });
});
afterEach(() => cleanup());

describe("project board: refused writes", () => {
  it("[WEB-PRJ-01] a refused delete keeps the project on the board and shows the server's refusal", async () => {
    client.deleteProject.mockResolvedValue({ data: null, error: REFUSAL, status: 403 });
    const onProjectsChange = renderBoard();
    fireEvent.click(actionsButtonOf("Owner launch"));
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSAL));
    expect(onProjectsChange).not.toHaveBeenCalled();
  });

  it("[WEB-PRJ-02] a refused create shows the server's refusal and adds no project", async () => {
    client.createProject.mockResolvedValue({ data: null, error: REFUSAL, status: 403 });
    const onProjectsChange = renderBoard();
    fireEvent.click(screen.getByRole("button", { name: /new project/i }));
    fireEvent.change(screen.getByPlaceholderText("Project name..."), { target: { value: "Jada project" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSAL));
    expect(onProjectsChange).not.toHaveBeenCalled();
  });

  it("[WEB-PRJ-03] a successful delete removes the project", async () => {
    client.deleteProject.mockResolvedValue({ data: { id: "p_owner" }, error: null });
    const onProjectsChange = renderBoard();
    fireEvent.click(actionsButtonOf("Owner launch"));
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(onProjectsChange).toHaveBeenCalledTimes(1));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
