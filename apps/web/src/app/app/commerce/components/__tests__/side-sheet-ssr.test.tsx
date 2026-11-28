/**
 * P263 R3: the SideSheet's children render through a portal into a container made with document.createElement. The
 * server has no document: rendering the sheet there, open or closed, must not touch it, and the open sheet's shell
 * still renders. (The suite's setup needs a window, so the server is stood in for by removing `document` for the
 * render: any read of it throws.)
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderToString } from "react-dom/server";

import { SideSheet } from "../side-sheet";

afterEach(() => vi.unstubAllGlobals());

describe("P263 R3: the SideSheet renders on the server", () => {
  for (const open of [true, false]) {
    it(`open=${open}: renderToString with no document does not throw (any read of it would)`, () => {
      vi.stubGlobal("document", undefined);
      const html = renderToString(<SideSheet open={open} onClose={() => {}} title="Edit Expense"><p>body</p></SideSheet>);
      if (open) expect(html).toContain("Edit Expense");
    });
  }
});
