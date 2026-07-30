"use client";

import { useRef, useCallback, useEffect } from "react";
import { ArrowUp, Paperclip, Mic, Square, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useKeyChat } from "./key-chat-store";
import { useUpload } from "@/hooks/use-upload";
import { useVoiceInput } from "./use-voice-input";
import { KeyAttachmentPreview } from "./key-attachment-preview";
import { nanoid } from "./utils";
import { toast } from "sonner";

interface KeyChatInputProps {
  onSend: () => void;
  onStop: () => void;
  disabled?: boolean;
}

export function KeyChatInput({ onSend, onStop, disabled }: KeyChatInputProps) {
  const { input, setInput, attachments, addAttachment, removeAttachment, status } = useKeyChat();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFile, isUploading } = useUpload();
  const { isRecording, isProcessing: isTranscribing, toggle: toggleVoice } = useVoiceInput({
    onTranscript: (text) => {
      setInput((prev) => (prev ? `${prev} ${text}` : text));
      setTimeout(() => textareaRef.current?.focus(), 50);
    },
  });

  const isLoading = status === "streaming" || status === "loading";
  const canSend = (input.trim() || attachments.length > 0) && !isUploading && !isTranscribing;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSend) onSend();
    }
  };

  const handleFileSelect = useCallback(
    async (files: FileList | null) => {
      if (!files) return;
      for (const file of Array.from(files)) {
        const result = await uploadFile(file);
        if (result) {
          const publicUrl = result.uploadURL.split("?")[0];
          addAttachment({
            id: nanoid(),
            name: file.name,
            url: publicUrl,
            contentType: file.type || "application/octet-stream",
            objectPath: result.objectPath,
          });
        } else {
          toast.error(`Failed to upload ${file.name}`);
        }
      }
    },
    [addAttachment, uploadFile]
  );

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        for (const file of imageFiles) {
          const result = await uploadFile(file);
          if (result) {
            const publicUrl = result.uploadURL.split("?")[0];
            addAttachment({
              id: nanoid(),
              name: file.name,
              url: publicUrl,
              contentType: file.type,
              objectPath: result.objectPath,
            });
          }
        }
      }
    },
    [addAttachment, uploadFile]
  );

  return (
    <div className="border-t border-border/50 bg-background px-3 py-3 md:px-4 md:py-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-2 rounded-2xl border border-border/40 bg-card/70 p-2 shadow-sm transition-shadow focus-within:shadow-md focus-within:ring-1 focus-within:ring-ring/20">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-2 pt-1">
            {attachments.map((a) => (
              <KeyAttachmentPreview
                key={a.id}
                attachment={a}
                onRemove={() => removeAttachment(a.id)}
              />
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Message KEY..."
          rows={1}
          disabled={disabled || isUploading}
          className="max-h-[200px] min-h-[44px] w-full resize-none bg-transparent px-3 py-2.5 text-sm leading-relaxed placeholder:text-muted-foreground/60 focus:outline-none disabled:opacity-60"
        />

        <div className="flex items-center justify-between px-1 pb-1">
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                void handleFileSelect(e.target.files);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            />
            <button
              type="button"
              disabled={isLoading || isUploading}
              onClick={() => fileInputRef.current?.click()}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
              aria-label="Attach file"
            >
              {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
            </button>

            <button
              type="button"
              disabled={isLoading || isUploading}
              onClick={() => toggleVoice()}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-40",
                isRecording
                  ? "bg-red-500 text-white animate-pulse"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              aria-label={isRecording ? "Stop recording" : "Voice input"}
            >
              {isRecording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-4 w-4" />}
            </button>
          </div>

          {isLoading ? (
            <button
              type="button"
              onClick={onStop}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90"
              aria-label="Stop"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              disabled={!canSend}
              onClick={onSend}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Send"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-center text-[10px] text-muted-foreground/60">
        KEY can make mistakes. Confirm important actions before allowing them.
      </p>
    </div>
  );
}
