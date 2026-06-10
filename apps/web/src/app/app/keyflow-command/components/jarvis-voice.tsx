"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, Volume2, VolumeX, Sparkles, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import {
  sendFlowChat,
  transcribeKeyflowSpeech,
  synthesizeKeyflowSpeech,
} from "@/lib/client";

interface VoiceTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  ts: number;
}

interface Props {
  businessId: string;
  pageContext?: Record<string, unknown>;
}

const VOICE_OPTIONS = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;

export default function JarvisVoice({ businessId, pageContext }: Props) {
  const [active, setActive] = useState(false);
  const [recording, setRecording] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voice, setVoice] = useState<(typeof VOICE_OPTIONS)[number]>("alloy");
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [inputText, setInputText] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (audioRef.current) audioRef.current.pause();
    };
  }, []);

  const speak = async (text: string) => {
    if (muted) return;
    const { blob, error } = await synthesizeKeyflowSpeech(businessId, text, voice);
    if (error || !blob) {
      if (error) toast.error(`Voice playback failed: ${error}`);
      return;
    }
    const url = URL.createObjectURL(blob);
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => URL.revokeObjectURL(url);
    void audio.play().catch(() => {
      // Browser blocked autoplay
    });
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

      // Set up audio analyser for waveform
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

      // Start waveform animation
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
        <Sparkles className="w-6 h-6 text-white" />
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
                <motion.div
                  animate={
                    recording
                      ? { scale: [1, 1.15, 1] }
                      : thinking
                      ? { rotate: 360 }
                      : {}
                  }
                  transition={
                    recording
                      ? { duration: 1, repeat: Infinity }
                      : thinking
                      ? { duration: 1.5, repeat: Infinity, ease: "linear" }
                      : {}
                  }
                  className="w-10 h-10 rounded-full flex items-center justify-center"
                  style={{
                    background:
                      "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                  }}
                >
                  <Sparkles className="w-5 h-5 text-white" />
                </motion.div>
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
                <select
                  value={voice}
                  onChange={(e) =>
                    setVoice(e.target.value as (typeof VOICE_OPTIONS)[number])
                  }
                  className="text-[10px] bg-background/60 border border-border rounded-md px-1.5 py-1"
                >
                  {VOICE_OPTIONS.map((v) => (
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

              <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-[200px]">
                {/* Waveform canvas */}
                <AnimatePresence>
                  {recording && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="flex justify-center"
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

                {turns.length === 0 && !recording ? (
                  <div className="text-xs text-muted-foreground text-center py-8">
                    Tap the mic and ask anything — I see your bookings,
                    contacts, projects, expenses, store, marketplace, community,
                    automations, and documents.
                  </div>
                ) : (
                  turns.map((t) => (
                    <motion.div
                      key={t.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`max-w-[85%] p-2.5 rounded-2xl text-xs ${
                        t.role === "user"
                          ? "ml-auto rounded-br-sm"
                          : "rounded-bl-sm"
                      }`}
                      style={
                        t.role === "user"
                          ? {
                              background:
                                "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                              color: "white",
                            }
                          : {
                              background: "hsl(var(--muted) / 0.5)",
                            }
                      }
                    >
                      <span className="text-[10px] opacity-60 block mb-0.5">
                        {t.role === "user" ? "You" : "Jarvis"}
                      </span>
                      {t.text}
                    </motion.div>
                  ))
                )}
                {thinking && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="max-w-[85%] p-2.5 rounded-2xl rounded-bl-sm text-xs bg-muted/50"
                  >
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      <span>Thinking…</span>
                    </div>
                  </motion.div>
                )}
              </div>

              <form
                onSubmit={handleSendText}
                className="p-3 border-t border-border flex items-center gap-2"
              >
                <button
                  type="button"
                  onClick={recording ? stopRecording : startRecording}
                  className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all"
                  style={{
                    background: recording
                      ? "hsl(var(--kf-error))"
                      : "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                    color: "white",
                  }}
                  aria-label={recording ? "Stop recording" : "Start recording"}
                >
                  {recording ? (
                    <MicOff className="w-4 h-4" />
                  ) : (
                    <Mic className="w-4 h-4" />
                  )}
                </button>
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
