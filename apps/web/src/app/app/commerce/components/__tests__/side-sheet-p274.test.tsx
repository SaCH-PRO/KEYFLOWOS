/**
 * P263 R5, board row P274 (D-331: every NIT fixed before merge).
 *   P274-1  a flip does not blur the focused child, nor focus it again: Chromium fires blur and focusout on a focused
 *           node when the old shell is removed (jsdom does not, so that is reproduced here), and the refocus fired
 *           focus and React's onFocus. A child closing a popover on blur (150 ms after it, as compose-modal's contacts
 *           list does) closed it on every flip. A flip that cannot put focus back on the child does tell it, and React,
 *           that it lost focus; closing the sheet is a real blur.
 *   P274-2  the footer is not remounted by a flip: its state and its nodes are kept, like the children's.
 *   P274-3  a child's autoFocus is respected: the open-time focus of the panel does not move focus that is already in
 *           the sheet, and closing returns focus to what had it before the sheet opened (not to the autoFocused child).
 *           A sheet closed before that frame does not take focus.
 *   P274-4  Escape closes only the topmost open sheet (stacked or nested; a QuickSheet over a SideSheet too).
 *   P274-5  nothing of a closed or unmounted sheet stays reachable from the containers it keeps: they are detached.
 *   P274-6  the wrappers that stop clicks at the sheet are display: contents (no box in the layout).
 * P274-7 (the caret restore in WebKit and Firefox) is a browser check, outside jsdom: see the R5 PROGRESS comment.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { StrictMode, useEffect, useRef, useState, type ReactNode } from "react";
import { render, screen, cleanup, act, fireEvent, waitFor } from "@testing-library/react";

import { SideSheet, QuickSheet } from "../side-sheet";

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

const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const settle = () => wait(30);
async function flip(toPhone: boolean) {
  phone = toPhone;
  act(() => { for (const fn of [...listeners]) fn({ matches: toPhone } as MediaQueryListEvent); });
  await settle();
}

/**
 * Chromium fires blur, then focusout, on the focused element when it (or an ancestor) is removed or moved; jsdom
 * fires nothing. Reproduced for the removals and moves made while installed (measured in Chromium at e85d47c: one
 * native blur on the To field per flip).
 */
function chromiumBlurOnRemove() {
  const proto = Node.prototype;
  const { appendChild, insertBefore, removeChild } = proto;
  const { remove } = Element.prototype;
  const blurIfInside = (n: Node) => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body || !n.isConnected || !n.contains(a)) return;
    a.dispatchEvent(new FocusEvent("blur"));
    a.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  };
  proto.appendChild = function <T extends Node>(this: Node, n: T): T { blurIfInside(n); return appendChild.call(this, n) as T; };
  proto.insertBefore = function <T extends Node>(this: Node, n: T, ref: Node | null): T { blurIfInside(n); return insertBefore.call(this, n, ref) as T; };
  proto.removeChild = function <T extends Node>(this: Node, n: T): T { blurIfInside(n); return removeChild.call(this, n) as T; };
  Element.prototype.remove = function (this: Element) { blurIfInside(this); remove.call(this); };
  return () => { proto.appendChild = appendChild; proto.insertBefore = insertBefore; proto.removeChild = removeChild; Element.prototype.remove = remove; };
}

