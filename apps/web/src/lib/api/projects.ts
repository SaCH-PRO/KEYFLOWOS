/**
 * PR196-PROJECTS-WEB: the project routes the Projects screens call that
 * lib/client.ts does not type: the budget read, the board reorder, the
 * assignee options and the task writes that name an assignee.
 *
 * Every call goes through lib/api.ts (the API base, the member's token, the
 * unsendable-request guard); none builds a web-relative URL. The project-budget
 * view used to fetch `/api/projects/...`, a path the web app has no route for,
 * so every project read "No budget set" (WPD-03).
 */
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import type { ProjectTask } from "@/lib/client";

const enc = encodeURIComponent;

/** GET /projects/businesses/:bid/projects/:pid/budget (ProjectsService.getProjectBudget). Amounts are in the business currency. */
export interface ProjectBudget {
  projectId: string;
  budgetAmount: number;
  budgetHours: number;
  totalCost: number;
  timeCost: number;
  expenseCost: number;
  trackedHours: number;
  remainingBudget: number;
  percentUsed: number;
  percentHoursUsed: number;
  status: "HEALTHY" | "WARNING" | "AT_RISK" | "OVER_BUDGET" | string;
}

export function getProjectBudget(businessId: string, projectId: string) {
  return apiGet<ProjectBudget>(`/projects/businesses/${enc(businessId)}/projects/${enc(projectId)}/budget`);
}

/** A project task with the board fields the server returns (ProjectTask.status, .position). */
export type ProjectBoardTask = ProjectTask & { status?: string; position?: number };

export interface TaskMove {
  taskId: string;
  status: string;
  position: number;
}

/**
 * POST /projects/businesses/:bid/projects/:pid/tasks/reorder. The server checks
 * the whole batch first and sends any status change through updateTask's door
 * (PR196-PROJECTS-SERVER), so a refused batch writes none of its moves.
 */
export function reorderProjectTasks(businessId: string, projectId: string, updates: TaskMove[]) {
  return apiPost<ProjectBoardTask[]>({
    path: `/projects/businesses/${enc(businessId)}/projects/${enc(projectId)}/tasks/reorder`,
    body: { updates },
  });
}

/** Who a project task may be given to (D-87): a member of the business or one of its booking staff. */
export interface TaskAssigneeOption {
  type: "User" | "StaffMember";
  id: string;
  name: string;
}

/**
 * GET /businesses/:bid/task-assignments/options (TaskAssignmentService.getAssignableOptions):
 * the business's members and booking staff. KEY is left out: a person may not
 * assign a task to KEY (PR196-PROJECTS-SERVER answers 404 for it).
 */
export async function fetchTaskAssigneeOptions(businessId: string) {
  const res = await apiGet<unknown>(`/businesses/${enc(businessId)}/task-assignments/options`);
  if (!Array.isArray(res.data)) return { ...res, data: null as TaskAssigneeOption[] | null };
  const options = res.data.filter(
    (o): o is TaskAssigneeOption =>
      typeof o === "object" && o !== null &&
      ((o as TaskAssigneeOption).type === "User" || (o as TaskAssigneeOption).type === "StaffMember") &&
      typeof (o as TaskAssigneeOption).id === "string" && (o as TaskAssigneeOption).id !== "" &&
      typeof (o as TaskAssigneeOption).name === "string",
  );
  return { ...res, data: options };
}

/** POST /projects/businesses/:bid/projects/:pid/tasks, naming an assignee when one is chosen. */
export function createProjectTaskFor(
  businessId: string,
  projectId: string,
  data: { title: string; dueDate?: string; assigneeId?: string },
) {
  return apiPost<ProjectBoardTask>({
    path: `/projects/businesses/${enc(businessId)}/projects/${enc(projectId)}/tasks`,
    body: data,
  });
}

/** PATCH /projects/businesses/:bid/tasks/:taskId {assigneeId}; null unassigns. */
export function setProjectTaskAssignee(businessId: string, taskId: string, assigneeId: string | null) {
  return apiPatch<ProjectBoardTask>(`/projects/businesses/${enc(businessId)}/tasks/${enc(taskId)}`, { assigneeId });
}
