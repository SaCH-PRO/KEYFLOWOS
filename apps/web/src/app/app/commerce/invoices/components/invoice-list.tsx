"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Eye,
  Send,
  DollarSign,
  Bell,
  Trash2,
  MoreHorizontal,
  CheckCircle,
  Ban,
  Files,
  MessageCircle,
  Mail,
  Receipt,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Invoice, Contact, Product } from "@/lib/client";
import { formatAmount, getDaysUntilDue, formatRelativeDate } from "../../utils/commerce-utils";
import { getStatusBadge, BILLING_SORT_OPTIONS, BillingSortKey, INVOICE_STATUS_FILTERS } from "../../components/commerce-types";
import { useCommerceSearch } from "../../hooks/use-commerce-search";
import { DateRangeFilter, filterByDateRange, DEFAULT_DATE_RANGE } from "../../components/date-range-filter";
import type { DateRange } from "../../components/date-range-filter";
import { getInvoiceSmartCTA } from "../../utils/smart-cta";

interface InvoiceListProps {
  invoices: Invoice[];
  contacts: Contact[];
  products: Product[];
  businessId: string | null;
  currency: string;
  gmailStatus: { connected: boolean; email: string | null } | null;
  onSend: (invoiceId: string) => Promise<void>;
  onMarkPaid: (invoiceId: string) => Promise<void>;
  onVoid: (invoiceId: string) => Promise<void>;
  onDelete: (invoiceId: string) => Promise<void>;
  onRecordPayment: (invoice: Invoice) => void;
  onReminder: (invoice: Invoice) => void;
  onDuplicate: (invoice: Invoice) => void;
  onResendReceipt: (invoice: Invoice) => Promise<void>;
  onShareWhatsApp: (invoice: Invoice) => void;
  actionLoading: Record<string, string>;
  statusFilter: string;
  onStatusFilterChange: (filter: string) => void;
}

const PAGE_SIZE = 10;