describe("P274-1: a flip does not blur the focused child", () => {
  let restore: () => void = () => {};
  beforeEach(() => { restore = chromiumBlurOnRemove(); });
  afterEach(() => restore());
  const seen = { nativeBlurs: 0, reactBlurs: 0, reactFocuses: 0 };
  beforeEach(() => { seen.nativeBlurs = 0; seen.reactBlurs = 0; seen.reactFocuses = 0; });
  /**
   * A To field whose contacts list opens on focus and closes 150 ms after a blur, as compose-modal's does; the close is
   * on the field's native blur (as a widget that listens with addEventListener does): in Chromium that blur fired on
   * every flip, while React's onBlur did not (React's events are off while it commits), and React's onFocus fired again.
   */
  function ToField({ disabled = false }: { disabled?: boolean }) {
    const [show, setShow] = useState(false);
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => {
      const el = ref.current!;
      const onBlur = () => { seen.nativeBlurs++; setTimeout(() => setShow(false), 150); };
      el.addEventListener("blur", onBlur);
      return () => el.removeEventListener("blur", onBlur);
    }, []);
    return (
      <>
        <input ref={ref} aria-label="To" disabled={disabled} onFocus={() => { seen.reactFocuses++; setShow(true); }} onBlur={() => { seen.reactBlurs++; }} />
        {show && <ul aria-label="Contacts"><li>Ana</li></ul>}
        <input aria-label="Subject" />
      </>
    );
  }
  const sheet = (disabled = false) => <SideSheet open onClose={() => {}} title="Compose"><ToField disabled={disabled} /></SideSheet>;
  it("the contacts list stays open across desktop -> phone -> desktop; the field is neither blurred nor focused again", async () => {
    render(sheet());
    await settle();
    act(() => { screen.getByLabelText("To").focus(); });
    expect(screen.queryByLabelText("Contacts")).not.toBeNull();
    const before = { ...seen };
    await flip(true);
    await wait(200);
    expect(seen.nativeBlurs - before.nativeBlurs, "the flip blurred the field").toBe(0);
    expect(screen.queryByLabelText("Contacts"), "the flip closed the contacts list").not.toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText("To"));
    await flip(false);
    await wait(200);
    expect(seen.nativeBlurs - before.nativeBlurs).toBe(0);
    expect(seen.reactBlurs - before.reactBlurs).toBe(0);
    expect(seen.reactFocuses - before.reactFocuses, "the flip told the field it was focused again").toBe(0);
    expect(screen.queryByLabelText("Contacts")).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText("To"));
  });
  it("control: a real blur (focus moves to Subject) still closes the list, and React hears it", async () => {
    render(sheet());
    await settle();
    act(() => { screen.getByLabelText("To").focus(); });
    act(() => { screen.getByLabelText("Subject").focus(); });
    await wait(200);
    expect(seen.nativeBlurs).toBe(1);
    expect(seen.reactBlurs).toBe(1);
    expect(screen.queryByLabelText("Contacts")).toBeNull();
  });
  it("a flip that cannot put focus back on the field (it became disabled) tells it, and React, that it lost focus", async () => {
    const view = render(sheet());
    await settle();
    act(() => { screen.getByLabelText("To").focus(); });
    view.rerender(sheet(true));
    await settle();
    const before = { ...seen };
    await flip(true);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    expect(seen.nativeBlurs - before.nativeBlurs, "the field lost focus and was not told").toBe(1);
    expect(seen.reactBlurs - before.reactBlurs, "React's onBlur did not hear it").toBe(1);
  });
  it("control: closing the sheet with the field focused is a real blur (not hidden)", async () => {
    const el = (open: boolean) => <SideSheet open={open} onClose={() => {}} title="Compose"><ToField /></SideSheet>;
    const view = render(el(true));
    await settle();
    act(() => { screen.getByLabelText("To").focus(); });
    view.rerender(el(false));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(seen.nativeBlurs).toBe(1);
  });
});

describe("P274-2: the footer is not remounted by a flip", () => {
  it("its state, its nodes and its focus are kept", async () => {
    let mounts = 0;
    function Counter() {
      const [n, setN] = useState(0);
      useEffect(() => { mounts++; }, []);
      return <button onClick={() => setN((x) => x + 1)}>Clicked {n}</button>;
    }
    render(<SideSheet open onClose={() => {}} title="Edit Expense" footer={<Counter />}><p>body</p></SideSheet>);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Clicked 0" }));
    fireEvent.click(screen.getByRole("button", { name: "Clicked 1" }));
    const node = screen.getByRole("button", { name: "Clicked 2" });
    node.focus();
    await flip(true);
    expect(screen.queryByRole("button", { name: "Clicked 2" }), "the footer's state was lost").not.toBeNull();
    expect(screen.getByRole("button", { name: "Clicked 2" }), "the footer was remounted").toBe(node);
    expect(mounts).toBe(1);
    expect(document.activeElement).toBe(node);
    expect(node.closest('[role="dialog"]')).toBe(screen.getByRole("dialog"));
    await flip(false);
    expect(screen.getByRole("button", { name: "Clicked 2" })).toBe(node);
    expect(document.activeElement).toBe(node);
    expect(mounts).toBe(1);
  });
});

