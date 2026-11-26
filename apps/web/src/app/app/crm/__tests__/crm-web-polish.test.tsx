/**
 * SWP-CRM-WEB-POLISH (BUG-080, BUG-130, BUG-082; journey C): the customers table honours the screen's search, and
 * the CRM dashboard reads in dark mode, names its CLIENT segment "Clients" and draws no empty Next actions card.
 *
 *   CWP-080a  RED-BEFORE  the table given the screen's search "Kwame" shows only Kwame's row, and its count says
 *                         "1 of 1" (before: it read its own, empty search and showed every customer, "3 of 3")
 *   CWP-080b  RED-BEFORE  a later change of the screen's search ("Kwame" -> "Ama") re-reads the table with it
 *   CWP-080c  RED-BEFORE  the table's own search box shows the screen's search, and typing in it changes the
 *                         screen's search (one search, not two that disagree) and the table's own rows at once
 *   CWP-080f  RED-BEFORE  a saved table view applied in the table hands its search to the screen too ("All
 *                         Contacts" saves no search, so the screen's "Kwame" clears), so the two never disagree
 *   CWP-080d  control     without a screen search the table's own box still searches on its own (the prop is
 *                         optional: nothing else that mounts the table changes)
 *   CWP-080e  RED-BEFORE  (source guard) the customers screen passes its search to the table, both ways
 *   CWP-130a  RED-BEFORE  the dashboard heading takes the foreground token, not text-slate-900 (dark on dark)
 *   CWP-130b  RED-BEFORE  the CLIENT segment is labelled "Clients", and no segment is labelled "Contacts"
 *   CWP-082a  RED-BEFORE  the dashboard draws no Next actions card (it read another source and stood empty while
 *                         the customers screen listed next actions; fixed by removal)
 *   CWP-082b  control     (false premise, pinned) the customers screen's Next Actions queue renders its items' text
 *                         visibly: opacity 1, not 0
 *
 * Repair round 1 (reviews at 769f8933):
 *   CWP-R1a   RED-AT-769f8933  (SEC-CWP-1) a stored table view with no string search, applied while the screen
 *                         searches "Kwame", hands the screen "" (never undefined), as the table applies, and the
 *                         table keeps rendering
 *   CWP-R1b   RED-AT-769f8933  the same stored view applied in a table with no screen search does not crash the table
 *                         (its own debounce called .trim() on undefined; the bug was on main already)
 *   CWP-R2    RED-AT-769f8933  (COR-CWP-1) a table mounted while the screen searches "Kwame" sends exactly one read,
 *                         with that search, and never shows the unfiltered count ("3 of 3")
 *   CWP-R3    control (orchestrator ruling on COR-CWP-3: option a) "My Book" applied, then a search from the
 *                         screen or the table's box: the read stays the user's own customers, with the search added
 *                         (applied means the view's filters stay in force; the search refines them)
 *   CWP-R4    RED-AT-769f8933  (COR-CWP-5) the dashboard's Next actions widget, mounted nowhere since the fix, is gone
 *
 * Components render for real on the real client; only fetch, the Next router hooks and toasts are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { act, render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/crm/contacts",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));

import { ContactsDatabase } from "../pipeline/contacts-database";
import CrmDashboardPage from "../dashboard/page";
import { NextActionQueue } from "@/components/contacts/next-action-queue";
import type { LocalContact } from "@/lib/contacts-db";

const BIZ = "biz_cwp";
const NOW = "2026-11-20T12:00:00.000Z";

function person(id: string, firstName: string, lastName: string, status = "LEAD") {
  return {
    id, businessId: BIZ, firstName, lastName, email: null, phone: null, status, tags: [], source: "manual",
    createdAt: NOW, updatedAt: NOW,
  };
}
const PEOPLE = [person("c_kwame", "Kwame", "Mensah"), person("c_ama", "Ama", "Owusu", "CLIENT"), person("c_kofi", "Kofi", "Boateng")];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** The searches the table's reads sent, in order ("" for none). */
let searches: string[] = [];
/** Each read's search and whether it asked for the signed-in user's own customers only. */
let reads: Array<{ search: string; ownedByMe: boolean }> = [];

