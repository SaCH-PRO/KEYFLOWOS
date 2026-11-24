/**
 * SWP-KEY-CHAT-WEB (sweep BUG-040, BUG-042, BUG-043; journeys A and K).
 *
 *   - BUG-040: the Send and Deep think buttons passed their click event as the message (onClick={onSend}), and
 *     use-key-chat-actions called .trim() on it: a TypeError, so a typed message was never sent by the button.
 *   - BUG-042: the history list loaded its sessions in an effect keyed on loadSessions, a callback rebuilt on every
 *     chat change, and loading sessions changes the chat: GET flow/sessions ran in a loop while the drawer was open.
 *   - BUG-043: the message list kept itself at the bottom with scrollIntoView, which scrolls every scrollable
 *     ancestor too, so the app root scrolled and onboarding's "Set up manually" (D-03) went off screen. Only the
 *     messages' own container may scroll.
 *
 * The stream and the reasoning pipeline are stubbed at their hooks (what they are asked to send is under test, not
 * the network); the store, the actions and the screens are the real ones. RED-BEFORE cases fail on the packet's base
 * (04730333); CONTROL cases pass on both.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { useEffect } from "react";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";

const stream = vi.hoisted(() => ({ start: vi.fn(async () => {}), stop: vi.fn() }));
const cognition = vi.hoisted(() => ({ think: vi.fn(async () => {}), stop: vi.fn() }));
const client = vi.hoisted(() => ({
  fetchFlowSessions: vi.fn(async () => ({ data: [{ id: "sess_1", messages: [], updatedAt: "2026-11-24T10:00:00Z", createdAt: "2026-11-24T10:00:00Z" }] })),
  sendFlowChat: vi.fn(async () => ({ data: { reply: "ok", sessionId: "sess_1", pendingConfirmations: [], toolResults: [] } })),
  deleteFlowSession: vi.fn(async () => ({ data: { success: true } })),
  confirmFlowAction: vi.fn(async () => ({ data: { success: true } })),
}));

vi.mock("../use-key-stream", async (orig) => ({ ...(await orig<object>()), useKeyStream: () => stream }));
vi.mock("../use-key-cognition", async (orig) => ({ ...(await orig<object>()), useKeyCognition: () => cognition }));
vi.mock("../use-key-chat-tts", () => ({ useKeyChatTts: () => undefined }));
vi.mock("../use-voice-input", () => ({ useVoiceInput: () => ({ isRecording: false, isProcessing: false, toggle: vi.fn() }) }));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: vi.fn(), isUploading: false }) }));
vi.mock("@/lib/workspace", async (orig) => ({ ...(await orig<object>()), getStoredBusinessId: () => "biz_key_chat" }));
vi.mock("@/lib/client", async (orig) => ({ ...(await orig<object>()), ...client }));
vi.mock("@/lib/api/business-genome", async (orig) => ({ ...(await orig<object>()), getGenome: vi.fn(async () => ({ data: null })) }));
// The message renderer reads the TTS engine (speak buttons); not under test here.
vi.mock("@/components/tts", () => ({
  useTts: () => ({
    engine: { speak: vi.fn(async () => {}), cancel: vi.fn(), toggleMuted: vi.fn(), playAudioBlob: vi.fn(async () => {}) },
    state: { muted: false, speed: 1, playing: false, paused: false, currentText: "", currentSentence: "", queue: [], availableProviders: [] },
  }),
  TtsProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("react-syntax-highlighter", () => ({ Prism: ({ children }: { children: React.ReactNode }) => <pre>{children}</pre> }));
vi.mock("react-syntax-highlighter/dist/esm/styles/prism", () => ({ oneDark: {} }));

import { KeyChatProvider, useKeyChat } from "../key-chat-store";
import { useKeyChatActions } from "../use-key-chat-actions";
import { KeyChatInput } from "../key-chat-input";
import { KeyChatHistory } from "../key-chat-history";
import { KeyChatMessages } from "../key-chat-messages";
import type { KeyChatMessage } from "../types";

/** The composer as the drawer mounts it: KeyChatInput wired to the real actions. */
function Composer() {
  const { sendMessage, deepThink, stop } = useKeyChatActions();
  return <KeyChatInput onSend={sendMessage} onStop={stop} onDeepThink={deepThink} />;
}

/** Puts messages in the store, then shows the list inside a scrollable page, as the app shell does. */
function MessagesOnPage({ messages }: { messages: KeyChatMessage[] }) {
  const { setMessages } = useKeyChat();
  useEffect(() => {
    setMessages(messages);
  }, [messages, setMessages]);
  return (
    <div data-testid="app-root" style={{ overflowY: "auto", height: 400 }}>
      <div style={{ height: 300 }}>Set up manually</div>
      <div style={{ height: 300, display: "flex", flexDirection: "column" }}>
        <KeyChatMessages onConfirmAction={() => {}} />
      </div>
    </div>
  );
}

const msg = (i: number): KeyChatMessage => ({ id: `m${i}`, role: i % 2 ? "assistant" : "user", content: `Message ${i}`, timestamp: 1_700_000_000_000 + i * 1000 });

