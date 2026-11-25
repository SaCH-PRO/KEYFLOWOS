/**
 * FU-SIDESHEET-MOBILE-OFFSET (owner ruling D-283; journey C on a phone): the shared SideSheet
 * (components/ui/side-sheet.tsx) opens in place on a phone.
 *
 * THE DEFECT. useIsMobile() starts false and learns the phone width in an effect after the first
 * render. A SideSheet that mounts already open (the store's order sheet, mounted when an order is
 * picked; the + New > From WhatsApp sheet) therefore renders its desktop layout first: a
 * right-hand panel sliding in from x: 100%. The effect then flips it to the phone layout, a bottom
 * sheet sliding up from y: 100%. Both layouts were the same element in the same slot, so React
 * reused the node and framer-motion kept the desktop slide's x: on a 375px screen the bottom sheet
 * sat off the right edge.
 *
 * THE RULE (definition of done: "a SideSheet mounted open at 375px is fully on screen"). On a
 * phone the sheet's first render is already the phone layout, and it never carries the desktop
 * slide's x offset; nothing in its layout waits for an effect. A desktop keeps the right-hand
 * panel. The server render and the first client render agree, so an open sheet hydrates without
 * a mismatch.
 *
 * jsdom has no layout, so "on screen" is read from what the browser would lay out: the classes
 * and inline styles of the dialog and its panel, every value they held while mounting (a
 * MutationObserver records each class and style value they had), and the panel's transform. The
 * browser half, bounding boxes at 375, 768, 1024 and 1440, is e2e/sweep-sidesheet-phone.spec.ts.
 *
 *   SSM-01  RED  on a phone the open sheet's panel carries no x offset from the desktop slide
 *   SSM-02  RED  on a phone the sheet never renders its desktop layout, not even for its first render
 *   SSM-03  RED  on a phone the panel is the full-width bottom sheet: no fixed desktop width applies below 640px
 *   SSM-04  control  on a desktop the sheet is the right-hand panel sliding in from the right, at its width
 *   SSM-05  control  an open sheet rendered on the server hydrates on a phone with no hydration warning
 */
import type { ReactElement } from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";

import { SideSheet } from "../side-sheet";

let phone = false;
const realMatchMedia = window.matchMedia;

/** A screen 375px wide (phone) or 1440px wide: a media query matches as a browser of that width would answer it. */
function answers(query: string): boolean {
  const width = phone ? 375 : 1440;
  const max = /max-width:\s*(\d+(?:\.\d+)?)px/.exec(query);
  const min = /min-width:\s*(\d+(?:\.\d+)?)px/.exec(query);
  if (max && width > Number(max[1])) return false;
  if (min && width < Number(min[1])) return false;
  return Boolean(max || min);
}

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: answers(query),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  window.matchMedia = realMatchMedia;
  document.body.innerHTML = "";
});

const tokens = (cls: string | null | undefined) => new Set((cls ?? "").split(/\s+/).filter(Boolean));

/** The dialog's panel: the child that holds the title (the other child is the backdrop). */
function panelOf(dialog: HTMLElement): HTMLElement {
  const panel = Array.from(dialog.children).find((c) => c.querySelector("#side-sheet-title"));
  expect(panel, "the dialog has a panel holding the title").toBeTruthy();
  return panel as HTMLElement;
}

/** The x offset a transform carries ("none" when it carries none, or a zero one). */
function xOffset(transform: string): string {
  const m = /translateX\(\s*([-\d.]+)(px|%)?\s*\)/.exec(transform);
  if (m) return Number(m[1]) === 0 ? "none" : `${m[1]}${m[2] ?? ""}`;
  const m3 = /translate3d\(\s*([-\d.]+)(px|%)?\s*,/.exec(transform);
  if (m3) return Number(m3[1]) === 0 ? "none" : `${m3[1]}${m3[2] ?? ""}`;
  return "none";
}

/**
 * Every class and style value the dialog and its panel held from their insertion until now: the
 * values that were replaced (MutationObserver's oldValue) and the values they hold at the end.
 */
async function mountRecordingLayouts(ui: ReactElement, title: string) {
  const seen: Array<{ who: "dialog" | "panel"; attr: "class" | "style"; value: string }> = [];
  const records: MutationRecord[] = [];
  const observer = new MutationObserver((batch) => records.push(...batch));
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ["class", "style"],
  });
  await act(async () => {
    render(ui);
  });
  const dialog = screen.getByRole("dialog", { name: title });
  const panel = panelOf(dialog);
  records.push(...observer.takeRecords());
  for (const r of records) {
    if (r.type !== "attributes") continue;
    const who = r.target === dialog ? "dialog" : r.target === panel ? "panel" : null;
    if (!who) continue;
    seen.push({ who, attr: r.attributeName as "class" | "style", value: r.oldValue ?? "" });
  }
  observer.disconnect();
  seen.push({ who: "dialog", attr: "class", value: dialog.getAttribute("class") ?? "" });
  seen.push({ who: "panel", attr: "class", value: panel.getAttribute("class") ?? "" });
  seen.push({ who: "panel", attr: "style", value: panel.getAttribute("style") ?? "" });
  return { dialog, panel, seen };
}

