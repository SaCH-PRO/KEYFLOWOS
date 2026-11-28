/**
 * P257 FU-SIDESHEET-CLOSE-DISABLED-CUE (launch-track, D-315). The commerce SideSheet (the one the expense sheet uses;
 * components/ui/side-sheet.tsx is a different component and is unchanged) takes `closeDisabled`: the header Close is
 * disabled and says so (disabled, aria-disabled), and Escape and the overlay do nothing while it is set. Without the
 * prop (the default, false) every way to close works as before, on the desktop panel and the phone bottom sheet.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { SideSheet } from "../side-sheet";

let mobile = false;
beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: mobile && /max-width/.test(query),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => { cleanup(); mobile = false; });

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const closeButton = () => screen.getByRole("button", { name: "Close" }) as HTMLButtonElement;
const overlay = () => screen.getByRole("dialog").parentElement as HTMLElement;
async function sheet(props: { closeDisabled?: boolean }) {
  const onClose = vi.fn();
  render(
    <SideSheet open onClose={onClose} title="Edit Expense" {...props}>
      <p>body</p>
    </SideSheet>,
  );
  await settle();
  return onClose;
}

for (const layout of ["desktop", "phone"] as const) {
  describe(`P257 (${layout}): closeDisabled`, () => {
    beforeEach(() => { mobile = layout === "phone"; });
    it("the header Close is disabled and says so", async () => {
      await sheet({ closeDisabled: true });
      expect(closeButton().disabled, "Close looks pressable while closing is held").toBe(true);
      expect(closeButton().getAttribute("aria-disabled")).toBe("true");
    });
    it("the header Close, Escape and the overlay do nothing", async () => {
      const onClose = await sheet({ closeDisabled: true });
      fireEvent.click(closeButton());
      fireEvent.keyDown(document, { key: "Escape" });
      fireEvent.click(overlay());
      await settle();
      expect(onClose, "the sheet closed while closing was held").not.toHaveBeenCalled();
    });
    it("control (the default, no prop): Close is enabled, and Close, Escape and the overlay each close", async () => {
      const onClose = await sheet({});
      expect(closeButton().disabled).toBe(false);
      expect(closeButton().hasAttribute("aria-disabled"), "aria-disabled set with no prop").toBe(false);
      fireEvent.click(closeButton());
      fireEvent.keyDown(document, { key: "Escape" });
      fireEvent.click(overlay());
      expect(onClose).toHaveBeenCalledTimes(3);
    });
    it("control: closeDisabled={false} behaves as the default", async () => {
      const onClose = await sheet({ closeDisabled: false });
      expect(closeButton().disabled).toBe(false);
      fireEvent.keyDown(document, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
}

describe("P257: the commerce SideSheet's other callers are unchanged", () => {
  const SRC = join(__dirname, "../../../../..");
  const SHEET = join(SRC, "app/app/commerce/components/side-sheet");
  const EXPENSE_SHEET = "app/app/expenses/components/expense-form-sidesheet.tsx";
  const CALLERS = [
    "app/app/finance/components/payment-record-modal.tsx",
    "app/app/expenses/components/recurring-expenses-panel.tsx",
    "app/app/commerce/components/billing-form-modal.tsx",
    "app/app/commerce/components/standalone-payment-recorder.tsx",
    // P257 R1-3: the sixth (it imports ../components/side-sheet).
    "app/app/commerce/recurring/recurring-panel.tsx",
  ];
  /**
   * P257 R2-1: the import is resolved, not matched loosely: `./side-sheet` beside components/ui is
   * components/ui/side-sheet.tsx, a different component. Relative specifiers resolve from the importing file, `@/`
   * from src; only one that names the commerce side-sheet module counts.
   */
  function importsCommerceSheet(rel: string): boolean {
    const text = readFileSync(join(SRC, rel), "utf8");
    for (const m of text.matchAll(/from\s+["']([^"']*side-sheet)["']/g)) {
      const spec = m[1];
      const resolved = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? join(dirname(join(SRC, rel)), spec) : null;
      if (resolved === SHEET) return true;
    }
    return false;
  }
  /** Every non-test source file under src, relative to src. */
  function sources(dir = SRC): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = join(dir, e.name);
      if (e.isDirectory()) return e.name === "__tests__" || e.name === "node_modules" ? [] : sources(full);
      return /\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) ? [relative(SRC, full)] : [];
    });
  }
  for (const path of CALLERS) {
    it(`${path} imports this SideSheet (resolved) and passes no closeDisabled`, () => {
      expect(importsCommerceSheet(path), `${path} does not import the commerce side-sheet`).toBe(true);
      expect(readFileSync(join(SRC, path), "utf8"), `${path} now passes closeDisabled`).not.toMatch(/closeDisabled/);
    });
  }
  it("the list is complete: every file that imports the commerce SideSheet is listed (or is the expense sheet)", () => {
    const importers = sources().filter(importsCommerceSheet).sort();
    expect(importers, "a caller of the commerce SideSheet is missing from CALLERS, or one listed is not a caller").toEqual([...CALLERS, EXPENSE_SHEET].sort());
  });
  it("the expense sheet passes it", () => {
    const text = readFileSync(join(SRC, EXPENSE_SHEET), "utf8");
    expect(text).toMatch(/closeDisabled=\{submitting\}/);
  });
});

