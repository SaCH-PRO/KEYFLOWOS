"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  FileText,
  Plus,
  ArrowLeft,
  Loader2,
  Search,
  Clock,
  AlertCircle,
  CheckCircle,
  MoreHorizontal,
  Send,
  DollarSign,
  Bell,
  Trash2,
  Ban,
  CheckCircle2,
  Files,
  MessageCircle,
  Mail,
  Receipt,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  fetchInvoices,
  fetchContacts,
  fetchProducts,
  getGmailStatus,
  updateInvoiceStatus,
  markInvoicePaid,
  resendInvoiceReceipt,
  sendInvoiceReminder,
  createInvoicePaymentLink,
  Invoice,
  Contact,
  Product,
} from "@/lib/client";
import { apiDelete } from "@/lib/api";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatAmount, getDaysUntilDue } from "../utils/commerce-utils";
import { INVOICE_STATUS_FILTERS, BILLING_SORT_OPTIONS, BillingSortKey } from "../components/commerce-types";
import { useCommerceSearch } from "../hooks/use-commerce-search";
import { DateRangeFilter, filterByDateRange, DEFAULT_DATE_RANGE } from "../components/date-range-filter";
import type { DateRange } from "../components/date-range-filter";

const PAGE_SIZE = 10;

export default function InvoicesHubPage() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [businessCurrency, setBusinessCurrency] = useState<string>("TTD");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [gmailStatus, setGmailStatus] = useState<{ connected: boolean; email: string | null } | null>(null);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<BillingSortKey>("date-desc");
  const [dateRange, setDateRange] = useState<DateRange>(DEFAULT_DATE_RANGE);
  const [page, setPage] = useState(1);
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    const init = async () => {
      const fresh = await refreshWorkspace();
      const id = fresh ?? getStoredBusinessId();
      if (id) setBusinessId(id);
    };
    void init();
  }, []);

  useEffect(() => {
    if (!businessId) return;
    const load = async () => {
      setLoading(true);
      try {
        const [invoicesRes, contactsRes, productsRes, gmailRes] = await Promise.all([
          fetchInvoices(businessId),
          fetchContacts(businessId),
          fetchProducts(businessId),
          getGmailStatus(businessId),
        ]);
        if (!mountedRef.current) return;
        setInvoices(invoicesRes.data ?? []);
        setContacts(contactsRes.data?.contacts ?? []);
        setProducts((productsRes.data ?? []).map(p => p as Product));
        setGmailStatus(gmailRes.data ?? null);
      } catch {
        toast.error("Failed to load invoices");
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };
    void load();
  }, [businessId]);

  const statusCounts = (() => {
    const counts: Record<string, number> = { ALL: invoices.length, DRAFT: 0, SENT: 0, PAID: 0, PARTIALLY_PAID: 0, OVERDUE: 0, VOID: 0 };
    for (const inv of invoices) if (inv.status && counts[inv.status] !== undefined) counts[inv.status]++;
    return counts;
  })();

  const sorted = [...invoices].sort((a, b) => {
    switch (sortKey) {
      case "date-asc": return new Date(a.issueDate ?? 0).getTime() - new Date(b.issueDate ?? 0).getTime();
      case "amount-desc": return Number(b.total) - Number(a.total);
      case "amount-asc": return Number(a.total) - Number(b.total);
      case "name-asc": {
        const nameA = `${a.contact?.firstName ?? ""} ${a.contact?.lastName ?? ""}`.trim().toLowerCase();
        const nameB = `${b.contact?.firstName ?? ""} ${b.contact?.lastName ?? ""}`.trim().toLowerCase();
        return nameA.localeCompare(nameB);
      }
      default: return new Date(b.issueDate ?? 0).getTime() - new Date(a.issueDate ?? 0).getTime();
    }
  });

  const dateFiltered = filterByDateRange(sorted, (inv) => inv.issueDate, dateRange);
  const statusFiltered = statusFilter === "ALL" ? dateFiltered : dateFiltered.filter((inv) => inv.status === statusFilter);
  const { filtered: searchFiltered } = useCommerceSearch(
    statusFiltered,
    (inv) => `${inv.invoiceNumber ?? ""} ${inv.contact?.firstName ?? ""} ${inv.contact?.lastName ?? ""} ${inv.contact?.email ?? ""} ${(inv.items ?? []).map((i) => `${i.description ?? ""}`).join(" ")} ${inv.notes ?? ""} ${Number(inv.total).toFixed(2)}`,
    search,
  );

  const totalPages = Math.max(1, Math.ceil(searchFiltered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = searchFiltered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Stats
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const stats = (() => {
    let unpaidTotal = 0, unpaidCount = 0, overdueTotal = 0, overdueCount = 0, paidMonthTotal = 0, paidMonthCount = 0, draftsTotal = 0, draftsCount = 0;
    for (const inv of invoices) {
      const total = Number(inv.total);
      const paid = (inv.payments ?? []).filter(p => p.status === "SUCCESSFUL").reduce((s, p) => s + p.amount, 0);
      const remaining = Math.max(0, total - paid);
      if (inv.status === "DRAFT") { draftsTotal += total; draftsCount++; }
      else if (inv.status === "PAID" && inv.paidAt && new Date(inv.paidAt) >= startOfMonth) { paidMonthTotal += total; paidMonthCount++; }
      else if (inv.status === "OVERDUE") { overdueTotal += remaining; overdueCount++; }
      else if (inv.status === "SENT" || inv.status === "PARTIALLY_PAID") { unpaidTotal += remaining; unpaidCount++; }
    }
    return { unpaid: { total: unpaidTotal, count: unpaidCount }, overdue: { total: overdueTotal, count: overdueCount }, paid: { total: paidMonthTotal, count: paidMonthCount }, drafts: { total: draftsTotal, count: draftsCount } };
  })();

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      DRAFT: "bg-slate-100 text-slate-700 border-slate-200",
      SENT: "bg-amber-50 text-amber-700 border-amber-200",
      PAID: "bg-emerald-50 text-emerald-700 border-emerald-200",
      PARTIALLY_PAID: "bg-sky-50 text-sky-700 border-sky-200",
      OVERDUE: "bg-red-50 text-red-700 border-red-200",
      VOID: "bg-gray-100 text-gray-500 border-gray-200",
    };
    return map[status] ?? map.DRAFT;
  };

  const statusLabel = (status: string) => status === "PARTIALLY_PAID" ? "Part-paid" : status;

  const withLoading = async (id: string, key: string, fn: () => Promise<void>) => {
    setActionLoading(prev => ({ ...prev, [id]: key }));
    try { await fn(); } finally { setActionLoading(prev => { const n = { ...prev }; delete n[id]; return n; }); }
  };

  const handleSend = (id: string) => withLoading(id, "send", async () => {
    const { data, error } = await updateInvoiceStatus(id, "SENT");
    if (!error && data) { setInvoices(prev => prev.map(i => i.id === id ? { ...i, status: "SENT" } : i)); toast.success("Invoice sent"); }
    else toast.error(error ?? "Failed to send");
  });

  const handleMarkPaid = (id: string) => withLoading(id, "paid", async () => {
    const { data, error } = await markInvoicePaid(id);
    if (!error && data) { setInvoices(prev => prev.map(i => i.id === id ? { ...i, status: data.status ?? "PAID" } : i)); toast.success("Marked as paid"); }
    else toast.error(error ?? "Failed");
  });

  const handleVoid = (id: string) => withLoading(id, "void", async () => {
    const { data, error } = await updateInvoiceStatus(id, "VOID");
    if (!error && data) { setInvoices(prev => prev.map(i => i.id === id ? { ...i, status: "VOID" } : i)); toast.success("Invoice voided"); }
    else toast.error(error ?? "Failed");
  });

  const handleDelete = (id: string) => {
    if (!businessId) return;
    setConfirmAction(() => async () => {
      const { error } = await apiDelete(`/commerce/businesses/${businessId}/invoices/${id}`);
      if (!error) { setInvoices(prev => prev.filter(i => i.id !== id)); toast.success("Deleted"); }
      else toast.error(error || "Failed");
    });
    setConfirmOpen(true);
  };

  const handleDuplicate = (inv: Invoice) => {
    const dup = { contactId: inv.contactId || "", items: (inv.items ?? []).map(it => ({ description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, productId: it.productId ?? "" })), taxRate: inv.taxRate ?? 0, discountType: inv.discountType || "PERCENT", discountValue: inv.discountValue ?? 0, notes: inv.notes || "" };
    if (typeof window !== "undefined") sessionStorage.setItem("invoice_duplicate", JSON.stringify(dup));
    router.push("/app/commerce/invoices/new");
  };

  const buildPublicUrl = async (inv: Invoice) => {
    if (!businessId) return "";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const { data } = await createInvoicePaymentLink(businessId, inv.id);
    return data?.token ? `${origin}/public/invoice/${data.token}` : `${origin}/pay/${inv.id}`;
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="max-w-6xl mx-auto pb-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/app/commerce")} className="p-2 rounded-lg hover:bg-muted transition-colors">
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
            <p className="text-sm text-muted-foreground">Manage and track all your invoices</p>
          </div>
        </div>
        <button onClick={() => router.push("/app/commerce/invoices/new")} className="inline-flex items-center gap-2 px-4 h-10 text-sm font-semibold rounded-lg bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity shadow-sm">
          <Plus className="w-4 h-4" />
          New Invoice
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {/* Stat Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[
              { key: "unpaid", label: "Unpaid", value: formatAmount(stats.unpaid.total, businessCurrency), count: stats.unpaid.count, icon: Clock, color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-100", filter: "SENT" },
              { key: "overdue", label: "Overdue", value: formatAmount(stats.overdue.total, businessCurrency), count: stats.overdue.count, icon: AlertCircle, color: "text-red-600", bg: "bg-red-50", border: "border-red-100", filter: "OVERDUE" },
              { key: "paid", label: "Paid this month", value: formatAmount(stats.paid.total, businessCurrency), count: stats.paid.count, icon: CheckCircle, color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-100", filter: "PAID" },
              { key: "drafts", label: "Drafts", value: formatAmount(stats.drafts.total, businessCurrency), count: stats.drafts.count, icon: FileText, color: "text-slate-600", bg: "bg-slate-50", border: "border-slate-100", filter: "DRAFT" },
            ].map(card => (
              <button key={card.key} onClick={() => { setStatusFilter(card.filter); setPage(1); }} className={`text-left rounded-xl border ${card.border} ${card.bg} p-5 hover:shadow-md transition-all`}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-muted-foreground">{card.label}</span>
                  <card.icon className={`w-5 h-5 ${card.color}`} />
                </div>
                <p className="text-2xl font-bold tracking-tight">{card.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{card.count} invoice{card.count !== 1 ? "s" : ""}</p>
              </button>
            ))}
          </div>

          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
              <input type="text" placeholder="Search invoices, clients, or amounts..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="w-full pl-10 pr-4 h-11 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20 focus:border-[hsl(var(--kf-accent1))]/30 placeholder:text-muted-foreground/50 shadow-sm" />
            </div>
            <div className="flex items-center gap-2">
              <DateRangeFilter value={dateRange} onChange={setDateRange} />
              <div className="relative">
                <ArrowUpDown className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
                <select value={sortKey} onChange={e => setSortKey(e.target.value as BillingSortKey)} className="appearance-none pl-8 pr-3 h-11 text-xs bg-card border border-border rounded-lg focus:outline-none text-muted-foreground cursor-pointer shadow-sm">
                  {BILLING_SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Status Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none mb-4 pb-1">
            {INVOICE_STATUS_FILTERS.map(f => {
              const active = statusFilter === f.value;
              return (
                <button key={f.value} onClick={() => { setStatusFilter(f.value); setPage(1); }} className={`px-3.5 h-9 text-[13px] rounded-lg transition-all inline-flex items-center gap-1.5 font-medium whitespace-nowrap shrink-0 ${active ? "bg-foreground text-background" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}>
                  {f.label}
                  <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${active ? "bg-background/20" : "bg-background"}`}>{statusCounts[f.value] ?? 0}</span>
                </button>
              );
            })}
            <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap shrink-0">{searchFiltered.length} of {invoices.length}</span>
          </div>

          {/* Table */}
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-5 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Invoice #</th>
                    <th className="text-left px-5 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Client</th>
                    <th className="text-left px-5 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Date</th>
                    <th className="text-left px-5 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Due Date</th>
                    <th className="text-left px-5 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                    <th className="text-right px-5 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Amount</th>
                    <th className="w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {paginated.map(inv => {
                    const due = getDaysUntilDue(inv.dueDate);
                    const paid = (inv.payments ?? []).filter(p => p.status === "SUCCESSFUL").reduce((s, p) => s + p.amount, 0);
                    const pct = Number(inv.total) > 0 ? Math.round((paid / Number(inv.total)) * 100) : 0;
                    return (
                      <tr key={inv.id} className="group hover:bg-muted/20 transition-colors">
                        <td className="px-5 py-4">
                          <button onClick={() => router.push(`/app/commerce/invoices/${inv.id}`)} className="font-mono text-[13px] font-semibold text-[hsl(var(--kf-accent1))] hover:underline">
                            {inv.invoiceNumber ?? inv.id.slice(0, 8)}
                          </button>
                        </td>
                        <td className="px-5 py-4">
                          <span className="text-[13px] text-foreground">
                            {inv.contact ? `${inv.contact.firstName ?? ""} ${inv.contact.lastName ?? ""}`.trim() || inv.contact.email || "—" : "—"}
                          </span>
                        </td>
                        <td className="px-5 py-4 hidden sm:table-cell text-[13px] text-muted-foreground">{inv.issueDate ? new Date(inv.issueDate).toLocaleDateString() : "—"}</td>
                        <td className="px-5 py-4 hidden md:table-cell">
                          <span className={`text-[13px] ${due?.color ?? "text-muted-foreground"}`}>{due?.label ?? (inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "—")}</span>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-1.5">
                            <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${statusBadge(inv.status)}`}>{statusLabel(inv.status)}</span>
                            {inv.status === "OVERDUE" && <span className="text-[10px] font-semibold text-red-600">{due?.label}</span>}
                          </div>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div>
                            <span className="text-[13px] font-semibold">{formatAmount(Number(inv.total), inv.currency)}</span>
                            {inv.status === "PARTIALLY_PAID" && <span className="block text-[10px] text-muted-foreground">{pct}% paid</span>}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="relative">
                            <button onClick={() => setMenuOpenId(menuOpenId === inv.id ? null : inv.id)} className="p-1.5 rounded-md hover:bg-muted transition-colors">
                              <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                            </button>
                            {menuOpenId === inv.id && (
                              <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-xl border border-border bg-popover shadow-lg py-1" onClick={() => setMenuOpenId(null)}>
                                <DropdownItem icon={Send} label="Send" onClick={() => handleSend(inv.id)} show={inv.status === "DRAFT"} loading={actionLoading[inv.id] === "send"} />
                                <DropdownItem icon={DollarSign} label="Record payment" onClick={() => router.push(`/app/commerce/invoices/${inv.id}?action=record-payment`)} show={inv.status === "SENT" || inv.status === "OVERDUE" || inv.status === "PARTIALLY_PAID"} />
                                <DropdownItem icon={Bell} label="Send reminder" onClick={() => sendInvoiceReminder(businessId!, inv.id, { recipientEmail: inv.contact?.email ?? "", message: "Friendly reminder", channel: "email" }).then(r => r.error ? toast.error(r.error) : toast.success("Sent"))} show={!!((inv.status === "SENT" || inv.status === "OVERDUE") && gmailStatus?.connected)} />
                                <DropdownItem icon={CheckCircle2} label="Mark paid" onClick={() => handleMarkPaid(inv.id)} show={inv.status === "DRAFT" || inv.status === "SENT"} loading={actionLoading[inv.id] === "paid"} />
                                <DropdownItem icon={Receipt} label="Resend receipt" onClick={() => resendInvoiceReceipt(businessId!, inv.id, {}).then(r => r.data?.success ? toast.success("Resent") : toast.error(r.error ?? "Failed"))} show={!!(inv.status === "PAID" && gmailStatus?.connected)} />
                                <DropdownItem icon={Files} label="Duplicate" onClick={() => handleDuplicate(inv)} show />
                                <DropdownItem icon={MessageCircle} label="Share WhatsApp" onClick={() => buildPublicUrl(inv).then(url => window.open(`https://wa.me/?text=${encodeURIComponent(`Your invoice: ${url}`)}`, "_blank"))} show />
                                <DropdownItem icon={Ban} label="Void" onClick={() => handleVoid(inv.id)} show={inv.status !== "VOID" && inv.status !== "PAID"} loading={actionLoading[inv.id] === "void"} />
                                <div className="border-t border-border my-1" />
                                <DropdownItem icon={Trash2} label="Delete" destructive onClick={() => handleDelete(inv.id)} show={inv.status === "DRAFT" || inv.status === "VOID"} />
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {paginated.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Search className="w-10 h-10 text-muted-foreground/30 mb-3" />
                <h3 className="text-base font-semibold">No matching invoices</h3>
                <p className="text-sm text-muted-foreground">Try adjusting your search or filters.</p>
              </div>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-xs text-muted-foreground">Showing {(currentPage - 1) * PAGE_SIZE + 1} to {Math.min(currentPage * PAGE_SIZE, searchFiltered.length)} of {searchFiltered.length}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 transition-colors"><ChevronLeft className="w-4 h-4" /></button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let n: number;
                  if (totalPages <= 5) n = i + 1;
                  else if (currentPage <= 3) n = i + 1;
                  else if (currentPage >= totalPages - 2) n = totalPages - 4 + i;
                  else n = currentPage - 2 + i;
                  return <button key={n} onClick={() => setPage(n)} className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${currentPage === n ? "bg-foreground text-background" : "hover:bg-muted text-muted-foreground"}`}>{n}</button>;
                })}
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 transition-colors"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
          )}
        </>
      )}

      <ConfirmDialog open={confirmOpen} onCancel={() => setConfirmOpen(false)} title="Delete invoice?" message="This action cannot be undone." confirmLabel="Delete" variant="danger" onConfirm={() => { confirmAction?.(); setConfirmOpen(false); }} />
    </motion.div>
  );
}

function DropdownItem({ icon: Icon, label, onClick, show, loading, destructive }: { icon: React.ElementType; label: string; onClick: () => void; show: boolean; loading?: boolean; destructive?: boolean }) {
  if (!show) return null;
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors ${destructive ? "text-red-600 hover:bg-red-50" : "text-foreground/80 hover:bg-muted"}`}>
      <Icon className={`w-3.5 h-3.5 shrink-0 ${loading ? "animate-spin" : ""}`} />
      {label}
    </button>
  );
}
