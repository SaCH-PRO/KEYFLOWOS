"use client";

import { useEffect, useState, useCallback } from "react";
import { Settings, Volume2, VolumeX, Save, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { getStoredBusinessId } from "@/lib/workspace";
import { saveVoicePreference } from "@/lib/client";

const VOICE_OPTIONS = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;

interface LocalVoiceSettings {
  voice: (typeof VOICE_OPTIONS)[number];
  speed: number;
  muted: boolean;
}

const STORAGE_KEY = "kf_voice_settings";

function loadSettings(): LocalVoiceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LocalVoiceSettings;
      if (VOICE_OPTIONS.includes(parsed.voice)) return parsed;
    }
  } catch {
    // ignore
  }
  return { voice: "alloy", speed: 1, muted: false };
}

function saveSettings(settings: LocalVoiceSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export default function VoiceSettingsPage() {
  const businessId = getStoredBusinessId() ?? "";
  const [settings, setSettings] = useState<LocalVoiceSettings>(loadSettings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const handleSaveToBackend = useCallback(async () => {
    if (!businessId) {
      toast.error("No business selected");
      return;
    }
    setSaving(true);
    const res = await saveVoicePreference(businessId, {
      voiceKey: settings.voice,
      displayName: settings.voice.charAt(0).toUpperCase() + settings.voice.slice(1),
      provider: "openai",
      speakingRate: settings.speed,
    });
    setSaving(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    toast.success("Voice settings saved");
  }, [businessId, settings]);

  return (
    <UnifiedPageShell
      title="Voice Settings"
      subtitle="Customize your KEY voice experience"
      icon={Settings}
      maxWidth="4xl"
    >
      <div className="space-y-6">
        {/* Voice Selector */}
        <div className="space-y-3">
          <label className="text-sm font-medium">Voice</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {VOICE_OPTIONS.map((v) => (
              <button
                key={v}
                onClick={() => setSettings((prev) => ({ ...prev, voice: v }))}
                className={`px-4 py-3 rounded-xl text-sm font-medium capitalize transition-all border ${
                  settings.voice === v
                    ? "bg-gradient-to-r from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] text-white border-transparent"
                    : "bg-muted/40 hover:bg-muted border-border"
                }`}
                style={
                  settings.voice !== v ? { borderColor: "hsl(var(--kf-border))" } : {}
                }
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Speed Slider */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Speaking speed</label>
            <span className="text-xs text-muted-foreground">{settings.speed.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.1}
            value={settings.speed}
            onChange={(e) =>
              setSettings((prev) => ({ ...prev, speed: parseFloat(e.target.value) }))
            }
            className="w-full accent-[hsl(var(--kf-accent1))]"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>0.5x</span>
            <span>1.0x</span>
            <span>2.0x</span>
          </div>
        </div>

        {/* Mute Toggle */}
        <div className="flex items-center justify-between p-4 rounded-xl border" style={{ borderColor: "hsl(var(--kf-border))" }}>
          <div className="flex items-center gap-3">
            {settings.muted ? (
              <VolumeX className="w-5 h-5 text-muted-foreground" />
            ) : (
              <Volume2 className="w-5 h-5 text-muted-foreground" />
            )}
            <div>
              <div className="text-sm font-medium">Mute TTS</div>
              <div className="text-[10px] text-muted-foreground">
                Disable voice responses from KEY
              </div>
            </div>
          </div>
          <button
            onClick={() => setSettings((prev) => ({ ...prev, muted: !prev.muted }))}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              settings.muted ? "bg-destructive" : "bg-emerald-500"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                settings.muted ? "translate-x-0" : "translate-x-5"
              }`}
            />
          </button>
        </div>

        {/* Save to Backend */}
        <div className="pt-2">
          <button
            onClick={handleSaveToBackend}
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving...
              </>
            ) : saved ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Saved
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save to Cloud
              </>
            )}
          </button>
        </div>
      </div>
    </UnifiedPageShell>
  );
}
