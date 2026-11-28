/**
 * P238 HOMEPAGE-TRUE-ONLY (launch-track, D-316 / D-303). The marketing homepage showed static trust badges: "SSL
 * Encrypted", "Secure Payments" and "99.9% Uptime". Only claims the product can show stay:
 *   - "SSL Encrypted" only when the page is served over https (the same check P231 makes on the customer pages:
 *     true only in a browser that loaded the page over https, false on the server render);
 *   - "Secure Payments" and "99.9% Uptime" are not shown (nothing measures or verifies them);
 *   - control: "Caribbean-Native", a description of the product, stays.
 * The https case stubs only the scheme check (jsdom serves http://localhost and its location cannot be replaced).
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
    expect(screen.getAllByText("Caribbean-Native").length, "the true badge went too").toBeGreaterThan(0);
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
