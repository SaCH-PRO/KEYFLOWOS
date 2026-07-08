"use client";

import { useEffect, useRef } from "react";
import { useKeyChat } from "./key-chat-store";
import { useTts } from "@/components/tts";
import { getStoredBusinessId } from "@/lib/workspace";

export function useKeyChatTts() {
  const { messages, status } = useKeyChat();
  const { engine, state } = useTts();
  const businessId = getStoredBusinessId();
  const lastSpokenRef = useRef<string | null>(null);
  const prevStatusRef = useRef(status);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;

    if (status !== "idle") return;
    const justFinished = prevStatus === "streaming" || prevStatus === "loading";
    if (!justFinished) return;

    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.content.trim());
    if (!lastAssistant) return;
    if (lastSpokenRef.current === lastAssistant.id) return;

    if (state.autoSpeak && !state.muted) {
      lastSpokenRef.current = lastAssistant.id;
      engine.speak(lastAssistant.content, businessId);
    }
  }, [messages, status, engine, state.autoSpeak, state.muted, businessId]);

  // Cancel playback when the user sends a new message so KEY doesn't talk over itself.
  useEffect(() => {
    if (status === "loading" && state.playing) {
      engine.cancel();
    }
  }, [status, engine, state.playing]);
}
