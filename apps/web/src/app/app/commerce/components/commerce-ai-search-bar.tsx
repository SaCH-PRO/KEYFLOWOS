"use client";

import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  Sparkles,
  Search,
  X,
  Loader2,
  Brain,
  Zap,
  FileText,
  Receipt,
  ArrowRight,
  Filter,
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  DollarSign,
  TrendingUp,
  Clock,
  Send,
  Ban,
  Eye,
  RefreshCw,
  Package,
  CreditCard,
} from "lucide-react";
import {
  commerceAiCommand,
  commerceAiExecute,
  commerceAiSearch,
  type CommerceCommandResult,
  type CommerceNlSearchResult,
} from "@/lib/client";

export type CommerceCommand =

  | { type: "create_invoice"; params?: Record<string, unknown> }

  | { type: "create_quote"; params?: Record<string, unknown> }
  | { type: "create_quote_for_contact"; contactId: string; contactName?: string; productIds?: string[] }
  | { type: "create_invoice_for_contact"; contactId: string; contactName?: string; productIds?: string[] }

  | { type: "mark_paid"; invoiceId?: string; params?: Record<string, unknown> }

  | { type: "send_reminder"; invoiceId?: string; params?: Record<string, unknown> }

  | { type: "void_invoice"; invoiceId?: string; params?: Record<string, unknown> }

  | { type: "view_invoice"; invoiceId?: string; params?: Record<string, unknown> }
  | { type: "switch_tab"; tab: string }
  | { type: "filter_status"; status: string }
  | { type: "show_overdue" }
  | { type: "generate_ai_analysis" }

  | { type: "ai_execute"; action: string; params?: Record<string, unknown> };

interface CommerceAiSearchBarProps {
  onExecuteCommand?: (command: CommerceCommand) => void;
  onSelectResult?: (result: { id: string; type: string }) => void;

  onApplyFilters?: (filters: Record<string, unknown>) => void;
  currency?: string;
}

const EXAMPLE_QUERIES = [
  "Show invoices over $5000",
  "Find products with no sales",
  "Quotes from last month",
  "Create an invoice for John",
  "Mark invoice #42 as paid",
  "What's my cash flow forecast?",
  "Show all overdue invoices",
  "Switch to products tab",
];

const ACTION_ICONS: Record<string, typeof Zap> = {
  create_invoice: Receipt,
  create_quote: FileText,
  create_quote_for_contact: FileText,
  create_invoice_for_contact: Receipt,
  mark_paid: CheckCircle2,
  send_reminder: Send,
  void_invoice: Ban,
  view_invoice: Eye,
  switch_tab: BarChart3,
  filter_status: Filter,
  show_overdue: Clock,
  generate_ai_analysis: TrendingUp,
  ai_execute: Zap,
  analyze_revenue: TrendingUp,
  cash_flow_forecast: DollarSign,
  pricing_suggestion: Package,
  create_product: Package,
  update_product: RefreshCw,
  list_invoices: Receipt,
  list_products: Package,
  apply_discount: CreditCard,
};

const RESULT_TYPE_ICONS: Record<string, typeof Zap> = {
  products: Package,
  invoices: Receipt,
  quotes: FileText,
  product: Package,
  invoice: Receipt,
  quote: FileText,
};

