"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Receipt, Plus, Trash2, Pencil, X, ChevronDown, ChevronRight,
  ArrowUpDown, Filter, DollarSign, TrendingUp, TrendingDown, Tag,
  BarChart3, Palette, Upload, Image, Calculator, Search, Download,
  CreditCard, Wallet, Building2, Store, Eye, ArrowUp, ArrowDown,
  Minus, AlertTriangle, Target, PieChart, CalendarDays, RefreshCw,
  FileText, ExternalLink, Clock, Repeat,
} from "lucide-react";
import {
  fetchExpenses, createExpense, updateExpense, deleteExpense,
  fetchExpenseCategories, createExpenseCategory, deleteExpenseCategory,
  fetchExpenseSummary, fetchVendorAnalytics, fetchExpenseBudgets,
  upsertExpenseBudget, deleteExpenseBudget, getExpenseExportUrl,
  Expense, ExpenseCategory, ExpenseSummary, VendorAnalytics, ExpenseBudget,
  PAYMENT_METHODS,
} from "@/lib/client";
import { API_BASE, getAuthHeaders } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { StatCards } from "@/components/ui/stat-cards";

const CATEGORY_COLORS = [
  "#f97316", "#ef4444", "#8b5cf6", "#06b6d4", "#22c55e",
  "#eab308", "#ec4899", "#6366f1", "#14b8a6", "#f43f5e",
];

const PERIODS = [
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
  { value: "90d", label: "90 Days" },
  { value: "ytd", label: "Year to Date" },
  { value: "12m", label: "12 Months" },
];

const PAYMENT_ICONS: Record<string, typeof CreditCard> = {
  cash: Wallet, card: CreditCard, bank_transfer: Building2, linx: CreditCard,
  mobile_money: Wallet, cheque: FileText, other: DollarSign, unspecified: DollarSign,
};

