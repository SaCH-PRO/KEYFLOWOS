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
import { Surface } from "@/components/ui-v2/surface";
import { Button } from "@/components/ui-v2/button";
import { useTts } from "@/components/tts";
import type { TtsProviderName } from "@/components/tts/tts-engine";
import { getStoredBusinessId } from "@/lib/workspace";
import { KeyLiveVoice } from "./key-live-voice";

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
    <Surface
      variant="glass"
      className="flex w-full items-center gap-1.5 rounded-none border-x-0 border-b-0 px-3 py-2"
    >
      <KeyLiveVoice />

      <div className="mx-1 h-5 w-px bg-border/60" aria-hidden />

      <Button
        type="button"
        variant="icon"
        onClick={() => engine.toggleMuted()}
        aria-label={state.muted ? "Unmute" : "Mute"}
        title={state.muted ? "Unmute" : "Mute"}
        className="h-8 w-8"
      >
        {state.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </Button>

      <Button
        type="button"
        variant="icon"
        onClick={() => engine.togglePlay()}
        disabled={!state.playing}
        aria-label={state.paused ? "Resume" : "Pause"}
        title={state.paused ? "Resume" : "Pause"}
        className="h-8 w-8"
      >
        {state.paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
      </Button>

      <Button
        type="button"
        variant="icon"
        onClick={() => engine.cancel()}
        aria-label="Stop"
        title="Stop"
        className="h-8 w-8"
      >
        <Square className="h-4 w-4" />
      </Button>

      <Button
        type="button"
        variant="icon"
        onClick={() => engine.toggleAutoSpeak()}
        aria-label={state.autoSpeak ? "Auto-speak on" : "Auto-speak off"}
        title={state.autoSpeak ? "Auto-speak on" : "Auto-speak off"}
        className={cn(
          "h-8 w-8",
          state.autoSpeak
            ? "bg-violet/10 text-violet hover:bg-violet/15"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        {state.autoSpeak ? <RadioTower className="h-4 w-4" /> : <Radio className="h-4 w-4" />}
      </Button>

      <div className="hidden items-center gap-1 sm:flex" title="Speed">
        <Gauge className="h-3 w-3 text-muted-foreground" />
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.1}
          value={state.speed}
          onChange={(e) => engine.setSpeed(parseFloat(e.target.value))}
          className="w-20 accent-violet"
        />
      </div>

      <select
        value={state.provider}
        onChange={(e) => engine.setProvider(e.target.value as TtsProviderName)}
        className="rounded-lg border border-border/60 bg-surface-muted px-2 py-1.5 text-[11px] text-foreground outline-none focus:ring-1 focus:ring-violet"
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
          className="max-w-[120px] rounded-lg border border-border/60 bg-surface-muted px-2 py-1.5 text-[11px] text-foreground outline-none focus:ring-1 focus:ring-violet"
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
    </Surface>
  );
}
