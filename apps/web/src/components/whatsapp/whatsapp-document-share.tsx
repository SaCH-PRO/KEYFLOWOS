"use client";

/**
 * FU-WA-CONTACT-PHONE (V1-71; whatsapp ruling D-153, follow-ups ruling D-221):
 * the WhatsApp share of a quote or invoice, with its one-time confirm step.
 *
 * The share carries the document's bearer link, so it opens the chat only for
 * the WhatsApp number the business saved on the customer (WA-HELPER, SEC-WAH-1:
 * a public form can fill a customer's phone). A customer with a phone and no
 * WhatsApp number (created by an owner, the composer's quick-add or a CSV
 * import, or filled by the website) gets one step: it shows the E.164 reading
 * of that phone and one button, 'Use this as their WhatsApp number', which
 * saves it on the customer through the contact update route (the member's own
 * crm write; the server checks and audits it) and then opens the chat with
 * that number and the link. A refusal is said in plain words, with the chooser
 * as the way on ('Share without a number'). Nothing is saved and nothing opens
 * until the member chooses.
 *
 * The step does not vouch for the phone (review SEC-WACP-1). The storefront
 * intake, bookings and orders fill a blank phone on the customer they match by
 * e-mail, and that fill leaves nothing the web can read (no audit entry, the
 * source unchanged), so a phone on file may be one an anonymous visitor typed.
 * Once saved, the number is trusted for this share and every later one. So the
 * step says the phone may not be the customer's and where it may have come
 * from, asks the member to save it only if they know it is the customer's
 * WhatsApp, says what the link gives whoever gets it and that later quotes and
 * invoices go to the number without asking, and opens with the focus on the
 * safe choice ('Share without a number'), so Enter never saves it.
 *
 * Escape closes the step alone (review COR-WACP-1): the step takes Escape on
 * window in the capture phase, before the detail modal under it
 * (BillingDetailModal listens on document) or any other screen listener sees
 * it, and only while the step is open.
 *
 * Used by the quotes panel, the Sales > Invoices panel and the Invoices hub;
 * every chat URL is built by lib/whatsapp.ts.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@keyflow/ui";
import { buildWhatsAppLink, saveWhatsAppNumber, type WhatsAppShareNumber } from "@/lib/whatsapp";

export interface WhatsAppDocumentShare {
  /** Where the share may open, read by id at share time (readWhatsAppShareNumber). */
  number: WhatsAppShareNumber;
  businessId: string | null | undefined;
  contactId: string | null | undefined;
  /** The message, prefilled. */
  text?: string | null;
  /** The document's tokenized link, after the text. */
  link?: string | null;
  /** The business's country (ownBusinessCountry()). */
  country?: string | null;
  /** What is being shared, for the step's words. */
  what: "quote" | "invoice";
}

type ConfirmNumber = Extract<WhatsAppShareNumber, { kind: "confirm" }>;

interface PendingShare {
  share: WhatsAppDocumentShare;
  confirm: ConfirmNumber;
  saving: boolean;
  refusal: string | null;
  /** The server refused this member the save: it is not offered again. */
  refused: boolean;
}

function openChat(share: WhatsAppDocumentShare, to: string | null): void {
  window.open(
    buildWhatsAppLink({ to, text: share.text, link: share.link, country: share.country }),
    "_blank",
    "noopener,noreferrer",
  );
}

/**
 * The share and the confirm step it may need. Render `dialog` in the screen;
 * call `share` once the link is made.
 */
export function useWhatsAppDocumentShare(): { share: (share: WhatsAppDocumentShare) => void; dialog: ReactNode } {
  const [pending, setPending] = useState<PendingShare | null>(null);
  /** The share whose step is open: a save that answers after the step was closed opens nothing. */
  const openShare = useRef<WhatsAppDocumentShare | null>(null);

  const share = useCallback((next: WhatsAppDocumentShare) => {
    if (next.number.kind === "confirm") {
      openShare.current = next;
      setPending({ share: next, confirm: next.number, saving: false, refusal: null, refused: false });
      return;
    }
    openChat(next, next.number.kind === "saved" ? next.number.number : null);
  }, []);

  const close = useCallback(() => {
    openShare.current = null;
    setPending(null);
  }, []);

  const withoutNumber = useCallback(() => {
    if (!pending) return;
    close();
    openChat(pending.share, null);
  }, [pending, close]);

  const confirm = useCallback(async () => {
    if (!pending || pending.saving) return;
    const { share: current, confirm: reading } = pending;
    setPending({ ...pending, saving: true, refusal: null });
    const result = await saveWhatsAppNumber(current.businessId, current.contactId, reading.e164);
    const stillOpen = openShare.current === current;
    if (!result.ok) {
      if (stillOpen) setPending((p) => (p && p.share === current ? { ...p, saving: false, refusal: result.refusal, refused: result.permission } : p));
      else toast.error(result.refusal);
      return;
    }
    toast.success(`Saved as ${reading.name ?? "the customer"}'s WhatsApp number`);
    if (!stillOpen) return;
    close();
    openChat(current, result.number);
  }, [pending, close]);

  const dialog = pending ? (
    <WhatsAppNumberConfirm
      reading={pending.confirm}
      what={pending.share.what}
      saving={pending.saving}
      refusal={pending.refusal}
      refused={pending.refused}
      onConfirm={confirm}
      onWithoutNumber={withoutNumber}
      onClose={close}
    />
  ) : null;

  return { share, dialog };
}

