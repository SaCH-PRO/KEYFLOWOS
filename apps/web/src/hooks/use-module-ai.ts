"use client";

import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";

export type AiSuggestion = {
  id: string;
  type: "action" | "insight" | "warning" | "tip";
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  actionLabel?: string;
  actionKey?: string;
  icon?: string;
  dismissed?: boolean;
};

export type ModuleAiConfig = {
  moduleId: string;
  moduleName: string;
  generateSuggestions: (context: ModuleContext) => Promise<AiSuggestion[]>;
  executeAction?: (actionKey: string, context: ModuleContext) => Promise<void>;
};

export type ModuleContext = {
  businessId: string;
  activeView?: string;
  selectedItemId?: string;
  itemCount?: number;
  filters?: Record<string, unknown>;
  customData?: Record<string, unknown>;
};

export type ModuleAiState = {
  suggestions: AiSuggestion[];
  loading: boolean;
  error: string | null;
  lastRefreshed: number | null;
  panelOpen: boolean;
};

export function useModuleAi(config: ModuleAiConfig) {
  const [state, setState] = useState<ModuleAiState>({
    suggestions: [],
    loading: false,
    error: null,
    lastRefreshed: null,
    panelOpen: false,
  });

  const contextRef = useRef<ModuleContext>({ businessId: "" });
  const configRef = useRef(config);
  configRef.current = config;

  const contextReady = useCallback(() => {
    return Boolean(contextRef.current.businessId);
  }, []);

  const updateContext = useCallback((ctx: Partial<ModuleContext>) => {
    contextRef.current = { ...contextRef.current, ...ctx };
  }, []);

  const refreshSuggestions = useCallback(async () => {
    if (!contextRef.current.businessId) {
      toast.info("Loading data — try again in a moment");
      return;
    }
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const suggestions = await configRef.current.generateSuggestions(contextRef.current);
      setState(prev => ({
        ...prev,
        suggestions,
        loading: false,
        error: null,
        lastRefreshed: Date.now(),
      }));
    } catch (err) {
      setState(prev => ({
        ...prev,
        suggestions: [],
        loading: false,
        error: (err as Error).message || "Failed to get AI suggestions",
      }));
    }
  }, []);

  const dismissSuggestion = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      suggestions: prev.suggestions.map(s =>
        s.id === id ? { ...s, dismissed: true } : s
      ),
    }));
  }, []);

  const executeSuggestionAction = useCallback(async (suggestion: AiSuggestion) => {
    if (!suggestion.actionKey || !configRef.current.executeAction) return;
    try {
      await configRef.current.executeAction(suggestion.actionKey, contextRef.current);
      dismissSuggestion(suggestion.id);
    } catch {
      toast.error("Failed to execute action");
    }
  }, [dismissSuggestion]);

  const togglePanel = useCallback(() => {
    setState(prev => ({ ...prev, panelOpen: !prev.panelOpen }));
  }, []);

  const setOpen = useCallback((open: boolean) => {
    setState(prev => ({ ...prev, panelOpen: open }));
  }, []);

  const activeSuggestions = state.suggestions.filter(s => !s.dismissed);
  const highPriority = activeSuggestions.filter(s => s.priority === "high");

  return {
    ...state,
    activeSuggestions,
    highPriority,
    hasUrgent: highPriority.length > 0,
    contextReady,
    updateContext,
    refreshSuggestions,
    dismissSuggestion,
    executeSuggestionAction,
    togglePanel,
    setOpen,
  };
}

export type UseModuleAiReturn = ReturnType<typeof useModuleAi>;
