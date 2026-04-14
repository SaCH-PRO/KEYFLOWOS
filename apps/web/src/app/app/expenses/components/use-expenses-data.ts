"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  fetchExpenses, fetchExpenseCategories, fetchExpenseSummary, fetchVendorAnalytics, fetchExpenseBudgets,
  fetchMarginAnalysis, fetchRecurringCandidates, fetchProjects, fetchServices, fetchContacts,
  Expense, ExpenseCategory, ExpenseSummary, VendorAnalytics, ExpenseBudget, MarginAnalysis, RecurringCandidate,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";

export interface ProjectOption { id: string; name: string }
export interface ServiceOption { id: string; name: string }
export interface ContactOption { id: string; name: string }

export function useExpensesData() {
  const [businessId, setBusinessId] = useState<string | null>(null);
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => { const bid = getStoredBusinessId(); if (bid) setBusinessId(bid); }, []);

  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); };
  }, [searchQuery]);

  useEffect(() => { setPage(1); }, [period, filterCategory, filterPayment, debouncedSearch]);

  useEffect(() => {
    if (!businessId) return;
    (async () => {
      try {
        const [projRes, svcRes, ctRes] = await Promise.all([
          fetchProjects(businessId),
          fetchServices(businessId),
          fetchContacts(businessId),
        ]);
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
  }, [businessId]);

  const loadData = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const useCustom = period === "custom" && customStart && customEnd;
      const [expRes, catRes, sumRes, venRes, budRes, margRes, recRes] = await Promise.all([
        fetchExpenses(businessId, { search: debouncedSearch || undefined, categoryId: filterCategory || undefined, paymentMethod: filterPayment || undefined, period: useCustom ? undefined : period, startDate: useCustom ? customStart : undefined, endDate: useCustom ? customEnd : undefined, page, limit: pageSize }),
        fetchExpenseCategories(businessId),
        fetchExpenseSummary(businessId, useCustom ? "custom" : period, useCustom ? customStart : undefined, useCustom ? customEnd : undefined),
        fetchVendorAnalytics(businessId, useCustom ? "custom" : period, useCustom ? customStart : undefined, useCustom ? customEnd : undefined),
        fetchExpenseBudgets(businessId),
        fetchMarginAnalysis(businessId, useCustom ? "custom" : period, useCustom ? customStart : undefined, useCustom ? customEnd : undefined),
        fetchRecurringCandidates(businessId),
      ]);
      if (expRes.data) { setExpenses(expRes.data.data); setTotalExpenses(expRes.data.total); }
      if (catRes.data) setCategories(catRes.data);
      if (sumRes.data) setSummary(sumRes.data);
      if (venRes.data) setVendors(venRes.data);
      if (budRes.data) setBudgets(budRes.data);
      if (margRes.data) setMarginData(margRes.data);
      if (recRes.data) setRecurringCandidates(recRes.data.candidates);
    } catch {}
    setLoading(false);
  }, [businessId, period, debouncedSearch, filterCategory, filterPayment, customStart, customEnd, page, pageSize]);

  useEffect(() => { void loadData(); }, [loadData]);

  const overBudgetCount = budgets.filter(b => b.isOverBudget).length;
  const nearAlertCount = budgets.filter(b => b.isNearAlert && !b.isOverBudget).length;

  return {
    businessId, expenses, totalExpenses, categories, setCategories,
    summary, vendors, budgets, marginData, recurringCandidates, loading, loadData,
    projects, services, contacts,
    period, setPeriod, customStart, setCustomStart, customEnd, setCustomEnd,
    searchQuery, setSearchQuery,
    filterCategory, setFilterCategory, filterPayment, setFilterPayment,
    page, setPage, pageSize, setPageSize,
    overBudgetCount, nearAlertCount,
  };
}
