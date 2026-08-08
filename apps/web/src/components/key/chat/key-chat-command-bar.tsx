"use client";

import { useRef, useCallback, useEffect, useState, useMemo } from "react";
import { ArrowUp, Paperclip, Mic, Square, Loader2, Command, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useKeyChat } from "./key-chat-store";
import { useUpload } from "@/hooks/use-upload";
import { useVoiceInput } from "./use-voice-input";
import { VoiceConversation } from "./voice-conversation";
import { KeyAttachmentPreview } from "./key-attachment-preview";
import { nanoid } from "./utils";
import { toast } from "sonner";
import { Surface } from "@/components/ui-v2/surface";
import { Button } from "@/components/ui-v2/button";

interface SlashCommand {
  id: string;
  label: string;
  shortcut: string;
  icon: React.ElementType;
  insert: string;
  description: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { id: "task", label: "Task", shortcut: "/task", icon: Check, insert: "Create a task: ", description: "Add a task to your queue" },
  { id: "email", label: "Email", shortcut: "/email", icon: Paperclip, insert: "Draft an email to ", description: "Compose a professional email" },
  { id: "schedule", label: "Schedule", shortcut: "/schedule", icon: Check, insert: "Schedule ", description: "Plan a meeting or event" },
  { id: "genome", label: "Genome", shortcut: "/genome", icon: Check, insert: "Check my genome ", description: "Business genome actions" },
  { id: "commerce", label: "Commerce", shortcut: "/commerce", icon: Paperclip, insert: "Create a product: ", description: "Storefront & commerce" },
  { id: "calendar", label: "Calendar", shortcut: "/calendar", icon: Check, insert: "Show my calendar for ", description: "Calendar & events" },
];

interface KeyChatCommandBarProps {
  onSend: (text?: string) => void;
  onStop: () => void;
  disabled?: boolean;
  showModeBadge?: boolean;
}

const MODE_LABELS: Record<string, string> = {
  general: "General",
  genome_onboarding: "Genome",
  executive: "Executive",
  finance: "Finance",
  sales: "Sales",
  operations: "Operations",
};

export function KeyChatCommandBar({ onSend, onStop, disabled, showModeBadge = true }: KeyChatCommandBarProps) {
  const { input, setInput, attachments, addAttachment, removeAttachment, status, chatMode } = useKeyChat();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const { uploadFile, isUploading } = useUpload();
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);

  const { isRecording, isProcessing: isTranscribing, toggle: toggleVoice } = useVoiceInput({
    onTranscript: (text) => {
      if (input.trim()) {
        setInput((prev) => (prev ? `${prev} ${text}` : text));
        setTimeout(() => textareaRef.current?.focus(), 50);
        return;
      }
      VoiceConversation.start();
      onSend(text);
    },
    onNoSpeech: () => VoiceConversation.stop(),
  });

  const isLoading = status === "streaming" || status === "loading";
  const canSend = (input.trim() || attachments.length > 0) && !isUploading && !isTranscribing;

  const slashQuery = useMemo(() => {
    if (!input.startsWith("/")) return null;
    const query = input.slice(1).toLowerCase();
    return SLASH_COMMANDS.filter((cmd) => cmd.shortcut.toLowerCase().includes(query) || cmd.label.toLowerCase().includes(query));
  }, [input]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  // Shift+K focuses the command input when the user is on a chat surface.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target as HTMLElement | null;
        const isTyping = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
        if (!isTyping) {
          e.preventDefault();
          textareaRef.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const applySlashCommand = useCallback(
    (cmd: SlashCommand) => {
      setInput(cmd.insert);
      setTimeout(() => textareaRef.current?.focus(), 0);
    },
    [setInput],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const queryLength = slashQuery?.length ?? 0;
    const safeIndex = queryLength > 0 ? Math.min(selectedSlashIndex, queryLength - 1) : 0;

    if (slashQuery && queryLength > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedSlashIndex((i) => (Math.min(i, queryLength - 1) + 1) % queryLength);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedSlashIndex((i) => (Math.min(i, queryLength - 1) - 1 + queryLength) % queryLength);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applySlashCommand(slashQuery[safeIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setInput("");
        return;
      }
    }

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
    [addAttachment, uploadFile],
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
    [addAttachment, uploadFile],
  );

  return (
    <div className="border-t border-border/50 bg-background px-3 py-3 md:px-4 md:py-4">
      <div className="relative mx-auto max-w-3xl">
        {/* Slash command menu */}
        {slashQuery && slashQuery.length > 0 && (
          <div
            ref={slashMenuRef}
            className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-border/50 bg-card shadow-lg p-1 z-20"
          >
            <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Command className="h-3 w-3" /> Commands
            </div>
            {slashQuery.map((cmd, index) => {
              const Icon = cmd.icon;
              const isSelected = index === Math.min(selectedSlashIndex, slashQuery.length - 1);
              return (
                <button
                  key={cmd.id}
                  type="button"
                  onClick={() => applySlashCommand(cmd)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                    isSelected ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10">
                    <Icon className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium">{cmd.label}</div>
                    <div className="text-[10px] opacity-70 truncate">{cmd.description}</div>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground">{cmd.shortcut}</span>
                </button>
              );
            })}
          </div>
        )}

        <Surface
          variant="elevated"
          className="flex flex-col gap-2 p-2 transition-shadow focus-within:shadow-md focus-within:ring-1 focus-within:ring-ring/20"
        >
          {showModeBadge && (
            <div className="px-2 pt-1">
              <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {MODE_LABELS[chatMode ?? "general"] ?? "General"}
              </span>
            </div>
          )}

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-2 pt-1">
              {attachments.map((a) => (
                <KeyAttachmentPreview key={a.id} attachment={a} onRemove={() => removeAttachment(a.id)} />
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Message KEY... type / for commands"
            rows={1}
            disabled={disabled || isUploading}
            className="max-h-[200px] min-h-[44px] w-full resize-none rounded-xl bg-surface-muted px-3 py-2.5 text-sm leading-relaxed placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring/30 disabled:opacity-60"
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
              <Button
                type="button"
                variant="icon"
                disabled={isLoading || isUploading}
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach file"
                className="h-8 w-8"
              >
                {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
              </Button>

              <Button
                type="button"
                variant="icon"
                disabled={isLoading || isUploading}
                onClick={() => toggleVoice()}
                aria-label={isRecording ? "Stop recording" : "Voice input"}
                className={cn(
                  "h-8 w-8",
                  isRecording
                    ? "bg-rose text-white hover:bg-rose animate-pulse"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {isRecording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-4 w-4" />}
              </Button>
            </div>

            {isLoading ? (
              <Button
                type="button"
                variant="primary"
                onClick={onStop}
                aria-label="Stop"
                className="h-8 w-9 min-h-8 rounded-full p-0"
              >
                <Square className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                disabled={!canSend}
                onClick={() => onSend()}
                aria-label="Send"
                className="h-8 w-9 min-h-8 rounded-full p-0"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </div>
        </Surface>
      </div>
      <p className="mt-2 text-center text-[10px] text-muted-foreground/60">
        Hold Space to talk, or tap the mic — KEY answers back. KEY can make mistakes; confirm important actions.
      </p>
    </div>
  );
}
