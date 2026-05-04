"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { CopilotPanel, type CopilotModule } from "@/components/ai/copilot-panel";
import { CommandPalette } from "@/components/command-palette";

export type KeyMode = "chat" | "voice" | "palette";

export interface OpenKeyDetail {
  mode?: KeyMode;
  prompt?: string;
  module?: CopilotModule;
  context?: Record<string, unknown>;
}

export const KEY_OPEN_EVENT = "kf:open-key";

export function openKey(detail: OpenKeyDetail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(KEY_OPEN_EVENT, { detail }));
}

interface KeyAgentProps {
  currentModule?: CopilotModule;
}

export function KeyAgent({ currentModule }: KeyAgentProps) {
  const [mode, setMode] = useState<KeyMode | null>(null);
  const [initialPrompt, setInitialPrompt] = useState<string | undefined>();
  const [scopedModule, setScopedModule] = useState<CopilotModule | undefined>();
  const [pageContext, setPageContext] = useState<Record<string, unknown> | undefined>();

  const close = useCallback(() => setMode(null), []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<OpenKeyDetail>).detail || {};
      setMode(detail.mode || "chat");
      if (detail.prompt) setInitialPrompt(detail.prompt);
      // Always reset module scope on each open: if no module is supplied,
      // fall back to the route-derived `currentModule` instead of
      // remaining stuck on a stale scope from a previous trigger.
      setScopedModule(detail.module);
      // Always reset context too — undefined when omitted clears any
      // stale page context from a prior open.
      setPageContext(detail.context);
    };
    window.addEventListener(KEY_OPEN_EVENT, handler);
    return () => window.removeEventListener(KEY_OPEN_EVENT, handler);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.key) return;
      const isMod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (isMod && k === "k") {
        e.preventDefault();
        setMode((m) => (m === "palette" ? null : "palette"));
      } else if (isMod && k === "j") {
        e.preventDefault();
        setMode((m) => (m === "chat" ? null : "chat"));
      } else if (e.key === "Escape") {
        setMode(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Legacy event names from existing code paths still open KEY
  useEffect(() => {
    const legacyOpenCopilot = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.prompt) setInitialPrompt(detail.prompt);
      setScopedModule(undefined);
      setPageContext(undefined);
      setMode("chat");
    };
    window.addEventListener("kf:open-copilot", legacyOpenCopilot);
    return () => window.removeEventListener("kf:open-copilot", legacyOpenCopilot);
  }, []);

  const onPromptConsumed = useCallback(() => setInitialPrompt(undefined), []);

  const effectiveModule = useMemo<CopilotModule | undefined>(
    () => scopedModule ?? currentModule,
    [scopedModule, currentModule],
  );

  return (
    <>
      <CopilotPanel
        open={mode === "chat" || mode === "voice"}
        onClose={close}
        currentModule={effectiveModule}
        initialPrompt={initialPrompt}
        onInitialPromptConsumed={onPromptConsumed}
        pageContext={pageContext}
      />
      <CommandPalette open={mode === "palette"} onClose={close} />
    </>
  );
}
