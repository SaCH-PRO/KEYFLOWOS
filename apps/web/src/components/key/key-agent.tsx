"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff } from "lucide-react";
import { toast } from "sonner";
import { CommandPalette } from "@/components/command-palette";
import { getStoredBusinessId } from "@/lib/workspace";
import { transcribeKeyflowSpeech } from "@/lib/client";
import { useKeyChat, KeyChatPanel, useKeyChatActions, type CopilotModule } from "@/components/key/chat";
import { fetchOnboardingState } from "@/lib/api/onboarding-concierge";
import { nanoid } from "@/components/key/chat/utils";
import { useTts } from "@/components/tts";
import { pickRecorderMimeType, createSilenceMonitor } from "@/components/key/chat/voice-utils";
import { VoiceConversation } from "@/components/key/chat/voice-conversation";
import { openGenomeConversation } from "@/components/key/chat/open-genome-conversation";

export type KeyMode = "chat" | "voice" | "palette" | "onboarding";

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
  const { messages, open, status, setOpen, setInput, setCurrentModule, setPageContext, setActiveSessionId, appendMessage } = useKeyChat();
  const { sendMessage } = useKeyChatActions();
  const { state: ttsState } = useTts();
  const [paletteOpen, setPaletteOpen] = useState(false);

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
  const monitorStopRef = useRef<(() => void) | null>(null);

  const businessId = getStoredBusinessId() ?? "";

  const close = useCallback(() => setOpen(false), [setOpen]);

  // Open the built-in Business Genome onboarding conversation inside the
  // native chat panel — the one continuous genome thread, shared with every
  // other surface via openGenomeConversation.
  const openGenomeOnboardingConversation = useCallback(() => {
    openGenomeConversation(
      { messages, setCurrentModule, setPageContext, setActiveSessionId, appendMessage, setOpen },
      sendMessage,
      { surface: "drawer" },
    );
  }, [appendMessage, messages, sendMessage, setActiveSessionId, setCurrentModule, setOpen, setPageContext]);

  // Handle global open-key events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<OpenKeyDetail>).detail || {};
      if (detail.mode === "palette") {
        setPaletteOpen(true);
        return;
      }
      if (detail.mode === "onboarding") {
        openGenomeOnboardingConversation();
        return;
      }
      setOpen(true);
      if (detail.prompt) setInput(detail.prompt);
      setCurrentModule(detail.module ?? currentModule);
      setPageContext(detail.context ? { ...detail.context } : undefined);
    };
    window.addEventListener(KEY_OPEN_EVENT, handler);
    return () => window.removeEventListener(KEY_OPEN_EVENT, handler);
  }, [currentModule, openGenomeOnboardingConversation, setCurrentModule, setInput, setOpen, setPageContext]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.key) return;
      const isMod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (isMod && k === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (isMod && k === "j") {
        e.preventDefault();
        setOpen((prev) => !prev);
      } else if (e.key === "Escape") {
        close();
        setPaletteOpen(false);
        VoiceConversation.stop();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [close, setOpen]);

  // Legacy event names from existing code paths still open KEY
  useEffect(() => {
    const legacyOpenCopilot = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setOpen(true);
      if (detail?.prompt) setInput(detail.prompt);
      setCurrentModule(undefined);
      setPageContext(undefined);
    };
    window.addEventListener("kf:open-copilot", legacyOpenCopilot);
    return () => window.removeEventListener("kf:open-copilot", legacyOpenCopilot);
  }, [setCurrentModule, setInput, setOpen, setPageContext]);

  // Single post-sign-in genome nudge: once per session, if the Business
  // Genome still needs work, open the native chat panel with the built-in
  // onboarding conversation. Never redirects; fails open on fetch errors.
  // HOME ONLY — auto-opening the panel over working pages (Key Connect,
  // finance, CRM) covers the UI the user came for.
  useEffect(() => {
    if (!businessId) return;
    const alreadyPrompted = sessionStorage.getItem("kf:genome-auto-prompt");
    if (alreadyPrompted === "1") return;
    if (typeof window !== "undefined" && window.location.pathname !== "/app/command-center") return;

    let cancelled = false;
    const timer = setTimeout(() => {
      fetchOnboardingState(businessId)
        .then(({ data }) => {
          if (cancelled || !data) return;
          const needsGenome = !data.onboardingComplete || !data.threePillarMet;
          if (needsGenome) {
            sessionStorage.setItem("kf:genome-auto-prompt", "1");
            openGenomeOnboardingConversation();
          }
        })
        .catch(() => {
          // ignore — a failed status check must never block or redirect the app
        });
    }, 2000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [businessId, openGenomeOnboardingConversation]);

  // Push-to-talk handlers — voice turns end on silence and send immediately.
  const stopPttRecording = useCallback(() => {
    monitorStopRef.current?.();
    monitorStopRef.current = null;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    setPttRecording(false);
  }, []);

  const startPttRecording = useCallback(async () => {
    if (!businessId) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickRecorderMimeType();
      const mr = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        monitorStopRef.current?.();
        monitorStopRef.current = null;
        const audioBlob = new Blob(chunksRef.current, { type: mimeType ?? "audio/webm" });
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
          VoiceConversation.stop();
          return;
        }
        const text = tx.data?.text?.trim();
        if (!text) {
          toast.info("Didn't catch that. Try again.");
          return;
        }
        // Voice-first: send now, keep the conversation loop alive.
        VoiceConversation.start();
        setOpen(true);
        void sendMessage(text);
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setPttRecording(true);
      monitorStopRef.current = createSilenceMonitor(stream, {
        onSilence: () => stopPttRecording(),
        onNoSpeech: () => {
          toast.info("Didn't hear anything — try again.");
          VoiceConversation.stop();
          stopPttRecording();
        },
      });
    } catch (err) {
      if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
        toast.error("Microphone access denied");
      } else {
        toast.error("Voice recording isn't supported in this browser");
      }
      setPttActive(false);
      pttActiveRef.current = false;
    }
  }, [businessId, sendMessage, setOpen, stopPttRecording]);

  // Hands-free conversation loop: when KEY finishes speaking (or the turn
  // ends, if auto-speak is off), re-open the mic while voice mode is active.
  const prevTtsPlayingRef = useRef(false);
  const prevChatStatusRef = useRef(status);

  useEffect(() => {
    if (ttsState.muted) VoiceConversation.stop();
    if (!open) VoiceConversation.stop();
  }, [ttsState.muted, open]);

  useEffect(() => {
    const wasPlaying = prevTtsPlayingRef.current;
    prevTtsPlayingRef.current = ttsState.playing;
    const prevStatus = prevChatStatusRef.current;
    prevChatStatusRef.current = status;

    const ttsFinished = wasPlaying && !ttsState.playing;
    const silentTurnFinished = !ttsState.autoSpeak && prevStatus === "streaming" && status === "idle";
    if (!ttsFinished && !silentTurnFinished) return;
    if (!VoiceConversation.isActive()) return;
    if (ttsState.muted || !open || status !== "idle") {
      VoiceConversation.stop();
      return;
    }
    const timer = setTimeout(() => {
      if (VoiceConversation.isActive() && !mediaRecorderRef.current) {
        void startPttRecording();
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [ttsState.playing, ttsState.muted, ttsState.autoSpeak, open, status, startPttRecording]);

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
      <KeyChatPanel />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

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
                className={`flex h-20 w-20 items-center justify-center rounded-full transition-all ${
                  pttRecording
                    ? "animate-pulse bg-red-500"
                    : pttThinking
                    ? "bg-amber-500"
                    : "bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))]"
                }`}
              >
                {pttRecording ? (
                  <MicOff className="h-8 w-8 text-white" />
                ) : pttThinking ? (
                  <span className="text-2xl text-white">⋯</span>
                ) : (
                  <Mic className="h-8 w-8 text-white" />
                )}
              </div>
              <p className="text-lg font-medium text-white">
                {pttRecording
                  ? "Listening..."
                  : pttThinking
                  ? "Thinking..."
                  : "Hold Space to speak"}
              </p>
              <p className="text-xs text-white/60">Release to send</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
