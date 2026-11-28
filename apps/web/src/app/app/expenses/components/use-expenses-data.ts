"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  fetchExpenses,
  fetchExpenseCategories,
  fetchExpenseSummary,
  fetchExpenseBudgets,
  fetchProjects,
  fetchServices,
  fetchContacts,
  Expense,
  ExpenseCategory,
  ExpenseSummary,
  ExpenseBudget,
} from "@/lib/client";
import { BUSINESS_CHANGED_EVENT, getStoredBusinessId } from "@/lib/workspace";
import { EXPENSES_BUSINESS_ID_KEY } from "./expense-utils";
import { readState, type ReadState } from "@/lib/failure-kit";

export interface ProjectOption { id: string; name: string }
export interface ServiceOption { id: string; name: string }
export interface ContactOption { id: string; name: string }

/** The expenses read as the page shows it: loading, the books, no access, or could not load (never zeros). */
export type ExpensesRead = { kind: "loading" } | { kind: "no-business" } | ReadState;
/** One block's own read (the summary, the budgets): a refusal of it is said in its block, never shown as zeros. */
export type BlockRead = { kind: "loading" } | ReadState;

/** The localStorage key the workspace keeps the chosen business under (one copy, in expense-utils; R15). */
const BUSINESS_ID_KEY = EXPENSES_BUSINESS_ID_KEY;

