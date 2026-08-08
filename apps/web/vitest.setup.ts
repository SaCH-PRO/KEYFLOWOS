import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

/**
 * Browser APIs jsdom does not implement.
 *
 * Both of these exist in every browser the app runs in, so a screen using them
 * is not doing anything wrong — jsdom simply stops short. Without these,
 * mounting a real screen throws for a reason that has nothing to do with the
 * screen, and a gate that reports environment gaps as defects gets switched off
 * by the third person who wastes an afternoon on one.
 *
 * Added when the mount smoke test for the 29 newly-reachable screens reported
 * five failures, all of them jsdom rather than product:
 *
 *   window.matchMedia      responsive hooks — 3 finance screens
 *   Element.scrollIntoView  tab strips scrolling the active tab into view — 2
 *
 * Kept narrow on purpose. Anything stubbed here is a thing the tests can no
 * longer see, so the bar is "the real browser definitely provides this".
 */

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

// Chart and layout code measures elements; jsdom reports every box as zero and
// some libraries divide by it.
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
