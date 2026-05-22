"use client";

import { useEffect, useMemo, useState } from "react";

import {
  Play,
  Pause,
  Trash2,
  Edit3,
  X,
  Clock,
  DollarSign,
  FileText,
  Timer,
  ChevronLeft,
  ChevronRight,
  Filter,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  startTimer,
  stopTimer,
  getRunningTimer,
  listTimeEntries,
  getTimeSummary,
  updateTimeEntry,
  deleteTimeEntry,
  createTimeEntry,
} from "@/lib/time-tracking";
import { apiGet } from "@/lib/api";
import { useControlTowerData } from "../control-tower/components/use-control-tower-data";
import { format, startOfWeek, endOfWeek, addDays, subDays, isSameDay, parseISO } from "date-fns";

interface ProjectOption {
  id: string;
  name: string;
  color: string | null;
}

interface TaskOption {
  id: string;
  title: string;
}

interface TimeEntry {
  id: string;
  description: string | null;
  startTime: string;
  endTime: string | null;
  durationMinutes: number | null;
  billable: boolean;
  billed: boolean;
  hourlyRate: number | null;
  projectId: string | null;
  project: { id: string; name: string; color: string | null } | null;
  taskId: string | null;
  task: { id: string; title: string } | null;
  createdAt: string;
}

interface TimeSummary {
  totalEntries: number;
  totalHours: number;
  billableHours: number;
  billedHours: number;
  unbilledHours: number;
}

