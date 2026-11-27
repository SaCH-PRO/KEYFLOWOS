"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  fetchExpenses,
  fetchExpenseCategories,
  fetchExpenseSummary,
  fetchVendorAnalytics,
  fetchExpenseBudgets,
  fetchMarginAnalysis,
  fetchRecurringCandidates,
  fetchProjects,
  fetchServices,
  fetchContacts,
  Expense,
  ExpenseCategory,
  ExpenseSummary,
  VendorAnalytics,
  ExpenseBudget,
  MarginAnalysis,
  RecurringCandidate,
} from "@/lib/client";
import { BUSINESS_CHANGED_EVENT, getStoredBusinessId } from "@/lib/workspace";
import { readState, type ReadState } from "@/lib/failure-kit";

export interface ProjectOption { id: string; name: string }
export interface ServiceOption { id: string; name: string }
export interface ContactOption { id: string; name: string }

/** The expenses read as the page shows it: loading, the books, no access, or could not load (never zeros). */
export type ExpensesRead = { kind: "loading" } | { kind: "no-business" } | ReadState;
/** One block's own read (the summary, the budgets): a refusal of it is said in its block, never shown as zeros. */
export type BlockRead = { kind: "loading" } | ReadState;

/** The localStorage key the workspace keeps the chosen business under (lib/workspace.ts BUSINESS_ID_KEY). */
const BUSINESS_ID_KEY = "kf_business_id";

