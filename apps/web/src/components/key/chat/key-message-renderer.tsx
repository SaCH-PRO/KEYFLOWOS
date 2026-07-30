"use client";

import { useCallback, type CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { KeyMessageVoice } from "./use-key-voice-queue";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import type { KeyChatMessage, OnboardingStep } from "./types";
import { KeyAttachmentPreview } from "./key-attachment-preview";
import { KeyPlanCard } from "./key-plan-card";
import { KeyOnboardingCard } from "./key-onboarding-card";

interface KeyMessageRendererProps {
  message: KeyChatMessage;
  isStreaming?: boolean;
  onConfirm?: (toolCallId: string, confirmed: boolean, toolName: string, args: Record<string, unknown>) => void;
  onCardAdvance?: (step: OnboardingStep) => void;
}

export function KeyMessageRenderer({ message, isStreaming, onConfirm, onCardAdvance }: KeyMessageRendererProps) {
  const isUser = message.role === "user";
  const { copied, copy } = useCopyToClipboard();

  const handleCopy = useCallback(() => {
    copy(message.content);
  }, [copy, message.content]);

  const handleSpeak = useCallback(() => {
    if (message.content.trim()) {
      // Use per-message voice queue
      const event = new CustomEvent("kf:speak-message", { 
        detail: { messageId: message.id, text: message.content } 
      });
      window.dispatchEvent(event);
    }
  }, [message.content, message.id]);

  return (
    <div className={cn("group/message w-full", isUser && "flex flex-col items-end")}>
      <div
        className={cn(
          "flex max-w-[90%] flex-col gap-2 md:max-w-[80%]",
          isUser ? "items-end" : "items-start"
        )}
      >
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {message.attachments.map((a) => (
              <KeyAttachmentPreview key={a.id} attachment={a} />
            ))}
          </div>
        )}

        {isUser ? (
          <div className="relative rounded-2xl rounded-br-lg border border-border/30 bg-gradient-to-br from-secondary to-muted px-4 py-2.5 shadow-sm">
            {message.content && (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
            )}
          </div>
        ) : (
          <div className="relative min-w-0">
            {message.content ? (
              <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code({ className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || "");
                      const language = match ? match[1] : "text";
                      const codeString = String(children).replace(/\n$/, "");

                      if (!className) {
                        return (
                          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs" {...props}>
                            {children}
                          </code>
                        );
                      }

                      return (
                        <div className="relative my-2 overflow-hidden rounded-lg border border-border/50 bg-[#1e1e1e]">
                          <div className="flex items-center justify-between border-b border-border/30 bg-muted/20 px-3 py-1.5">
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              {language}
                            </span>
                            <button
                              type="button"
                              onClick={() => copy(codeString)}
                              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                            >
                              {copied ? (
                                <>
                                  <Check className="h-3 w-3" /> Copied
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3" /> Copy
                                </>
                              )}
                            </button>
                          </div>
                          <SyntaxHighlighter
                            language={language}
                            style={vscDarkPlus as Record<string, CSSProperties>}
                            customStyle={{ margin: 0, padding: "1rem", fontSize: "0.8rem" } as CSSProperties}
                          >
                            {codeString}
                          </SyntaxHighlighter>
                        </div>
                      );
                    },
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
            ) : isStreaming ? (
              <div className="flex h-6 items-center gap-1.5 text-sm text-muted-foreground">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:0.1s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:0.2s]" />
              </div>
            ) : null}

            {message.content && (
              <div className="absolute -right-14 top-0 flex gap-1 opacity-0 transition-opacity group-hover/message:opacity-100">
              <KeyMessageVoice messageId={message.id} text={message.content} />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Copy message"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            )}
          </div>
        )}

        {(message.plan?.length || message.pendingConfirmations?.length) && onConfirm ? (
          <div className="w-full space-y-2">
            {(message.plan ?? message.pendingConfirmations?.map((pc) => ({
              toolCallId: pc.toolCallId,
              name: pc.name,
              description: pc.description,
              arguments: pc.arguments,
              riskLevel: pc.riskLevel,
              status: "pending" as const,
            })) ?? []).map((step) => (
              <KeyPlanCard key={step.toolCallId} step={step} onConfirm={onConfirm} />
            ))}
          </div>
        ) : null}

        {message.card && (
          <div className="w-full">
            <KeyOnboardingCard card={message.card} onAdvance={onCardAdvance} />
          </div>
        )}
      </div>
    </div>
  );
}
