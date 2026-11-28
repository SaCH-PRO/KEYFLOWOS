/**
 * P257 FU-SIDESHEET-CLOSE-DISABLED-CUE (launch-track, D-315). The commerce SideSheet (the one the expense sheet uses;
 * components/ui/side-sheet.tsx is a different component and is unchanged) takes `closeDisabled`: the header Close is
 * disabled and says so (disabled, aria-disabled), and Escape and the overlay do nothing while it is set. Without the
 * prop (the default, false) every way to close works as before, on the desktop panel and the phone bottom sheet.
 */
import { describe, it, expect, vi, afterEach, afterAll, beforeAll, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import ts from "typescript";

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

/*
 * P257 R2-R4: who imports the commerce SideSheet, found by parsing each source (not by matching text) and resolving
 * each specifier: relative ones from the importing file, `@/` from src, with or without an explicit extension. Only one
 * that reaches app/app/commerce/components/side-sheet counts: `./side-sheet` beside components/ui is
 * components/ui/side-sheet.tsx, a different component.
 */
const MODULE_EXTS = ["tsx", "ts", "jsx", "js", "mjs", "cjs"];
/**
 * The module specifiers a source text imports, read by the TypeScript parser (P257 R4-1): static imports, `import
 * type`, re-exports, `import()` (spaced, or a no-substitution template literal; next/dynamic's inner import) and
 * `require()`. An import in a comment is not one.
 */
function specifiersIn(text: string): string[] {
  return ts.preProcessFile(text, true, true).importedFiles.map((f) => f.fileName);
}
/** A path written with / whatever separator it was written with (P257 R3-3, R4-2: pure, so testable anywhere). */
function toSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}
/** The module path a specifier names (no extension), or null for a package. */
function resolveSpec(fromAbs: string, spec: string, root: string): string | null {
  const bare = spec.replace(/\.(tsx|ts|jsx|js|mjs|cjs)$/, "");
  if (bare.startsWith("@/")) return join(root, bare.slice(2));
  if (bare.startsWith(".")) return join(dirname(fromAbs), bare);
  return null;
}
/**
 * Whether `spec`, imported by the file at `fromAbs`, reaches the module `target`: it names it, or it names a
 * directory whose index re-exports it (followed through; P257 R4-1, so a barrel is never silently missed).
 */
function reaches(fromAbs: string, spec: string, target: string, root: string, seen = new Set<string>()): boolean {
  const resolved = resolveSpec(fromAbs, spec, root);
  if (resolved === null) return false;
  if (resolved === target) return true;
  for (const ext of MODULE_EXTS) {
    const index = join(resolved, `index.${ext}`);
    if (seen.has(index) || !existsSync(index)) continue;
    seen.add(index);
    if (specifiersIn(readFileSync(index, "utf8")).some((s) => reaches(index, s, target, root, seen))) return true;
  }
  return false;
}
/** Every non-test module under root (every kind in MODULE_EXTS), relative to root, written with /. */
function sources(root: string, dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" || e.name === "node_modules" ? [] : sources(root, full);
    return /\.(tsx|ts|jsx|js|mjs|cjs)$/.test(e.name) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(e.name) ? [toSlashes(relative(root, full))] : [];
  });
}
function importersOf(target: string, root: string): string[] {
  return sources(root).filter((rel) => specifiersIn(readFileSync(join(root, rel), "utf8")).some((s) => reaches(join(root, rel), s, target, root))).sort();
}

