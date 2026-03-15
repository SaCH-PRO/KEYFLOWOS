"use client";

import { useCallback, useEffect } from "react";
import { useCommerceAiHub } from "./use-commerce-ai-hub";
import { useModuleEmit } from "@/hooks/use-module-events";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Tab } from "../components/commerce-types";

interface CopilotDeps {
  businessId: string | null;
  tab: Tab;
  invoiceCount: number;
  quoteCount: number;
  handleTabChange: (t: string) => void;
  prefillForContact: (contactId: string, target: "quotes" | "invoices") => void;
}

export function useCommerceCopilot(deps: CopilotDeps) {
  const commerceAi = useCommerceAiHub();
  const emitEvent = useModuleEmit();
  const router = useRouter();

  const {
    businessId, tab, invoiceCount, quoteCount,
    handleTabChange, prefillForContact,
  } = deps;

  useEffect(() => {
    if (businessId) {
      commerceAi.updateCommerceContext({
        businessId,
        activeView: tab,
        itemCount: invoiceCount + quoteCount,
      });
    }
  }, [businessId, tab, invoiceCount, quoteCount, commerceAi.updateCommerceContext]);

  const handleViewContact = useCallback((contactId: string) => {
    if (contactId) {
      emitEvent("contact:selected", "commerce", { contactId });
      router.push(`/app/crm/contacts/${contactId}`);
    }
  }, [emitEvent, router]);

  const handleViewClientIntel = useCallback((contactId: string) => {
    if (contactId) {
      emitEvent("commerce:view_client_intel", "commerce", { contactId });
      if (!commerceAi.panelOpen) commerceAi.setOpen(true);
      commerceAi.executeTool("client-intelligence");
    }
  }, [emitEvent, commerceAi]);

  const handleAiRecoveryPlan = useCallback(() => {
    if (!commerceAi.panelOpen) commerceAi.setOpen(true);
    commerceAi.executeTool("overdue-recovery");
  }, [commerceAi]);

  const handleAiForecast = useCallback(() => {
    if (!commerceAi.panelOpen) commerceAi.setOpen(true);
    commerceAi.executeTool("cashflow-forecast");
  }, [commerceAi]);

  const handleAiDraftReminder = useCallback((invoiceId: string) => {
    commerceAi.updateCommerceContext({ businessId: businessId!, activeView: "invoices", selectedItemId: invoiceId });
    if (!commerceAi.panelOpen) commerceAi.setOpen(true);
    commerceAi.executeTool("invoice-reminder");
  }, [businessId, commerceAi]);

  const handleAiAssistantAction = useCallback((actionKey: string) => {
    if (actionKey.startsWith("filter_status:")) {
      handleTabChange("invoices");
      toast.success(`Filtering by ${actionKey.split(":")[1]}`);
    } else if (actionKey.startsWith("switch_tab:")) {
      const t = actionKey.split(":")[1];
      if (t === "schedules") handleTabChange("recurring");
      else if (t === "quotes" || t === "invoices" || t === "payments" || t === "recurring") handleTabChange(t);
      else handleTabChange("invoices");
    } else if (actionKey.startsWith("send_reminders:")) {
      handleTabChange("invoices");
      toast.success("Opening invoices for reminders...");
    } else if (actionKey.startsWith("tool:")) {
      const toolId = actionKey.split(":")[1];
      if (!commerceAi.panelOpen) commerceAi.setOpen(true);
      commerceAi.executeTool(toolId);
    }
  }, [handleTabChange, commerceAi]);

  return {
    commerceAi,
    handleViewContact,
    handleViewClientIntel,
    handleAiRecoveryPlan,
    handleAiForecast,
    handleAiDraftReminder,
    handleAiAssistantAction,
  };
}

export type UseCommerceCopilotReturn = ReturnType<typeof useCommerceCopilot>;
