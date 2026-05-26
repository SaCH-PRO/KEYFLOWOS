"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

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
    const currentRequestId = ++requestIdRef.current;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [productsRes, invoicesRes, contactsRes, quotesRes, gmailRes, bizRes] = await Promise.all([
          fetchProducts(businessId),
          fetchInvoices(businessId),
          fetchContacts(businessId),
          listQuotes(businessId),
          getGmailStatus(businessId),
          apiGet<{ metaData: Record<string, unknown> }>(`/identity/businesses/${businessId}`),
        ]);
        // Ignore stale responses
        if (currentRequestId !== requestIdRef.current || !mountedRef.current) return;

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
        if (invoicesRes.error && !productsRes.error) setError(invoicesRes.error);
        if (contactsRes.error && !productsRes.error && !invoicesRes.error) setError(contactsRes.error);
        if (quotesRes.error && !productsRes.error && !invoicesRes.error && !contactsRes.error) setError(quotesRes.error);
        try {
          const imgs = await getAllProductImages();
          if (currentRequestId === requestIdRef.current && mountedRef.current) {
            setCachedImages(imgs);
          }
        } catch {
          // silently ignore image fetch failures
        }
      } catch (err) {
        if (currentRequestId !== requestIdRef.current || !mountedRef.current) return;
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        if (currentRequestId === requestIdRef.current && mountedRef.current) {
          setLoading(false);
        }
      }
    };
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && businessId && mountedRef.current) {
        const reload = async () => {
          try {
            const productsRes = await fetchProducts(businessId);
            if (mountedRef.current) {
              setProducts((productsRes.data ?? []).map((p) => ({ ...p, currency: p.currency ?? "TTD" } as Product)));
            }
          } catch {
            // ignore visibility reload errors
          }
        };
        void reload();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [businessId]);

  const refreshProducts = useCallback(async () => {
    if (!businessId) return;
    try {
      const res = await fetchProducts(businessId);
      if (mountedRef.current) {
        setProducts((res.data ?? []).map((p) => ({ ...p, currency: p.currency ?? "TTD" } as Product)));
      }
    } catch {
      // ignore refresh errors
    }
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
