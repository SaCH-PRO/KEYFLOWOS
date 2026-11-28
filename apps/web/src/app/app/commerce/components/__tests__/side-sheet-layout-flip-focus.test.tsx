/**
 * P263 FU-SIDESHEET-LAYOUT-FLIP-FOCUS (launch-track, D-315). The commerce SideSheet keys its panel by useIsMobile(), so
 * a resize or a rotation while it is open remounts the panel: the focused control is removed, focus falls to <body>,
 * and the open-only focus effect (P257 R1-1) never refocuses. Across a layout flip focus stays in the sheet: on the
 * same control in the new panel when there is one (matched by id, name or accessible label, since the old node is
 * gone), otherwise on the panel. Pinned desktop -> phone -> desktop.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { useId, useState, type ReactNode } from "react";
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
  it("P263 R1-1: a control with no identifier is matched by its position (tag and type agreeing)", async () => {
    render(<Sheet />);
    await settle();
    (screen.getByText("A focusable block with no name") as HTMLElement).focus();
    await flip(true);
    expect(document.activeElement, "the unnamed control lost focus").toBe(screen.getByText("A focusable block with no name"));
    await flip(false);
    expect(document.activeElement).toBe(screen.getByText("A focusable block with no name"));
  });
  it("a control whose position no longer agrees (tag or type) and with no identifier: focus goes to the panel, not <body>", async () => {
    /** A select before the field on a phone (read when the child mounts, so the remounted panel has it). */
    function PhoneOnlySelect() {
      return phone ? <select><option>x</option></select> : null;
    }
    function Shifting() {
      return (
        <SideSheet open onClose={() => {}} title="Edit Expense">
          <PhoneOnlySelect />
          {/* P263 R2: a placeholder now identifies a field, so this one carries none (a test id is not read). */}
          <input data-testid="no-identifier" />
        </SideSheet>
      );
    }
    render(<Shifting />);
    await settle();
    screen.getByTestId("no-identifier").focus();
    await flip(true);
    expect(document.activeElement, "focus fell to <body>").toBe(screen.getByRole("dialog"));
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

describe("P263 R1: matching the focused control in the remounted panel", () => {
  it("R1-2: two controls with the same label: the one that had focus (the second) is refocused, not the first", async () => {
    render(
      <SideSheet open onClose={() => {}} title="Edit Expense">
        <button aria-label="Remove">x</button>
        <button aria-label="Remove">x</button>
      </SideSheet>,
    );
    await settle();
    screen.getAllByRole("button", { name: "Remove" })[1].focus();
    await flip(true);
    expect(document.activeElement, "the wrong row's Remove was focused").toBe(screen.getAllByRole("button", { name: "Remove" })[1]);
  });
  it("R1-2: a radio group sharing a name: the radio that had focus is refocused", async () => {
    render(
      <SideSheet open onClose={() => {}} title="Edit Expense">
        <input type="radio" name="pick" value="a" aria-describedby="x" />
        <input type="radio" name="pick" value="b" />
        <input type="radio" name="pick" value="c" />
      </SideSheet>,
    );
    await settle();
    const radio = (v: string) => document.querySelector(`input[value="${v}"]`) as HTMLElement;
    radio("c").focus();
    await flip(true);
    expect(document.activeElement, "the first radio of the group was focused").toBe(radio("c"));
  });
  it("R1-3: an id made by useId changes across the remount: the control is still refocused (by its position)", async () => {
    function Field() {
      const id = useId();
      return <input id={id} placeholder="generated id" />;
    }
    render(<SideSheet open onClose={() => {}} title="Edit Expense"><Field /></SideSheet>);
    await settle();
    const before = (screen.getByPlaceholderText("generated id") as HTMLInputElement).id;
    screen.getByPlaceholderText("generated id").focus();
    await flip(true);
    expect((screen.getByPlaceholderText("generated id") as HTMLInputElement).id, "the fixture's id did not change").not.toBe(before);
    expect(document.activeElement, "the id missed and focus was not restored to the field").toBe(screen.getByPlaceholderText("generated id"));
  });
  it("R1-4: the matched control is now disabled (Close, after closeDisabled): focus goes to the panel, not <body>", async () => {
    const el = (closeDisabled: boolean) => <SideSheet open onClose={() => {}} title="Edit Expense" closeDisabled={closeDisabled}><p>body</p></SideSheet>;
    const view = render(el(false));
    await settle();
    screen.getByRole("button", { name: "Close" }).focus();
    view.rerender(el(true));
    await flip(true);
    expect(document.activeElement, "focus fell to <body> on a disabled control").toBe(screen.getByRole("dialog"));
  });
  for (const [what, props] of [
    ["an id starting with a digit", { id: "1abc" }],
    ["an id with a quote, a bracket and a space", { id: 'say "hi" [x]' }],
    ["a label with a quote, a bracket and a space", { "aria-label": 'Say "hi" [x] now' }],
  ] as const) {
    it(`R1-5: ${what} is matched, and the lookup does not throw`, async () => {
      render(<SideSheet open onClose={() => {}} title="Edit Expense"><input {...props} placeholder="odd identifier" /></SideSheet>);
      await settle();
      screen.getByPlaceholderText("odd identifier").focus();
      await flip(true);
      expect(document.activeElement).toBe(screen.getByPlaceholderText("odd identifier"));
    });
  }
  it("R1-5: the focusin listener is removed when the sheet closes", async () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const el = (open: boolean) => <SideSheet open={open} onClose={() => {}} title="Edit Expense"><p>body</p></SideSheet>;
    const view = render(el(true));
    await settle();
    const listener = add.mock.calls.find((c) => c[0] === "focusin")?.[1];
    expect(listener, "no focusin listener added while open").toBeTruthy();
    view.rerender(el(false));
    await settle();
    expect(remove.mock.calls.some((c) => c[0] === "focusin" && c[1] === listener), "the focusin listener outlived the open sheet").toBe(true);
    add.mockRestore();
    remove.mockRestore();
  });
  it("R1-6: a refocused text field keeps its caret and selection", async () => {
    render(<Sheet />);
    await settle();
    const field = () => screen.getByLabelText("Description") as HTMLInputElement;
    fireEvent.change(field(), { target: { value: "Printer toner" } });
    field().focus();
    field().setSelectionRange(2, 7);
    await flip(true);
    expect(document.activeElement).toBe(field());
    expect([field().selectionStart, field().selectionEnd], "the caret and selection were lost").toEqual([2, 7]);
  });
});

