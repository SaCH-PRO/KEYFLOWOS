/**
 * FU-BULK-DELETE-UNDO, the web half: the acceptance reviews' repair round (orchestrator reviews at 9deb64d9).
 * The first half is bulk-delete-undo.test.tsx (BDU-01..10); this file adds:
 *
 *   SEC-P37W-1 (RED) the Undo toast lives in the app-wide Toaster and outlives a sign-out; a second person signing in
 *              in the same tab could press it and restore the first person's ids under their own token. Undo acts
 *              only for the session that deleted (actingMemberNow(), lib/business-settings.ts: the session token's
 *              subject); for anyone else, or no one, it sends nothing and says so.
 *   SEC-P37W-2 (pin) a business switch before Undo: the restore still names the delete's business.
 *   COR-P37-1  (pins) the list view hides only the ids deleted; a partial delete without ids re-reads the list;
 *              a delete of none hides none.
 *   COR-P37-2  (pins) deletedIds that outnumber `deleted` offer no Undo; the table re-reads its own read after the
 *              delete; a refused restore does not re-read the list; failedCount > 0 is never "all restored".
 *   COR-P37-4  (RED) never "0 could not be restored".
 *   CONF-P37-1 (pin, correctness confirmation of be3d7a44) the person is recorded before the delete is sent: a
 *              different person signed in while the delete is in flight cannot Undo it.
 *
 * The real hooks and client run; fetch is stubbed at the network edge with a server that keeps which customers
 * are live, and sonner is replaced by spies so the toast's Undo can be pressed.
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

const BIZ = "biz_p37_review";
const OTHER_BIZ = "biz_p37_other";
const DELETE_PATH = `/crm/businesses/${BIZ}/contacts/bulk`;
const LIST_PATH = `/crm/businesses/${BIZ}/contacts`;
const RESTORE_SUFFIX = "/trash/contact/bulk-restore";
const SCOPE_REFUSAL = "Insufficient permissions: crm requires write access (you have read)";
const IDS = ["ct_a", "ct_b", "ct_c"];

const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
/** A session token for `sub` (unsigned: the client reads the subject, the stubbed server checks nothing). */
const tokenFor = (sub: string, n = 1) => `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ sub, n })}.sig`;

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

/**
 * A server holding which customers are live. The delete removes `removes` (default: every id sent) and answers
 * `del`; the restore brings back what it names and answers `restore` (default: all restored).
 */
function installServer(opts: { del: Answer; removes?: string[]; restore?: Answer; onDelete?: () => void }) {
  const sent: Sent[] = [];
  const live = new Set(IDS);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      const url = new URL(raw, "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
      sent.push({ method, path: url.pathname, body });
      if (method === "DELETE" && url.pathname.endsWith(DELETE_PATH)) {
        const ids = (body as { contactIds?: string[] })?.contactIds ?? [];
        if (opts.del.status < 300) (opts.removes ?? ids).forEach((id) => live.delete(id));
        opts.onDelete?.();
        return jsonResponse(opts.del.status, opts.del.body);
      }
      if (method === "POST" && url.pathname.endsWith(RESTORE_SUFFIX)) {
        const ids = (body as { ids?: string[] })?.ids ?? [];
        const a = opts.restore ?? {
          status: 200,
          body: { model: "contact", restored: ids, failed: [], restoredCount: ids.length, failedCount: 0 },
        };
        if (a.status < 300) {
          const back = (a.body as { restored?: string[] }).restored ?? [];
          back.forEach((id) => live.add(id));
        }
        return jsonResponse(a.status, a.body);
      }
      if (method === "GET" && url.pathname.endsWith(LIST_PATH)) {
        return jsonResponse(200, { contacts: IDS.filter((id) => live.has(id)).map(row), nextCursor: null, hasMore: false });
      }
      if (method === "GET") return jsonResponse(200, []);
      return jsonResponse(200, {});
    }),
  );
  return {
    sent,
    live: () => IDS.filter((id) => live.has(id)),
    restores: () => sent.filter((s) => s.method === "POST" && s.path.endsWith(RESTORE_SUFFIX)),
    listReads: () => sent.filter((s) => s.method === "GET" && s.path.endsWith(LIST_PATH)).length,
  };
}
type Server = ReturnType<typeof installServer>;

