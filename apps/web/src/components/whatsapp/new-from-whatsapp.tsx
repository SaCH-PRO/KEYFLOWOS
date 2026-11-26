"use client";

import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { CalendarPlus, CheckCircle2, FileText, UserRound } from "lucide-react";
import { SideSheet } from "@/components/ui/side-sheet";
import { apiPost } from "@/lib/api";
import { answerFromThrown, useRefusal } from "@/lib/failure-kit";
import { getStoredBusinessId } from "@/lib/workspace";
import { ownBusinessCountry, toE164 } from "@/lib/whatsapp";
import type { ModuleLevels } from "@/lib/nav-config";
import type { BusinessSells } from "@/lib/business-settings";

/**
 * + New > From WhatsApp (WEDGE-WA-INBOUND-CAPTURE, P0; owner ruling D-263, the wedge; D-153: v1 sends WhatsApp links
 * out and the inbox is V1.1).
 *
 * A customer asks on WhatsApp. The owner pastes the message and the customer's number here; the server half
 * (POST /crm/businesses/:businessId/whatsapp/inbound-capture: crm write, bound to the business) reads the number with
 * the business's country (WA-E164-SERVER), finds the customer by that E.164 number or creates them, keeps the message
 * on their timeline as a plain-text note and records a communication.whatsapp event. Nothing is sent to the customer
 * and nothing goes to KEY. The sheet then offers New quote and New booking with that customer chosen.
 *
 * The message is shown back as text (React text, never HTML), and a refusal keeps the sheet open with what was typed
 * and says why, in the server's words (lib/failure-kit.ts).
 */

/** The capture route's message cap (CaptureWhatsAppInboundDto, crm.service.ts captureInboundWhatsApp). */
export const WHATSAPP_MESSAGE_MAX = 10_000;
/** CaptureWhatsAppInboundDto's caps for the number and the optional name. */
const PHONE_MAX = 64;
const NAME_MAX = 120;

/** The capture's 201 answer, as crm.service.ts captureInboundWhatsApp returns it. */
export interface WhatsAppCapture {
  contact: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
    phone: string | null;
    whatsappNumber: string | null;
  };
  created: boolean;
  normalizedPhone: string;
  note: { id: string; body: string };
}

function writes(level: string | undefined): boolean {
  return level === undefined || level === "write" || level === "admin";
}

/**
 * Whether the New menu offers From WhatsApp to a member with `levels` (useMemberModuleLevels): only to one who may
 * write customers (crm write or admin), as the server refuses a capture without crm write. Unknown (no answer yet, a
 * failed read, a module the answer does not name) hides nothing: the server still refuses.
 */
export function mayCaptureFromWhatsApp(levels: ModuleLevels): boolean {
  return !levels || writes(levels.crm);
}

/**
 * How New quote and New booking leave the sheet: a full page load. It was chosen because RequireAuth used to remount
 * the app shell on every pathname change, so a client navigation mounted the destination page twice and the first
 * instance stripped the one-shot ?contactId. Since FU-REQUIRE-AUTH-REMOUNT the shell stays mounted and router.push
 * doors with that id work (a contact's Send quote uses one, FU-CONTACT-SEND-QUOTE-DOOR); the sheet keeps the full load,
 * which also works. An object so the unit tests can watch it.
 */
export const newFromWhatsAppNavigation = {
  assign(href: string): void {
    window.location.assign(href);
  },
};

/** The customer's name, else their number. */
function customerName(capture: WhatsAppCapture): string {
  const c = capture.contact;
  const name = c.displayName?.trim() || [c.firstName, c.lastName].filter((p) => p && p.trim()).join(" ").trim();
  return name || capture.normalizedPhone;
}

export interface NewFromWhatsAppSheetProps {
  open: boolean;
  onClose: () => void;
  /** The member's levels (useMemberModuleLevels), for New quote (revenue write) and New booking (bookings write). */
  levels?: ModuleLevels;
  /** What the business sells, when known: a products business has no bookings (D-150). */
  sells?: BusinessSells | null;
}