export function useExpensesData() {
  // EXPENSES-HUB-3 (BUG-064, journey J6): a refused or failed read was swallowed here, so the page showed
  // its empty values (TTD 0.00, "No expenses found") as if nothing had been spent.
  const [read, setRead] = useState<ExpensesRead>({ kind: "loading" });
  const [summaryRead, setSummaryRead] = useState<BlockRead>({ kind: "loading" });
  const [budgetsRead, setBudgetsRead] = useState<BlockRead>({ kind: "loading" });
  // R24b (D-315): each secondary read keeps its own state, so a refused one is said ("Couldn't load ...") where its
  // block shows, never shown as an empty block.
  const [categoriesRead, setCategoriesRead] = useState<BlockRead>({ kind: "loading" });
  const [pickersRead, setPickersRead] = useState<BlockRead>({ kind: "loading" });
  const [pickersAgain, setPickersAgain] = useState(0);
  // R25-4: the picker read's generation, as the main read has: an older reply never lands over a newer one.
  const pickersGen = useRef(0);
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
  const [budgets, setBudgets] = useState<ExpenseBudget[]>([]);
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

  // R24b: when the whole read fails, its secondary blocks failed with it (never "loading" for good, never empty).
  const failSecondary = useCallback((st: BlockRead) => {
    setCategoriesRead(st);
  }, []);

  const clearAll = useCallback(() => {
    setExpenses([]); setTotalExpenses(0); setSummary(null); setBudgets([]); setCategories([]);
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
      setCategoriesRead({ kind: "loading" });
      setPickersRead({ kind: "loading" });
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
    const gen = ++pickersGen.current;
    (async () => {
      try {
        const still = () => gen === pickersGen.current && businessRef.current === businessId;
        const [projRes, svcRes, ctRes] = await Promise.all([
          fetchProjects(businessId),
          fetchServices(businessId),
          fetchContacts(businessId),
        ]);
        if (!still()) return;
        // R25-5: a part that failed is offered Retry even when another part is no-access.
        const states = [projRes, svcRes, ctRes].map((r) => readState(r, { what: "the projects, services and contacts to link" }));
        setPickersRead(states.find((st) => st.kind === "failed") ?? states.find((st) => st.kind === "no-access") ?? { kind: "ok" });
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
      } catch {
        if (gen === pickersGen.current && businessRef.current === businessId) setPickersRead({ kind: "failed", message: "Couldn't load the projects, services and contacts to link." });
      }
    })();
    // R6 S-3: and again on every adopted switch (a batched A -> B -> A clears the lists and leaves businessId as it was).
    // R24b: and on a Retry of a refused picker read.
  }, [businessId, switchEpoch, pickersAgain]);
  const retryPickers = useCallback(() => setPickersAgain((n) => n + 1), []);

  const readParams = JSON.stringify([period, debouncedSearch, filterCategory, filterPayment, filterStatus, customStart, customEnd, page, pageSize]);
  // R8-3: this effect must stay above the read effect below. Effects run in order, so the read that a parameter
  // change starts sees paramsRef already holding the new parameters. Were the order swapped, that read would find the
  // ref stale, refuse itself and bump `refresh`; the read would still happen, once, a render later (the fetch count is
  // the same, so tests cannot tell), at the cost of an extra render on every parameter change.
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
    // R10: a filter change on a later page may also read the old page with the new filters before the setPage(1)
    // reset lands; that read is replaced (the generation guard drops its reply). It is not skipped: the skip of round 9
    // compared with the last read started while the reset compares with the last render, and the two could part (a
    // page change batched after the reset), leaving the old filter's rows on screen and every later read refused.
    const generation = ++generationRef.current;
    const current = () => generation === generationRef.current && businessRef.current === businessId;
    setLoading(true);
    try {
      const useCustom = period === "custom" && customStart && customEnd;
      const [expRes, catRes, sumRes, budRes] = await Promise.all([
        fetchExpenses(businessId, { search: debouncedSearch || undefined, categoryId: filterCategory || undefined, paymentMethod: filterPayment || undefined, status: filterStatus || undefined, period: useCustom ? undefined : period, startDate: useCustom ? customStart : undefined, endDate: useCustom ? customEnd : undefined, page, limit: pageSize }),
        fetchExpenseCategories(businessId),
        fetchExpenseSummary(businessId, useCustom ? "custom" : period, useCustom ? customStart : undefined, useCustom ? customEnd : undefined),
        fetchExpenseBudgets(businessId),
      ]);
      // A reply for a business the page has left, or for a read a newer one replaced, is dropped.
      if (!current()) return;
      const state = readState(expRes, { what: "expenses" });
      setRead(state);
      if (state.kind !== "ok") {
        // Nothing of an earlier read stays on screen behind a refusal or a failure.
        clearAll();
        failSecondary(state);
        setLoading(false);
        return;
      }
      if (expRes.data) { setExpenses(expRes.data.data); setTotalExpenses(expRes.data.total); }
      const catState = readState(catRes, { what: "expense categories" });
      setCategoriesRead(catState);
      setCategories(catState.kind === "ok" ? catRes.data ?? [] : []);
      // COR MINOR-7: the summary and the budgets each answer for their own block.
      const sumState = readState(sumRes, { what: "the expense summary" });
      setSummaryRead(sumState);
      setSummary(sumState.kind === "ok" ? sumRes.data ?? null : null);
      const budState = readState(budRes, { what: "the budgets" });
      setBudgetsRead(budState);
      setBudgets(budState.kind === "ok" ? budRes.data ?? [] : []);
    } catch {
      if (!current()) return;
      clearAll();
      setRead({ kind: "failed", message: "Couldn't load expenses." });
      failSecondary({ kind: "failed", message: "Couldn't load expenses." });
    }
    setLoading(false);
  }, [clearAll, failSecondary, businessId, switchEpoch, refresh, readParams, period, debouncedSearch, filterCategory, filterPayment, filterStatus, customStart, customEnd, page, pageSize]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
  useEffect(() => { void loadData(); }, [loadData]);

  // R11-1 (M40 security confirmation): the tabs write into this hook's lists only through these, and only while the
  // business they acted for is still the one shown. A create or delete started on A that answers after the switch
  // to B writes nothing (and its caller says nothing): the hook stays mounted across a switch.
  const isCurrentBusiness = useCallback((forBusiness: string) => businessRef.current === forBusiness, []);
  const addCategory = useCallback((forBusiness: string, category: ExpenseCategory) => {
    if (businessRef.current !== forBusiness) return false;
    setCategories((prev) => (prev.some((c) => c.id === category.id) ? prev : [...prev, category]));
    return true;
  }, []);
  const removeCategory = useCallback((forBusiness: string, categoryId: string) => {
    if (businessRef.current !== forBusiness) return false;
    setCategories((prev) => prev.filter((c) => c.id !== categoryId));
    return true;
  }, []);

  const overBudgetCount = budgets.filter(b => b.isOverBudget).length;
  const nearAlertCount = budgets.filter(b => b.isNearAlert && !b.isOverBudget).length;

  return {
    businessId, read, summaryRead, budgetsRead, categoriesRead, pickersRead, retryPickers,
    expenses, totalExpenses, categories,
    isCurrentBusiness, addCategory, removeCategory,
    summary, budgets, loading, loadData,
    projects, services, contacts,
    period, setPeriod, customStart, setCustomStart, customEnd, setCustomEnd,
    searchQuery, setSearchQuery,
    filterCategory, setFilterCategory, filterPayment, setFilterPayment, filterStatus, setFilterStatus,
    page, setPage, pageSize, setPageSize,
    overBudgetCount, nearAlertCount,
  };
}
