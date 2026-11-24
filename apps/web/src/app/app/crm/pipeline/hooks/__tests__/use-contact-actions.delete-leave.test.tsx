/**
 * FU-CONTACT-DELETE-LEAVE (from the SWP-CONTACT-DETAIL acceptance review; corrected by pre-flight, D-274 A3): a single
 * contact delete is sent, once, whatever the owner does during its Undo window.
 *
 * handleDeleteContact (use-contact-actions.ts) hides the customer, shows "Contact deleted" with Undo for 5 s and sends
 * the DELETE after 5.5 s from ONE shared timer:
 *  - leaving the page in that window cleared the timer on unmount: the DELETE was never sent and the customer came
 *    back on the next load;
 *  - a second delete in that window cleared the first one's timer: the first DELETE was never sent;
 *  - the first toast's Undo then cleared the shared timer, which was the second delete's: the second customer stayed
 *    hidden and was never deleted.
 *
 *   DL-01  RED-BEFORE  delete, then leave within 5.5 s: the DELETE is sent once (on leaving), not dropped
 *   DL-02  RED-BEFORE  delete A, then B within the window: both DELETEs are sent, once each
 *   DL-03  RED-BEFORE  delete A, delete B, Undo on A: A is restored and not deleted; B is still deleted
 *   DL-04  RED-BEFORE  leaving dismisses the pending delete's toast (its Undo can no longer act on a sent delete)
 *   DL-05  control     delete, Undo: nothing is sent and the customer is back
 *   DL-06  control     delete, wait out the window: sent once; leaving afterwards sends nothing more
 * Review round (acceptance MINOR-2/3, confirmation M1):
 *   DL-07  pin         the same customer deleted twice in one go: one toast, one DELETE
 *   DL-08  pin         Undo pressed after leaving (the delete was sent): nothing is restored, nothing more is sent
 *   DL-09  RED-AT-23d25b88  an old toast's Undo never cancels a newer delete of the same customer
 *   DL-10  RED-AT-23d25b88  Undo pressed after the delete was sent says so: restore it from Trash
 *   DL-11  RED-AT-27584c0c  (confirmation N1) a DELETE that failed restored the row: a later Undo does not send the
 *                       owner to Trash, where the customer is not
 *
 * The hook runs for real; the client's deleteContact, the toasts and the router are stubbed; timers are fake.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { act, renderHook, cleanup } from "@testing-library/react";
import type { Contact } from "@/lib/client";

const client = vi.hoisted(() => ({ deleteContact: vi.fn(async (_contactId: string, _businessId?: string) => ({ data: null, error: null })) }));
vi.mock("@/lib/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/client")>()), deleteContact: client.deleteContact }));

/** Every toast shown: its message, options and id, so a test can press its Undo. */
const toasts = vi.hoisted(() => ({ shown: [] as Array<{ id: string; message: string; options?: { action?: { onClick: () => void } } }>, dismissed: [] as unknown[], seq: 0 }));
vi.mock("sonner", () => ({
  toast: Object.assign(
    vi.fn((message: string, options?: { action?: { onClick: () => void } }) => {
      const id = `t${++toasts.seq}`;
      toasts.shown.push({ id, message, options });
      return id;
    }),
    {
      success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn(), loading: vi.fn(),
      dismiss: vi.fn((id?: unknown) => { toasts.dismissed.push(id); }),
    },
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }) }));

import { useContactActions } from "../use-contact-actions";
import { toast } from "sonner";

const BIZ = "biz_dl";
const A = { id: "c_a", firstName: "Ann", lastName: "Able" } as unknown as Contact;
const B = { id: "c_b", firstName: "Ben", lastName: "Baker" } as unknown as Contact;

function useHarness() {
  const [contacts, setContacts] = useState<Contact[]>([A, B]);
  const actions = useContactActions({
    businessId: BIZ,
    contacts,
    setContacts,
    selectedContactId: null,
    setSelectedContactId: () => {},
    contactDetail: null,
    setContactDetail: () => {},
    selectedIds: new Set<string>(),
    setSelectedIds: () => {},
    setSelectMode: () => {},
    setShowMobileDetail: () => {},
    loadContacts: async () => {},
    loadDetail: async () => {},
    loadFlowData: async () => {},
  });
  return { contacts, actions };
}

const sent = () => client.deleteContact.mock.calls.map((call) => call[0]);
const undoFor = (index: number) => toasts.shown.filter((t) => t.message === "Contact deleted")[index]!.options!.action!.onClick;

