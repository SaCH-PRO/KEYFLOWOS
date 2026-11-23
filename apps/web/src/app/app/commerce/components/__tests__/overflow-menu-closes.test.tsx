/**
 * MOUNT-QUOTES (live journey run, phone): a row's "More actions" menu closes
 * when one of its items is chosen.
 *
 * OverflowMenuItem stops its click from bubbling (so the row card behind it
 * does not open), and the menu closed itself only in a bubbling click handler
 * on its panel, so choosing an item left the menu open. On a phone the open
 * menu (z-50) then lay over the Edit sheet's footer and took the tap meant for
 * Update Quote (live sweep: "<button ...>Delete</button> ... intercepts
 * pointer events").
 *
 *   OMC-01  RED-BEFORE  choosing an item runs it and closes the menu
 *   OMC-02  control     choosing an item does not reach the row behind the menu
 *   OMC-03  control     a press outside the menu closes it, as before
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Pencil, Trash2 } from "lucide-react";

import { OverflowMenu, OverflowMenuItem } from "../standardized-cards";

afterEach(cleanup);

function renderMenu(onEdit: () => void, onRow: () => void, deleteDisabled = false) {
  render(
    <div data-testid="row" onClick={onRow}>
      <OverflowMenu>
        <OverflowMenuItem icon={Pencil} label="Edit" onClick={onEdit} />
        <OverflowMenuItem icon={Trash2} label="Delete" onClick={() => {}} destructive disabled={deleteDisabled} />
      </OverflowMenu>
    </div>,
  );
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
}

describe("MOUNT-QUOTES: the row menu closes when an item is chosen", () => {
  it("OMC-01 RED-BEFORE: choosing an item runs it and closes the menu", () => {
    const onEdit = vi.fn();
    renderMenu(onEdit, vi.fn());
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("OMC-02 control: choosing an item does not reach the row behind the menu", () => {
    const onRow = vi.fn();
    renderMenu(vi.fn(), onRow);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onRow).not.toHaveBeenCalled();
  });

  it("OMC-03 control: a press outside the menu closes it, as before", () => {
    renderMenu(vi.fn(), vi.fn());
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});
