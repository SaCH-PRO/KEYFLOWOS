"use client";

import { useEffect, useRef, useState } from "react";
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

// Cards from the legacy dense wizard still advance with "genesis"/"genome";
// the step API only accepts the slim funnel values.
const LEGACY_ADVANCE_MAP: Record<string, ApiOnboardingStep> = {
  genesis: "intake",
  genome: "configure",
};

function OnboardingChatInner({ step, goToStep }: KeyOnboardingChatViewProps) {
  const chat = useKeyChat();
  const { sendMessage, stop, confirmAction, selectSession } = useKeyChatActions();
  const seededRef = useRef(false);
  const [restored, setRestored] = useState(false);

  // Keep the chat context pinned to onboarding for this session, and restore
  // the pinned conversation so a reload/resume doesn't restart it.
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

    void selectSession(ONBOARDING_SESSION_ID).finally(() => setRestored(true));

    return () => {
      chat.setCurrentModule(undefined);
      chat.setPageContext(undefined);
      chat.setActiveSessionId(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Seed the welcome for a fresh funnel, or prompt the orchestrator to present
  // the card for the current step when deep-linking/resuming into any other step.
  useEffect(() => {
    if (!restored || seededRef.current) return;
    if (chat.messages.length === 0) {
      seededRef.current = true;
      if (step === "welcome") {
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
      } else {
        void sendMessage(
          `The user is on the ${step} onboarding step. Present the card for this step.`,
          { silent: true },
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, chat.messages.length, step]);

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

  const handleAdvance = async (rawStep: ApiOnboardingStep) => {
    // Cards from the legacy dense wizard still advance with "genesis"/"genome";
    // the step API only accepts the slim funnel values.
    const nextStep = LEGACY_ADVANCE_MAP[rawStep as string] ?? rawStep;
    // "complete" is persisted by markOnboardingComplete itself; saveStep
    // rejects it, and the completion card redirects shortly after anyway.
    if (nextStep === "complete") return;
    await goToStep(nextStep);
    await sendMessage(
      "The user just finished this onboarding step. Present the card for the next step.",
      { silent: true },
    );
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