const sheet = (
  <SideSheet open onClose={() => {}} title="Order KF-1042" width="lg" footer={<button type="button">Mark shipped</button>}>
    <p>Order details</p>
  </SideSheet>
);

describe("FU-SIDESHEET-MOBILE-OFFSET: the shared SideSheet mounted open on a phone", () => {
  it("SSM-01 RED: on a phone the open sheet's panel carries no x offset from the desktop slide", async () => {
    phone = true;
    const { panel, seen } = await mountRecordingLayouts(sheet, "Order KF-1042");
    expect(xOffset(panel.style.transform), `the panel's transform is "${panel.style.transform}"`).toBe("none");
    const styles = seen.filter((s) => s.who === "panel" && s.attr === "style").map((s) => s.value);
    for (const style of styles) {
      expect(xOffset(style), `while mounting, the panel's style was "${style}"`).toBe("none");
    }
  });

  it("SSM-02 RED: on a phone the sheet never renders its desktop layout, not even for its first render", async () => {
    phone = true;
    const { seen } = await mountRecordingLayouts(sheet, "Order KF-1042");
    const dialogClasses = seen.filter((s) => s.who === "dialog" && s.attr === "class").map((s) => s.value);
    expect(dialogClasses.length).toBeGreaterThan(0);
    for (const cls of dialogClasses) {
      const t = tokens(cls);
      // Below 640px the dialog lays its panel at the bottom (items-end), never to the right (an unprefixed justify-end).
      expect(t.has("items-end"), `the dialog's class was "${cls}"`).toBe(true);
      expect(t.has("justify-end"), `the dialog's class was "${cls}"`).toBe(false);
    }
    const panelClasses = seen.filter((s) => s.who === "panel" && s.attr === "class").map((s) => s.value);
    for (const cls of panelClasses) {
      const t = tokens(cls);
      expect(t.has("border-l") || t.has("h-full"), `the panel's class was "${cls}" (the desktop panel)`).toBe(false);
      expect(t.has("rounded-t-2xl"), `the panel's class was "${cls}" (not the bottom sheet)`).toBe(true);
    }
  });

  it("SSM-03 RED: on a phone the panel is the full-width bottom sheet, with no fixed desktop width below 640px", async () => {
    phone = true;
    const { panel, seen } = await mountRecordingLayouts(sheet, "Order KF-1042");
    expect(tokens(panel.getAttribute("class")).has("w-full"), "the bottom sheet spans the screen").toBe(true);
    for (const s of seen.filter((x) => x.who === "panel")) {
      if (s.attr === "style") {
        expect(s.value, "no inline width: an inline style applies at every width").not.toMatch(/(^|;|\s)width\s*:/);
      } else {
        // A fixed width may apply only from 640px up (an sm: class), never to a phone.
        const unprefixedFixedWidth = [...tokens(s.value)].filter((c) => /^w-\[\d+px\]$/.test(c));
        expect(unprefixedFixedWidth, `the panel's class was "${s.value}"`).toEqual([]);
      }
    }
  });

  it("SSM-04 control: on a desktop the sheet is the right-hand panel sliding in from the right, at its width", async () => {
    phone = false;
    const { dialog, panel } = await mountRecordingLayouts(sheet, "Order KF-1042");
    const d = tokens(dialog.getAttribute("class"));
    expect(d.has("justify-end") || d.has("sm:justify-end"), `the dialog's class is "${dialog.className}"`).toBe(true);
    const p = tokens(panel.getAttribute("class"));
    expect(p.has("border-l") || p.has("sm:border-l"), `the panel's class is "${panel.className}"`).toBe(true);
    // "lg" is 640px wide, as before (an inline width, or the sm: class that applies it from 640px up).
    expect(panel.style.width === "640px" || p.has("sm:w-[640px]"), `the panel is ${panel.style.width || panel.className}`).toBe(true);
    expect(panel.style.transform, "it slides in from the right").toMatch(/translateX\(100%\)|translate3d\(100%/);
  });

  it("SSM-05 control: an open sheet rendered on the server hydrates on a phone with no hydration warning", async () => {
    // The server has no screen: it renders as it always did, and the phone's first client render must agree with it.
    phone = true;
    const html = renderToString(sheet);
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(host, sheet, {
          onRecoverableError: (e: unknown) => errors.push(`recoverable: ${String(e)}`),
        });
      });
      expect(errors.filter((e) => /hydrat|did not match|server rendered/i.test(e))).toEqual([]);
      const dialog = screen.getByRole("dialog", { name: "Order KF-1042" });
      expect(tokens(dialog.getAttribute("class")).has("items-end"), "after hydration it is the phone's bottom sheet").toBe(true);
    } finally {
      spy.mockRestore();
      await act(async () => root?.unmount());
    }
  });
});