function row(id: string) {
  return { id, firstName: id, lastName: "Review", status: "LEAD", tags: [] };
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

function shownWords(): string[] {
  return toastCalls().flatMap((c) => [c.title, typeof c.opts?.description === "string" ? c.opts.description : ""]).filter(Boolean);
}

type ToastAction = { label: unknown; onClick: (e?: unknown) => unknown };

function undoActions(): ToastAction[] {
  return toastCalls()
    .map((c) => c.opts?.action as ToastAction | undefined)
    .filter((a): a is ToastAction => !!a && typeof a === "object" && typeof a.label === "string" && /^undo$/i.test(a.label));
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function pressUndo(): Promise<void> {
  const actions = undoActions();
  expect(actions.length, `a toast offers Undo: ${JSON.stringify(toastCalls().map((c) => c.title))}`).toBe(1);
  await act(async () => {
    void actions[0].onClick({ preventDefault() {}, defaultPrevented: false });
  });
  await settle();
}

interface Handle {
  deleteSelected(ids: string[]): Promise<void>;
  /** How many times the screen asked to re-read its list (loadContacts / onRefresh). */
  refreshes(): number;
  /** The rows the screen holds (list view only). */
  rows(): string[];
  unmount(): void;
}

interface Driver {
  name: string;
  mount(server: Server): Handle;
}

/** The list view: useContactActions, whose loadContacts reads the stubbed server's live customers. */
const listView: Driver = {
  name: "list view (useContactActions)",
  mount(server) {
    const setRef: { current: React.Dispatch<React.SetStateAction<Contact[]>> | null } = { current: null };
    const loadContacts = vi.fn(async () => {
      setRef.current?.(server.live().map((id) => row(id) as unknown as Contact));
    });
    const { result, unmount } = renderHook(() => {
      const [contacts, setContacts] = React.useState<Contact[]>(IDS.map((id) => row(id) as unknown as Contact));
      setRef.current = setContacts;
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
        loadFlowData: async () => {},
      });
      return { actions, setSelectedIds, contacts };
    });
    return {
      async deleteSelected(ids) {
        act(() => result.current.setSelectedIds(new Set(ids)));
        await act(async () => {
          await result.current.actions.handleBulkDelete();
        });
        await act(async () => {
          await result.current.actions.confirmState.action();
        });
        await settle();
      },
      refreshes: () => loadContacts.mock.calls.length,
      rows: () => result.current.contacts.map((c) => c.id),
      unmount,
    };
  },
};

/** The table view: useDatabaseState, which runs its own contacts read. */
const tableView: Driver = {
  name: "table view (useDatabaseState)",
  mount() {
    const onRefresh = vi.fn();
    const rows = IDS.map((id) => row(id) as unknown as LocalContact);
    const { result, unmount } = renderHook(() => useDatabaseState({ businessId: BIZ, contacts: rows, onRefresh }));
    return {
      async deleteSelected(ids) {
        await settle();
        for (const id of ids) act(() => result.current.toggleSelect(id));
        act(() => result.current.handleBulkDelete());
        await act(async () => {
          await (result.current.confirmState.onConfirm as () => Promise<void> | void)();
        });
        await settle();
      },
      refreshes: () => onRefresh.mock.calls.length,
      rows: () => [],
      unmount,
    };
  },
};

function signInAs(sub: string, n = 1) {
  window.localStorage.setItem("kf_token", tokenFor(sub, n));
}

