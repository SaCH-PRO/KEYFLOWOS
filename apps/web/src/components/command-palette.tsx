"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  ArrowRight,
  User,
  FileText,
  Calendar,
  Package,
  FolderKanban,
  X,
  Clock,
  Zap,
  Receipt,
  Plus,
  Megaphone,
  BarChart3,
  Settings,
  Users,
  Store,
  ArrowUp,
  ArrowDown,
  CornerDownLeft,
  Wrench,
  HelpCircle,
  LifeBuoy,
  BookOpen,
  MessageSquare,
  Moon,
  Copy,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { universalSearch, UniversalSearchResult } from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import { useCompose } from "@/components/email/compose-context";

type Action = {
  id: string;
  label: string;
  hint?: string;
  shortcut?: string;
  icon?: typeof User;
  onSelect: () => void;
};

const EMPTY: UniversalSearchResult = { contacts: [], invoices: [], bookings: [], products: [], projects: [] };

type SearchItemBase = {
  id: string;
  displayName?: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  status?: string | null;
  invoiceNumber?: string | null;
  total?: number | null;
  currency?: string | null;
  contact?: { firstName?: string | null; lastName?: string | null } | null;
  service?: { name?: string | null } | null;
  startTime?: string;
  name?: string;
  price?: number | null;
  priority?: string | null;
};

type SearchSection = {
  key: keyof UniversalSearchResult;
  label: string;
  icon: typeof User;
  color: string;
  getHref: (item: SearchItemBase) => string;
  getTitle: (item: SearchItemBase) => string;
  getSub: (item: SearchItemBase) => string;
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
    color: "hsl(var(--kf-success))",
    getHref: (_i) => `/app/commerce?tab=invoices`,
    getTitle: (i) => i.invoiceNumber || `Invoice ${i.id?.slice(0, 8)}`,
    getSub: (i) => `${i.currency || "TTD"} ${i.total?.toFixed(2) ?? "0.00"} · ${i.status || ""}`,
  },
  {
    key: "bookings",
    label: "Bookings",
    icon: Calendar,
    color: "hsl(var(--kf-info))",
    getHref: () => `/app/bookings`,
    getTitle: (b) => {
      const name = b.contact ? [b.contact.firstName, b.contact.lastName].filter(Boolean).join(" ") : "";
      return `${b.service?.name || "Booking"} ${name ? `· ${name}` : ""}`;
    },
    getSub: (b) => `${b.startTime ? new Date(b.startTime).toLocaleDateString() : ""} · ${b.status ?? ""}`,
  },
  {
    key: "products",
    label: "Products",
    icon: Package,
    color: "hsl(var(--kf-warning))",
    getHref: () => `/app/store?tab=catalog`,
    getTitle: (p) => p.name ?? "Product",
    getSub: (p) => `${p.currency || "TTD"} ${p.price?.toFixed(2) ?? "0.00"}`,
  },
  {
    key: "projects",
    label: "Projects",
    icon: FolderKanban,
    color: "hsl(var(--kf-accent1))",
    getHref: () => `/app/projects`,
    getTitle: (p) => p.name ?? "Project",
    getSub: (p) => `${p.status || ""} · ${p.priority || ""}`,
  },
];

const RECENT_STORAGE_KEY = "kf-command-recent";

type RecentItem = {
  label: string;
  href: string;
  timestamp: number;
};

function getRecentItems(): RecentItem[] {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RecentItem[];
  } catch {
    return [];
  }
}

function addRecentItem(label: string, href: string) {
  const items = getRecentItems().filter((r) => r.href !== href);
  items.unshift({ label, href, timestamp: Date.now() });
  localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(items.slice(0, 5)));
}

