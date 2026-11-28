/**
 * P238 HOMEPAGE-TRUE-ONLY (launch-track, D-316 / D-303). The marketing homepage showed static trust badges: "SSL
 * Encrypted", "Secure Payments" and "99.9% Uptime". Only claims the product can show stay:
 *   - "SSL Encrypted" only when the page is served over https (the same check P231 makes on the customer pages:
 *     true only in a browser that loaded the page over https, false on the server render);
 *   - "Secure Payments" and "99.9% Uptime" are not shown (nothing measures or verifies them);
 *   - control: "Caribbean-Native", a description of the product, stays.
 * The https case stubs only the scheme check (jsdom serves http://localhost and its location cannot be replaced).
 *
 * R1, with the owner's ruling D-330 ("Remove all of it"): no STATS "80-90% Operations Automated" or "<5 min Daily
 * Management"; the hero line says no percentage ("built to automate your daily operations"); no testimonials section
 * (the three hard-coded quotes with invented results). "6 Core Engines" and "TTD Caribbean-Native" stay, and the
 * stats grid has as many columns as stats (no empty cells).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { renderToString } from "react-dom/server";

const scheme = vi.hoisted(() => ({ stub: false, https: false }));
vi.mock("@/lib/use-served-over-https", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/use-served-over-https")>();
  return { ...actual, useServedOverHttps: () => (scheme.stub ? scheme.https : actual.useServedOverHttps()) };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

// The page's whileInView animations need an IntersectionObserver, which jsdom does not have: one that never fires.
class NoIntersections {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}
vi.stubGlobal("IntersectionObserver", NoIntersections);

import Home from "../page";
import { useServedOverHttps } from "@/lib/use-served-over-https";

afterEach(() => { cleanup(); scheme.stub = false; scheme.https = false; vi.stubGlobal("IntersectionObserver", NoIntersections); });
const text = () => document.body.textContent ?? "";

describe("P238: the homepage makes no trust claim the product does not back", () => {
  it('no "99.9% Uptime" and no "Secure Payments"', () => {
    render(<Home />);
    expect(text(), "an uptime figure nothing measures").not.toMatch(/99\.9% Uptime/);
    expect(text(), "a payment-security claim nothing verifies").not.toMatch(/Secure Payments/);
  });
  it('over http (jsdom serves http://localhost): no "SSL Encrypted"', () => {
    expect(window.location.protocol).toBe("http:");
    render(<Home />);
    expect(text(), "SSL claimed on a page not served over https").not.toMatch(/SSL Encrypted/);
  });
  it('over https: "SSL Encrypted" is shown', () => {
    scheme.stub = true;
    scheme.https = true;
    render(<Home />);
    expect(screen.getByText("SSL Encrypted")).toBeTruthy();
  });
  it('control: "Caribbean-Native" stays', () => {
    render(<Home />);
    // R1-1: the STATS strip also has a "Caribbean-Native" label (a <p>, no icon); the badge is the one with its icon.
    const badges = screen.getAllByText("Caribbean-Native").filter((el) => el.querySelector("svg"));
    expect(badges, "the true badge went too").toHaveLength(1);
  });
});

describe("P238: the scheme check", () => {
  function Probe() {
    return <p>{useServedOverHttps() ? "https" : "not https"}</p>;
  }
  it("is false in this http browser", () => {
    render(<Probe />);
    expect(screen.getByText("not https")).toBeTruthy();
  });
  it("is false on the server render (no claim is made before the browser can tell)", () => {
    expect(renderToString(<Probe />)).toContain("not https");
  });
});

describe("P238 R1 (D-330): no invented figures and no invented testimonials", () => {
  it('no "80-90%", no "Operations Automated", no "<5 min", no "Daily Management"', () => {
    render(<Home />);
    for (const claim of [/80-90%/, /Operations Automated/, /<5 min/, /Daily Management/]) {
      expect(text(), `still claims ${claim}`).not.toMatch(claim);
    }
  });
  it("the hero line says what the product is built to do, with no number", () => {
    render(<Home />);
    expect(text()).toMatch(/built to automate your daily operations/i);
    expect(text()).not.toMatch(/automates \d/i);
  });
  it("no testimonials: no heading, no quotes, no names", () => {
    render(<Home />);
    for (const gone of [/Loved by founders/, /What entrepreneurs say/, /Sarah M\./, /David K\./, /Aisha R\./, /3 hours to 15 minutes/, /40% more appointments/]) {
      expect(text(), `a testimonial remains: ${gone}`).not.toMatch(gone);
    }
    expect(document.querySelectorAll("blockquote, figure").length, "a testimonial region remains").toBe(0);
  });
  it('control: "6 Core Engines" and "TTD Caribbean-Native" stay, and the stats grid has no empty columns', () => {
    render(<Home />);
    const engines = screen.getByText("Core Engines");
    expect(engines.previousElementSibling?.textContent).toBe("6");
    const grid = engines.closest("div.grid") as HTMLElement;
    expect(grid, "the stats are no longer in a grid").not.toBeNull();
    const items = grid.children.length;
    expect(items).toBe(2);
    expect(grid.textContent, "TTD Caribbean-Native left the stats").toMatch(/TTD\s*Caribbean-Native/);
    const columns = (grid.className.match(/(?:^|\s)(?:md:)?grid-cols-(\d+)/g) ?? []).map((c) => Number(c.split("-").pop()));
    expect(Math.max(...columns), "a column for a stat that is gone (an empty cell)").toBeLessThanOrEqual(items);
  });
});
