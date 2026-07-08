"use client";

import { useEffect } from "react";
import {
  Volume2,
  VolumeX,
  Play,
  Pause,
  Square,
  Radio,
  RadioTower,
  Gauge,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTts } from "@/components/tts";
import { getStoredBusinessId } from "@/lib/workspace";

export function KeyChatVoiceBar() {
  const { engine, state } = useTts();
  const businessId = getStoredBusinessId();

  useEffect(() => {
    void engine.refreshProviders(businessId);
  }, [engine, businessId]);

  const providerOptions = state.availableProviders.length
    ? state.availableProviders
    : [
        { name: "browser", displayName: "Browser / OS", defaultVoice: "default", voices: [], available: true },
        { name: "openai", displayName: "OpenAI TTS", defaultVoice: "alloy", voices: [], available: false },
        { name: "elevenlabs", displayName: "ElevenLabs", defaultVoice: "21m00Tcm4TlvDq8ikWAM", voices: [], available: false },
      ];

  const currentProvider = providerOptions.find((p) => p.name === state.provider);
  const voiceOptions = currentProvider?.voices || [];

  return (
    <div className="flex items-center gap-1.5 border-t border-border/50 bg-background/80 px-3 py-2 backdrop-blur-sm">
      <button
        type="button"
        onClick={() => engine.toggleMuted()}
        title={state.muted ? "Unmute" : "Mute"}
        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {state.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>

      <button
        type="button"
        onClick={() => engine.togglePlay()}
        disabled={!state.playing}
        title={state.paused ? "Resume" : "Pause"}
        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
      >
        {state.paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
      </button>

      <button
        type="button"
        onClick={() => engine.cancel()}
        title="Stop"
        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Square className="h-4 w-4" />
      </button>

      <button
        type="button"
        onClick={() => engine.toggleAutoSpeak()}
        title={state.autoSpeak ? "Auto-speak on" : "Auto-speak off"}
        className={cn(
          "rounded-lg p-2 transition-colors",
          state.autoSpeak
            ? "bg-[hsl(var(--kf-accent1)/0.12)] text-[hsl(var(--kf-accent1))]"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        {state.autoSpeak ? <RadioTower className="h-4 w-4" /> : <Radio className="h-4 w-4" />}
      </button>

      <div className="hidden items-center gap-1 sm:flex" title="Speed">
        <Gauge className="h-3 w-3 text-muted-foreground" />
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.1}
          value={state.speed}
          onChange={(e) => engine.setSpeed(parseFloat(e.target.value))}
          className="w-20 accent-[hsl(var(--kf-accent1))]"
        />
      </div>

      <select
        value={state.provider}
        onChange={(e) => engine.setProvider(e.target.value as any)}
        className="rounded-lg border border-border/60 bg-background px-2 py-1.5 text-[11px] text-foreground outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]"
      >
        {providerOptions.map((p) => (
          <option key={p.name} value={p.name}>
            {p.displayName} {!p.available ? "(no key)" : ""}
          </option>
        ))}
      </select>

      {voiceOptions.length > 0 && (
        <select
          value={state.voice}
          onChange={(e) => engine.setVoice(e.target.value)}
          className="max-w-[120px] rounded-lg border border-border/60 bg-background px-2 py-1.5 text-[11px] text-foreground outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]"
        >
          {voiceOptions.map((v) => (
            <option key={v.key} value={v.key}>
              {v.name}
            </option>
          ))}
        </select>
      )}

      <div className="ml-auto hidden text-[10px] text-muted-foreground sm:block">
        {state.playing ? (state.paused ? "Paused" : "Speaking…") : "KEY voice ready"}
      </div>
    </div>
  );
}
