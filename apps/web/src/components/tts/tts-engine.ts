"use client";

import { getApiBase } from "@/lib/api-base";
import { getAuthHeaders } from "@/lib/api";

const API_BASE = getApiBase();
const STORAGE_KEY = "kf_voice_settings";

export type TtsProviderName = "browser" | "openai" | "elevenlabs";

export interface VoiceInfo {
  key: string;
  name: string;
  language?: string;
  gender?: string;
}

export interface VoiceProviderInfo {
  name: string;
  displayName: string;
  defaultVoice: string;
  voices: VoiceInfo[];
  available: boolean;
}

export interface TtsSettings {
  provider: TtsProviderName;
  voice: string;
  speed: number;
  muted: boolean;
  autoSpeak: boolean;
}

export interface TtsState extends TtsSettings {
  playing: boolean;
  paused: boolean;
  currentText: string;
  currentSentence: string;
  queue: string[];
  availableProviders: VoiceProviderInfo[];
}

export interface SerializedTtsSettings {
  provider?: string;
  voice?: string;
  speed?: number;
  muted?: boolean;
  autoSpeak?: boolean;
}

export function loadTtsSettings(): TtsSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SerializedTtsSettings;
      const provider: TtsProviderName =
        parsed.provider === "browser" || parsed.provider === "openai" || parsed.provider === "elevenlabs"
          ? parsed.provider
          : "browser";
      return {
        provider,
        voice: parsed.voice || (provider === "elevenlabs" ? "21m00Tcm4TlvDq8ikWAM" : "alloy"),
        speed: typeof parsed.speed === "number" ? parsed.speed : 1,
        muted: !!parsed.muted,
        autoSpeak: parsed.autoSpeak !== false,
      };
    }
  } catch {
    // ignore
  }
  return {
    provider: "browser",
    voice: "alloy",
    speed: 1,
    muted: false,
    autoSpeak: true,
  };
}

export function saveTtsSettings(settings: TtsSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

function isBrowserTTSAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  // Match sentences ending in . ! ? or final fragment without terminator
  const matches = trimmed.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  if (!matches) return [trimmed];
  return matches.map((s) => s.trim()).filter(Boolean);
}

/**
 * Strips Markdown/artifact syntax so KEY doesn't vocalize asterisks, URLs,
 * or code fences when speaking chat replies.
 */
export function sanitizeSpokenText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "link")
    .replace(/[*_~#>|]/g, "")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function getVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!isBrowserTTSAvailable()) {
      resolve([]);
      return;
    }
    const synth = window.speechSynthesis;
    const voices = synth.getVoices();
    if (voices.length > 0) {
      resolve(voices);
      return;
    }
    const onVoices = () => {
      synth.removeEventListener("voiceschanged", onVoices);
      resolve(synth.getVoices());
    };
    synth.addEventListener("voiceschanged", onVoices);
    setTimeout(() => {
      synth.removeEventListener("voiceschanged", onVoices);
      resolve(synth.getVoices());
    }, 1000);
  });
}

function pickBrowserVoice(voices: SpeechSynthesisVoice[], preferred?: string): SpeechSynthesisVoice | undefined {
  if (preferred) {
    const byName = voices.find((v) => v.name.toLowerCase().includes(preferred.toLowerCase()));
    if (byName) return byName;
  }
  const en = voices.find((v) => v.lang.toLowerCase().startsWith("en"));
  if (en) return en;
  return voices[0];
}

export type TtsListener = () => void;

export class TtsEngine {
  private state: TtsState;
  private listeners = new Set<TtsListener>();
  private audio: HTMLAudioElement | null = null;
  private abortController: AbortController | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private pendingBrowserSpeech: { text: string; rate: number } | null = null;
  private speechPermissionListenersActive = false;
  private stopped = false;
  private activeSentences: string[] | null = null;

  constructor() {
    const settings = loadTtsSettings();
    this.state = {
      ...settings,
      playing: false,
      paused: false,
      currentText: "",
      currentSentence: "",
      queue: [],
      availableProviders: [],
    };
  }

