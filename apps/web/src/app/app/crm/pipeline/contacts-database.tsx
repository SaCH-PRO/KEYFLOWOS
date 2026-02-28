"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Download,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  Database,
  FileSpreadsheet,
  FileText,
  File,
  X,
  Filter,
  HardDrive,
  Cloud,
} from "lucide-react";
import { toast } from "sonner";
import type { LocalContact } from "@/lib/contacts-db";
import { cacheContacts, getCachedContacts, getLastSyncTime, setLastSyncTime } from "@/lib/contacts-db";
import { exportContacts, type ExportFormat } from "@/lib/contacts-export";

interface ContactsDatabaseProps {
  businessId: string;
  contacts: LocalContact[];
  onRefresh: () => void;
}

type SortField = "firstName" | "lastName" | "email" | "phone" | "status" | "companyName" | "city" | "country" | "source" | "createdAt";
type SortDir = "asc" | "desc";

const VISIBLE_COLUMNS: { key: SortField | "tags" | "jobTitle"; label: string; width: string }[] = [
  { key: "firstName", label: "First Name", width: "w-[120px]" },
  { key: "lastName", label: "Last Name", width: "w-[120px]" },
  { key: "email", label: "Email", width: "w-[200px]" },
  { key: "phone", label: "Phone", width: "w-[130px]" },
  { key: "status", label: "Status", width: "w-[90px]" },
  { key: "companyName", label: "Company", width: "w-[160px]" },
  { key: "jobTitle", label: "Job Title", width: "w-[140px]" },
  { key: "city", label: "City", width: "w-[110px]" },
  { key: "country", label: "Country", width: "w-[110px]" },
  { key: "source", label: "Source", width: "w-[100px]" },
  { key: "tags", label: "Tags", width: "w-[150px]" },
  { key: "createdAt", label: "Created", width: "w-[100px]" },
];

const STATUS_COLORS: Record<string, string> = {
  LEAD: "bg-amber-500/20 text-amber-400",
  PROSPECT: "bg-blue-500/20 text-blue-400",
  CLIENT: "bg-green-500/20 text-green-400",
  LOST: "bg-red-500/20 text-red-400",
};

const EXPORT_OPTIONS: { format: ExportFormat; label: string; desc: string; icon: typeof FileSpreadsheet }[] = [
  { format: "csv", label: "CSV", desc: "Comma-separated values", icon: FileText },
  { format: "xlsx", label: "Excel", desc: "Microsoft Excel workbook", icon: FileSpreadsheet },
  { format: "vcf", label: "vCard", desc: "Contact card format", icon: File },
  { format: "pdf", label: "PDF", desc: "Printable document", icon: FileText },
];

