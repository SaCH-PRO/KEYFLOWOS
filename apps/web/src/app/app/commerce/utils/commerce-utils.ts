export function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function getStatusAccentColor(status: string): string {
  const map: Record<string, string> = {
    DRAFT: "rgba(148,163,184,0.6)",
    SENT: "rgb(96,165,250)",
    ACCEPTED: "rgb(52,211,153)",
    PAID: "rgb(52,211,153)",
    REJECTED: "rgb(248,113,113)",
    OVERDUE: "rgb(248,113,113)",
    VOID: "rgba(100,116,139,0.5)",
  };
  return map[status] ?? "rgba(148,163,184,0.6)";
}

export function getContactInitials(contact: { firstName?: string | null; lastName?: string | null } | null | undefined): string {
  if (!contact) return "?";
  const f = (contact.firstName ?? "")[0] ?? "";
  const l = (contact.lastName ?? "")[0] ?? "";
  return (f + l).toUpperCase() || "?";
}

export function getItemsSummary(items: Array<{ description?: string | null }> | null | undefined): string {
  if (!items || items.length === 0) return "No items";
  const names = items.slice(0, 2).map((i) => i.description).filter(Boolean);
  const rest = items.length > 2 ? ` +${items.length - 2} more` : "";
  return `${items.length} item${items.length !== 1 ? "s" : ""} · ${names.join(", ")}${rest}`;
}

export function getDaysUntilDue(dueDate: string | null | undefined): { days: number; label: string; color: string } | null {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  const now = new Date();
  const diff = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return { days: Math.abs(diff), label: `${Math.abs(diff)}d overdue`, color: "text-red-400" };
  if (diff === 0) return { days: 0, label: "Due today", color: "text-amber-400" };
  if (diff <= 7) return { days: diff, label: `Due in ${diff}d`, color: "text-amber-400" };
  return { days: diff, label: `Due in ${diff}d`, color: "text-muted-foreground" };
}