function formatDuration(minutes: number | null): string {
  if (!minutes || minutes <= 0) return "0:00";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${m.toString().padStart(2, "0")}`;
}

function formatCurrency(hours: number, rate: number | null): string {
  if (!rate || hours <= 0) return "$0.00";
  return `$${(hours * rate).toFixed(2)}`;
}

export default function TimeTrackingPage() {
  const { businessId } = useControlTowerData();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [summary, setSummary] = useState<TimeSummary | null>(null);
  const [runningEntry, setRunningEntry] = useState<TimeEntry | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [tasks, setTasks] = useState<TaskOption[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedProject, setSelectedProject] = useState("");
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [formDesc, setFormDesc] = useState("");
  const [formProject, setFormProject] = useState("");
  const [formTask, setFormTask] = useState("");
  const [formStart, setFormStart] = useState("");
  const [formEnd, setFormEnd] = useState("");
  const [formBillable, setFormBillable] = useState(true);

  // Timer heartbeat
  useEffect(() => {
    if (!runningEntry) {
      setElapsed(0);
      return;
    }
    const interval = setInterval(() => {
      const start = new Date(runningEntry.startTime).getTime();
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [runningEntry]);

  // Load data
  useEffect(() => {
    if (!businessId) return;
    loadData();
    loadProjects();
    checkRunningTimer();
  }, [businessId, selectedDate, selectedProject]);

  async function loadData() {
    if (!businessId) return;
    setLoading(true);
    const start = format(selectedDate, "yyyy-MM-dd");
    const end = format(selectedDate, "yyyy-MM-dd");

    const [entriesRes, summaryRes] = await Promise.all([
      listTimeEntries(businessId, {
        startDate: start,
        endDate: end,
        projectId: selectedProject || undefined,
      }),
      getTimeSummary(businessId, { startDate: start, endDate: end }),
    ]);

    setEntries(entriesRes.data ?? []);
    setSummary(summaryRes.data ?? null);
    setLoading(false);
  }

  async function loadProjects() {
    if (!businessId) return;
    const res = await apiGet<ProjectOption[]>(`/projects/businesses/${businessId}`);
    if (res.data) setProjects(res.data);
  }

  async function loadTasks(projectId: string) {
    if (!businessId || !projectId) {
      setTasks([]);
      return;
    }
    const res = await apiGet<{ tasks: TaskOption[] }>(`/projects/businesses/${businessId}/projects/${projectId}`);
    setTasks(res.data?.tasks ?? []);
  }

  async function checkRunningTimer() {
    if (!businessId) return;
    const res = await getRunningTimer(businessId);
    if (res.data) setRunningEntry(res.data);
  }

  async function handleStartTimer() {
    if (!businessId) return;
    const res = await startTimer(businessId, {
      description: formDesc || undefined,
      projectId: formProject || undefined,
      taskId: formTask || undefined,
      billable: formBillable,
    });
    if (res.data) {
      setRunningEntry(res.data);
      setShowForm(false);
    }
  }

  async function handleStopTimer() {
    if (!businessId || !runningEntry) return;
    const res = await stopTimer(businessId, runningEntry.id);
    if (res.data) {
      setRunningEntry(null);
      loadData();
    }
  }

  async function handleSaveManual() {
    if (!businessId || !formStart) return;
    const res = await createTimeEntry(businessId, {
      description: formDesc,
      startTime: new Date(formStart).toISOString(),
      endTime: formEnd ? new Date(formEnd).toISOString() : undefined,
      projectId: formProject || undefined,
      taskId: formTask || undefined,
      billable: formBillable,
    });
    if (res.data) {
      setShowForm(false);
      resetForm();
      loadData();
    }
  }

  async function handleDelete(entryId: string) {
    if (!businessId) return;
    if (!confirm("Delete this time entry?")) return;
    await deleteTimeEntry(businessId, entryId);
    loadData();
  }

  async function handleUpdate(entryId: string, updates: Partial<TimeEntry>) {
    if (!businessId) return;
    await updateTimeEntry(businessId, entryId, {
      description: updates.description ?? undefined,
      billable: updates.billable,
    });
    setEditingId(null);
    loadData();
  }

  function resetForm() {
    setFormDesc("");
    setFormProject("");
    setFormTask("");
    setFormStart("");
    setFormEnd("");
    setFormBillable(true);
  }

  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const dayTotal = useMemo(() => {
    return entries.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0);
  }, [entries]);

  const dayBillable = useMemo(() => {
    return entries
      .filter((e) => e.billable)
      .reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0);
  }, [entries]);

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Time Tracking</h1>
          <p className="text-sm text-muted-foreground">
            Track billable hours and manage your time
          </p>
        </div>
        <div className="flex items-center gap-2">
          {runningEntry ? (
            <motion.button
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              onClick={handleStopTimer}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
            >
              <Pause className="w-4 h-4" />
              <span className="text-sm font-medium">
                {Math.floor(elapsed / 3600)}:{Math.floor((elapsed % 3600) / 60).toString().padStart(2, "0")}:{(elapsed % 60).toString().padStart(2, "0")}
              </span>
              <span className="text-xs text-red-400/70 truncate max-w-[120px]">
                {runningEntry.description || runningEntry.project?.name || "Timer running"}
              </span>
            </motion.button>
          ) : (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(24_95%_53%)] text-white hover:brightness-110 transition-all"
            >
              <Play className="w-4 h-4" />
              <span className="text-sm font-medium">Start Timer</span>
            </button>
          )}
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<Clock className="w-4 h-4 text-blue-400" />}
          label="Today"
          value={formatDuration(dayTotal)}
          sub={`${entries.length} entries`}
        />
        <StatCard
          icon={<DollarSign className="w-4 h-4 text-emerald-400" />}
          label="Billable"
          value={formatDuration(dayBillable)}
          sub={`${Math.round((dayBillable / Math.max(dayTotal, 1)) * 100)}% of total`}
        />
        <StatCard
          icon={<FileText className="w-4 h-4 text-amber-400" />}
          label="Unbilled"
          value={formatDuration(dayBillable - entries.filter(e => e.billable && e.billed).reduce((s, e) => s + (e.durationMinutes ?? 0), 0))}
          sub="Ready to invoice"
        />
        <StatCard
          icon={<Timer className="w-4 h-4 text-violet-400" />}
          label="This Week"
          value={summary ? `${summary.billableHours}h` : "—"}
          sub={`${summary?.totalEntries ?? 0} entries`}
        />
      </div>

      {/* Week Calendar Strip */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setSelectedDate(subDays(selectedDate, 7))}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 flex gap-1">
          {weekDays.map((day) => {
            const isSelected = isSameDay(day, selectedDate);
            const isToday = isSameDay(day, new Date());
            return (
              <button
                key={day.toISOString()}
                onClick={() => setSelectedDate(day)}
                className={`flex-1 py-2 rounded-lg text-center transition-all ${
                  isSelected
                    ? "bg-[hsl(24_95%_53%)] text-white"
                    : "bg-muted/50 hover:bg-muted text-muted-foreground"
                }`}
              >
                <div className="text-[10px] uppercase tracking-wide">{format(day, "EEE")}</div>
                <div className={`text-sm font-semibold ${isToday && !isSelected ? "text-[hsl(24_95%_53%)]" : ""}`}>
                  {format(day, "d")}
                </div>
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setSelectedDate(addDays(selectedDate, 7))}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Filter className="w-4 h-4 text-muted-foreground" />
        <select
          value={selectedProject}
          onChange={(e) => setSelectedProject(e.target.value)}
          className="text-sm bg-muted/50 border border-border rounded-lg px-3 py-1.5 outline-none focus:border-[hsl(24_95%_53%)]"
        >
          <option value="">All Projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Timer / Manual Entry Form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-xl border border-border bg-card p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{runningEntry ? "Timer Active" : "Add Time Entry"}</h3>
              <button onClick={() => { setShowForm(false); resetForm(); }} className="p-1 hover:bg-muted rounded">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="What are you working on?"
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm bg-muted/50 border border-border outline-none focus:border-[hsl(24_95%_53%)]"
              />
              <select
                value={formProject}
                onChange={(e) => { setFormProject(e.target.value); loadTasks(e.target.value); }}
                className="w-full px-3 py-2 rounded-lg text-sm bg-muted/50 border border-border outline-none focus:border-[hsl(24_95%_53%)]"
              >
                <option value="">Select Project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <select
                value={formTask}
                onChange={(e) => setFormTask(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm bg-muted/50 border border-border outline-none focus:border-[hsl(24_95%_53%)]"
              >
                <option value="">Select Task (optional)</option>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={formBillable}
                  onChange={(e) => setFormBillable(e.target.checked)}
                  className="rounded border-border"
                />
                Billable
              </label>
            </div>
            {!runningEntry && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Start</label>
                  <input
                    type="datetime-local"
                    value={formStart}
                    onChange={(e) => setFormStart(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-sm bg-muted/50 border border-border outline-none focus:border-[hsl(24_95%_53%)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">End (optional)</label>
                  <input
                    type="datetime-local"
                    value={formEnd}
                    onChange={(e) => setFormEnd(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-sm bg-muted/50 border border-border outline-none focus:border-[hsl(24_95%_53%)]"
                  />
                </div>
              </div>
            )}
            <div className="flex gap-2">
              {runningEntry ? (
                <button
                  onClick={handleStopTimer}
                  className="px-4 py-2 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 text-sm font-medium transition-colors"
                >
                  Stop Timer
                </button>
              ) : (
                <>
                  <button
                    onClick={handleStartTimer}
                    className="px-4 py-2 rounded-lg bg-[hsl(24_95%_53%)] text-white hover:brightness-110 text-sm font-medium transition-all"
                  >
                    Start Timer
                  </button>
                  <button
                    onClick={handleSaveManual}
                    disabled={!formStart}
                    className="px-4 py-2 rounded-lg bg-muted text-foreground hover:bg-muted/80 text-sm font-medium transition-colors disabled:opacity-40"
                  >
                    Save Entry
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Time Entries List */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            {format(selectedDate, "EEEE, MMMM d")}
          </h3>
          <span className="text-xs text-muted-foreground">
            {formatDuration(dayTotal)} total
          </span>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading...</div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center">
            <Clock className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No time entries for this day</p>
            <button
              onClick={() => setShowForm(true)}
              className="mt-2 text-sm text-[hsl(24_95%_53%)] hover:underline"
            >
              Add your first entry
            </button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className={`group px-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors ${
                  entry.billed ? "opacity-60" : ""
                }`}
              >
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: entry.project?.color ?? "hsl(24_95%_53%)" }} />
                <div className="flex-1 min-w-0">
                  {editingId === entry.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        defaultValue={entry.description ?? ""}
                        onBlur={(e) => handleUpdate(entry.id, { description: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleUpdate(entry.id, { description: e.currentTarget.value });
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="flex-1 px-2 py-1 rounded text-sm bg-muted border border-border outline-none"
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{entry.description || "Untitled"}</span>
                      <button onClick={() => setEditingId(entry.id)} className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <Edit3 className="w-3 h-3 text-muted-foreground" />
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {entry.project && <span>{entry.project.name}</span>}
                    {entry.task && <span>· {entry.task.title}</span>}
                    <span>· {format(parseISO(entry.startTime), "h:mm a")}</span>
                    {entry.endTime && (
                      <span>– {format(parseISO(entry.endTime), "h:mm a")}</span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold">{formatDuration(entry.durationMinutes)}</div>
                  <div className="text-xs text-muted-foreground">
                    {entry.billable ? (
                      <span className="text-emerald-400">${((entry.durationMinutes ?? 0) / 60 * (entry.hourlyRate ?? 0)).toFixed(2)}</span>
                    ) : (
                      <span>Non-billable</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!entry.billed && (
                    <button
                      onClick={() => handleUpdate(entry.id, { billable: !entry.billable })}
                      className={`p-1.5 rounded-lg text-xs transition-colors ${
                        entry.billable
                          ? "text-emerald-400 hover:bg-emerald-400/10"
                          : "text-muted-foreground hover:bg-muted"
                      }`}
                      title={entry.billable ? "Billable" : "Non-billable"}
                    >
                      <DollarSign className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {entry.billed && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      Billed
                    </span>
                  )}
                  <button
                    onClick={() => handleDelete(entry.id)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="text-lg font-bold">{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}
