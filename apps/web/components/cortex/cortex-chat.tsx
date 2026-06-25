'use client';

/**
 * CortexChat — Main chat interface for KEY
 * Message bubbles, action cards, streaming indicator, suggested prompts.
 */

import { useRef, useEffect, FormEvent, useState } from 'react';
import { useCortexChat } from './use-cortex-chat';
import { PERSONALITY_CONFIGS, CortexPersona, CortexMessage } from './cortex-types';

interface CortexChatProps {
  businessId: string;
  userId: string;
  persona?: CortexPersona;
  className?: string;
}

const SUGGESTED_PROMPTS = [
  'Create an invoice for my last client',
  'What tasks are overdue?',
  'How is my business performing this month?',
  'Schedule a team meeting for tomorrow',
  'Find profit opportunities',
  'Summarize my unread messages',
];

export function CortexChat({ businessId, userId, persona = 'jarvis', className = '' }: CortexChatProps) {
  const {
    messages,
    isLoading,
    isStreaming,
    currentPersona,
    error,
    pendingActions,
    sendMessage,
    approveAction,
    clearError,
  } = useCortexChat({ businessId, userId, initialPersona: persona });

  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    const text = input;
    setInput('');
    await sendMessage(text);
  };

  const config = PERSONALITY_CONFIGS[currentPersona];

  return (
    <div className={`flex flex-col h-full max-h-[700px] bg-[var(--kf-surface)] rounded-xl border border-[var(--kf-border)] overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--kf-border)] bg-[var(--kf-surface-elevated)]">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
          style={{ backgroundColor: config.color }}
        >
          {config.name[0]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-[var(--kf-text)] truncate">{config.name}</div>
          <div className="text-xs text-[var(--kf-text-muted)] truncate">{config.tagline}</div>
        </div>
        {isStreaming && (
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: config.color }} />
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: config.color }} />
            </span>
            <span className="text-xs text-[var(--kf-text-muted)]">Thinking...</span>
          </div>
        )}
      </div>

      {/* Messages Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {messages.length === 0 && (
          <div className="space-y-4">
            <div className="text-center py-8">
              <div
                className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center text-white text-2xl"
                style={{ backgroundColor: config.color }}
              >
                {config.name[0]}
              </div>
              <h3 className="text-lg font-semibold text-[var(--kf-text)]">{config.name}</h3>
              <p className="text-sm text-[var(--kf-text-muted)] mt-1">{config.signaturePhrases[0]}</p>
            </div>

            {/* Suggested Prompts */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  className="text-left px-3 py-2.5 rounded-lg text-sm border border-[var(--kf-border)] 
                             text-[var(--kf-text)] hover:bg-[var(--kf-surface-hover)] hover:border-[var(--kf-primary)]
                             transition-colors duration-150"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <ChatMessageBubble key={msg.id} message={msg} persona={currentPersona} />
        ))}

        {/* Streaming indicator */}
        {isStreaming && messages[messages.length - 1]?.role === 'assistant' && messages[messages.length - 1]?.content === '' && (
          <div className="flex items-center gap-2 px-4 py-2">
            <div className="flex gap-1">
              <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: config.color, animationDelay: '0ms' }} />
              <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: config.color, animationDelay: '150ms' }} />
              <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: config.color, animationDelay: '300ms' }} />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mx-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-start gap-2">
            <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
            <div className="flex-1">{error}</div>
            <button onClick={clearError} className="text-red-500 hover:text-red-700 text-xs underline">Dismiss</button>
          </div>
        )}
      </div>

      {/* Pending Actions */}
      {pendingActions.length > 0 && (
        <div className="px-4 py-2 border-t border-[var(--kf-border)] bg-amber-50">
          <div className="text-xs font-semibold text-amber-700 mb-2">Pending Approval</div>
          {pendingActions.map((action, i) => (
            <div key={i} className="flex items-center gap-2 py-1.5 text-sm">
              <span className="flex-1 text-amber-800 truncate">{action.description}</span>
              <button
                onClick={() => approveAction(action.description, true)}
                className="px-2 py-1 rounded bg-green-500 text-white text-xs hover:bg-green-600 transition-colors"
              >
                Approve
              </button>
              <button
                onClick={() => approveAction(action.description, false)}
                className="px-2 py-1 rounded bg-red-500 text-white text-xs hover:bg-red-600 transition-colors"
              >
                Reject
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="px-4 py-3 border-t border-[var(--kf-border)] bg-[var(--kf-surface-elevated)]">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder={`Ask ${config.name} anything...`}
            rows={1}
            className="flex-1 resize-none rounded-lg border border-[var(--kf-border)] bg-[var(--kf-input-bg)] 
                       text-[var(--kf-text)] placeholder-[var(--kf-text-muted)] px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-[var(--kf-primary)] focus:border-transparent
                       max-h-32 min-h-[38px]"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="px-4 py-2 rounded-lg text-white text-sm font-medium transition-all duration-150
                       disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
            style={{ backgroundColor: config.color }}
          >
            {isLoading ? (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Chat Message Bubble ─────────────────────────────────────

function ChatMessageBubble({ message, persona }: { message: CortexMessage; persona: CortexPersona }) {
  const config = PERSONALITY_CONFIGS[persona];
  const isUser = message.role === 'user';
  const isActionResult = message.role === 'action_result';

  if (isActionResult) {
    return (
      <div className="flex items-start gap-2 px-4 py-2 rounded-lg bg-amber-50 border border-amber-200 text-sm">
        <span className="text-amber-600">Action:</span>
        <span className="text-amber-800">{message.content}</span>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] ${isUser ? 'order-1' : 'order-2'}`}>
        {!isUser && (
          <div className="flex items-center gap-1.5 mb-1">
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
              style={{ backgroundColor: config.color }}
            >
              {config.name[0]}
            </div>
            <span className="text-xs text-[var(--kf-text-muted)]">{config.name}</span>
          </div>
        )}

        <div
          className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
            isUser
              ? 'bg-[var(--kf-primary)] text-white rounded-br-sm'
              : 'bg-[var(--kf-surface-elevated)] text-[var(--kf-text)] border border-[var(--kf-border)] rounded-bl-sm'
          }`}
        >
          {message.content || (isUser ? '' : '\u00A0')}
        </div>

        {/* Action Cards */}
        {message.actions && message.actions.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {message.actions.map((action, i) => (
              <ActionCard key={i} action={action} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Action Card ─────────────────────────────────────────────

function ActionCard({ action }: { action: import('./cortex-types').CortexActionResult }) {
  const statusColors: Record<string, string> = {
    success: 'bg-green-50 border-green-200 text-green-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    pending_approval: 'bg-amber-50 border-amber-200 text-amber-800',
  };

  return (
    <div className={`px-3 py-2 rounded-lg border text-xs ${statusColors[action.status] ?? statusColors.pending_approval}`}>
      <div className="font-semibold">{action.actionType}</div>
      <div className="opacity-80">{action.description}</div>
      {action.estimatedImpact && <div className="mt-1 opacity-60">Impact: {action.estimatedImpact}</div>}
    </div>
  );
}