  subscribe(listener: TtsListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  getState(): TtsState {
    return this.state;
  }

  private setState(partial: Partial<TtsState>) {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  private persist() {
    const { playing, paused, currentText, currentSentence, queue, availableProviders, ...settings } = this.state;
    saveTtsSettings(settings);
  }

  async refreshProviders(businessId?: string | null) {
    if (!businessId) return;
    try {
      const res = await fetch(`${API_BASE}/voice/businesses/${encodeURIComponent(businessId)}/providers`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { providers: VoiceProviderInfo[] };
      this.setState({ availableProviders: data.providers || [] });

      // Default to a real voice when the user has never chosen one: browser
      // speechSynthesis is the fallback, not the experience we want to ship.
      const hasStoredPreference = (() => {
        try {
          return localStorage.getItem(STORAGE_KEY) !== null;
        } catch {
          return true;
        }
      })();
      if (!hasStoredPreference && this.state.provider === "browser") {
        const best = (data.providers || []).find((p) => p.available && p.name !== "browser");
        if (best) {
          this.setProvider(best.name as TtsProviderName);
          if (best.defaultVoice) this.setVoice(best.defaultVoice);
        }
      }
    } catch {
      // best-effort
    }
  }

  setProvider(provider: TtsProviderName) {
    const defaultVoice =
      provider === "elevenlabs" ? "21m00Tcm4TlvDq8ikWAM" : provider === "openai" ? "alloy" : "default";
    this.setState({ provider, voice: defaultVoice });
    this.persist();
  }

  setVoice(voice: string) {
    this.setState({ voice });
    this.persist();
  }

  setSpeed(speed: number) {
    this.setState({ speed });
    this.persist();
  }

  setMuted(muted: boolean) {
    this.setState({ muted });
    this.persist();
    if (muted) this.cancel();
  }

  toggleMuted() {
    this.setMuted(!this.state.muted);
  }

  setAutoSpeak(autoSpeak: boolean) {
    this.setState({ autoSpeak });
    this.persist();
  }

  toggleAutoSpeak() {
    this.setAutoSpeak(!this.state.autoSpeak);
  }

  speak(text: string, businessId?: string | null) {
    if (this.state.muted || !text.trim()) return;
    this.cancel();
    const clean = sanitizeSpokenText(text);
    const sentences = splitSentences(clean);
    if (sentences.length === 0) return;
    this.activeSentences = sentences;
    this.setState({
      playing: true,
      paused: false,
      currentText: clean,
      currentSentence: sentences[0] || "",
      queue: sentences.slice(1),
    });
    void this.runQueue(sentences, businessId);
  }

  /**
   * Feed text into the voice queue while a reply is still streaming. If the
   * engine is mid-playback the sentences are appended to the live queue
   * (the run loop picks them up); otherwise a fresh playback starts.
   */
  enqueueSpoken(text: string, businessId?: string | null) {
    if (this.state.muted || !text.trim()) return;
    const clean = sanitizeSpokenText(text);
    const sentences = splitSentences(clean);
    if (sentences.length === 0) return;
    if (this.state.playing && this.activeSentences) {
      this.activeSentences.push(...sentences);
      return;
    }
    this.speak(clean, businessId);
  }

  cancel() {
    this.stopped = true;
    this.activeSentences = null;
    this.abortController?.abort();
    this.abortController = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
    if (isBrowserTTSAvailable()) {
      window.speechSynthesis.cancel();
    }
    this.currentUtterance = null;
    this.pendingBrowserSpeech = null;
    this.setState({
      playing: false,
      paused: false,
      currentSentence: "",
      queue: [],
      currentText: "",
    });
  }

  pause() {
    if (!this.state.playing || this.state.paused) return;
    this.setState({ paused: true });
    if (this.audio) this.audio.pause();
    if (isBrowserTTSAvailable()) window.speechSynthesis.pause();
  }

  resume() {
    if (!this.state.playing || !this.state.paused) return;
    this.setState({ paused: false });
    if (this.audio) void this.audio.play();
    if (isBrowserTTSAvailable()) window.speechSynthesis.resume();
  }

  togglePlay() {
    if (this.state.paused) this.resume();
    else if (this.state.playing) this.pause();
  }

  private async runQueue(sentences: string[], businessId?: string | null) {
    this.stopped = false;
    const provider = this.state.provider;

    // Prefetch cache for server voices
    const audioCache = new Map<number, Blob | undefined>();
    const prefetchNext = async (index: number) => {
      if (provider === "browser" || !businessId || index >= sentences.length) return;
      const next = sentences[index];
      if (!next || audioCache.has(index)) return;
      try {
        const blob = await this.fetchServerAudio(next, provider, businessId);
        if (blob) audioCache.set(index, blob);
      } catch {
        // ignore prefetch failures
      }
    };

    // kick off prefetch for first sentence
    void prefetchNext(0);

    for (let i = 0; i < sentences.length; i++) {
      if (this.stopped) break;

      while (this.state.paused && !this.stopped) {
        await sleep(100);
      }
      if (this.stopped) break;

      const sentence = sentences[i];
      this.setState({
        currentSentence: sentence,
        queue: sentences.slice(i + 1),
      });

      // prefetch next while current plays
      void prefetchNext(i + 1);

      try {
        if (provider === "browser") {
          await this.playBrowserSentence(sentence, this.state.speed);
        } else {
          let blob = audioCache.get(i);
          if (!blob && businessId) {
            blob = await this.fetchServerAudio(sentence, provider, businessId);
          }
          if (blob) {
            await this.playAudioBlob(blob, this.state.speed);
          }
        }
      } catch (err) {
        // If a sentence fails, log and continue with the rest
        console.warn("TTS sentence failed:", err);
      }
    }

    if (!this.stopped) {
      this.activeSentences = null;
      this.setState({
        playing: false,
        paused: false,
        currentSentence: "",
        queue: [],
        currentText: "",
      });
    }
  }

  private async fetchServerAudio(text: string, provider: TtsProviderName, businessId: string): Promise<Blob> {
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    try {
      const res = await fetch(`${API_BASE}/voice/businesses/${encodeURIComponent(businessId)}/tts`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ text, provider, voice: this.state.voice }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`TTS failed: ${res.status}`);
      return await res.blob();
    } finally {
      if (this.abortController === controller) this.abortController = null;
    }
  }

  private playAudioBlob(blob: Blob, playbackRate = 1): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.audio = audio;
      audio.playbackRate = playbackRate;
      audio.onended = () => {
        this.audio = null;
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onerror = () => {
        this.audio = null;
        URL.revokeObjectURL(url);
        reject(new Error("Audio playback failed"));
      };
      void audio.play().catch((err) => {
        this.audio = null;
        URL.revokeObjectURL(url);
        reject(err);
      });
    });
  }

