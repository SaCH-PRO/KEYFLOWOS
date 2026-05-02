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
import { useCommerceIntegrations } from "./use-commerce-integrations";

export function useCommerceShell() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [businessCurrency, setBusinessCurrency] = useState<string>("TTD");
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cachedImages, setCachedImages] = useState<Record<string, string>>({});

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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `integrations` is a setter bag from useIntegrations() that is recreated each render; including it would re-fetch all commerce data on every render. Only re-run when the businessId itself changes.
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

  return {
    businessId,
    businessCurrency,
    workspaceLoading,
    workspaceError,
    products,
    setProducts,
    invoices,
    setInvoices,
    quotes,
    setQuotes,
    contacts,
    loading,
    error,
    cachedImages,
    setCachedImages,
    refreshProducts,
    integrations,
  };
}

export type UseCommerceShellReturn = ReturnType<typeof useCommerceShell>;