beforeEach(() => {
  window.localStorage.clear();
  signInAs("user_a");
  window.localStorage.setItem("kf_business_id", BIZ);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe.each([listView, tableView])("FU-BULK-DELETE-UNDO review repair: $name", (driver) => {
  it("SEC-P37W-1 RED: another person signed in in the same tab presses Undo: nothing is restored, and it says why", async () => {
    const server = installServer({ del: { status: 200, body: { deleted: 3 } } });
    const screen = driver.mount(server);
    await screen.deleteSelected(IDS);
    signInAs("user_b");
    await pressUndo();
    expect(server.restores(), "no restore under another person's session").toHaveLength(0);
    const words = shownWords();
    expect(words.some((w) => /earlier session/i.test(w)), `says the Undo belonged to an earlier session: ${JSON.stringify(words)}`).toBe(true);
    expect(words.some((w) => /still in trash/i.test(w)), JSON.stringify(words)).toBe(true);
    expect(words.some((w) => /^restored/i.test(w)), JSON.stringify(words)).toBe(false);
  });

  it("SEC-P37W-1 RED: signed out before Undo: nothing is restored", async () => {
    const server = installServer({ del: { status: 200, body: { deleted: 3 } } });
    const screen = driver.mount(server);
    await screen.deleteSelected(IDS);
    window.localStorage.removeItem("kf_token");
    await pressUndo();
    expect(server.restores()).toHaveLength(0);
    expect(shownWords().some((w) => /earlier session/i.test(w)), JSON.stringify(shownWords())).toBe(true);
  });

  it("SEC-P37W-1 control: the same person after a token refresh can Undo", async () => {
    const server = installServer({ del: { status: 200, body: { deleted: 3 } } });
    const screen = driver.mount(server);
    await screen.deleteSelected(IDS);
    signInAs("user_a", 2);
    await pressUndo();
    expect(server.restores().map((r) => r.body)).toEqual([{ ids: IDS }]);
  });

  // Superseded by FU-UNDO-TOAST-SIGNOUT review SEC-UTS-1 / COR-UTS-2 (orchestrator ruling, option A): a delete that
  // answers after another person signed in mid-request no longer offers them an Undo that says "earlier session"; it
  // says nothing at all to them. The undo-time guard (the person recorded before the delete is sent) is still pinned,
  // for a toast that survives a session change some other way: contacts-bulk-delete-session-end.test.tsx BSE-08.
  it("CONF-P37-1 pin: the person is recorded before the delete is sent: another person signed in mid-request is offered nothing", async () => {
    const server = installServer({ del: { status: 200, body: { deleted: 3 } }, onDelete: () => signInAs("user_b") });
    const screen = driver.mount(server);
    await screen.deleteSelected(IDS);
    expect(undoActions(), "no Undo is offered to the person signed in when the delete answered").toHaveLength(0);
    expect(toastCalls(), "nothing is said to them").toEqual([]);
    expect(shownWords().some((w) => /deleted/i.test(w)), JSON.stringify(shownWords())).toBe(false);
    expect(server.restores(), "and nothing is restored").toHaveLength(0);
  });

  it("SEC-P37W-2 pin: after a business switch, Undo restores in the delete's business", async () => {
    const server = installServer({ del: { status: 200, body: { deleted: 3 } } });
    const screen = driver.mount(server);
    await screen.deleteSelected(IDS);
    window.localStorage.setItem("kf_business_id", OTHER_BIZ);
    await pressUndo();
    expect(server.restores().map((r) => r.path)).toEqual([expect.stringMatching(new RegExp(`/api/businesses/${BIZ}${RESTORE_SUFFIX}$`))]);
    expect(server.restores().some((r) => r.path.includes(OTHER_BIZ))).toBe(false);
  });

  it("COR-P37-2 pin (M3): deletedIds that outnumber `deleted` are not trusted: no Undo", async () => {
    const server = installServer({ del: { status: 200, body: { deleted: 1, deletedIds: ["ct_a", "ct_b"] } }, removes: ["ct_a"] });
    const screen = driver.mount(server);
    await screen.deleteSelected(["ct_a", "ct_b"]);
    expect(undoActions(), "never restores more than were deleted").toHaveLength(0);
  });

  it("COR-P37-2 pin (M9): a refused restore does not re-read the list", async () => {
    const server = installServer({
      del: { status: 200, body: { deleted: 3 } },
      restore: { status: 403, body: { statusCode: 403, message: SCOPE_REFUSAL, error: "Forbidden" } },
    });
    const screen = driver.mount(server);
    await screen.deleteSelected(IDS);
    const refreshes = screen.refreshes();
    const reads = server.listReads();
    await pressUndo();
    expect(server.restores()).toHaveLength(1);
    expect(screen.refreshes(), "nothing was restored: no re-read").toBe(refreshes);
    expect(server.listReads(), "nothing was restored: no list read").toBe(reads);
  });

  it("COR-P37-2 pin (M4): a restore answering failedCount > 0 is never 'all restored'", async () => {
    const server = installServer({
      del: { status: 200, body: { deleted: 3 } },
      restore: {
        status: 200,
        body: { model: "contact", restored: IDS, failed: [{ id: "ct_c", code: "restore_failed", message: "Failed" }], restoredCount: 3, failedCount: 1 },
      },
    });
    const screen = driver.mount(server);
    await screen.deleteSelected(IDS);
    await pressUndo();
    const after = toastCalls().filter((c) => /^restored/i.test(c.title));
    expect(after.map((c) => c.kind), JSON.stringify(after)).not.toContain("success");
    expect(shownWords().some((w) => /\b1 could not be restored/i.test(w)), JSON.stringify(shownWords())).toBe(true);
  });

  it("COR-P37-4 RED: never '0 could not be restored'", async () => {
    const server = installServer({
      del: { status: 200, body: { deleted: 3 } },
      restore: {
        status: 200,
        body: { model: "contact", restored: IDS, failed: [{ id: "ct_c", code: "restore_failed", message: "Failed" }], restoredCount: 3, failedCount: 1 },
      },
    });
    const screen = driver.mount(server);
    await screen.deleteSelected(IDS);
    await pressUndo();
    expect(shownWords().some((w) => /\b0 could not/i.test(w)), JSON.stringify(shownWords())).toBe(false);
  });

  it("COR-P37-4 pin: restoredCount short of the ids with failedCount 0 names no failure count, and never all", async () => {
    const server = installServer({
      del: { status: 200, body: { deleted: 3 } },
      restore: { status: 200, body: { model: "contact", restored: ["ct_a", "ct_b"], failed: [], restoredCount: 2, failedCount: 0 } },
    });
    const screen = driver.mount(server);
    await screen.deleteSelected(IDS);
    await pressUndo();
    const words = shownWords();
    expect(words.some((w) => /\b0 could not/i.test(w)), JSON.stringify(words)).toBe(false);
    expect(words.some((w) => /restored 2 of 3/i.test(w)), JSON.stringify(words)).toBe(true);
    expect(words.some((w) => /restored 3\b/i.test(w)), JSON.stringify(words)).toBe(false);
  });
});

describe("FU-BULK-DELETE-UNDO review repair: list view rows (COR-P37-1)", () => {
  it("COR-P37-1 pin (M7): an own-contacts-only member deletes 3, the server deletes 2 without naming them: the list is read again and the 2 leave it", async () => {
    const server = installServer({ del: { status: 200, body: { deleted: 2 } }, removes: ["ct_a", "ct_c"] });
    const screen = listView.mount(server);
    await screen.deleteSelected(IDS);
    expect(screen.refreshes(), "the list is read again").toBeGreaterThan(0);
    expect(screen.rows(), "only the 2 deleted leave the list").toEqual(["ct_b"]);
  });

  it("COR-P37-1 pin (M11): a partial delete naming its ids hides only those", async () => {
    const server = installServer({ del: { status: 200, body: { deleted: 2, deletedIds: ["ct_a", "ct_c"] } }, removes: ["ct_a", "ct_c"] });
    const screen = listView.mount(server);
    await screen.deleteSelected(IDS);
    expect(screen.rows(), "the one not deleted stays").toEqual(["ct_b"]);
  });

  it("COR-P37-1 pin (M12): a delete of none hides none", async () => {
    const server = installServer({ del: { status: 200, body: { deleted: 0 } }, removes: [] });
    const screen = listView.mount(server);
    await screen.deleteSelected(IDS);
    expect(screen.rows(), "nothing was deleted, nothing leaves the list").toEqual(IDS);
  });
});

describe("FU-BULK-DELETE-UNDO review repair: the table's own read (COR-P37-2, M8)", () => {
  it("COR-P37-2 pin (M8): after a bulk delete the table reads its own list again, and again after Undo", async () => {
    const server = installServer({ del: { status: 200, body: { deleted: 3 } } });
    const screen = tableView.mount(server);
    await settle();
    const before = server.listReads();
    await screen.deleteSelected(IDS);
    const afterDelete = server.listReads();
    expect(afterDelete, "the table re-reads after the delete").toBeGreaterThan(before);
    await pressUndo();
    expect(server.listReads(), "and after Undo").toBeGreaterThan(afterDelete);
  });
});
