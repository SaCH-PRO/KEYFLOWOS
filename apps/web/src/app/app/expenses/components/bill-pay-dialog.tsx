"use client";

/**
 * EXPENSES-HUB-1 (BUG-025; owner ruling billpay D-168: "The app always asks. A request that names no account keeps
 * today's Cash default"). Paying a bill asks which account and which method pay it, then sends both through the bill
 * door (POST /finance/.../bills/:id/pay, which takes paymentAccountId). Nothing is paid until Pay is pressed.
 *
 * The accounts offered are the ones the server accepts (expenses.service resolveBillPaymentCoa): active, of type
 * CASH, BANK, PAYMENT_PROCESSOR or CREDIT_CARD, in the bill's currency (D-13, nothing converted). GET accounts needs
 * revenue read (D-146): when that read is refused (a scope refusal: this member cannot list accounts), or no account
 * fits, Pay says so and sends the method only, which the server pays from that method's default account. A read that
 * FAILED (a 5xx, a BusinessGuard 403, the network) is not an answer: Pay says so, offers Retry and cannot be pressed,
 * so a bill is never paid from a default account because a list did not load (review SEC MINOR-2, D-168).
 */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@keyflow/ui";
import { fetchFinanceAccounts, PAYMENT_METHODS, type Expense, type FinancialAccountRow } from "@/lib/client";
import { payBill } from "@/lib/api/finance";
import { toast } from "sonner";
import { readState, refusalMessage } from "@/lib/failure-kit";
import { canStartFor, formatCurrency, useShownBusiness } from "./expense-utils";

const FOCUSABLE = "select:not([disabled]), button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

const BILL_PAYMENT_ACCOUNT_TYPES = new Set(["CASH", "BANK", "PAYMENT_PROCESSOR", "CREDIT_CARD"]);

const norm = (c: string | null | undefined) => (c ?? "").trim().toUpperCase();

