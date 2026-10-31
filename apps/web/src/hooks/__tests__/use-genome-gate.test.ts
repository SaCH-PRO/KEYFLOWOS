/**
 * R0-06-WEB-ONBOARD-MANUAL — the genome gate fails open (owner ruling D-03).
 *
 * useGenomeGate (mounted by apps/web/src/app/app/layout.tsx) holds an owner on
 * /app/onboarding until the server says onboarding is complete. That rule
 * stays: a business that has not finished onboarding is sent there, where the
 * manual (non-AI) path now lets it finish.
 *
 * What changes is the failure mode. Before this packet a failed or throwing
 * onboarding-state read was treated as "not onboarded" and bounced every user,
 * including one who finished onboarding long ago, back to /app/onboarding on
 * any API blip. D-03 rules that the gate fails open: when the state cannot be
 * read, the user stays where they are.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// Next returns the same router and search-params objects across renders; the
// hook's effect depends on them, so the stubs must be stable too.
const nav = vi.hoisted(() => {
  const replace = vi.fn();
  const push = vi.fn();
  return {
    replace,
    push,
    router: { replace, push },
    pathname: "/app/contacts",
    searchParams: new URLSearchParams(),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => nav.pathname,
  useSearchParams: () => nav.searchParams,
}));

const workspace = vi.hoisted(() => ({ businessId: "biz_k06_gate" as string | null }));
vi.mock("@/lib/workspace", () => ({
  getStoredBusinessId: () => workspace.businessId,
}));

const api = vi.hoisted(() => ({ fetchOnboardingState: vi.fn() }));
vi.mock("@/lib/api/onboarding-concierge", () => ({
  fetchOnboardingState: api.fetchOnboardingState,
}));

import { useGenomeGate } from "@/hooks/use-genome-gate";

function onboardingState(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      step: "welcome",
      onboardingComplete: false,
      onboardingStartedAt: null,
      onboardingCompletedAt: null,
      threePillarMet: false,
      setupStatus: null,
      ...overrides,
    },
    error: null,
  };
}

/** Lets the hook's fetch settle, then asserts it has stopped checking. */
async function settled(result: { current: { checking: boolean } }) {
  await waitFor(() => expect(result.current.checking).toBe(false));
  await waitFor(() => expect(api.fetchOnboardingState).toHaveBeenCalled());
  // One more turn so a redirect issued after the state update is observed.
  await new Promise((r) => setTimeout(r, 0));
}

describe("useGenomeGate", () => {
  beforeEach(() => {
    nav.replace.mockReset();
    nav.push.mockReset();
    nav.pathname = "/app/contacts";
    workspace.businessId = "biz_k06_gate";
    api.fetchOnboardingState.mockReset();
  });

  it("an onboarded owner stays on the page and the gate is open", async () => {
    api.fetchOnboardingState.mockResolvedValue(
      onboardingState({ step: "complete", onboardingComplete: true, onboardingCompletedAt: "2026-10-31T00:00:00.000Z" }),
    );
    const { result } = renderHook(() => useGenomeGate());
    await settled(result);
    expect(api.fetchOnboardingState).toHaveBeenCalledWith("biz_k06_gate");
    expect(result.current.gateActive).toBe(false);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("an owner who has not finished onboarding is still sent to /app/onboarding", async () => {
    api.fetchOnboardingState.mockResolvedValue(onboardingState());
    const { result } = renderHook(() => useGenomeGate());
    await settled(result);
    expect(result.current.gateActive).toBe(true);
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith("/app/onboarding");
  });

  it("the onboarding page itself is never redirected", async () => {
    nav.pathname = "/app/onboarding";
    api.fetchOnboardingState.mockResolvedValue(onboardingState());
    const { result } = renderHook(() => useGenomeGate());
    await settled(result);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("an incomplete genome does not gate a completed onboarding (three pillars are a recommendation)", async () => {
    api.fetchOnboardingState.mockResolvedValue(
      onboardingState({ onboardingComplete: true, onboardingCompletedAt: "2026-10-31T00:00:00.000Z", threePillarMet: false }),
    );
    const { result } = renderHook(() => useGenomeGate());
    await settled(result);
    expect(result.current.gateActive).toBe(false);
    expect(result.current.threePillarMet).toBe(false);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("fails open: an onboarding-state API error does not redirect", async () => {
    api.fetchOnboardingState.mockResolvedValue({ data: null, error: "No AI providers available" });
    const { result } = renderHook(() => useGenomeGate());
    await settled(result);
    expect(nav.replace).not.toHaveBeenCalled();
    expect(result.current.gateActive).toBe(false);
  });

  it("fails open: a throwing onboarding-state read does not redirect", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    api.fetchOnboardingState.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useGenomeGate());
    await settled(result);
    expect(nav.replace).not.toHaveBeenCalled();
    expect(result.current.gateActive).toBe(false);
    consoleError.mockRestore();
  });

  it("fails open: an empty onboarding-state body does not redirect", async () => {
    api.fetchOnboardingState.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useGenomeGate());
    await settled(result);
    expect(nav.replace).not.toHaveBeenCalled();
    expect(result.current.gateActive).toBe(false);
  });
});