beforeEach(() => {
  searches = [];
  reads = [];
  // The dashboard restores its scroll on mount (useReturnNavigation); jsdom has no window.scrollTo.
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  window.localStorage.clear();
  window.localStorage.setItem("kf_business_id", BIZ);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
      if (url.pathname.endsWith(`/crm/businesses/${BIZ}/contacts`)) {
        // The server's search: a case-insensitive match on the name, as crm.service.ts listContacts does.
        const q = (url.searchParams.get("search") ?? "").toLowerCase();
        searches.push(q);
        reads.push({ search: q, ownedByMe: url.searchParams.get("ownedByMe") === "true" });
        const rows = PEOPLE.filter((p) => !q || `${p.firstName} ${p.lastName}`.toLowerCase().includes(q));
        return json(200, { contacts: rows, nextCursor: null, hasMore: false });
      }
      return json(404, { message: "Not stubbed" });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The table's rows that name a person (by first name cell). */
function tableNames(): string[] {
  const grid = screen.getByRole("grid", { name: "Contacts database table" });
  return within(grid)
    .queryAllByRole("row")
    .map((row) => PEOPLE.find((p) => within(row).queryByText(p.firstName))?.firstName)
    .filter((n): n is string => Boolean(n));
}

type TableProps = Parameters<typeof ContactsDatabase>[0];

function renderTable(extra: Partial<TableProps> = {}) {
  const props: TableProps = {
    businessId: BIZ,
    contacts: PEOPLE as unknown as LocalContact[],
    onRefresh: vi.fn(),
    activeListId: null,
    onSelectList: vi.fn(),
    ...extra,
  };
  const view = render(<ContactsDatabase {...props} />);
  return { ...view, rerenderWith: (more: Partial<TableProps>) => view.rerender(<ContactsDatabase {...props} {...more} />) };
}

describe("BUG-080: the table view honours the screen's search, and its count agrees", () => {
  it("CWP-080a RED-BEFORE: the screen's search 'Kwame' leaves only Kwame's row, and the count says 1 of 1", async () => {
    renderTable({ search: "Kwame", contacts: [PEOPLE[0]] as unknown as LocalContact[] });
    await waitFor(() => expect(searches).toContain("kwame"), { timeout: 3_000 });
    await waitFor(() => expect(tableNames()).toEqual(["Kwame"]));
    expect(screen.getByText("1 of 1")).toBeInTheDocument();
    expect(screen.getByText(/Showing 1-1 of 1/)).toBeInTheDocument();
  });

  it("CWP-080b RED-BEFORE: a later change of the screen's search re-reads the table with it", async () => {
    const { rerenderWith } = renderTable({ search: "Kwame" });
    await waitFor(() => expect(tableNames()).toEqual(["Kwame"]), { timeout: 3_000 });
    rerenderWith({ search: "Ama" });
    await waitFor(() => expect(tableNames()).toEqual(["Ama"]), { timeout: 3_000 });
    expect(searches.at(-1)).toBe("ama");
  });

  it("CWP-080c RED-BEFORE: the table's own box shows the screen's search, and typing in it changes the screen's search", async () => {
    const onSearchChange = vi.fn();
    renderTable({ search: "Kwame", onSearchChange });
    const box = screen.getByRole("textbox", { name: "Search contacts database" }) as HTMLInputElement;
    await waitFor(() => expect(box.value).toBe("Kwame"));
    fireEvent.change(box, { target: { value: "Kofi" } });
    expect(onSearchChange).toHaveBeenLastCalledWith("Kofi");
    // The table takes what was typed at once, whether or not the screen hands it back (here it does not).
    expect(box.value).toBe("Kofi");
    await waitFor(() => expect(tableNames()).toEqual(["Kofi"]), { timeout: 3_000 });
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onSearchChange).toHaveBeenLastCalledWith("");
  });

  it("CWP-080f RED-BEFORE: a saved table view applied in the table hands its search to the screen", async () => {
    const onSearchChange = vi.fn();
    renderTable({ search: "Kwame", onSearchChange });
    const box = screen.getByRole("textbox", { name: "Search contacts database" }) as HTMLInputElement;
    await waitFor(() => expect(box.value).toBe("Kwame"));
    fireEvent.click(screen.getByRole("button", { name: "Saved views" }));
    fireEvent.click(screen.getByRole("button", { name: /All Contacts/ }));
    expect(onSearchChange).toHaveBeenLastCalledWith("");
    await waitFor(() => expect(box.value).toBe(""));
  });

  it("CWP-080d control: with no screen search, the table's own box still searches on its own", async () => {
    renderTable();
    await waitFor(() => expect(tableNames()).toEqual(["Kwame", "Ama", "Kofi"]), { timeout: 3_000 });
    fireEvent.change(screen.getByRole("textbox", { name: "Search contacts database" }), { target: { value: "Kofi" } });
    await waitFor(() => expect(tableNames()).toEqual(["Kofi"]), { timeout: 3_000 });
  });

  it("CWP-080e RED-BEFORE (source guard): the customers screen passes its search to the table, both ways", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../pipeline/pipeline-tab-content.tsx"), "utf8");
    const mount = src.slice(src.indexOf("<ContactsDatabase"), src.indexOf("/>", src.indexOf("<ContactsDatabase")));
    expect(mount).toMatch(/\bsearch=\{searchInput\}/);
    expect(mount).toMatch(/\bonSearchChange=\{setSearchInput\}/);
  });
});

