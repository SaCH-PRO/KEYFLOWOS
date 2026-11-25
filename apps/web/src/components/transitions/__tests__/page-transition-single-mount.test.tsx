/**
 * FU-REQUIRE-AUTH-REMOUNT, the second remount (found by the packet's live run, 2026-11-25): the app shell's
 * PageTransition (components/transitions/page-transition.tsx, around every /app page in app/app/layout.tsx) wrapped
 * the page in <AnimatePresence mode="wait"> keyed by the pathname. On a client navigation the LEAVING wrapper stays
 * mounted for its exit animation, and Next's `children` there is the layout router, which renders the CURRENT route
 * from context: so the destination page mounted first inside the leaving wrapper and again, 0.25 s later, inside the
 * entering one. A page that reads and strips a one-shot ?contactId on mount (app/app/bookings/page.tsx) consumed it
 * in the first instance and the second opened no form. Before the RequireAuth fix this was hidden: RequireAuth tore
 * the whole shell down on every navigation, and the fresh shell mounted the page once. In a production build against
 * the live API (e2e/sweep-shell-remount.spec.ts), router.push('/app/bookings?contactId=…') opened the New booking
 * sheet at the base, did not with the RequireAuth fix alone, and did with this one too.
 *
 * Pinned here in jsdom, with the real PageTransition and framer-motion; `children` reads the current route from a
 * context, as Next's layout router does:
 *   P1  after a client navigation the destination page mounts once, and its one-shot ?contactId opens its form;
 *   P2  the leaving page is gone and the destination page shows (each page is keyed by its pathname).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createContext, useContext, useEffect, useState } from "react";
import { render, screen, act, cleanup } from "@testing-library/react";

const nav = vi.hoisted(() => ({
  pathname: "/app/crm/contacts",
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => nav.searchParams,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

import { PageTransition } from "../page-transition";

/** As Next's layout router: what `children` renders is the current route, read from context, not from props. */
const RouteContext = createContext("/app/crm/contacts");

const mounts: Record<string, number> = {};

function Page({ name }: { name: string }) {
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
  }, [name]);
  return <h1>{`Page ${name}`}</h1>;
}

/** As app/app/bookings/page.tsx: reads ?contactId once on mount, opens the New booking form, strips the parameter. */
function BookingsPage() {
  const [prefill, setPrefill] = useState<string | null>(null);
  useEffect(() => {
    mounts["/app/bookings"] = (mounts["/app/bookings"] ?? 0) + 1;
    const contactId = nav.searchParams.get("contactId");
    if (contactId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the page under imitation reads a one-shot URL parameter on mount
      setPrefill(contactId);
      nav.searchParams = new URLSearchParams();
    }
  }, []);
  return <div data-testid="bookings">{prefill ? `New booking for ${prefill}` : "No booking sheet"}</div>;
}

function Routed() {
  const path = useContext(RouteContext);
  return path === "/app/bookings" ? <BookingsPage /> : <Page name={path} />;
}

function App() {
  return (
    <RouteContext.Provider value={nav.pathname}>
      <PageTransition>
        <Routed />
      </PageTransition>
    </RouteContext.Provider>
  );
}

async function wait(ms: number) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

beforeEach(() => {
  nav.pathname = "/app/crm/contacts";
  nav.searchParams = new URLSearchParams();
  for (const k of Object.keys(mounts)) delete mounts[k];
});

afterEach(() => {
  cleanup();
});

describe("FU-REQUIRE-AUTH-REMOUNT: PageTransition mounts the destination page once", () => {
  it("P1 after a client navigation the destination page mounts once, and its one-shot ?contactId opens its form", async () => {
    const { rerender } = render(<App />);
    await wait(50);
    nav.pathname = "/app/bookings";
    nav.searchParams = new URLSearchParams("contactId=contact-7");
    rerender(<App />);
    // Longer than the 0.25 s transition.
    await wait(800);
    expect(mounts["/app/bookings"], "the bookings page mounted once").toBe(1);
    expect(screen.getByTestId("bookings"), "the New booking form opened for the contact").toHaveTextContent(
      "New booking for contact-7",
    );
  });

  it("P2 the leaving page is gone and the destination page shows", async () => {
    const { rerender } = render(<App />);
    await wait(50);
    nav.pathname = "/app/finance";
    rerender(<App />);
    await wait(800);
    expect(screen.queryByRole("heading", { name: "Page /app/crm/contacts" })).toBeNull();
    expect(screen.getAllByRole("heading", { name: "Page /app/finance" })).toHaveLength(1);
  });
});
