/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 2 (R2-3): the presence page editor's "Trust items" field suggests no
 * security claim ("e.g. SSL secure checkout") as an example to type.
 *
 * Mounted on the real page; only the presence client calls, the stored business, sonner and next/navigation are stubbed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";

const ok = <T,>(data: T) => ({ data, error: null });
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/app/presence/pages",
  useParams: () => ({}),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }));
vi.mock("@/lib/workspace", () => ({ getStoredBusinessId: () => "biz_presence_r2", BUSINESS_CHANGED_EVENT: "kf:business-changed" }));
vi.mock("@/lib/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client")>();
  const payload = {
    branding: {}, seo: {},
    sections: [{ id: "sec_trust", type: "trust", visible: true, data: { items: [""] } }],
  };
  return {
    ...actual,
    fetchPresenceDraft: vi.fn(async () => ok({
      draft: { id: "d1", version: 1, status: "DRAFT", payload, previewToken: "tok", previewExpiresAt: null, updatedAt: "2026-11-20T00:00:00.000Z" },
      published: null,
    })),
    fetchPresenceCompleteness: vi.fn(async () => ok({ score: 50 })),
    fetchPresenceDiff: vi.fn(async () => ok({ hasPublished: false, diffs: [] })),
    createPresencePreview: vi.fn(async () => ok({ previewToken: "tok" })),
    savePresenceDraft: vi.fn(),
    publishPresence: vi.fn(),
    unpublishPresence: vi.fn(),
  };
});

import PresencePage from "../page";

afterEach(() => cleanup());

describe("the presence page's trust section editor", () => {
  it("suggests no 'SSL secure checkout' (or any security claim) as a trust item", async () => {
    render(<PresencePage />);
    expect(await screen.findByText("Trust items")).toBeTruthy();
    const placeholders = Array.from(document.querySelectorAll("input")).map((i) => i.getAttribute("placeholder") ?? "");
    expect(placeholders.length).toBeGreaterThan(0);
    for (const p of placeholders) expect(p).not.toMatch(/SSL|secure|encrypt|guarantee/i);
  });
});
