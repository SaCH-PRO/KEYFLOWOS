"use client";

import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  Sparkles,
  Search,
  X,
  Loader2,
  User,
  Building2,
  Tag,
  ArrowRight,
  Brain,
  Zap,
  UserPlus,
  FileEdit,
  Phone,
  MessageSquare,
  Star,
  Filter,
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  ListPlus,
  GitMerge,
  Users,
  Trash2,
  ScanSearch,
  ClipboardCheck,
  FileText,
  Receipt,
  PlayCircle,
  StopCircle,
  TrendingUp,
} from "lucide-react";
import { aiNaturalLanguageSearch, aiInterpretCommand, type AiSearchResult, type AiCommandResult } from "@/lib/client";

export type CrmCommand =

  | { type: "add_contact"; params?: Record<string, unknown> }
  | { type: "edit_contact"; contactId: string }
  | { type: "delete_contact"; contactId: string }
  | { type: "view_contact"; contactId: string }
  | { type: "change_status"; contactId: string; status: string }
  | { type: "add_note"; contactId: string; body?: string }
  | { type: "add_task"; contactId: string; title?: string }
  | { type: "log_communication"; contactId: string; channel?: string }
  | { type: "switch_tab"; tab: string }
  | { type: "filter_status"; status: string }
  | { type: "open_broadcast" }
  | { type: "import_contacts" }
  | { type: "show_favorites" }
  | { type: "toggle_favorite"; contactId: string }
  | { type: "bulk_tag"; tags: string[] }
  | { type: "generate_ai_summary"; contactId: string }
  | { type: "generate_ai_score"; contactId: string }
  | { type: "generate_prep_brief"; contactId: string }
  | { type: "suggest_tags"; contactId: string }
  | { type: "search_contacts"; query: string }

  | { type: "enroll_sequence"; contactId: string; params: Record<string, unknown> }

  | { type: "unenroll_sequence"; contactId: string; params: Record<string, unknown> }

  | { type: "create_list"; params: Record<string, unknown> }

  | { type: "add_to_list"; contactId: string; params: Record<string, unknown> }

  | { type: "remove_from_list"; contactId: string; params: Record<string, unknown> }

  | { type: "merge_contacts"; params: Record<string, unknown> }

  | { type: "bulk_status_change"; params: Record<string, unknown> }

  | { type: "bulk_delete"; params: Record<string, unknown> }
  | { type: "find_duplicates" }
  | { type: "data_cleanup" }

  | { type: "create_quote"; contactId: string; params?: Record<string, unknown> }

  | { type: "create_invoice"; contactId: string; params?: Record<string, unknown> }
  | { type: "generate_follow_up"; contactId: string }
  | { type: "revenue_scan" }
  | { type: "reengagement_scan" }

  | { type: "ai_execute"; action: string; contactId?: string; params?: Record<string, unknown> };

interface AiSearchBarProps {
  onSelectContact?: (contactId: string) => void;

  onApplyFilters?: (filters: Record<string, unknown>) => void;
  onExecuteCommand?: (command: CrmCommand) => void;
}

const EXAMPLE_QUERIES = [
  "Enroll John in the onboarding sequence",
  "Find duplicate contacts",
  "Show me stale leads that need re-engagement",
  "Create a VIP Clients list",
  "Draft a follow-up message for...",
  "Scan for revenue opportunities",
  "Change all leads tagged 'cold' to lost",
  "Add a note to...",
];

