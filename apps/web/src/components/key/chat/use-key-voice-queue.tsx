"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTts } from "@/components/tts";
import { getStoredBusinessId } from "@/lib/workspace";
import { Volume2, VolumeX, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface UseKeyVoiceQueueOptions {
  onStart?: (messageId: string) => void;
  onComplete?: (messageId: string) => void;
  onError?: (messageId: string, error: string) => void;
}

const MAX_CACHE_SIZE = 20;

export function useKeyVoiceQueue(options?: UseKeyVoiceQueueOptions) {
  const { engine, state } = useTts();
  const businessId = getStoredBusinessId();
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const audioCacheRef = useRef<Map<string, string>>(new Map());
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup on unmount: stop playback and revoke all cached Blob URLs
  useEffect(() => {
    return () => {
      activeAudioRef.current?.pause();
      activeAudioRef.current = null;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      // Revoke all cached Blob URLs to prevent memory leaks
      audioCacheRef.current.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      });
      audioCacheRef.current.clear();
    };
  }, []);

  const isPlaying = useCallback((messageId: string) => playingMessageId === messageId, [playingMessageId]);
  const isAnyPlaying = useCallback(() => playingMessageId !== null, [playingMessageId]);

  const revokeAndDelete = useCallback((messageId: string) => {
    const url = audioCacheRef.current.get(messageId);
    if (url) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
      audioCacheRef.current.delete(messageId);
    }
  }, []);

  const stop = useCallback(() => {
    // Stop any active audio element
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current.currentTime = 0;
      activeAudioRef.current = null;
    }
    // Clear any pending timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    engine.cancel();
    setPlayingMessageId(null);
  }, [engine]);

  const speak = useCallback(
    async (messageId: string, text: string) => {
      if (!text.trim() || state.muted) return;

      // Stop any current playback first
      stop();

      try {
        setPlayingMessageId(messageId);
        options?.onStart?.(messageId);

        // Check cache first
        const cached = audioCacheRef.current.get(messageId);
        if (cached) {
          const audio = new Audio(cached);
          audio.playbackRate = state.speed;
          activeAudioRef.current = audio;

          await new Promise<void>((resolve, reject) => {
            audio.onended = () => {
              activeAudioRef.current = null;
              resolve();
            };
            audio.onerror = () => {
              activeAudioRef.current = null;
              reject(new Error("Audio playback failed"));
            };
            audio.play().catch((err) => {
              activeAudioRef.current = null;
              reject(err);
            });
          });
          options?.onComplete?.(messageId);
          setPlayingMessageId(null);
          return;
        }

        // Use TTS engine — it returns a promise that resolves when audio finishes
        await engine.speak(text, businessId);
        options?.onComplete?.(messageId);
      } catch (err) {
        options?.onError?.(messageId, (err as Error).message);
      } finally {
        setPlayingMessageId((current) => (current === messageId ? null : current));
        activeAudioRef.current = null;
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
      }
    },
    [engine, state.muted, state.speed, businessId, options, stop]
  );

  const toggleMute = useCallback(() => {
    engine.toggleMuted();
  }, [engine]);

  return {
    isPlaying,
    isAnyPlaying,
    speak,
    stop,
    toggleMute,
    isMuted: state.muted,
    playingMessageId,
  };
}

interface KeyMessageVoiceProps {
  messageId: string;
  text: string;
  className?: string;
}

export function KeyMessageVoice({ messageId, text, className }: KeyMessageVoiceProps) {
  const { isPlaying, speak, stop, isMuted, toggleMute } = useKeyVoiceQueue();
  const playing = isPlaying(messageId);

  if (isMuted) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggleMute(); // Unmute instead of useless stop()
        }}
        className={cn(
          "rounded p-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors",
          className
        )}
        title="Click to unmute"
      >
        <VolumeX className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (playing) {
          stop();
        } else {
          void speak(messageId, text);
        }
      }}
      className={cn(
        "rounded p-1 transition-colors",
        playing
          ? "text-orange-500 bg-orange-500/10 animate-pulse"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        className
      )}
      title={playing ? "Stop speaking" : "Speak message"}
    >
      {playing ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Volume2 className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
