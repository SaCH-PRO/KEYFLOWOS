/**
 * FU-WA-CONTACT-PHONE (V1-71; whatsapp ruling D-153, follow-ups ruling D-221):
 * the confirm step of a quote or invoice WhatsApp share, on its own.
 *
 * Review repair SEC-WACP-1. The step must not vouch for the phone on file. A
 * phone on a customer is not always one the business entered: the public
 * storefront intake, bookings and orders fill a blank phone on the customer
 * they match by e-mail, and that fill leaves no mark the web can read (no
 * audit entry, source unchanged). Saving the phone as the WhatsApp number makes
 * it trusted for this share and every later quote and invoice share (and the
 * billing detail's WhatsApp button), each carrying a bearer link. So the step
 * says where the phone may have come from, asks the member to save it only if
 * they know it is the customer's WhatsApp, says later shares go there without
 * asking, and does not put the save under the member's Enter key: the safe
 * choice ('Share without a number') has the focus when the step opens.
 *
 * The case is the reviewer's: Vera, created by the owner with an e-mail only;
 * an anonymous intake with her e-mail filled her phone '+18687550666'; the
 * owner's contact read answers that phone and no WhatsApp number.
 *
 * Review repair COR-WACP-1. Escape on the step closes the step alone. The
 * invoice and quote detail modal under it (BillingDetailModal) listens for
 * Escape on document and closes on it, so the step takes Escape before any
 * document or window listener sees it, and only while it is open.
 *
 * Mounted on the real hook and the real lib/whatsapp.ts, with fetch stubbed at
 * the network edge.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { useWhatsAppDocumentShare, type WhatsAppDocumentShare } from "../whatsapp-document-share";
import { whatsAppShareNumber } from "@/lib/whatsapp";

const BIZ = "biz_wa_step";
const CONTACT_PATH = `/crm/businesses/${BIZ}/contacts/ct_vera`;
const LINK = "https://app.keyflow.test/public/invoice/tok_wa_step_0001";

/** The owner's contact read for Vera after the anonymous intake filled her blank phone. */
const VERA_READ = { id: "ct_vera", firstName: "Vera", lastName: null, email: "vera@example.test", phone: "+18687550666", whatsappNumber: null, source: "manual" };

let patches: Array<Record<string, unknown>> = [];
let windowOpen: ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 400 ? "Error" : "OK",
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
    headers: new Headers({ "content-type": "application/json" }),
  } as unknown as Response;
}

beforeEach(() => {
  patches = [];
  windowOpen = vi.fn(() => null);
  vi.stubGlobal("open", windowOpen);
  window.open = windowOpen as unknown as typeof window.open;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input), "http://localhost");
      if ((init?.method ?? "GET").toUpperCase() === "PATCH" && url.pathname === CONTACT_PATH) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        patches.push(body);
        return jsonResponse(200, { ...VERA_READ, ...body });
      }
      return jsonResponse(200, {});
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function share(what: WhatsAppDocumentShare["what"] = "invoice"): WhatsAppDocumentShare {
  return {
    number: whatsAppShareNumber(VERA_READ, null),
    businessId: BIZ,
    contactId: "ct_vera",
    text: "Your invoice:",
    link: LINK,
    country: null,
    what,
  };
}

function Harness({ next }: { next: WhatsAppDocumentShare }) {
  const whatsApp = useWhatsAppDocumentShare();
  return (
    <>
      <button type="button" onClick={() => whatsApp.share(next)}>
        Share via WhatsApp
      </button>
      {whatsApp.dialog}
    </>
  );
}

async function openStep(what: WhatsAppDocumentShare["what"] = "invoice"): Promise<HTMLElement> {
  render(<Harness next={share(what)} />);
  fireEvent.click(screen.getByRole("button", { name: "Share via WhatsApp" }));
  return screen.findByRole("dialog", { name: /whatsapp number/i });
}

