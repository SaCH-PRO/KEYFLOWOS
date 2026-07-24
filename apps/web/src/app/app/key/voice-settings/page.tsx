"use client";

import { useEffect, useState, useCallback } from "react";
import { Settings, Volume2, VolumeX, Save, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { getStoredBusinessId } from "@/lib/workspace";
import { saveVoicePreference, fetchVoicePreferences, fetchVoiceProviders, type VoiceProviderResponse } from "@/lib/client";
import { TtsProviderName } from "@/components/tts";

const DEFAULT_VOICES: Record<TtsProviderName, string> = {
  browser: "default",
  openai: "alloy",
  elevenlabs: "21m00Tcm4TlvDq8ikWAM",
};

interface LocalVoiceSettings {
  provider: TtsProviderName;
  voice: string;
  speed: number;
  muted: boolean;
  autoSpeak: boolean;
}

const STORAGE_KEY = "kf_voice_settings";

function loadSettings(): LocalVoiceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalVoiceSettings>;
      const provider =
        parsed.provider === "browser" || parsed.provider === "openai" || parsed.provider === "elevenlabs"
          ? parsed.provider
          : "browser";
      return {
        provider,
        voice: parsed.voice || DEFAULT_VOICES[provider],
        speed: typeof parsed.speed === "number" ? parsed.speed : 1,
        muted: !!parsed.muted,
        autoSpeak: parsed.autoSpeak !== false,
      };
    }
  } catch {
    // ignore
  }
  return { provider: "browser", voice: "default", speed: 1, muted: false, autoSpeak: true };
}

