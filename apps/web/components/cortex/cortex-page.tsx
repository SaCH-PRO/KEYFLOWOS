'use client';

/**
 * CortexPage — Full KeyCortex page with sidebar, chat, personality selector
 * Responsive: sidebar collapses on mobile.
 */

import { useState } from 'react';
import { useCortexChat } from './use-cortex-chat';
import { CortexChat } from './cortex-chat';
import { CortexPersonalitySelector } from './cortex-personality-selector';
import { CortexVoiceControls } from './cortex-voice-controls';
import { PERSONALITY_CONFIGS, CortexPersona } from './cortex-types';

interface CortexPageProps {
  businessId: string;
  userId: string;
}

export function CortexPage({ businessId, userId }: CortexPageProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<string>('echo');

  const {
    session,
    messages,
    currentPersona,
    isLoading,
    isStreaming,
    error,
    sendMessage,
    switchPersona,
    createSession,
  } = useCortexChat({ businessId, userId, initialPersona: 'jarvis' });

  const config = PERSONALITY_CONFIGS[currentPersona];

  return (
    <div className="flex h-screen bg-[var(--kf-bg)]">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — Session History */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-72 bg-[var(--kf-surface)] border-r border-[var(--kf-border)]
                    flex flex-col transition-transform duration-200 lg:translate-x-0
                    ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* Sidebar Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--kf-border)]">
          <h2 className="text-sm font-semibold text-[var(--kf-text)]">KEY Conversations</h2>
          <button
            onClick={() => createSession()}
            className="p-1.5 rounded-lg hover:bg-[var(--kf-surface-hover)] transition-colors"
            aria-label="New conversation"
          >
            <svg className="w-4 h-4 text-[var(--kf-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>

        {/* Session List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {session ? (
            <button
              className="w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left
                         bg-[var(--kf-primary)]/10 border border-[var(--kf-primary)]/20"
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                style={{ backgroundColor: config.color }}
              >
                {config.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--kf-text)] truncate">
                  {session.title ?? 'New Conversation'}
                </div>
                <div className="text-xs text-[var(--kf-text-muted)]">
                  {messages.length} messages · {config.name}
                </div>
              </div>
            </button>
          ) : (
            <div className="text-center py-8 text-sm text-[var(--kf-text-muted)]">
              No conversations yet.
              <br />
              Start chatting with KEY.
            </div>
          )}
        </div>

        {/* Sidebar Footer */}
        <div className="px-4 py-3 border-t border-[var(--kf-border)]">
          <CortexPersonalitySelector
            currentPersona={currentPersona}
            onSwitch={(p) => switchPersona(p as CortexPersona)}
            disabled={isLoading}
          />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--kf-border)] bg-[var(--kf-surface)]">
          {/* Mobile menu toggle */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 rounded-lg hover:bg-[var(--kf-surface-hover)]"
          >
            <svg className="w-5 h-5 text-[var(--kf-text)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* Page title */}
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
              style={{ backgroundColor: config.color }}
            >
              {config.name[0]}
            </div>
            <div>
              <h1 className="text-sm font-semibold text-[var(--kf-text)]">KEY AI Assistant</h1>
              <p className="text-[10px] text-[var(--kf-text-muted)]">{config.tagline}</p>
            </div>
          </div>

          <div className="flex-1" />

          {/* Voice Controls */}
          <CortexVoiceControls
            businessId={businessId}
            currentPersona={currentPersona}
            currentVoice={selectedVoice as import('./cortex-types').CortexVoice}
            onVoiceChange={(v) => setSelectedVoice(v)}
            onTranscript={(text) => sendMessage(text)}
            disabled={isLoading}
          />
        </header>

        {/* Chat Area */}
        <div className="flex-1 min-h-0 p-4">
          <CortexChat
            businessId={businessId}
            userId={userId}
            persona={currentPersona}
            className="h-full max-h-none"
          />
        </div>
      </main>
    </div>
  );
}