export function useExpensesData() {
  // EXPENSES-HUB-3 (BUG-064, journey J6): a refused or failed read was swallowed here, so the page showed
  // its empty values (TTD 0.00, "No expenses found") as if nothing had been spent.
  const [read, setRead] = useState<ExpensesRead>({ kind: "loading" });
  const [summaryRead, setSummaryRead] = useState<BlockRead>({ kind: "loading" });
  const [budgetsRead, setBudgetsRead] = useState<BlockRead>({ kind: "loading" });
  const [businessId, setBusinessId] = useState<string | null>(null);
  // SEC-EXH3-1: the business every reply is checked against, and the generation of the latest read; a reply for
  // another business, or for an older read, writes nothing.
  // undefined until the stored business is first read, so "no business" (null) is adopted too.
  const businessRef = useRef<string | null | undefined>(undefined);
  const generationRef = useRef(0);
  // R5 MAJOR-2 / MINOR-2: every adopted switch bumps this epoch, in a ref (read at once) and in state (so loadData is
  // a new function and the read effect runs again, even when two switches in one batch leave businessId as it was).
  // A loadData from an older epoch is a stale closure (a delete started before the switch): it is refused.
  const switchRef = useRef(0);
  const [switchEpoch, setSwitchEpoch] = useState(0);
  // R6 C-4: bumped when a call from before the latest switch asks for a reload of the business the page shows again
  // (a delete that returns after A -> B -> A): the current view is read afresh, never with that call's old filters.
  const [refresh, setRefresh] = useState(0);
  // R7-4: the read parameters of this render, and (in a ref, set before the read effect runs) the current ones. A
  // loadData whose parameters are not the current ones (a delete started under filter X returns after the filter
  // was cleared) is a stale closure: it asks for one fresh read with the current parameters instead.
  const paramsRef = useRef("");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [totalExpenses, setTotalExpenses] = useState(0);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [vendors, setVendors] = useState<VendorAnalytics[]>([]);
  const [budgets, setBudgets] = useState<ExpenseBudget[]>([]);
  const [marginData, setMarginData] = useState<MarginAnalysis | null>(null);
  const [recurringCandidates, setRecurringCandidates] = useState<RecurringCandidate[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [filterCategory, setFilterCategory] = useState("");
  const [filterPayment, setFilterPayment] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const clearAll = useCallback(() => {
    setExpenses([]); setTotalExpenses(0); setSummary(null); setBudgets([]); setCategories([]);
    setVendors([]); setMarginData(null); setRecurringCandidates([]);
  }, []);

  // SEC-EXH3-1: the business is read on mount and again whenever it changes (this tab's switcher announces
  // BUSINESS_CHANGED_EVENT; another tab writes the stored id). A switch drops every row of the old business at once,
  // before the new one is read, and filters that named the old business's rows (its categories) are reset.
  useEffect(() => {
    const adopt = () => {
      const next = getStoredBusinessId() ?? null;
      if (next === businessRef.current) return;
      businessRef.current = next;
      generationRef.current += 1;
      switchRef.current += 1;
      setSwitchEpoch(switchRef.current);
      clearAll();
      setProjects([]); setServices([]); setContacts([]);
      setFilterCategory("");
      setPage(1);
      setSummaryRead({ kind: "loading" });
      setBudgetsRead({ kind: "loading" });
      // COR MINOR-7: with no business there is nothing to read; say so instead of spinning.
      setRead(next ? { kind: "loading" } : { kind: "no-business" });
      setLoading(Boolean(next));
      setBusinessId(next);
    };
    adopt();
    const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === BUSINESS_ID_KEY) adopt(); };
    window.addEventListener(BUSINESS_CHANGED_EVENT, adopt);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(BUSINESS_CHANGED_EVENT, adopt);
      window.removeEventListener("storage", onStorage);
    };
  }, [clearAll]);

  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); };
  }, [searchQuery]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
  useEffect(() => { setPage(1); }, [period, filterCategory, filterPayment, filterStatus, debouncedSearch]);

  useEffect(() => {
    if (!businessId) return;
    (async () => {
      try {
        const still = () => businessRef.current === businessId;
        const [projRes, svcRes, ctRes] = await Promise.all([
          fetchProjects(businessId),
          fetchServices(businessId),
          fetchContacts(businessId),
        ]);
        if (!still()) return;
        if (projRes.data) {
          setProjects(projRes.data.map((p) => ({ id: p.id, name: p.name })));
        }
        if (svcRes.data) {
          setServices(svcRes.data.map((s) => ({ id: s.id, name: s.name })));
        }
        if (ctRes.data && ctRes.data.contacts) {
          setContacts(ctRes.data.contacts.map((c) => ({
            id: c.id,
            name: c.displayName || [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unknown",
          })));
        }
      } catch {}
    })();
    // R6 S-3: and again on every adopted switch (a batched A -> B -> A clears the lists and leaves businessId as it was).
  }, [businessId, switchEpoch]);

  const readParams = JSON.stringify([period, debouncedSearch, filterCategory, filterPayment, filterStatus, customStart, customEnd, page, pageSize]);
  useEffect(() => { paramsRef.current = readParams; }, [readParams]);

  const loadData = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    // R4-1: a load for a business the page has left (a delete started in A returns after a switch to B and calls
    // A's loadData) writes nothing and takes no generation: taking one would drop B's read still in flight, and
    // the page would stay loading.
    // R5: and a load from before the latest switch (its closure holds that time's filters) is refused the same way,
    // leaving loading as it is for the current read.
    // `refresh` is a trigger (R6 C-4): each bump makes a new loadData, so the read effect runs again.
    void refresh;
    if (businessRef.current !== businessId) return;
    if (switchEpoch !== switchRef.current || readParams !== paramsRef.current) {
      setRefresh((n) => n + 1);
      return;
    }
    const generation = ++generationRef.current;
    const current = () => generation === generationRef.current && businessRef.current === businessId;
    setLoading(true);
    try {
      const useCustom = period === "custom" && customStart && customEnd;
      const [expRes, catRes, sumRes, venRes, budRes, margRes, recRes] = await Promise.all([
        fetchExpenses(businessId, { search: debouncedSearch || undefined, categoryId: filterCategory || undefined, paymentMethod: filterPayment || undefined, status: filterStatus || undefined, period: useCustom ? undefined : period, startDate: useCustom ? customStart : undefined, endDate: useCustom ? customEnd : undefined, page, limit: pageSize }),
        fetchExpenseCategories(businessId),
        fetchExpenseSummary(businessId, useCustom ? "custom" : period, useCustom ? customStart : undefined, useCustom ? customEnd : undefined),
        fetchVendorAnalytics(businessId, useCustom ? "custom" : period, useCustom ? customStart : undefined, useCustom ? customEnd : undefined),
        fetchExpenseBudgets(businessId),
        fetchMarginAnalysis(businessId, useCustom ? "custom" : period, useCustom ? customStart : undefined, useCustom ? customEnd : undefined),
        fetchRecurringCandidates(businessId),
      ]);
      // A reply for a business the page has left, or for a read a newer one replaced, is dropped.
      if (!current()) return;
      const state = readState(expRes, { what: "expenses" });
      setRead(state);
      if (state.kind !== "ok") {
        // Nothing of an earlier read stays on screen behind a refusal or a failure.
        clearAll();
        setLoading(false);
        return;
      }
      if (expRes.data) { setExpenses(expRes.data.data); setTotalExpenses(expRes.data.total); }
      if (catRes.data) setCategories(catRes.data);
      // COR MINOR-7: the summary and the budgets each answer for their own block.
      const sumState = readState(sumRes, { what: "the expense summary" });
      setSummaryRead(sumState);
      setSummary(sumState.kind === "ok" ? sumRes.data ?? null : null);
      if (venRes.data) setVendors(venRes.data);
      const budState = readState(budRes, { what: "the budgets" });
      setBudgetsRead(budState);
      setBudgets(budState.kind === "ok" ? budRes.data ?? [] : []);
      if (margRes.data) setMarginData(margRes.data);
      if (recRes.data) setRecurringCandidates(recRes.data.candidates);
    } catch {
      if (!current()) return;
      clearAll();
      setRead({ kind: "failed", message: "Couldn't load expenses." });
    }
    setLoading(false);
  }, [clearAll, businessId, switchEpoch, refresh, readParams, period, debouncedSearch, filterCategory, filterPayment, filterStatus, customStart, customEnd, page, pageSize]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
  useEffect(() => { void loadData(); }, [loadData]);

  const overBudgetCount = budgets.filter(b => b.isOverBudget).length;
  const nearAlertCount = budgets.filter(b => b.isNearAlert && !b.isOverBudget).length;

  return {
    businessId, read, summaryRead, budgetsRead, expenses, totalExpenses, categories, setCategories,
    summary, vendors, budgets, marginData, recurringCandidates, loading, loadData,
    projects, services, contacts,
    period, setPeriod, customStart, setCustomStart, customEnd, setCustomEnd,
    searchQuery, setSearchQuery,
    filterCategory, setFilterCategory, filterPayment, setFilterPayment, filterStatus, setFilterStatus,
    page, setPage, pageSize, setPageSize,
    overBudgetCount, nearAlertCount,
  };
}