function saveSettings(settings: LocalVoiceSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export default function VoiceSettingsPage() {
  const businessId = getStoredBusinessId() ?? "";
  const [settings, setSettings] = useState<LocalVoiceSettings>(loadSettings);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [providers, setProviders] = useState<VoiceProviderResponse[]>([]);

  // Load cloud preferences and available providers on mount
  useEffect(() => {
    if (!businessId) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    Promise.all([fetchVoicePreferences(businessId), fetchVoiceProviders(businessId)])
      .then(([prefsRes, providersRes]) => {
        if (cancelled) return;
        if (providersRes.data?.providers) {
          setProviders(providersRes.data.providers);
        }
        const prefs = prefsRes.data;
        if (!prefs || prefs.length === 0) {
          setLoaded(true);
          return;
        }
        const pref = prefs.find((p) => p.isDefault) ?? prefs[0];
        const cloudSettings =
          typeof pref.settings === "object" && pref.settings !== null
            ? (pref.settings as Record<string, unknown>)
            : {};
        const provider =
          pref.provider === "browser" || pref.provider === "openai" || pref.provider === "elevenlabs"
            ? pref.provider
            : loadSettings().provider;
        const providerVoices = providersRes.data?.providers.find((p) => p.name === provider)?.voices || [];
        const voice =
          providerVoices.find((v) => v.key === pref.voiceKey)?.key ||
          pref.voiceKey ||
          DEFAULT_VOICES[provider];
        const speed = typeof pref.speakingRate === "number" ? pref.speakingRate : settings.speed;
        const muted = typeof cloudSettings.muted === "boolean" ? cloudSettings.muted : settings.muted;
        const autoSpeak = typeof cloudSettings.autoSpeak === "boolean" ? cloudSettings.autoSpeak : settings.autoSpeak;
        const next = { ...settings, provider, voice, speed, muted, autoSpeak };
        setSettings(next);
        saveSettings(next);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  useEffect(() => {
    if (!loaded) return;
    saveSettings(settings);
  }, [settings, loaded]);

  const handleProviderChange = useCallback(
    (provider: TtsProviderName) => {
      setSettings((prev) => {
        const providerVoices = providers.find((p) => p.name === provider)?.voices || [];
        const existingValid = providerVoices.find((v) => v.key === prev.voice);
        const voice = existingValid ? prev.voice : DEFAULT_VOICES[provider];
        return { ...prev, provider, voice };
      });
    },
    [providers],
  );

  const handleSaveToBackend = useCallback(async () => {
    if (!businessId) {
      toast.error("No business selected");
      return;
    }
    setSaving(true);
    const res = await saveVoicePreference(businessId, {
      voiceKey: settings.voice,
      displayName:
        providers
          .find((p) => p.name === settings.provider)
          ?.voices.find((v) => v.key === settings.voice)?.name || settings.voice,
      provider: settings.provider,
      speakingRate: settings.speed,
      isDefault: true,
      settings: {
        muted: settings.muted,
        speed: settings.speed,
        autoSpeak: settings.autoSpeak,
        provider: settings.provider,
      },
    });
    setSaving(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    toast.success("Voice settings saved");
  }, [businessId, settings, providers]);

  const currentProvider = providers.find((p) => p.name === settings.provider);
  const voiceOptions = currentProvider?.voices || [];

  return (
    <UnifiedPageShell
      title="Voice Settings"
      subtitle="Customize your KEY voice experience"
      icon={Settings}
      maxWidth="4xl"
    >
      <div className="space-y-6">
        {/* Provider Selector */}
        <div className="space-y-3">
          <label className="text-sm font-medium">Voice provider</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {["browser", "openai", "elevenlabs"].map((providerKey) => {
              const provider = providers.find((p) => p.name === providerKey);
              const display = provider?.displayName || providerKey;
              const available = provider?.available ?? providerKey === "browser";
              return (
                <button
                  key={providerKey}
                  onClick={() => handleProviderChange(providerKey as TtsProviderName)}
                  disabled={!available}
                  className={`px-4 py-3 rounded-xl text-sm font-medium capitalize transition-all border text-left ${
                    settings.provider === providerKey
                      ? "bg-gradient-to-r from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] text-white border-transparent"
                      : available
                        ? "bg-muted/40 hover:bg-muted border-border"
                        : "bg-muted/20 opacity-50 cursor-not-allowed border-border"
                  }`}
                >
                  <span className="block">{display}</span>
                  {!available && (
                    <span className="block text-[10px] font-normal opacity-80">No API key configured</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Voice Selector */}
        {voiceOptions.length > 0 && (
          <div className="space-y-3">
            <label className="text-sm font-medium">Voice</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {voiceOptions.map((v) => (
                <button
                  key={v.key}
                  onClick={() => setSettings((prev) => ({ ...prev, voice: v.key }))}
                  className={`px-4 py-3 rounded-xl text-sm font-medium capitalize transition-all border ${
                    settings.voice === v.key
                      ? "bg-gradient-to-r from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] text-white border-transparent"
                      : "bg-muted/40 hover:bg-muted border-border"
                  }`}
                >
                  {v.name}
                </button>
              ))}
            </div>
          </div>
        )}

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
            onChange={(e) => setSettings((prev) => ({ ...prev, speed: parseFloat(e.target.value) }))}
            className="w-full accent-[hsl(var(--kf-accent1))]"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>0.5x</span>
            <span>1.0x</span>
            <span>2.0x</span>
          </div>
        </div>

        {/* Auto-speak Toggle */}
        <div className="flex items-center justify-between p-4 rounded-xl border" style={{ borderColor: "hsl(var(--kf-border))" }}>
          <div className="flex items-center gap-3">
            {settings.autoSpeak ? (
              <Volume2 className="w-5 h-5 text-muted-foreground" />
            ) : (
              <VolumeX className="w-5 h-5 text-muted-foreground" />
            )}
            <div>
              <div className="text-sm font-medium">Auto-speak KEY replies</div>
              <div className="text-[10px] text-muted-foreground">
                KEY will read assistant messages aloud automatically
              </div>
            </div>
          </div>
          <button
            onClick={() => setSettings((prev) => ({ ...prev, autoSpeak: !prev.autoSpeak }))}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              settings.autoSpeak ? "bg-emerald-500" : "bg-destructive"
            }`}
            aria-label="Auto-speak KEY replies"
            aria-pressed={settings.autoSpeak}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                settings.autoSpeak ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
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
                Disable all voice responses from KEY
              </div>
            </div>
          </div>
          <button
            onClick={() => setSettings((prev) => ({ ...prev, muted: !prev.muted }))}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              settings.muted ? "bg-destructive" : "bg-emerald-500"
            }`}
            aria-label="Mute TTS"
            aria-pressed={settings.muted}
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
