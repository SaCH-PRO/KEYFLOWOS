"use client";

import { cn } from "@/lib/utils";

export const DEFAULT_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;

export type KeyVoiceKey = (typeof DEFAULT_VOICES)[number];

interface KeyVoiceSelectorProps {
  value: KeyVoiceKey;
  onChange: (voice: KeyVoiceKey) => void;
  voices?: readonly KeyVoiceKey[];
  className?: string;
}

export function KeyVoiceSelector({
  value,
  onChange,
  voices = DEFAULT_VOICES,
  className,
}: KeyVoiceSelectorProps) {
  return (
    <div className={cn("grid grid-cols-2 sm:grid-cols-3 gap-2", className)}>
      {voices.map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`px-4 py-3 rounded-xl text-sm font-medium capitalize transition-all border ${
            value === v
              ? "bg-gradient-to-r from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] text-white border-transparent"
              : "bg-muted/40 hover:bg-muted border-border"
          }`}
          style={value !== v ? { borderColor: "hsl(var(--kf-border))" } : {}}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