export function ContactsDatabase({ businessId, contacts, onRefresh }: ContactsDatabaseProps) {
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sortField, setSortField] = useState<SortField>("firstName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [showExport, setShowExport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [cachedContacts, setCachedLocal] = useState<LocalContact[]>([]);
  const [usingCache, setUsingCache] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);

  const activeContacts = contacts.length > 0 ? contacts : cachedContacts;

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => { setPage(1); }, [search, statusFilter, sortField, sortDir, pageSize]);

  useEffect(() => {
    getLastSyncTime().then(setLastSync);
    getCachedContacts().then((cached) => {
      if (cached.length > 0) {
        setCachedLocal(cached);
      }
    });
  }, []);

  useEffect(() => {
    if (contacts.length > 0) {
      setUsingCache(false);
      cacheContacts(contacts as LocalContact[]).then(() => {
        setLastSyncTime();
        getLastSyncTime().then(setLastSync);
        setCachedLocal(contacts as LocalContact[]);
      });
    } else if (cachedContacts.length > 0) {
      setUsingCache(true);
    }
  }, [contacts]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      await Promise.resolve(onRefresh());
      toast.success("Contacts synced to local database");
    } catch {
      toast.error("Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [onRefresh]);

  const handleExport = async (format: ExportFormat) => {
    setExporting(true);
    try {
      await exportContacts(filteredContacts, format);
      toast.success(`Exported ${filteredContacts.length} contacts as ${format.toUpperCase()}`);
      setShowExport(false);
    } catch (err) {
      console.error("Export failed:", err);
      toast.error("Export failed — please try again");
    } finally {
      setExporting(false);
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const filteredContacts = useMemo(() => {
    let list = [...activeContacts] as LocalContact[];

    if (statusFilter !== "ALL") {
      list = list.filter((c) => c.status === statusFilter);
    }

    if (search) {
      list = list.filter((c) => {
        const searchable = [
          c.firstName, c.lastName, c.email, c.phone,
          c.companyName, c.jobTitle, c.city, c.country,
          c.source, ...(c.tags || []),
        ].filter(Boolean).join(" ").toLowerCase();
        return searchable.includes(search);
      });
    }

    list.sort((a, b) => {
      let valA = (a as any)[sortField] ?? "";
      let valB = (b as any)[sortField] ?? "";
      if (sortField === "createdAt") {
        valA = valA ? new Date(valA).getTime() : 0;
        valB = valB ? new Date(valB).getTime() : 0;
        return sortDir === "asc" ? valA - valB : valB - valA;
      }
      valA = String(valA).toLowerCase();
      valB = String(valB).toLowerCase();
      const cmp = valA.localeCompare(valB);
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [activeContacts, search, statusFilter, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredContacts.length / pageSize));
  const paginatedContacts = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredContacts.slice(start, start + pageSize);
  }, [filteredContacts, page, pageSize]);

  const getCellValue = (contact: LocalContact, key: string): string => {
    if (key === "tags") return Array.isArray(contact.tags) ? contact.tags.join(", ") : "";
    if (key === "createdAt" && contact.createdAt) {
      return new Date(contact.createdAt).toLocaleDateString("en-TT", {
        year: "numeric", month: "short", day: "numeric",
      });
    }
    return (contact as any)[key] ?? "";
  };

  return (
    <div className="space-y-4">
      <div className="kf-card p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-[hsl(var(--kf-accent2))]/10">
              <Database className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Contact Database</h3>
              <p className="text-xs text-muted-foreground">
                {filteredContacts.length} of {activeContacts.length} contacts
                {usingCache && (
                  <span className="ml-2 text-amber-400/80">(offline cache)</span>
                )}
                {lastSync && (
                  <span className="ml-2 inline-flex items-center gap-1">
                    <HardDrive className="w-3 h-3" />
                    Synced {new Date(lastSync).toLocaleTimeString("en-TT", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="kf-btn-secondary inline-flex items-center gap-1.5 text-xs"
            >
              <Cloud className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
              Sync
            </button>
            <div className="relative">
              <button
                onClick={() => setShowExport(!showExport)}
                className="kf-btn-primary inline-flex items-center gap-1.5 text-xs"
              >
                <Download className="w-3.5 h-3.5" />
                Export
                <ChevronDown className={`w-3 h-3 transition-transform ${showExport ? "rotate-180" : ""}`} />
              </button>
              {showExport && (
                <>
                  <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={() => setShowExport(false)} />
                  <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 kf-card border border-border shadow-2xl rounded-xl py-2 w-64 max-h-[85vh] overflow-y-auto">
                    {EXPORT_OPTIONS.map(({ format, label, desc, icon: Icon }) => (
                      <button
                        key={format}
                        onClick={() => handleExport(format)}
                        disabled={exporting}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/50 transition-colors text-left disabled:opacity-50"
                      >
                        <Icon className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                        <div>
                          <span className="font-medium">{label}</span>
                          <p className="text-[11px] text-muted-foreground">{desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search all fields..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="kf-input w-full pl-10 text-sm"
              aria-label="Search contacts database"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput("")}
                className="absolute right-3 top-1/2 -translate-y-1/2"
              >
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`kf-btn-secondary inline-flex items-center gap-1.5 text-sm ${showFilters ? "ring-2 ring-[hsl(var(--kf-accent1))]" : ""}`}
          >
            <Filter className="w-3.5 h-3.5" />
            Filter
          </button>
        </div>

        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="flex flex-wrap gap-2 mb-3"
            >
              {["ALL", "LEAD", "PROSPECT", "CLIENT", "LOST"].map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1 text-xs rounded-lg transition-all ${
                    statusFilter === s ? "kf-btn-primary" : "kf-btn-secondary"
                  }`}
                >
                  {s}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={tableRef} className="overflow-x-auto rounded-lg border border-border/40">
          <table className="w-full text-sm" role="grid">
            <thead>
              <tr className="bg-muted/30 border-b border-border/40">
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground w-[40px]">#</th>
                {VISIBLE_COLUMNS.map((col) => {
                  const sortable = col.key !== "tags" && col.key !== "jobTitle";
                  const isActive = sortField === col.key;
                  return (
                    <th
                      key={col.key}
                      className={`px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground ${col.width} ${sortable ? "cursor-pointer hover:text-foreground select-none" : ""}`}
                      onClick={() => sortable && handleSort(col.key as SortField)}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {sortable && isActive && (
                          sortDir === "asc"
                            ? <ChevronUp className="w-3 h-3" />
                            : <ChevronDown className="w-3 h-3" />
                        )}
                        {sortable && !isActive && (
                          <ArrowUpDown className="w-3 h-3 opacity-30" />
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {paginatedContacts.length === 0 ? (
                <tr>
                  <td colSpan={VISIBLE_COLUMNS.length + 1} className="px-4 py-8 text-center text-muted-foreground text-sm">
                    {search ? "No contacts match your search" : "No contacts found"}
                  </td>
                </tr>
              ) : (
                paginatedContacts.map((contact, idx) => (
                  <tr
                    key={contact.id}
                    className="border-b border-border/20 hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {(page - 1) * pageSize + idx + 1}
                    </td>
                    {VISIBLE_COLUMNS.map((col) => {
                      const val = getCellValue(contact, col.key);
                      if (col.key === "status") {
                        return (
                          <td key={col.key} className={`px-3 py-2 ${col.width}`}>
                            <span className={`px-2 py-0.5 text-[11px] font-medium rounded-full ${STATUS_COLORS[val] || "bg-muted text-muted-foreground"}`}>
                              {val}
                            </span>
                          </td>
                        );
                      }
                      if (col.key === "tags" && val) {
                        return (
                          <td key={col.key} className={`px-3 py-2 ${col.width}`}>
                            <div className="flex flex-wrap gap-1">
                              {val.split(", ").filter(Boolean).slice(0, 3).map((tag) => (
                                <span key={tag} className="px-1.5 py-0.5 text-[10px] rounded bg-muted/50 text-muted-foreground">
                                  {tag}
                                </span>
                              ))}
                              {val.split(", ").length > 3 && (
                                <span className="text-[10px] text-muted-foreground">+{val.split(", ").length - 3}</span>
                              )}
                            </div>
                          </td>
                        );
                      }
                      return (
                        <td key={col.key} className={`px-3 py-2 text-sm truncate max-w-[200px] ${col.width}`}>
                          {val || <span className="text-muted-foreground/40">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-3 px-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Rows:</span>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="bg-white/5 border border-border/40 rounded px-2 py-1 text-xs"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span className="hidden sm:inline">
              Showing {Math.min((page - 1) * pageSize + 1, filteredContacts.length)}-{Math.min(page * pageSize, filteredContacts.length)} of {filteredContacts.length}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-muted-foreground">{page}/{totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
