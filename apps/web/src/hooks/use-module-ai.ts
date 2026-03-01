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

export type AiToolCategory = "analyze" | "generate" | "detect" | "optimize" | "automate";

export type AiTool = {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: AiToolCategory;
  requiresSelection: boolean;
  creditCost: number;
  execute: (context: ModuleContext) => Promise<unknown>;
  renderResult?: (result: unknown) => React.ReactNode;
};

export type ModuleAiConfig = {
  moduleId: string;
  moduleName: string;
  generateSuggestions: (context: ModuleContext) => Promise<AiSuggestion[]>;
  executeAction?: (actionKey: string, context: ModuleContext) => Promise<void>;
  tools?: AiTool[];
};

export type ModuleContext = {
  businessId: string;
  activeView?: string;
  selectedItemId?: string;
  itemCount?: number;
  filters?: Record<string, unknown>;
  customData?: Record<string, unknown>;
};

export type HubMode = "suggestions" | "tools" | "tool-result";

export type ModuleAiState = {
  suggestions: AiSuggestion[];
  loading: boolean;
  error: string | null;
  lastRefreshed: number | null;
  panelOpen: boolean;
  hubMode: HubMode;
  activeToolId: string | null;
  toolResult: unknown;
  toolLoading: boolean;
  toolError: string | null;
};

export function useModuleAi(config: ModuleAiConfig) {
  const [state, setState] = useState<ModuleAiState>({
    suggestions: [],
    loading: false,
    error: null,
    lastRefreshed: null,
    panelOpen: false,
    hubMode: "tools",
    activeToolId: null,
    toolResult: null,
    toolLoading: false,
    toolError: null,
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

  const setHubMode = useCallback((mode: HubMode) => {
    setState(prev => ({ ...prev, hubMode: mode, toolError: null }));
  }, []);

  const executeTool = useCallback(async (toolId: string) => {
    const tool = configRef.current.tools?.find(t => t.id === toolId);
    if (!tool) return;
    if (tool.requiresSelection && !contextRef.current.selectedItemId) {
      toast.info("Select an item first to use this tool");
      return;
    }
    setState(prev => ({
      ...prev,
      activeToolId: toolId,
      toolLoading: true,
      toolError: null,
      toolResult: null,
      hubMode: "tool-result",
    }));
    try {
      const result = await tool.execute(contextRef.current);
      setState(prev => ({
        ...prev,
        toolResult: result,
        toolLoading: false,
      }));
    } catch (err) {
      setState(prev => ({
        ...prev,
        toolLoading: false,
        toolError: (err as Error).message || "Tool execution failed",
      }));
    }
  }, []);

  const clearToolResult = useCallback(() => {
    setState(prev => ({
      ...prev,
      activeToolId: null,
      toolResult: null,
      toolError: null,
      hubMode: "tools",
    }));
  }, []);

  const activeSuggestions = state.suggestions.filter(s => !s.dismissed);
  const highPriority = activeSuggestions.filter(s => s.priority === "high");

  const tools = configRef.current.tools ?? [];
  const availableTools = tools.filter(t =>
    !t.requiresSelection || Boolean(contextRef.current.selectedItemId)
  );
  const activeTool = tools.find(t => t.id === state.activeToolId) ?? null;

  return {
    ...state,
    activeSuggestions,
    highPriority,
    hasUrgent: highPriority.length > 0,
    tools,
    availableTools,
    activeTool,
    contextReady,
    updateContext,
    refreshSuggestions,
    dismissSuggestion,
    executeSuggestionAction,
    togglePanel,
    setOpen,
    setHubMode,
    executeTool,
    clearToolResult,
  };
}

export type UseModuleAiReturn = ReturnType<typeof useModuleAi>;
