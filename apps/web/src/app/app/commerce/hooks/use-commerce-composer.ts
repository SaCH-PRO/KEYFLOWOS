"use client";

import { useEffect, useState, useCallback } from "react";
import type { Tab } from "../components/commerce-types";

interface ComposerDeps {
  tab: Tab;
  setTab: (t: Tab) => void;
  activeBillingSegment: "quotes" | "invoices" | "schedules";
  setActiveBillingSegment: (seg: "quotes" | "invoices" | "schedules") => void;
  setTriggerNewQuote: (fn: (n: number) => number) => void;
  setTriggerNewInvoice: (fn: (n: number) => number) => void;
  setTriggerNewSchedule: (fn: (n: number) => number) => void;
}

export function useCommerceComposer(deps: ComposerDeps) {
  const {
    tab, setTab, activeBillingSegment, setActiveBillingSegment,
    setTriggerNewQuote, setTriggerNewInvoice, setTriggerNewSchedule,
  } = deps;

  const handleNewItem = useCallback(() => {
    if (tab !== "billing") setTab("billing");
    if (activeBillingSegment === "quotes") setTriggerNewQuote((n) => n + 1);
    else if (activeBillingSegment === "schedules") setTriggerNewSchedule((n) => n + 1);
    else setTriggerNewInvoice((n) => n + 1);
  }, [tab, activeBillingSegment, setTab, setTriggerNewQuote, setTriggerNewInvoice, setTriggerNewSchedule]);

  const handleOverviewNavigate = useCallback((navTab: string, segment?: string) => {
    setTab(navTab as Tab);
    if (navTab === "billing" && segment) {
      setActiveBillingSegment(segment as "quotes" | "invoices" | "schedules");
    }
  }, [setTab, setActiveBillingSegment]);

  return {
    handleNewItem,
    handleOverviewNavigate,
  };
}

export type UseCommerceComposerReturn = ReturnType<typeof useCommerceComposer>;
