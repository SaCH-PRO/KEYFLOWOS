"use client";

import { useState } from "react";
import { Loader2, Mail, Send, X } from "lucide-react";
import { toast } from "sonner";
import { sendAccountantExportEmail } from "@/lib/client";
import { isModuleScopeRefusal } from "@/lib/module-scope-refusal";

/**
 * FU-FINANCE-SETTINGS-SCOPE (V1-71): the server refuses a send that saves a new accountant address (saveRecipient)
 * unless the member holds settings admin and revenue read: "Insufficient permissions: saving the accountant's email
 * address, which receives the business's books (the accountant export), needs settings admin access (you have none)".
 * The whole request is undone (nothing sent, nothing written), so the box says that and claims nothing.
 *
 * Repair (review FSS-CR-2): the words say what this box refused, saving a new default from here, and no wider rule:
 * PATCH settings still writes the address for every revenue reader until owner question 19 is answered (required
 * Release 0 cases D11F-F05, F06 and F11 pin it). Review FSS-CR-3: with no saved address "Remember" starts ticked, so a
 * member without settings admin is refused on a first send; the box unticks it and offers "Send without saving", the
 * same address in one click.
 */
export const ACCOUNTANT_SAVE_REFUSED =
  "Nothing was sent, and the saved accountant address was not changed: saving a new default recipient from here needs settings admin access in this business. You can still send the export to this address without saving it.";

type SendAnswer = { error?: string | null; status?: number } | null | undefined;

/** Whether a send was refused for its saveRecipient (the server's binding refusal), not for the send itself. */
export function isAccountantSaveRefusal(res: SendAnswer): boolean {
  return Boolean(res && res.error && res.status === 403 && /\baccountant's email address\b/.test(res.error));
}

/** What the accountant box says when a send is answered with an error, in plain words, or null when it went through. */
export function accountantSendRefusal(res: SendAnswer): string | null {
  if (!res || !res.error) return null;
  if (isAccountantSaveRefusal(res)) return ACCOUNTANT_SAVE_REFUSED;
  if (isModuleScopeRefusal(res, "revenue")) return "Nothing was sent: sending the accountant export needs access to this business's books.";
  return `Nothing was sent. ${res.error}`;
}

/**
 * The "Send to accountant" box of the Reports and Tax pages (one component: the two copies had drifted apart only in
 * their icons). Sends the accountant export ZIP for a period to an address; "Remember this as the default recipient"
 * asks the server to save it as Business.accountantEmail, and `onSavedDefault` runs only when the server says it did.
 */
export function SendAccountantExportModal({
  businessId, start, end, defaultEmail, onClose, onSavedDefault,
}: {
  businessId: string;
  start: string;
  end: string;
  defaultEmail: string | null;
  onClose: () => void;
  onSavedDefault: (v: string | null) => void;
}) {
  const [to, setTo] = useState(defaultEmail ?? "");
  const [message, setMessage] = useState("");
  const [saveDefault, setSaveDefault] = useState(!defaultEmail);
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  // Review FSS-CR-3: the saveRecipient was refused, so the box offers the same send without saving.
  const [offerUnsaved, setOfferUnsaved] = useState(false);

  const submit = async (saveRecipient: boolean) => {
    if (!to.trim()) {
      toast.error("Recipient email is required");
      return;
    }
    setSending(true);
    setRefusal(null);
    setOfferUnsaved(false);
    const r = await sendAccountantExportEmail(businessId, {
      start, end,
      to: to.trim(),
      message: message.trim() || null,
      saveRecipient,
    });
    setSending(false);
    const refused = accountantSendRefusal(r);
    if (refused) {
      // The box stays open with what was typed. A refused save of the recipient unticks "Remember" (so a plain Send
      // does not ask again) and offers "Send without saving".
      setRefusal(refused);
      if (isAccountantSaveRefusal(r)) {
        setSaveDefault(false);
        setOfferUnsaved(true);
      }
      toast.error(refused);
      return;
    }
    toast.success(`Sent to ${r.data?.to ?? to.trim()}`);
    if (r.data?.savedAsDefault) onSavedDefault(r.data.to);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md bg-background border border-border rounded-xl shadow-xl">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Send accountant export</h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-card text-muted-foreground" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Sends the accountant export ZIP for <strong>{start}</strong> to <strong>{end}</strong> as an
            email attachment via Keyflow&apos;s mailer.
          </p>
          <label className="block">
            <span className="text-xs font-medium">Recipient email</span>
            <input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="accountant@firm.com"
              className="mt-1 w-full rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-sm"
              autoFocus
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Cover note (optional)</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="Hi — attached is the latest export for your review."
              className="mt-1 w-full rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-sm resize-none"
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={saveDefault}
              onChange={(e) => setSaveDefault(e.target.checked)}
              className="rounded border-border"
            />
            Remember this as the default recipient
          </label>
          {refusal && (
            <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
              {refusal}
            </p>
          )}
          {offerUnsaved && (
            <button
              type="button"
              onClick={() => submit(false)}
              disabled={sending || !to.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border hover:bg-card disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              Send without saving
            </button>
          )}
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border hover:bg-card"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => submit(saveDefault)}
            disabled={sending || !to.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Send email
          </button>
        </div>
      </div>
    </div>
  );
}
