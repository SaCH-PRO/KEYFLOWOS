/**
 * FU-BULK-DELETE-UNDO, the web half (owner ruling D-277b, 2026-11-24, #80 7144117000): "bulk delete gets Undo by
 * restore. A bulk delete is sent at once, then a toast offers Undo, which restores exactly those customers from Trash
 * in one call. There is no delayed send, so leaving the page can never drop it."
 *
 * The customers screen has two live bulk deletes, and both must behave the same:
 *   - the list, focus and kanban views: BulkActionBar -> useContactActions.handleBulkDelete (the screen's
 *     ConfirmDialog runs confirmState.action);
 *   - the table view: DatabaseBulkBar -> useDatabaseState.handleBulkDelete (ContactsDatabase's ConfirmDialog runs
 *     confirmState.onConfirm).
 * (components/contacts/ai-search-bar.tsx names a "bulk_delete" command, but AiSearchBar is mounted nowhere and the
 * command only forwards to an onExecuteCommand no screen passes: it sends nothing.)
 *
 * The server: DELETE /crm/businesses/:b/contacts/bulk { contactIds } soft-deletes the ids this member may delete and
 * answers { deleted: n } (not which ids); POST /api/businesses/:b/trash/contact/bulk-restore { ids } (P37 server half,
 * 61e50c0f) answers { restored, failed, restoredCount, failedCount } and a partial failure does not abort siblings.
 * So Undo is offered only when the web knows exactly which ids were deleted: all of them (deleted === ids sent), or
 * the ids the answer names in an optional `deletedIds`. It never guesses.
 *
 * The real hooks and the real client run; fetch is stubbed at the network edge and sonner is replaced by spies so
 * the toast's Undo action can be pressed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { act, cleanup, renderHook } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const routerStub = vi.hoisted(() => ({
  push: () => {}, replace: () => {}, prefetch: () => {}, back: () => {}, forward: () => {}, refresh: () => {},
}));
vi.mock("next/navigation", () => ({
  useRouter: () => routerStub,
  usePathname: () => "/app/crm/contacts",
  useSearchParams: () => new URLSearchParams(),
}));

import { toast } from "sonner";
import { useContactActions } from "../use-contact-actions";
import { useDatabaseState } from "../use-database-state";
import type { Contact, ContactDetail } from "@/lib/client";
import type { LocalContact } from "@/lib/contacts-db";

const BIZ = "biz_p37_undo";
const DELETE_PATH = `/crm/businesses/${BIZ}/contacts/bulk`;
const RESTORE_PATH = `/api/businesses/${BIZ}/trash/contact/bulk-restore`;
const SCOPE_REFUSAL = "Insufficient permissions: crm requires write access (you have read)";

type Answer = { status: number; body: unknown };
type Sent = { method: string; path: string; body: unknown };

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 400 ? "Error" : "OK",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  } as unknown as Response;
}

const restoredAll = (ids: string[]): Answer => ({
  status: 200,
  body: { model: "contact", restored: ids, failed: [], restoredCount: ids.length, failedCount: 0 },
});

function installServer(answers: { del: Answer; restore?: Answer }) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      const url = new URL(raw, "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
      sent.push({ method, path: url.pathname, body });
      if (method === "DELETE" && url.pathname.endsWith(DELETE_PATH)) return jsonResponse(answers.del.status, answers.del.body);
      if (method === "POST" && url.pathname.endsWith(RESTORE_PATH)) {
        const a = answers.restore ?? restoredAll(((body as { ids?: string[] })?.ids ?? []));
        return jsonResponse(a.status, a.body);
      }
      if (method === "GET" && /\/contacts$/.test(url.pathname)) return jsonResponse(200, { contacts: [], nextCursor: null, hasMore: false });
      if (method === "GET") return jsonResponse(200, []);
      return jsonResponse(200, {});
    }),
  );
  return {
    sent,
    deletes: () => sent.filter((s) => s.method === "DELETE" && s.path.endsWith(DELETE_PATH)),
    restores: () => sent.filter((s) => s.method === "POST" && s.path.endsWith(RESTORE_PATH)),
  };
}

type ToastCall = { kind: string; title: string; opts: Record<string, unknown> | undefined };

function toastCalls(): ToastCall[] {
  const t = toast as unknown as Record<string, { mock: { calls: unknown[][] } }> & { mock: { calls: unknown[][] } };
  const kinds: Array<[string, { mock: { calls: unknown[][] } }]> = [
    ["toast", t], ["success", t.success], ["error", t.error], ["info", t.info], ["warning", t.warning], ["message", t.message],
  ];
  return kinds.flatMap(([kind, fn]) =>
    fn.mock.calls.map((args) => ({
      kind,
      title: typeof args[0] === "string" ? args[0] : "",
      opts: args[1] && typeof args[1] === "object" ? (args[1] as Record<string, unknown>) : undefined,
    })),
  );
}

/** Every word a toast was shown with: its title and its description. */
function shownWords(): string[] {
  return toastCalls().flatMap((c) => [c.title, typeof c.opts?.description === "string" ? c.opts.description : ""]).filter(Boolean);
}

