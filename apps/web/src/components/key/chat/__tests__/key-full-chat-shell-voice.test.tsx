/**
 * PR196-VOICE: the live voice control in the KEY chat shell, behind the voice
 * availability gate.
 *
 * PR #196 feature 9a mounts KeyLiveVoice in the KeyFullChatShellV2 header with
 * no condition (pr196-review OK-9A-1). Release 0 runs without LiveKit, so every
 * KEY chat header showed a mic whose click toasted the server's raw 503 text
 * naming its env vars. The rebuilt mount asks the server first: the shell
 * probes the business's voice rooms listing (GET
 * /livekit/businesses/:id/rooms), which the server answers with the structured
 * R0-07/R0-P 503 { code: 'provider_not_configured', details: { service:
 * 'voice' } } when LiveKit is not set up, and shows the control only when that
 * probe answers.
 *
 * Pinned here, with only `fetch` answered at the network edge (the chat store
 * and the header's other widgets are stubbed; KeyLiveVoice is the real one):
 *   - voice available (the probe answers 200): the "Talk to KEY live" control
 *     appears, and not before the probe answers;
 *   - LiveKit not configured (the server's structured voice 503): no control,
 *     and the probe cost one request (the R0-P path hands the 503 back
 *     without retrying);
 *   - the probe refused (403) or no business selected: no control (no probe
 *     at all without a business);
 *   - clicking the control asks the server for a session with an empty body:
 *     the client never names the room or the identity (OK-9A-2).
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), message: vi.fn(),
    warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/key/chat",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

/** The chat store and its widgets: stubs, so the only network traffic is the voice probe and the session request. */
vi.mock("@/components/key/chat", () => {
  const chat = {
    status: "idle",
    showHistory: false,
    setShowHistory: () => {},
    chatMode: "general",
    setChatMode: () => {},
    activeSessionId: null,
    messages: [],
    setCurrentModule: () => {},
    setPageContext: () => {},
    setActiveSessionId: () => {},
    appendMessage: () => {},
    setOpen: () => {},
  };
  const actions = {
    sendMessage: async () => {},
    stop: () => {},
    confirmAction: async () => {},
    loadSessions: async () => {},
    selectSession: async () => {},
  };
  return {
    useKeyChat: () => chat,
    useKeyChatActions: () => actions,
    KeyChatMessages: () => <div data-testid="messages" />,
    KeyChatInput: () => <div data-testid="input" />,
    KeyChatVoiceBar: () => <div data-testid="voice-bar" />,
    KeyChatHistory: () => <div data-testid="history" />,
    KeyChatModeTabs: () => <div data-testid="mode-tabs" />,
  };
});
vi.mock("@/components/key/chat/key-action-grid", () => ({ KeyActionGrid: () => null }));
vi.mock("@/components/key/chat/key-genome-preview", () => ({ KeyGenomePreview: () => null }));
vi.mock("@/components/key/chat/key-genome-chip", () => ({ KeyGenomeChip: () => null }));
vi.mock("@/components/key/chat/open-genome-conversation", () => ({
  GENOME_SESSION_ID: "genome",
  openGenomeConversation: () => {},
}));
vi.mock("@/lib/api/ai-approvals", () => ({
  fetchAiApprovals: async () => ({ data: { items: [] }, error: null }),
}));

import { KeyFullChatShellV2 } from "@/components/key/chat/key-full-chat-shell-v2";

const BIZ = "pr196v_biz_A";
const ROOMS_PATH = `/livekit/businesses/${BIZ}/rooms`;
const SESSION_PATH = `/livekit/businesses/${BIZ}/voice-session`;
const CONTROL = { name: "Talk to KEY live" } as const;

