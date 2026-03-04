"use client";

import { useEffect, useState, useCallback } from "react";
import {
  fetchProducts,
  fetchInvoices,
  fetchContacts,
  listQuotes,
  getGmailStatus,
  Product,
  Invoice,
  Contact,
  Quote,
} from "@/lib/client";
import { apiGet } from "@/lib/api";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { getAllProductImages } from "@/lib/image-store";
import { Tab, InvoiceLineItem, generateItemId } from "../components/commerce-types";

import { useProducts } from "./use-products";
import { useCommerceIntegrations } from "./use-commerce-integrations";

export interface CommercePrefill {
  contactId?: string;
  items?: InvoiceLineItem[];
  targetSegment?: "quotes" | "invoices";
  _token: number;
}

export function useCommerce() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [businessCurrency, setBusinessCurrency] = useState<string>("TTD");
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("products" as Tab);
  const [products, setProducts] = useState<Product[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showGuide, setShowGuide] = useState(false);
  const [cachedImages, setCachedImages] = useState<Record<string, string>>({});

  const [triggerNewQuote, setTriggerNewQuote] = useState(0);
  const [triggerNewInvoice, setTriggerNewInvoice] = useState(0);
  const [triggerNewSchedule, setTriggerNewSchedule] = useState(0);

  const [pendingPrefill, setPendingPrefill] = useState<CommercePrefill | null>(null);

  const productHook = useProducts(businessId, setProducts, cachedImages, setCachedImages);
  const integrations = useCommerceIntegrations(businessId);

  useEffect(() => {
    const initWorkspace = async () => {
      const fresh = await refreshWorkspace();
      if (fresh) { setBusinessId(fresh); setWorkspaceLoading(false); return; }
      const stored = getStoredBusinessId();
      if (stored) { setBusinessId(stored); setWorkspaceLoading(false); return; }
      setWorkspaceError("Could not find your workspace. Please sign in again.");
      setWorkspaceLoading(false);
    };
    void initWorkspace();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const urlTab = params.get("tab");
    const urlSegment = params.get("segment");
    const urlContactId = params.get("contactId");
    const urlProductIds = params.get("productIds");

    const validTabs: Tab[] = ["products", "billing", "insights"];
    const validSegments = ["quotes", "invoices", "schedules"] as const;
    if (urlTab && validTabs.includes(urlTab as Tab)) setTab(urlTab as Tab);
    const safeSegment = validSegments.includes(urlSegment as any) ? (urlSegment as "quotes" | "invoices") : null;
    if (safeSegment) setActiveBillingSegment(safeSegment);

    if (urlContactId) {
      const items: InvoiceLineItem[] = urlProductIds
        ? urlProductIds.split(",").map((pid) => ({
            id: generateItemId(),
            productId: pid.trim(),
            description: "",
            quantity: "1",
            unitPrice: "",
          }))
        : [];
      setPendingPrefill({
        contactId: urlContactId,
        items: items.length > 0 ? items : undefined,
        targetSegment: urlSegment ?? "invoices",
        _token: Date.now(),
      });
      if (urlTab !== "billing") setTab("billing");
    }

    if (urlContactId || urlTab) {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("tab");
      cleanUrl.searchParams.delete("segment");
      cleanUrl.searchParams.delete("contactId");
      cleanUrl.searchParams.delete("productIds");
      window.history.replaceState({}, "", cleanUrl.toString());
    }
  }, []);

  useEffect(() => {
    if (!businessId) return;
    const load = async () => {
      setLoading(true);
      try {
        const [productsRes, invoicesRes, contactsRes, quotesRes, gmailRes, bizRes] = await Promise.all([
          fetchProducts(businessId),
          fetchInvoices(businessId),
          fetchContacts(businessId),
          listQuotes(businessId),
          getGmailStatus(businessId),
          apiGet<{ metaData: Record<string, any> }>(`/identity/businesses/${businessId}`),
        ]);
        setProducts((productsRes.data ?? []).map((p) => ({ ...p, currency: p.currency ?? "TTD" } as Product)));
        setInvoices(invoicesRes.data ?? []);
        setContacts(contactsRes.data?.contacts ?? []);
        setQuotes(quotesRes.data ?? []);
        if (gmailRes.data) integrations.setGmailStatus(gmailRes.data);
        if (bizRes.data) {
          const biz = bizRes.data as Record<string, unknown>;
          if (typeof biz.currency === "string" && biz.currency) {
            setBusinessCurrency(biz.currency);
          }
          const meta = biz.metaData as Record<string, unknown> | undefined;
          if (meta) {
            integrations.setPaymentGateways({
              wipay: Boolean(meta.wipayApiKey || meta.wipayAccountNumber),
              paypal: Boolean(meta.paypalClientId && meta.paypalClientSecret),
            });
          }
        }
        if (productsRes.error) setError(productsRes.error);
        try { const imgs = await getAllProductImages(); setCachedImages(imgs); } catch {}
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && businessId) {
        const reload = async () => {
          const productsRes = await fetchProducts(businessId);
          setProducts((productsRes.data ?? []).map((p) => ({ ...p, currency: p.currency ?? "TTD" } as Product)));
        };
        void reload();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [businessId]);

  const refreshProducts = useCallback(async () => {
    if (!businessId) return;
    const res = await fetchProducts(businessId);
    setProducts((res.data ?? []).map((p) => ({ ...p, currency: p.currency ?? "TTD" } as Product)));
  }, [businessId]);

  const handleToggleGuide = useCallback(() => setShowGuide((prev) => !prev), []);
  const handleTabChange = useCallback((t: string) => setTab(t as Tab), []);

  const [activeBillingSegment, setActiveBillingSegment] = useState<"quotes" | "invoices" | "schedules">("invoices");

  const handleNewItem = useCallback(() => {
    if (tab === "products") productHook.openAddProduct();
    else if (tab === "billing") {
      if (activeBillingSegment === "quotes") setTriggerNewQuote((n) => n + 1);
      else if (activeBillingSegment === "schedules") setTriggerNewSchedule((n) => n + 1);
      else setTriggerNewInvoice((n) => n + 1);
    }
  }, [tab, activeBillingSegment, productHook.openAddProduct]);

  const prefillForContact = useCallback((contactId: string, target: "quotes" | "invoices" = "invoices", items?: InvoiceLineItem[]) => {
    setTab("billing");
    setActiveBillingSegment(target);
    setPendingPrefill({ contactId, items, targetSegment: target, _token: Date.now() });
  }, []);

  const clearPrefill = useCallback(() => {
    setPendingPrefill(null);
  }, []);

  return {
    businessId,
    businessCurrency,
    workspaceLoading,
    workspaceError,
    tab,
    setTab,
    handleTabChange,
    products,
    setProducts,
    invoices,
    setInvoices,
    quotes,
    setQuotes,
    contacts,
    loading,
    error,

    ...integrations,
    ...productHook,

    refreshProducts,
    showGuide,
    handleToggleGuide,

    triggerNewQuote,
    setTriggerNewQuote,
    triggerNewInvoice,
    setTriggerNewInvoice,
    triggerNewSchedule,
    setTriggerNewSchedule,

    activeBillingSegment,
    setActiveBillingSegment,

    handleNewItem,

    pendingPrefill,
    setPendingPrefill,
    prefillForContact,
    clearPrefill,
  };
}
