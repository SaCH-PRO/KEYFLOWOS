"use client";

/**
 * EXPENSES-HUB-1 (BUG-025; owner ruling billpay D-168: "The app always asks. A request that names no account keeps
 * today's Cash default"). Paying a bill asks which account and which method pay it, then sends both through the bill
 * door (POST /finance/.../bills/:id/pay, which takes paymentAccountId). Nothing is paid until Pay is pressed.
 *
 * The accounts offered are the ones the server accepts (expenses.service resolveBillPaymentCoa): active, of type
 * CASH, BANK, PAYMENT_PROCESSOR or CREDIT_CARD, in the bill's currency (D-13, nothing converted). GET accounts needs
 * revenue read (D-146): when it is refused, or no account fits, Pay says so and sends the method only, which the
 * server pays from that method's default account.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@keyflow/ui";
import { fetchFinanceAccounts, PAYMENT_METHODS, type Expense, type FinancialAccountRow } from "@/lib/client";
import { payBill } from "@/lib/api/finance";
import { toast } from "sonner";
import { readState, refusalMessage } from "@/lib/failure-kit";
import { formatCurrency } from "./expense-utils";

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
  | { kind: "unavailable"; message: string };

export function BillPayDialog({
  businessId,
  bill,
  onClose,
  onPaid,
}: {
  businessId: string;
  bill: Expense;
  onClose: () => void;
  onPaid: (paid: Expense | null) => void;
}) {
  const [accounts, setAccounts] = useState<Accounts>({ kind: "loading" });
  const [accountId, setAccountId] = useState("");
  const [method, setMethod] = useState(() => defaultMethod(bill));
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const res = await fetchFinanceAccounts(businessId).catch(() => null);
      if (!live) return;
      const state = readState(res, { what: "the payment accounts" });
      if (state.kind !== "ok") {
        setAccounts({ kind: "unavailable", message: state.message });
        return;
      }
      const items = billPaymentAccounts(res?.data?.items ?? [], bill.currency);
      setAccounts({ kind: "ok", items });
      setAccountId(items[0]?.id ?? "");
    })();
    return () => {
      live = false;
    };
  }, [businessId, bill.currency]);

  const pay = async () => {
    if (inFlight.current || accounts.kind === "loading") return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    // A refusal keeps Pay open with the server's words beside the button, and says them in a toast (FAILURE-KIT).
    const refused = (said: string) => {
      setMessage(said);
      toast.error(said);
    };
    try {
      const body: { paymentAccountId?: string; paymentMethod: string } = { paymentMethod: method };
      if (accounts.kind === "ok" && accountId) body.paymentAccountId = accountId;
      const res = await payBill(businessId, bill.id, body);
      const said = refusalMessage(res, { what: "pay this bill" });
      if (said !== null) refused(said);
      else onPaid(res.data ?? null);
    } catch {
      refused("Couldn't pay this bill.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const noAccountNote =
    accounts.kind === "unavailable"
      ? `${accounts.message} Pay sends the method only: the bill is paid from that method's default account.`
      : accounts.kind === "ok" && accounts.items.length === 0
        ? `No payment account in ${norm(bill.currency)}. Pay sends the method only: the bill is paid from that method's default account.`
        : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="bill-pay-title">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={busy ? undefined : onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md mx-4 rounded-xl border border-border/60 bg-card p-6 shadow-2xl">
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
                onChange={(e) => setAccountId(e.target.value)}
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

          <div>
            <label htmlFor="bill-pay-method" className="text-xs font-medium text-muted-foreground mb-1 block">Payment method</label>
            <select
              id="bill-pay-method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
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
          <Button onClick={pay} disabled={busy || accounts.kind === "loading"} aria-busy={busy || undefined}>
            {busy && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
            Pay
          </Button>
        </div>
      </div>
    </div>
  );
}