/** What the server's global filter sends for an unconfigured LiveKit (livekit-voice-session.spec.ts pins the server side). */
function voiceNotConfigured(path: string): Response {
  return new Response(
    JSON.stringify({
      statusCode: 503,
      code: "provider_not_configured",
      message: "Live voice is not set up on this server",
      error: "Service Unavailable",
      timestamp: "2026-11-09T00:00:00.000Z",
      path: `/api/v1${path}`,
      details: { service: "voice" },
    }),
    { status: 503, statusText: "Service Unavailable", headers: { "content-type": "application/json; charset=utf-8" } },
  );
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Answer = (path: string, init?: RequestInit) => Response | Promise<Response>;

let fetchSpy: MockInstance<typeof fetch>;
let calls: Array<{ path: string; method: string; body: string | null }>;

function answer(fn: Answer) {
  fetchSpy.mockImplementation(async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    calls.push({ path: url.pathname, method, body: typeof init?.body === "string" ? init.body : null });
    return fn(url.pathname, init);
  });
}

const probes = () => calls.filter((c) => c.path.endsWith(ROOMS_PATH) && c.method === "GET");

beforeEach(() => {
  calls = [];
  window.localStorage.clear();
  window.localStorage.setItem("kf_business_id", BIZ);
  fetchSpy = vi.spyOn(globalThis, "fetch");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("KEY chat shell: the live voice control appears only when the server reports voice available (PR196-VOICE)", () => {
  it("voice available: the probe answers 200 and the control appears, and not before the probe answers", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    answer(async (path) => {
      if (path.endsWith(ROOMS_PATH)) {
        await gate;
        return json(200, []);
      }
      return json(404, { message: "unexpected" });
    });

    render(<KeyFullChatShellV2 />);
    await waitFor(() => expect(probes()).toHaveLength(1));
    expect(screen.queryByRole("button", CONTROL)).toBeNull();

    await act(async () => {
      release();
    });
    expect(await screen.findByRole("button", CONTROL)).toBeInTheDocument();
    expect(probes()).toHaveLength(1);
  });

  it("LiveKit not configured: the server's structured voice 503 hides the control, after one request (no retry)", async () => {
    answer((path) => (path.endsWith(ROOMS_PATH) ? voiceNotConfigured(path) : json(404, {})));

    render(<KeyFullChatShellV2 />);
    await waitFor(() => expect(probes()).toHaveLength(1));
    // Let the probe settle and the shell re-render on its answer.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByRole("button", CONTROL)).toBeNull();
    expect(probes()).toHaveLength(1);
    // The header still renders: the gate hides one control, not the shell.
    expect(screen.getByRole("heading", { name: "KEY" })).toBeInTheDocument();
  });

  it("the probe refused (403): no control", async () => {
    answer((path) => (path.endsWith(ROOMS_PATH) ? json(403, { statusCode: 403, message: "No access to this business" }) : json(404, {})));

    render(<KeyFullChatShellV2 />);
    await waitFor(() => expect(probes()).toHaveLength(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByRole("button", CONTROL)).toBeNull();
  });

  it("no business selected: no probe and no control", async () => {
    window.localStorage.removeItem("kf_business_id");
    answer(() => json(200, []));

    render(<KeyFullChatShellV2 />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(probes()).toHaveLength(0);
    expect(screen.queryByRole("button", CONTROL)).toBeNull();
  });

  it("clicking the control asks for a session with an empty body: the client never names the room or the identity (OK-9A-2)", async () => {
    answer((path) => {
      if (path.endsWith(ROOMS_PATH)) return json(200, []);
      // A refused session keeps the test off LiveKit: the control returns to idle.
      if (path.endsWith(SESSION_PATH)) return voiceNotConfigured(path);
      return json(404, {});
    });

    render(<KeyFullChatShellV2 />);
    fireEvent.click(await screen.findByRole("button", CONTROL));
    await waitFor(() => expect(calls.filter((c) => c.path.endsWith(SESSION_PATH))).toHaveLength(1));
    const session = calls.find((c) => c.path.endsWith(SESSION_PATH))!;
    expect(session.method).toBe("POST");
    expect(JSON.parse(session.body ?? "null")).toEqual({});
    expect(await screen.findByRole("button", CONTROL)).toBeInTheDocument();
  });
});
