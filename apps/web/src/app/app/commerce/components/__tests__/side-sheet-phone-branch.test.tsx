/**
 * MOUNT-QUOTES (journey D1, D2 on a phone): the commerce side sheet opens on
 * screen on a phone.
 *
 * useIsMobile() starts false and flips in an effect, so a sheet that mounts
 * when it opens renders its desktop branch for one frame (a panel sliding in
 * from x: 100%) and then its phone branch (a bottom sheet sliding up from
 * y: 100%). Both branches were the same element type in the same slot, so
 * React reused the DOM node and framer-motion kept the desktop slide's x in
 * flight: on a 375px viewport the bottom sheet sat translated 345px to the
 * right, with Create / Update Quote at x=551, off screen (journey D1 and D2
 * found the button "covered by nothing (off screen)").
 *
 * THE RULE: the two branches are distinct elements (keyed), so a phone's
 * sheet never inherits the desktop slide; its transform carries no x offset.
 *
 *   SSP-01  RED-BEFORE  on a phone (matchMedia max-width matches) the open sheet's dialog carries no translateX
 *   SSP-02  control     on a desktop the sheet is the right-hand panel, as before
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

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
afterEach(cleanup);

const xOffset = (el: HTMLElement) => {
  const t = el.style.transform;
  const m = t.match(/translateX\(([-\d.]+)(px|%)\)/);
  return m ? `${m[1]}${m[2]}` : t.includes("translate3d") ? t : "none";
};

describe("MOUNT-QUOTES: the commerce side sheet on a phone", () => {
  it("SSP-01 RED-BEFORE: on a phone the open sheet carries no x offset from the desktop slide", async () => {
    mobile = true;
    await act(async () => {
      render(
        <SideSheet open onClose={() => {}} title="New Quote" footer={<button type="button">Create Quote</button>}>
          <p>body</p>
        </SideSheet>,
      );
    });
    const dialog = screen.getByRole("dialog", { name: "New Quote" });
    // The phone branch: the bottom sheet (rounded top), not the right-hand panel.
    expect(dialog.className).toContain("rounded-t-2xl");
    expect(dialog.style.transform, `transform was ${dialog.style.transform}`).not.toMatch(/translateX\((?!0)/);
    expect(xOffset(dialog)).toMatch(/^(none|0px|0%)$/);
  });

  it("SSP-02 control: on a desktop the sheet is the right-hand panel", async () => {
    mobile = false;
    await act(async () => {
      render(
        <SideSheet open onClose={() => {}} title="New Quote">
          <p>body</p>
        </SideSheet>,
      );
    });
    const dialog = screen.getByRole("dialog", { name: "New Quote" });
    expect(dialog.className).toContain("right-0");
  });
});
