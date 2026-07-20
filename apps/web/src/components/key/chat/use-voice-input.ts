"use client";

import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import { transcribeKeyflowSpeech } from "@/lib/client";
import { pickRecorderMimeType, createSilenceMonitor } from "./voice-utils";

interface UseVoiceInputOptions {
  onTranscript: (text: string) => void;
  /** Fires when the silence monitor gives up (no speech detected). */
  onNoSpeech?: () => void;
}

export function useVoiceInput({ onTranscript, onNoSpeech }: UseVoiceInputOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const monitorStopRef = useRef<(() => void) | null>(null);
  const mimeTypeRef = useRef<string | undefined>(undefined);

  const stop = useCallback(() => {
    monitorStopRef.current?.();
    monitorStopRef.current = null;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
  }, []);

  const start = useCallback(async () => {
    const businessId = getStoredBusinessId();
    if (!businessId) {
      toast.error("No business selected");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickRecorderMimeType();
      mimeTypeRef.current = mimeType;
      const mr = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = async () => {
        monitorStopRef.current?.();
        monitorStopRef.current = null;
        const audioBlob = new Blob(chunksRef.current, {
          type: mimeTypeRef.current ?? "audio/webm",
        });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        if (audioBlob.size < 200) {
          setIsRecording(false);
          return;
        }

        setIsProcessing(true);
        try {
          const tx = await transcribeKeyflowSpeech(businessId, audioBlob);
          if (tx.error) {
            toast.error(tx.error);
          } else {
            const text = tx.data?.text?.trim();
            if (text) onTranscript(text);
          }
        } catch (err) {
          toast.error((err as Error).message || "Transcription failed");
        } finally {
          setIsProcessing(false);
          setIsRecording(false);
        }
      };

      mediaRecorderRef.current = mr;
      mr.start();
      setIsRecording(true);

      // End the turn naturally when the user stops talking.
      monitorStopRef.current = createSilenceMonitor(stream, {
        onSilence: () => stop(),
        onNoSpeech: () => {
          toast.info("Didn't hear anything — try again.");
          onNoSpeech?.();
          stop();
        },
      });
    } catch (err) {
      if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
        toast.error("Microphone access denied");
      } else {
        toast.error("Voice recording isn't supported in this browser");
      }
    }
  }, [onTranscript, onNoSpeech, stop]);

  const toggle = useCallback(() => {
    if (isRecording) stop();
    else void start();
  }, [isRecording, start, stop]);

  return { isRecording, isProcessing, start, stop, toggle };
}
