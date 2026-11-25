/**
 * FU-REQUIRE-AUTH-REMOUNT, review repair round 1 (correctness MINOR-2): the page wrapper has no entrance transform.
 *
 * The first repair kept PageTransition's entrance (opacity 0, translateY(12px) scale(0.99), animated over 0.25 s)
 * without `initial={false}`, so every page, the first load included, started faded and shifted. At the base users
 * saw neither an entrance nor an exit: RequireAuth remounted the shell on every navigation, and the shell's
 * <AnimatePresence initial={false}> skipped the first child's entrance. And a transform on the wrapper makes it the
 * containing block of unportaled `position: fixed` content (BookingSideSheet, `fixed inset-0 z-50`, which the
 * ?contactId door opens on mount), so for 0.25 s the sheet sat inside the shifted wrapper instead of the viewport.
 *
 *   E1  on the first render the page and a fixed child have no ancestor in the wrapper with a transform, a
 *       will-change, a filter or an opacity below 1;
 *   E2  the same right after a client navigation, while a transition would be running.
 * Single mount (page-transition-single-mount.test.tsx, P1) still holds.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";

const nav = vi.hoisted(() => ({ pathname: "/app/crm/contacts" }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

import { PageTransition } from "../page-transition";

/** A page with an unportaled fixed sheet, as app/app/bookings opens BookingSideSheet. */
function PageWithSheet({ name }: { name: string }) {
  return (
    <section>
      <h1>{`Page ${name}`}</h1>
      <div data-testid={`sheet-${name}`} style={{ position: "fixed", inset: 0 }}>
        sheet
      </div>
    </section>
  );
}

function App() {
  return (
    <div data-testid="root">
      <PageTransition>
        <PageWithSheet name={nav.pathname} />
      </PageTransition>
    </div>
  );
}

/** Every element between `el` and the test root that would offset or fade it: inline transform, will-change, filter, opacity < 1. */
function offsetters(el: HTMLElement): string[] {
  const found: string[] = [];
  const root = screen.getByTestId("root");
  for (let n: HTMLElement | null = el.parentElement; n && n !== root; n = n.parentElement) {
    const s = n.style;
    if (s.transform && s.transform !== "none") found.push(`transform: ${s.transform}`);
    if (s.willChange && s.willChange !== "auto") found.push(`will-change: ${s.willChange}`);
    if (s.filter && s.filter !== "none") found.push(`filter: ${s.filter}`);
    if (s.opacity !== "" && Number(s.opacity) < 1) found.push(`opacity: ${s.opacity}`);
  }
  return found;
}

beforeEach(() => {
  nav.pathname = "/app/crm/contacts";
});

afterEach(() => {
  cleanup();
});

describe("FU-REQUIRE-AUTH-REMOUNT: PageTransition has no entrance transform", () => {
  it("E1 on the first render the page and its fixed sheet are not offset or faded", () => {
    render(<App />);
    expect(offsetters(screen.getByTestId("sheet-/app/crm/contacts")), "the fixed sheet's wrappers").toEqual([]);
    expect(offsetters(screen.getByRole("heading", { name: "Page /app/crm/contacts" })), "the page's wrappers").toEqual([]);
  });

  it("E2 right after a client navigation the destination page and its fixed sheet are not offset or faded", async () => {
    const { rerender } = render(<App />);
    nav.pathname = "/app/bookings";
    rerender(<App />);
    expect(offsetters(screen.getByTestId("sheet-/app/bookings")), "the fixed sheet's wrappers, at once").toEqual([]);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(offsetters(screen.getByTestId("sheet-/app/bookings")), "the fixed sheet's wrappers, 50 ms later").toEqual([]);
    expect(screen.queryByRole("heading", { name: "Page /app/crm/contacts" })).toBeNull();
  });
});
