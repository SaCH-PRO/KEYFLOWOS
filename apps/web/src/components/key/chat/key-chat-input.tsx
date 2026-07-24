"use client";

import { KeyChatCommandBar } from "./key-chat-command-bar";

interface KeyChatInputProps {
  onSend: (text?: string) => void;
  onStop: () => void;
  disabled?: boolean;
  showModeBadge?: boolean;
}

/**
 * Backward-compatible alias for {@link KeyChatCommandBar}.
 * The full command bar (slash commands, mode badge, voice, attachments) is now the default input experience.
 */
export function KeyChatInput(props: KeyChatInputProps) {
  return <KeyChatCommandBar {...props} />;
}
