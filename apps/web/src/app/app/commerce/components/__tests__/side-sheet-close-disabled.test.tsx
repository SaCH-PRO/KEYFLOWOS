/**
 * P257 FU-SIDESHEET-CLOSE-DISABLED-CUE (launch-track, D-315). The commerce SideSheet (the one the expense sheet uses;
 * components/ui/side-sheet.tsx is a different component and is unchanged) takes `closeDisabled`: the header Close is
 * disabled and says so (disabled, aria-disabled), and Escape and the overlay do nothing while it is set. Without the
 * prop (the default, false) every way to close works as before, on the desktop panel and the phone bottom sheet.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  const CALLERS = [
    "components/ui/business-object-drawer.tsx",
    "app/app/finance/components/payment-record-modal.tsx",
    "app/app/expenses/components/recurring-expenses-panel.tsx",
    "app/app/commerce/components/billing-form-modal.tsx",
    "app/app/commerce/components/standalone-payment-recorder.tsx",
  ];
  for (const path of CALLERS) {
    it(`${path} imports this SideSheet and passes no closeDisabled`, () => {
      const text = readFileSync(join(SRC, path), "utf8");
      expect(text).toMatch(/commerce\/components\/side-sheet"|from "\.\/side-sheet"/);
      expect(text, `${path} now passes closeDisabled`).not.toMatch(/closeDisabled/);
    });
  }
  it("the expense sheet passes it", () => {
    const text = readFileSync(join(SRC, "app/app/expenses/components/expense-form-sidesheet.tsx"), "utf8");
    expect(text).toMatch(/closeDisabled=\{submitting\}/);
  });
});
