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
 *   POT-04  my-access alone decides when the list says nothing: a member with crm read or none and no accesses yet
 *           is not offered Grant Access
 *   POT-05  a Grant form already open closes once the member turns out to be below crm write
 *   POT-06  a business switch, or a read that fails, never leaves the previous business's accesses (and their URLs) on
 *           screen; a refusal and a failure each say so
 *   POT-07  a refused Grant says so, instead of leaving the form open in silence
 *   POT-08  an enabled access past its expiry shows as expired, with no URL, to an editor too
 *   POT-09  while the new business's read is pending after a switch, the previous business's accesses are not shown
 *   POT-10  an answer for a business no longer selected, arriving late, never replaces the current business's list
 *   POT-11  a Grant form opened in one business is not shown in another
 *   POT-12  Loading never sticks: a Grant finishing after a switch, or a switch to no business while a read runs
 *   POT-13  for the same business, only the latest read applies (A, B, A with the answers arriving newest first)
 *   POT-14  the Grant form starts empty: its Contact ID and error are cleared by Cancel, by reopening and by a switch
 *   POT-15  a Grant or a Revoke that succeeds reads the list again
 *   POT-16  a Grant finishing in A after a switch to B, while B's read is still running, neither reads A again nor
 *           keeps B's answer from landing
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const portal = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), revoke: vi.fn() }));
const member = vi.hoisted(() => ({ levels: null as Record<string, string> | null, businessId: "biz_pot" }));

vi.mock("@/lib/portal", () => ({
  listPortalAccess: (...a: unknown[]) => portal.list(...a),
  createPortalAccess: (...a: unknown[]) => portal.create(...a),
  revokePortalAccess: (...a: unknown[]) => portal.revoke(...a),
}));
vi.mock("../../control-tower/components/use-control-tower-data", () => ({
  useControlTowerData: () => ({ businessId: member.businessId }),
}));
vi.mock("@/hooks/use-app-layout", () => ({
  useMemberModuleLevels: () => member.levels,
}));

import PortalPage from "../page";

/** Far in the future, so an access is unexpired whatever the day the suite runs (expiry pins use explicit dates). */
const base = { expiresAt: "2099-01-01T00:00:00.000Z", settings: { invoices: true }, lastAccessedAt: null, accessCount: 3, createdAt: "2026-11-01T00:00:00.000Z" };
const revokeButtons = (container: HTMLElement) => container.querySelectorAll('button [class*="lucide-trash"]');

