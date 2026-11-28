/**
 * P263 FU-SIDESHEET-LAYOUT-FLIP-FOCUS (launch-track, D-315). The commerce SideSheet keys its panel by useIsMobile(), so
 * a resize or a rotation while it is open remounts the panel: the focused control is removed, focus falls to <body>,
 * and the open-only focus effect (P257 R1-1) never refocuses. Across a layout flip focus stays in the sheet: on the
 * same control in the new panel when there is one (matched by id, name or accessible label, since the old node is
 * gone), otherwise on the panel. Pinned desktop -> phone -> desktop.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

import { SideSheet } from "../side-sheet";

/** A matchMedia whose (max-width) queries follow `phone`, and whose change listeners can be fired. */
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
/** The screen crosses the 640px breakpoint while the sheet is open. */
async function flip(toPhone: boolean) {
  phone = toPhone;
  act(() => { for (const fn of [...listeners]) fn({ matches: toPhone } as MediaQueryListEvent); });
  await settle();
}
const layout = () => (screen.getByRole("dialog").getAttribute("class") ?? "").includes("rounded-t-2xl") ? "phone" : "desktop";

function Sheet() {
  const [text, setText] = useState("");
  return (
    <SideSheet open onClose={() => {}} title="Edit Expense">
      <input aria-label="Description" value={text} onChange={(e) => setText(e.target.value)} />
      <input id="amount" placeholder="0.00" />
      <select name="category"><option>Fuel</option></select>
      <div tabIndex={0}>A focusable block with no name</div>
    </SideSheet>
  );
}

describe("P263: focus stays in the sheet across a layout flip", () => {
  const CONTROLS: Array<[string, () => HTMLElement]> = [
    ["a field matched by its accessible label", () => screen.getByLabelText("Description")],
    ["a field matched by its id", () => document.getElementById("amount") as HTMLElement],
    ["a select matched by its name", () => document.querySelector('select[name="category"]') as HTMLElement],
    ["the header Close", () => screen.getByRole("button", { name: "Close" })],
  ];
  for (const [what, find] of CONTROLS) {
    it(`${what}: desktop -> phone -> desktop, focus is on the same control each time`, async () => {
      render(<Sheet />);
      await settle();
      expect(layout()).toBe("desktop");
      find().focus();
      expect(document.activeElement).toBe(find());
      await flip(true);
      expect(layout(), "the flip did not reach the sheet").toBe("phone");
      expect(document.activeElement, `focus left ${what} on the flip to phone`).toBe(find());
      await flip(false);
      expect(layout()).toBe("desktop");
      expect(document.activeElement, `focus left ${what} on the flip back to desktop`).toBe(find());
    });
  }
  it("a control with nothing to match it by: focus goes to the panel, not to <body>", async () => {
    render(<Sheet />);
    await settle();
    (screen.getByText("A focusable block with no name") as HTMLElement).focus();
    await flip(true);
    expect(document.activeElement, "focus fell to <body>").toBe(screen.getByRole("dialog"));
    await flip(false);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });
  it("the panel itself focused (as on open): it is focused again in the new layout", async () => {
    render(<Sheet />);
    await settle();
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    await flip(true);
    expect(document.activeElement, "focus fell to <body>").toBe(screen.getByRole("dialog"));
  });
  it("typing after the flip goes to the field (focus is usable, not only reported)", async () => {
    render(<Sheet />);
    await settle();
    screen.getByLabelText("Description").focus();
    await flip(true);
    fireEvent.change(document.activeElement as HTMLInputElement, { target: { value: "Fuel" } });
    expect((screen.getByLabelText("Description") as HTMLInputElement).value).toBe("Fuel");
  });
  it("control: with no flip, nothing moves focus (a re-render keeps it on the control)", async () => {
    render(<Sheet />);
    await settle();
    screen.getByLabelText("Description").focus();
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "F" } });
    await settle();
    expect(document.activeElement).toBe(screen.getByLabelText("Description"));
  });
  it("control: focus outside the sheet before the flip is not pulled in", async () => {
    render(
      <>
        <button>Outside</button>
        <Sheet />
      </>,
    );
    await settle();
    screen.getByRole("button", { name: "Outside" }).focus();
    await flip(true);
    expect(document.activeElement, "a flip pulled focus into the sheet").toBe(screen.getByRole("button", { name: "Outside" }));
  });
});