describe("P257: the commerce SideSheet's other callers are unchanged", () => {
  const SRC = join(__dirname, "../../../../..");
  const SHEET = join(SRC, "app/app/commerce/components/side-sheet");
  const EXPENSE_SHEET = "app/app/expenses/components/expense-form-sidesheet.tsx";
  const CALLERS = [
    "app/app/finance/components/payment-record-modal.tsx",
    "app/app/expenses/components/recurring-expenses-panel.tsx",
    "app/app/commerce/components/billing-form-modal.tsx",
    "app/app/commerce/components/standalone-payment-recorder.tsx",
    // P257 R1-3: the sixth (it imports ../components/side-sheet).
    "app/app/commerce/recurring/recurring-panel.tsx",
  ];
  const importsCommerceSheet = (rel: string) =>
    specifiersIn(readFileSync(join(SRC, rel), "utf8")).some((s) => reaches(join(SRC, rel), s, SHEET, SRC));

  describe("the import forms the pin must see (fixture texts, not files)", () => {
    const FROM = join(SRC, "app/app/commerce/recurring/fixture.tsx");
    const found = (text: string) => specifiersIn(text).filter((s) => reaches(FROM, s, SHEET, SRC));
    const cases: Array<[string, string]> = [
      ["a static import", 'import { SideSheet } from "../components/side-sheet";'],
      ["a dynamic import()", 'const SideSheet = (await import("../components/side-sheet")).SideSheet;'],
      ["next/dynamic", 'const SideSheet = dynamic(() => import( "../components/side-sheet" ).then((m) => m.SideSheet));'],
      ["require()", 'const { SideSheet } = require("../components/side-sheet");'],
      ["an explicit .tsx", 'import { SideSheet } from "../components/side-sheet.tsx";'],
      ["an explicit .js, through @/", 'import { SideSheet } from "@/app/app/commerce/components/side-sheet.js";'],
      // P257 R4-1: the forms a regex missed.
      ["import with a space before (", 'const m = import ("../components/side-sheet");'],
      ["a no-substitution template literal", "const m = import(`../components/side-sheet`);"],
      ["a re-export", 'export { SideSheet } from "../components/side-sheet";'],
      ["import type", 'import type { SideSheet } from "../components/side-sheet";'],
      // P257 R4 (review B of R3): a bare side-effect import, and the module named through /index.
      ["a bare side-effect import", 'import "../components/side-sheet";'],
      ["side-sheet/index", 'import { SideSheet } from "../components/side-sheet/index";'],
    ];
    for (const [form, text] of cases) {
      it(`${form} is found and reaches the commerce sheet`, () => {
        expect(found(text), `${form}: not found or not resolved to the commerce sheet`).toHaveLength(1);
      });
    }
    it("a commented-out import is not an import", () => {
      expect(found('// import { SideSheet } from "../components/side-sheet";\n/* require("../components/side-sheet") */'), "a comment counted as an import").toEqual([]);
    });
    it("control: the ui side-sheet, in any form, is not the commerce sheet", () => {
      const ui = join(SRC, "components/ui/business-object-drawer.tsx");
      for (const text of ['import { SideSheet } from "./side-sheet";', 'require("./side-sheet.tsx")', 'import("@/components/ui/side-sheet")']) {
        expect(specifiersIn(text).some((s) => reaches(ui, s, SHEET, SRC)), text).toBe(false);
      }
    });
    it("a path written with \\ is written with /", () => {
      expect(toSlashes("app\\app\\commerce\\side-sheet.tsx")).toBe("app/app/commerce/side-sheet.tsx");
      expect(toSlashes("app/app/x.tsx")).toBe("app/app/x.tsx");
    });
  });

  describe("the scan, on a fixture tree (every module kind; a barrel)", () => {
    let root = "";
    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "p257-sources-"));
      const put = (rel: string, text: string) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
      put("lib/sheet/side-sheet.tsx", "export const SideSheet = 1;");
      put("lib/sheet/index.ts", 'export { SideSheet } from "./side-sheet";');
      put("pages/a.js", 'import { SideSheet } from "../lib/sheet/side-sheet";');
      put("pages/b.jsx", 'import { SideSheet } from "@/lib/sheet/side-sheet.tsx";');
      put("pages/c.mjs", 'const m = await import("../lib/sheet/side-sheet");');
      put("pages/d.cjs", 'const { SideSheet } = require("../lib/sheet/side-sheet");');
      put("pages/via-barrel.tsx", 'import { SideSheet } from "../lib/sheet";');
      put("pages/unrelated.ts", 'import { x } from "./elsewhere";');
      put("pages/__tests__/ignored.test.tsx", 'import { SideSheet } from "../../lib/sheet/side-sheet";');
      // A test helper that is not itself a .test file: skipped because it is under __tests__.
      put("pages/__tests__/render-helper.tsx", 'import { SideSheet } from "../../lib/sheet/side-sheet";');
    });
    afterAll(() => { rmSync(root, { recursive: true, force: true }); });
    it("finds an importer of every module kind, and one through a barrel, and nothing in tests", () => {
      const target = join(root, "lib/sheet/side-sheet");
      expect(importersOf(target, root)).toEqual(["lib/sheet/index.ts", "pages/a.js", "pages/b.jsx", "pages/c.mjs", "pages/d.cjs", "pages/via-barrel.tsx"]);
    });
  });

  for (const path of CALLERS) {
    it(`${path} imports this SideSheet (resolved) and passes no closeDisabled`, () => {
      expect(importsCommerceSheet(path), `${path} does not import the commerce side-sheet`).toBe(true);
      expect(readFileSync(join(SRC, path), "utf8"), `${path} now passes closeDisabled`).not.toMatch(/closeDisabled/);
    });
  }
  it("the list is complete: every file that imports the commerce SideSheet is listed (or is the expense sheet)", () => {
    const t0 = performance.now();
    const importers = importersOf(SHEET, SRC);
    expect(performance.now() - t0, "the scan is slow").toBeLessThan(2000);
    expect(importers, "a caller of the commerce SideSheet is missing from CALLERS, or one listed is not a caller").toEqual([...CALLERS, EXPENSE_SHEET].sort());
  });
  it("the expense sheet passes it", () => {
    const text = readFileSync(join(SRC, EXPENSE_SHEET), "utf8");
    expect(text).toMatch(/closeDisabled=\{submitting\}/);
  });
});

