/**
 * FU-CONTACT-PAGES-RAW-STATUS (CDC-4): the contact's Tasks tab printed a task's stored priority as it is ("HIGH",
 * "NORMAL"). It reads in plain words ("High", "Normal"), from lib/status-labels.ts.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const fetchContactTasks = vi.fn();
vi.mock("next/navigation", () => ({ useParams: () => ({ contactId: "c_1" }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/workspace", () => ({ getStoredBusinessId: () => "biz_1" }));
vi.mock("@/lib/client", () => ({
  fetchContactTasks: (...a: unknown[]) => fetchContactTasks(...a),
  addContactTask: vi.fn(),
  deleteContactTask: vi.fn(),
  completeContactTask: vi.fn(),
  reopenContactTask: vi.fn(),
  updateContactTask: vi.fn(),
}));

import ContactTasksPage from "../tasks/page";

afterEach(() => {
  cleanup();
  fetchContactTasks.mockReset();
});

describe("contact Tasks tab: priorities in plain words", () => {
  it("a stored HIGH, NORMAL and LOW priority read 'High', 'Normal' and 'Low', never the code", async () => {
    fetchContactTasks.mockResolvedValue({
      data: [
        { id: "t1", title: "Call back", status: "open", priority: "HIGH" },
        { id: "t2", title: "Send brochure", status: "open", priority: "NORMAL" },
        { id: "t3", title: "Tidy notes", status: "completed", priority: "LOW" },
      ],
    });
    render(<ContactTasksPage />);
    expect(await screen.findByText("High")).toBeInTheDocument();
    expect(screen.getByText("Normal")).toBeInTheDocument();
    expect(screen.getByText("Low")).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\b(HIGH|NORMAL|LOW)\b/);
  });

  it("control: a task with no priority shows no priority, and the titles are as typed", async () => {
    fetchContactTasks.mockResolvedValue({ data: [{ id: "t1", title: "URGENT call", status: "open", priority: null }] });
    render(<ContactTasksPage />);
    expect(await screen.findByText("URGENT call")).toBeInTheDocument();
    expect(screen.queryByText("High")).not.toBeInTheDocument();
  });
});