describe("BUG-130 and BUG-082: the CRM dashboard", () => {
  async function renderDashboard() {
    render(<CrmDashboardPage />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  it("CWP-130a RED-BEFORE: the heading takes the foreground token, so it reads in dark mode", async () => {
    await renderDashboard();
    const heading = screen.getByRole("heading", { level: 1, name: "CRM Dashboard" });
    expect(heading.className).toMatch(/\btext-foreground\b/);
    expect(heading.className).not.toMatch(/\btext-slate-\d+/);
  });

  it("CWP-130b RED-BEFORE: the CLIENT segment is labelled Clients, and no segment is labelled Contacts", async () => {
    await renderDashboard();
    const segments = screen.getByText("Segments").closest("div.space-y-3") as HTMLElement;
    expect(within(segments).getByText("Clients")).toBeInTheDocument();
    expect(within(segments).queryByText("Contacts")).not.toBeInTheDocument();
  });

  it("CWP-082a RED-BEFORE: the dashboard draws no Next actions card", async () => {
    await renderDashboard();
    expect(screen.queryByText(/^next actions$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh next actions" })).not.toBeInTheDocument();
  });
});

describe("BUG-082: the customers screen's Next Actions queue (false premise, pinned)", () => {
  it("CWP-082b control: the queue's items render their text visibly (opacity 1, not 0)", async () => {
    render(
      <NextActionQueue
        actions={[{ id: "a1", type: "call", contactId: "c_kwame", contactName: "Kwame Mensah", description: "Call about the quote", estimatedTime: 5, priority: "high" }]}
        onComplete={async () => {}}
        onViewContact={() => {}}
        onDoAction={() => {}}
      />,
    );
    const text = screen.getByText("Call about the quote");
    await waitFor(
      () => {
        for (let el: HTMLElement | null = text; el; el = el.parentElement) {
          expect(el.style.opacity === "" ? 1 : Number(el.style.opacity)).toBe(1);
        }
      },
      { timeout: 3_000 },
    );
    expect(screen.getByText("Kwame Mensah")).toBeVisible();
  });
});

describe("Repair round 1: the table's saved views and first read", () => {
  /** Errors thrown outside React (the search debounce runs in a timer). */
  function catchWindowErrors() {
    const errors: string[] = [];
    const onError = (e: ErrorEvent) => {
      errors.push(String(e.error?.message ?? e.message));
      e.preventDefault();
    };
    // A throw in a timer reaches the process, not the window, under vitest's jsdom.
    const onUncaught = (err: unknown) => {
      errors.push(String((err as Error)?.message ?? err));
    };
    window.addEventListener("error", onError);
    process.prependListener("uncaughtException", onUncaught);
    return {
      errors,
      stop: () => {
        window.removeEventListener("error", onError);
        process.removeListener("uncaughtException", onUncaught);
      },
    };
  }

  /** A stored view in an old or tampered format: its config has no search. */
  function storeViewWithoutSearch() {
    const view = {
      id: "view_old", name: "Old view", isDefault: false,
      config: { statusFilter: "ALL", sortField: "firstName", sortDir: "asc", visibleColumns: ["firstName", "lastName"], pageSize: 25 },
    };
    window.localStorage.setItem("kf_db_saved_views", JSON.stringify([view]));
  }

  it("CWP-R1a RED-AT-769f8933: a stored view with no search hands the screen no undefined search", async () => {
    storeViewWithoutSearch();
    const caught = catchWindowErrors();
    const onSearchChange = vi.fn();
    renderTable({ search: "Kwame", onSearchChange });
    await waitFor(() => expect(tableNames()).toEqual(["Kwame"]), { timeout: 3_000 });
    fireEvent.click(screen.getByRole("button", { name: "Saved views" }));
    fireEvent.click(screen.getByText("Old view").closest("button") as HTMLButtonElement);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    caught.stop();
    expect(caught.errors).toEqual([]);
    expect(onSearchChange.mock.calls.every(([v]) => typeof v === "string")).toBe(true);
    // The table searches for nothing (the view saved none), and so does the screen: the two still agree.
    expect(onSearchChange).toHaveBeenLastCalledWith("");
    expect((screen.getByRole("textbox", { name: "Search contacts database" }) as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("grid", { name: "Contacts database table" })).toBeInTheDocument();
  });

  it("CWP-R1b RED-AT-769f8933: the same view applied in a table with no screen search does not crash it", async () => {
    storeViewWithoutSearch();
    const caught = catchWindowErrors();
    renderTable();
    await waitFor(() => expect(tableNames()).toEqual(["Kwame", "Ama", "Kofi"]), { timeout: 3_000 });
    fireEvent.click(screen.getByRole("button", { name: "Saved views" }));
    fireEvent.click(screen.getByText("Old view").closest("button") as HTMLButtonElement);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    caught.stop();
    expect(caught.errors).toEqual([]);
    expect(screen.getByRole("grid", { name: "Contacts database table" })).toBeInTheDocument();
    expect((screen.getByRole("textbox", { name: "Search contacts database" }) as HTMLInputElement).value).toBe("");
  });

  it("CWP-R2 RED-AT-769f8933: a table mounted under the screen's search reads once, with it, and never shows the unfiltered count", async () => {
    const counts: string[] = [];
    const observer = new MutationObserver(() => {
      for (const el of Array.from(document.body.querySelectorAll("span, div, p"))) {
        const t = el.textContent?.trim() ?? "";
        if (/^\d+ of \d+$/.test(t)) counts.push(t);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    renderTable({ search: "Kwame" });
    await waitFor(() => expect(tableNames()).toEqual(["Kwame"]), { timeout: 3_000 });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    observer.disconnect();
    expect(searches).toEqual(["kwame"]);
    expect(counts).not.toContain("3 of 3");
    expect(screen.getByText("1 of 1")).toBeInTheDocument();
  });

  it("CWP-R3 control: My Book stays in force when a search is added, from the screen or the table's box", async () => {
    window.localStorage.setItem("kf_user_cache", JSON.stringify({ id: "u_cwp", email: "owner@cwp.test" }));
    const { rerenderWith } = renderTable({ search: "" });
    await waitFor(() => expect(tableNames()).toEqual(["Kwame", "Ama", "Kofi"]), { timeout: 3_000 });
    fireEvent.click(screen.getByRole("button", { name: "Saved views" }));
    fireEvent.click(screen.getByText("My Book").closest("button") as HTMLButtonElement);
    await waitFor(() => expect(reads.at(-1)).toEqual({ search: "", ownedByMe: true }), { timeout: 3_000 });
    rerenderWith({ search: "Kwame" });
    await waitFor(() => expect(reads.at(-1)).toEqual({ search: "kwame", ownedByMe: true }), { timeout: 3_000 });
    fireEvent.change(screen.getByRole("textbox", { name: "Search contacts database" }), { target: { value: "Ama" } });
    await waitFor(() => expect(reads.at(-1)).toEqual({ search: "ama", ownedByMe: true }), { timeout: 3_000 });
  });

  it("CWP-R4 RED-AT-769f8933: the dashboard's unmounted Next actions widget is deleted", () => {
    expect(fs.existsSync(path.resolve(__dirname, "../dashboard/next-actions-widget.tsx"))).toBe(false);
  });
});