const RESULT_TYPE_COLORS: Record<string, string> = {
  products: "bg-blue-500/10 text-blue-400",
  invoices: "bg-emerald-500/10 text-emerald-400",
  quotes: "bg-purple-500/10 text-purple-400",
  product: "bg-blue-500/10 text-blue-400",
  invoice: "bg-emerald-500/10 text-emerald-400",
  quote: "bg-purple-500/10 text-purple-400",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM/AI tool result payload — shape varies by toolId, pending shared schema contract
function mapSearchResult(type: string, r: Record<string, any>): { id: string; type: string; name: string; status?: string; total?: number; date?: string } {
  if (type === "products") {
    return { id: r.id, type: "product", name: r.name || "Untitled", status: r.isActive ? "ACTIVE" : "INACTIVE", total: r.price ? Number(r.price) : undefined };
  }
  if (type === "invoices") {
    const cn = r.contact ? `${r.contact.firstName ?? ""} ${r.contact.lastName ?? ""}`.trim() : "";
    return { id: r.id, type: "invoice", name: r.invoiceNumber ? `${r.invoiceNumber}${cn ? ` — ${cn}` : ""}` : cn || "Invoice", status: r.status, total: r.total ? Number(r.total) : undefined, date: r.createdAt };
  }
  if (type === "quotes") {
    const cn = r.contact ? `${r.contact.firstName ?? ""} ${r.contact.lastName ?? ""}`.trim() : "";
    return { id: r.id, type: "quote", name: r.quoteNumber ? `${r.quoteNumber}${cn ? ` — ${cn}` : ""}` : cn || "Quote", status: r.status, total: r.total ? Number(r.total) : undefined, date: r.createdAt };
  }
  return { id: r.id, type, name: r.name || r.invoiceNumber || r.quoteNumber || "Item" };
}

const STATUS_COLORS: Record<string, string> = {
  PAID: "bg-emerald-500/10 text-emerald-400",
  SENT: "bg-blue-500/10 text-blue-400",
  DRAFT: "bg-muted text-muted-foreground",
  OVERDUE: "bg-red-500/10 text-red-400",
  VOID: "bg-muted text-muted-foreground",
  ACCEPTED: "bg-emerald-500/10 text-emerald-400",
  DECLINED: "bg-red-500/10 text-red-400",
  PENDING: "bg-amber-500/10 text-amber-400",
  ACTIVE: "bg-emerald-500/10 text-emerald-400",
  INACTIVE: "bg-muted text-muted-foreground",
};

export function CommerceAiSearchBar({ onExecuteCommand, onSelectResult, onApplyFilters, currency: businessCurrency }: CommerceAiSearchBarProps) {
  const [query, setQuery] = useState("");
  const [commandResult, setCommandResult] = useState<CommerceCommandResult | null>(null);
  const [searchData, setSearchData] = useState<CommerceNlSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processInput = useCallback(async (searchQuery?: string) => {
    const q = (searchQuery ?? query).trim();
    if (!q) return;
    setLoading(true);
    setCommandResult(null);
    setSearchData(null);

    try {
      const cmdResult = await commerceAiCommand(q);
      if (cmdResult.data?.isAction && cmdResult.data.confidence >= 0.5) {
        setCommandResult(cmdResult.data);
        return;
      }

      const searchResult = await commerceAiSearch(q);
      if (searchResult.data) {
        setSearchData(searchResult.data);
      } else if (cmdResult.data) {
        setCommandResult(cmdResult.data);
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
    setCommandResult(null);
    setSearchData(null);
    setFocused(false);
  };

  const handleExampleClick = (example: string) => {
    setQuery(example);
    processInput(example);
  };

  const handleResultClick = useCallback((result: { id: string; type: string }) => {
    if (onSelectResult) {
      onSelectResult(result);
    }
    clear();
  }, [onSelectResult]);

  const executeCommand = useCallback(async (cmd: CommerceCommandResult) => {
    if (!onExecuteCommand) {
      toast.error("Command execution not available");
      return;
    }

    const { action, params } = cmd;

    switch (action) {
      case "create_invoice":
        onExecuteCommand({ type: "create_invoice", params: params ?? {} });
        break;
      case "create_quote":
        onExecuteCommand({ type: "create_quote", params: params ?? {} });
        break;
      case "create_quote_for_contact":
        onExecuteCommand({
          type: "create_quote_for_contact",
          contactId: (params?.contactId as string) ?? "",
          contactName: (params?.contactName as string) ?? undefined,
          productIds: (params?.productIds as string[]) ?? undefined,
        });
        break;
      case "create_invoice_for_contact":
        onExecuteCommand({
          type: "create_invoice_for_contact",
          contactId: (params?.contactId as string) ?? "",
          contactName: (params?.contactName as string) ?? undefined,
          productIds: (params?.productIds as string[]) ?? undefined,
        });
        break;
      case "mark_paid":
        onExecuteCommand({
          type: "mark_paid",
          invoiceId: (params?.invoiceId as string) ?? undefined,
          params: params ?? {},
        });
        break;
      case "send_reminder":
        onExecuteCommand({
          type: "send_reminder",
          invoiceId: (params?.invoiceId as string) ?? undefined,
          params: params ?? {},
        });
        break;
      case "void_invoice":
        onExecuteCommand({
          type: "void_invoice",
          invoiceId: (params?.invoiceId as string) ?? undefined,
          params: params ?? {},
        });
        break;
      case "view_invoice":
        onExecuteCommand({
          type: "view_invoice",
          invoiceId: (params?.invoiceId as string) ?? undefined,
          params: params ?? {},
        });
        break;
      case "switch_tab":
        onExecuteCommand({ type: "switch_tab", tab: (params?.tab as string) ?? "invoices" });
        break;
      case "filter_status":
        onExecuteCommand({ type: "filter_status", status: (params?.status as string) ?? "all" });
        break;
      case "show_overdue":
        onExecuteCommand({ type: "show_overdue" });
        break;
      case "generate_ai_analysis":
      case "analyze_revenue":
        onExecuteCommand({ type: "generate_ai_analysis" });
        break;
      case "cash_flow_forecast":
      case "pricing_suggestion":
      case "create_product":
      case "update_product":
      case "list_invoices":
      case "list_products":
      case "apply_discount": {
        const res = await commerceAiExecute(action, params ?? {});
        if (res.data?.success) {
          toast.success(res.data.message ?? "Action completed");
        } else {
          toast.error(res.data?.error ?? res.error ?? "Action failed");
        }
        onExecuteCommand({ type: "ai_execute", action, params: params ?? {} });
        break;
      }
      default:
        onExecuteCommand({ type: "ai_execute", action: action ?? "unknown", params: params ?? {} });
        break;
    }
    clear();
  }, [onExecuteCommand]);

  const formatCurrency = (amount?: number) => {
    if (amount == null) return "";
    return new Intl.NumberFormat("en-TT", { style: "currency", currency: businessCurrency || "TTD", minimumFractionDigits: 0 }).format(amount);
  };

  const ActionIcon = commandResult ? (ACTION_ICONS[commandResult.action ?? ""] ?? Zap) : Zap;

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
          data-commerce-ai-search
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 300)}
          placeholder='AI Commerce: "Show invoices over $5000", "Find products with no sales", "Mark paid"'
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

      {focused && !commandResult && !searchData && !loading && !query && (
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
                  <Search className="w-3 h-3 text-[hsl(var(--kf-accent2))]/60 shrink-0" />
                ) : i < 6 ? (
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
              Search products, invoices & quotes or give commands — the AI handles both
            </span>
          </div>
        </div>
      )}

      {searchData && (() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM/AI tool result payload — shape varies by toolId, pending shared schema contract
        const mappedResults = (searchData.results || []).map((r: Record<string, any>) => mapSearchResult(searchData.type, r));
        return (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-border/50 bg-card shadow-xl z-50 max-h-[400px] overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-border/30 shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-xs text-foreground/80">{searchData.interpretation}</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground/50">{mappedResults.length} results</span>
                {searchData.confidence > 0 && (
                  <span className="text-[10px] text-muted-foreground/40">{Math.round(searchData.confidence * 100)}%</span>
                )}
                {onApplyFilters && Object.keys(searchData.filters || {}).length > 0 && (
                  <button
                    onClick={() => { onApplyFilters(searchData.filters); clear(); }}
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
          </div>

          <div className="overflow-y-auto flex-1">
            {mappedResults.length === 0 ? (
              <div className="p-6 text-center">
                <span className="text-sm text-muted-foreground/60">No results match this query</span>
              </div>
            ) : (
              <div className="p-1.5 space-y-0.5">
                {mappedResults.map((r) => {
                  const TypeIcon = RESULT_TYPE_ICONS[r.type] ?? Package;
                  const typeColor = RESULT_TYPE_COLORS[r.type] ?? "bg-muted text-muted-foreground";
                  const statusColor = STATUS_COLORS[r.status ?? ""] ?? "bg-muted text-muted-foreground";

                  return (
                    <button
                      key={r.id}
                      onClick={() => handleResultClick(r)}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-white/[0.04] transition-colors text-left group"
                    >
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[hsl(var(--kf-accent1))]/20 to-[hsl(var(--kf-accent2))]/20 flex items-center justify-center shrink-0">
                        <TypeIcon className="w-4 h-4 text-foreground/50" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-foreground/90 truncate">{r.name}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${typeColor}`}>
                            {r.type}
                          </span>
                          {r.status && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusColor}`}>
                              {r.status}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
                          {r.total != null && (
                            <span className="flex items-center gap-0.5">
                              <DollarSign className="w-2.5 h-2.5" /> {formatCurrency(r.total)}
                            </span>
                          )}
                          {r.date && (
                            <span className="flex items-center gap-0.5">
                              <Clock className="w-2.5 h-2.5" /> {new Date(r.date).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-[hsl(var(--kf-accent1))] transition-colors shrink-0" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        );
      })()}

      {commandResult && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-[hsl(var(--kf-accent2))]/30 bg-card shadow-xl z-50 overflow-hidden">
          <div className="p-3 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent1))]/20 to-[hsl(var(--kf-accent2))]/20 flex items-center justify-center shrink-0">
                <ActionIcon className="w-4.5 h-4.5 text-[hsl(var(--kf-accent1))]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-semibold text-foreground/90">AI Commerce Action</span>
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
              </div>
            </div>

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
          </div>
        </div>
      )}
    </div>
  );
}