beforeEach(() => {
  portal.list.mockReset();
  portal.create.mockReset();
  portal.revoke.mockReset();
  member.levels = null;
  member.businessId = "biz_pot";
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

  it("POT-04 my-access alone hides Grant Access from a member below crm write when the list is empty", async () => {
    for (const crm of ["read", "none"]) {
      member.levels = { crm };
      portal.list.mockResolvedValue({ data: [], error: null });
      render(<PortalPage />);
      await screen.findByText("No portal access granted yet");
      expect(screen.queryByRole("button", { name: /Grant Access/ }), crm).toBeNull();
      cleanup();
    }
    member.levels = { crm: "admin" };
    portal.list.mockResolvedValue({ data: [], error: null });
    render(<PortalPage />);
    await screen.findByText("No portal access granted yet");
    expect(screen.getByRole("button", { name: /Grant Access/ })).toBeInTheDocument();
  });

  it("POT-05 a Grant form already open closes once the member turns out to be below crm write", async () => {
    portal.list.mockResolvedValue({ data: [], error: null });
    const view = render(<PortalPage />);
    await screen.findByText("No portal access granted yet");
    fireEvent.click(screen.getByRole("button", { name: /Grant Access/ }));
    expect(screen.getByText("Grant Portal Access")).toBeInTheDocument();

    member.levels = { crm: "read" };
    view.rerender(<PortalPage />);
    expect(screen.queryByText("Grant Portal Access")).toBeNull();
    expect(screen.queryByPlaceholderText("Contact ID")).toBeNull();
  });

  it("POT-06 a business switch or a failed read never leaves the previous business's accesses on screen", async () => {
    member.levels = { crm: "write" };
    portal.list.mockImplementation(async (businessId: string) =>
      businessId === "biz_a"
        ? { data: [{ ...base, id: "pa_a", contactId: "contact_of_a", token: "tok_of_a", enabled: true }], error: null }
        : { data: null, error: "Insufficient permissions: crm requires read access (you have none)", status: 403 },
    );
    member.businessId = "biz_a";
    const view = render(<PortalPage />);
    await screen.findByText("contact_of_a");

    member.businessId = "biz_b";
    member.levels = { crm: "none" };
    view.rerender(<PortalPage />);
    expect(await screen.findByText("You don't have access to the client portal in this business.")).toBeInTheDocument();
    expect(screen.queryByText("contact_of_a")).toBeNull();
    expect(view.container.textContent).not.toContain("tok_of_a");
    cleanup();

    // A read that fails for another reason (offline, 5xx) says so and shows nothing old either.
    member.businessId = "biz_a";
    member.levels = { crm: "write" };
    portal.list.mockResolvedValueOnce({ data: [{ ...base, id: "pa_a", contactId: "contact_of_a", token: "tok_of_a", enabled: true }], error: null });
    const again = render(<PortalPage />);
    await screen.findByText("contact_of_a");
    portal.list.mockResolvedValueOnce({ data: null, error: "Service unavailable", status: 503 });
    member.businessId = "biz_c";
    again.rerender(<PortalPage />);
    expect(await screen.findByText("Couldn't load portal access. Try again.")).toBeInTheDocument();
    expect(screen.queryByText("contact_of_a")).toBeNull();
  });

  it("POT-07 a refused Grant says so", async () => {
    portal.list.mockResolvedValue({ data: [], error: null });
    portal.create.mockResolvedValue({ data: null, error: "Insufficient permissions: crm requires write access (you have read)", status: 403 });
    render(<PortalPage />);
    await screen.findByText("No portal access granted yet");
    fireEvent.click(screen.getByRole("button", { name: /Grant Access/ }));
    fireEvent.change(screen.getByPlaceholderText("Contact ID"), { target: { value: "contact_x" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Grant$/ })));
    expect(await screen.findByText("You can't grant portal access.")).toBeInTheDocument();
  });

  it("POT-08 an enabled access past its expiry shows as expired with no URL, to an editor too", async () => {
    member.levels = { crm: "admin" };
    portal.list.mockResolvedValue({
      data: [
        { ...base, id: "pa_old", contactId: "contact_expired", token: "tok_expired_xyz", enabled: true, expiresAt: "2020-01-01T00:00:00.000Z" },
        { ...base, id: "pa_new", contactId: "contact_live", token: "tok_live_abc", enabled: true },
      ],
      error: null,
    });
    const { container } = render(<PortalPage />);
    await screen.findByText("contact_expired");
    expect(container.textContent).not.toContain("tok_expired_xyz");
    expect(screen.getByText("Link expired")).toBeInTheDocument();
    expect(screen.getByText(`${window.location.origin}/portal/tok_live_abc`)).toBeInTheDocument();
  });

  const accessOf = (business: string) => ({
    data: [{ ...base, id: `pa_${business}`, contactId: `contact_of_${business}`, token: `tok_of_${business}`, enabled: true }],
    error: null,
  });

  it("POT-09 while the new business's read is pending after a switch, the previous business's accesses are not shown", async () => {
    member.levels = { crm: "write" };
    const pending: Array<(v: unknown) => void> = [];
    portal.list.mockImplementation((business: string) =>
      business === "biz_a" ? Promise.resolve(accessOf("biz_a")) : new Promise((resolve) => pending.push(resolve)),
    );
    member.businessId = "biz_a";
    const view = render(<PortalPage />);
    await screen.findByText("contact_of_biz_a");

    member.businessId = "biz_b";
    view.rerender(<PortalPage />);
    // The very render of the switch, before biz_b's read has even started.
    expect(screen.queryByText("contact_of_biz_a"), "biz_a's access is not shown in the switch's render").toBeNull();
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(screen.queryByText("contact_of_biz_a"), "biz_a's access is not shown under biz_b").toBeNull();
    expect(view.container.textContent).not.toContain("tok_of_biz_a");
    await act(async () => pending[0](accessOf("biz_b")));
    expect(await screen.findByText("contact_of_biz_b")).toBeInTheDocument();
  });

  it("POT-10 a late answer for a business no longer selected never replaces the current business's list", async () => {
    member.levels = { crm: "write" };
    const pendingA: Array<(v: unknown) => void> = [];
    portal.list.mockImplementation((business: string) =>
      business === "biz_a" ? new Promise((resolve) => pendingA.push(resolve)) : Promise.resolve(accessOf("biz_b")),
    );
    member.businessId = "biz_a";
    const view = render(<PortalPage />);
    await waitFor(() => expect(pendingA).toHaveLength(1));

    member.businessId = "biz_b";
    view.rerender(<PortalPage />);
    expect(await screen.findByText("contact_of_biz_b")).toBeInTheDocument();

    await act(async () => pendingA[0](accessOf("biz_a")));
    expect(screen.getByText("contact_of_biz_b"), "biz_b's list stays").toBeInTheDocument();
    expect(screen.queryByText("contact_of_biz_a")).toBeNull();
  });

  it("POT-11 a Grant form opened in one business is not shown in another", async () => {
    member.levels = { crm: "write" };
    portal.list.mockImplementation(async (business: string) => accessOf(business));
    member.businessId = "biz_a";
    const view = render(<PortalPage />);
    await screen.findByText("contact_of_biz_a");
    fireEvent.click(screen.getByRole("button", { name: /Grant Access/ }));
    expect(screen.getByPlaceholderText("Contact ID")).toBeInTheDocument();
    member.businessId = "biz_b";
    view.rerender(<PortalPage />);
    await screen.findByText("contact_of_biz_b");
    expect(screen.queryByPlaceholderText("Contact ID")).toBeNull();
  });

  it("POT-12 Loading never sticks after a Grant that finishes after a switch, or a switch to no business", async () => {
    member.levels = { crm: "write" };
    let finishGrant: (v: unknown) => void = () => undefined;
    portal.create.mockImplementation(() => new Promise((resolve) => (finishGrant = resolve)));
    portal.list.mockImplementation(async (business: string) => accessOf(business));
    member.businessId = "biz_a";
    const view = render(<PortalPage />);
    await screen.findByText("contact_of_biz_a");
    fireEvent.click(screen.getByRole("button", { name: /Grant Access/ }));
    fireEvent.change(screen.getByPlaceholderText("Contact ID"), { target: { value: "contact_new" } });
    fireEvent.click(screen.getByRole("button", { name: /^Grant$/ }));

    member.businessId = "biz_b";
    view.rerender(<PortalPage />);
    await screen.findByText("contact_of_biz_b");
    await act(async () => finishGrant({ data: { id: "pa_new" }, error: null }));
    expect(screen.queryByText("Loading...")).toBeNull();
    expect(screen.getByText("contact_of_biz_b")).toBeInTheDocument();
    cleanup();

    // A switch to no business while a read runs.
    const pending: Array<(v: unknown) => void> = [];
    portal.list.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    member.businessId = "biz_a";
    const again = render(<PortalPage />);
    await waitFor(() => expect(pending).toHaveLength(1));
    member.businessId = "";
    again.rerender(<PortalPage />);
    await act(async () => pending[0](accessOf("biz_a")));
    expect(screen.queryByText("Loading...")).toBeNull();
    expect(screen.queryByText("contact_of_biz_a")).toBeNull();
  });

  it("POT-13 for the same business only the latest read applies", async () => {
    member.levels = { crm: "write" };
    const pending: Array<{ business: string; resolve: (v: unknown) => void }> = [];
    portal.list.mockImplementation((business: string) => new Promise((resolve) => pending.push({ business, resolve })));
    member.businessId = "biz_a";
    const view = render(<PortalPage />);
    await waitFor(() => expect(pending).toHaveLength(1));
    member.businessId = "biz_b";
    view.rerender(<PortalPage />);
    await waitFor(() => expect(pending).toHaveLength(2));
    member.businessId = "biz_a";
    view.rerender(<PortalPage />);
    await waitFor(() => expect(pending).toHaveLength(3));

    const newer = { data: [{ ...base, id: "pa_new", contactId: "contact_newer_read", token: "tok_newer", enabled: true }], error: null };
    const older = { data: [{ ...base, id: "pa_old", contactId: "contact_older_read", token: "tok_older", enabled: true }], error: null };
    await act(async () => pending[2].resolve(newer));
    await act(async () => pending[1].resolve(accessOf("biz_b")));
    await act(async () => pending[0].resolve(older));
    expect(screen.getByText("contact_newer_read")).toBeInTheDocument();
    expect(screen.queryByText("contact_older_read"), "the older read does not overwrite the newer").toBeNull();
  });

  it("POT-14 the Grant form starts empty: Cancel, reopening and a switch clear its Contact ID and error", async () => {
    member.levels = { crm: "write" };
    portal.list.mockImplementation(async (business: string) => accessOf(business));
    portal.create.mockResolvedValue({ data: null, error: "Insufficient permissions", status: 403 });
    member.businessId = "biz_a";
    const view = render(<PortalPage />);
    await screen.findByText("contact_of_biz_a");
    fireEvent.click(screen.getByRole("button", { name: /Grant Access/ }));
    fireEvent.change(screen.getByPlaceholderText("Contact ID"), { target: { value: "contact_typed" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Grant$/ })));
    expect(await screen.findByText("You can't grant portal access.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
    fireEvent.click(screen.getByRole("button", { name: /Grant Access/ }));
    expect((screen.getByPlaceholderText("Contact ID") as HTMLInputElement).value, "reopened after Cancel").toBe("");
    expect(screen.queryByText("You can't grant portal access.")).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("Contact ID"), { target: { value: "contact_typed_again" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Grant$/ })));
    await screen.findByText("You can't grant portal access.");
    member.businessId = "biz_b";
    view.rerender(<PortalPage />);
    await screen.findByText("contact_of_biz_b");
    fireEvent.click(screen.getByRole("button", { name: /Grant Access/ }));
    expect((screen.getByPlaceholderText("Contact ID") as HTMLInputElement).value, "another business").toBe("");
    expect(screen.queryByText("You can't grant portal access.")).toBeNull();
  });

  it("POT-15 a Grant or a Revoke that succeeds reads the list again", async () => {
    member.levels = { crm: "write" };
    portal.list.mockResolvedValueOnce(accessOf("biz_pot")).mockResolvedValue({
      data: [...accessOf("biz_pot").data, { ...base, id: "pa_granted", contactId: "contact_granted", token: "tok_granted", enabled: true }],
      error: null,
    });
    portal.create.mockResolvedValue({ data: { id: "pa_granted" }, error: null });
    const { container } = render(<PortalPage />);
    await screen.findByText("contact_of_biz_pot");
    fireEvent.click(screen.getByRole("button", { name: /Grant Access/ }));
    fireEvent.change(screen.getByPlaceholderText("Contact ID"), { target: { value: "contact_granted" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Grant$/ })));
    expect(await screen.findByText("contact_granted")).toBeInTheDocument();
    const readsAfterGrant = portal.list.mock.calls.length;

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      portal.revoke.mockResolvedValue({ data: { id: "pa_granted" }, error: null });
      portal.list.mockResolvedValue(accessOf("biz_pot"));
      const revoke = container.querySelectorAll('button [class*="lucide-trash"]')[1].closest("button") as HTMLButtonElement;
      await act(async () => fireEvent.click(revoke));
      await waitFor(() => expect(portal.list.mock.calls.length).toBe(readsAfterGrant + 1));
      await waitFor(() => expect(screen.queryByText("contact_granted")).toBeNull());
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("POT-16 a Grant finishing in A after a switch, while B's read runs, neither reads A again nor blocks B's answer", async () => {
    member.levels = { crm: "write" };
    let finishGrant: (v: unknown) => void = () => undefined;
    portal.create.mockImplementation(() => new Promise((resolve) => (finishGrant = resolve)));
    const pendingB: Array<(v: unknown) => void> = [];
    portal.list.mockImplementation((business: string) =>
      business === "biz_a" ? Promise.resolve(accessOf("biz_a")) : new Promise((resolve) => pendingB.push(resolve)),
    );
    member.businessId = "biz_a";
    const view = render(<PortalPage />);
    await screen.findByText("contact_of_biz_a");
    fireEvent.click(screen.getByRole("button", { name: /Grant Access/ }));
    fireEvent.change(screen.getByPlaceholderText("Contact ID"), { target: { value: "contact_new" } });
    fireEvent.click(screen.getByRole("button", { name: /^Grant$/ }));

    member.businessId = "biz_b";
    view.rerender(<PortalPage />);
    await waitFor(() => expect(pendingB).toHaveLength(1));
    const readsOfA = portal.list.mock.calls.filter(([b]) => b === "biz_a").length;
    await act(async () => finishGrant({ data: { id: "pa_new" }, error: null }));
    expect(portal.list.mock.calls.filter(([b]) => b === "biz_a").length, "A is not read again under B").toBe(readsOfA);

    await act(async () => pendingB[0](accessOf("biz_b")));
    expect(await screen.findByText("contact_of_biz_b")).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).toBeNull();
  });
});
