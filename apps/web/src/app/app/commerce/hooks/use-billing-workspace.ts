"use client";

import { useState, useCallback } from "react";
import { InvoiceLineItem } from "../components/commerce-types";

export interface CommercePrefill {
  contactId?: string;
  items?: InvoiceLineItem[];
  targetSegment?: "quotes" | "invoices";
  _token: number;
}

export function useBillingWorkspace() {
  const [activeBillingSegment, setActiveBillingSegment] = useState<"quotes" | "invoices" | "schedules">("invoices");
  const [triggerNewQuote, setTriggerNewQuote] = useState(0);
  const [triggerNewInvoice, setTriggerNewInvoice] = useState(0);
  const [triggerNewSchedule, setTriggerNewSchedule] = useState(0);
  const [pendingPrefill, setPendingPrefill] = useState<CommercePrefill | null>(null);

  const prefillForContact = useCallback((contactId: string, target: "quotes" | "invoices" = "invoices", items?: InvoiceLineItem[]) => {
    setPendingPrefill({ contactId, items, targetSegment: target, _token: Date.now() });
  }, []);

  const clearPrefill = useCallback(() => {
    setPendingPrefill(null);
  }, []);

  return {
    activeBillingSegment,
    setActiveBillingSegment,
    triggerNewQuote,
    setTriggerNewQuote,
    triggerNewInvoice,
    setTriggerNewInvoice,
    triggerNewSchedule,
    setTriggerNewSchedule,
    pendingPrefill,
    setPendingPrefill,
    prefillForContact,
    clearPrefill,
  };
}

export type UseBillingWorkspaceReturn = ReturnType<typeof useBillingWorkspace>;