describe("P274-2 with P273-1: the footer is the footer's, not the shell's", () => {
  const headerClose = () => screen.getAllByRole("button", { name: "Close" }).find((b) => !b.hasAttribute("data-footer"));
  it("a footer 'Close' focused, then removed, then a flip: the panel is focused, not the header's Close", async () => {
    const el = (show: boolean) => (
      <SideSheet open onClose={() => {}} title="Edit Expense" footer={show ? <button aria-label="Close" data-footer="" /> : <span>done</span>}>
        <p>body</p>
      </SideSheet>
    );
    const view = render(el(true));
    await settle();
    (document.querySelector("button[data-footer]") as HTMLElement).focus();
    view.rerender(el(false));
    await settle();
    await flip(true);
    expect(document.activeElement, "focus was given to the header's Close, a control the user never focused").not.toBe(headerClose());
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });
  it("the header's Close focused, with a footer 'Close' too: the new shell's header Close is focused", async () => {
    render(<SideSheet open onClose={() => {}} title="Edit Expense" footer={<button aria-label="Close" data-footer="" />}><p>body</p></SideSheet>);
    await settle();
    headerClose()!.focus();
    await flip(true);
    expect(document.activeElement, "the footer's Close made the header's ambiguous").toBe(headerClose());
  });
});

describe("P274-3: a child's autoFocus is respected", () => {
  function Opener({ children }: { children: (open: boolean, close: () => void) => ReactNode }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open</button>
        {children(open, () => setOpen(false))}
      </>
    );
  }
  it("an autoFocus field keeps focus after the open frame; closing returns focus to the opener", async () => {
    render(
      <Opener>
        {(open, close) => (
          <SideSheet open={open} onClose={close} title="Edit Expense"><input aria-label="First" autoFocus /></SideSheet>
        )}
      </Opener>,
    );
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);
    await settle();
    expect(document.activeElement, "the open frame moved focus off the autoFocus field").toBe(screen.getByLabelText("First"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement, "focus did not return to the opener").toBe(opener);
  });
  it("control: with no autoFocus, the panel is focused on open", async () => {
    render(<SideSheet open onClose={() => {}} title="Edit Expense"><input aria-label="First" /></SideSheet>);
    await settle();
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });
  it("a sheet closed before the open frame does not take focus in that frame", async () => {
    const el = (open: boolean) => (
      <>
        <button>Opener</button>
        <SideSheet open={open} onClose={() => {}} title="Edit Expense"><input aria-label="First" /></SideSheet>
      </>
    );
    const view = render(el(false));
    const opener = screen.getByRole("button", { name: "Opener" });
    opener.focus();
    view.rerender(el(true));
    view.rerender(el(false)); // in the same frame
    await wait(30);
    expect(document.activeElement, "the closing sheet took focus in its open frame").toBe(opener);
  });
});