  private playBrowserSentence(text: string, rate = 1): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!isBrowserTTSAvailable()) {
        reject(new Error("Browser TTS not available"));
        return;
      }
      getVoices()
        .then((voices) => {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.rate = rate;
          utterance.pitch = 1;
          const selected = pickBrowserVoice(voices, this.state.voice);
          if (selected) utterance.voice = selected;

          const handleFailure = (err: unknown) => {
            if (this.isNotAllowedError(err)) {
              this.pendingBrowserSpeech = { text, rate };
              this.requestBrowserSpeechPermission();
              this.currentUtterance = null;
              resolve();
              return;
            }
            this.currentUtterance = null;
            reject(err);
          };

          utterance.onend = () => {
            this.currentUtterance = null;
            resolve();
          };
          utterance.onerror = (event) => {
            if (event.error === "canceled") {
              this.currentUtterance = null;
              resolve();
              return;
            }
            handleFailure(event.error);
          };

          this.currentUtterance = utterance;
          window.speechSynthesis.cancel();
          try {
            window.speechSynthesis.speak(utterance);
          } catch (err) {
            handleFailure(err);
          }
        })
        .catch(reject);
    });
  }

  private isNotAllowedError(err: unknown): boolean {
    if (err instanceof DOMException && err.name === "NotAllowedError") return true;
    if (typeof err === "string" && err.toLowerCase().includes("not-allowed")) return true;
    return false;
  }

  private requestBrowserSpeechPermission() {
    if (this.speechPermissionListenersActive || typeof document === "undefined") return;
    this.speechPermissionListenersActive = true;
    const events = ["click", "keydown", "touchstart"];
    const handler = () => {
      events.forEach((e) => document.removeEventListener(e, handler));
      this.speechPermissionListenersActive = false;
      this.flushPendingBrowserSpeech();
    };
    events.forEach((e) => document.addEventListener(e, handler));
  }

  private flushPendingBrowserSpeech() {
    if (!this.pendingBrowserSpeech) return;
    const { text, rate } = this.pendingBrowserSpeech;
    this.pendingBrowserSpeech = null;
    void this.playBrowserSentence(text, rate);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