describe("P263 R2: a position match never lands on a different field", () => {
  /** Rendered on one layout only: read when the child mounts, so the remounted panel has it or not. */
  function OnlyOn({ layout, children }: { layout: "phone" | "desktop"; children: ReactNode }) {
    return (layout === "phone") === phone ? <>{children}</> : null;
  }
  it("R2-1 (a): a desktop-only text input before B and C: B focused on a phone, then desktop: focus is not on the desktop-only input", async () => {
    phone = true;
    render(
      <SideSheet open onClose={() => {}} title="Edit Expense">
        <OnlyOn layout="desktop"><input data-testid="desktop-only" /></OnlyOn>
        <input data-testid="B" />
        <input data-testid="C" />
      </SideSheet>,
    );
    await settle();
    expect(layout()).toBe("phone");
    screen.getByTestId("B").focus();
    await flip(false);
    expect(document.activeElement, "focus moved to a different field").not.toBe(screen.getByTestId("desktop-only"));
    expect([screen.getByTestId("B"), screen.getByRole("dialog")], "focus left both the field and the panel").toContain(document.activeElement);
  });
  it("R2-1 (b): Retry before A and B, A focused, Retry then removed: after the flip focus is not on B", async () => {
    function WithRetry() {
      const [retry, setRetry] = useState(true);
      return (
        <SideSheet open onClose={() => {}} title="Edit Expense">
          {retry && <button onClick={() => setRetry(false)}>Retry</button>}
          <input data-testid="A" onKeyDown={() => setRetry(false)} />
          <input data-testid="B" />
        </SideSheet>
      );
    }
    render(<WithRetry />);
    await settle();
    screen.getByTestId("A").focus();
    fireEvent.keyDown(screen.getByTestId("A"), { key: "x" }); // Retry goes away while A keeps focus
    await settle();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("A"));
    await flip(true);
    expect(document.activeElement, "the index recorded before Retry went away put focus on B").not.toBe(screen.getByTestId("B"));
    // The snapshot is taken again when Retry goes away, so A itself (not only "not B") is refocused.
    expect(document.activeElement, "A was not refocused (the snapshot was not refreshed)").toBe(screen.getByTestId("A"));
  });
  it("R2-1 (c): a child's own state reveals 'extra' before 'next'; 'extra' focused, then a flip resets the child: focus is not on 'next'", async () => {
    function Reveal() {
      const [more, setMore] = useState(false);
      return (
        <>
          <button onClick={() => setMore(true)}>More</button>
          {more && <input data-testid="extra" />}
          <input data-testid="next" />
        </>
      );
    }
    render(<SideSheet open onClose={() => {}} title="Edit Expense"><Reveal /></SideSheet>);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    screen.getByTestId("extra").focus();
    await flip(true);
    expect(screen.queryByTestId("extra"), "the fixture's child was not reset by the remount").toBeNull();
    expect(document.activeElement, "focus moved to the next field").not.toBe(screen.getByTestId("next"));
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });
  it("R2-1: a field matched by its placeholder, with the position changed (as the expense form's fields are)", async () => {
    phone = true;
    render(
      <SideSheet open onClose={() => {}} title="Edit Expense">
        <OnlyOn layout="desktop"><input placeholder="Search" /></OnlyOn>
        <input placeholder="Vendor name" />
      </SideSheet>,
    );
    await settle();
    screen.getByPlaceholderText("Vendor name").focus();
    await flip(false);
    expect(document.activeElement).toBe(screen.getByPlaceholderText("Vendor name"));
  });
  it("R2-1: a field matched by its <label> text, with the position changed", async () => {
    phone = true;
    render(
      <SideSheet open onClose={() => {}} title="Edit Expense">
        <OnlyOn layout="desktop"><input placeholder="Search" /></OnlyOn>
        <label>Amount <input type="number" /></label>
      </SideSheet>,
    );
    await settle();
    const amount = () => screen.getByRole("spinbutton");
    amount().focus();
    await flip(false);
    expect(document.activeElement).toBe(amount());
  });
  it("R2-2: an aria-label field after a phone-only focusable: the label, not the position, finds it", async () => {
    render(
      <SideSheet open onClose={() => {}} title="Edit Expense">
        <OnlyOn layout="phone"><button>Phone only</button></OnlyOn>
        <input aria-label="Reference" />
      </SideSheet>,
    );
    await settle();
    screen.getByLabelText("Reference").focus();
    await flip(true);
    expect(document.activeElement, "the aria-label branch did not find the field").toBe(screen.getByLabelText("Reference"));
  });
  it("R2-2: the second of two 'Remove' buttons, after a phone-only focusable: the same one is refocused", async () => {
    render(
      <SideSheet open onClose={() => {}} title="Edit Expense">
        <OnlyOn layout="phone"><button>Phone only</button></OnlyOn>
        <button aria-label="Remove">x</button>
        <button aria-label="Remove">x</button>
      </SideSheet>,
    );
    await settle();
    screen.getAllByRole("button", { name: "Remove" })[1].focus();
    await flip(true);
    expect(document.activeElement, "the wrong Remove was focused").toBe(screen.getAllByRole("button", { name: "Remove" })[1]);
  });
  it("R2-2: a 'Remove' that gains a phone-only twin (3 matches, not 2): no stale index lands on another row", async () => {
    render(
      <SideSheet open onClose={() => {}} title="Edit Expense">
        <OnlyOn layout="phone"><button aria-label="Remove" data-row="phone">x</button></OnlyOn>
        <button aria-label="Remove" data-row="1">x</button>
        <button aria-label="Remove" data-row="2">x</button>
      </SideSheet>,
    );
    await settle();
    (document.querySelector('[data-row="2"]') as HTMLElement).focus();
    await flip(true);
    expect(document.activeElement, "matches[1] of a changed count focused row 1").not.toBe(document.querySelector('[data-row="1"]'));
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });
  it("R2-2: the focused 'Remove' exists on desktop only, its twin on both: the twin (another row) is not focused", async () => {
    render(
      <SideSheet open onClose={() => {}} title="Edit Expense">
        <OnlyOn layout="desktop"><button aria-label="Remove" data-row="desktop">x</button></OnlyOn>
        <button aria-label="Remove" data-row="both">x</button>
      </SideSheet>,
    );
    await settle();
    (document.querySelector('[data-row="desktop"]') as HTMLElement).focus();
    await flip(true);
    expect(document.activeElement, "a single match taken though there were two").not.toBe(document.querySelector('[data-row="both"]'));
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });
  it("R2-3: a tabindex=-1 element on one layout only does not count as a position", async () => {
    render(
      <SideSheet open onClose={() => {}} title="Edit Expense">
        <OnlyOn layout="phone"><div tabIndex={-1}>not in the tab order</div></OnlyOn>
        <input data-testid="unnamed" />
      </SideSheet>,
    );
    await settle();
    screen.getByTestId("unnamed").focus();
    await flip(true);
    expect(document.activeElement, "a tabindex=-1 element shifted the position").toBe(screen.getByTestId("unnamed"));
  });
});
