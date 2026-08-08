"use client";

import { useEffect, useRef } from "react";
import { useKeyChat } from "./key-chat-store";
import { useTts } from "@/components/tts";
import { getStoredBusinessId } from "@/lib/workspace";

/**
 * Speaks KEY's replies sentence-by-sentence as they stream in, instead of
 * waiting for the full message. Sentences are fed to the TTS engine's live
 * queue as soon as they complete; the tail is flushed when the turn ends.
 */
export function useKeyChatTts() {
  const { messages, status } = useKeyChat();
  const { engine, state } = useTts();
  const businessId = getStoredBusinessId();
  const streamingMsgIdRef = useRef<string | null>(null);
  const queuedUptoRef = useRef(0);

  useEffect(() => {
    if (!state.autoSpeak || state.muted) return;

    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant");

    if (status === "streaming") {
      if (!lastAssistant) return;
      if (streamingMsgIdRef.current !== lastAssistant.id) {
        streamingMsgIdRef.current = lastAssistant.id;
        queuedUptoRef.current = 0;
      }
      const content = lastAssistant.content;
      const pending = content.slice(queuedUptoRef.current);
      // Speak only completed sentences/paragraphs; hold the partial tail.
      let lastBoundary = -1;
      for (let i = 0; i < pending.length; i++) {
        const ch = pending[i];
        if (ch === "." || ch === "!" || ch === "?" || ch === "\n") lastBoundary = i;
      }
      if (lastBoundary >= 0) {
        const ready = pending.slice(0, lastBoundary + 1);
        queuedUptoRef.current += lastBoundary + 1;
        engine.enqueueSpoken(ready, businessId);
      }
      return;
    }

    if (status === "idle" && streamingMsgIdRef.current) {
      const finishedId = streamingMsgIdRef.current;
      streamingMsgIdRef.current = null;
      const tail =
        lastAssistant && lastAssistant.id === finishedId
          ? lastAssistant.content.slice(queuedUptoRef.current)
          : lastAssistant?.content ?? "";
      queuedUptoRef.current = 0;
      if (tail.trim()) engine.enqueueSpoken(tail, businessId);
    }
  }, [messages, status, engine, state.autoSpeak, state.muted, businessId]);

  // Cancel playback when the user sends a new message so KEY doesn't talk over itself.
  useEffect(() => {
    if (status === "loading" && state.playing) {
      streamingMsgIdRef.current = null;
      queuedUptoRef.current = 0;
      engine.cancel();
    }
  }, [status, engine, state.playing]);
}
