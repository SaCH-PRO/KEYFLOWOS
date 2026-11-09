/**
 * V1-89 W3-CRM-AI-VISIBILITY (FOLLOW3-D3 residual ST-1): GET crm deals lists a
 * deal whose contact the member cannot open without that contact (contact and
 * contactId null, no name; CrmDealsService.listDeals). The deal board and the
 * deal list render such a deal (its title and value) with no contact link and
 * no "contactId=null" href, and keep the contact link for a deal whose contact
 * is joined.
 *
 * The components render for real; only the Next router and the toaster are
 * stubbed. Nothing here fetches: the add-deal and reason modals stay closed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { DealsBoardView } from "../deals-board-view";
import { DealsListView } from "../deals-list-view";
import type { Deal, DealStage } from "@/lib/client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(),
    refresh: vi.fn(), prefetch: vi.fn(),
  }),
  usePathname: () => "/app/crm/deals",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), message: vi.fn(),
    warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));

const AT = "2026-11-09T00:00:00.000Z";
const STAGE: DealStage = {
  id: "st_open", businessId: "biz_v89", name: "Qualified", slug: "qualified", position: 0,
  category: "OPEN", isDefault: true, archivedAt: null, createdAt: AT, updatedAt: AT,
};
const BASE = {
  businessId: "biz_v89", currency: "TTD", stageId: STAGE.id, stage: STAGE, status: "OPEN" as const,
  tags: [], createdAt: AT, updatedAt: AT,
};
/** What listDeals answers for a deal whose contact the member cannot open. */
const HIDDEN = {
  ...BASE, id: "deal_hidden", title: "V89 hidden-contact deal", value: 1200, contactId: null, contact: null,
} as unknown as Deal;
const SHOWN: Deal = {
  ...BASE, id: "deal_shown", title: "V89 shown-contact deal", value: 800, contactId: "c_team",
  contact: { id: "c_team", firstName: "Team", lastName: "Contact", displayName: null, email: "team@v89.test" },
};

afterEach(() => cleanup());

function contactLinks(container: HTMLElement) {
  return [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
}

describe("V1-89 ST-1 deal views render a deal listed without its contact", () => {
  it("the deal board shows the hidden-contact deal with no contact link; the joined contact keeps its link", () => {
    const { container } = render(
      <DealsBoardView businessId="biz_v89" deals={[HIDDEN, SHOWN]} stages={[STAGE]} reasons={[]} onChanged={vi.fn()} />,
    );
    expect(screen.getByText("V89 hidden-contact deal")).toBeInTheDocument();
    expect(screen.getByText("V89 shown-contact deal")).toBeInTheDocument();
    expect(screen.getByText("Team Contact")).toBeInTheDocument();
    expect(contactLinks(container)).toEqual(["/app/crm?contactId=c_team"]);
    expect(container.innerHTML).not.toContain("contactId=null");
  });

  it("the deal list shows the hidden-contact deal with a dash for its contact; the joined contact keeps its link", () => {
    const { container } = render(
      <DealsListView businessId="biz_v89" loading={false} deals={[HIDDEN, SHOWN]} stages={[STAGE]} reasons={[]} onChanged={vi.fn()} />,
    );
    const hiddenRow = screen.getByText("V89 hidden-contact deal").closest("tr");
    expect(hiddenRow).not.toBeNull();
    expect(hiddenRow!.querySelector("a")).toBeNull();
    expect(hiddenRow!.textContent).toContain("—");
    expect(screen.getByText("Team Contact")).toBeInTheDocument();
    expect(contactLinks(container)).toEqual(["/app/crm?contactId=c_team"]);
    expect(container.innerHTML).not.toContain("contactId=null");
  });
});
