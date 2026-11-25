/**
 * SWP-INV-REFUND-UI repair round 1: the pure rules of lib/manual-refund.ts, pinned to the server they mirror.
 *
 *   - isManualPayment fails closed (security MINOR-1/2): a payment is the hand-recording door's only when its
 *     providerPaymentId is one of the slots CommerceService.recordPayment builds (manual_<invoiceId>_key_<32 hex>,
 *     manual_<invoiceId>_ref_<32 hex>, manual_<invoiceId>_markpaid_<32 hex>, manual_<epoch ms>_<base36>), the prefix the
 *     server itself reads as hand-recorded (payments.service.ts MANUAL_PAYMENT_ID_PREFIX). Its provider is the method
 *     text the member typed ("Cash", "PayPal") and proves nothing, so no provider name, in any casing, makes a row
 *     refundable; a gateway row, an unknown provider's row, a storefront order's row and a pay-link intent are not.
 *   - manualRefundableAmount sums as the server's refundableOf does (correctness MINOR-4): refund rows are those with
 *     amount < 0 (not "< 0 once rounded"), summed as exact decimals and rounded once, half away from zero.
 *
 * RED-R1 cases fail at 58423afe.
 */
import { describe, it, expect } from "vitest";
import { isManualPayment, manualRefundableAmount } from "../manual-refund";

const INV = "cmw1invoice0001";
const HEX = "0123456789abcdef0123456789abcdef";

function row(providerPaymentId: string, over: Partial<{ provider: string; status: string; amount: number; invoiceId: string }> = {}) {
  return { provider: "Cash", status: "SUCCESSFUL", amount: 100, invoiceId: INV, providerPaymentId, reference: null as string | null, ...over };
}

describe("isManualPayment: the hand-recording door's rows only (fail closed)", () => {
  it("RED-R1: offers the slots recordPayment builds, whatever the provider text", () => {
    expect(isManualPayment(row(`manual_${INV}_key_${HEX}`))).toBe(true);
    expect(isManualPayment(row(`manual_${INV}_ref_${HEX}`, { provider: "PayPal" }))).toBe(true);
    expect(isManualPayment(row(`manual_${INV}_markpaid_${HEX}`, { provider: "manual" }))).toBe(true);
    expect(isManualPayment(row("manual_1764000000000_k3x9q2", { provider: "Other" }))).toBe(true);
  });

  it("RED-R1: refuses gateway rows, unknown providers, other casings, storefront orders, intents and refunds", () => {
    expect(isManualPayment(row("pi_3abc", { provider: "stripe" })), "stripe").toBe(false);
    expect(isManualPayment(row("8AB12345CD678901E", { provider: "paypal" })), "paypal").toBe(false);
    expect(isManualPayment(row("wipay_txn_77", { provider: "wipay" })), "wipay").toBe(false);
    expect(isManualPayment(row("pi_999", { provider: "Stripe" })), "a gateway name in another casing").toBe(false);
    expect(isManualPayment(row("WIPAY_1", { provider: "WiPay" })), "WiPay").toBe(false);
    expect(isManualPayment(row("fyg_abc123", { provider: "fygaro" })), "an unknown provider").toBe(false);
    expect(isManualPayment(row("ch_3abc", { provider: "manual" })), "a provider that says manual proves nothing").toBe(false);
    expect(isManualPayment(row("manual_cmorder123_1764000000000", { provider: "manual" })), "a storefront order's row").toBe(false);
    expect(isManualPayment(row(`manual_otherinvoice_key_${HEX}`)), "another invoice's slot").toBe(false);
    expect(isManualPayment(row(`manual_${INV}_intent_${HEX}`, { status: "PENDING" })), "a pay-link intent").toBe(false);
    expect(isManualPayment(row(`manual_refund_pay1_${HEX.slice(0, 16)}`, { status: "REFUNDED", amount: -100 })), "a refund row").toBe(false);
    expect(isManualPayment(row(`manual_${INV}_key_${HEX}`, { status: "PENDING" })), "not money yet").toBe(false);
  });
});

describe("manualRefundableAmount: summed as the server sums it", () => {
  const pay = { amount: 100, provider: "Cash", providerPaymentId: `manual_${INV}_key_${HEX}`, reference: null };
  const refund = (amount: number, reference: string | null = pay.providerPaymentId, provider = "Cash") => ({
    amount,
    status: "REFUNDED",
    provider,
    providerPaymentId: `manual_refund_x_${Math.abs(amount)}`,
    reference,
  });

  it("RED-R1: two legacy sub-cent refunds (-0.004 each) sum to 0.008 and round once to 0.01", () => {
    expect(manualRefundableAmount(pay, [{ ...pay, status: "SUCCESSFUL" }, refund(-0.004), refund(-0.004)], 500)).toBe(99.99);
  });

  it("RED-R1: a lone -0.005 rounds half away from zero to 0.01", () => {
    expect(manualRefundableAmount(pay, [{ ...pay, status: "SUCCESSFUL" }, refund(-0.005)], 500)).toBe(99.99);
  });

  it("CONTROL: an unlinked same-provider refund is subtracted, a linked one by provider and reference too, and the net caps it", () => {
    const original = { ...pay, status: "SUCCESSFUL" };
    expect(manualRefundableAmount(pay, [original, refund(-60, null)], 500)).toBe(40);
    const withRef = { ...pay, reference: "R-7" };
    expect(manualRefundableAmount(withRef, [{ ...withRef, status: "SUCCESSFUL" }, refund(-100, "R-7")], 500)).toBe(0);
    expect(manualRefundableAmount(pay, [original, refund(-30, null, "Bank Transfer")], 500), "another provider's unlinked refund").toBe(100);
    expect(manualRefundableAmount(pay, [original], 40)).toBe(40);
  });
});
