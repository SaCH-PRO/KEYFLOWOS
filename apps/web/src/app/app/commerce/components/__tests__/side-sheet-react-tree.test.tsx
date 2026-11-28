/**
 * P263 R4 (review B of R3): the R3 portal was rendered beside the sheet's AnimatePresence, so in the React tree (where
 * context and events flow) the children no longer sat under the overlay and panel. Three consequences, each pinned
 * here as main behaves:
 *   R4-1 presence: a child reads the sheet's own presence, not the caller's. Under a caller's
 *        <AnimatePresence mode="wait">, a usePresence child no longer holds the old sheet on a key switch, and when
 *        the sheet closes a child sees itself leaving (its own exit runs);
 *   R4-2 events: a click inside the sheet does not bubble (React tree) to an ancestor's onClick;
 *   R4-3 hydration: a sheet rendered open on the server hydrates with no error.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { AnimatePresence, usePresence } from "framer-motion";

import { SideSheet } from "../side-sheet";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe("P263 R4-1: the children read the sheet's own presence", () => {
  it("under a caller's AnimatePresence mode=wait, a usePresence child does not hold the old sheet on a key switch", async () => {
    /** Never says it is safe to remove: if it is registered with the caller's presence, the caller waits on it forever. */
    function Holder({ label }: { label: string }) {
      usePresence();
      return <p>{label}</p>;
    }
    function Caller() {
      const [k, setK] = useState("A");
      return (
        <>
          <button onClick={() => setK("B")}>switch</button>
          <AnimatePresence mode="wait">
            <SideSheet key={k} open onClose={() => {}} title={`Sheet ${k}`}><Holder label={`child ${k}`} /></SideSheet>
          </AnimatePresence>
        </>
      );
    }
    render(<Caller />);
    await wait(30);
    fireEvent.click(screen.getByRole("button", { name: "switch" }));
    await wait(300);
    expect(screen.queryByText("child A"), "the old sheet's child held the caller's exit").toBeNull();
    expect(screen.queryByText("child B"), "the new sheet never mounted (mode=wait still waiting on A)").not.toBeNull();
  });
  it("a child sees itself present while the sheet is open, and leaving when the sheet closes (its exit runs)", async () => {
    const seen: boolean[] = [];
    function Watcher() {
      const [isPresent, safeToRemove] = usePresence();
      useEffect(() => {
        seen.push(isPresent);
        if (!isPresent) safeToRemove?.();
      }, [isPresent, safeToRemove]);
      return <p>watched</p>;
    }
    const el = (open: boolean) => <SideSheet open={open} onClose={() => {}} title="Edit Expense"><Watcher /></SideSheet>;
    const view = render(el(true));
    await wait(30);
    expect(seen, "the child is not present in an open sheet").toEqual([true]);
    view.rerender(el(false));
    await wait(30);
    expect(seen, "the child never saw the sheet close (its exit would not run)").toContain(false);
    await wait(800);
    expect(screen.queryByText("watched")).toBeNull();
  });
});

describe("P263 R4-2: a click inside the sheet does not reach an ancestor's onClick", () => {
  it("a button among the children: the ancestor's handler is not called", async () => {
    const ancestor = vi.fn();
    const inner = vi.fn();
    render(
      <div onClick={ancestor}>
        <SideSheet open onClose={() => {}} title="Edit Expense"><button onClick={inner}>inner</button></SideSheet>
      </div>,
    );
    await wait(30);
    fireEvent.click(screen.getByRole("button", { name: "inner" }));
    expect(inner).toHaveBeenCalledTimes(1);
    expect(ancestor, "the click bubbled out of the sheet").not.toHaveBeenCalled();
  });
  it("control: a click on the header's Close does not reach the ancestor either", async () => {
    const ancestor = vi.fn();
    render(<div onClick={ancestor}><SideSheet open onClose={() => {}} title="Edit Expense"><p>body</p></SideSheet></div>);
    await wait(30);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(ancestor).not.toHaveBeenCalled();
  });
});

describe("P263 R4-3: a sheet rendered open on the server hydrates with no error", () => {
  it("hydrateRoot of an open sheet: no recoverable error, no console error, and the children are shown", async () => {
    const tree = <SideSheet open onClose={() => {}} title="Edit Expense"><input aria-label="Description" /></SideSheet>;
    vi.stubGlobal("document", undefined);
    const html = renderToString(tree);
    vi.unstubAllGlobals();
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    const recoverable = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let root: ReturnType<typeof hydrateRoot> | null = null;
    await act(async () => { root = hydrateRoot(host, tree, { onRecoverableError: recoverable }); });
    await wait(30);
    expect(recoverable.mock.calls.map((c) => String(c[0])), "hydration failed").toEqual([]);
    expect(consoleError.mock.calls.map((c) => String(c[0])).filter((m) => /hydrat/i.test(m)), "a hydration error was logged").toEqual([]);
    expect(screen.getByLabelText("Description").closest('[role="dialog"]'), "the children are not in the panel").not.toBeNull();
    act(() => root?.unmount());
    host.remove();
  });
});
