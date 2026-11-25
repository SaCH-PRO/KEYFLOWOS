/**
 * SWP-REMOVED-MEMBER-NOTICE (BUG-117, journey J8): the shell tells a removed member, lastingly and by name, and the
 * Business Genome gate does not send them to onboarding for that reason.
 *
 *   RBN-01  RED-BEFORE  with a removed-business notice pending, the shell's notice says "You no longer have access to
 *                       <name>" and lists the businesses the member still has, each one openable
 *   RBN-02  RED-BEFORE  a notice announced after the shell mounted appears without a reload
 *   RBN-03  RED-BEFORE  dismissing the notice clears it (workspace) and removes it from the screen
 *   RBN-04  RED-BEFORE  a notice without a name still says the member lost access to a business
 * The gate's cases (RBN-05..07) are in hooks/__tests__/use-genome-gate.removed-notice.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

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

const ws = vi.hoisted(() => ({
  businessId: "biz-members-own" as string | null,
  notice: null as { id: string; name: string | null } | null,
  businesses: [] as Array<{ id: string; name: string }>,
  selectBusiness: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("@/lib/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspace")>()),
  getStoredBusinessId: () => ws.businessId,
  listMyBusinesses: async () => ws.businesses,
  selectBusiness: (id: string) => ws.selectBusiness(id),
}));
// The notice lives in its own module (lib/removed-business-notice.ts), so screens that mock @/lib/workspace are
// unaffected by it.
vi.mock("@/lib/removed-business-notice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/removed-business-notice")>()),
  getRemovedBusinessNotice: () => ws.notice,
  dismissRemovedBusinessNotice: () => { ws.dismiss(); ws.notice = null; },
}));

import { RemovedBusinessNotice } from "@/components/layout/removed-business-notice";

const OWN = { id: "biz-members-own", name: "Member's Own" };

beforeEach(() => {
  ws.businessId = OWN.id;
  ws.notice = null;
  ws.businesses = [OWN];
  ws.selectBusiness.mockClear();
  ws.dismiss.mockClear();
  nav.replace.mockClear();
});
afterEach(() => cleanup());

describe("SWP-REMOVED-MEMBER-NOTICE: the shell's notice", () => {
  it("RBN-01 RED-BEFORE: names the lost business and lists the ones the member still has", async () => {
    ws.notice = { id: "biz-owners-salon", name: "Owner's Salon" };
    render(<RemovedBusinessNotice />);
    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent(/you no longer have access to owner's salon/i);
    const open = await screen.findByRole("button", { name: /open member's own/i });
    fireEvent.click(open);
    expect(ws.selectBusiness).toHaveBeenCalledWith(OWN.id);
  });

  it("RBN-02 RED-BEFORE: a notice announced after the shell mounted appears without a reload", async () => {
    render(<RemovedBusinessNotice />);
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => {
      ws.notice = { id: "biz-owners-salon", name: "Owner's Salon" };
      window.dispatchEvent(new CustomEvent("kf:business-removed", { detail: ws.notice }));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(/owner's salon/i);
  });

  it("RBN-03 RED-BEFORE: dismissing clears it and removes it from the screen", async () => {
    ws.notice = { id: "biz-owners-salon", name: "Owner's Salon" };
    render(<RemovedBusinessNotice />);
    fireEvent.click(await screen.findByRole("button", { name: /dismiss/i }));
    expect(ws.dismiss).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("RBN-04 RED-BEFORE: a notice without a name still says the member lost access to a business", async () => {
    ws.notice = { id: "biz-owners-salon", name: null };
    render(<RemovedBusinessNotice />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/you no longer have access to a business/i);
  });
});