export function InvoiceList({
  invoices,
  gmailStatus,
  onSend,
  onMarkPaid,
  onVoid,
  onDelete,
  onRecordPayment,
  onReminder,
  onDuplicate,
  onResendReceipt,
  onShareWhatsApp,
  actionLoading,
  statusFilter,
  onStatusFilterChange,
}: InvoiceListProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<BillingSortKey>("date-desc");
  const [dateRange, setDateRange] = useState<DateRange>(DEFAULT_DATE_RANGE);
  const [page, setPage] = useState(1);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: invoices.length, DRAFT: 0, SENT: 0, PAID: 0, PARTIALLY_PAID: 0, OVERDUE: 0, VOID: 0 };
    for (const inv of invoices) {
      if (inv.status && counts[inv.status] !== undefined) counts[inv.status]++;
    }
    return counts;
  }, [invoices]);

  const sorted = useMemo(() => {
    const list = [...invoices];
    switch (sortKey) {
      case "date-asc":
        return list.sort((a, b) => new Date(a.issueDate ?? 0).getTime() - new Date(b.issueDate ?? 0).getTime());
      case "amount-desc":
        return list.sort((a, b) => Number(b.total) - Number(a.total));
      case "amount-asc":
        return list.sort((a, b) => Number(a.total) - Number(b.total));
      case "name-asc":
        return list.sort((a, b) => {
          const nameA = `${a.contact?.firstName ?? ""} ${a.contact?.lastName ?? ""}`.trim().toLowerCase();
          const nameB = `${b.contact?.firstName ?? ""} ${b.contact?.lastName ?? ""}`.trim().toLowerCase();
          return nameA.localeCompare(nameB);
        });
      default:
        return list.sort((a, b) => new Date(b.issueDate ?? 0).getTime() - new Date(a.issueDate ?? 0).getTime());
    }
  }, [invoices, sortKey]);

  const dateFiltered = useMemo(() => {
    return filterByDateRange(sorted, (inv) => inv.issueDate, dateRange);
  }, [sorted, dateRange]);

  const statusFiltered = useMemo(() => {
    if (statusFilter === "ALL") return dateFiltered;
    return dateFiltered.filter((inv) => inv.status === statusFilter);
  }, [dateFiltered, statusFilter]);

  const { filtered: searchFiltered } = useCommerceSearch(
    statusFiltered,
    (inv) =>
      `${inv.invoiceNumber ?? ""} ${inv.contact?.firstName ?? ""} ${inv.contact?.lastName ?? ""} ${inv.contact?.email ?? ""} ${(inv.items ?? []).map((i) => `${i.description ?? ""}`).join(" ")} ${inv.notes ?? ""} ${Number(inv.total).toFixed(2)}`,
    search,
  );

  const totalPages = Math.max(1, Math.ceil(searchFiltered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = searchFiltered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const visibleFilters = INVOICE_STATUS_FILTERS;

  return (
    <div className="space-y-4">
      {/* Search and controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
        <div className="relative flex-1 min-w-0 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40" />
          <input
            type="text"
            placeholder="Search invoices, clients, or amounts..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-10 pr-4 h-10 text-sm bg-white/[0.03] border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/40 placeholder:text-muted-foreground/40"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <DateRangeFilter value={dateRange} onChange={setDateRange} />
          <div className="relative">
            <ArrowUpDown className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as BillingSortKey)}
              className="appearance-none pl-7 pr-3 h-10 text-xs bg-white/[0.03] border border-border/40 rounded-lg focus:outline-none text-muted-foreground cursor-pointer"
            >
              {BILLING_SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-none pb-1">
        {visibleFilters.map((f) => {
          const count = statusCounts[f.value] ?? 0;
          const isActive = statusFilter === f.value;
          return (
            <button
              key={f.value}
              onClick={() => { onStatusFilterChange(f.value); setPage(1); }}
              className={`px-3 h-9 text-[12px] rounded-lg transition-all inline-flex items-center gap-1.5 font-medium whitespace-nowrap shrink-0 ${
                isActive
                  ? "bg-white/[0.08] border border-border/60 text-foreground"
                  : "bg-transparent border border-transparent text-muted-foreground/60 hover:bg-white/[0.04] hover:text-muted-foreground"
              }`}
            >
              {f.label}
              <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${isActive ? "bg-white/10" : "bg-white/[0.04] text-muted-foreground/50"}`}>
                {count}
              </span>
            </button>
          );
        })}
        <span className="ml-auto text-[11px] text-muted-foreground/50 whitespace-nowrap shrink-0">
          {searchFiltered.length} of {invoices.length}
        </span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/30 bg-white/[0.02]">
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider">Invoice #</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider">Client</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider hidden sm:table-cell">Date</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider hidden md:table-cell">Due Date</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider">Status</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider">Amount</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {paginated.map((inv) => {
                const dueInfo = getDaysUntilDue(inv.dueDate);
                const _smartCTA = getInvoiceSmartCTA(inv.status);
                const paidAmount = (inv.payments ?? [])
                  .filter((p) => p.status === "SUCCESSFUL")
                  .reduce((sum, p) => sum + p.amount, 0);
                const paymentPercent = Number(inv.total) > 0 ? Math.round((paidAmount / Number(inv.total)) * 100) : 0;
                const isMenuOpen = openMenuId === inv.id;

                return (
                  <tr
                    key={inv.id}
                    className="group hover:bg-white/[0.03] transition-colors cursor-pointer"
                    onClick={() => router.push(`/app/commerce/invoices/${inv.id}`)}
                  >
                    <td className="px-4 py-3">
                      <span className="font-mono text-[13px] font-semibold text-[hsl(var(--kf-accent1))]">
                        {inv.invoiceNumber ?? inv.id.slice(0, 8)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[13px] text-foreground/80">
                        {inv.contact
                          ? `${inv.contact.firstName ?? ""} ${inv.contact.lastName ?? ""}`.trim() || inv.contact.email || "—"
                          : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-[12px] text-muted-foreground">
                        {inv.issueDate ? formatRelativeDate(inv.issueDate) : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className={`text-[12px] ${dueInfo?.color ?? "text-muted-foreground"}`}>
                        {dueInfo?.label ?? (inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "—")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${getStatusBadge(inv.status)}`}>
                          {inv.status === "PARTIALLY_PAID" ? "Part-paid" : inv.status}
                        </span>
                        {inv.status === "OVERDUE" && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-red-500/10 text-red-400">
                            {dueInfo?.label}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-col items-end">
                        <span className="text-[13px] font-semibold">{formatAmount(Number(inv.total), inv.currency)}</span>
                        {inv.status === "PARTIALLY_PAID" && (
                          <span className="text-[10px] text-muted-foreground">
                            {paymentPercent}% paid
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="relative">
                        <button
                          onClick={(e) => { e.stopPropagation(); setOpenMenuId(isMenuOpen ? null : inv.id); }}
                          className="p-1.5 rounded-lg hover:bg-white/[0.08] transition-colors"
                        >
                          <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                        </button>
                        {isMenuOpen && (
                          <div
                            className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-xl border border-border/60 bg-popover shadow-xl py-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MenuItem icon={Eye} label="View details" onClick={() => router.push(`/app/commerce/invoices/${inv.id}`)} />
                            <MenuItem icon={Files} label="Duplicate" onClick={() => { setOpenMenuId(null); onDuplicate(inv); }} />
                            <MenuItem icon={MessageCircle} label="Share via WhatsApp" onClick={() => { setOpenMenuId(null); onShareWhatsApp(inv); }} />
                            {gmailStatus?.connected && (
                              <MenuItem icon={Mail} label="Send via email" onClick={() => { setOpenMenuId(null); /* open send email */ }} />
                            )}
                            {(inv.status === "SENT" || inv.status === "OVERDUE" || inv.status === "PARTIALLY_PAID") && gmailStatus?.connected && (
                              <MenuItem icon={Bell} label="Send reminder" onClick={() => { setOpenMenuId(null); onReminder(inv); }} />
                            )}
                            {inv.status === "PAID" && gmailStatus?.connected && inv.contact?.email && (
                              <MenuItem icon={Receipt} label="Resend receipt" onClick={() => { setOpenMenuId(null); onResendReceipt(inv); }} />
                            )}
                            {inv.status === "DRAFT" && (
                              <MenuItem icon={Send} label="Mark as sent" onClick={() => { setOpenMenuId(null); onSend(inv.id); }} loading={actionLoading[inv.id] === "send"} />
                            )}
                            {(inv.status === "SENT" || inv.status === "OVERDUE" || inv.status === "PARTIALLY_PAID") && (
                              <MenuItem icon={DollarSign} label="Record payment" onClick={() => { setOpenMenuId(null); onRecordPayment(inv); }} />
                            )}
                            {(inv.status === "DRAFT" || inv.status === "SENT") && (
                              <MenuItem icon={CheckCircle} label="Mark paid" onClick={() => { setOpenMenuId(null); onMarkPaid(inv.id); }} loading={actionLoading[inv.id] === "paid"} />
                            )}
                            {(inv.status === "DRAFT" || inv.status === "SENT" || inv.status === "OVERDUE" || inv.status === "PARTIALLY_PAID") && (
                              <MenuItem icon={Ban} label="Void invoice" onClick={() => { setOpenMenuId(null); onVoid(inv.id); }} loading={actionLoading[inv.id] === "void"} />
                            )}
                            <div className="border-t border-border/30 my-1" />
                            <MenuItem icon={Trash2} label="Delete" destructive onClick={() => { setOpenMenuId(null); onDelete(inv.id); }} loading={actionLoading[inv.id] === "delete"} />
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
            <div className="w-14 h-14 rounded-xl bg-white/[0.03] border border-border/50 flex items-center justify-center mb-4">
              <Search className="w-7 h-7 text-muted-foreground/50" />
            </div>
            <h3 className="text-lg font-semibold mb-1">No matching invoices</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              No invoices match your current filters. Try adjusting your search or status filter.
            </p>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground/50">
            Showing {(currentPage - 1) * PAGE_SIZE + 1} to {Math.min(currentPage * PAGE_SIZE, searchFiltered.length)} of {searchFiltered.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1.5 rounded-lg hover:bg-white/[0.06] disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 5) pageNum = i + 1;
              else if (currentPage <= 3) pageNum = i + 1;
              else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
              else pageNum = currentPage - 2 + i;
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={`w-8 h-8 rounded-lg text-[11px] font-medium transition-colors ${
                    currentPage === pageNum
                      ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]"
                      : "hover:bg-white/[0.06] text-muted-foreground"
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-1.5 rounded-lg hover:bg-white/[0.06] disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  destructive,
  loading,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  destructive?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors ${
        destructive
          ? "text-red-400 hover:bg-red-500/10"
          : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
      }`}
    >
      <Icon className={`w-3.5 h-3.5 shrink-0 ${loading ? "animate-spin" : ""}`} />
      {label}
    </button>
  );
}
