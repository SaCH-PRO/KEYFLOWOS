"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Receipt,
  Plus,
  Trash2,
  Pencil,
  X,
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
  Filter,
  DollarSign,
  TrendingUp,
  Tag,
  BarChart3,
  Palette,
  Upload,
  Image,
  Calculator,
} from "lucide-react";
import {
  fetchExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  fetchExpenseCategories,
  createExpenseCategory,
  deleteExpenseCategory,
  fetchExpenseSummary,
  Expense,
  ExpenseCategory,
  ExpenseSummary,
} from "@/lib/client";
import { API_BASE, getAuthHeaders } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { StatCards } from "@/components/ui/stat-cards";

const CATEGORY_COLORS = [
  "#f97316", "#ef4444", "#8b5cf6", "#06b6d4", "#22c55e",
  "#eab308", "#ec4899", "#6366f1", "#14b8a6", "#f43f5e",
];

function formatCurrency(amount: number): string {
  return `TTD $${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function ExpensesPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const [uploading, setUploading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [formData, setFormData] = useState({
    description: "",
    amount: "",
    date: new Date().toISOString().split("T")[0],
    vendor: "",
    categoryId: "",
    notes: "",
    receiptUrl: "",
  });

  const [filterCategory, setFilterCategory] = useState("");
  const [sortField, setSortField] = useState<"date" | "amount">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [categorySection, setCategorySection] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatColor, setNewCatColor] = useState(CATEGORY_COLORS[0]);

  const [showTaxCalc, setShowTaxCalc] = useState(false);
  const [taxRate, setTaxRate] = useState("12.5");
  const [annualIncome, setAnnualIncome] = useState("");

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

  const loadData = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [expRes, catRes, sumRes] = await Promise.all([
        fetchExpenses(businessId),
        fetchExpenseCategories(businessId),
        fetchExpenseSummary(businessId, "30d"),
      ]);
      if (expRes.data) setExpenses(expRes.data);
      if (catRes.data) setCategories(catRes.data);
      if (sumRes.data) setSummary(sumRes.data);
    } catch {
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredExpenses = expenses
    .filter((e) => !filterCategory || e.categoryId === filterCategory)
    .sort((a, b) => {
      if (sortField === "date") {
        const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
        return sortDir === "asc" ? diff : -diff;
      }
      const diff = a.amount - b.amount;
      return sortDir === "asc" ? diff : -diff;
    });

  const toggleSort = (field: "date" | "amount") => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const openAddModal = () => {
    setEditingExpense(null);
    setFormData({
      description: "",
      amount: "",
      date: new Date().toISOString().split("T")[0],
      vendor: "",
      categoryId: "",
      notes: "",
      receiptUrl: "",
    });
    setShowModal(true);
  };

  const openEditModal = (exp: Expense) => {
    setEditingExpense(exp);
    setFormData({
      description: exp.description,
      amount: String(exp.amount),
      date: exp.date ? exp.date.split("T")[0] : "",
      vendor: exp.vendor || "",
      categoryId: exp.categoryId || "",
      notes: exp.notes || "",
      receiptUrl: exp.receiptUrl || "",
    });
    setShowModal(true);
  };

  const handleSubmit = async () => {
    if (!businessId || !formData.description.trim() || !formData.amount) return;
    try {
      const payload: Partial<Expense> = {
        description: formData.description.trim(),
        amount: parseFloat(formData.amount),
        date: formData.date,
        vendor: formData.vendor.trim() || undefined,
        categoryId: formData.categoryId || undefined,
        notes: formData.notes.trim() || undefined,
        receiptUrl: formData.receiptUrl.trim() || undefined,
        currency: "TTD",
      };

      if (editingExpense) {
        const res = await updateExpense(businessId, editingExpense.id, payload);
        if (res.data) {
          setExpenses((prev) =>
            prev.map((e) => (e.id === editingExpense.id ? res.data! : e))
          );
        }
      } else {
        const res = await createExpense(businessId, payload);
        if (res.data) {
          setExpenses((prev) => [res.data!, ...prev]);
        }
      }
      setShowModal(false);
      const sumRes = await fetchExpenseSummary(businessId, "30d");
      if (sumRes.data) setSummary(sumRes.data);
    } catch {
    }
  };

  const handleDelete = async (expenseId: string) => {
    if (!businessId) return;
    try {
      await deleteExpense(businessId, expenseId);
      setExpenses((prev) => prev.filter((e) => e.id !== expenseId));
      const sumRes = await fetchExpenseSummary(businessId, "30d");
      if (sumRes.data) setSummary(sumRes.data);
    } catch {
    }
  };

  const handleAddCategory = async () => {
    if (!businessId || !newCatName.trim()) return;
    try {
      const res = await createExpenseCategory(businessId, {
        name: newCatName.trim(),
        color: newCatColor,
      });
      if (res.data) {
        setCategories((prev) => [...prev, res.data!]);
      }
      setNewCatName("");
      setNewCatColor(CATEGORY_COLORS[0]);
    } catch {
    }
  };

  const handleDeleteCategory = async (categoryId: string) => {
    if (!businessId) return;
    try {
      await deleteExpenseCategory(businessId, categoryId);
      setCategories((prev) => prev.filter((c) => c.id !== categoryId));
    } catch {
    }
  };

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !businessId) return;
    setUploading(true);
    try {
      const headers = getAuthHeaders();
      const res = await fetch(`${API_BASE}/businesses/${businessId}/uploads/request-url`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, contentType: file.type }),
      });
      const data = await res.json();
      if (data.uploadUrl) {
        await fetch(data.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
        setFormData(prev => ({ ...prev, receiptUrl: data.publicUrl || data.uploadUrl.split('?')[0] }));
      }
    } catch {}
    setUploading(false);
  };

  const topCategory = summary?.byCategory?.length
    ? summary.byCategory.reduce((a, b) => (a.total > b.total ? a : b))
    : null;

  const monthlyAvg =
    summary?.monthlyTrend?.length
      ? summary.monthlyTrend.reduce((s, m) => s + m.total, 0) / summary.monthlyTrend.length
      : 0;

  const maxMonthly = summary?.monthlyTrend?.length
    ? Math.max(...summary.monthlyTrend.map((m) => m.total), 1)
    : 1;

  const taxCalc = (() => {
    const income = parseFloat(annualIncome) || 0;
    const rate = parseFloat(taxRate) || 0;
    const totalExpenses = summary?.total || 0;
    const taxableIncome = Math.max(0, income - totalExpenses);
    const estimatedTax = taxableIncome * (rate / 100);
    const effectiveRate = income > 0 ? (estimatedTax / income) * 100 : 0;
    return { income, totalExpenses, taxableIncome, estimatedTax, effectiveRate };
  })();

  if (loading) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Receipt className="w-6 h-6" style={{ color: "hsl(var(--kf-accent1))" }} />
            Expenses
          </h1>
          <p className="text-sm text-muted-foreground">Loading expense data...</p>
        </div>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-2xl border border-border/60 bg-slate-950/70 p-4 h-24 animate-pulse" />
          ))}
        </div>
        <div className="rounded-2xl border border-border/60 bg-slate-950/70 p-4 h-64 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Receipt}
        title="Expenses"
        subtitle="Track and manage your business expenses"
        actionLabel="Add Expense"
        onAction={openAddModal}
      />

      <StatCards
        items={[
          { label: "Total Expenses", value: formatCurrency(summary?.total ?? 0), sub: "This month", icon: DollarSign, color: "#ef4444" },
          { label: "Transactions", value: String(summary?.count ?? 0), sub: "This month", icon: Receipt, color: "#8b5cf6" },
          { label: "Top Category", value: topCategory?.name ?? "—", sub: topCategory ? formatCurrency(topCategory.total) : "No data", icon: Tag, color: topCategory?.color ?? "#06b6d4" },
          { label: "Monthly Average", value: formatCurrency(monthlyAvg), sub: `Over ${summary?.monthlyTrend?.length ?? 0} months`, icon: TrendingUp, color: "#22c55e" },
        ]}
      />

      {summary && (summary.byCategory?.length > 0 || summary.monthlyTrend?.length > 0) && (
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
          {summary.byCategory?.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="kf-card p-4 rounded-xl"
            >
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Tag className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                Category Breakdown
              </h3>
              <div className="space-y-2">
                {summary.byCategory.map((cat) => {
                  const pct = summary.total > 0 ? (cat.total / summary.total) * 100 : 0;
                  return (
                    <div key={cat.name} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ background: cat.color || "#6366f1" }}
                          />
                          <span>{cat.name}</span>
                        </div>
                        <span className="text-muted-foreground">
                          {formatCurrency(cat.total)} ({cat.count})
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${pct}%`,
                            background: cat.color || "#6366f1",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {summary.monthlyTrend?.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="kf-card p-4 rounded-xl"
            >
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                Monthly Trend
              </h3>
              <div className="flex items-end gap-2 h-32">
                {summary.monthlyTrend.map((m) => {
                  const heightPct = (m.total / maxMonthly) * 100;
                  return (
                    <div
                      key={m.month}
                      className="flex-1 flex flex-col items-center gap-1"
                    >
                      <span className="text-[10px] text-muted-foreground">
                        {formatCurrency(m.total)}
                      </span>
                      <div className="w-full flex-1 flex items-end">
                        <div
                          className="w-full rounded-t-md transition-all"
                          style={{
                            height: `${Math.max(heightPct, 4)}%`,
                            background: "linear-gradient(to top, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                          }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground">{m.month}</span>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </div>
      )}

      <div className="kf-card rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border/40 flex items-center justify-between flex-wrap gap-3">
          <h3 className="text-sm font-semibold">All Expenses</h3>
          <div className="flex items-center gap-2">
            <div className="relative">
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="appearance-none bg-white/5 border border-white/10 rounded-lg pl-7 pr-8 py-1.5 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
              >
                <option value="">All Categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Filter className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>
            <button
              onClick={() => toggleSort("date")}
              className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border transition-colors ${
                sortField === "date"
                  ? "border-[hsl(var(--kf-accent1))] text-[hsl(var(--kf-accent1))]"
                  : "border-white/10 text-muted-foreground hover:text-white"
              }`}
            >
              Date
              <ArrowUpDown className="w-3 h-3" />
            </button>
            <button
              onClick={() => toggleSort("amount")}
              className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border transition-colors ${
                sortField === "amount"
                  ? "border-[hsl(var(--kf-accent1))] text-[hsl(var(--kf-accent1))]"
                  : "border-white/10 text-muted-foreground hover:text-white"
              }`}
            >
              Amount
              <ArrowUpDown className="w-3 h-3" />
            </button>
          </div>
        </div>

        {filteredExpenses.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {expenses.length === 0
              ? "No expenses recorded yet. Click \"Add Expense\" to get started."
              : "No expenses match the selected filter."}
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            <div className="hidden md:grid grid-cols-[1fr_2fr_1fr_1fr_1fr_auto] gap-3 px-4 py-2 text-xs text-muted-foreground uppercase tracking-wider">
              <span>Date</span>
              <span>Description</span>
              <span>Vendor</span>
              <span>Category</span>
              <span className="text-right">Amount</span>
              <span className="w-16" />
            </div>
            <AnimatePresence>
              {filteredExpenses.map((exp) => {
                const cat = categories.find((c) => c.id === exp.categoryId) || exp.category;
                return (
                  <motion.div
                    key={exp.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 8 }}
                    className="grid grid-cols-1 md:grid-cols-[1fr_2fr_1fr_1fr_1fr_auto] gap-1 md:gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors group items-center"
                  >
                    <span className="text-xs text-muted-foreground md:text-sm">
                      {formatDate(exp.date)}
                    </span>
                    <span className="text-sm font-medium truncate">{exp.description}</span>
                    <span className="text-xs text-muted-foreground truncate">
                      {exp.vendor || "—"}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs">
                      {cat && (
                        <div
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: cat.color || "#6366f1" }}
                        />
                      )}
                      {cat?.name || "Uncategorized"}
                    </span>
                    <span className="text-sm font-semibold text-right" style={{ color: "#ef4444" }}>
                      {formatCurrency(exp.amount)}
                    </span>
                    <div className="flex items-center gap-1 w-16 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => openEditModal(exp)}
                        className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(exp.id)}
                        className="p-1.5 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      <div className="kf-card rounded-xl overflow-hidden">
        <button
          onClick={() => setCategorySection(!categorySection)}
          className="w-full flex items-center justify-between p-4 hover:bg-white/[0.02] transition-colors"
        >
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Palette className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
            Expense Categories
          </h3>
          {categorySection ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </button>

        <AnimatePresence>
          {categorySection && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    placeholder="Category name..."
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddCategory()}
                    className="flex-1 min-w-[140px] bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                  />
                  <div className="flex items-center gap-1">
                    {CATEGORY_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setNewCatColor(c)}
                        className="w-5 h-5 rounded-full transition-transform"
                        style={{
                          background: c,
                          transform: newCatColor === c ? "scale(1.3)" : "scale(1)",
                          boxShadow: newCatColor === c ? `0 0 0 2px ${c}40` : "none",
                        }}
                      />
                    ))}
                  </div>
                  <button
                    onClick={handleAddCategory}
                    disabled={!newCatName.trim()}
                    className="kf-btn-primary px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  {categories.map((cat) => (
                    <div
                      key={cat.id}
                      className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm group"
                    >
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ background: cat.color || "#6366f1" }}
                      />
                      <span>{cat.name}</span>
                      {cat._count && (
                        <span className="text-xs text-muted-foreground">
                          ({cat._count.expenses})
                        </span>
                      )}
                      <button
                        onClick={() => handleDeleteCategory(cat.id)}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity ml-1"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  {categories.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No categories yet. Add one above.
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="kf-card rounded-xl overflow-hidden">
        <button
          onClick={() => setShowTaxCalc(!showTaxCalc)}
          className="w-full flex items-center justify-between p-4 hover:bg-white/[0.02] transition-colors"
        >
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Calculator className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Tax Estimator
          </h3>
          {showTaxCalc ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </button>
        <AnimatePresence>
          {showTaxCalc && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="px-4 pb-4 space-y-4">
                <p className="text-xs text-muted-foreground">Estimate your tax liability based on income and tracked expenses. Default rate is Trinidad VAT (12.5%).</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Annual Income (TTD)</label>
                    <input type="number" value={annualIncome} onChange={e => setAnnualIncome(e.target.value)} placeholder="0.00" className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Tax Rate (%)</label>
                    <input type="number" step="0.1" value={taxRate} onChange={e => setTaxRate(e.target.value)} className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" />
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-white/5 rounded-lg p-3 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">Income</p>
                    <p className="text-sm font-semibold text-green-400">{formatCurrency(taxCalc.income)}</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-3 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">Expenses</p>
                    <p className="text-sm font-semibold text-red-400">{formatCurrency(taxCalc.totalExpenses)}</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-3 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">Taxable</p>
                    <p className="text-sm font-semibold text-amber-400">{formatCurrency(taxCalc.taxableIncome)}</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-3 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">Est. Tax</p>
                    <p className="text-sm font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>{formatCurrency(taxCalc.estimatedTax)}</p>
                  </div>
                </div>
                {taxCalc.effectiveRate > 0 && (
                  <p className="text-xs text-muted-foreground text-center">Effective tax rate: {taxCalc.effectiveRate.toFixed(1)}%</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          >
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowModal(false)}
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
            >
              <div
                className="px-5 py-4 border-b border-border flex items-center justify-between"
                style={{
                  background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.1), hsl(var(--kf-accent2) / 0.1))",
                }}
              >
                <h2 className="text-base font-semibold">
                  {editingExpense ? "Edit Expense" : "Add Expense"}
                </h2>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Description *</label>
                  <input
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="What was this expense for?"
                    className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Amount (TTD) *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.amount}
                      onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                      placeholder="0.00"
                      className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Date *</label>
                    <input
                      type="date"
                      value={formData.date}
                      onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                      className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Vendor</label>
                    <input
                      value={formData.vendor}
                      onChange={(e) => setFormData({ ...formData, vendor: e.target.value })}
                      placeholder="Vendor name"
                      className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Category</label>
                    <select
                      value={formData.categoryId}
                      onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                      className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                    >
                      <option value="">No category</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Additional notes..."
                    rows={2}
                    className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))] resize-none"
                  />
                </div>

                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Receipt</label>
                  <div className="flex items-center gap-2">
                    <label className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors ${uploading ? "opacity-50 pointer-events-none" : ""} bg-white/5 border border-border/60 hover:bg-white/10`}>
                      <Upload className="w-4 h-4" />
                      {uploading ? "Uploading..." : "Upload Receipt"}
                      <input type="file" accept="image/*,.pdf" onChange={handleReceiptUpload} className="hidden" />
                    </label>
                    {formData.receiptUrl && (
                      <div className="flex items-center gap-1.5 text-xs text-green-400">
                        <Image className="w-3.5 h-3.5" />
                        <span className="truncate max-w-[150px]">Receipt attached</span>
                        <button onClick={() => setFormData(prev => ({ ...prev, receiptUrl: "" }))} className="text-muted-foreground hover:text-red-400">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                  {formData.receiptUrl && (
                    <input
                      value={formData.receiptUrl}
                      onChange={(e) => setFormData({ ...formData, receiptUrl: e.target.value })}
                      placeholder="Or paste URL..."
                      className="mt-1.5 w-full bg-transparent border border-border/60 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                    />
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted/30"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={!formData.description.trim() || !formData.amount}
                    className="kf-btn-primary px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
                  >
                    {editingExpense ? "Update" : "Add Expense"}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
