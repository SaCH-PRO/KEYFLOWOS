'use client';

/**
 * useCortexChat — React hook for KEY Cortex streaming chat
 * Handles SSE streaming, session management, action accumulation, and voice.
 */

import { useState, useCallback, useRef } from 'react';
import {
  CortexMessage,
  CortexSession,
  CortexPersona,
  CortexStreamChunk,
  CortexActionResult,
  ChatRequest,
  TrustExplanation,
} from './cortex-types';

const API_BASE = '/api/v1/cortex';

interface UseCortexChatOptions {
  businessId: string;
  userId: string;
  initialPersona?: CortexPersona;
  initialVoice?: string;
}

interface UseCortexChatReturn {
  messages: CortexMessage[];
  session: CortexSession | null;
  isLoading: boolean;
  isStreaming: boolean;
  currentPersona: CortexPersona;
  error: string | null;
  pendingActions: CortexActionResult[];
  sendMessage: (text: string, opts?: Partial<ChatRequest>) => Promise<void>;
  switchPersona: (persona: CortexPersona) => Promise<void>;
  createSession: (persona?: CortexPersona) => Promise<CortexSession>;
  loadSession: (sessionId: string) => Promise<void>;
  approveAction: (actionId: string, approved: boolean) => Promise<void>;
  clearError: () => void;
  retryLastMessage: () => Promise<void>;
}

export function useCortexChat(options: UseCortexChatOptions): UseCortexChatReturn {
  const { businessId, userId, initialPersona = 'jarvis' } = options;

  const [messages, setMessages] = useState<CortexMessage[]>([]);
  const [session, setSession] = useState<CortexSession | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentPersona, setCurrentPersona] = useState<CortexPersona>(initialPersona);
  const [error, setError] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<CortexActionResult[]>([]);

  const lastMessageRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // ── Create a new session ──────────────────────────────────

  const createSession = useCallback(async (persona?: CortexPersona): Promise<CortexSession> => {
    const res = await fetch(`${API_BASE}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessId,
        userId,
        persona: persona ?? currentPersona,
      }),
    });

    if (!res.ok) throw new Error(`Failed to create session: ${res.status}`);

    const data = (await res.json()) as CortexSession;
    setSession(data);
    setMessages([]);
    return data;
  }, [businessId, userId, currentPersona]);

  // ── Load an existing session ──────────────────────────────

  const loadSession = useCallback(async (sessionId: string): Promise<void> => {
    const res = await fetch(`${API_BASE}/sessions/${sessionId}`);
    if (!res.ok) throw new Error(`Failed to load session: ${res.status}`);

    const data = (await res.json()) as CortexSession;
    setSession(data);
    setMessages(data.messages ?? []);
    setCurrentPersona(data.persona);
  }, []);

  // ── Switch personality ────────────────────────────────────

  const switchPersona = useCallback(async (persona: CortexPersona): Promise<void> => {
    if (!session) {
      setCurrentPersona(persona);
      return;
    }

    const res = await fetch(`${API_BASE}/personalities/switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, persona }),
    });

    if (!res.ok) throw new Error(`Failed to switch personality: ${res.status}`);

    const updated = (await res.json()) as CortexSession;
    setSession(updated);
    setCurrentPersona(persona);
  }, [session]);

  // ── Approve/reject a pending action ───────────────────────

  const approveAction = useCallback(async (actionId: string, approved: boolean): Promise<void> => {
    if (!session) return;

    const res = await fetch(`${API_BASE}/actions/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, actionId, approved }),
    });

    if (!res.ok) throw new Error(`Failed to approve action: ${res.status}`);

    // Remove from pending
    setPendingActions((prev) => prev.filter((a) => a.description !== actionId));
  }, [session]);

  // ── Send message (streaming SSE) ──────────────────────────

  const sendMessage = useCallback(async (text: string, opts?: Partial<ChatRequest>): Promise<void> => {
    if (!text.trim()) return;

    lastMessageRef.current = text;
    setIsLoading(true);
    setIsStreaming(true);
    setError(null);

    // Ensure session exists
    let currentSession = session;
    if (!currentSession) {
      try {
        currentSession = await createSession();
      } catch (err) {
        setError('Failed to create chat session.');
        setIsLoading(false);
        setIsStreaming(false);
        return;
      }
    }

    // Add user message to UI
    const userMessage: CortexMessage = {
      id: `msg_${Date.now()}_user`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);

    // Start SSE stream
    abortControllerRef.current = new AbortController();

    try {
      const res = await fetch(`${API_BASE}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          sessionId: currentSession.id,
          businessId,
          userId,
          persona: currentPersona,
          enableActions: true,
          ...opts,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!res.ok) {
        throw new Error(`Chat request failed: ${res.status}`);
      }

      if (!res.body) {
        throw new Error('No response body');
      }

      // Read SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      const assistantMessage: CortexMessage = {
        id: `msg_${Date.now()}_assistant`,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        actions: [],
      };

      setMessages((prev) => [...prev, assistantMessage]);

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          const json = line.slice(6);
          if (json === '[DONE]') continue;

          try {
            const chunk = JSON.parse(json) as CortexStreamChunk;
            processChunk(chunk, assistantMessage);
          } catch {
            // Invalid JSON chunk, skip
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('abort')) return;
      setError(msg);
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
    }
  }, [session, businessId, userId, currentPersona, createSession]);

  // ── Process incoming SSE chunk ────────────────────────────

  function processChunk(chunk: CortexStreamChunk, msg: CortexMessage): void {
    switch (chunk.type) {
      case 'text_delta':
        if (chunk.content) {
          msg.content += chunk.content;
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === 'assistant') {
              last.content = msg.content;
            }
            return updated;
          });
        }
        break;

      case 'action_delta':
        if (chunk.action) {
          const action = chunk.action as CortexActionResult;
          msg.actions = [...(msg.actions ?? []), action];
          if (action.requiresApproval) {
            setPendingActions((prev) => [...prev, action]);
          }
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last) last.actions = msg.actions;
            return updated;
          });
        }
        break;

      case 'thought':
        // Thoughts are shown in an expandable UI
        break;

      case 'error':
        setError(chunk.error ?? 'Unknown streaming error');
        break;

      case 'done':
        setIsStreaming(false);
        break;
    }
  }

  // ── Clear error ───────────────────────────────────────────

  const clearError = useCallback(() => setError(null), []);

  // ── Retry last message ────────────────────────────────────

  const retryLastMessage = useCallback(async (): Promise<void> => {
    if (lastMessageRef.current) {
      await sendMessage(lastMessageRef.current);
    }
  }, [sendMessage]);

  return {
    messages,
    session,
    isLoading,
    isStreaming,
    currentPersona,
    error,
    pendingActions,
    sendMessage,
    switchPersona,
    createSession,
    loadSession,
    approveAction,
    clearError,
    retryLastMessage,
  };
}
