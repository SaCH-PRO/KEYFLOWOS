"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import type {
  CopilotModule,
  KeyChatAttachment,
  KeyChatMessage,
  KeyChatPageContext,
  KeyChatSession,
  KeyChatStatus,
  KeyChatMode,
} from "./types";

interface KeyChatContextValue {
  open: boolean;
  setOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  toggle: () => void;

  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;

  sessions: KeyChatSession[];
  setSessions: (sessions: KeyChatSession[]) => void;

  messages: KeyChatMessage[];
  setMessages: (messages: KeyChatMessage[] | ((prev: KeyChatMessage[]) => KeyChatMessage[])) => void;
  appendMessage: (message: KeyChatMessage) => void;
  updateMessage: (id: string, patch: Partial<KeyChatMessage>) => void;
  updateLastAssistantMessage: (patch: Partial<KeyChatMessage>) => void;

  input: string;
  setInput: (input: string | ((prev: string) => string)) => void;

  attachments: KeyChatAttachment[];
  addAttachment: (attachment: KeyChatAttachment) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;

  status: KeyChatStatus;
  setStatus: (status: KeyChatStatus) => void;

  currentModule?: CopilotModule;
  setCurrentModule: (module?: CopilotModule) => void;

  pageContext?: KeyChatPageContext;
  setPageContext: (context?: KeyChatPageContext) => void;

  chatMode?: KeyChatMode;
  setChatMode: (mode?: KeyChatMode) => void;

  error?: string;
  setError: (error?: string) => void;

  showHistory: boolean;
  setShowHistory: (value: boolean | ((prev: boolean) => boolean)) => void;

  resetForNewSession: () => void;
}

const KeyChatContext = createContext<KeyChatContextValue | undefined>(undefined);

export function KeyChatProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false);
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(null);
  const [sessions, setSessionsState] = useState<KeyChatSession[]>([]);
  const [messages, setMessagesState] = useState<KeyChatMessage[]>([]);
  const [input, setInputState] = useState("");
  const [attachments, setAttachments] = useState<KeyChatAttachment[]>([]);
  const [status, setStatusState] = useState<KeyChatStatus>("idle");
  const [currentModule, setCurrentModule] = useState<CopilotModule | undefined>(undefined);
  const [pageContext, setPageContext] = useState<KeyChatPageContext | undefined>(undefined);
  const [chatMode, setChatMode] = useState<KeyChatMode | undefined>("general");
  const [error, setErrorState] = useState<string | undefined>(undefined);
  const [showHistory, setShowHistoryState] = useState(true);

  // Mobile: the history rail overlays the chat — start collapsed on small screens.
  useEffect(() => {
    const t = setTimeout(() => {
      if (window.matchMedia("(max-width: 1023px)").matches) setShowHistoryState(false);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const setOpen = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    if (typeof value === "function") {
      setOpenState((prev) => {
        const next = value(prev);
        if (!next) setErrorState(undefined);
        return next;
      });
    } else {
      setOpenState(value);
      if (!value) setErrorState(undefined);
    }
  }, []);

  const toggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, [setOpen]);

  const setSessions = useCallback((value: KeyChatSession[]) => {
    setSessionsState(value);
  }, []);

  const setMessages = useCallback((value: KeyChatMessage[] | ((prev: KeyChatMessage[]) => KeyChatMessage[])) => {
    setMessagesState(value);
  }, []);

  const appendMessage = useCallback((message: KeyChatMessage) => {
    setMessagesState((prev) => [...prev, message]);
  }, []);

  const updateMessage = useCallback((id: string, patch: Partial<KeyChatMessage>) => {
    setMessagesState((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m))
    );
  }, []);

  const updateLastAssistantMessage = useCallback((patch: Partial<KeyChatMessage>) => {
    setMessagesState((prev) => {
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === "assistant") {
          const next = [...prev];
          next[i] = { ...next[i], ...patch };
          return next;
        }
      }
      return prev;
    });
  }, []);

  const setInput = useCallback((value: string | ((prev: string) => string)) => {
    if (typeof value === "function") {
      setInputState(value);
    } else {
      setInputState(value);
    }
  }, []);

  const addAttachment = useCallback((attachment: KeyChatAttachment) => {
    setAttachments((prev) => [...prev, attachment]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  const setStatus = useCallback((value: KeyChatStatus) => {
    setStatusState(value);
  }, []);

  const setError = useCallback((value?: string) => {
    setErrorState(value);
  }, []);

  const setShowHistory = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setShowHistoryState(value);
  }, []);

  const resetForNewSession = useCallback(() => {
    setActiveSessionIdState(null);
    setMessagesState([]);
    setInputState("");
    setAttachments([]);
    setStatusState("idle");
    setErrorState(undefined);
    setShowHistoryState(false);
    setChatMode("general");
  }, []);

  return (
    <KeyChatContext.Provider
      value={{
        open,
        setOpen,
        toggle,
        activeSessionId,
        setActiveSessionId: setActiveSessionIdState,
        sessions,
        setSessions,
        messages,
        setMessages,
        appendMessage,
        updateMessage,
        updateLastAssistantMessage,
        input,
        setInput,
        attachments,
        addAttachment,
        removeAttachment,
        clearAttachments,
        status,
        setStatus,
        currentModule,
        setCurrentModule,
        pageContext,
        setPageContext,
        chatMode,
        setChatMode,
        error,
        setError,
        showHistory,
        setShowHistory,
        resetForNewSession,
      }}
    >
      {children}
    </KeyChatContext.Provider>
  );
}

export function useKeyChat() {
  const ctx = useContext(KeyChatContext);
  if (!ctx) throw new Error("useKeyChat must be used within <KeyChatProvider>");
  return ctx;
}
