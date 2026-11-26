/**
 * FU-CONTACT-PAGES-RAW-STATUS (CDC-4): the contact's Recommendations tab printed each suggestion's priority code
 * ("high", "medium") as its badge. It reads in plain words ("High", "Medium"), from lib/status-labels.ts.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const fetchContactInsightSnapshot = vi.fn();
const fetchContactRevenueSummary = vi.fn();
const fetchContactMomentum = vi.fn();
const fetchContactDetail = vi.fn();
vi.mock("next/navigation", () => ({ useParams: () => ({ contactId: "c_1" }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/workspace", () => ({ getStoredBusinessId: () => "biz_1" }));
vi.mock("@/lib/whatsapp", () => ({ buildWhatsAppLink: vi.fn(), getContactPhone: () => null, ownBusinessCountry: () => "TT" }));
const openComposer = vi.fn();
vi.mock("@/components/email/compose-context", () => ({ useCompose: () => ({ open: openComposer }) }));
vi.mock("@/lib/client", () => ({
  fetchContactInsightSnapshot: (...a: unknown[]) => fetchContactInsightSnapshot(...a),
  fetchContactRevenueSummary: (...a: unknown[]) => fetchContactRevenueSummary(...a),
  fetchContactMomentum: (...a: unknown[]) => fetchContactMomentum(...a),
  fetchContactDetail: (...a: unknown[]) => fetchContactDetail(...a),
  addContactTask: vi.fn(),
}));

import ContactRecommendationsPage from "../recommendations/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("contact Recommendations tab: priorities in plain words", () => {
  it("a high and a medium suggestion read 'High' and 'Medium', never the code", async () => {
    fetchContactInsightSnapshot.mockResolvedValue({ data: { payload: { churnRisk: 80, churnRiskReason: "Quiet for 60 days" } } });
    fetchContactRevenueSummary.mockResolvedValue({ data: null });
    fetchContactMomentum.mockResolvedValue({ data: { score: 20 } });
    fetchContactDetail.mockResolvedValue({ data: { contact: { firstName: "Ada", lastName: "L", email: "a@x.test" } } });
    render(<ContactRecommendationsPage />);
    expect(await screen.findByText("Churn Risk Detected")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.queryByText("high")).not.toBeInTheDocument();
    expect(screen.queryByText("medium")).not.toBeInTheDocument();
  });

  it("control: the high suggestion is still sorted first and drawn as urgent", async () => {
    fetchContactInsightSnapshot.mockResolvedValue({ data: { payload: { churnRisk: 80 } } });
    fetchContactRevenueSummary.mockResolvedValue({ data: null });
    fetchContactMomentum.mockResolvedValue({ data: { score: 20 } });
    fetchContactDetail.mockResolvedValue({ data: { contact: {} } });
    render(<ContactRecommendationsPage />);
    // The badge is the element after the title, whatever it says.
    expect((await screen.findByText("Churn Risk Detected")).nextElementSibling).toHaveClass("bg-red-100");
    const titles = screen.getAllByText(/Churn Risk Detected|Low Engagement Momentum/).map((e) => e.textContent);
    expect(titles).toEqual(["Churn Risk Detected", "Low Engagement Momentum"]);
  });
});
