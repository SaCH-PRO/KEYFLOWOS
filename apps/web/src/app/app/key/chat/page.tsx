import type { Metadata } from "next";
import { KeyFullChatShellV2 } from "@/components/key/chat/key-full-chat-shell-v2";

export const metadata: Metadata = {
  title: "KEY Chat — AI Command Center",
  description: "Chat with KEY, your AI business operating system. Manage tasks, get insights, and automate workflows.",
};

export default function KeyChatPage() {
  return <KeyFullChatShellV2 />;
}