describe("P257 R1-1: the sheet's focus and keydown effect does not re-run while it is open", () => {
  /** A caller that passes a new onClose arrow on every render, and re-renders as its field is typed in. */
  function Caller({ closeDisabled = false, onClose }: { closeDisabled?: boolean; onClose: () => void }) {
    const [text, setText] = useState("");
    return (
      <SideSheet open onClose={() => onClose()} title="Edit Expense" closeDisabled={closeDisabled}>
        <input aria-label="Field" value={text} onChange={(e) => setText(e.target.value)} />
      </SideSheet>
    );
  }
  const field = () => screen.getByLabelText("Field") as HTMLInputElement;
  for (const layout of ["desktop", "phone"] as const) {
    describe(layout, () => {
      beforeEach(() => { mobile = layout === "phone"; });
      it("typing several characters keeps focus in the field (a new onClose each render)", async () => {
        render(<Caller onClose={vi.fn()} />);
        await settle();
        field().focus();
        for (const v of ["P", "Pr", "Pri", "Prin"]) {
          fireEvent.change(field(), { target: { value: v } });
          await settle();
          expect(document.activeElement, `focus left the field after typing "${v}"`).toBe(field());
        }
      });
      it("toggling closeDisabled while focus is in a field keeps it there", async () => {
        const onClose = vi.fn();
        const view = render(<Caller onClose={onClose} />);
        await settle();
        field().focus();
        view.rerender(<Caller onClose={onClose} closeDisabled />);
        await settle();
        expect(document.activeElement, "focus left the field when closing was held").toBe(field());
        view.rerender(<Caller onClose={onClose} />);
        await settle();
        expect(document.activeElement, "focus left the field when closing was released").toBe(field());
      });
      it("control: the panel takes focus when the sheet opens", async () => {
        render(<Caller onClose={vi.fn()} />);
        await settle();
        expect(document.activeElement).toBe(screen.getByRole("dialog"));
      });
    });
  }
  it("control: closing returns focus to the opener", async () => {
    function Opener() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open</button>
          <SideSheet open={open} onClose={() => setOpen(false)} title="Edit Expense"><p>body</p></SideSheet>
        </>
      );
    }
    render(<Opener />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);
    await settle();
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    fireEvent.keyDown(document, { key: "Escape" });
    await settle();
    expect(document.activeElement, "focus not returned to the opener").toBe(opener);
  });
  it("control: Escape, the overlay and Close call the latest onClose, and closeDisabled set later holds them", async () => {
    const first = vi.fn();
    const latest = vi.fn();
    const view = render(<SideSheet open onClose={first} title="Edit Expense"><p>body</p></SideSheet>);
    await settle();
    view.rerender(<SideSheet open onClose={latest} title="Edit Expense"><p>body</p></SideSheet>);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(overlay());
    fireEvent.click(closeButton());
    expect(first, "a stale onClose was called").not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(3);
    view.rerender(<SideSheet open onClose={latest} title="Edit Expense" closeDisabled><p>body</p></SideSheet>);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(overlay());
    expect(latest, "closeDisabled set after open did not hold Escape and the overlay").toHaveBeenCalledTimes(3);
  });
});
