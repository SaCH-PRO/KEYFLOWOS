"use client";

import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  Sparkles, Search, X, Loader2,
  Brain, Zap, FileText, Receipt,
  ArrowRight, Filter, BarChart3,
  CheckCircle2, AlertTriangle, DollarSign,
  TrendingUp, Clock, Send, Ban,
  Eye, RefreshCw, Package, CreditCard,
} from "lucide-react";
import {
  commerceAiCommand,
  commerceAiExecute,
  type CommerceCommandResult,
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
}

const EXAMPLE_QUERIES = [
  "Create an invoice for John",
  "Mark invoice #42 as paid",
  "Send a reminder for overdue invoices",
  "Show me revenue this month",
  "Create a quote for web design",
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

export function CommerceAiSearchBar({ onExecuteCommand }: CommerceAiSearchBarProps) {
  const [query, setQuery] = useState("");
  const [commandResult, setCommandResult] = useState<CommerceCommandResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processInput = useCallback(async (searchQuery?: string) => {
    const q = (searchQuery ?? query).trim();
    if (!q) return;
    setLoading(true);
    setCommandResult(null);

    try {
      const cmdResult = await commerceAiCommand(q);
      if (cmdResult.data) {
        setCommandResult(cmdResult.data);
      } else {
        toast.error(cmdResult.error ?? "Failed to interpret command");
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
    setFocused(false);
  };

  const handleExampleClick = (example: string) => {
    setQuery(example);
    processInput(example);
  };

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
        onExecuteCommand({ type: "switch_tab", tab: (params?.tab as string) ?? "products" });
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
          placeholder='AI Commerce: "Create invoice", "Show overdue", "Cash flow forecast"'
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

      {focused && !commandResult && !loading && !query && (
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
              Manage invoices, quotes & products — the AI handles commerce commands
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
