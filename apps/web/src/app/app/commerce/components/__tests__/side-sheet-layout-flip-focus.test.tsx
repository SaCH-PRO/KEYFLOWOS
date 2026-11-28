/**
 * P263 FU-SIDESHEET-LAYOUT-FLIP-FOCUS (launch-track, D-315). The commerce SideSheet keys its panel by useIsMobile(), so
 * a resize or a rotation while it is open remounts the panel: the focused control is removed, focus falls to <body>,
 * and the open-only focus effect (P257 R1-1) never refocuses. Across a layout flip focus stays in the sheet: on the
 * same control in the new panel when there is one (matched by id, name or accessible label, since the old node is
 * gone), otherwise on the panel. Pinned desktop -> phone -> desktop.
 *
 * R3 (P269 folded in): the children are no longer remounted by a flip. They are the same nodes, with their state, and
 * the node focused before the flip is the one focused after it. The tests below hold the node itself, not a lookup.
 * Dropped with the matching they pinned (no matching is left to pin): R1-1 position match; a position that no longer
 * agrees; R1-5 odd ids and labels (x3); R2-1 placeholder match; R2-1 <label> match; R2-2 aria-label after a
 * phone-only focusable; R2-3 tabindex=-1 positions.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";

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
      const node = find();
      node.focus();
      expect(document.activeElement).toBe(find());
      await flip(true);
      expect(layout(), "the flip did not reach the sheet").toBe("phone");
      expect(document.activeElement, `focus left ${what} on the flip to phone`).toBe(find());
      await flip(false);
      expect(layout()).toBe("desktop");
      expect(document.activeElement, `focus left ${what} on the flip back to desktop`).toBe(find());
      // R3: a child is the same node throughout; the header's Close is the new shell's own Close.
      if (what !== "the header Close") expect(find(), `${what} was remounted by the flip`).toBe(node);
    });
  }
  it("the panel itself focused (as on open): it is focused again in the new layout", async () => {
    render(<Sheet />);
    await settle();
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    await flip(true);
    expect(document.activeElement, "focus fell to <body>").toBe(screen.getByRole("dialog"));
  });
  it("R3: a field with no identifier at all (no id, name, label or placeholder) keeps focus: the same node", async () => {
    render(<SideSheet open onClose={() => {}} title="Edit Expense"><input data-testid="bare" /><input data-testid="other" /></SideSheet>);
    await settle();
    const bare = screen.getByTestId("bare");
    bare.focus();
    await flip(true);
    expect(document.activeElement, "the bare field lost focus").toBe(bare);
    expect(screen.getByTestId("bare"), "the bare field was remounted").toBe(bare);
    await flip(false);
    expect(document.activeElement).toBe(bare);
  });
  it("R3: a child's own state and its uncontrolled draft survive the flip; the child mounts once", async () => {
    let mounts = 0;
    function Stateful() {
      const [count, setCount] = useState(0);
      useEffect(() => { mounts += 1; }, []);
      return (
        <>
          <button onClick={() => setCount((n) => n + 1)}>Count {count}</button>
          <input aria-label="Draft" defaultValue="" />
        </>
      );
    }
    render(<SideSheet open onClose={() => {}} title="Edit Expense"><Stateful /></SideSheet>);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Count 0" }));
    fireEvent.click(screen.getByRole("button", { name: "Count 1" }));
    const draft = screen.getByLabelText("Draft") as HTMLInputElement;
    draft.value = "half a sentence";
    draft.focus();
    draft.setSelectionRange(4, 4);
    await flip(true);
    await flip(false);
    expect(screen.getByRole("button", { name: "Count 2" }), "the child's state was reset").toBeTruthy();
    expect((screen.getByLabelText("Draft") as HTMLInputElement).value, "the typed draft was lost").toBe("half a sentence");
    expect(document.activeElement).toBe(draft);
    expect([draft.selectionStart, draft.selectionEnd]).toEqual([4, 4]);
    expect(mounts, "the child was remounted by a flip").toBe(1);
  });
  it("R3: a footer button focused: the new shell's same button is focused", async () => {
    render(<SideSheet open onClose={() => {}} title="Edit Expense" footer={<><button>Cancel</button><button>Save</button></>}><p>body</p></SideSheet>);
    await settle();
    screen.getByRole("button", { name: "Save" }).focus();
    await flip(true);
    expect(document.activeElement, "focus left the footer's Save").toBe(screen.getByRole("button", { name: "Save" }));
    await flip(false);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save" }));
  });
  it("R3: closing removes the children (after the exit), and reopening mounts them fresh", async () => {
    function Draft() {
      const [v, setV] = useState("");
      return <input aria-label="Draft" value={v} onChange={(e) => setV(e.target.value)} />;
    }
    const el = (open: boolean) => <SideSheet open={open} onClose={() => {}} title="Edit Expense"><Draft /></SideSheet>;
    const view = render(el(true));
    await settle();
    fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "x" } });
    view.rerender(el(false));
    await waitFor(() => expect(screen.queryByLabelText("Draft"), "the children outlived the closed sheet").toBeNull());
    view.rerender(el(true));
    await settle();
    expect((screen.getByLabelText("Draft") as HTMLInputElement).value, "a reopened sheet kept the old draft").toBe("");
  });
  it("R3: a child mounts into the document: its layout effect sees itself connected, and autoFocus lands", async () => {
    const seen: boolean[] = [];
    function Measures() {
      const ref = useRef<HTMLDivElement>(null);
      useLayoutEffect(() => { seen.push(!!ref.current?.isConnected); }, []);
      return <div ref={ref}>measured</div>;
    }
    render(<SideSheet open onClose={() => {}} title="Edit Expense"><Measures /><input aria-label="First" autoFocus /></SideSheet>);
    expect(seen, "the child's layout effect ran on a detached node").toEqual([true]);
    await settle();
    expect(screen.getByText("measured").closest('[role="dialog"]'), "the child is not in the panel").toBe(screen.getByRole("dialog"));
  });
  it("R3: reopened while it is still animating out: the late exit-complete does not remove the open sheet's children", async () => {
    const el = (open: boolean) => <SideSheet open={open} onClose={() => {}} title="Edit Expense"><input aria-label="Draft" /></SideSheet>;
    const view = render(el(true));
    await settle();
    view.rerender(el(false));
    view.rerender(el(true)); // before the exit has finished
    await act(async () => { await new Promise((r) => setTimeout(r, 1200)); }); // longer than the exit animation
    expect(screen.queryByLabelText("Draft"), "the open sheet lost its children when the old exit completed").not.toBeNull();
    expect(screen.getByLabelText("Draft").closest('[role="dialog"]')).toBe(screen.getByRole("dialog"));
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
    const second = screen.getAllByRole("button", { name: "Remove" })[1];
    second.focus();
    await flip(true);
    expect(document.activeElement, "the wrong row's Remove was focused").toBe(second);
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
    const c = radio("c");
    c.focus();
    await flip(true);
    expect(document.activeElement, "the first radio of the group was focused").toBe(c);
  });
  it("R1-3 (R3): an id made by useId does not change across the flip: the same field keeps it and focus", async () => {
    function Field() {
      const id = useId();
      return <input id={id} placeholder="generated id" />;
    }
    render(<SideSheet open onClose={() => {}} title="Edit Expense"><Field /></SideSheet>);
    await settle();
    const field = screen.getByPlaceholderText("generated id") as HTMLInputElement;
    const before = field.id;
    field.focus();
    await flip(true);
    expect(screen.getByPlaceholderText("generated id"), "the field was remounted").toBe(field);
    expect(field.id, "the id changed (the child was remounted)").toBe(before);
    expect(document.activeElement).toBe(field);
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

describe("P263 R2 probes, R3: the focused node itself is kept, so focus never lands on a different field", () => {
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
    const b = screen.getByTestId("B");
    b.focus();
    await flip(false);
    expect(document.activeElement, "focus moved to a different field").not.toBe(screen.queryByTestId("desktop-only"));
    expect(document.activeElement, "B itself was not refocused").toBe(b);
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
    const a = screen.getByTestId("A");
    a.focus();
    fireEvent.keyDown(screen.getByTestId("A"), { key: "x" }); // Retry goes away while A keeps focus
    await settle();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("A"));
    await flip(true);
    expect(document.activeElement, "the index recorded before Retry went away put focus on B").not.toBe(screen.getByTestId("B"));
    expect(document.activeElement, "A itself was not refocused").toBe(a);
    expect(screen.queryByRole("button", { name: "Retry" }), "the parent's state (Retry gone) was reset").toBeNull();
  });
  it("R2-1 (c), R3: a child's own state reveals 'extra' before 'next'; 'extra' focused: the flip keeps the child's state and focus on 'extra'", async () => {
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
    const extra = screen.getByTestId("extra");
    extra.focus();
    await flip(true);
    expect(document.activeElement, "focus moved to the next field").not.toBe(screen.getByTestId("next"));
    expect(screen.queryByTestId("extra"), "the child's state was reset by the flip").toBe(extra);
    expect(document.activeElement, "'extra' itself was not refocused").toBe(extra);
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
    const second = screen.getAllByRole("button", { name: "Remove" })[1];
    second.focus();
    await flip(true);
    expect(document.activeElement, "the wrong Remove was focused").toBe(second);
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
    const row2 = document.querySelector('[data-row="2"]') as HTMLElement;
    row2.focus();
    await flip(true);
    expect(document.activeElement, "matches[1] of a changed count focused row 1").not.toBe(document.querySelector('[data-row="1"]'));
    expect(document.activeElement, "row 2 itself was not refocused").toBe(row2);
  });
  it("R2-2: the focused 'Remove' exists on desktop only, its twin on both: the twin (another row) is not focused", async () => {
    render(
      <SideSheet open onClose={() => {}} title="Edit Expense">
        <OnlyOn layout="desktop"><button aria-label="Remove" data-row="desktop">x</button></OnlyOn>
        <button aria-label="Remove" data-row="both">x</button>
      </SideSheet>,
    );
    await settle();
    const desktopRow = document.querySelector('[data-row="desktop"]') as HTMLElement;
    desktopRow.focus();
    await flip(true);
    expect(document.activeElement, "a single match taken though there were two").not.toBe(document.querySelector('[data-row="both"]'));
    expect(document.activeElement, "the focused row itself was not kept").toBe(desktopRow);
  });
});

describe("P263 R2-4, R3: a focus change costs nothing, and a flip with a child focused reads nothing either", () => {
  it("in a 300-row panel, moving focus between fields makes no query of the panel", async () => {
    const rows = Array.from({ length: 300 }, (_, i) => i);
    render(
      <SideSheet open onClose={() => {}} title="Edit Expense">
        {rows.map((i) => <input key={i} aria-label={`Row ${i}`} />)}
      </SideSheet>,
    );
    await settle();
    // The fields are looked up first: the test's own queries are not the sheet's.
    const fields = [3, 150, 299, 0].map((i) => screen.getByLabelText(`Row ${i}`));
    const queries = vi.spyOn(Element.prototype, "querySelectorAll");
    for (const field of fields) field.focus();
    await settle();
    const calls = queries.mock.calls.length;
    queries.mockRestore();
    expect(calls, "a focus change scanned the panel").toBe(0);
  });
  it("a burst of content changes while a field is focused makes no query; nor does the flip (the node is kept)", async () => {
    function Totals() {
      const [text, setText] = useState("");
      return (
        <SideSheet open onClose={() => {}} title="Edit Expense">
          <input aria-label="Amount" value={text} onChange={(e) => setText(e.target.value)} />
          <p>Total: {text.length * 3}</p>
          {Array.from({ length: 300 }, (_, i) => <input key={i} aria-label={`Row ${i}`} />)}
        </SideSheet>
      );
    }
    render(<Totals />);
    await settle();
    const amount = screen.getByLabelText("Amount") as HTMLInputElement;
    amount.focus();
    const queries = vi.spyOn(Element.prototype, "querySelectorAll");
    for (const v of ["1", "12", "123", "1234", "12345"]) fireEvent.change(amount, { target: { value: v } }); // each re-renders the total
    await settle();
    expect(queries.mock.calls.length, "content changes while focused scanned the panel").toBe(0);
    await flip(true);
    const atFlip = queries.mock.calls.length;
    queries.mockRestore();
    expect(atFlip, "the flip searched the panel for a node it kept").toBe(0);
    expect(document.activeElement).toBe(screen.getByLabelText("Amount"));
  });
  it("control: the flip keeps focus on the field among 300 rows", async () => {
    const rows = Array.from({ length: 300 }, (_, i) => i);
    render(
      <SideSheet open onClose={() => {}} title="Edit Expense">
        {rows.map((i) => <input key={i} aria-label={`Row ${i}`} />)}
      </SideSheet>,
    );
    await settle();
    const row = screen.getByLabelText("Row 150");
    row.focus();
    await flip(true);
    expect(document.activeElement).toBe(row);
  });
});