describe("P274-4: Escape closes only the topmost sheet", () => {
  const esc = () => act(() => { fireEvent.keyDown(document, { key: "Escape" }); });
  it("two stacked sheets: only the later (on top) closes", async () => {
    const a = vi.fn(), b = vi.fn();
    render(
      <>
        <SideSheet open onClose={a} title="First"><p>a</p></SideSheet>
        <SideSheet open onClose={b} title="Second"><p>b</p></SideSheet>
      </>,
    );
    await settle();
    esc();
    expect(b).toHaveBeenCalledTimes(1);
    expect(a, "the sheet underneath closed too").not.toHaveBeenCalled();
  });
  it("a sheet opened inside another's children: only the inner one closes; then Escape closes the outer", async () => {
    const outer = vi.fn();
    function Outer() {
      const [inner, setInner] = useState(true);
      return (
        <SideSheet open onClose={outer} title="Outer">
          <SideSheet open={inner} onClose={() => setInner(false)} title="Inner"><p>inner</p></SideSheet>
        </SideSheet>
      );
    }
    render(<Outer />);
    await settle();
    esc();
    expect(outer, "the outer sheet closed with the inner one").not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1));
    esc();
    expect(outer).toHaveBeenCalledTimes(1);
  });
  it("the topmost sheet cannot be closed (closeDisabled): Escape closes nothing", async () => {
    const a = vi.fn(), b = vi.fn();
    render(
      <>
        <SideSheet open onClose={a} title="First"><p>a</p></SideSheet>
        <SideSheet open onClose={b} title="Second" closeDisabled><p>b</p></SideSheet>
      </>,
    );
    await settle();
    esc();
    expect(b).not.toHaveBeenCalled();
    expect(a, "the sheet underneath closed instead").not.toHaveBeenCalled();
  });
  it("a QuickSheet over a SideSheet: only the QuickSheet closes", async () => {
    const side = vi.fn(), quick = vi.fn();
    render(
      <>
        <SideSheet open onClose={side} title="Side"><p>s</p></SideSheet>
        <QuickSheet open onClose={quick} title="Quick"><p>q</p></QuickSheet>
      </>,
    );
    await settle();
    esc();
    expect(quick).toHaveBeenCalledTimes(1);
    expect(side).not.toHaveBeenCalled();
  });
  it("control: one sheet, Escape closes it", async () => {
    const a = vi.fn();
    render(<SideSheet open onClose={a} title="Only"><p>a</p></SideSheet>);
    await settle();
    esc();
    expect(a).toHaveBeenCalledTimes(1);
  });
});

describe("P274-5: a closed or unmounted sheet's containers hold nothing of it", () => {
  const containers = () => [screen.getByText("body").parentElement!.parentElement!, screen.getByText("Save").parentElement!.parentElement!];
  it("after unmount, the children's and the footer's containers are detached (no shell is reachable from them)", async () => {
    const view = render(<SideSheet open onClose={() => {}} title="Edit Expense" footer={<button>Save</button>}><p>body</p></SideSheet>);
    await settle();
    const kept = containers();
    for (const c of kept) expect(c.closest('[role="dialog"]')).not.toBeNull();
    view.unmount();
    for (const c of kept) expect(c.parentNode, "a detached shell is still reachable from a kept container").toBeNull();
  });
  it("after closing (the exit done), the containers are detached; reopening puts them back", async () => {
    const el = (open: boolean) => <SideSheet open={open} onClose={() => {}} title="Edit Expense" footer={<button>Save</button>}><p>body</p></SideSheet>;
    const view = render(el(true));
    await settle();
    const kept = containers();
    view.rerender(el(false));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    for (const c of kept) expect(c.parentNode, "the closed sheet's shell is still reachable").toBeNull();
    view.rerender(el(true));
    await settle();
    expect(screen.getByText("body").closest('[role="dialog"]')).toBe(screen.getByRole("dialog"));
    expect(screen.getByText("Save").closest('[role="dialog"]')).toBe(screen.getByRole("dialog"));
  });
});

describe("P274-5 control: StrictMode", () => {
  it("under StrictMode (its effects and refs run twice on mount) the children and the footer are in the open sheet, and a flip keeps them", async () => {
    render(<StrictMode><SideSheet open onClose={() => {}} title="Edit Expense" footer={<button>Save</button>}><p>body</p></SideSheet></StrictMode>);
    await settle();
    expect(screen.getByText("body").closest('[role="dialog"]')).toBe(screen.getByRole("dialog"));
    expect(screen.getByText("Save").closest('[role="dialog"]')).toBe(screen.getByRole("dialog"));
    await flip(true);
    expect(screen.getByText("body").closest('[role="dialog"]')).toBe(screen.getByRole("dialog"));
    expect(screen.getByText("Save").closest('[role="dialog"]')).toBe(screen.getByRole("dialog"));
  });
});

describe("P274-6: the click-stop wrappers have no box", () => {
  it("the children's and the footer's wrappers are display: contents", async () => {
    render(<SideSheet open onClose={() => {}} title="Edit Expense" footer={<button>Save</button>}><p>body</p></SideSheet>);
    await settle();
    expect(screen.getByText("body").parentElement!.style.display).toBe("contents");
    expect(screen.getByText("Save").parentElement!.style.display).toBe("contents");
  });
});
