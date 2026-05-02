"use client";

import { useCallback } from "react";
import type { Tab } from "../components/commerce-types";

interface ComposerDeps {
  tab: Tab;
  setTab: (t: Tab) => void;
  setTriggerNewQuote: (fn: (n: number) => number) => void;
  setTriggerNewInvoice: (fn: (n: number) => number) => void;
  setTriggerNewSchedule: (fn: (n: number) => number) => void;
}

export function useCommerceComposer(deps: ComposerDeps) {
  const {
    tab, setTab,
    setTriggerNewQuote, setTriggerNewInvoice, setTriggerNewSchedule,
  } = deps;

  const handleNewItem = useCallback(() => {
    if (tab === "quotes") setTriggerNewQuote((n) => n + 1);
    else if (tab === "recurring") setTriggerNewSchedule((n) => n + 1);
    else {
      if (tab !== "invoices") setTab("invoices");
      setTriggerNewInvoice((n) => n + 1);
    }
  }, [tab, setTab, setTriggerNewQuote, setTriggerNewInvoice, setTriggerNewSchedule]);

  return {
    handleNewItem,
  };
}

export type UseCommerceComposerReturn = ReturnType<typeof useCommerceComposer>;
