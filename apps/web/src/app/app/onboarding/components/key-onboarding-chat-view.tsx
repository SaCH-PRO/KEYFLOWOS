"use client";

import { useEffect, useRef } from "react";
import {
  KeyChatProvider,
  useKeyChat,
  useKeyChatActions,
  KeyChatMessages,
  KeyChatInput,
  KeyChatVoiceBar,
} from "@/components/key/chat";
import type { OnboardingStep } from "@/components/key/chat/types";
import { nanoid } from "@/components/key/chat/utils";
import type { OnboardingStep as ApiOnboardingStep } from "@/lib/api/onboarding-concierge";

interface KeyOnboardingChatViewProps {
  step: ApiOnboardingStep;
  goToStep: (step: ApiOnboardingStep) => Promise<void>;
}

const ONBOARDING_SESSION_ID = "onboarding";

function OnboardingChatInner({ step, goToStep }: KeyOnboardingChatViewProps) {
  const chat = useKeyChat();
  const { sendMessage, stop, confirmAction } = useKeyChatActions();
  const seededRef = useRef(false);

  // Keep the chat context pinned to onboarding for this session.
  useEffect(() => {
    chat.setCurrentModule("onboarding");
    chat.setPageContext({
      route: "/app/onboarding",
      surface: "page",
      mode: "onboarding",
      onboardingStep: step as OnboardingStep,
      hints: [`onboarding step: ${step}`],
    });
    chat.setActiveSessionId(ONBOARDING_SESSION_ID);

    if (!seededRef.current && chat.messages.length === 0) {
      seededRef.current = true;
      chat.appendMessage({
        id: nanoid(),
        role: "assistant",
        content:
          "Hi! I’m KEY. Tell me what you’re building and I’ll set up the rest — your blueprint, concierge template, storefront, and payment details. A few sentences is enough to start.",
        timestamp: Date.now(),
        card: {
          type: "welcome",
          title: "Welcome to KeyFlowOS",
        },
      });
    }

    return () => {
      chat.setCurrentModule(undefined);
      chat.setPageContext(undefined);
      chat.setActiveSessionId(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync the page step into chat context so the orchestrator sees it.
  useEffect(() => {
    if (!chat.pageContext) return;
    chat.setPageContext({
      ...chat.pageContext,
      onboardingStep: step as OnboardingStep,
      hints: [`onboarding step: ${step}`],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const handleAdvance = async (nextStep: ApiOnboardingStep) => {
    await goToStep(nextStep);
    if (nextStep !== "complete") {
      await sendMessage("Next step");
    }
  };

  return (
    <div className="flex h-[calc(100dvh-8rem)] w-full flex-col overflow-hidden rounded-2xl border border-border/60 bg-background/80 shadow-sm backdrop-blur-xl">
      <div className="flex min-h-0 flex-1 flex-col">
        <KeyChatMessages onConfirmAction={confirmAction} onCardAdvance={handleAdvance} />
        <KeyChatVoiceBar />
        <KeyChatInput onSend={sendMessage} onStop={stop} />
      </div>
    </div>
  );
}

export function KeyOnboardingChatView({ step, goToStep }: KeyOnboardingChatViewProps) {
  return (
    <KeyChatProvider>
      <OnboardingChatInner step={step} goToStep={goToStep} />
    </KeyChatProvider>
  );
}
