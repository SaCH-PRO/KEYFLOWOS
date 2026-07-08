import type { Metadata } from "next";
import { KeyFullChatShell } from "@/components/key/chat/key-full-chat-shell";

export const metadata: Metadata = {
  title: "KEY Chat — AI Command Center",
  description: "Chat with KEY, your AI business operating system. Manage tasks, get insights, and automate workflows.",
};

export default function KeyChatPage() {
  return <KeyFullChatShell />;
}
