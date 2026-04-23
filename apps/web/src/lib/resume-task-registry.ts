"use client";

export interface InterruptedTask {
  id: string;
  module: string;
  label: string;
  description: string;
  route: string;
  draftId: string | null;
  originRoute: string | null;
  originLabel: string | null;
  taskIntent: string | null;
  formData: Record<string, unknown> | null;
  interruptedAt: number;
  completedAt: number | null;
  status: "interrupted" | "completed" | "discarded";
  sourceChangedAt?: number | null;
}

const STORAGE_KEY = "kf-interrupted-tasks";
const BROADCAST_CHANNEL = "kf-task-registry";
const MAX_TASKS = 20;

export function loadInterruptedTasks(): InterruptedTask[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as InterruptedTask[];
    return parsed.filter((t) => t.status === "interrupted");
  } catch {
    return [];
  }
}

function loadAllTasks(): InterruptedTask[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as InterruptedTask[];
  } catch {
    return [];
  }
}

function saveTasks(tasks: InterruptedTask[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks.slice(0, MAX_TASKS)));
  } catch {}
}

function broadcast(event: { type: "completed" | "discarded" | "source-changed"; id: string }) {
  try {
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;
    const ch = new BroadcastChannel(BROADCAST_CHANNEL);
    ch.postMessage(event);
    ch.close();
  } catch {}
}

export function subscribeToBroadcast(
  onEvent: (event: { type: "completed" | "discarded" | "source-changed"; id: string }) => void
): () => void {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return () => {};
  try {
    const ch = new BroadcastChannel(BROADCAST_CHANNEL);
    ch.onmessage = (e) => onEvent(e.data);
    return () => ch.close();
  } catch {
    return () => {};
  }
}

export function registerInterruptedTask(task: Omit<InterruptedTask, "interruptedAt" | "completedAt" | "status" | "sourceChangedAt">): string {
  const tasks = loadAllTasks();
  const existing = tasks.findIndex((t) => t.id === task.id || (task.draftId && t.draftId === task.draftId));

  const entry: InterruptedTask = {
    ...task,
    interruptedAt: Date.now(),
    completedAt: null,
    sourceChangedAt: null,
    status: "interrupted",
  };

  if (existing >= 0) {
    tasks[existing] = entry;
  } else {
    tasks.unshift(entry);
  }

  saveTasks(tasks);
  return entry.id;
}

export function markTaskCompleted(id: string) {
  const tasks = loadAllTasks();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx >= 0) {
    tasks[idx] = { ...tasks[idx], status: "completed", completedAt: Date.now() };
    saveTasks(tasks);
    broadcast({ type: "completed", id });
  }
}

export function markTaskDiscarded(id: string) {
  const tasks = loadAllTasks();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx >= 0) {
    tasks[idx] = { ...tasks[idx], status: "discarded" };
    saveTasks(tasks);
    broadcast({ type: "discarded", id });
  }
}

export function markSourceChanged(id: string) {
  const tasks = loadAllTasks();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx >= 0) {
    tasks[idx] = { ...tasks[idx], sourceChangedAt: Date.now() };
    saveTasks(tasks);
    broadcast({ type: "source-changed", id });
  }
}

export function getTasksForModule(module: string): InterruptedTask[] {
  return loadInterruptedTasks().filter((t) => t.module === module);
}

export function clearCompletedTasks() {
  const tasks = loadAllTasks().filter((t) => t.status === "interrupted");
  saveTasks(tasks);
}
