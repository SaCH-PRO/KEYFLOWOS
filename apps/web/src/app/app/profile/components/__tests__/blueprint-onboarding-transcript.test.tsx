/**
 * PR196-GENOME: the Business Genome interview transcript is restored from the
 * server, kept in memory only, and leaves nothing on a shared device.
 *
 * WHY (PR #196 review, OK-8B-2 and OK-8B-4): the PR kept the founder's
 * transcript (partners and share splits, tax and registration status) in
 * localStorage under `kf_blueprint_onboarding_history_<businessId>`, keyed by
 * business only and never removed at sign-out, so the next person on the
 * device could read it, and its "restore" silently preferred that copy over
 * the server. Here the transcript comes back from GET
 * /blueprint/businesses/:businessId/onboarding-history (the server's bounded
 * cache), lives in React state, and:
 *   - is never written to localStorage or sessionStorage (W1, W3);
 *   - is dropped the moment the member switches business (W4);
 *   - any copy an earlier build left behind is purged at sign-out and on a
 *     business switch (W5).
 * W2 keeps the existing behaviour: with no server transcript KEY opens the
 * conversation with one welcome turn.
 *
 * The component and lib/workspace are real; only the API transport, the TTS
 * engine and toasts are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPostSimple: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGet: api.apiGet, apiPostSimple: api.apiPostSimple };
});

vi.mock("@/components/tts", () => ({
  useTts: () => ({ engine: { speak: vi.fn(), cancel: vi.fn() }, state: { autoSpeak: false } }),
  SpeakButton: () => null,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), message: vi.fn(),
    warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));

import { BlueprintOnboardingChat } from "../blueprint-onboarding-chat";
import { clearStoredBusinessId, selectBusiness, setStoredBusinessId } from "@/lib/workspace";

const BIZ_A = "biz_genome_a";
const BIZ_B = "biz_genome_b";
const SENSITIVE = "We are three partners: Ana 50%, Ben 30%, Cy 20%. BIR not registered yet.";
const KEY_TURN = "Thanks. Who is your ideal customer?";
const LEGACY_KEY = `kf_blueprint_onboarding_history_${BIZ_A}`;

function historyFor(businessId: string, messages: Array<{ role: "user" | "assistant"; content: string }>) {
  return {
    data: { businessId, messages, completedSections: [], nextSection: "customerModel", completeness: 30 },
    error: null,
    status: 200,
  };
}

function chatReply(reply: string) {
  return {
    data: {
      reply,
      blueprint: {},
      completeness: 35,
      threePillarMinimumMet: false,
      confidenceScores: {},
      extracted: [],
      nextSection: "customerModel",
    },
    error: null,
    status: 201,
  };
}

/** Everything the browser keeps for this origin, as one string. */
function browserStorage(): string {
  const dump: string[] = [];
  for (const store of [window.localStorage, window.sessionStorage]) {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)!;
      dump.push(`${key}=${store.getItem(key)}`);
    }
  }
  return dump.join("\n");
}

function onboardingChatCalls() {
  return api.apiPostSimple.mock.calls.filter(([path]) => String(path).endsWith("/onboarding-chat"));
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api.apiGet.mockReset();
  api.apiPostSimple.mockReset();
  api.apiGet.mockImplementation(async (path: string) =>
    path === `/blueprint/businesses/${BIZ_A}/onboarding-history`
      ? historyFor(BIZ_A, [
          { role: "user", content: SENSITIVE },
          { role: "assistant", content: KEY_TURN },
        ])
      : historyFor(BIZ_B, []),
  );
  api.apiPostSimple.mockImplementation(async () => chatReply("Hi! What is your business called?"));
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("PR196-GENOME: the onboarding transcript on the device", () => {
  it("W1 restores the server transcript on mount, with no new model call, and stores none of it in the browser", async () => {
    render(<BlueprintOnboardingChat businessId={BIZ_A} />);

    expect(await screen.findByText(SENSITIVE)).toBeInTheDocument();
    expect(screen.getByText(KEY_TURN)).toBeInTheDocument();
    expect(api.apiGet).toHaveBeenCalledWith(`/blueprint/businesses/${BIZ_A}/onboarding-history`);
    expect(onboardingChatCalls(), "a restored conversation must not be re-opened").toHaveLength(0);
    expect(browserStorage()).not.toContain("partners");
  });

  it("W2 with no server transcript, KEY opens the conversation with one welcome turn", async () => {
    render(<BlueprintOnboardingChat businessId={BIZ_B} />);
    expect(await screen.findByText("Hi! What is your business called?")).toBeInTheDocument();
    expect(onboardingChatCalls()).toHaveLength(1);
  });

  it("W3 a chat turn keeps the transcript in memory only", async () => {
    api.apiPostSimple.mockImplementation(async () => chatReply("Got it: owner-run restaurants."));
    render(<BlueprintOnboardingChat businessId={BIZ_A} />);
    await screen.findByText(SENSITIVE);

    fireEvent.change(screen.getByPlaceholderText("Tell KEY about your business..."), {
      target: { value: "Owner-run restaurants in San Fernando" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(await screen.findByText("Got it: owner-run restaurants.")).toBeInTheDocument();
    const storage = browserStorage();
    expect(storage).not.toContain("partners");
    expect(storage).not.toContain("San Fernando");
  });

  it("W4 switching business drops the previous business transcript at once", async () => {
    setStoredBusinessId(BIZ_A);
    let releaseB: (v: unknown) => void = () => {};
    render(<BlueprintOnboardingChat />);
    expect(await screen.findByText(SENSITIVE)).toBeInTheDocument();

    // B's history is still on its way when the switch lands.
    api.apiGet.mockImplementation(
      (path: string) =>
        new Promise((resolve) => {
          releaseB = () => resolve(historyFor(BIZ_B, []));
          void path;
        }),
    );
    act(() => selectBusiness(BIZ_B));

    await waitFor(() => expect(screen.queryByText(SENSITIVE)).not.toBeInTheDocument());
    expect(screen.queryByText(KEY_TURN)).not.toBeInTheDocument();
    expect(api.apiGet).toHaveBeenCalledWith(`/blueprint/businesses/${BIZ_B}/onboarding-history`);
    await act(async () => releaseB(undefined));
  });

  it("W5 sign-out and a business switch purge any transcript copy an earlier build left in browser storage", () => {
    const copy = JSON.stringify([{ role: "user", content: SENSITIVE }]);
    window.localStorage.setItem(LEGACY_KEY, copy);
    window.sessionStorage.setItem(`kf_blueprint_onboarding_history_${BIZ_B}`, copy);
    window.localStorage.setItem("kf_onboarding_dismissed", "true");

    clearStoredBusinessId();
    expect(browserStorage()).not.toContain("partners");
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
    // Only transcript copies go: an unrelated preference stays.
    expect(window.localStorage.getItem("kf_onboarding_dismissed")).toBe("true");

    window.localStorage.setItem(LEGACY_KEY, copy);
    selectBusiness(BIZ_B);
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
  });
});