export function NewFromWhatsAppSheet({ open, onClose, levels = null, sells = null }: NewFromWhatsAppSheetProps) {
  const { refused, message: refusal, clear } = useRefusal();
  const [phone, setPhone] = useState("");
  const [text, setText] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<WhatsAppCapture | null>(null);

  const message = text.trim();
  const tooLong = message.length > WHATSAPP_MESSAGE_MAX;
  const reading = phone.trim() ? toE164(phone, ownBusinessCountry()) : null;
  const canSave = !saving && phone.trim() !== "" && message !== "" && !tooLong;

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    const what = { what: "add customers from WhatsApp" };
    const businessId = getStoredBusinessId();
    if (!businessId) {
      refused({ data: null, error: "Choose a business first." }, what);
      return;
    }
    setSaving(true);
    let res: Awaited<ReturnType<typeof apiPost<WhatsAppCapture>>> | { data: null; error: string };
    try {
      res = await apiPost<WhatsAppCapture>({
        path: `/crm/businesses/${encodeURIComponent(businessId)}/whatsapp/inbound-capture`,
        body: {
          phone: phone.trim(),
          message,
          ...(firstName.trim() ? { firstName: firstName.trim() } : {}),
          ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
        },
      });
    } catch (err) {
      res = answerFromThrown(err);
    }
    setSaving(false);
    if (refused(res, what)) return;
    if (!res.data?.contact?.id) {
      refused({ data: null, error: "" }, what);
      return;
    }
    clear();
    setSaved(res.data);
  }, [canSave, phone, message, firstName, lastName, refused, clear]);

  const go = useCallback(
    (href: string) => {
      onClose();
      newFromWhatsAppNavigation.assign(href);
    },
    [onClose],
  );

  // Mounted only in the browser (the New menu renders after a click); the guard keeps a server render safe.
  if (typeof document === "undefined") return null;

  const contactId = saved ? encodeURIComponent(saved.contact.id) : "";
  const offerQuote = !levels || writes(levels.revenue);
  const offerBooking = sells !== "products" && (!levels || writes(levels.bookings));

  const footer = saved ? (
    <button type="button" onClick={onClose} className="kf-btn-secondary px-4 min-h-[44px] text-sm rounded-xl">
      Done
    </button>
  ) : (
    <>
      <button type="button" onClick={onClose} className="kf-btn-secondary px-4 min-h-[44px] text-sm rounded-xl">
        Cancel
      </button>
      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={!canSave}
        className="kf-btn-glow px-4 min-h-[44px] text-sm rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? "Saving…" : "Save to their timeline"}
      </button>
    </>
  );

  const sheet = (
    <SideSheet
      open={open}
      onClose={onClose}
      title="New from WhatsApp"
      subtitle="Paste what a customer sent you. Nothing is sent to them from here."
      footer={footer}
    >
      {saved ? (
        <div className="space-y-4">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Saved to {customerName(saved)}&apos;s timeline</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {saved.created ? "New customer added" : `${customerName(saved)} is already a customer`} ·{" "}
                <span className="font-mono">{saved.normalizedPhone}</span>
              </p>
            </div>
          </div>
          <p
            data-testid="wa-saved-message"
            className="text-sm whitespace-pre-wrap break-words rounded-xl border border-border/60 bg-muted/40 px-3 py-2.5 max-h-60 overflow-y-auto"
          >
            {saved.note?.body ?? message}
          </p>
          <div className="flex flex-wrap gap-2">
            {offerQuote && (
              <button
                type="button"
                onClick={() => go(`/app/commerce?tab=quotes&contactId=${contactId}`)}
                className="kf-btn-glow inline-flex items-center gap-1.5 px-4 min-h-[44px] text-sm rounded-xl"
              >
                <FileText className="w-4 h-4" aria-hidden="true" />
                New quote
              </button>
            )}
            {offerBooking && (
              <button
                type="button"
                onClick={() => go(`/app/bookings?contactId=${contactId}`)}
                className="kf-btn-secondary inline-flex items-center gap-1.5 px-4 min-h-[44px] text-sm rounded-xl"
              >
                <CalendarPlus className="w-4 h-4" aria-hidden="true" />
                New booking
              </button>
            )}
            <Link
              href={`/app/crm/contacts/${contactId}`}
              onClick={onClose}
              className="inline-flex items-center gap-1.5 px-3 min-h-[44px] text-sm rounded-xl text-muted-foreground hover:text-foreground"
            >
              <UserRound className="w-4 h-4" aria-hidden="true" />
              Open customer
            </Link>
          </div>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSave();
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="wa-capture-phone" className="text-xs text-muted-foreground">
              Their WhatsApp number
            </label>
            <input
              id="wa-capture-phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              maxLength={PHONE_MAX}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 777 1234 or +1 868 777 1234"
              className="kf-input w-full"
              aria-describedby="wa-capture-phone-reading"
            />
            <p id="wa-capture-phone-reading" className="text-xs text-muted-foreground min-h-[1rem]">
              {phone.trim()
                ? reading
                  ? <>Reads as <span className="font-mono">{reading}</span></>
                  : "Add the country code if this number is from abroad."
                : null}
            </p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="wa-capture-message" className="text-xs text-muted-foreground">
              Their message
            </label>
            <textarea
              id="wa-capture-message"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder="Paste the WhatsApp message here"
              className="kf-input w-full resize-y"
              aria-describedby="wa-capture-message-count"
              aria-invalid={tooLong || undefined}
            />
            <p id="wa-capture-message-count" className={tooLong ? "text-xs text-red-500" : "text-xs text-muted-foreground"}>
              {tooLong
                ? `Too long to save: ${message.length.toLocaleString("en-US")} of 10,000 characters. Shorten it first.`
                : `${message.length.toLocaleString("en-US")} / 10,000`}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="wa-capture-first" className="text-xs text-muted-foreground">
                First name (optional)
              </label>
              <input
                id="wa-capture-first"
                maxLength={NAME_MAX}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="kf-input w-full"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="wa-capture-last" className="text-xs text-muted-foreground">
                Last name (optional)
              </label>
              <input
                id="wa-capture-last"
                maxLength={NAME_MAX}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="kf-input w-full"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            A customer with this number is found and kept; otherwise one is added. The name is used only for a new
            customer.
          </p>
          {refusal && (
            <p role="alert" className="text-sm rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2">
              {refusal}
            </p>
          )}
        </form>
      )}
    </SideSheet>
  );

  // The New menu lives in the header, inside transformed (animated) boxes: the sheet goes to the body so its fixed
  // layer covers the screen. Keep this component mounted while closed (open={false}) before it opens: SideSheet
  // learns the phone width in an effect after its first render, and a sheet first rendered open on a phone starts in
  // its desktop layout and is left offset off the right edge when it switches (seen at 375 in the browser sweep).
  return createPortal(sheet, document.body);
}