/** The accounts the server lets this bill be paid from, the default one first. */
export function billPaymentAccounts(accounts: FinancialAccountRow[], billCurrency: string): FinancialAccountRow[] {
  const bill = norm(billCurrency);
  return accounts
    .filter((a) => a.isActive && BILL_PAYMENT_ACCOUNT_TYPES.has(a.type) && (norm(a.currency) || bill) === bill)
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

function defaultMethod(bill: Expense): string {
  const current = (bill.paymentMethod ?? "").toLowerCase();
  if (PAYMENT_METHODS.some((m) => m.value === current)) return current;
  return PAYMENT_METHODS[0]?.value ?? "cash";
}

type Accounts =
  | { kind: "loading" }
  | { kind: "ok"; items: FinancialAccountRow[] }
  | { kind: "no-access"; message: string }
  | { kind: "failed"; message: string };

export function BillPayDialog({
  businessId,
  bill,
  onClose,
  onPaid,
  isCurrentBusiness: hookCheck,
}: {
  businessId: string;
  bill: Expense;
  onClose: () => void;
  onPaid: (paid: Expense | null) => void;
  /** R14: the parent's check that the business this bill is for is still the one shown (fallback: this prop's own). */
  isCurrentBusiness?: (businessId: string) => boolean;
}) {
  const shownCheck = useShownBusiness(businessId);
  const isCurrentBusiness = hookCheck ?? shownCheck;
  // Bumped by Retry: reads the accounts again.
  const [attempt, setAttempt] = useState(0);
  // Each read's answer and the account chosen from it are kept with the read they belong to (this business, this
  // bill, this attempt). When the business or the bill changes, or Retry is pressed, the dialog is loading again at
  // once and no earlier answer or account id can be shown or sent (review SEC MINOR-2, round 2).
  // The method chosen and a refusal shown belong to this business and bill (not to a read: Retry keeps them), so a
  // change of business or bill starts from the new bill's defaults (review round 3).
  const billKey = `${businessId}|${bill.id}|${norm(bill.currency)}`;
  const readKey = `${billKey}|${attempt}`;
  const [loaded, setLoaded] = useState<{ key: string; accounts: Accounts } | null>(null);
  const [selected, setSelected] = useState<{ key: string; id: string } | null>(null);
  const accounts: Accounts = loaded?.key === readKey ? loaded.accounts : { kind: "loading" };
  const accountId = selected?.key === readKey ? selected.id : "";
  const [chosenMethod, setChosenMethod] = useState<{ key: string; value: string } | null>(null);
  const method = chosenMethod?.key === billKey ? chosenMethod.value : defaultMethod(bill);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [said, setSaid] = useState<{ key: string; text: string } | null>(null);
  const message = said?.key === billKey ? said.text : null;

  // Keyboard and focus (review round 3; no shared primitive offers all of it: @keyflow/ui Dialog handles Escape
  // only). Focus moves into the dialog on open and returns to what opened it on close; Tab and Shift+Tab stay
  // inside; Escape closes it, except while a pay is in flight, and never reaches the app's Escape shortcut.
  const formRef = useRef<HTMLFormElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    formRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      const form = formRef.current;
      if (!form) return;
      if (e.key === "Escape") {
        // Pay's Escape stays in Pay: the app's own Escape shortcut (use-keyboard-shortcuts, on window) would also go
        // from this expense to the list, mid-pay included.
        e.stopPropagation();
        if (inFlight.current) return;
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = Array.from(form.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        // Nothing to move to (every control is disabled while a pay is in flight): focus stays on the dialog itself
        // (tabIndex -1), never on the page behind it (review round 4).
        e.preventDefault();
        form.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      // From outside the controls (the dialog itself, or elsewhere), Tab enters at the first and Shift+Tab at the last.
      const outside = active === form || !form.contains(active);
      const wrap = outside || (e.shiftKey ? active === first : active === last);
      if (wrap) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const res = await fetchFinanceAccounts(businessId).catch(() => null);
      if (!live) return;
      const state = readState(res, { what: "the payment accounts" });
      if (state.kind !== "ok") {
        setLoaded({ key: readKey, accounts: { kind: state.kind, message: state.message } });
        return;
      }
      const items = billPaymentAccounts(res?.data?.items ?? [], bill.currency);
      setLoaded({ key: readKey, accounts: { kind: "ok", items } });
      setSelected({ key: readKey, id: items[0]?.id ?? "" });
    })();
    return () => {
      live = false;
    };
  }, [businessId, bill.currency, readKey]);

  const retry = () => setAttempt((n) => n + 1);

  // Pay can be pressed once the owner has been asked: the accounts listed, or their read refused (method only).
  const canPay = accounts.kind === "ok" || accounts.kind === "no-access";

  // Pay is the form's submit (the button, or Enter): this guard is what stops a submit while the accounts are
  // loading or failed, not only the disabled button.
  const pay = async () => {
    if (inFlight.current || !canPay) return;
    // R15-1 / R18-6: the shared start check (the stored id, and the given check). Another tab's switch can reach the
    // stored id before its storage event reaches this tab: nothing is paid for the business no longer chosen, and the
    // dialog for it closes without a word (there is nothing to retry for it here).
    if (!canStartFor(businessId, isCurrentBusiness)) {
      onClose();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setSaid(null);
    // A refusal keeps Pay open with the server's words beside the button, and says them in a toast (FAILURE-KIT).
    const key = billKey;
    const refused = (text: string) => {
      setSaid({ key, text });
      toast.error(text);
    };
    try {
      const body: { paymentAccountId?: string; paymentMethod: string } = { paymentMethod: method };
      if (accounts.kind === "ok" && accountId) body.paymentAccountId = accountId;
      const res = await payBill(businessId, bill.id, body);
      // R14: a pay that answers after a switch to another business says nothing there and reports nothing paid.
      if (!isCurrentBusiness(businessId)) return;
      const refusal = refusalMessage(res, { what: "pay this bill" });
      if (refusal !== null) refused(refusal);
      else onPaid(res.data ?? null);
    } catch {
      if (isCurrentBusiness(businessId)) refused("Couldn't pay this bill.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const noAccountNote =
    accounts.kind === "no-access"
      ? `${accounts.message} Pay sends the method only: the bill is paid from that method's default account.`
      : accounts.kind === "ok" && accounts.items.length === 0
        ? `No payment account in ${norm(bill.currency)}. Pay sends the method only: the bill is paid from that method's default account.`
        : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="bill-pay-title">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={busy ? undefined : onClose} aria-hidden="true" />
      <form
        ref={formRef}
        tabIndex={-1}
        onSubmit={(e) => {
          e.preventDefault();
          void pay();
        }}
        className="relative z-10 w-full max-w-md mx-4 rounded-xl border border-border/60 bg-card p-6 shadow-2xl outline-none">
        <h3 id="bill-pay-title" className="text-lg font-semibold text-foreground mb-1">Pay bill</h3>
        <p className="text-sm text-muted-foreground mb-4">
          {bill.vendor || bill.description} · {formatCurrency(bill.amount, bill.currency, businessId)}
        </p>

        <div className="space-y-4">
          {accounts.kind === "loading" ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading accounts…
            </p>
          ) : accounts.kind === "ok" && accounts.items.length > 0 ? (
            <div>
              <label htmlFor="bill-pay-account" className="text-xs font-medium text-muted-foreground mb-1 block">Pay from</label>
              <select
                id="bill-pay-account"
                value={accountId}
                onChange={(e) => setSelected({ key: readKey, id: e.target.value })}
                disabled={busy}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground"
              >
                {accounts.items.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.accountLast4 ? ` ····${a.accountLast4}` : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {noAccountNote && <p className="text-xs text-amber-700">{noAccountNote}</p>}
          {accounts.kind === "failed" && (
            <div role="alert" className="flex items-start justify-between gap-3 text-sm text-rose-600">
              <span>{accounts.message} Pay waits for them, so the bill is not paid from an account you did not choose.</span>
              <Button variant="subtle" onClick={retry}>
                Retry
              </Button>
            </div>
          )}

          {/* Asked together with the account, once the accounts have answered: a method alone while they load is
              a question the owner answers without the account (live journey H5 paid from Cash that way). */}
          {canPay && (
            <div>
              <label htmlFor="bill-pay-method" className="text-xs font-medium text-muted-foreground mb-1 block">Payment method</label>
              <select
                id="bill-pay-method"
                value={method}
                onChange={(e) => setChosenMethod({ key: billKey, value: e.target.value })}
                disabled={busy}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {message && (
            <p role="alert" className="text-sm text-rose-600">
              {message}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="subtle" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !canPay} aria-busy={busy || undefined}>
            {busy && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
            Pay
          </Button>
        </div>
      </form>
    </div>
  );
}
