"use client";

/**
 * Shared voice-input helpers: recorder mime negotiation and silence detection
 * (VAD) so voice turns end naturally instead of requiring a manual stop.
 */

export function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }
  for (const type of ["audio/webm", "audio/mp4", "audio/ogg"]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

export interface SilenceMonitorOptions {
  /** Speech was heard, then silence persisted for `silenceMs`. */
  onSilence?: () => void;
  /** No speech at all within `noSpeechMs` of starting. */
  onNoSpeech?: () => void;
  /** Quiet period (ms) that ends a turn. Default 1400. */
  silenceMs?: number;
  /** RMS level counted as speech. Default 0.02. */
  threshold?: number;
  /** Hard cap on a single recording (ms). Default 90000. */
  maxMs?: number;
  /** Window (ms) with zero speech before giving up. Default 7000. */
  noSpeechMs?: number;
}

/**
 * Watches a mic stream's RMS level. Fires `onSilence` when the user stops
 * talking, `onNoSpeech` if they never start. Returns a cleanup function.
 */
export function createSilenceMonitor(
  stream: MediaStream,
  opts: SilenceMonitorOptions,
): () => void {
  const silenceMs = opts.silenceMs ?? 1400;
  const threshold = opts.threshold ?? 0.02;
  const maxMs = opts.maxMs ?? 90_000;
  const noSpeechMs = opts.noSpeechMs ?? 7000;

  let ctx: AudioContext | null = null;
  let raf = 0;
  let stopped = false;

  try {
    ctx = new AudioContext();
  } catch {
    // AudioContext unavailable — caller still gets a max-duration stop.
    const t0 = Date.now();
    const timer = setTimeout(() => opts.onSilence?.(), maxMs - (Date.now() - t0));
    return () => clearTimeout(timer);
  }

  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const data = new Float32Array(analyser.fftSize);

  const startedAt = Date.now();
  let heardSpeech = false;
  let lastSpeechAt = startedAt;

  const cleanup = () => {
    cancelAnimationFrame(raf);
    try {
      source.disconnect();
    } catch {
      // already disconnected
    }
    void ctx?.close().catch(() => undefined);
  };

  const finish = (cb?: () => void) => {
    if (stopped) return;
    stopped = true;
    cleanup();
    cb?.();
  };

  const tick = () => {
    if (stopped) return;
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    const now = Date.now();

    if (rms > threshold) {
      heardSpeech = true;
      lastSpeechAt = now;
    }
    if (!heardSpeech && now - startedAt > noSpeechMs) {
      finish(opts.onNoSpeech);
      return;
    }
    if (heardSpeech && now - lastSpeechAt > silenceMs) {
      finish(opts.onSilence);
      return;
    }
    if (now - startedAt > maxMs) {
      finish(opts.onSilence);
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => finish();
}
