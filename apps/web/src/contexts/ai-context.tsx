"use client";

import { createContext, useContext, useCallback, useRef, useState, useEffect, type ReactNode } from "react";

export interface ModuleContextEntry {
  moduleId: string;
  moduleName: string;
  activeView?: string;
  selectedItemId?: string;
  customData?: Record<string, unknown>;
  lastUpdated: number;
}

interface AiContextState {
  moduleContexts: Record<string, ModuleContextEntry>;
  activeModule: string | null;
}

interface AiContextValue {
  state: AiContextState;
  registerModuleContext: (entry: ModuleContextEntry) => void;
  unregisterModule: (moduleId: string) => void;
  setActiveModule: (moduleId: string | null) => void;
  getActiveContext: () => ModuleContextEntry | null;
  getAllContextSummary: () => string;
}

const AiContext = createContext<AiContextValue | null>(null);

export function AiContextProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AiContextState>({
    moduleContexts: {},
    activeModule: null,
  });

  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const registerModuleContext = useCallback((entry: ModuleContextEntry) => {
    setState((prev) => ({
      ...prev,
      moduleContexts: {
        ...prev.moduleContexts,
        [entry.moduleId]: { ...entry, lastUpdated: Date.now() },
      },
    }));
  }, []);

  const unregisterModule = useCallback((moduleId: string) => {
    setState((prev) => {
      const next = { ...prev.moduleContexts };
      delete next[moduleId];
      return { ...prev, moduleContexts: next };
    });
  }, []);

  const setActiveModule = useCallback((moduleId: string | null) => {
    setState((prev) => ({ ...prev, activeModule: moduleId }));
  }, []);

  const getActiveContext = useCallback((): ModuleContextEntry | null => {
    const s = stateRef.current;
    if (!s.activeModule) return null;
    return s.moduleContexts[s.activeModule] ?? null;
  }, []);

  const getAllContextSummary = useCallback((): string => {
    const s = stateRef.current;
    const entries = Object.values(s.moduleContexts);
    if (entries.length === 0) return "";
    return entries
      .map((e) => {
        const parts = [`Module: ${e.moduleName}`];
        if (e.activeView) parts.push(`View: ${e.activeView}`);
        if (e.customData) {
          const keys = Object.keys(e.customData);
          if (keys.length > 0) parts.push(`Data: ${keys.join(", ")}`);
        }
        return parts.join(" | ");
      })
      .join("\n");
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.moduleId) {
        registerModuleContext({
          moduleId: detail.moduleId,
          moduleName: detail.moduleName || detail.moduleId,
          activeView: detail.activeView,
          selectedItemId: detail.selectedItemId,
          customData: detail.customData,
          lastUpdated: Date.now(),
        });
      }
    };
    window.addEventListener("kf:module-context-update", handler);
    return () => window.removeEventListener("kf:module-context-update", handler);
  }, [registerModuleContext]);

  return (
    <AiContext.Provider
      value={{
        state,
        registerModuleContext,
        unregisterModule,
        setActiveModule,
        getActiveContext,
        getAllContextSummary,
      }}
    >
      {children}
    </AiContext.Provider>
  );
}

export function useAiContext() {
  const ctx = useContext(AiContext);
  if (!ctx) throw new Error("useAiContext must be used within AiContextProvider");
  return ctx;
}
