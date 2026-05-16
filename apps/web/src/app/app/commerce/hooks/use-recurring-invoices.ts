"use client";

import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import {
  fetchRecurringInvoices,
  createRecurringInvoice,
  updateRecurringInvoice,
  deleteRecurringInvoice,
  RecurringInvoice,
} from "@/lib/client";

export interface RecurringInvoiceFormData {
  contactId: string;
  name: string;
  description?: string;
  frequency: string;
  amount: number;
  currency?: string;
  startDate: string;
  endDate?: string | null;
  nextRunDate: string;
  metadata?: Record<string, unknown> | null;
}

export function useRecurringInvoices(businessId: string | null) {
  const [recurringInvoices, setRecurringInvoices] = useState<RecurringInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await fetchRecurringInvoices(businessId);
    if (err) {
      setError(err);
      toast.error("Failed to load recurring invoices");
    } else if (data) {
      setRecurringInvoices(data);
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!businessId) return;
      setError(null);
      const { data, error: err } = await fetchRecurringInvoices(businessId);
      if (cancelled) return;
      if (err) {
        setError(err);
        toast.error("Failed to load recurring invoices");
      } else if (data) {
        setRecurringInvoices(data);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  const create = useCallback(
    async (formData: RecurringInvoiceFormData) => {
      if (!businessId) return null;
      const { data, error: err } = await createRecurringInvoice(businessId, formData);
      if (err) {
        toast.error("Failed to create recurring invoice");
        return null;
      }
      if (data) {
        setRecurringInvoices((prev) => [data, ...prev]);
        toast.success("Recurring invoice created");
      }
      return data;
    },
    [businessId],
  );

  const update = useCallback(
    async (id: string, formData: Partial<RecurringInvoiceFormData>) => {
      if (!businessId) return null;
      const { data, error: err } = await updateRecurringInvoice(businessId, id, formData);
      if (err) {
        toast.error("Failed to update recurring invoice");
        return null;
      }
      if (data) {
        setRecurringInvoices((prev) => prev.map((r) => (r.id === id ? data : r)));
        toast.success("Recurring invoice updated");
      }
      return data;
    },
    [businessId],
  );

  const cancel = useCallback(
    async (id: string) => {
      if (!businessId) return false;
      const { error: err } = await deleteRecurringInvoice(businessId, id);
      if (err) {
        toast.error("Failed to cancel recurring invoice");
        return false;
      }
      setRecurringInvoices((prev) => prev.filter((r) => r.id !== id));
      toast.success("Recurring invoice cancelled");
      return true;
    },
    [businessId],
  );

  const refresh = useCallback(() => {
    return load();
  }, [load]);

  return {
    recurringInvoices,
    loading,
    error,
    create,
    update,
    cancel,
    refresh,
  };
}
