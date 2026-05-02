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
    handleTabChange,
  } = deps;

  useEffect(() => {
    if (businessId) {
      commerceAi.updateCommerceContext({
        businessId,
        activeView: tab,
        itemCount: invoiceCount + quoteCount,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally excludes 'commerceAi' object as a whole; including it would re-create this hook on every AI hub state change. Only the specific method invoked is referenced.
  }, [businessId, tab, invoiceCount, quoteCount, commerceAi.updateCommerceContext]);

  const runToolWithToast = useCallback(async (toolId: string, label: string) => {
    toast.info(`Running ${label}...`);
    try {
      await commerceAi.executeTool(toolId);
      toast.success(`${label} complete — check results in AI copilot`);
    } catch {
      toast.error(`${label} failed. Try again.`);
    }
  }, [commerceAi]);

  const handleViewContact = useCallback((contactId: string) => {
    if (contactId) {
      emitEvent("contact:selected", "commerce", { contactId });
      router.push(`/app/crm/contacts/${contactId}`);
    }
  }, [emitEvent, router]);

  const handleViewClientIntel = useCallback((contactId: string) => {
    if (contactId) {
      emitEvent("commerce:view_client_intel", "commerce", { contactId });
      runToolWithToast("client-intelligence", "Client Intelligence");
    }
  }, [emitEvent, runToolWithToast]);

  const handleAiRecoveryPlan = useCallback(() => {
    runToolWithToast("overdue-recovery", "Recovery Plan");
  }, [runToolWithToast]);

  const handleAiForecast = useCallback(() => {
    runToolWithToast("cashflow-forecast", "Cash Flow Forecast");
  }, [runToolWithToast]);

  const handleAiDraftReminder = useCallback((invoiceId: string) => {
    commerceAi.updateCommerceContext({ businessId: businessId!, activeView: "invoices", selectedItemId: invoiceId });
    runToolWithToast("invoice-reminder", "Invoice Reminder");
  }, [businessId, commerceAi, runToolWithToast]);

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
      const toolName = toolId.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      runToolWithToast(toolId, toolName);
    }
  }, [handleTabChange, runToolWithToast]);

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
