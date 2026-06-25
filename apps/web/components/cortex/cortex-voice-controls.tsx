'use client';

/**
 * CortexVoiceControls — Push-to-talk, voice selector, audio playback
 * Uses Web Audio API + MediaRecorder for recording.
 */

import { useState, useRef, useCallback } from 'react';
import { VOICES, PERSONALITY_CONFIGS, CortexPersona, CortexVoice } from './cortex-types';

interface VoiceControlsProps {
  businessId: string;
  currentPersona: CortexPersona;
  currentVoice: CortexVoice;
  onVoiceChange: (voice: CortexVoice) => void;
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

export function CortexVoiceControls({
  businessId,
  currentPersona,
  currentVoice,
  onVoiceChange,
  onTranscript,
  disabled,
}: VoiceControlsProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [showVoicePicker, setShowVoicePicker] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);

  const config = PERSONALITY_CONFIGS[currentPersona];

  // ── Start Recording ───────────────────────────────────────

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      startTimeRef.current = Date.now();

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await sendAudioToServer(blob);

        // Stop all tracks
        stream.getTracks().forEach((t) => t.stop());
      };

      recorder.start(100); // Collect in 100ms chunks
      setIsRecording(true);
      setRecordingDuration(0);

      // Duration timer
      timerRef.current = setInterval(() => {
        setRecordingDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } catch {
      // Mic permission denied
    }
  }, [businessId]);

  // ── Stop Recording ────────────────────────────────────────

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  // ── Send Audio to Server (STT) ────────────────────────────

  const sendAudioToServer = async (blob: Blob) => {
    const formData = new FormData();
    formData.append('audio', blob, 'recording.webm');

    try {
      const res = await fetch('/api/v1/cortex/voice/listen', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error('STT failed');

      const data = await res.json();
      if (data.transcript) {
        onTranscript(data.transcript);
      }
    } catch {
      // STT error handled silently
    }
  };

  // ── Play TTS ──────────────────────────────────────────────

  const playTTS = async (text: string) => {
    try {
      const res = await fetch('/api/v1/cortex/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: currentVoice, persona: currentPersona }),
      });

      if (!res.ok) throw new Error('TTS failed');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);

      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onplay = () => setIsPlaying(true);
      audio.onended = () => setIsPlaying(false);
      audio.play();
    } catch {
      // TTS error handled silently
    }
  };

  return (
    <div className="flex items-center gap-2">
      {/* Push-to-Talk Button */}
      <button
        onMouseDown={startRecording}
        onMouseUp={stopRecording}
        onTouchStart={startRecording}
        onTouchEnd={stopRecording}
        disabled={disabled}
        className={`relative w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200
          ${isRecording
            ? 'bg-red-500 text-white scale-110 shadow-lg shadow-red-500/30'
            : 'bg-[var(--kf-surface)] text-[var(--kf-text)] border border-[var(--kf-border)] hover:bg-[var(--kf-surface-hover)]'
          }
          disabled:opacity-40 disabled:cursor-not-allowed`}
        aria-label={isRecording ? 'Recording...' : 'Hold to speak'}
      >
        {isRecording ? (
          <>
            <span className="absolute inset-0 rounded-full animate-ping bg-red-400 opacity-40" />
            <svg className="w-5 h-5 relative z-10" fill="currentColor" viewBox="0 0 20 20">
              <rect x="6" y="4" width="8" height="12" rx="1" />
            </svg>
          </>
        ) : (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        )}
      </button>

      {/* Recording duration */}
      {isRecording && (
        <span className="text-xs font-mono text-red-500 w-10">
          {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, '0')}
        </span>
      )}

      {/* Voice Selector */}
      <div className="relative">
        <button
          onClick={() => setShowVoicePicker(!showVoicePicker)}
          disabled={disabled}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-[var(--kf-border)] 
                     bg-[var(--kf-surface)] hover:bg-[var(--kf-surface-hover)] text-xs text-[var(--kf-text)]
                     disabled:opacity-40 transition-colors"
        >
          <svg className="w-3.5 h-3.5 text-[var(--kf-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          </svg>
          {VOICES.find((v) => v.id === currentVoice)?.label ?? currentVoice}
        </button>

        {showVoicePicker && (
          <div className="absolute right-0 mt-1 w-48 rounded-lg border border-[var(--kf-border)] 
                          bg-[var(--kf-surface-elevated)] shadow-lg z-50 py-1">
            {VOICES.map((voice) => (
              <button
                key={voice.id}
                onClick={() => {
                  onVoiceChange(voice.id as CortexVoice);
                  setShowVoicePicker(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors
                  ${voice.id === currentVoice ? 'bg-[var(--kf-primary)]/10 text-[var(--kf-primary)]' : 'text-[var(--kf-text)] hover:bg-[var(--kf-surface-hover)]'}`}
              >
                <span className="flex-1">{voice.label}</span>
                <span className="text-[10px] text-[var(--kf-text-muted)]">{voice.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Audio Playback */}
      {audioUrl && (
        <button
          onClick={() => {
            if (audioRef.current) {
              isPlaying ? audioRef.current.pause() : audioRef.current.play();
            }
          }}
          className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors
            ${isPlaying ? 'bg-[var(--kf-primary)] text-white' : 'bg-[var(--kf-surface)] border border-[var(--kf-border)] text-[var(--kf-text)]'}`}
        >
          {isPlaying ? (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
          ) : (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>
          )}
        </button>
      )}
    </div>
  );
}
