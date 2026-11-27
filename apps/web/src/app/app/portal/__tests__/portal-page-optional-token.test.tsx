/**
 * P232 FU-PORTAL-WEB-OPTIONAL-TOKEN (follow-up of P145 FU-SECRET-READS-PORTAL-INTEGRATION): the Client Portal page
 * when the server leaves the portal token out.
 *
 * P145 gates GET /portal/businesses/:businessId/access on crm read and, for a member below crm write, answers each
 * access without its `token` and with `hasLiveLink` instead (the token is the customer's portal secret). The page
 * typed `token` as required and rendered `${origin}/portal/${a.token}` for every enabled access, so such a member saw
 * "/portal/undefined"; it also offered Grant Access and Revoke, which the server refuses below crm write.
 *
 *   POT-01  an access without a token never shows a portal URL ("/portal/undefined"); an enabled one whose link is
 *           live says "Portal link active", read-only, with no URL
 *   POT-02  a member below crm write (my-access says crm read, or the server answered the read-only view) is not
 *           offered Grant Access or Revoke
 *   POT-03  with the token present (a crm write member) the page is unchanged: the URL of each enabled access,
 *           none for a revoked one, Grant Access and Revoke
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const portal = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), revoke: vi.fn() }));
const member = vi.hoisted(() => ({ levels: null as Record<string, string> | null }));

vi.mock("@/lib/portal", () => ({
  listPortalAccess: (...a: unknown[]) => portal.list(...a),
  createPortalAccess: (...a: unknown[]) => portal.create(...a),
  revokePortalAccess: (...a: unknown[]) => portal.revoke(...a),
}));
vi.mock("../../control-tower/components/use-control-tower-data", () => ({
  useControlTowerData: () => ({ businessId: "biz_pot" }),
}));
vi.mock("@/hooks/use-app-layout", () => ({
  useMemberModuleLevels: () => member.levels,
}));

import PortalPage from "../page";

const base = { expiresAt: "2027-01-01T00:00:00.000Z", settings: { invoices: true }, lastAccessedAt: null, accessCount: 3, createdAt: "2026-11-01T00:00:00.000Z" };
const revokeButtons = (container: HTMLElement) => container.querySelectorAll('button [class*="lucide-trash"]');

beforeEach(() => {
  portal.list.mockReset();
  member.levels = null;
});
afterEach(cleanup);

describe("P232: the Client Portal page without the portal token", () => {
  it("POT-01 an access without a token never shows a portal URL; a live one says Portal link active", async () => {
    member.levels = { crm: "read" };
    portal.list.mockResolvedValue({
      data: [
        { ...base, id: "pa_1", contactId: "contact_live", enabled: true, hasLiveLink: true },
        { ...base, id: "pa_2", contactId: "contact_expired", enabled: true, hasLiveLink: false },
        { ...base, id: "pa_3", contactId: "contact_revoked", enabled: false, hasLiveLink: false },
      ],
      error: null,
    });
    const { container } = render(<PortalPage />);
    await screen.findByText("contact_live");
    expect(container.textContent).not.toContain("/portal/undefined");
    expect(container.textContent).not.toContain("/portal/");
    expect(screen.getAllByText("Portal link active")).toHaveLength(1);
  });

  it("POT-02 a member below crm write is not offered Grant Access or Revoke", async () => {
    const readOnlyView = { data: [{ ...base, id: "pa_1", contactId: "contact_live", enabled: true, hasLiveLink: true }], error: null };

    // my-access says crm read.
    member.levels = { crm: "read" };
    portal.list.mockResolvedValue(readOnlyView);
    let view = render(<PortalPage />);
    await screen.findByText("contact_live");
    expect(screen.queryByRole("button", { name: /Grant Access/ })).toBeNull();
    expect(revokeButtons(view.container)).toHaveLength(0);
    cleanup();

    // my-access not known yet, but the server answered the read-only view (no token, hasLiveLink).
    member.levels = null;
    view = render(<PortalPage />);
    await screen.findByText("contact_live");
    await waitFor(() => expect(screen.queryByRole("button", { name: /Grant Access/ })).toBeNull());
    expect(revokeButtons(view.container)).toHaveLength(0);
  });

  it("POT-03 with the token present the page is unchanged", async () => {
    member.levels = { crm: "write" };
    portal.list.mockResolvedValue({
      data: [
        { ...base, id: "pa_1", contactId: "contact_live", token: "tok_live_abc", enabled: true },
        { ...base, id: "pa_3", contactId: "contact_revoked", token: "tok_revoked_def", enabled: false },
      ],
      error: null,
    });
    const { container } = render(<PortalPage />);
    await screen.findByText("contact_live");
    expect(screen.getByText(`${window.location.origin}/portal/tok_live_abc`)).toBeInTheDocument();
    expect(container.textContent).not.toContain("tok_revoked_def");
    expect(screen.queryByText("Portal link active")).toBeNull();
    expect(screen.getByRole("button", { name: /Grant Access/ })).toBeInTheDocument();
    expect(revokeButtons(container)).toHaveLength(2);

    // Unknown levels (no my-access answer) with tokens present: the write controls are still offered.
    cleanup();
    member.levels = null;
    const again = render(<PortalPage />);
    await screen.findByText("contact_live");
    expect(screen.getByRole("button", { name: /Grant Access/ })).toBeInTheDocument();
    expect(revokeButtons(again.container)).toHaveLength(2);
  });
});