describe("P257 R1-1: the sheet's focus and keydown effect does not re-run while it is open", () => {
  /** A caller that passes a new onClose arrow on every render, and re-renders as its field is typed in. */
  function Caller({ closeDisabled = false, onClose }: { closeDisabled?: boolean; onClose: () => void }) {
    const [text, setText] = useState("");
    return (
      <SideSheet open onClose={() => onClose()} title="Edit Expense" closeDisabled={closeDisabled}>
        <input aria-label="Field" value={text} onChange={(e) => setText(e.target.value)} />
      </SideSheet>
    );
  }
  const field = () => screen.getByLabelText("Field") as HTMLInputElement;
  for (const layout of ["desktop", "phone"] as const) {
    describe(layout, () => {
      beforeEach(() => { mobile = layout === "phone"; });
      it("typing several characters keeps focus in the field (a new onClose each render)", async () => {
        render(<Caller onClose={vi.fn()} />);
        await settle();
        field().focus();
        for (const v of ["P", "Pr", "Pri", "Prin"]) {
          fireEvent.change(field(), { target: { value: v } });
          await settle();
          expect(document.activeElement, `focus left the field after typing "${v}"`).toBe(field());
        }
      });
      it("toggling closeDisabled while focus is in a field keeps it there", async () => {
        const onClose = vi.fn();
        const view = render(<Caller onClose={onClose} />);
        await settle();
        field().focus();
        view.rerender(<Caller onClose={onClose} closeDisabled />);
        await settle();
        expect(document.activeElement, "focus left the field when closing was held").toBe(field());
        view.rerender(<Caller onClose={onClose} />);
        await settle();
        expect(document.activeElement, "focus left the field when closing was released").toBe(field());
      });
      it("control: the panel takes focus when the sheet opens", async () => {
        render(<Caller onClose={vi.fn()} />);
        await settle();
        expect(document.activeElement).toBe(screen.getByRole("dialog"));
      });
    });
  }
  it("control: closing returns focus to the opener", async () => {
    function Opener() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open</button>
          <SideSheet open={open} onClose={() => setOpen(false)} title="Edit Expense"><p>body</p></SideSheet>
        </>
      );
    }
    render(<Opener />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);
    await settle();
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    fireEvent.keyDown(document, { key: "Escape" });
    await settle();
    expect(document.activeElement, "focus not returned to the opener").toBe(opener);
  });
  it("control: Escape, the overlay and Close call the latest onClose, and closeDisabled set later holds them", async () => {
    const first = vi.fn();
    const latest = vi.fn();
    const view = render(<SideSheet open onClose={first} title="Edit Expense"><p>body</p></SideSheet>);
    await settle();
    view.rerender(<SideSheet open onClose={latest} title="Edit Expense"><p>body</p></SideSheet>);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(overlay());
    fireEvent.click(closeButton());
    expect(first, "a stale onClose was called").not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(3);
    view.rerender(<SideSheet open onClose={latest} title="Edit Expense" closeDisabled><p>body</p></SideSheet>);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(overlay());
    expect(latest, "closeDisabled set after open did not hold Escape and the overlay").toHaveBeenCalledTimes(3);
  });
});
