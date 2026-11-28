/**
 * P263 R5, board row P273 (D-331: every NIT fixed before merge).
 *   P273-1  a child focused and then removed before a flip is not stood in for by a shell control with the same label
 *           (the header's Close): only a control that was in the shell when it was focused is matched in the new shell;
 *           otherwise the panel takes focus.
 *   P273-2  the title's id is the sheet's own (useId): two open sheets with the same title do not share it, and each
 *           dialog is labelled by its own heading.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, act, within } from "@testing-library/react";

import { SideSheet } from "../side-sheet";

let phone = false;
const listeners = new Set<(e: MediaQueryListEvent) => void>();
beforeEach(() => {
  phone = false;
  listeners.clear();
  window.matchMedia = ((query: string) => ({
    get matches() { return phone && /max-width/.test(query); },
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.delete(fn),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => cleanup());

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
async function flip(toPhone: boolean) {
  phone = toPhone;
  act(() => { for (const fn of [...listeners]) fn({ matches: toPhone } as MediaQueryListEvent); });
  await settle();
}
const headerClose = () => within(screen.getByRole("dialog")).getAllByRole("button", { name: "Close" }).find((b) => !b.hasAttribute("data-child"));

describe("P273-1: a removed child is not stood in for by a shell control", () => {
  function Sheet({ showChildClose }: { showChildClose: boolean }) {
    return (
      <SideSheet open onClose={() => {}} title="Edit Expense" footer={<button>Save</button>}>
        <input aria-label="Description" />
        {/* the same tag, label and (empty) text as the header's Close */}
        {showChildClose && <button aria-label="Close" data-child="" />}
      </SideSheet>
    );
  }
  it("a child 'Close' focused, then removed, then a flip: the panel is focused, not the header's Close", async () => {
    const view = render(<Sheet showChildClose />);
    await settle();
    (document.querySelector("button[data-child]") as HTMLElement).focus();
    view.rerender(<Sheet showChildClose={false} />);
    await settle();
    await flip(true);
    expect(document.activeElement, "focus was given to the header's Close, a control the user never focused").not.toBe(headerClose());
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });
  it("a child 'Save' focused, then removed, then a flip: the footer's Save is not focused", async () => {
    function WithChildSave({ show }: { show: boolean }) {
      return (
        <SideSheet open onClose={() => {}} title="Edit Expense" footer={<button>Save</button>}>
          {show && <button data-child="">Save</button>}
        </SideSheet>
      );
    }
    const view = render(<WithChildSave show />);
    await settle();
    (document.querySelector("button[data-child]") as HTMLElement).focus();
    view.rerender(<WithChildSave show={false} />);
    await settle();
    await flip(true);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });
  it("control: the header's Close focused is still the new shell's Close after the flip", async () => {
    render(<Sheet showChildClose={false} />);
    await settle();
    headerClose()!.focus();
    await flip(true);
    expect(document.activeElement).toBe(headerClose());
  });
});

describe("P273-2: each sheet's title id is its own", () => {
  it("two open sheets with the same title: two different ids, each dialog labelled by its own heading", async () => {
    render(
      <>
        <SideSheet open onClose={() => {}} title="Edit Expense"><p>first</p></SideSheet>
        <SideSheet open onClose={() => {}} title="Edit Expense"><p>second</p></SideSheet>
      </>,
    );
    await settle();
    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs).toHaveLength(2);
    const ids = dialogs.map((d) => d.getAttribute("aria-labelledby"));
    expect(ids[0], "the two sheets share a title id").not.toBe(ids[1]);
    for (const d of dialogs) {
      const id = d.getAttribute("aria-labelledby")!;
      expect(document.querySelectorAll(`[id="${id}"]`), "the id is not unique in the document").toHaveLength(1);
      expect(d.contains(document.getElementById(id)), "the dialog is labelled by another sheet's heading").toBe(true);
    }
  });
  it("the id stays the same across a flip (the label is not lost)", async () => {
    render(<SideSheet open onClose={() => {}} title="Edit Expense"><p>body</p></SideSheet>);
    await settle();
    const before = screen.getByRole("dialog").getAttribute("aria-labelledby");
    await flip(true);
    const d = screen.getByRole("dialog");
    expect(d.getAttribute("aria-labelledby")).toBe(before);
    expect(d.contains(document.getElementById(before!))).toBe(true);
  });
});