type ToastAction = { label: unknown; onClick: (e?: unknown) => unknown };

/** The Undo actions the toasts offered. */
function undoActions(): ToastAction[] {
  return toastCalls()
    .map((c) => c.opts?.action as ToastAction | undefined)
    .filter((a): a is ToastAction => !!a && typeof a === "object" && typeof a.label === "string" && /^undo$/i.test(a.label));
}

/** Presses the toast's Undo the way sonner does (onClick with a click event), and lets its request settle. */
async function pressUndo(times = 1): Promise<void> {
  const actions = undoActions();
  expect(actions.length, `a toast offers Undo: ${JSON.stringify(toastCalls().map((c) => c.title))}`).toBe(1);
  await act(async () => {
    for (let i = 0; i < times; i += 1) void actions[0].onClick({ preventDefault() {}, defaultPrevented: false });
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const IDS = ["ct_a", "ct_b", "ct_c"];

interface Handle {
  /** Selects `ids` and confirms the bulk delete, as the bulk bar and its dialog do. */
  deleteSelected(ids: string[]): Promise<void>;
  /** How many times the screen has re-read its list. */
  refreshes(): number;
  unmount(): void;
}

interface Driver {
  name: string;
  mount(): Handle;
}

function contactRow(id: string): Contact {
  return { id, firstName: id, lastName: "Undo", status: "LEAD", tags: [] } as unknown as Contact;
}

/** The list, focus and kanban views: useContactActions, with the state use-contacts-pipeline gives it. */
const listView: Driver = {
  name: "list view (BulkActionBar -> useContactActions)",
  mount() {
    const loadContacts = vi.fn(async () => {});
    const loadFlowData = vi.fn(async () => {});
    const { result, unmount } = renderHook(() => {
      const [contacts, setContacts] = React.useState<Contact[]>(IDS.map(contactRow));
      const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
      const [, setSelectMode] = React.useState(true);
      const [selectedContactId, setSelectedContactId] = React.useState<string | null>(null);
      const [contactDetail, setContactDetail] = React.useState<ContactDetail | null>(null);
      const actions = useContactActions({
        businessId: BIZ,
        contacts,
        setContacts,
        selectedContactId,
        setSelectedContactId,
        contactDetail,
        setContactDetail,
        selectedIds,
        setSelectedIds,
        setSelectMode,
        setShowMobileDetail: () => {},
        loadContacts,
        loadDetail: async () => {},
        loadFlowData,
      });
      return { actions, setSelectedIds, contacts };
    });
    return {
      async deleteSelected(ids) {
        act(() => result.current.setSelectedIds(new Set(ids)));
        await act(async () => {
          await result.current.actions.handleBulkDelete();
        });
        expect(result.current.actions.confirmState.open, "the delete asks for confirmation first").toBe(true);
        await act(async () => {
          await result.current.actions.confirmState.action();
        });
      },
      refreshes: () => loadContacts.mock.calls.length,
      unmount,
    };
  },
};

/** The table view: useDatabaseState, as ContactsDatabase mounts it. */
const tableView: Driver = {
  name: "table view (DatabaseBulkBar -> useDatabaseState)",
  mount() {
    const onRefresh = vi.fn();
    const rows = IDS.map((id) => ({ id, firstName: id, lastName: "Undo", status: "LEAD", tags: [] }) as unknown as LocalContact);
    const { result, unmount } = renderHook(() => useDatabaseState({ businessId: BIZ, contacts: rows, onRefresh }));
    return {
      async deleteSelected(ids) {
        for (const id of ids) act(() => result.current.toggleSelect(id));
        act(() => result.current.handleBulkDelete());
        expect(result.current.confirmState.open, "the delete asks for confirmation first").toBe(true);
        await act(async () => {
          await (result.current.confirmState.onConfirm as () => Promise<void> | void)();
        });
      },
      refreshes: () => onRefresh.mock.calls.length,
      unmount,
    };
  },
};

describe.each([listView, tableView])("FU-BULK-DELETE-UNDO (D-277b): $name", (driver) => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-p37-undo");
    window.localStorage.setItem("kf_business_id", BIZ);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("BDU-01 the delete is sent at once, and Undo restores exactly those ids from Trash in one call", async () => {
    const server = installServer({ del: { status: 200, body: { deleted: 3 } } });
    const screen = driver.mount();
    await screen.deleteSelected(IDS);

    expect(server.deletes().map((d) => d.body), "one delete, sent at once with the selected ids").toEqual([{ contactIds: IDS }]);
    expect(server.restores(), "nothing is restored before Undo").toHaveLength(0);

    const refreshesBefore = screen.refreshes();
    await pressUndo();
    expect(server.restores().map((r) => r.body), "one bulk-restore call with exactly those ids").toEqual([{ ids: IDS }]);
    expect(server.deletes(), "Undo deletes nothing more").toHaveLength(1);
    expect(shownWords().some((w) => /restored 3 contacts/i.test(w)), JSON.stringify(shownWords())).toBe(true);
    expect(screen.refreshes(), "the list is read again after Undo").toBeGreaterThan(refreshesBefore);
  });

  it("BDU-02 a double click on Undo sends one restore", async () => {
    const server = installServer({ del: { status: 200, body: { deleted: 3 } } });
    const screen = driver.mount();
    await screen.deleteSelected(IDS);
    await pressUndo(2);
    expect(server.restores(), "one restore call").toHaveLength(1);
  });

  it("BDU-03 Undo answered with partial failures says how many could not be restored, never that all were", async () => {
    const server = installServer({
      del: { status: 200, body: { deleted: 3 } },
      restore: {
        status: 200,
        body: {
          model: "contact",
          restored: ["ct_a", "ct_b"],
          failed: [{ id: "ct_c", code: "contact_email_taken", message: "A contact with this email already exists in this business" }],
          restoredCount: 2,
          failedCount: 1,
        },
      },
    });
    const screen = driver.mount();
    await screen.deleteSelected(IDS);
    const refreshesBefore = screen.refreshes();
    await pressUndo();
    expect(server.restores()).toHaveLength(1);
    const words = shownWords();
    expect(words.some((w) => /\b1\b[^.]*could not be restored/i.test(w)), `says 1 could not be restored: ${JSON.stringify(words)}`).toBe(true);
    expect(words.some((w) => /restored 3\b/i.test(w)), `never claims all 3: ${JSON.stringify(words)}`).toBe(false);
    expect(screen.refreshes(), "the list is read again, so the 2 restored come back").toBeGreaterThan(refreshesBefore);
  });

  it("BDU-04 Undo refused (403) says so and claims nothing was restored", async () => {
    const server = installServer({
      del: { status: 200, body: { deleted: 3 } },
      restore: { status: 403, body: { statusCode: 403, message: SCOPE_REFUSAL, error: "Forbidden" } },
    });
    const screen = driver.mount();
    await screen.deleteSelected(IDS);
    await pressUndo();
    expect(server.restores()).toHaveLength(1);
    const errors = toastCalls().filter((c) => c.kind === "error");
    expect(errors.some((c) => /crm\b.*write access/i.test(c.title)), `the refusal is said: ${JSON.stringify(errors)}`).toBe(true);
    expect(shownWords().some((w) => /^restored/i.test(w)), JSON.stringify(shownWords())).toBe(false);
  });

  it("BDU-05 a partial delete (2 of 3, ids not named) offers no Undo and never claims 3 were deleted", async () => {
    installServer({ del: { status: 200, body: { deleted: 2 } } });
    const screen = driver.mount();
    await screen.deleteSelected(IDS);
    const words = shownWords();
    expect(undoActions(), "no Undo that could restore the wrong set").toHaveLength(0);
    expect(words.some((w) => /deleted 2 of 3/i.test(w)), `says 2 of 3: ${JSON.stringify(words)}`).toBe(true);
    expect(words.some((w) => /deleted 3\b/i.test(w)), `never claims 3: ${JSON.stringify(words)}`).toBe(false);
  });

  it("BDU-06 a partial delete whose answer names deletedIds offers Undo for exactly those ids", async () => {
    const server = installServer({ del: { status: 200, body: { deleted: 2, deletedIds: ["ct_a", "ct_c"] } } });
    const screen = driver.mount();
    await screen.deleteSelected(IDS);
    expect(shownWords().some((w) => /deleted 2 of 3/i.test(w)), JSON.stringify(shownWords())).toBe(true);
    await pressUndo();
    expect(server.restores().map((r) => r.body)).toEqual([{ ids: ["ct_a", "ct_c"] }]);
  });

  it("BDU-07 deletedIds that do not match the count, or name an id not sent, are not trusted: no Undo", async () => {
    installServer({ del: { status: 200, body: { deleted: 2, deletedIds: ["ct_a", "ct_zzz"] } } });
    const screen = driver.mount();
    await screen.deleteSelected(IDS);
    expect(undoActions(), "never restores an id this delete did not send").toHaveLength(0);
    expect(shownWords().some((w) => /deleted 2 of 3/i.test(w)), JSON.stringify(shownWords())).toBe(true);
  });

  it("BDU-08 a refused delete (403) offers no Undo and claims nothing was deleted", async () => {
    installServer({ del: { status: 403, body: { statusCode: 403, message: SCOPE_REFUSAL, error: "Forbidden" } } });
    const screen = driver.mount();
    await screen.deleteSelected(IDS);
    expect(undoActions()).toHaveLength(0);
    const words = shownWords();
    expect(words.some((w) => /^deleted/i.test(w)), `nothing claims a delete: ${JSON.stringify(words)}`).toBe(false);
    expect(toastCalls().some((c) => c.kind === "error" && /crm\b.*write access/i.test(c.title)), JSON.stringify(words)).toBe(true);
  });

  it("BDU-09 nothing was deleted (deleted 0): no Undo, and it says none were deleted", async () => {
    installServer({ del: { status: 200, body: { deleted: 0 } } });
    const screen = driver.mount();
    await screen.deleteSelected(IDS);
    expect(undoActions()).toHaveLength(0);
    const words = shownWords();
    expect(words.some((w) => /none of the 3/i.test(w)), JSON.stringify(words)).toBe(true);
    expect(words.some((w) => /^deleted/i.test(w)), JSON.stringify(words)).toBe(false);
  });

  it("BDU-10 the toast's Undo still restores after the screen has gone (the delete was already sent)", async () => {
    const server = installServer({ del: { status: 200, body: { deleted: 3 } } });
    const screen = driver.mount();
    await screen.deleteSelected(IDS);
    expect(server.deletes()).toHaveLength(1);
    screen.unmount();
    await pressUndo();
    expect(server.restores().map((r) => r.body)).toEqual([{ ids: IDS }]);
    expect(shownWords().some((w) => /restored 3 contacts/i.test(w)), JSON.stringify(shownWords())).toBe(true);
  });
});