function formatCurrency(amount: number): string {
  return `TTD $${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function getDateRange(period: string): { startDate: string; endDate: string } {
  const now = new Date();
  const end = now.toISOString().split("T")[0];
  let start: Date;
  switch (period) {
    case "7d": start = new Date(now.getTime() - 7 * 86400000); break;
    case "90d": start = new Date(now.getTime() - 90 * 86400000); break;
    case "12m": start = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()); break;
    case "ytd": start = new Date(now.getFullYear(), 0, 1); break;
    case "30d": default: start = new Date(now.getTime() - 30 * 86400000); break;
  }
  return { startDate: start.toISOString().split("T")[0], endDate: end };
}

function ChangeIndicator({ value, suffix = "%" }: { value: number; suffix?: string }) {
  if (value === 0) return <span className="text-xs text-muted-foreground flex items-center gap-0.5"><Minus className="w-3 h-3" /> No change</span>;
  const isUp = value > 0;
  return (
    <span className={`text-xs flex items-center gap-0.5 ${isUp ? "text-red-400" : "text-green-400"}`}>
      {isUp ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
      {Math.abs(value).toFixed(1)}{suffix} vs prev
    </span>
  );
}

type Tab = "overview" | "budgets" | "vendors" | "categories";

export default function ExpensesPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [totalExpenses, setTotalExpenses] = useState(0);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [vendors, setVendors] = useState<VendorAnalytics[]>([]);
  const [budgets, setBudgets] = useState<ExpenseBudget[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [period, setPeriod] = useState("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const [uploading, setUploading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [detailExpense, setDetailExpense] = useState<Expense | null>(null);
  const [formData, setFormData] = useState({
    description: "", amount: "", date: new Date().toISOString().split("T")[0],
    vendor: "", categoryId: "", notes: "", receiptUrl: "", paymentMethod: "",
    tags: "" as string, isRecurring: false, recurringFrequency: "MONTHLY",
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterPayment, setFilterPayment] = useState("");
  const [sortField, setSortField] = useState<"date" | "amount">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [categorySection, setCategorySection] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatColor, setNewCatColor] = useState(CATEGORY_COLORS[0]);

  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [budgetForm, setBudgetForm] = useState({ categoryId: "", amount: "", alertAt: "80" });

  const [showTaxCalc, setShowTaxCalc] = useState(false);
  const [taxRate, setTaxRate] = useState("12.5");
  const [annualIncome, setAnnualIncome] = useState("");

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

  const loadData = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const useCustom = period === "custom" && customStart && customEnd;
      const dateRange = useCustom ? { startDate: customStart, endDate: customEnd } : getDateRange(period);
      const [expRes, catRes, sumRes, venRes, budRes] = await Promise.all([
        fetchExpenses(businessId, { search: searchQuery || undefined, categoryId: filterCategory || undefined, paymentMethod: filterPayment || undefined, startDate: dateRange.startDate, endDate: dateRange.endDate }),
        fetchExpenseCategories(businessId),
        fetchExpenseSummary(businessId, useCustom ? "custom" : period, useCustom ? customStart : undefined, useCustom ? customEnd : undefined),
        fetchVendorAnalytics(businessId, period, useCustom ? customStart : undefined, useCustom ? customEnd : undefined),
        fetchExpenseBudgets(businessId),
      ]);
      if (expRes.data) { setExpenses(expRes.data.data); setTotalExpenses(expRes.data.total); }
      if (catRes.data) setCategories(catRes.data);
      if (sumRes.data) setSummary(sumRes.data);
      if (venRes.data) setVendors(venRes.data);
      if (budRes.data) setBudgets(budRes.data);
    } catch {}
    setLoading(false);
  }, [businessId, period, searchQuery, filterCategory, filterPayment, customStart, customEnd]);

  useEffect(() => { void loadData(); }, [loadData]);

  const filteredExpenses = useMemo(() =>
    [...expenses].sort((a, b) => {
      if (sortField === "date") {
        const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
        return sortDir === "asc" ? diff : -diff;
      }
      return sortDir === "asc" ? a.amount - b.amount : b.amount - a.amount;
    }), [expenses, sortField, sortDir]);

  const toggleSort = (field: "date" | "amount") => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
  };

  const openAddModal = () => {
    setEditingExpense(null);
    setFormData({ description: "", amount: "", date: new Date().toISOString().split("T")[0], vendor: "", categoryId: "", notes: "", receiptUrl: "", paymentMethod: "", tags: "", isRecurring: false, recurringFrequency: "MONTHLY" });
    setShowModal(true);
  };

  const openEditModal = (exp: Expense) => {
    setEditingExpense(exp);
    setFormData({
      description: exp.description, amount: String(exp.amount), date: exp.date ? exp.date.split("T")[0] : "",
      vendor: exp.vendor || "", categoryId: exp.categoryId || "", notes: exp.notes || "",
      receiptUrl: exp.receiptUrl || "", paymentMethod: exp.paymentMethod || "",
      tags: exp.tags?.join(", ") || "", isRecurring: exp.isRecurring, recurringFrequency: exp.recurringFrequency || "MONTHLY",
    });
    setShowModal(true);
  };

  const handleSubmit = async () => {
    if (!businessId || !formData.description.trim() || !formData.amount) return;
    const payload: any = {
      description: formData.description.trim(), amount: parseFloat(formData.amount),
      date: formData.date, vendor: formData.vendor.trim() || undefined,
      categoryId: formData.categoryId || undefined, notes: formData.notes.trim() || undefined,
      receiptUrl: formData.receiptUrl.trim() || undefined, currency: "TTD",
      paymentMethod: formData.paymentMethod || undefined,
      tags: formData.tags ? formData.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
      isRecurring: formData.isRecurring, recurringFrequency: formData.isRecurring ? formData.recurringFrequency : undefined,
    };
    try {
      if (editingExpense) {
        const res = await updateExpense(businessId, editingExpense.id, payload);
        if (res.data) setExpenses(prev => prev.map(e => e.id === editingExpense.id ? res.data! : e));
      } else {
        const res = await createExpense(businessId, payload);
        if (res.data) setExpenses(prev => [res.data!, ...prev]);
      }
      setShowModal(false);
      void loadData();
    } catch {}
  };

  const handleDelete = async (expenseId: string) => {
    if (!businessId) return;
    try { await deleteExpense(businessId, expenseId); void loadData(); } catch {}
  };

  const handleAddCategory = async () => {
    if (!businessId || !newCatName.trim()) return;
    try {
      const res = await createExpenseCategory(businessId, { name: newCatName.trim(), color: newCatColor });
      if (res.data) setCategories(prev => [...prev, res.data!]);
      setNewCatName(""); setNewCatColor(CATEGORY_COLORS[0]);
    } catch {}
  };

  const handleDeleteCategory = async (categoryId: string) => {
    if (!businessId) return;
    try { await deleteExpenseCategory(businessId, categoryId); setCategories(prev => prev.filter(c => c.id !== categoryId)); } catch {}
  };

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !businessId) return;
    setUploading(true);
    try {
      const headers = getAuthHeaders();
      const res = await fetch(`${API_BASE}/businesses/${businessId}/uploads/request-url`, {
        method: "POST", headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType: file.type }),
      });
      const data = await res.json();
      if (data.uploadUrl) {
        await fetch(data.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
        setFormData(prev => ({ ...prev, receiptUrl: data.publicUrl || data.uploadUrl.split("?")[0] }));
      }
    } catch {}
    setUploading(false);
  };

  const handleSaveBudget = async () => {
    if (!businessId || !budgetForm.amount) return;
    const now = new Date();
    try {
      await upsertExpenseBudget(businessId, {
        categoryId: budgetForm.categoryId || undefined,
        amount: parseFloat(budgetForm.amount),
        month: now.getMonth() + 1, year: now.getFullYear(),
        alertAt: parseFloat(budgetForm.alertAt) || 80,
      });
      setShowBudgetModal(false);
      setBudgetForm({ categoryId: "", amount: "", alertAt: "80" });
      void loadData();
    } catch {}
  };

  const handleDeleteBudget = async (budgetId: string) => {
    if (!businessId) return;
    try { await deleteExpenseBudget(businessId, budgetId); void loadData(); } catch {}
  };

  const handleExport = () => {
    if (!businessId) return;
    const url = getExpenseExportUrl(businessId);
    const headers = getAuthHeaders();
    fetch(url, { headers }).then(r => r.blob()).then(blob => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `expenses-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
    });
  };

  const maxMonthly = summary?.monthlyTrend?.length ? Math.max(...summary.monthlyTrend.map(m => m.total), 1) : 1;

  const taxCalc = (() => {
    const income = parseFloat(annualIncome) || 0;
    const rate = parseFloat(taxRate) || 0;
    const totalExp = summary?.total || 0;
    const taxableIncome = Math.max(0, income - totalExp);
    const estimatedTax = taxableIncome * (rate / 100);
    const effectiveRate = income > 0 ? (estimatedTax / income) * 100 : 0;
    return { income, totalExpenses: totalExp, taxableIncome, estimatedTax, effectiveRate };
  })();

  const overBudgetCount = budgets.filter(b => b.isOverBudget).length;
  const nearAlertCount = budgets.filter(b => b.isNearAlert && !b.isOverBudget).length;

  if (loading) {
    return (
      <div className="space-y-4">
        <div><h1 className="text-xl md:text-2xl font-semibold tracking-tight flex items-center gap-2"><Receipt className="w-6 h-6" style={{ color: "hsl(var(--kf-accent1))" }} />Expenses</h1><p className="text-sm text-muted-foreground">Loading expense data...</p></div>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">{[1,2,3,4].map(i => <div key={i} className="rounded-2xl border border-border/60 bg-slate-950/70 p-4 h-24 animate-pulse" />)}</div>
        <div className="rounded-2xl border border-border/60 bg-slate-950/70 p-4 h-64 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Receipt}
        title="Expenses"
        subtitle="Track, analyze, and optimize your business spending"
        actionLabel="Add Expense"
        onAction={openAddModal}
        rightSlot={
          <div className="flex items-center gap-2">
            <button onClick={handleExport} className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-xl bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors">
              <Download className="w-4 h-4" /> Export CSV
            </button>
          </div>
        }
      />

      <StatCards
        items={[
          { label: "Total Spent", value: formatCurrency(summary?.total ?? 0), sub: <ChangeIndicator value={summary?.comparison?.changePercent ?? 0} />, icon: DollarSign, color: "#ef4444" },
          { label: "Transactions", value: String(summary?.count ?? 0), sub: `Avg ${formatCurrency(summary?.averageExpense ?? 0)}`, icon: Receipt, color: "#8b5cf6" },
          { label: "Budgets", value: budgets.length > 0 ? `${budgets.length} active` : "None set", sub: overBudgetCount > 0 ? <span className="text-red-400">{overBudgetCount} over budget</span> : nearAlertCount > 0 ? <span className="text-amber-400">{nearAlertCount} near limit</span> : "All on track", icon: Target, color: "#06b6d4" },
          { label: "Top Vendor", value: vendors[0]?.name ?? "---", sub: vendors[0] ? formatCurrency(vendors[0].total) : "No vendor data", icon: Store, color: "#22c55e" },
        ]}
      />

      <div className="flex items-center gap-2 flex-wrap">
        <select value={period} onChange={e => setPeriod(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]">
          {PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          <option value="custom">Custom Range</option>
        </select>
        {period === "custom" && (
          <>
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))]" />
            <span className="text-xs text-muted-foreground">to</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))]" />
          </>
        )}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search expenses..." className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" />
        </div>
        <div className="flex rounded-lg border border-white/10 overflow-hidden">
          {(["overview", "budgets", "vendors", "categories"] as Tab[]).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`px-3 py-2 text-xs font-medium capitalize transition-colors ${activeTab === tab ? "bg-[hsl(var(--kf-accent1))] text-white" : "bg-white/5 text-muted-foreground hover:text-white hover:bg-white/10"}`}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === "overview" && (
          <motion.div key="overview" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-6">
            {summary && (summary.byCategory?.length > 0 || summary.monthlyTrend?.length > 0) && (
              <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
                {summary.byCategory?.length > 0 && (
                  <div className="kf-card p-4 rounded-xl">
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><PieChart className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />Spending by Category</h3>
                    <div className="space-y-2.5">
                      {summary.byCategory.map(cat => (
                        <div key={cat.categoryId} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full" style={{ background: cat.color || "#6366f1" }} /><span>{cat.name}</span></div>
                            <div className="flex items-center gap-2"><span className="text-muted-foreground">{formatCurrency(cat.total)}</span><span className="text-[10px] text-muted-foreground/60">{cat.percent}%</span></div>
                          </div>
                          <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
                            <motion.div initial={{ width: 0 }} animate={{ width: `${cat.percent}%` }} transition={{ duration: 0.6, ease: "easeOut" }} className="h-full rounded-full" style={{ background: cat.color || "#6366f1" }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {summary.monthlyTrend?.length > 0 && (
                  <div className="kf-card p-4 rounded-xl">
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><BarChart3 className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />Monthly Trend</h3>
                    <div className="flex items-end gap-2 h-36">
                      {summary.monthlyTrend.map(m => {
                        const heightPct = (m.total / maxMonthly) * 100;
                        return (
                          <div key={m.month} className="flex-1 flex flex-col items-center gap-1 group relative">
                            <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-card border border-border rounded px-1.5 py-0.5 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">{formatCurrency(m.total)}</div>
                            <div className="w-full flex-1 flex items-end"><div className="w-full rounded-t-md transition-all group-hover:opacity-80" style={{ height: `${Math.max(heightPct, 4)}%`, background: "linear-gradient(to top, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }} /></div>
                            <span className="text-[10px] text-muted-foreground">{m.month.split("-")[1]}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {summary?.byPaymentMethod && summary.byPaymentMethod.length > 0 && (
              <div className="kf-card p-4 rounded-xl">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><CreditCard className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />By Payment Method</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {summary.byPaymentMethod.map(pm => {
                    const Icon = PAYMENT_ICONS[pm.method] || DollarSign;
                    const label = PAYMENT_METHODS.find(m => m.value === pm.method)?.label || pm.method;
                    return (
                      <div key={pm.method} className="bg-white/5 rounded-lg p-3 flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center"><Icon className="w-4 h-4 text-muted-foreground" /></div>
                        <div><p className="text-xs text-muted-foreground capitalize">{label}</p><p className="text-sm font-semibold">{formatCurrency(pm.total)}</p><p className="text-[10px] text-muted-foreground">{pm.count} transactions</p></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {summary?.largestExpense && (
              <div className="kf-card p-4 rounded-xl flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center"><TrendingUp className="w-5 h-5 text-red-400" /></div>
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Largest Expense This Period</p>
                  <p className="text-sm font-semibold">{summary.largestExpense.description}</p>
                  <p className="text-xs text-muted-foreground">{summary.largestExpense.vendor && `${summary.largestExpense.vendor} - `}{formatDate(summary.largestExpense.date)}</p>
                </div>
                <p className="text-lg font-bold text-red-400">{formatCurrency(summary.largestExpense.amount)}</p>
              </div>
            )}
          </motion.div>
        )}

        {activeTab === "budgets" && (
          <motion.div key="budgets" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Monthly Budgets</h3>
              <button onClick={() => setShowBudgetModal(true)} className="kf-btn-primary px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Set Budget</button>
            </div>
            {budgets.length === 0 ? (
              <div className="kf-card rounded-xl p-8 text-center">
                <Target className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground mb-1">No budgets set yet</p>
                <p className="text-xs text-muted-foreground/60">Set spending limits per category to stay on track.</p>
              </div>
            ) : (
              <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
                {budgets.map(b => (
                  <div key={b.id} className={`kf-card rounded-xl p-4 ${b.isOverBudget ? "border-red-500/30" : b.isNearAlert ? "border-amber-500/30" : ""}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {b.category && <div className="w-3 h-3 rounded-full" style={{ background: b.category.color || "#6366f1" }} />}
                        <span className="text-sm font-medium">{b.category?.name || "All Categories"}</span>
                      </div>
                      <button onClick={() => handleDeleteBudget(b.id)} className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                    <div className="flex items-baseline gap-2 mb-2">
                      <span className="text-lg font-bold">{formatCurrency(b.spent)}</span>
                      <span className="text-xs text-muted-foreground">of {formatCurrency(b.amount)}</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-muted/30 overflow-hidden mb-1.5">
                      <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(b.percentUsed, 100)}%` }} transition={{ duration: 0.6 }} className={`h-full rounded-full ${b.isOverBudget ? "bg-red-500" : b.isNearAlert ? "bg-amber-500" : "bg-green-500"}`} />
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className={b.isOverBudget ? "text-red-400" : b.isNearAlert ? "text-amber-400" : "text-green-400"}>
                        {b.isOverBudget ? `Over by ${formatCurrency(Math.abs(b.remaining))}` : `${formatCurrency(b.remaining)} remaining`}
                      </span>
                      <span className="text-muted-foreground">{b.percentUsed}%</span>
                    </div>
                    {b.isOverBudget && <div className="mt-2 flex items-center gap-1.5 text-[10px] text-red-400 bg-red-500/10 rounded-lg px-2 py-1"><AlertTriangle className="w-3 h-3" /> Budget exceeded!</div>}
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {activeTab === "vendors" && (
          <motion.div key="vendors" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <div className="kf-card rounded-xl overflow-hidden">
              <div className="p-4 border-b border-border/40"><h3 className="text-sm font-semibold flex items-center gap-2"><Store className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />Vendor Analytics</h3></div>
              {vendors.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">No vendor data yet. Add vendors to your expenses to see analytics.</div>
              ) : (
                <div className="divide-y divide-border/30">
                  <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-2 text-xs text-muted-foreground uppercase tracking-wider">
                    <span>Vendor</span><span className="text-right">Total</span><span className="text-right">Average</span><span className="text-right">Transactions</span><span className="text-right">Last Payment</span>
                  </div>
                  {vendors.map((v, i) => (
                    <div key={v.name} className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-1 md:gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors items-center">
                      <div className="flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold text-muted-foreground">{i + 1}</span><span className="text-sm font-medium">{v.name}</span></div>
                      <span className="text-sm font-semibold text-right text-red-400">{formatCurrency(v.total)}</span>
                      <span className="text-xs text-right text-muted-foreground">{formatCurrency(v.average)}</span>
                      <span className="text-xs text-right text-muted-foreground">{v.count} txns</span>
                      <span className="text-xs text-right text-muted-foreground">{formatDate(v.lastDate)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {activeTab === "categories" && (
          <motion.div key="categories" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <div className="kf-card rounded-xl p-4 space-y-4">
              <h3 className="text-sm font-semibold flex items-center gap-2"><Palette className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />Expense Categories</h3>
              <div className="flex items-center gap-2 flex-wrap">
                <input placeholder="Category name..." value={newCatName} onChange={e => setNewCatName(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAddCategory()} className="flex-1 min-w-[140px] bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" />
                <div className="flex items-center gap-1">
                  {CATEGORY_COLORS.map(c => (
                    <button key={c} onClick={() => setNewCatColor(c)} className="w-5 h-5 rounded-full transition-transform" style={{ background: c, transform: newCatColor === c ? "scale(1.3)" : "scale(1)", boxShadow: newCatColor === c ? `0 0 0 2px ${c}40` : "none" }} />
                  ))}
                </div>
                <button onClick={handleAddCategory} disabled={!newCatName.trim()} className="kf-btn-primary px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40"><Plus className="w-4 h-4" /></button>
              </div>
              <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {categories.map(cat => (
                  <div key={cat.id} className="flex items-center justify-between bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 group">
                    <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{ background: cat.color || "#6366f1" }} /><span className="text-sm">{cat.name}</span>{cat._count && <span className="text-xs text-muted-foreground">({cat._count.expenses})</span>}</div>
                    <button onClick={() => handleDeleteCategory(cat.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
                {categories.length === 0 && <p className="text-xs text-muted-foreground col-span-full">No categories yet. Add one above.</p>}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="kf-card rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border/40 flex items-center justify-between flex-wrap gap-3">
          <h3 className="text-sm font-semibold">All Expenses <span className="text-muted-foreground font-normal">({totalExpenses})</span></h3>
          <div className="flex items-center gap-2">
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="appearance-none bg-white/5 border border-white/10 rounded-lg pl-7 pr-8 py-1.5 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))]">
              <option value="">All Categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={filterPayment} onChange={e => setFilterPayment(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))]">
              <option value="">All Methods</option>
              {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <button onClick={() => toggleSort("date")} className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border transition-colors ${sortField === "date" ? "border-[hsl(var(--kf-accent1))] text-[hsl(var(--kf-accent1))]" : "border-white/10 text-muted-foreground hover:text-white"}`}>Date <ArrowUpDown className="w-3 h-3" /></button>
            <button onClick={() => toggleSort("amount")} className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border transition-colors ${sortField === "amount" ? "border-[hsl(var(--kf-accent1))] text-[hsl(var(--kf-accent1))]" : "border-white/10 text-muted-foreground hover:text-white"}`}>Amount <ArrowUpDown className="w-3 h-3" /></button>
          </div>
        </div>

        {filteredExpenses.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">{expenses.length === 0 ? 'No expenses recorded yet. Click "Add Expense" to get started.' : "No expenses match the selected filters."}</div>
        ) : (
          <div className="divide-y divide-border/30">
            <div className="hidden md:grid grid-cols-[0.8fr_2fr_1fr_0.8fr_0.8fr_1fr_auto] gap-3 px-4 py-2 text-xs text-muted-foreground uppercase tracking-wider">
              <span>Date</span><span>Description</span><span>Vendor</span><span>Category</span><span>Method</span><span className="text-right">Amount</span><span className="w-20" />
            </div>
            <AnimatePresence>
              {filteredExpenses.map(exp => {
                const cat = categories.find(c => c.id === exp.categoryId) || exp.category;
                const pmLabel = PAYMENT_METHODS.find(m => m.value === exp.paymentMethod)?.label;
                return (
                  <motion.div key={exp.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} className="grid grid-cols-1 md:grid-cols-[0.8fr_2fr_1fr_0.8fr_0.8fr_1fr_auto] gap-1 md:gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors group items-center cursor-pointer" onClick={() => setDetailExpense(exp)}>
                    <span className="text-xs text-muted-foreground">{formatDate(exp.date)}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{exp.description}</span>
                      {exp.isRecurring && <Repeat className="w-3 h-3 text-blue-400 flex-shrink-0" />}
                      {exp.receiptUrl && <FileText className="w-3 h-3 text-green-400 flex-shrink-0" />}
                    </div>
                    <span className="text-xs text-muted-foreground truncate">{exp.vendor || "---"}</span>
                    <span className="flex items-center gap-1.5 text-xs">{cat && <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: cat.color || "#6366f1" }} />}{cat?.name || "---"}</span>
                    <span className="text-xs text-muted-foreground">{pmLabel || "---"}</span>
                    <span className="text-sm font-semibold text-right text-red-400">{formatCurrency(exp.amount)}</span>
                    <div className="flex items-center gap-1 w-20 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={e => { e.stopPropagation(); openEditModal(exp); }} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={e => { e.stopPropagation(); handleDelete(exp.id); }} className="p-1.5 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      <div className="kf-card rounded-xl overflow-hidden">
        <button onClick={() => setShowTaxCalc(!showTaxCalc)} className="w-full flex items-center justify-between p-4 hover:bg-white/[0.02] transition-colors">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Calculator className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />Tax Estimator</h3>
          {showTaxCalc ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </button>
        <AnimatePresence>
          {showTaxCalc && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="px-4 pb-4 space-y-4">
                <p className="text-xs text-muted-foreground">Estimate your tax liability based on income and tracked expenses. Default rate is Trinidad VAT (12.5%).</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs text-muted-foreground mb-1 block">Annual Income (TTD)</label><input type="number" value={annualIncome} onChange={e => setAnnualIncome(e.target.value)} placeholder="0.00" className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" /></div>
                  <div><label className="text-xs text-muted-foreground mb-1 block">Tax Rate (%)</label><input type="number" step="0.1" value={taxRate} onChange={e => setTaxRate(e.target.value)} className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" /></div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-white/5 rounded-lg p-3 text-center"><p className="text-[10px] text-muted-foreground uppercase">Income</p><p className="text-sm font-semibold text-green-400">{formatCurrency(taxCalc.income)}</p></div>
                  <div className="bg-white/5 rounded-lg p-3 text-center"><p className="text-[10px] text-muted-foreground uppercase">Deductions</p><p className="text-sm font-semibold text-red-400">{formatCurrency(taxCalc.totalExpenses)}</p></div>
                  <div className="bg-white/5 rounded-lg p-3 text-center"><p className="text-[10px] text-muted-foreground uppercase">Taxable</p><p className="text-sm font-semibold text-amber-400">{formatCurrency(taxCalc.taxableIncome)}</p></div>
                  <div className="bg-white/5 rounded-lg p-3 text-center"><p className="text-[10px] text-muted-foreground uppercase">Est. Tax</p><p className="text-sm font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>{formatCurrency(taxCalc.estimatedTax)}</p></div>
                </div>
                {taxCalc.effectiveRate > 0 && <p className="text-xs text-muted-foreground text-center">Effective tax rate: {taxCalc.effectiveRate.toFixed(1)}%</p>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowModal(false)} />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] overflow-y-auto">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between" style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.1), hsl(var(--kf-accent2) / 0.1))" }}>
                <h2 className="text-base font-semibold">{editingExpense ? "Edit Expense" : "Add Expense"}</h2>
                <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-5 space-y-4">
                <div><label className="text-xs text-muted-foreground mb-1 block">Description *</label><input value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} placeholder="What was this expense for?" className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs text-muted-foreground mb-1 block">Amount (TTD) *</label><input type="number" step="0.01" min="0" value={formData.amount} onChange={e => setFormData({ ...formData, amount: e.target.value })} placeholder="0.00" className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" /></div>
                  <div><label className="text-xs text-muted-foreground mb-1 block">Date *</label><input type="date" value={formData.date} onChange={e => setFormData({ ...formData, date: e.target.value })} className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs text-muted-foreground mb-1 block">Vendor</label><input value={formData.vendor} onChange={e => setFormData({ ...formData, vendor: e.target.value })} placeholder="Vendor name" className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" /></div>
                  <div><label className="text-xs text-muted-foreground mb-1 block">Category</label><select value={formData.categoryId} onChange={e => setFormData({ ...formData, categoryId: e.target.value })} className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"><option value="">No category</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs text-muted-foreground mb-1 block">Payment Method</label><select value={formData.paymentMethod} onChange={e => setFormData({ ...formData, paymentMethod: e.target.value })} className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"><option value="">Select method</option>{PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select></div>
                  <div><label className="text-xs text-muted-foreground mb-1 block">Tags</label><input value={formData.tags} onChange={e => setFormData({ ...formData, tags: e.target.value })} placeholder="tag1, tag2, ..." className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" /></div>
                </div>
                <div><label className="text-xs text-muted-foreground mb-1 block">Notes</label><textarea value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} placeholder="Additional notes..." rows={2} className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))] resize-none" /></div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={formData.isRecurring} onChange={e => setFormData({ ...formData, isRecurring: e.target.checked })} className="accent-[hsl(var(--kf-accent1))]" /><Repeat className="w-3.5 h-3.5 text-muted-foreground" /> Recurring</label>
                  {formData.isRecurring && (
                    <select value={formData.recurringFrequency} onChange={e => setFormData({ ...formData, recurringFrequency: e.target.value })} className="bg-transparent border border-border/60 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))]">
                      <option value="WEEKLY">Weekly</option><option value="BIWEEKLY">Bi-weekly</option><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option><option value="YEARLY">Yearly</option>
                    </select>
                  )}
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Receipt</label>
                  <div className="flex items-center gap-2">
                    <label className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors ${uploading ? "opacity-50 pointer-events-none" : ""} bg-white/5 border border-border/60 hover:bg-white/10`}><Upload className="w-4 h-4" />{uploading ? "Uploading..." : "Upload Receipt"}<input type="file" accept="image/*,.pdf" onChange={handleReceiptUpload} className="hidden" /></label>
                    {formData.receiptUrl && (
                      <div className="flex items-center gap-1.5 text-xs text-green-400"><Image className="w-3.5 h-3.5" /><span className="truncate max-w-[150px]">Receipt attached</span><button onClick={() => setFormData(prev => ({ ...prev, receiptUrl: "" }))} className="text-muted-foreground hover:text-red-400"><X className="w-3 h-3" /></button></div>
                    )}
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={() => setShowModal(false)} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted/30">Cancel</button>
                  <button onClick={handleSubmit} disabled={!formData.description.trim() || !formData.amount} className="kf-btn-primary px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-40">{editingExpense ? "Update" : "Add Expense"}</button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showBudgetModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowBudgetModal(false)} />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between" style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.1), hsl(var(--kf-accent2) / 0.1))" }}>
                <h2 className="text-base font-semibold">Set Monthly Budget</h2>
                <button onClick={() => setShowBudgetModal(false)} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-5 space-y-4">
                <div><label className="text-xs text-muted-foreground mb-1 block">Category</label><select value={budgetForm.categoryId} onChange={e => setBudgetForm({ ...budgetForm, categoryId: e.target.value })} className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"><option value="">All Categories (Total Budget)</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                <div><label className="text-xs text-muted-foreground mb-1 block">Monthly Limit (TTD) *</label><input type="number" step="0.01" value={budgetForm.amount} onChange={e => setBudgetForm({ ...budgetForm, amount: e.target.value })} placeholder="5000.00" className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" /></div>
                <div><label className="text-xs text-muted-foreground mb-1 block">Alert at (%)</label><input type="number" step="5" min="50" max="100" value={budgetForm.alertAt} onChange={e => setBudgetForm({ ...budgetForm, alertAt: e.target.value })} className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" /><p className="text-[10px] text-muted-foreground mt-1">You'll be warned when spending reaches this percentage.</p></div>
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={() => setShowBudgetModal(false)} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted/30">Cancel</button>
                  <button onClick={handleSaveBudget} disabled={!budgetForm.amount} className="kf-btn-primary px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-40">Save Budget</button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {detailExpense && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-end md:items-center justify-center">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDetailExpense(null)} />
            <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} className="relative w-full max-w-lg bg-card border border-border rounded-t-2xl md:rounded-2xl shadow-2xl overflow-hidden max-h-[80vh] overflow-y-auto">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between" style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.1), hsl(var(--kf-accent2) / 0.1))" }}>
                <h2 className="text-base font-semibold">Expense Details</h2>
                <div className="flex items-center gap-1">
                  <button onClick={() => { openEditModal(detailExpense); setDetailExpense(null); }} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => setDetailExpense(null)} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white"><X className="w-4 h-4" /></button>
                </div>
              </div>
              <div className="p-5 space-y-4">
                <div className="text-center"><p className="text-2xl font-bold text-red-400">{formatCurrency(detailExpense.amount)}</p><p className="text-sm text-muted-foreground">{detailExpense.description}</p></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white/5 rounded-lg p-3"><p className="text-[10px] text-muted-foreground uppercase mb-0.5">Date</p><p className="text-sm">{formatDate(detailExpense.date)}</p></div>
                  <div className="bg-white/5 rounded-lg p-3"><p className="text-[10px] text-muted-foreground uppercase mb-0.5">Vendor</p><p className="text-sm">{detailExpense.vendor || "---"}</p></div>
                  <div className="bg-white/5 rounded-lg p-3"><p className="text-[10px] text-muted-foreground uppercase mb-0.5">Category</p><div className="flex items-center gap-1.5">{detailExpense.category && <div className="w-2 h-2 rounded-full" style={{ background: detailExpense.category.color || "#6366f1" }} />}<p className="text-sm">{detailExpense.category?.name || "Uncategorized"}</p></div></div>
                  <div className="bg-white/5 rounded-lg p-3"><p className="text-[10px] text-muted-foreground uppercase mb-0.5">Payment</p><p className="text-sm">{PAYMENT_METHODS.find(m => m.value === detailExpense.paymentMethod)?.label || "---"}</p></div>
                </div>
                {detailExpense.isRecurring && (
                  <div className="flex items-center gap-2 bg-blue-500/10 rounded-lg px-3 py-2 text-xs text-blue-400"><Repeat className="w-3.5 h-3.5" /> Recurring {detailExpense.recurringFrequency?.toLowerCase()}</div>
                )}
                {detailExpense.tags && detailExpense.tags.length > 0 && (
                  <div><p className="text-[10px] text-muted-foreground uppercase mb-1">Tags</p><div className="flex flex-wrap gap-1">{detailExpense.tags.map(tag => <span key={tag} className="bg-white/10 text-xs px-2 py-0.5 rounded-full">{tag}</span>)}</div></div>
                )}
                {detailExpense.notes && (
                  <div><p className="text-[10px] text-muted-foreground uppercase mb-1">Notes</p><p className="text-sm text-muted-foreground">{detailExpense.notes}</p></div>
                )}
                {detailExpense.receiptUrl && (
                  <div><p className="text-[10px] text-muted-foreground uppercase mb-1">Receipt</p>
                    {detailExpense.receiptUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                      <img src={detailExpense.receiptUrl} alt="Receipt" className="w-full max-h-64 object-contain rounded-lg border border-border/40" />
                    ) : (
                      <a href={detailExpense.receiptUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-[hsl(var(--kf-accent1))] hover:underline"><FileText className="w-4 h-4" /> View Receipt <ExternalLink className="w-3 h-3" /></a>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
