/**
 * R0-SEC2b-WHATSAPP-SECRET-READS, case SEC2-T03 (R0-SEC2 review CR-SEC2-2):
 * the WhatsApp inbox page (/app/whatsapp) and the Key Connect manage drawer
 * read the masked WhatsApp status and tell "no access" apart from "not
 * connected".
 *
 * WHY: R0-SEC2 made GET /whatsapp/businesses/:businessId/status (and the
 * conversation and template reads) need operations:read, and masked what it
 * answers: phoneNumberId (as destination.platformId) only to the config owner;
 * any other reader gets the sending number or nothing there. Both screens did
 * `setStatus(s.data ?? { connected: false })`, so the 403 a member with
 * operations: none now gets was rendered as "Connect WhatsApp Business" with a
 * Connect CTA (the page) or "WhatsApp not connected" (the drawer): a member
 * the server refused was told the business had no WhatsApp and sent to set
 * one up, which is the owner's action (D-11), not theirs.
 *
 * Mounted on the real page and drawer; only the api module's apiGet and
 * apiPostSimple are stubbed, with the shapes apiGet really produces: a 403 is
 * { data: null, error, status: 403, rawError } (handleErrorResponse over the
 * production GlobalHttpExceptionFilter body), a 200 is { data, error: null }.
 * The masked status bodies are the ones WhatsAppService.getStatus answers
 * (test/whatsapp-config-authority.integration.test.ts, SEC2-C05).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPostSimple: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGet: api.apiGet, apiPostSimple: api.apiPostSimple };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(),
    refresh: vi.fn(), prefetch: vi.fn(),
  }),
  usePathname: () => "/app/whatsapp",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), message: vi.fn(),
    warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));

import WhatsAppInboxPage from "../page";
import { WhatsAppManageDrawer } from "../../key-connect/components/whatsapp/whatsapp-manage-drawer";

const BUSINESS = "biz_sec2b_web";
const FROM_NUMBER = "+18685550100";
const PHONE_NUMBER_ID = "707070707070707";

type ApiResult = { data: unknown; error: string | null; status?: number; rawError?: Record<string, unknown> | null };

/** apiGet's result for the 403 ModuleScopeGuard answers a member with operations: none. */
function forbidden(path: string): ApiResult {
  const message = "Insufficient permissions: operations requires read access (you have none)";
  return {
    data: null,
    error: message,
    status: 403,
    rawError: { statusCode: 403, message, error: "Forbidden", timestamp: "2026-11-02T00:00:00.000Z", path },
  };
}

const ok = (data: unknown): ApiResult => ({ data, error: null });

/** Answer the three reads both screens make on load, by path. */
function serve(status: ApiResult, rest: { conversations?: ApiResult; templates?: ApiResult } = {}) {
  api.apiGet.mockImplementation(async (path: string) => {
    if (path.endsWith("/status")) return status;
    if (path.endsWith("/conversations")) return rest.conversations ?? (status.status === 403 ? forbidden(path) : ok([]));
    if (path.endsWith("/templates")) return rest.templates ?? (status.status === 403 ? forbidden(path) : ok({ templates: [] }));
    return ok(null);
  });
}

/** The masked status a STAFF member (operations: read) gets: the sending number, no phoneNumberId. */
const MASKED_STATUS = {
  connected: true,
  destination: { id: `${BUSINESS}:whatsapp`, platformId: FROM_NUMBER, displayName: FROM_NUMBER },
};
/** The same for a config with no sending number: platformId empty, no displayName. */
const MASKED_STATUS_NO_NUMBER = {
  connected: true,
  destination: { id: `${BUSINESS}:whatsapp`, platformId: "", displayName: null },
};

const SCREENS: Array<{ name: string; mount: () => void }> = [
  { name: "the inbox page", mount: () => render(<WhatsAppInboxPage />) },
  { name: "the manage drawer", mount: () => render(<WhatsAppManageDrawer businessId={BUSINESS} />) },
];

async function settled() {
  await waitFor(() => expect(api.apiGet).toHaveBeenCalled());
  await waitFor(() => expect(document.querySelector(".animate-spin")).toBeNull());
}

describe("WhatsApp page and drawer: the masked status, and a refused read is no access, not 'not connected' (SEC2-T03)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_business_id", BUSINESS);
    api.apiGet.mockReset();
    api.apiPostSimple.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  for (const s of SCREENS) {
    it(`[SEC2-T03] RED-BEFORE (review CR-SEC2-2): ${s.name} renders a 403 from GET status as no access: no "not connected" state, no Connect CTA, no inbox`, async () => {
      serve(forbidden(`/whatsapp/businesses/${BUSINESS}/status`));
      s.mount();
      await settled();
      expect(await screen.findByText(/You don.t have access to the WhatsApp inbox/i)).toBeInTheDocument();
      expect(screen.getByText(/Ask the business owner/i)).toBeInTheDocument();
      expect(screen.queryByText(/Connect WhatsApp/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/not connected/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /Connect/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /New/i })).not.toBeInTheDocument();
    });

    it(`[SEC2-T03] ${s.name} renders the inbox from the masked status a non-owner gets (the sending number, no phoneNumberId)`, async () => {
      serve(ok(MASKED_STATUS));
      s.mount();
      await settled();
      expect(await screen.findByText(FROM_NUMBER)).toBeInTheDocument();
      expect(document.body.textContent ?? "").not.toContain(PHONE_NUMBER_ID);
      expect(screen.queryByText(/access to the WhatsApp inbox/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Connect WhatsApp/i)).not.toBeInTheDocument();
    });

    it(`[SEC2-T03] ${s.name} renders the inbox from a masked status with no sending number ("Connected", no id shown)`, async () => {
      serve(ok(MASKED_STATUS_NO_NUMBER));
      s.mount();
      await settled();
      expect(await screen.findByText("Connected")).toBeInTheDocument();
      expect(screen.queryByText(/access to the WhatsApp inbox/i)).not.toBeInTheDocument();
    });

    it(`[SEC2-T03] ${s.name} keeps the not-connected state for a business with no WhatsApp config (200 {connected:false})`, async () => {
      serve(ok({ connected: false }));
      s.mount();
      await settled();
      expect(await screen.findByText(/Connect WhatsApp Business|WhatsApp not connected/)).toBeInTheDocument();
      expect(screen.queryByText(/access to the WhatsApp inbox/i)).not.toBeInTheDocument();
    });
  }
});
