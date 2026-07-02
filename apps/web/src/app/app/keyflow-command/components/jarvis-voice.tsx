"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Volume2, VolumeX, Send } from "lucide-react";
import { toast } from "sonner";
import {
  sendFlowChat,
  transcribeKeyflowSpeech,
  createVoiceSession,
  endVoiceSession,
  fetchVoicePreferences,
} from "@/lib/client";
import { useTts } from "@/components/tts";
import {
  VoiceOrb,
  PushToTalkButton,
  VoiceTranscriptDrawer,
  KeyVoiceSelector,
  type KeyVoiceKey,
  type VoiceTurn,
} from "@/components/voice";

interface Props {
  businessId: string;
  pageContext?: Record<string, unknown>;
}

const STORAGE_KEY = "kf_voice_settings";

function loadLocalSettings(): { voice: KeyVoiceKey; muted: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return {
          voice: ["alloy", "echo", "fable", "onyx", "nova", "shimmer"].includes(
            parsed.voice,
          )
            ? parsed.voice
            : "alloy",
          muted: !!parsed.muted,
        };
      }
    }
  } catch {
    // ignore
  }
  return { voice: "alloy", muted: false };
}

function saveLocalVoice(voice: KeyVoiceKey, muted: boolean) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...parsed, voice, muted }),
    );
  } catch {
    // ignore
  }
}