beforeEach(() => {
  vi.useFakeTimers();
  client.deleteContact.mockClear();
  toasts.shown.length = 0;
  toasts.dismissed.length = 0;
  toasts.seq = 0;
  for (const fn of [toast, toast.success, toast.error, toast.info, toast.dismiss]) vi.mocked(fn).mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("FU-CONTACT-DELETE-LEAVE: a single delete is sent once, whatever happens in its Undo window", () => {
  it("DL-01 RED-BEFORE: delete, then leave within 5.5 s: the DELETE is still sent, once", async () => {
    const { result, unmount } = renderHook(() => useHarness());
    await act(async () => { await result.current.actions.handleDeleteContact(A); });
    expect(result.current.contacts.map((c) => c.id)).toEqual(["c_b"]);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    unmount();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent()).toEqual(["c_a"]);
  });

  it("DL-02 RED-BEFORE: delete A, then B within the window: both are sent, once each", async () => {
    const { result } = renderHook(() => useHarness());
    await act(async () => { await result.current.actions.handleDeleteContact(A); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await act(async () => { await result.current.actions.handleDeleteContact(B); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(sent().sort()).toEqual(["c_a", "c_b"]);
  });

  it("DL-03 RED-BEFORE: delete A, delete B, Undo on A: A is back and kept, B is still deleted", async () => {
    const { result } = renderHook(() => useHarness());
    await act(async () => { await result.current.actions.handleDeleteContact(A); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await act(async () => { await result.current.actions.handleDeleteContact(B); });
    act(() => { undoFor(0)(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(sent()).toEqual(["c_b"]);
    expect(result.current.contacts.map((c) => c.id)).toEqual(["c_a"]);
  });

  it("DL-04 RED-BEFORE: leaving dismisses the pending delete's toast", async () => {
    const { result, unmount } = renderHook(() => useHarness());
    await act(async () => { await result.current.actions.handleDeleteContact(A); });
    const shown = toasts.shown.find((t) => t.message === "Contact deleted")!;
    unmount();
    expect(toasts.dismissed).toContain(shown.id);
  });

  it("DL-05 control: delete, Undo: nothing is sent and the customer is back", async () => {
    const { result } = renderHook(() => useHarness());
    await act(async () => { await result.current.actions.handleDeleteContact(A); });
    act(() => { undoFor(0)(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(sent()).toEqual([]);
    expect(result.current.contacts.map((c) => c.id).sort()).toEqual(["c_a", "c_b"]);
  });

  it("DL-06 control: delete, wait out the window: sent once; leaving afterwards sends nothing more", async () => {
    const { result, unmount } = renderHook(() => useHarness());
    await act(async () => { await result.current.actions.handleDeleteContact(A); });
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(sent()).toEqual(["c_a"]);
    unmount();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent()).toEqual(["c_a"]);
  });

  it("DL-07 pin: the same customer deleted twice in one go: one toast, one DELETE", async () => {
    const { result } = renderHook(() => useHarness());
    await act(async () => {
      await result.current.actions.handleDeleteContact(A);
      await result.current.actions.handleDeleteContact(A);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(toasts.shown.filter((t) => t.message === "Contact deleted")).toHaveLength(1);
    expect(sent()).toEqual(["c_a"]);
  });

  it("DL-08 pin: Undo pressed after leaving restores nothing and sends nothing more", async () => {
    const { result, unmount } = renderHook(() => useHarness());
    await act(async () => { await result.current.actions.handleDeleteContact(A); });
    unmount();
    undoFor(0)();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent()).toEqual(["c_a"]);
  });

  it("DL-09 RED-AT-23d25b88: an old toast's Undo never cancels a newer delete of the same customer", async () => {
    const { result } = renderHook(() => useHarness());
    await act(async () => { await result.current.actions.handleDeleteContact(A); });
    act(() => { undoFor(0)(); });
    await act(async () => { await result.current.actions.handleDeleteContact(A); });
    // The first toast's Undo, pressed again (sonner closes a toast on its action, but nothing here relies on it).
    act(() => { undoFor(0)(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(sent()).toEqual(["c_a"]);
  });

  it("DL-10 RED-AT-23d25b88: Undo pressed after the delete was sent says to restore it from Trash", async () => {
    const { result } = renderHook(() => useHarness());
    await act(async () => { await result.current.actions.handleDeleteContact(A); });
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(sent()).toEqual(["c_a"]);
    act(() => { undoFor(0)(); });
    expect(result.current.contacts.map((c) => c.id)).toEqual(["c_b"]);
    expect(vi.mocked(toast.info).mock.calls.map((c) => String(c[0]))).toEqual([expect.stringMatching(/trash/i)]);
  });

  it("DL-11 RED-AT-27584c0c: after a failed DELETE restored the row, Undo does not point to Trash", async () => {
    client.deleteContact.mockRejectedValueOnce(new Error("refused"));
    const { result } = renderHook(() => useHarness());
    await act(async () => { await result.current.actions.handleDeleteContact(A); });
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(result.current.contacts.map((c) => c.id).sort()).toEqual(["c_a", "c_b"]);
    act(() => { undoFor(0)(); });
    expect(vi.mocked(toast.info)).not.toHaveBeenCalled();
    expect(result.current.contacts.map((c) => c.id).sort()).toEqual(["c_a", "c_b"]);
  });
});
