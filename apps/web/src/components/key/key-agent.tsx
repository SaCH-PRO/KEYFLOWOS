"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff } from "lucide-react";
import { toast } from "sonner";
import { CopilotPanel, type CopilotModule } from "@/components/ai/copilot-panel";
import { CommandPalette } from "@/components/command-palette";
import { getStoredBusinessId } from "@/lib/workspace";
import { transcribeKeyflowSpeech } from "@/lib/client";

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

function isInputElement(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  return !!el.closest("input, textarea, select, [contenteditable='true']");
}

export function KeyAgent({ currentModule }: KeyAgentProps) {
  const [mode, setMode] = useState<KeyMode | null>(null);
  const [initialPrompt, setInitialPrompt] = useState<string | undefined>();
  const [scopedModule, setScopedModule] = useState<CopilotModule | undefined>();
  const [pageContext, setPageContext] = useState<Record<string, unknown> | undefined>();

  // Push-to-talk state
  const [pttActive, setPttActive] = useState(false);
  const [pttRecording, setPttRecording] = useState(false);
  const [pttThinking, setPttThinking] = useState(false);
  const holdStartRef = useRef<number>(0);
  const pttActiveRef = useRef(false);
  const pttTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const businessId = getStoredBusinessId() ?? "";

  const close = useCallback(() => setMode(null), []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<OpenKeyDetail>).detail || {};
      setMode(detail.mode || "chat");
      if (detail.prompt) setInitialPrompt(detail.prompt);
      setScopedModule(detail.module);
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

  // Push-to-talk handlers
  const startPttRecording = useCallback(async () => {
    if (!businessId) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (audioBlob.size < 200) {
          setPttThinking(false);
          return;
        }
        setPttThinking(true);
        const tx = await transcribeKeyflowSpeech(businessId, audioBlob);
        setPttThinking(false);
        setPttActive(false);
        if (tx.error) {
          toast.error(tx.error);
          return;
        }
        const text = tx.data?.text?.trim();
        if (!text) {
          toast.info("Didn't catch that. Try again.");
          return;
        }
        setInitialPrompt(text);
        setMode("chat");
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setPttRecording(true);
    } catch {
      toast.error("Microphone access denied");
      setPttActive(false);
      pttActiveRef.current = false;
    }
  }, [businessId]);

  const stopPttRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setPttRecording(false);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key !== " ") return;
      if (isInputElement(e.target)) return;
      if (pttActiveRef.current) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      pttActiveRef.current = true;
      holdStartRef.current = Date.now();
      setPttActive(true);
      pttTimerRef.current = setTimeout(() => {
        if (pttActiveRef.current) {
          setPttRecording(true);
          void startPttRecording();
        }
      }, 300);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key !== " ") return;
      if (!pttActiveRef.current) return;
      e.preventDefault();
      pttActiveRef.current = false;
      if (pttTimerRef.current) {
        clearTimeout(pttTimerRef.current);
        pttTimerRef.current = null;
      }
      const heldFor = Date.now() - holdStartRef.current;
      setPttActive(false);
      if (pttRecording) {
        setPttRecording(false);
        stopPttRecording();
      } else if (heldFor < 300) {
        // Quick tap — ignore
        setPttActive(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      if (pttTimerRef.current) clearTimeout(pttTimerRef.current);
    };
  }, [pttRecording, startPttRecording, stopPttRecording]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

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

      {/* Push-to-talk overlay */}
      <AnimatePresence>
        {pttActive && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.8 }}
              className="flex flex-col items-center gap-4"
            >
              <div
                className={`w-20 h-20 rounded-full flex items-center justify-center transition-all ${
                  pttRecording
                    ? "bg-red-500 animate-pulse"
                    : pttThinking
                    ? "bg-amber-500"
                    : "bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))]"
                }`}
              >
                {pttRecording ? (
                  <MicOff className="w-8 h-8 text-white" />
                ) : pttThinking ? (
                  <span className="text-white text-2xl">⋯</span>
                ) : (
                  <Mic className="w-8 h-8 text-white" />
                )}
              </div>
              <p className="text-white text-lg font-medium">
                {pttRecording
                  ? "Listening..."
                  : pttThinking
                  ? "Thinking..."
                  : "Hold Space to speak"}
              </p>
              <p className="text-white/60 text-xs">Release to send</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
