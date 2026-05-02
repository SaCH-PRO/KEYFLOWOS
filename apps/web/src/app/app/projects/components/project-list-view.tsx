"use client";

import { useState, useMemo, useEffect } from "react";
import {
  FolderKanban, Calendar, User, Search,
  ChevronUp, ChevronDown, ExternalLink, DollarSign,
} from "lucide-react";
import { Project, fetchContacts, type Contact } from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  normalizeStatus, getStageInfo, getProjectProgress, getProjectRisk,
  RISK_STYLES, isOverdue, formatDate,
} from "./project-constants";

interface ProjectListViewProps {
  projects: Project[];
  loading: boolean;
  onOpenProject: (id: string) => void;
}

type SortKey = "name" | "stage" | "due" | "progress" | "risk" | "priority" | "client";
type SortDir = "asc" | "desc";

const PRIORITY_ORDER: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

export function ProjectListView({ projects, loading, onOpenProject }: ProjectListViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [contactMap, setContactMap] = useState<Record<string, string>>({});

  useEffect(() => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    const contactIds = [...new Set(projects.filter((p) => p.contactId).map((p) => p.contactId!))];
    if (contactIds.length === 0) return;
    fetchContacts(businessId).then((res) => {
      if (res.data) {
        const contacts = (res.data as { contacts?: Contact[] }).contacts ?? (Array.isArray(res.data) ? res.data as Contact[] : []);
        const map: Record<string, string> = {};
        contacts.forEach((c: Contact) => {
          const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Client";
          map[c.id] = name;
        });
        setContactMap(map);
      }
    });
  }, [projects]);

  const visibleProjects = useMemo(() => {
    let result = projects.filter((p) => normalizeStatus(p.status) !== "ARCHIVED");

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        (p.contactId && contactMap[p.contactId]?.toLowerCase().includes(q))
      );
    }

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "stage":
          cmp = normalizeStatus(a.status).localeCompare(normalizeStatus(b.status));
          break;
        case "due":
          cmp = (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
          break;
        case "progress":
          cmp = getProjectProgress(a.tasks ?? []) - getProjectProgress(b.tasks ?? []);
          break;
        case "risk": {
          const order = { blocked: 0, critical: 1, "at-risk": 2, healthy: 3 };
          cmp = (order[getProjectRisk(a)] ?? 3) - (order[getProjectRisk(b)] ?? 3);
          break;
        }
        case "priority":
          cmp = (PRIORITY_ORDER[(a.priority || "NORMAL").toUpperCase()] ?? 2) - (PRIORITY_ORDER[(b.priority || "NORMAL").toUpperCase()] ?? 2);
          break;
        case "client": {
          const aName = a.contactId ? (contactMap[a.contactId] || "") : "";
          const bName = b.contactId ? (contactMap[b.contactId] || "") : "";
          cmp = aName.localeCompare(bName);
          break;
        }
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [projects, searchQuery, sortKey, sortDir, contactMap]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sortIcon = (col: SortKey) => {
    if (sortKey !== col) return null;
    return sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground py-8 text-center">Loading projects...</div>;
  }

  return (
    <div className="space-y-3">
      <div className="relative sm:max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          placeholder="Search projects or clients..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-xl border border-border/60 bg-input pl-9 pr-3 py-2.5 text-sm placeholder:text-muted-foreground/60"
        />
      </div>

      {visibleProjects.length === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-card p-8 text-center">
          <FolderKanban className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm font-medium">No projects found</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border/60 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 bg-muted/20">
                <th className="text-left px-4 py-2.5">
                  <button onClick={() => handleSort("name")} className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
                    Project {sortIcon("name")}
                  </button>
                </th>
                <th className="text-left px-3 py-2.5 hidden sm:table-cell">
                  <button onClick={() => handleSort("client")} className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
                    Client {sortIcon("client")}
                  </button>
                </th>
                <th className="text-left px-3 py-2.5">
                  <button onClick={() => handleSort("stage")} className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
                    Stage {sortIcon("stage")}
                  </button>
                </th>
                <th className="text-left px-3 py-2.5 hidden md:table-cell">
                  <button onClick={() => handleSort("priority")} className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
                    Priority {sortIcon("priority")}
                  </button>
                </th>
                <th className="text-left px-3 py-2.5 hidden md:table-cell">
                  <button onClick={() => handleSort("due")} className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
                    Due {sortIcon("due")}
                  </button>
                </th>
                <th className="text-left px-3 py-2.5 hidden lg:table-cell">
                  <button onClick={() => handleSort("progress")} className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
                    Progress {sortIcon("progress")}
                  </button>
                </th>
                <th className="text-left px-3 py-2.5 hidden lg:table-cell">
                  <button onClick={() => handleSort("risk")} className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
                    Risk {sortIcon("risk")}
                  </button>
                </th>
                <th className="w-10 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {visibleProjects.map((project) => {
                const stageInfo = getStageInfo(project.status);
                const progress = getProjectProgress(project.tasks ?? []);
                const risk = getProjectRisk(project);
                const riskStyle = RISK_STYLES[risk];
                const overdue = isOverdue(project.dueDate) && normalizeStatus(project.status) !== "COMPLETED";
                const clientName = project.contactId ? contactMap[project.contactId] : null;
                const priorityUpper = (project.priority || "NORMAL").toUpperCase();

                return (
                  <tr
                    key={project.id}
                    className="border-b border-border/20 hover:bg-muted/10 transition-colors cursor-pointer"
                    onClick={() => onOpenProject(project.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: project.color || stageInfo.color }} />
                        <span className="font-medium truncate max-w-[200px]">{project.name}</span>
                        {project.invoiceId && (
                          <DollarSign className="w-3 h-3 shrink-0" style={{ color: "hsl(var(--kf-success) / 0.6)" }} />
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 hidden sm:table-cell">
                      {clientName ? (
                        <div className="flex items-center gap-1.5">
                          <User className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                          <span className="text-xs text-muted-foreground truncate max-w-[120px]">{clientName}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-md font-medium"
                        style={{ background: stageInfo.bg, color: stageInfo.color }}
                      >
                        {stageInfo.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 hidden md:table-cell">
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-md font-medium capitalize"
                        style={{
                          background: priorityUpper === "URGENT" || priorityUpper === "HIGH"
                            ? "hsl(var(--kf-error) / 0.1)"
                            : priorityUpper === "LOW"
                              ? "hsl(var(--muted) / 0.3)"
                              : "hsl(var(--kf-accent1) / 0.1)",
                          color: priorityUpper === "URGENT" || priorityUpper === "HIGH"
                            ? "hsl(var(--kf-error))"
                            : priorityUpper === "LOW"
                              ? "hsl(var(--muted-foreground))"
                              : "hsl(var(--kf-accent1))",
                        }}
                      >
                        {(project.priority || "Normal").toLowerCase()}
                      </span>
                    </td>
                    <td className="px-3 py-3 hidden md:table-cell">
                      {project.dueDate ? (
                        <span
                          className="text-xs flex items-center gap-1"
                          style={{ color: overdue ? "hsl(var(--kf-error))" : undefined }}
                        >
                          <Calendar className="w-3 h-3" />
                          {formatDate(project.dueDate)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 hidden lg:table-cell">
                      <div className="flex items-center gap-2 w-24">
                        <div className="flex-1 h-1.5 rounded-full bg-muted/30 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${progress}%`, background: stageInfo.color }} />
                        </div>
                        <span className="text-[10px] text-muted-foreground tabular-nums">{progress}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 hidden lg:table-cell">
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-md font-medium"
                        style={{ background: riskStyle.bg, color: riskStyle.color }}
                      >
                        {riskStyle.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/40" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
