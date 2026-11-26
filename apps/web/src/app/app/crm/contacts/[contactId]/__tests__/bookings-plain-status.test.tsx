/**
 * FU-CONTACT-PAGES-RAW-STATUS (CDC-4): the contact's Bookings tab printed the stored BookingStatus as it is
 * ("NO_SHOW", "CANCELLED"). It says the status in plain words, from the one map (lib/status-labels.ts statusLabel),
 * so a no-show reads "No-show" here as it does on the bookings screen.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const fetchBookings = vi.fn();
vi.mock("next/navigation", () => ({ useParams: () => ({ contactId: "c_1" }) }));
vi.mock("@/lib/client", () => ({ fetchBookings: (...a: unknown[]) => fetchBookings(...a) }));

import ContactBookingsPage from "../bookings/page";

const past = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const ahead = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

function booking(id: string, status: string, startTime: string, contactId = "c_1") {
  return { id, contactId, status, startTime, endTime: startTime, service: { name: `Svc ${id}`, duration: 60, price: 100 } };
}

afterEach(() => {
  cleanup();
  fetchBookings.mockReset();
});

describe("contact Bookings tab: statuses in plain words", () => {
  it("a stored NO_SHOW, CANCELLED and PENDING read 'No-show', 'Cancelled' and 'Pending', never the code", async () => {
    fetchBookings.mockResolvedValue({
      data: [booking("b1", "NO_SHOW", past(3)), booking("b2", "CANCELLED", past(5)), booking("b3", "PENDING", ahead(2))],
    });
    render(<ContactBookingsPage />);
    expect(await screen.findByText("No-show")).toBeInTheDocument();
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\bNO_SHOW\b/);
    expect(text).not.toMatch(/\bCANCELLED\b/);
    expect(text).not.toMatch(/\bPENDING\b/);
  });

  it("control: the badge colour still follows the stored status (a confirmed booking is green, a cancelled one red)", async () => {
    fetchBookings.mockResolvedValue({ data: [booking("b1", "CONFIRMED", past(1)), booking("b2", "CANCELLED", past(2))] });
    render(<ContactBookingsPage />);
    // The badge is the element after the service name, whatever it says.
    expect((await screen.findByText("Svc b1")).nextElementSibling).toHaveClass("bg-green-100");
    expect(screen.getByText("Svc b2").nextElementSibling).toHaveClass("bg-red-100");
  });

  it("control: another customer's booking is not listed", async () => {
    fetchBookings.mockResolvedValue({ data: [booking("b1", "NO_SHOW", past(1), "c_2")] });
    render(<ContactBookingsPage />);
    expect(await screen.findByText("No bookings found for this contact.")).toBeInTheDocument();
    expect(screen.queryByText("No-show")).not.toBeInTheDocument();
  });
});
