"use client";

import { Volume2 } from "lucide-react";
import { useTts } from "./tts-context";

interface SpeakButtonProps {
  text: string;
  businessId?: string | null;
  className?: string;
}

export function SpeakButton({ text, businessId, className = "" }: SpeakButtonProps) {
  const { engine, state } = useTts();
  const isSpeakingThis =
    state.playing && state.currentText.trim() === text.trim();

  return (
    <button
      onClick={() => engine.speak(text, businessId)}
      title={isSpeakingThis ? "Speaking…" : "Read aloud"}
      className={`
        inline-flex items-center justify-center rounded-md p-1.5
        transition-colors text-muted-foreground hover:text-[hsl(var(--kf-accent1))]
        hover:bg-[hsl(var(--kf-accent1)/0.08)]
        ${isSpeakingThis ? "text-[hsl(var(--kf-accent1))] animate-pulse" : ""}
        ${className}
      `}
    >
      <Volume2 className="w-3.5 h-3.5" />
    </button>
  );
}