describe("FU-WA-CONTACT-PHONE confirm step: it does not vouch for the phone on file (SEC-WACP-1)", () => {
  it("the reviewer's case reads as a confirm step: the phone an anonymous intake filled, no WhatsApp number", () => {
    expect(whatsAppShareNumber(VERA_READ, null)).toEqual({ kind: "confirm", phone: "+18687550666", e164: "+18687550666", name: "Vera" });
  });

  it("does not call the phone the customer's, and does not say it is asked once", async () => {
    const step = await openStep();
    const words = step.textContent ?? "";
    expect(within(step).getByText("+18687550666")).toBeTruthy();
    expect(words).not.toMatch(/their phone number on file/i);
    expect(words).not.toMatch(/their phone on file/i);
    expect(words).not.toMatch(/you only do this once/i);
  });

  it("says the phone may have come from the business's website forms, bookings or orders", async () => {
    const step = await openStep();
    const words = step.textContent ?? "";
    expect(words).toMatch(/may not be Vera's/i);
    expect(words).toMatch(/website/i);
    expect(words).toMatch(/forms/i);
    expect(words).toMatch(/bookings/i);
    expect(words).toMatch(/orders/i);
  });

  it("asks the member to save it only if they know it is the customer's WhatsApp, and says what saving does", async () => {
    const step = await openStep();
    const words = step.textContent ?? "";
    expect(words).toMatch(/only if you know it is Vera's WhatsApp/i);
    // Saving makes it the number every later share opens, with no step.
    expect(words).toMatch(/later quotes and invoices for Vera go to (it|this number) without asking/i);
    // What the link gives whoever gets it, for the document being shared.
    expect(words).toMatch(/whoever gets the link can see and pay this invoice/i);
  });

  it("a quote says what its link gives: see, accept or reject it", async () => {
    const step = await openStep("quote");
    expect(step.textContent ?? "").toMatch(/whoever gets the link can see, accept or reject this quote/i);
  });

  it("the safe choice has the focus when the step opens, not the save", async () => {
    const step = await openStep();
    expect(document.activeElement).toBe(within(step).getByRole("button", { name: "Share without a number" }));
    expect(document.activeElement).not.toBe(within(step).getByRole("button", { name: "Use this as their WhatsApp number" }));
  });

  it("the save is still one deliberate press: it saves the E.164 number and opens the chat with the link", async () => {
    const step = await openStep();
    expect(patches).toEqual([]);
    fireEvent.click(within(step).getByRole("button", { name: "Use this as their WhatsApp number" }));
    await waitFor(() => expect(windowOpen).toHaveBeenCalledTimes(1));
    expect(patches).toEqual([{ whatsappNumber: "+18687550666" }]);
    const target = new URL(String(windowOpen.mock.calls[0]![0]));
    expect(target.origin + target.pathname).toBe("https://wa.me/18687550666");
    expect(target.searchParams.get("text")).toBe(`Your invoice: ${LINK}`);
  });
});

describe("FU-WA-CONTACT-PHONE confirm step: Escape closes the step alone (COR-WACP-1)", () => {
  it("a document Escape listener under it (the detail modal's) does not see the Escape that closes the step", async () => {
    const underneath = vi.fn();
    const onDocument = (event: KeyboardEvent) => {
      if (event.key === "Escape") underneath("document");
    };
    const onWindow = (event: KeyboardEvent) => {
      if (event.key === "Escape") underneath("window");
    };
    // Registered before the step opens, as BillingDetailModal's is.
    document.addEventListener("keydown", onDocument);
    window.addEventListener("keydown", onWindow);
    try {
      const step = await openStep();
      fireEvent.keyDown(within(step).getByRole("button", { name: "Share without a number" }), { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog", { name: /whatsapp number/i })).toBeNull());
      expect(underneath).not.toHaveBeenCalled();
      expect(patches).toEqual([]);
      expect(windowOpen).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", onDocument);
      window.removeEventListener("keydown", onWindow);
    }
  });

  it("Escape with the focus outside the step still closes the step alone", async () => {
    const underneath = vi.fn();
    const onDocument = (event: KeyboardEvent) => {
      if (event.key === "Escape") underneath();
    };
    document.addEventListener("keydown", onDocument);
    try {
      await openStep();
      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog", { name: /whatsapp number/i })).toBeNull());
      expect(underneath).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", onDocument);
    }
  });

  it("FU-WA-ESCAPE-RACE: an Escape the moment the step appears is the step's, when the step opens after the pay link resolves (outside an event)", async () => {
    // The panels call share() once the pay link is made, so the step mounts from a
    // non-event update. Its Escape listener must be there when its DOM is: an Escape
    // in between went to the detail modal under it (CI flake on PR #216, run
    // 44845430001, invoices-whatsapp-confirm-escape.test.tsx). A raw dispatch, not
    // fireEvent: fireEvent runs in act, which flushes effects first and hides the gap.
    const underneath = vi.fn();
    const onDocument = (event: KeyboardEvent) => {
      if (event.key === "Escape") underneath();
    };
    const api: { share: ReturnType<typeof useWhatsAppDocumentShare>["share"] | null } = { share: null };
    function AsyncHarness() {
      const whatsApp = useWhatsAppDocumentShare();
      const { share: shareNow } = whatsApp;
      React.useEffect(() => {
        api.share = shareNow;
      }, [shareNow]);
      return <>{whatsApp.dialog}</>;
    }
    render(<AsyncHarness />);
    const actEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    let pressed = false;
    const observer = new MutationObserver(() => {
      if (pressed || !document.querySelector('[role="dialog"]')) return;
      pressed = true;
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    document.addEventListener("keydown", onDocument);
    observer.observe(document.body, { childList: true, subtree: true });
    try {
      await Promise.resolve().then(() => api.share!(share()));
      await waitFor(() => expect(pressed).toBe(true));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: /whatsapp number/i })).toBeNull());
      expect(underneath).not.toHaveBeenCalled();
      expect(patches).toEqual([]);
      expect(windowOpen).not.toHaveBeenCalled();
    } finally {
      observer.disconnect();
      document.removeEventListener("keydown", onDocument);
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = actEnvironment;
    }
  });

  it("once the step is closed, Escape reaches the screen again, and other keys always do", async () => {
    const seen: string[] = [];
    const onDocument = (event: KeyboardEvent) => {
      seen.push(event.key);
    };
    document.addEventListener("keydown", onDocument);
    try {
      const step = await openStep();
      fireEvent.keyDown(step, { key: "Tab" });
      expect(seen).toEqual(["Tab"]);
      fireEvent.keyDown(step, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog", { name: /whatsapp number/i })).toBeNull());
      fireEvent.keyDown(document, { key: "Escape" });
      expect(seen).toEqual(["Tab", "Escape"]);
    } finally {
      document.removeEventListener("keydown", onDocument);
    }
  });
});