const ACTION_ICONS: Record<string, typeof Zap> = {
  add_contact: UserPlus,
  edit_contact: FileEdit,
  view_contact: User,
  delete_contact: Trash2,
  log_communication: Phone,
  switch_tab: BarChart3,
  filter_status: Filter,
  open_broadcast: MessageSquare,
  import_contacts: UserPlus,
  show_favorites: Star,
  toggle_favorite: Star,
  generate_ai_summary: Sparkles,
  generate_ai_score: Sparkles,
  generate_prep_brief: Brain,
  suggest_tags: Tag,
  enroll_sequence: PlayCircle,
  unenroll_sequence: StopCircle,
  create_list: ListPlus,
  add_to_list: ListPlus,
  remove_from_list: ListPlus,
  merge_contacts: GitMerge,
  bulk_status_change: Users,
  bulk_delete: Trash2,
  find_duplicates: ScanSearch,
  data_cleanup: ClipboardCheck,
  generate_follow_up: MessageSquare,
  create_quote: FileText,
  create_invoice: Receipt,
  revenue_scan: TrendingUp,
  reengagement_scan: Users,
};

export function AiSearchBar({ onSelectContact, onApplyFilters, onExecuteCommand }: AiSearchBarProps) {
  const [query, setQuery] = useState("");
  const [data, setData] = useState<AiSearchResult | null>(null);
  const [commandResult, setCommandResult] = useState<AiCommandResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processInput = useCallback(async (searchQuery?: string) => {
    const q = (searchQuery ?? query).trim();
    if (!q) return;
    setLoading(true);
    setData(null);
    setCommandResult(null);

    try {
      const cmdResult = await aiInterpretCommand(q);
      if (cmdResult.data?.isAction) {
        if (cmdResult.data.action === "ambiguous_contact" || cmdResult.data.confidence >= 0.5) {
          setCommandResult(cmdResult.data);
          return;
        }
      }

      const searchResult = await aiNaturalLanguageSearch(q);
      if (searchResult.data) {
        setData(searchResult.data);
      } else {
        toast.error(searchResult.error ?? "Search failed");
      }
    } catch {
      toast.error("AI processing failed");
    } finally {
      setLoading(false);
    }
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      processInput();
    }
    if (e.key === "Escape") {
      clear();
    }
  };

  const clear = () => {
    setQuery("");
    setData(null);
    setCommandResult(null);
    setFocused(false);
  };

  const handleExampleClick = (example: string) => {
    setQuery(example);
    processInput(example);
  };

  const executeCommand = useCallback((cmd: AiCommandResult) => {
    if (!onExecuteCommand) {
      toast.error("Command execution not available");
      return;
    }

    const { action, contactId, params } = cmd;

    const needsContact = [
      "edit_contact", "delete_contact", "view_contact", "change_status",
      "add_note", "add_task", "log_communication", "toggle_favorite",
      "generate_ai_summary", "generate_ai_score", "generate_prep_brief", "suggest_tags",
    ];
    if (needsContact.includes(action) && !contactId) {
      toast.error("Could not determine which contact you mean — try being more specific");
      return;
    }

    switch (action) {
      case "add_contact":
        onExecuteCommand({ type: "add_contact", params: params ?? {} });
        break;
      case "edit_contact":
        onExecuteCommand({ type: "edit_contact", contactId: contactId! });
        break;
      case "delete_contact":
        onExecuteCommand({ type: "delete_contact", contactId: contactId! });
        break;
      case "view_contact":
        onExecuteCommand({ type: "view_contact", contactId: contactId! });
        break;
      case "switch_tab":
        onExecuteCommand({ type: "switch_tab", tab: (params?.tab as string) ?? "contacts" });
        break;
      case "filter_status":
        onExecuteCommand({ type: "filter_status", status: (params?.status as string) ?? "all" });
        break;
      case "open_broadcast":
        onExecuteCommand({ type: "open_broadcast" });
        break;
      case "import_contacts":
        onExecuteCommand({ type: "import_contacts" });
        break;
      case "show_favorites":
        onExecuteCommand({ type: "show_favorites" });
        break;
      case "bulk_tag":
        onExecuteCommand({ type: "bulk_tag", tags: (params?.tags as string[]) ?? [] });
        break;
      case "generate_ai_summary":
        onExecuteCommand({ type: "generate_ai_summary", contactId: contactId! });
        break;
      case "generate_ai_score":
        onExecuteCommand({ type: "generate_ai_score", contactId: contactId! });
        break;
      case "generate_prep_brief":
        onExecuteCommand({ type: "generate_prep_brief", contactId: contactId! });
        break;
      case "suggest_tags":
        onExecuteCommand({ type: "suggest_tags", contactId: contactId! });
        break;
      case "search_contacts":
        onExecuteCommand({ type: "search_contacts", query: (params?.query as string) ?? query });
        break;
      case "enroll_sequence":
        onExecuteCommand({ type: "ai_execute", action: "enroll_sequence", contactId: contactId ?? undefined, params: params ?? {} });
        break;
      case "unenroll_sequence":
        onExecuteCommand({ type: "ai_execute", action: "unenroll_sequence", contactId: contactId ?? undefined, params: params ?? {} });
        break;
      case "create_list":
        onExecuteCommand({ type: "ai_execute", action: "create_list", params: params ?? {} });
        break;
      case "add_to_list":
        onExecuteCommand({ type: "ai_execute", action: "add_to_list", contactId: contactId ?? undefined, params: params ?? {} });
        break;
      case "remove_from_list":
        onExecuteCommand({ type: "ai_execute", action: "remove_from_list", contactId: contactId ?? undefined, params: params ?? {} });
        break;
      case "merge_contacts":
        onExecuteCommand({ type: "merge_contacts", params: params ?? {} });
        break;
      case "bulk_status_change":
        onExecuteCommand({ type: "ai_execute", action: "bulk_status_change", params: params ?? {} });
        break;
      case "bulk_delete":
        toast.warning(cmd.confirmation || "Bulk delete requested — please confirm in the UI");
        onExecuteCommand({ type: "bulk_delete", params: params ?? {} });
        break;
      case "find_duplicates":
        onExecuteCommand({ type: "find_duplicates" });
        break;
      case "data_cleanup":
        onExecuteCommand({ type: "data_cleanup" });
        break;
      case "create_quote":
        onExecuteCommand({ type: "create_quote", contactId: contactId!, params: params ?? {} });
        break;
      case "create_invoice":
        onExecuteCommand({ type: "create_invoice", contactId: contactId!, params: params ?? {} });
        break;
      case "generate_follow_up":
        onExecuteCommand({ type: "generate_follow_up", contactId: contactId! });
        break;
      case "revenue_scan":
        onExecuteCommand({ type: "revenue_scan" });
        break;
      case "reengagement_scan":
        onExecuteCommand({ type: "reengagement_scan" });
        break;
      case "add_note":
        if (contactId && params?.body) {
          onExecuteCommand({ type: "ai_execute", action: "add_note", contactId, params: params ?? {} });
        } else {
          onExecuteCommand({ type: "add_note", contactId: contactId!, body: params?.body as string | undefined });
        }
        break;
      case "add_task":
        if (contactId && params?.title) {
          onExecuteCommand({ type: "ai_execute", action: "add_task", contactId, params: params ?? {} });
        } else {
          onExecuteCommand({ type: "add_task", contactId: contactId!, title: params?.title as string | undefined });
        }
        break;
      case "change_status":
        if (contactId && params?.status) {
          onExecuteCommand({ type: "ai_execute", action: "change_status", contactId, params: params ?? {} });
        } else {
          const status = (params?.status as string) || "";
          onExecuteCommand({ type: "change_status", contactId: contactId!, status });
        }
        break;
      case "toggle_favorite":
        onExecuteCommand({ type: "ai_execute", action: "toggle_favorite", contactId: contactId ?? undefined });
        break;
      case "log_communication":
        if (contactId && params?.channel) {
          onExecuteCommand({ type: "ai_execute", action: "log_communication", contactId, params: params ?? {} });
        } else {
          onExecuteCommand({ type: "log_communication", contactId: contactId!, channel: params?.channel as string | undefined });
        }
        break;
      default:
        toast.info(cmd.confirmation || "Command not recognized");
        return;
    }
    clear();
  }, [onExecuteCommand, query]);

  const contactName = (c: AiSearchResult["contacts"][0]) => {
    const name = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim();
    return name || c.email || "Unnamed";
  };

  const ActionIcon = commandResult ? (ACTION_ICONS[commandResult.action] ?? Zap) : Zap;

  return (
    <div className="relative">
      <div className={`flex items-center gap-2 rounded-xl border ${focused ? 'border-[hsl(var(--kf-accent1))]/40 bg-[hsl(var(--kf-accent1))]/[0.03]' : 'border-border/50 bg-card'} px-3 py-2 transition-colors`}>
        {loading ? (
          <Loader2 className="w-4 h-4 text-[hsl(var(--kf-accent1))] animate-spin shrink-0" />
        ) : (
          <Brain className="w-4 h-4 text-[hsl(var(--kf-accent1))]/70 shrink-0" />
        )}
        <input
          ref={inputRef}
          data-ai-search
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 300)}
          placeholder='AI Assistant: "Add a contact", "Show insights", "Prepare brief for..."'
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none"
        />
        {query && (
          <button onClick={clear} className="p-0.5 rounded hover:bg-white/10">
            <X className="w-3.5 h-3.5 text-muted-foreground/50" />
          </button>
        )}
        <button
          onClick={() => processInput()}
          disabled={!query.trim() || loading}
          className="p-1 rounded-lg bg-[hsl(var(--kf-accent1))]/10 hover:bg-[hsl(var(--kf-accent1))]/20 disabled:opacity-30 transition-colors"
        >
          <Search className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
        </button>
      </div>

      {focused && !data && !commandResult && !loading && !query && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-border/50 bg-card p-3 shadow-xl z-50">
          <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-2 block">Try saying</span>
          <div className="space-y-1">
            {EXAMPLE_QUERIES.map((ex, i) => (
              <button
                key={i}
                onClick={() => handleExampleClick(ex)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors text-left"
              >
                {i < 3 ? (
                  <Zap className="w-3 h-3 text-[hsl(var(--kf-accent2))]/60 shrink-0" />
                ) : (
                  <Sparkles className="w-3 h-3 text-[hsl(var(--kf-accent1))]/50 shrink-0" />
                )}
                <span className="text-xs text-foreground/70">{ex}</span>
              </button>
            ))}
          </div>
          <div className="mt-2 pt-2 border-t border-border/20">
            <span className="text-[10px] text-muted-foreground/50">
              Search contacts or give commands — the AI handles both
            </span>
          </div>
        </div>
      )}

      {commandResult && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-[hsl(var(--kf-accent2))]/30 bg-card shadow-xl z-50 overflow-hidden">
          <div className="p-3 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent1))]/20 to-[hsl(var(--kf-accent2))]/20 flex items-center justify-center shrink-0">
                <ActionIcon className="w-4.5 h-4.5 text-[hsl(var(--kf-accent1))]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-semibold text-foreground/90">AI Action</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                    commandResult.confidence >= 0.8
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : commandResult.confidence >= 0.6
                      ? 'bg-amber-500/10 text-amber-400'
                      : 'bg-red-500/10 text-red-400'
                  }`}>
                    {Math.round(commandResult.confidence * 100)}% confident
                  </span>
                </div>
                <p className="text-sm text-foreground/80 leading-relaxed">{commandResult.confirmation}</p>
                {commandResult.contactName && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <User className="w-3 h-3 text-muted-foreground/60" />
                    <span className="text-xs text-muted-foreground/70">{commandResult.contactName}</span>
                  </div>
                )}
              </div>
            </div>

            {commandResult.action === "ambiguous_contact" && Array.isArray(commandResult.params?.candidates) && (
              <div className="space-y-1 ml-12">
                <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">Did you mean?</span>
                {(commandResult.params.candidates as Array<{ id: string; name: string }>).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      onSelectContact?.(c.id);
                      clear();
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors text-left"
                  >
                    <User className="w-3.5 h-3.5 text-muted-foreground/50" />
                    <span className="text-xs text-foreground/70">{c.name}</span>
                    <ArrowRight className="w-3 h-3 text-muted-foreground/30 ml-auto" />
                  </button>
                ))}
              </div>
            )}

            {commandResult.action !== "ambiguous_contact" && (
              <div className="flex items-center gap-2 ml-12">
                <button
                  onClick={() => executeCommand(commandResult)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[hsl(var(--kf-accent1))]/15 hover:bg-[hsl(var(--kf-accent1))]/25 text-[hsl(var(--kf-accent1))] text-xs font-medium transition-colors"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Execute
                </button>
                <button
                  onClick={clear}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-white/[0.04] text-muted-foreground/70 text-xs transition-colors"
                >
                  Cancel
                </button>
                {commandResult.confidence < 0.7 && (
                  <span className="flex items-center gap-1 text-[10px] text-amber-400/70 ml-auto">
                    <AlertTriangle className="w-3 h-3" />
                    Low confidence — verify action
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {data && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-border/50 bg-card shadow-xl z-50 max-h-[400px] overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-border/30 shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-xs text-foreground/80">{data.interpretation}</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground/50">{data.totalResults} results</span>
                {onApplyFilters && Object.keys(data.filters).length > 0 && (
                  <button
                    onClick={() => { onApplyFilters(data.filters); clear(); }}
                    className="text-[10px] font-medium text-[hsl(var(--kf-accent1))] hover:underline"
                  >
                    Apply filters
                  </button>
                )}
                <button onClick={clear} className="p-0.5 rounded hover:bg-white/10">
                  <X className="w-3 h-3 text-muted-foreground/50" />
                </button>
              </div>
            </div>
            {data.confidence < 0.7 && (
              <span className="text-[10px] text-amber-400/70 block mt-0.5">Low confidence — try rephrasing your question</span>
            )}
          </div>

          <div className="overflow-y-auto flex-1">
            {data.contacts.length === 0 ? (
              <div className="p-6 text-center">
                <span className="text-sm text-muted-foreground/60">No contacts match this query</span>
              </div>
            ) : (
              <div className="p-1.5 space-y-0.5">
                {data.contacts.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { onSelectContact?.(c.id); clear(); }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-white/[0.04] transition-colors text-left group"
                  >
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[hsl(var(--kf-accent1))]/20 to-[hsl(var(--kf-accent2))]/20 flex items-center justify-center shrink-0">
                      <User className="w-4 h-4 text-foreground/50" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-foreground/90 truncate">{contactName(c)}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          c.status === 'CLIENT' ? 'bg-emerald-500/10 text-emerald-400' :
                          c.status === 'PROSPECT' ? 'bg-blue-500/10 text-blue-400' :
                          c.status === 'LEAD' ? 'bg-purple-500/10 text-purple-400' :
                          'bg-muted text-muted-foreground'
                        }`}>
                          {c.status}
                        </span>
                        {c.leadScore != null && (
                          <span className="text-[10px] text-muted-foreground/60">Score: {c.leadScore}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
                        {c.companyName && (
                          <span className="flex items-center gap-0.5 truncate">
                            <Building2 className="w-2.5 h-2.5" /> {c.companyName}
                          </span>
                        )}
                        {c.email && <span className="truncate">{c.email}</span>}
                      </div>
                      {c.tags.length > 0 && (
                        <div className="flex gap-1 mt-0.5">
                          {c.tags.slice(0, 3).map((tag, ti) => (
                            <span key={ti} className="text-[10px] px-1 py-0.5 rounded bg-white/5 text-muted-foreground/60">
                              <Tag className="w-2 h-2 inline mr-0.5" />{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-[hsl(var(--kf-accent1))] transition-colors shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
