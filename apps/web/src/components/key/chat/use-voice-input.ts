"use client";

import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import { transcribeKeyflowSpeech } from "@/lib/client";

interface UseVoiceInputOptions {
  onTranscript: (text: string) => void;
}

export function useVoiceInput({ onTranscript }: UseVoiceInputOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async () => {
    const businessId = getStoredBusinessId();
    if (!businessId) {
      toast.error("No business selected");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
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
    } catch {
      toast.error("Microphone access denied");
    }
  }, [onTranscript]);

  const stop = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
  }, []);

  const toggle = useCallback(() => {
    if (isRecording) stop();
    else void start();
  }, [isRecording, start, stop]);

  return { isRecording, isProcessing, start, stop, toggle };
}
