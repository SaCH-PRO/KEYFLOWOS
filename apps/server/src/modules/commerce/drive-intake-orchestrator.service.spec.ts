/**
 * R0-CMF2-PAYMENT-ACTOR-GAPS (R0-11 review ST-R011-3): the drive-intake
 * record_payment step records the human who approved the plan.
 *
 * DriveIntakeOrchestrator.executePlan(businessId, intakeFileId, userId) passed
 * userId to credit notes, messages and the follow-up task, but called
 * CommerceService.recordPayment(invoiceId, businessId, { amount, method,
 * reference }) with no options, so the payment it wrote had recordedBy null
 * and a posting with no creator.
 *
 * Contract pinned here (the orchestrator's collaborators are stubs; the real
 * route and the real recordPayment are proven in
 * test/payments-actor.integration.test.ts PA-18a..b):
 *
 *   approver U, record_payment on a plan invoice      -> recordPayment(..., { actorId: U })
 *   approver U, record_payment on the invoice the plan created -> { actorId: U }
 *   a recorder named in the plan payload (it comes from document extraction)
 *     never reaches recordPayment: input is { amount, method, reference,
 *     idempotencyKey }
 *   no human approver: the ingestion auto-execute ('system') and the data-inbox
 *     fallback when the request carries no user ('user') -> actorId null; the
 *     placeholder is recorded nowhere (payments-actor PA-08: no actor is invented)
 *
 * R0-CMF2 review (SEC-CMF2-2): the record_payment step passes
 * idempotencyKey `drive:<intakeFileId>:<actionIndex>`, so a second execution
 * of the same step (two concurrent approvals, or a re-run after a crash before
 * the 'approved' flip) replays the first payment instead of crediting the
 * invoice twice; two record_payment steps of one plan keep distinct keys.
 * The real replay is proven in payments-actor PA-18c..d.
 *
 * V1-41-DM-UNTRUSTED-MONEY-INPUTS (D-27): the step no longer records money.
 * It hands the same arguments to PaymentEvidenceService.recordPendingPayment,
 * which writes the payment PENDING (no posting, no balance move) until a member
 * with revenue:write confirms it; CommerceService.recordPayment is never called
 * by the plan. The pending row and its confirmation are proven in
 * test/untrusted-payment-inputs.integration.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DriveIntakeOrchestrator, type DriveIntakePlan } from './drive-intake-orchestrator.service';

const BIZ = 'biz_dio';
const INTAKE = 'intake_dio';
const APPROVER = 'user_dio_approver';

function makeOrchestrator(plan: DriveIntakePlan) {
  const prisma = {
    client: {
      driveIntakeFile: {
        findFirst: vi.fn().mockResolvedValue({ id: INTAKE, businessId: BIZ, status: 'reviewing', proposedActions: plan }),
        update: vi.fn().mockResolvedValue({}),
      },
      aiApprovalItem: { findFirst: vi.fn().mockResolvedValue(null) },
    },
  };
  const commerce = {
    recordPayment: vi.fn().mockResolvedValue({ payment: { id: 'pay_dio' } }),
    createInvoice: vi.fn().mockResolvedValue({ id: 'inv_created_by_plan' }),
  };
  // V1-41 (D-27): the PENDING writer the record_payment step calls.
  const paymentEvidence = { recordPendingPayment: vi.fn().mockResolvedValue({ id: 'pay_dio', status: 'PENDING' }) };
  const invoiceWorkflow = { transition: vi.fn().mockResolvedValue(undefined) };
  const crm = { addTask: vi.fn() };
  const governance = { resolveApproval: vi.fn() };
  const orchestrator = new DriveIntakeOrchestrator(
    prisma as any,
    crm as any,
    {} as any,
    {} as any,
    governance as any,
    commerce as any,
    invoiceWorkflow as any,
    {} as any,
    {} as any,
    paymentEvidence as any,
  );
  return { orchestrator, prisma, commerce, paymentEvidence };
}

function paymentPlan(payload: Record<string, unknown>, extra: DriveIntakePlan['actions'] = []): DriveIntakePlan {
  return {
    intakeFileId: INTAKE,
    documentType: 'receipt',
    summary: 'dio receipt',
    actions: [...extra, { type: 'record_payment', payload }],
  };
}

describe('DriveIntakeOrchestrator.executePlan record_payment names the approver (ST-R011-3)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('DIO-01: an approved plan records its payment with the approving user as the actor', async () => {
    const { orchestrator, commerce, paymentEvidence } = makeOrchestrator(
      paymentPlan({ invoiceId: 'inv_dio', amount: 40, method: 'bank_transfer', reference: 'DIO-1' }),
    );
    const result = await orchestrator.executePlan(BIZ, INTAKE, APPROVER);
    expect(result.success).toBe(true);
    expect(paymentEvidence.recordPendingPayment).toHaveBeenCalledTimes(1);
    expect(commerce.recordPayment).not.toHaveBeenCalled();
    expect(paymentEvidence.recordPendingPayment).toHaveBeenCalledWith(
      'inv_dio',
      BIZ,
      { amount: 40, method: 'bank_transfer', reference: 'DIO-1', idempotencyKey: `drive:${INTAKE}:0` },
      { actorId: APPROVER },
    );
  });

  it('DIO-02: a payment on the invoice the same plan created is recorded with the approving user as the actor', async () => {
    const { orchestrator, commerce, paymentEvidence } = makeOrchestrator(
      paymentPlan({ amount: 25, method: 'cash' }, [
        { type: 'create_invoice', payload: { items: [{ description: 'x', quantity: 1, unitPrice: 25 }], currency: 'TTD' } },
      ]),
    );
    const result = await orchestrator.executePlan(BIZ, INTAKE, APPROVER);
    expect(result.success).toBe(true);
    expect(paymentEvidence.recordPendingPayment).toHaveBeenCalledWith(
      'inv_created_by_plan',
      BIZ,
      { amount: 25, method: 'cash', reference: undefined, idempotencyKey: `drive:${INTAKE}:1` },
      { actorId: APPROVER },
    );
    expect(commerce.recordPayment).not.toHaveBeenCalled();
  });

  it('DIO-03: a recorder named in the plan payload never reaches recordPayment; the approver is the actor', async () => {
    const { orchestrator, commerce, paymentEvidence } = makeOrchestrator(
      paymentPlan({
        invoiceId: 'inv_dio',
        amount: 10,
        method: 'cash',
        reference: 'DIO-3',
        actorId: 'mallory',
        recordedBy: 'mallory',
        initiatedBy: 'mallory',
      }),
    );
    await orchestrator.executePlan(BIZ, INTAKE, APPROVER);
    const [, , input, options] = paymentEvidence.recordPendingPayment.mock.calls[0];
    expect(input).toEqual({ amount: 10, method: 'cash', reference: 'DIO-3', idempotencyKey: `drive:${INTAKE}:0` });
    expect(options).toEqual({ actorId: APPROVER });
    expect(commerce.recordPayment).not.toHaveBeenCalled();
  });

  for (const placeholder of ['system', 'user']) {
    it(`DIO-04: a plan run with no human approver ("${placeholder}") records the payment with no actor; the placeholder is never the recorder`, async () => {
      const { orchestrator, commerce, paymentEvidence } = makeOrchestrator(
        paymentPlan({ invoiceId: 'inv_dio', amount: 5, method: 'cash', reference: 'DIO-4' }),
      );
      const result = await orchestrator.executePlan(BIZ, INTAKE, placeholder);
      expect(result.success).toBe(true);
      expect(paymentEvidence.recordPendingPayment).toHaveBeenCalledTimes(1);
      expect(commerce.recordPayment).not.toHaveBeenCalled();
      const options = paymentEvidence.recordPendingPayment.mock.calls[0][3] as { actorId?: string | null } | undefined;
      expect(options?.actorId ?? null).toBeNull();
      expect(JSON.stringify(paymentEvidence.recordPendingPayment.mock.calls[0])).not.toContain(`"${placeholder}"`);
    });
  }

  it('DIO-05 (SEC-CMF2-2): each record_payment step is keyed on the intake file and its own position; re-running the plan reuses the same keys, two steps never share one', async () => {
    const plan: DriveIntakePlan = {
      intakeFileId: INTAKE,
      documentType: 'receipt',
      summary: 'dio two payments',
      actions: [
        { type: 'record_payment', payload: { invoiceId: 'inv_dio', amount: 10, method: 'cash', reference: 'SAME' } },
        { type: 'record_payment', payload: { invoiceId: 'inv_dio', amount: 10, method: 'cash', reference: 'SAME' } },
      ],
    };
    const { orchestrator, commerce, paymentEvidence } = makeOrchestrator(plan);
    await orchestrator.executePlan(BIZ, INTAKE, APPROVER);
    await orchestrator.executePlan(BIZ, INTAKE, 'user_dio_second_approver');
    const keys = paymentEvidence.recordPendingPayment.mock.calls.map((c: unknown[]) => (c[2] as { idempotencyKey?: string }).idempotencyKey);
    expect(keys).toEqual([`drive:${INTAKE}:0`, `drive:${INTAKE}:1`, `drive:${INTAKE}:0`, `drive:${INTAKE}:1`]);
    // The key is the plan step's identity, never the approver's.
    expect(keys.join(' ')).not.toContain(APPROVER);
    expect(commerce.recordPayment).not.toHaveBeenCalled();
  });
});
