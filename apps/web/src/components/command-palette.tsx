"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  ArrowRight,
  Link2,
  User,
  FileText,
  Calendar,
  Package,
  FolderKanban,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { universalSearch, UniversalSearchResult } from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";

type Action = {
  label: string;
  hint?: string;
  onSelect: () => void;
};

const EMPTY: UniversalSearchResult = { contacts: [], invoices: [], bookings: [], products: [], projects: [] };

type SearchSection = {
  key: keyof UniversalSearchResult;
  label: string;
  icon: typeof User;
  color: string;
  getHref: (item: any) => string;
  getTitle: (item: any) => string;
  getSub: (item: any) => string;
};

const SEARCH_SECTIONS: SearchSection[] = [
  {
    key: "contacts",
    label: "Contacts",
    icon: User,
    color: "hsl(var(--kf-accent2))",
    getHref: (c) => `/app/crm/contacts/${c.id}`,
    getTitle: (c) => c.displayName || [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unnamed",
    getSub: (c) => c.email || c.status || "",
  },
  {
    key: "invoices",
    label: "Invoices",
    icon: FileText,
    color: "#22c55e",
    getHref: (i) => `/app/commerce?tab=invoices`,
    getTitle: (i) => i.invoiceNumber || `Invoice ${i.id?.slice(0, 8)}`,
    getSub: (i) => `${i.currency || "TTD"} ${i.total?.toFixed(2) ?? "0.00"} · ${i.status || ""}`,
  },
  {
    key: "bookings",
    label: "Bookings",
    icon: Calendar,
    color: "#3b82f6",
    getHref: () => `/app/bookings`,
    getTitle: (b: any) => {
      const name = b.contact ? [b.contact.firstName, b.contact.lastName].filter(Boolean).join(" ") : "";
      return `${b.service?.name || "Booking"} ${name ? `· ${name}` : ""}`;
    },
    getSub: (b: any) => `${new Date(b.startTime).toLocaleDateString()} · ${b.status}`,
  },
  {
    key: "products",
    label: "Products",
    icon: Package,
    color: "#f97316",
    getHref: () => `/app/commerce?tab=products`,
    getTitle: (p) => p.name,
    getSub: (p) => `${p.currency || "TTD"} ${p.price?.toFixed(2) ?? "0.00"}`,
  },
  {
    key: "projects",
    label: "Projects",
    icon: FolderKanban,
    color: "#8b5cf6",
    getHref: () => `/app/projects`,
    getTitle: (p) => p.name,
    getSub: (p) => `${p.status || ""} · ${p.priority || ""}`,
  },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UniversalSearchResult>(EMPTY);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
    if (!open) {
      setQuery("");
      setSearchResults(EMPTY);
    }
  }, [open]);

  useEffect(() => {
    const businessId = getStoredBusinessId();
    if (!businessId || !query.trim() || query.trim().length < 2) {
      setSearchResults(EMPTY);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await universalSearch(businessId, query.trim());
        setSearchResults(res.data ?? EMPTY);
      } catch {
        setSearchResults(EMPTY);
      }
      setSearching(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const actions = useMemo<Action[]>(
    () => [
      { label: "Go to Command", hint: "Command Center", onSelect: () => router.push("/app") },
      { label: "Go to Contacts", hint: "CRM & pipeline", onSelect: () => router.push("/app/crm/pipeline") },
      { label: "Go to Commerce", hint: "Invoices & Products", onSelect: () => router.push("/app/commerce") },
      { label: "Go to Bookings", hint: "Schedule & calendar", onSelect: () => router.push("/app/bookings") },
      { label: "Go to Store", hint: "Online booking page", onSelect: () => router.push("/app/store") },
      { label: "Go to Social", hint: "Content & scheduling (Marketing)", onSelect: () => router.push("/app/marketing?tab=social") },
      { label: "Go to Marketing", hint: "Email campaigns & lead forms", onSelect: () => router.push("/app/marketing") },
      { label: "Go to Expenses", hint: "Track & manage expenses", onSelect: () => router.push("/app/expenses") },
      { label: "Go to Projects", hint: "Project management & Kanban", onSelect: () => router.push("/app/projects") },
      { label: "Go to Automations", hint: "Playbooks & workflow triggers", onSelect: () => router.push("/app/projects?tab=playbooks") },
      { label: "Go to Reports", hint: "Analytics & KPIs", onSelect: () => router.push("/app/reports") },
      { label: "Go to Learn", hint: "MasterClass courses", onSelect: () => router.push("/app/learn") },
      { label: "Go to Community", hint: "Forum & founder circles", onSelect: () => router.push("/app/community") },
      { label: "Go to Templates", hint: "Business templates & presets", onSelect: () => router.push("/app/templates") },
      { label: "Go to Settings", hint: "Business settings", onSelect: () => router.push("/app/settings") },
    ],
    [router],
  );

  const filteredActions = useMemo(() => {
    if (!query) return actions;
    return actions.filter(
      (a) => a.label.toLowerCase().includes(query.toLowerCase()) || a.hint?.toLowerCase().includes(query.toLowerCase()),
    );
  }, [actions, query]);

  const totalSearchResults = SEARCH_SECTIONS.reduce((sum, s) => sum + (searchResults[s.key]?.length ?? 0), 0);
  const hasSearch = query.trim().length >= 2;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm pt-[12vh]" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-2xl rounded-2xl border border-border/80 bg-slate-950/95 shadow-2xl shadow-primary/20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
          <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            aria-label="Search everything or type a command"
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            placeholder="Search everything or type a command..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button aria-label="Clear search" onClick={() => setQuery("")} className="text-muted-foreground hover:text-white">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {hasSearch && searching && (
            <div className="px-4 py-4 text-sm text-muted-foreground text-center animate-pulse">Searching...</div>
          )}

          {hasSearch && !searching && totalSearchResults > 0 && (
            <div className="py-1">
              {SEARCH_SECTIONS.map((section) => {
                const items = searchResults[section.key];
                if (!items || items.length === 0) return null;
                const Icon = section.icon;
                return (
                  <div key={section.key}>
                    <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Icon className="w-3 h-3" style={{ color: section.color }} />
                      {section.label}
                    </div>
                    {items.map((item: any) => (
                      <button
                        key={item.id}
                        onClick={() => {
                          router.push(section.getHref(item));
                          onClose();
                        }}
                        className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-primary/10 transition-colors text-sm group"
                      >
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ background: `${section.color}20` }}
                        >
                          <Icon className="w-4 h-4" style={{ color: section.color }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-foreground font-medium truncate">{section.getTitle(item)}</div>
                          <div className="text-[11px] text-muted-foreground truncate">{section.getSub(item)}</div>
                        </div>
                        <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {hasSearch && !searching && totalSearchResults === 0 && filteredActions.length === 0 && (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">No results for &ldquo;{query}&rdquo;</div>
          )}

          {filteredActions.length > 0 && (
            <div>
              {hasSearch && totalSearchResults > 0 && (
                <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-t border-border/40 mt-1 pt-2">
                  Quick Actions
                </div>
              )}
              {filteredActions.map((action) => (
                <button
                  key={action.label}
                  onClick={() => {
                    action.onSelect();
                    onClose();
                  }}
                  className={cn(
                    "w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-primary/10 transition-colors text-sm",
                  )}
                >
                  <div>
                    <div className="text-foreground">{action.label}</div>
                    {action.hint && <div className="text-[11px] text-muted-foreground">{action.hint}</div>}
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="border-t border-border/60 px-4 py-3 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Enter to run · Esc to close</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1">
            <Link2 className="w-3 h-3" /> Cmd/Ctrl + K
          </span>
        </div>
      </div>
    </div>
  );
}
