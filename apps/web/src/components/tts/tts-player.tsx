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
import { useTts } from "./tts-context";
import type { TtsProviderName } from "./tts-engine";
import { getStoredBusinessId } from "@/lib/workspace";

export function TtsPlayer() {
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
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-[hsl(20_14%_8%)]/95 px-3 py-2 shadow-2xl backdrop-blur-sm max-w-[calc(100vw-2rem)]">
      <button
        onClick={() => engine.toggleMuted()}
        title={state.muted ? "Unmute" : "Mute"}
        className="p-2 rounded-lg hover:bg-white/[0.06] text-muted-foreground transition-colors"
      >
        {state.muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
      </button>

      <button
        onClick={() => engine.togglePlay()}
        disabled={!state.playing}
        title={state.paused ? "Resume" : "Pause"}
        className="p-2 rounded-lg hover:bg-white/[0.06] text-muted-foreground disabled:opacity-40 transition-colors"
      >
        {state.paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
      </button>

      <button
        onClick={() => engine.cancel()}
        title="Stop"
        className="p-2 rounded-lg hover:bg-white/[0.06] text-muted-foreground transition-colors"
      >
        <Square className="w-4 h-4" />
      </button>

      <div className="hidden sm:flex flex-col min-w-[120px] max-w-[200px]">
        <span className="text-[10px] text-muted-foreground truncate">
          {state.playing ? (state.paused ? "Paused" : "Speaking…") : "Idle"}
        </span>
        <span className="text-[10px] text-foreground truncate">
          {state.currentSentence || state.currentText || "KEY voice ready"}
        </span>
      </div>

      <div className="h-6 w-px bg-white/[0.08] mx-1" />

      <button
        onClick={() => engine.toggleAutoSpeak()}
        title={state.autoSpeak ? "Auto-speak on" : "Auto-speak off"}
        className={`p-2 rounded-lg transition-colors ${
          state.autoSpeak
            ? "text-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1)/0.12)]"
            : "text-muted-foreground hover:bg-white/[0.06]"
        }`}
      >
        {state.autoSpeak ? <RadioTower className="w-4 h-4" /> : <Radio className="w-4 h-4" />}
      </button>

      <div className="hidden sm:flex items-center gap-1" title="Speed">
        <Gauge className="w-3 h-3 text-muted-foreground" />
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
        onChange={(e) => engine.setProvider(e.target.value as TtsProviderName)}
        className="text-[11px] bg-white/[0.06] border border-white/[0.08] rounded-lg px-2 py-1.5 text-foreground outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]"
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
          className="text-[11px] bg-white/[0.06] border border-white/[0.08] rounded-lg px-2 py-1.5 text-foreground outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))] max-w-[120px]"
        >
          {voiceOptions.map((v) => (
            <option key={v.key} value={v.key}>
              {v.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
