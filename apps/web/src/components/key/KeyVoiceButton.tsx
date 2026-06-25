"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getApiBase } from "@/lib/api-base";
import {
  Mic,
  MicOff,
  Loader2,
  Volume2,
  AlertCircle,
} from "lucide-react";

const API_BASE = getApiBase();

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type VoiceState = "idle" | "listening" | "processing" | "speaking" | "error";

export interface KeyVoiceButtonProps {
  businessId?: string;
  onTranscript?: (transcript: string) => void;
  onStateChange?: (state: VoiceState) => void;
  size?: "sm" | "md" | "lg";
  className?: string;
  disabled?: boolean;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: {
    transcript: string;
    confidence: number;
  };
}

interface WindowWithSpeech extends Window {
  SpeechRecognition?: new () => SpeechRecognitionInstance;
  webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function stateLabel(state: VoiceState): string {
  switch (state) {
    case "listening":
      return "Listening...";
    case "processing":
      return "Thinking...";
    case "speaking":
      return "Speaking...";
    case "error":
      return "Voice error";
    default:
      return "";
  }
}

const SIZE_MAP = {
  sm: { button: "w-8 h-8", icon: "w-4 h-4", pulse: "w-10 h-10" },
  md: { button: "w-12 h-12", icon: "w-5 h-5", pulse: "w-16 h-16" },
  lg: { button: "w-16 h-16", icon: "w-7 h-7", pulse: "w-20 h-20" },
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function KeyVoiceButton({
  businessId,
  onTranscript,
  onStateChange,
  size = "md",
  className = "",
  disabled = false,
}: KeyVoiceButtonProps) {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [interimTranscript, setInterimTranscript] = useState("");

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const finalTranscriptRef = useRef("");
  const stateRef = useRef(voiceState);

  // Keep ref in sync
  useEffect(() => {
    stateRef.current = voiceState;
  }, [voiceState]);

  // Notify parent of state changes
  useEffect(() => {
    onStateChange?.(voiceState);
  }, [voiceState, onStateChange]);

  /* ---------------------------------------------------------------- */
  /*  Check for SpeechRecognition support                               */
  /* ---------------------------------------------------------------- */
  const isSupported = useCallback(() => {
    return (
      typeof window !== "undefined" &&
      (("SpeechRecognition" in window) || ("webkitSpeechRecognition" in window))
    );
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Stop listening                                                    */
  /* ---------------------------------------------------------------- */
  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    if (stateRef.current === "listening") {
      setVoiceState("idle");
    }
    setInterimTranscript("");
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Start listening                                                   */
  /* ---------------------------------------------------------------- */
  const startListening = useCallback(() => {
    if (!isSupported()) {
      setError("Voice input not supported in this browser. Try Chrome.");
      setVoiceState("error");
      return;
    }

    setError(null);
    finalTranscriptRef.current = "";
    setInterimTranscript("");

    const SpeechRecognition =
      (window as WindowWithSpeech).SpeechRecognition ||
      (window as WindowWithSpeech).webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      setVoiceState("listening");
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";

      for (let i = event.results.length - 1; i >= 0; i--) {
        const result = event.results[i];
        if (result.isFinal && result[0]) {
          final = result[0].transcript;
          break;
        } else if (result[0]) {
          interim = result[0].transcript;
        }
      }

      if (final) {
        finalTranscriptRef.current += " " + final;
        onTranscript?.(finalTranscriptRef.current.trim());
      }
      if (interim) {
        setInterimTranscript(interim);
      }
    };

    recognition.onerror = (event: { error: string }) => {
      if (event.error === "aborted" || event.error === "no-speech") {
        // These are usually user-initiated or benign
        return;
      }
      setError(`Speech error: ${event.error}`);
      setVoiceState("error");
    };

    recognition.onend = () => {
      // If we were listening, the user likely stopped speaking
      if (stateRef.current === "listening") {
        // Submit final transcript if we have one
        if (finalTranscriptRef.current.trim()) {
          setVoiceState("processing");
          // Simulate processing then back to idle
          setTimeout(() => {
            setVoiceState("idle");
            setInterimTranscript("");
          }, 800);
        } else {
          setVoiceState("idle");
        }
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [isSupported, onTranscript]);

  /* ---------------------------------------------------------------- */
  /*  Toggle listening                                                  */
  /* ---------------------------------------------------------------- */
  const toggleListening = useCallback(() => {
    if (voiceState === "listening") {
      stopListening();
    } else {
      void startListening();
    }
  }, [voiceState, startListening, stopListening]);

  /* ---------------------------------------------------------------- */
  /*  TTS: Speak text via KEY's TTS API                                 */
  /* ---------------------------------------------------------------- */
  const speak = useCallback(
    async (text: string) => {
      if (!businessId) return;
      setVoiceState("speaking");

      try {
        const settings = JSON.parse(localStorage.getItem("kf_voice_settings") || "{}");
        const voice = settings.voice || "alloy";

        const res = await fetch(`${API_BASE}/api/v1/cortex/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ businessId, text, voice }),
        });

        if (!res.ok) throw new Error("TTS failed");

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);

        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current = null;
        }

        const audio = new Audio(url);
        audio.playbackRate = settings.speed || 1;
        audioRef.current = audio;

        audio.onended = () => {
          URL.revokeObjectURL(url);
          setVoiceState("idle");
        };

        audio.onerror = () => {
          URL.revokeObjectURL(url);
          setVoiceState("idle");
        };

        void audio.play().catch(() => {
          setVoiceState("idle");
        });
      } catch {
        // Fallback: use browser's built-in TTS
        if ("speechSynthesis" in window) {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.rate = 1;
          utterance.pitch = 1;
          utterance.onend = () => setVoiceState("idle");
          utterance.onerror = () => setVoiceState("idle");
          window.speechSynthesis.speak(utterance);
        } else {
          setVoiceState("idle");
        }
      }
    },
    [businessId]
  );

  /* ---------------------------------------------------------------- */
  /*  Cleanup on unmount                                                */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      audioRef.current?.pause();
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Render                                                            */
  /* ---------------------------------------------------------------- */
  const sizeClasses = SIZE_MAP[size];
  const isListening = voiceState === "listening";
  const isProcessing = voiceState === "processing";
  const isSpeaking = voiceState === "speaking";
  const hasError = voiceState === "error";

  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      {/* Pulsing ring when listening */}
      <AnimatePresence>
        {isListening && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: [0.4, 0.2, 0.4], scale: [1, 1.3, 1] }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            className={`absolute ${sizeClasses.pulse} rounded-full bg-[hsl(24_95%_53%)]`}
          />
        )}
      </AnimatePresence>

      {/* Second slower pulse ring */}
      <AnimatePresence>
        {isListening && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: [0.3, 0.1, 0.3], scale: [1, 1.6, 1] }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
            className={`absolute ${sizeClasses.pulse} rounded-full bg-[hsl(24_95%_53%)]`}
          />
        )}
      </AnimatePresence>

      {/* Main button */}
      <button
        onClick={toggleListening}
        disabled={disabled || isProcessing || isSpeaking}
        className={`
          ${sizeClasses.button} rounded-full flex items-center justify-center
          transition-all duration-200 relative z-10
          ${
            isListening
              ? "bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(24_95%_45%)] text-white shadow-lg shadow-orange-500/30"
              : isProcessing
                ? "bg-white/[0.06] text-amber-400 border border-amber-500/30"
                : isSpeaking
                  ? "bg-white/[0.06] text-emerald-400 border border-emerald-500/30"
                  : hasError
                    ? "bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20"
                    : "bg-white/[0.06] text-[hsl(30_10%_50%)] border border-white/[0.08] hover:bg-white/[0.1] hover:text-[hsl(30_20%_98%)]"
          }
          disabled:opacity-40 disabled:cursor-not-allowed
        `}
        title={
          isListening
            ? "Stop listening"
            : isProcessing
              ? "Processing..."
              : isSpeaking
                ? "Speaking..."
                : hasError
                  ? "Voice error - click to retry"
                  : "Voice input"
        }
      >
        {isProcessing ? (
          <Loader2 className={`${sizeClasses.icon} animate-spin`} />
        ) : isSpeaking ? (
          <Volume2 className={`${sizeClasses.icon}`} />
        ) : isListening ? (
          <MicOff className={`${sizeClasses.icon}`} />
        ) : hasError ? (
          <AlertCircle className={`${sizeClasses.icon}`} />
        ) : (
          <Mic className={`${sizeClasses.icon}`} />
        )}
      </button>

      {/* Status text */}
      <AnimatePresence>
        {(isListening || isProcessing || isSpeaking || hasError) && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap"
          >
            <span
              className={`text-[10px] font-medium ${
                isListening
                  ? "text-[hsl(24_95%_53%)]"
                  : isProcessing
                    ? "text-amber-400"
                    : isSpeaking
                      ? "text-emerald-400"
                      : "text-red-400"
              }`}
            >
              {error || stateLabel(voiceState)}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Interim transcript tooltip */}
      <AnimatePresence>
        {isListening && interimTranscript && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="absolute -top-10 left-1/2 -translate-x-1/2 z-20"
          >
            <div className="px-3 py-1.5 rounded-lg bg-[hsl(20_14%_10%)] border border-white/[0.08] shadow-xl whitespace-nowrap">
              <span className="text-[11px] text-[hsl(30_20%_98%)]">{interimTranscript}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* Re-export speak as a standalone utility */
export async function speakText(
  businessId: string,
  text: string,
  voice?: string
): Promise<void> {
  const settings = JSON.parse(localStorage.getItem("kf_voice_settings") || "{}");
  const selectedVoice = voice || settings.voice || "alloy";

  try {
    const res = await fetch(`${API_BASE}/api/v1/cortex/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ businessId, text, voice: selectedVoice }),
    });

    if (!res.ok) throw new Error("TTS failed");

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.playbackRate = settings.speed || 1;
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
  } catch {
    // Fallback to browser TTS
    if ("speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      window.speechSynthesis.speak(utterance);
    }
  }
}