let scrollIntoView: ReturnType<typeof vi.fn>;
let scrollTo: ReturnType<typeof vi.fn>;
const unhandled: unknown[] = [];
const onUnhandled = (e: PromiseRejectionEvent | unknown) => unhandled.push((e as PromiseRejectionEvent)?.reason ?? e);

beforeEach(() => {
  stream.start.mockClear();
  cognition.think.mockClear();
  client.fetchFlowSessions.mockClear();
  unhandled.length = 0;
  process.on("unhandledRejection", onUnhandled);
  scrollIntoView = vi.fn();
  scrollTo = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
});
afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
  cleanup();
  vi.useRealTimers();
});

describe("BUG-040: Send and Deep think send the typed text", () => {
  it("RED-BEFORE: Send sends the typed text, once, with no TypeError", async () => {
    render(<KeyChatProvider><Composer /></KeyChatProvider>);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Who owes me money?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(stream.start).toHaveBeenCalledTimes(1));
    expect((stream.start.mock.calls[0] as unknown as [{ message: string }])[0].message).toBe("Who owes me money?");
    await new Promise((r) => setTimeout(r, 0));
    expect(unhandled.map(String)).toEqual([]);
  });

  it("RED-BEFORE: Deep think sends the typed text to the reasoning pipeline", async () => {
    render(<KeyChatProvider><Composer /></KeyChatProvider>);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Why is cash slow?" } });
    fireEvent.click(screen.getByRole("button", { name: "Deep think" }));
    await waitFor(() => expect(cognition.think).toHaveBeenCalledTimes(1));
    expect((cognition.think.mock.calls[0] as unknown as [{ text: string }])[0].text).toBe("Why is cash slow?");
  });

  it("CONTROL: Enter still sends the typed text", async () => {
    render(<KeyChatProvider><Composer /></KeyChatProvider>);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "Hello KEY" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(stream.start).toHaveBeenCalledTimes(1));
    expect((stream.start.mock.calls[0] as unknown as [{ message: string }])[0].message).toBe("Hello KEY");
  });

  it("RED-BEFORE: the actions take only text: an object passed as the message never reaches .trim()", async () => {
    /** A caller that hands sendMessage a stray event object (what onClick={onSend} handed over), not text. */
    function StrayCaller() {
      const { sendMessage } = useKeyChatActions();
      const { setInput } = useKeyChat();
      useEffect(() => setInput("From the box"), [setInput]);
      return <button type="button" onClick={() => void sendMessage({ type: "click" } as unknown as string)}>stray</button>;
    }
    render(<KeyChatProvider><StrayCaller /></KeyChatProvider>);
    // The object is not text: the box's text is sent instead.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "stray" }));
    });
    await waitFor(() => expect(stream.start).toHaveBeenCalledTimes(1));
    expect((stream.start.mock.calls[0] as unknown as [{ message: string }])[0].message).toBe("From the box");
    await new Promise((r) => setTimeout(r, 0));
    expect(unhandled.map(String)).toEqual([]);
  });
});

describe("BUG-042: the history loads its sessions once", () => {
  it("RED-BEFORE: an open drawer asks for flow/sessions once, however long it stays open", async () => {
    // Real time, with the read answering after 10 ms as a network does. On the base the read runs again once the
    // sessions land (they change the chat, which rebuilds loadSessions and re-runs the effect); with an instant
    // answer the re-reads chain fast enough to starve the timer, which is the loop the sweep saw.
    client.fetchFlowSessions.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { data: [{ id: "sess_1", messages: [], updatedAt: "2026-11-24T10:00:00Z", createdAt: "2026-11-24T10:00:00Z" }] };
    });
    render(<KeyChatProvider><KeyChatHistory /></KeyChatProvider>);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1_000));
    });
    expect(client.fetchFlowSessions).toHaveBeenCalledTimes(1);
  }, 10_000);

  it("CONTROL: the sessions it loaded are listed", async () => {
    render(<KeyChatProvider><KeyChatHistory /></KeyChatProvider>);
    expect(await screen.findByText("New chat")).toBeTruthy();
  });
});

describe("BUG-043: the messages scroll only their own container", () => {
  it("RED-BEFORE: keeping to the newest message never scrolls the page (no scrollIntoView)", async () => {
    render(<KeyChatProvider><MessagesOnPage messages={[msg(1), msg(2), msg(3)]} /></KeyChatProvider>);
    await screen.findByText("Message 3");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("RED-BEFORE: it scrolls the messages' own container to its end", async () => {
    render(<KeyChatProvider><MessagesOnPage messages={[msg(1), msg(2), msg(3)]} /></KeyChatProvider>);
    await screen.findByText("Message 3");
    await waitFor(() => expect(scrollTo).toHaveBeenCalled());
    const root = screen.getByTestId("app-root");
    for (const call of scrollTo.mock.contexts) {
      expect(call, "only the messages' container scrolls").not.toBe(root);
      expect((call as HTMLElement).className).toMatch(/overflow-y-auto/);
    }
  });
});