function fuzzyMatch(text: string, query: string): boolean {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  if (lowerText.includes(lowerQuery)) return true;
  let qi = 0;
  for (let i = 0; i < lowerText.length && qi < lowerQuery.length; i++) {
    if (lowerText[i] === lowerQuery[qi]) qi++;
  }
  return qi === lowerQuery.length;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { open: openComposer } = useCompose();
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UniversalSearchResult>(EMPTY);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      setRecentItems(getRecentItems());
      setSelectedIdx(0);
    }
    if (!open) {
      setQuery("");
      setSearchResults(EMPTY);
      setSelectedIdx(0);
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

  const QUICK_ACTIONS: Action[] = useMemo(() => [
    { id: "new-contact", label: "New Contact", hint: "Add a contact", shortcut: "⌘⇧C", icon: Users, onSelect: () => router.push("/app/crm/contacts") },
    { id: "new-invoice", label: "New Invoice", hint: "Create an invoice", shortcut: "⌘⇧I", icon: Receipt, onSelect: () => router.push("/app/commerce") },
    { id: "new-booking", label: "New Booking", hint: "Schedule a booking", shortcut: "⌘⇧B", icon: Calendar, onSelect: () => router.push("/app/bookings") },
    { id: "new-expense", label: "New Expense", hint: "Log an expense", icon: Receipt, onSelect: () => router.push("/app/expenses") },
    { id: "new-project", label: "New Project", hint: "Start a project", icon: FolderKanban, onSelect: () => router.push("/app/projects") },
    { id: "new-quote", label: "New Quote", hint: "Draft a quote", icon: FileText, onSelect: () => router.push("/app/commerce?tab=quotes") },
    { id: "new-campaign", label: "New Campaign", hint: "Create a campaign", icon: Megaphone, onSelect: () => router.push("/app/marketing") },
    { id: "new-flow", label: "New Flow", hint: "Build an automation flow", icon: Zap, onSelect: () => router.push("/app/automations") },
  ], [router]);

  const NAV_ACTIONS: Action[] = useMemo(() => [
    { id: "nav-command-tower", label: "KEYFLOW", hint: "Operator headquarters · live brain", shortcut: "⌘1", icon: Zap, onSelect: () => router.push("/app/keyflow-command") },
    { id: "nav-clients", label: "Contacts", hint: "Network contacts", shortcut: "⌘2", icon: Users, onSelect: () => router.push("/app/crm/contacts") },
    { id: "nav-revenue", label: "Revenue", hint: "Quotes, invoices, payments, cashflow", shortcut: "⌘3", icon: Receipt, onSelect: () => router.push("/app/commerce") },
    { id: "nav-revenue-quotes", label: "Quotes", hint: "Revenue · Quotes tab", icon: FileText, onSelect: () => router.push("/app/commerce?tab=quotes") },
    { id: "nav-revenue-invoices", label: "Invoices", hint: "Revenue · Invoices tab", icon: Receipt, onSelect: () => router.push("/app/commerce?tab=invoices") },
    { id: "nav-revenue-payments", label: "Payments", hint: "Revenue · Payments tab", icon: Receipt, onSelect: () => router.push("/app/commerce?tab=payments") },
    { id: "nav-revenue-actions", label: "Cashflow Actions", hint: "Revenue · Actions queue", icon: Zap, onSelect: () => router.push("/app/commerce?tab=actions") },
    { id: "nav-calendar", label: "Calendar", hint: "Bookings & schedule", shortcut: "⌘4", icon: Calendar, onSelect: () => router.push("/app/bookings") },
    { id: "nav-content", label: "Content", hint: "Campaigns, social & lead forms", icon: Megaphone, onSelect: () => router.push("/app/marketing") },
    { id: "nav-flows", label: "Automations", hint: "Business automation & orchestration", icon: Zap, onSelect: () => router.push("/app/automations") },
    { id: "nav-expenses", label: "Expenses", hint: "Track spending & budgets", icon: Receipt, onSelect: () => router.push("/app/expenses") },
    { id: "nav-projects", label: "Projects", hint: "Kanban board & tasks", icon: FolderKanban, onSelect: () => router.push("/app/projects") },
    { id: "nav-reports", label: "Reports", hint: "Analytics & KPIs", icon: BarChart3, onSelect: () => router.push("/app/reports") },
    { id: "nav-studio", label: "Studio", hint: "Business configuration", icon: Settings, onSelect: () => router.push("/app/settings") },
    { id: "nav-presence", label: "Presence", hint: "Online storefront & booking page", icon: Store, onSelect: () => router.push("/app/store") },
    { id: "nav-branding", label: "Branding", hint: "Profile, brand & identity", icon: User, onSelect: () => router.push("/app/profile") },
  ], [router]);

  const filteredQuick = useMemo(() => {
    if (!query) return QUICK_ACTIONS;
    return QUICK_ACTIONS.filter(
      (a) => fuzzyMatch(a.label, query) || fuzzyMatch(a.hint || "", query),
    );
  }, [QUICK_ACTIONS, query]);

  const filteredNav = useMemo(() => {
    if (!query) return NAV_ACTIONS;
    return NAV_ACTIONS.filter(
      (a) => fuzzyMatch(a.label, query) || fuzzyMatch(a.hint || "", query),
    );
  }, [NAV_ACTIONS, query]);

  const UTILITY_ACTIONS: Action[] = useMemo(() => [
    { id: "toggle-theme", label: "Toggle Theme", hint: "Switch light / dark mode", icon: Moon, onSelect: () => {
      const html = document.documentElement;
      const current = html.classList.contains("dark");
      html.classList.toggle("dark", !current);
      localStorage.setItem("theme", current ? "light" : "dark");
    }},
    { id: "copy-url", label: "Copy Page URL", hint: "Copy current page link", icon: Copy, onSelect: () => {
      navigator.clipboard.writeText(window.location.href).catch(() => {});
    }},
    { id: "refresh-data", label: "Refresh Data", hint: "Reload dashboard data", icon: RotateCcw, onSelect: () => {
      window.dispatchEvent(new CustomEvent("kf:refresh"));
    }},
  ], [router]);

  const filteredUtility = useMemo(() => {
    if (!query) return UTILITY_ACTIONS;
    return UTILITY_ACTIONS.filter(
      (a) => fuzzyMatch(a.label, query) || fuzzyMatch(a.hint || "", query),
    );
  }, [UTILITY_ACTIONS, query]);

  const HELP_ACTIONS: Action[] = useMemo(() => [
    { id: "help-center", label: "Help Center", hint: "Browse guides & documentation", icon: BookOpen, onSelect: () => router.push("/app/help") },
    { id: "keyboard-shortcuts", label: "Keyboard Shortcuts", hint: "View all available shortcuts", icon: MessageSquare, onSelect: () => router.push("/app/help/shortcuts") },
    { id: "contact-support", label: "Contact Support", hint: "Get help from the Keyflow team", icon: LifeBuoy, onSelect: () => openComposer({ to: "support@keyflowos.com", subject: "Support request", body: "<p>Hi Keyflow support team,</p><p>I need help with the following:</p><p><br></p><p>Thanks,</p>" }) },
    { id: "whats-new", label: "What’s New", hint: "Latest features & updates", icon: HelpCircle, onSelect: () => router.push("/app/help/whats-new") },
  ], [router, openComposer]);

  const filteredHelp = useMemo(() => {
    if (!query) return HELP_ACTIONS;
    return HELP_ACTIONS.filter(
      (a) => fuzzyMatch(a.label, query) || fuzzyMatch(a.hint || "", query),
    );
  }, [HELP_ACTIONS, query]);

  const filteredRecent = useMemo(() => {
    if (query) return [];
    return recentItems;
  }, [recentItems, query]);

  const totalSearchResults = SEARCH_SECTIONS.reduce((sum, s) => sum + (searchResults[s.key]?.length ?? 0), 0);
  const hasSearch = query.trim().length >= 2;

  const handleNavigate = useCallback((href: string, label: string) => {
    addRecentItem(label, href);
    router.push(href);
    onClose();
  }, [router, onClose]);

  const flatItems = useMemo(() => {
    const items: { type: string; id: string; onSelect: () => void }[] = [];
    if (hasSearch && !searching) {
      for (const section of SEARCH_SECTIONS) {
        const sectionItems = searchResults[section.key];
        if (sectionItems && sectionItems.length > 0) {
          for (const item of sectionItems as SearchItemBase[]) {
            items.push({
              type: "search",
              id: `search-${section.key}-${item.id}`,
              onSelect: () => handleNavigate(section.getHref(item), section.getTitle(item)),
            });
          }
        }
      }
    }
    for (const r of filteredRecent) {
      items.push({ type: "recent", id: `recent-${r.href}`, onSelect: () => handleNavigate(r.href, r.label) });
    }
    for (const a of filteredQuick) {
      items.push({ type: "quick", id: a.id, onSelect: () => { a.onSelect(); onClose(); } });
    }
    for (const a of filteredNav) {
      items.push({ type: "nav", id: a.id, onSelect: () => { a.onSelect(); onClose(); } });
    }
    for (const a of filteredUtility) {
      items.push({ type: "utility", id: a.id, onSelect: () => { a.onSelect(); onClose(); } });
    }
    for (const a of filteredHelp) {
      items.push({ type: "help", id: a.id, onSelect: () => { a.onSelect(); onClose(); } });
    }
    return items;
  }, [hasSearch, searching, searchResults, filteredRecent, filteredQuick, filteredNav, handleNavigate, onClose]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((prev) => Math.min(prev + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && flatItems.length > 0) {
      e.preventDefault();
      flatItems[selectedIdx]?.onSelect();
    }
  }, [flatItems, selectedIdx]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selectedIdx}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  if (!open) return null;

  let itemIdx = -1;
  const getNextIdx = () => ++itemIdx;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm pt-[12vh]" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-2xl rounded-2xl border border-border/60 bg-card/95 shadow-2xl shadow-primary/20 relative overflow-hidden"
        style={{ backdropFilter: "blur(24px)" }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
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
          <kbd className="hidden sm:inline-flex px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono text-muted-foreground">⌘K</kbd>
          {query && (
            <button aria-label="Clear search" onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="max-h-[60vh] overflow-y-auto" ref={listRef}>
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
                    {(items as SearchItemBase[]).map((item) => {
                      const idx = getNextIdx();
                      return (
                        <button
                          key={item.id}
                          data-idx={idx}
                          onClick={() => handleNavigate(section.getHref(item), section.getTitle(item))}
                          className={cn(
                            "w-full text-left px-4 py-2.5 flex items-center gap-3 transition-all text-sm group rounded-lg mx-2",
                            selectedIdx === idx ? "bg-gradient-to-r from-orange-500/10 to-teal-500/5 border border-orange-500/10 shadow-sm" : "hover:bg-muted/40"
                          )}
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
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}

          {hasSearch && !searching && totalSearchResults === 0 && filteredNav.length === 0 && filteredQuick.length === 0 && (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">No results for &ldquo;{query}&rdquo;</div>
          )}

          {filteredRecent.length > 0 && (
            <div>
              <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 pt-2">
                <Clock className="w-3 h-3" />
                Recent
              </div>
              {filteredRecent.map((item) => {
                const idx = getNextIdx();
                return (
                  <button
                    key={item.href}
                    data-idx={idx}
                    onClick={() => handleNavigate(item.href, item.label)}
                    className={cn(
                      "w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 transition-colors text-sm",
                      selectedIdx === idx ? "bg-gradient-to-r from-orange-500/10 to-teal-500/5 border border-orange-500/10 shadow-sm rounded-lg mx-2" : "hover:bg-muted/40 rounded-lg mx-2"
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-foreground">{item.label}</span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          )}

          {filteredQuick.length > 0 && (
            <div>
              <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 pt-2">
                <Plus className="w-3 h-3" />
                Quick Actions
              </div>
              {filteredQuick.map((action) => {
                const idx = getNextIdx();
                const ActionIcon = action.icon;
                return (
                  <button
                    key={action.id}
                    data-idx={idx}
                    onClick={() => {
                      action.onSelect();
                      onClose();
                    }}
                    className={cn(
                      "w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 transition-colors text-sm",
                      selectedIdx === idx ? "bg-gradient-to-r from-orange-500/10 to-teal-500/5 border border-orange-500/10 shadow-sm rounded-lg mx-2" : "hover:bg-muted/40 rounded-lg mx-2"
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      {ActionIcon && <ActionIcon className="w-4 h-4 text-muted-foreground" />}
                      <div>
                        <div className="text-foreground">{action.label}</div>
                        {action.hint && <div className="text-[11px] text-muted-foreground">{action.hint}</div>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {action.shortcut && (
                        <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono text-muted-foreground">{action.shortcut}</kbd>
                      )}
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {filteredNav.length > 0 && (
            <div>
              <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 pt-2 border-t border-border/40 mt-1">
                <Zap className="w-3 h-3" />
                Navigate
              </div>
              {filteredNav.map((action) => {
                const idx = getNextIdx();
                const NavIcon = action.icon;
                return (
                  <button
                    key={action.id}
                    data-idx={idx}
                    onClick={() => {
                      action.onSelect();
                      onClose();
                    }}
                    className={cn(
                      "w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 transition-colors text-sm",
                      selectedIdx === idx ? "bg-gradient-to-r from-orange-500/10 to-teal-500/5 border border-orange-500/10 shadow-sm rounded-lg mx-2" : "hover:bg-muted/40 rounded-lg mx-2"
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      {NavIcon && <NavIcon className="w-4 h-4 text-muted-foreground" />}
                      <div>
                        <div className="text-foreground">{action.label}</div>
                        {action.hint && <div className="text-[11px] text-muted-foreground">{action.hint}</div>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {action.shortcut && (
                        <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono text-muted-foreground">{action.shortcut}</kbd>
                      )}
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {filteredUtility.length > 0 && (
            <div>
              <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 pt-2 border-t border-border/40 mt-1">
                <Wrench className="w-3 h-3" />
                Actions
              </div>
              {filteredUtility.map((action) => {
                const idx = getNextIdx();
                const ActionIcon = action.icon;
                return (
                  <button
                    key={action.id}
                    data-idx={idx}
                    onClick={() => {
                      action.onSelect();
                      onClose();
                    }}
                    className={cn(
                      "w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 transition-colors text-sm",
                      selectedIdx === idx ? "bg-gradient-to-r from-orange-500/10 to-teal-500/5 border border-orange-500/10 shadow-sm rounded-lg mx-2" : "hover:bg-muted/40 rounded-lg mx-2"
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      {ActionIcon && <ActionIcon className="w-4 h-4 text-muted-foreground" />}
                      <div>
                        <div className="text-foreground">{action.label}</div>
                        {action.hint && <div className="text-[11px] text-muted-foreground">{action.hint}</div>}
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          )}

          {filteredHelp.length > 0 && (
            <div>
              <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 pt-2 border-t border-border/40 mt-1">
                <HelpCircle className="w-3 h-3" />
                Help
              </div>
              {filteredHelp.map((action) => {
                const idx = getNextIdx();
                const HelpIcon = action.icon;
                return (
                  <button
                    key={action.id}
                    data-idx={idx}
                    onClick={() => {
                      action.onSelect();
                      onClose();
                    }}
                    className={cn(
                      "w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 transition-colors text-sm",
                      selectedIdx === idx ? "bg-gradient-to-r from-orange-500/10 to-teal-500/5 border border-orange-500/10 shadow-sm rounded-lg mx-2" : "hover:bg-muted/40 rounded-lg mx-2"
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      {HelpIcon && <HelpIcon className="w-4 h-4 text-muted-foreground" />}
                      <div>
                        <div className="text-foreground">{action.label}</div>
                        {action.hint && <div className="text-[11px] text-muted-foreground">{action.hint}</div>}
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="border-t border-border/60 px-4 py-2.5 flex items-center justify-between text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <ArrowUp className="w-3 h-3" /><ArrowDown className="w-3 h-3" /> Navigate
            </span>
            <span className="inline-flex items-center gap-1">
              <CornerDownLeft className="w-3 h-3" /> Select
            </span>
            <span>Esc close</span>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1">
            ⌘K
          </span>
        </div>
      </div>
    </div>
  );
}