export default function JarvisVoice({ businessId, pageContext }: Props) {
  const { engine } = useTts();
  const [active, setActive] = useState(false);
  const [recording, setRecording] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voice, setVoice] = useState<KeyVoiceKey>("alloy");
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [inputText, setInputText] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  // Seed voice/muted from localStorage immediately, then overlay cloud preference
  useEffect(() => {
    const local = loadLocalSettings();
    setVoice(local.voice);
    setMuted(local.muted);

    fetchVoicePreferences(businessId)
      .then((res) => {
        const prefs = res.data;
        if (!prefs || prefs.length === 0) return;
        const pref = prefs.find((p) => p.isDefault) ?? prefs[0];
        const settings =
          typeof pref.settings === "object" && pref.settings !== null
            ? (pref.settings as Record<string, unknown>)
            : {};
        const cloudVoice = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"].includes(
          pref.voiceKey,
        )
          ? (pref.voiceKey as KeyVoiceKey)
          : local.voice;
        const cloudMuted =
          typeof settings.muted === "boolean" ? settings.muted : local.muted;
        setVoice(cloudVoice);
        setMuted(cloudMuted);
        saveLocalVoice(cloudVoice, cloudMuted);
      })
      .catch(() => {
        // cloud preference optional; local settings remain
      });
  }, [businessId]);

  // Keep localStorage in sync when user changes voice/mute inside Jarvis
  useEffect(() => {
    saveLocalVoice(voice, muted);
    engine.setVoice(voice);
    engine.setMuted(muted);
  }, [voice, muted, engine]);

  // Voice session lifecycle: create on open, end on close
  useEffect(() => {
    if (!active) {
      if (sessionIdRef.current) {
        const id = sessionIdRef.current;
        const transcript = turns
          .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text}`)
          .join("\n");
        const summary =
          turns.filter((t) => t.role === "assistant").slice(-1)[0]?.text ??
          "Voice conversation ended";
        endVoiceSession(businessId, id, transcript || undefined, summary).catch(
          () => {
            // best-effort
          },
        );
        sessionIdRef.current = null;
      }
      return;
    }

    if (sessionIdRef.current) return;
    createVoiceSession(businessId, "push_to_talk")
      .then((res) => {
        if (res.data) {
          sessionIdRef.current = res.data.id;
        }
      })
      .catch((err) => {
        toast.error(
          `Voice session failed: ${(err as Error)?.message ?? "unknown"}`,
        );
      });

    return () => {
      // cleanup handled by the close branch above
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, businessId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      engine.cancel();
      if (sessionIdRef.current) {
        void endVoiceSession(businessId, sessionIdRef.current);
      }
    };
  }, [businessId, engine]);

  const speak = (text: string) => {
    if (muted) return;
    engine.speak(text, businessId);
  };

  const sendToBrain = async (text: string) => {
    if (!text.trim()) return;
    const userTurn: VoiceTurn = {
      id: `u-${Date.now()}`,
      role: "user",
      text,
      ts: Date.now(),
    };
    setTurns((prev) => [...prev, userTurn]);
    setThinking(true);
    const history = turns.slice(-10).map((t) => ({ role: t.role, content: t.text }));
    const res = await sendFlowChat(businessId, text, history, undefined, pageContext);
    setThinking(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    const reply = res.data?.reply ?? "(no reply)";
    const assistantTurn: VoiceTurn = {
      id: `a-${Date.now()}`,
      role: "assistant",
      text: reply,
      ts: Date.now(),
    };
    setTurns((prev) => [...prev, assistantTurn]);
    void speak(reply);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        cancelAnimationFrame(animFrameRef.current);
        analyserRef.current = null;
        await audioCtxRef.current?.close();
        audioCtxRef.current = null;
        const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (audioBlob.size < 200) return;
        setThinking(true);
        const tx = await transcribeKeyflowSpeech(businessId, audioBlob);
        setThinking(false);
        if (tx.error) {
          toast.error(tx.error);
          return;
        }
        const text = tx.data?.text?.trim();
        if (!text) {
          toast.info("Didn't catch that. Try again.");
          return;
        }
        await sendToBrain(text);
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);

      const draw = () => {
        const canvas = canvasRef.current;
        const a = analyserRef.current;
        if (!canvas || !a) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const bufferLength = a.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        a.getByteTimeDomainData(dataArray);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.lineWidth = 2;
        ctx.strokeStyle = "hsl(var(--kf-accent1))";
        ctx.beginPath();
        const sliceWidth = canvas.width / bufferLength;
        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 128.0;
          const y = (v * canvas.height) / 2;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += sliceWidth;
        }
        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.stroke();
        animFrameRef.current = requestAnimationFrame(draw);
      };
      draw();
    } catch (_err) {
      toast.error("Microphone access denied");
    }
  };

  const stopRecording = () => {
    cancelAnimationFrame(animFrameRef.current);
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
  };

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputText.trim();
    if (!text) return;
    setInputText("");
    await sendToBrain(text);
  };

  const orbState = recording ? "listening" : thinking ? "thinking" : "idle";

  return (
    <>
      <button
        onClick={() => setActive(true)}
        className="fixed bottom-24 right-5 sm:bottom-8 sm:right-8 z-40 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center transition-all hover:scale-105"
        style={{
          background:
            "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
          boxShadow:
            "0 8px 32px hsl(var(--kf-accent1) / 0.4), 0 0 0 1px hsl(var(--kf-accent1) / 0.2)",
        }}
        aria-label="Open Jarvis voice"
      >
        <SparklesIcon />
      </button>

      <AnimatePresence>
        {active && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]"
              onClick={() => setActive(false)}
            />
            <motion.div
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", damping: 30, stiffness: 250 }}
              className="fixed inset-x-0 bottom-0 z-[61] sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[420px] flex flex-col rounded-t-3xl sm:rounded-3xl overflow-hidden"
              style={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                maxHeight: "85vh",
              }}
            >
              <div
                className="p-4 flex items-center gap-3"
                style={{
                  background:
                    "linear-gradient(135deg, hsl(var(--kf-accent1)/0.15), hsl(var(--kf-accent2)/0.15))",
                  borderBottom: "1px solid hsl(var(--border))",
                }}
              >
                <VoiceOrb state={orbState} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">Jarvis</div>
                  <div className="text-[10px] text-muted-foreground">
                    {recording
                      ? "Listening…"
                      : thinking
                        ? "Thinking…"
                        : "Voice + text · brain online"}
                  </div>
                </div>
                <KeyVoiceSelector
                  value={voice}
                  onChange={setVoice}
                  className="hidden sm:grid grid-cols-3 gap-1"
                  voices={["alloy", "echo", "fable", "onyx", "nova", "shimmer"]}
                />
                <select
                  value={voice}
                  onChange={(e) => setVoice(e.target.value as KeyVoiceKey)}
                  className="sm:hidden text-[10px] bg-background/60 border border-border rounded-md px-1.5 py-1"
                >
                  {["alloy", "echo", "fable", "onyx", "nova", "shimmer"].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setMuted((m) => !m)}
                  className="p-2 rounded-lg hover:bg-background/40"
                  aria-label={muted ? "Unmute" : "Mute"}
                >
                  {muted ? (
                    <VolumeX className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
                <button
                  onClick={() => setActive(false)}
                  className="p-2 rounded-lg hover:bg-background/40 text-xs"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <div className="flex-1 overflow-hidden flex flex-col">
                <AnimatePresence>
                  {recording && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="flex justify-center pt-3"
                    >
                      <canvas
                        ref={canvasRef}
                        width={320}
                        height={60}
                        className="rounded-lg"
                        style={{ background: "hsl(var(--muted) / 0.3)" }}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                <VoiceTranscriptDrawer
                  turns={turns}
                  thinking={thinking}
                  emptyText="Tap the mic and ask anything — I see your bookings, contacts, projects, expenses, store, marketplace, community, automations, and documents."
                />
              </div>

              <form
                onSubmit={handleSendText}
                className="p-3 border-t border-border flex items-center gap-2"
              >
                <PushToTalkButton
                  recording={recording}
                  onClick={recording ? stopRecording : startRecording}
                />
                <input
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Or type a request…"
                  className="kf-input flex-1 text-xs"
                />
                <button
                  type="submit"
                  disabled={!inputText.trim() || thinking}
                  className="w-10 h-10 rounded-full flex items-center justify-center disabled:opacity-50 kf-btn-secondary"
                  aria-label="Send"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function SparklesIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-6 h-6 text-white"
    >
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </svg>
  );
}
