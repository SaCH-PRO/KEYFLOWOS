"use client";

import type { CopilotModule, KeyChatMessage, KeyChatPageContext } from "./types";
import { nanoid } from "./utils";

/** Minimal store surface the genome opener needs (satisfied by KeyChatStore). */
export interface GenomeConversationDeps {
  messages: KeyChatMessage[];
  setCurrentModule: (module?: CopilotModule) => void;
  setPageContext: (ctx?: KeyChatPageContext) => void;
  setActiveSessionId: (id: string | null) => void;
  appendMessage: (message: KeyChatMessage) => void;
  setOpen: (open: boolean) => void;
}

export const GENOME_SESSION_ID = "onboarding";

/**
 * The ONE Business Genome conversation. Every surface that opens the genome
 * chat (sidebar pinned card, auto-nudge, full-page genome mode) goes through
 * this so there is a single continuous thread — same pinned session, same
 * onboarding context, same kickoff behavior. It simply guarantees the user
 * lands inside the genome conversation.
 */
export function openGenomeConversation(
  chat: GenomeConversationDeps,
  sendMessage: (text: string, opts?: { silent?: boolean }) => Promise<void> | void,
  opts?: { surface?: KeyChatPageContext["surface"] },
) {
  chat.setCurrentModule("onboarding");
  chat.setPageContext({
    route: window.location.pathname,
    surface: opts?.surface ?? "drawer",
    mode: "onboarding",
    hints: ["business genome completion"],
  });
  chat.setActiveSessionId(GENOME_SESSION_ID);

  // Fresh thread: a brief hello, then KEY opens the intake herself. With an
  // existing conversation we say nothing and let the restored history speak.
  if (chat.messages.length === 0) {
    chat.appendMessage({
      id: nanoid(),
      role: "assistant",
      content:
        "Hi! I’m KEY. Let’s finish your Business Genome — I’ll ask a few quick questions one at a time and fill in the rest.",
      timestamp: Date.now(),
    });
    void sendMessage(
      "Let's complete my Business Genome. Ask me the first question, one at a time.",
      { silent: true },
    );
  }
  chat.setOpen(true);
}
