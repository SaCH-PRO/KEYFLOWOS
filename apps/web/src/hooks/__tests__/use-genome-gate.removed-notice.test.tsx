/**
 * SWP-REMOVED-MEMBER-NOTICE (BUG-117, journey J8): the Business Genome gate does not send a removed member to
 * onboarding for that reason (the shell's notice tells them instead: components/layout/removed-business-notice.tsx).
 *
 *   RBN-05  RED-BEFORE  while the notice is pending, the gate does not redirect to /app/onboarding, even though the
 *                       remaining business has not finished onboarding
 *   RBN-06  control     with no notice, the gate still sends an unfinished business to /app/onboarding
 *   RBN-07  RED-BEFORE  with no business left and the notice pending, the gate does not redirect either
 *   RBN-08  RED-AT-1be13828  security review MINOR-3: once the member dismisses the notice, the gate applies again at
 *                       once (an unfinished business is sent to onboarding without waiting for a navigation)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup, waitFor, act } from "@testing-library/react";

const nav = vi.hoisted(() => {
  const replace = vi.fn();
  const push = vi.fn();
  return { replace, push, router: { replace, push }, pathname: "/app/crm/contacts", searchParams: new URLSearchParams() };
});
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => nav.pathname,
  useSearchParams: () => nav.searchParams,
}));

const ws = vi.hoisted(() => ({ businessId: "biz-members-own" as string | null, notice: null as { id: string; name: string | null } | null }));
vi.mock("@/lib/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspace")>()),
  getStoredBusinessId: () => ws.businessId,
}));
vi.mock("@/lib/removed-business-notice", () => ({
  BUSINESS_REMOVED_EVENT: "kf:business-removed",
  getRemovedBusinessNotice: () => ws.notice,
  raiseRemovedBusinessNotice: () => {},
  dismissRemovedBusinessNotice: () => { ws.notice = null; },
}));

const api = vi.hoisted(() => ({ fetchOnboardingState: vi.fn() }));
vi.mock("@/lib/api/onboarding-concierge", () => ({ fetchOnboardingState: api.fetchOnboardingState }));

import { useGenomeGate } from "@/hooks/use-genome-gate";

const unfinished = { data: { step: "welcome", onboardingComplete: false, onboardingStartedAt: null, onboardingCompletedAt: null, threePillarMet: false, setupStatus: null }, error: null };

beforeEach(() => {
  ws.businessId = "biz-members-own";
  ws.notice = null;
  nav.replace.mockClear();
  api.fetchOnboardingState.mockReset();
  api.fetchOnboardingState.mockResolvedValue(unfinished);
});
afterEach(() => cleanup());

async function gateSettled(result: { current: { checking: boolean } }) {
  await waitFor(() => expect(result.current.checking).toBe(false));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("SWP-REMOVED-MEMBER-NOTICE: the Business Genome gate", () => {
  it("RBN-05 RED-BEFORE: with the notice pending, an unfinished remaining business is not sent to onboarding", async () => {
    ws.notice = { id: "biz-owners-salon", name: "Owner's Salon" };
    const { result } = renderHook(() => useGenomeGate());
    await gateSettled(result);
    expect(nav.replace).not.toHaveBeenCalledWith("/app/onboarding");
  });

  it("RBN-06 control: with no notice, an unfinished business is still sent to onboarding", async () => {
    const { result } = renderHook(() => useGenomeGate());
    await gateSettled(result);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/app/onboarding"));
  });

  it("RBN-07 RED-BEFORE: with no business left and the notice pending, the gate does not redirect either", async () => {
    ws.businessId = null;
    ws.notice = { id: "biz-owners-salon", name: "Owner's Salon" };
    const { result } = renderHook(() => useGenomeGate());
    await gateSettled(result);
    expect(nav.replace).not.toHaveBeenCalledWith("/app/onboarding");
  });

  it("RBN-08 RED-AT-1be13828: dismissing the notice lets the gate apply again at once", async () => {
    ws.notice = { id: "biz-owners-salon", name: "Owner's Salon" };
    const { result } = renderHook(() => useGenomeGate());
    await gateSettled(result);
    expect(nav.replace).not.toHaveBeenCalledWith("/app/onboarding");

    act(() => {
      ws.notice = null;
      window.dispatchEvent(new CustomEvent("kf:business-removed", { detail: null }));
    });
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/app/onboarding"));
  });
});