interface WhatsAppNumberConfirmProps {
  reading: ConfirmNumber;
  what: WhatsAppDocumentShare["what"];
  saving: boolean;
  refusal: string | null;
  refused: boolean;
  onConfirm: () => void;
  onWithoutNumber: () => void;
  onClose: () => void;
}

/**
 * The confirm step: the phone's E.164 reading, why it may not be the customer's,
 * and one button that saves it as the WhatsApp number.
 */
function WhatsAppNumberConfirm({ reading, what, saving, refusal, refused, onConfirm, onWithoutNumber, onClose }: WhatsAppNumberConfirmProps) {
  const titleId = useId();
  const descriptionId = useId();
  const fallbackRef = useRef<HTMLButtonElement>(null);

  // A layout effect (FU-WA-ESCAPE-RACE): the listener is on window when the step's DOM is.
  // The step mounts from a non-event update (the pay link resolved), and a passive effect
  // runs a scheduler task later, so an Escape in between went to the modal under the step.
  useLayoutEffect(() => {
    const returnTo = typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
    // The safe choice has the focus: Enter never saves a number the member has not read.
    fallbackRef.current?.focus();
    // The topmost layer takes its Escape first: window, capture phase, then no further.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      returnTo?.focus?.();
    };
  }, [onClose]);

  // Refused: the save button is gone, and the way on is sharing without a number.
  useEffect(() => {
    if (refused) fallbackRef.current?.focus();
  }, [refused]);

  if (typeof document === "undefined") return null;

  const who = reading.name ?? "this customer";
  const whose = reading.name ? `${reading.name}'s` : "the customer's";
  const sameAsStored = reading.phone.replace(/[^\d+]/g, "") === reading.e164;
  const linkGives = what === "invoice" ? "see and pay this invoice" : "see, accept or reject this quote";

  return createPortal(
    <div className="fixed inset-0 z-[var(--kf-z-modal)] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative z-10 mx-4 mb-4 w-full max-w-md rounded-2xl border border-border/60 bg-card p-5 shadow-2xl sm:mb-0"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/50"
        >
          <X className="h-4 w-4" />
        </button>
        <h2 id={titleId} className="pr-10 text-base font-semibold">
          Is this {whose} WhatsApp number?
        </h2>
        <div id={descriptionId} className="mt-2 space-y-2 text-sm text-muted-foreground">
          <p>
            No WhatsApp number is saved for {who}.{" "}
            {sameAsStored ? (
              "The phone number on the customer's record is:"
            ) : (
              <>
                The phone number on the customer&apos;s record,{" "}
                <span className="whitespace-nowrap text-foreground">{reading.phone}</span>, reads as:
              </>
            )}
          </p>
          <p className="text-lg font-semibold tabular-nums tracking-wide text-foreground">{reading.e164}</p>
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-foreground">
            This number may not be {whose}. Your website&apos;s forms, bookings and orders can add a phone number to a
            customer&apos;s record, and anyone can type one there.
          </p>
          <p>
            Save it as their WhatsApp number only if you know it is {whose} WhatsApp: whoever gets the link can{" "}
            {linkGives}. Once saved, later quotes and invoices for {who} go to this number without asking.
          </p>
        </div>
        {refusal && (
          <p role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-foreground">
            {refusal}
          </p>
        )}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={fallbackRef} variant="subtle" size="lg" onClick={onWithoutNumber} className="min-h-[44px] w-full sm:w-auto">
            Share without a number
          </Button>
          {!refused && (
            <Button
              size="lg"
              onClick={onConfirm}
              disabled={saving}
              aria-busy={saving || undefined}
              className="min-h-[44px] w-full sm:w-auto"
            >
              Use this as their WhatsApp number
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
