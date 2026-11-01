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
 *     never reaches recordPayment: input is { amount, method, reference }
 *   no human approver: the ingestion auto-execute ('system') and the data-inbox
 *     fallback when the request carries no user ('user') -> actorId null; the
 *     placeholder is recorded nowhere (payments-actor PA-08: no actor is invented)
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
  );
  return { orchestrator, prisma, commerce };
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
    const { orchestrator, commerce } = makeOrchestrator(
      paymentPlan({ invoiceId: 'inv_dio', amount: 40, method: 'bank_transfer', reference: 'DIO-1' }),
    );
    const result = await orchestrator.executePlan(BIZ, INTAKE, APPROVER);
    expect(result.success).toBe(true);
    expect(commerce.recordPayment).toHaveBeenCalledTimes(1);
    expect(commerce.recordPayment).toHaveBeenCalledWith(
      'inv_dio',
      BIZ,
      { amount: 40, method: 'bank_transfer', reference: 'DIO-1' },
      { actorId: APPROVER },
    );
  });

  it('DIO-02: a payment on the invoice the same plan created is recorded with the approving user as the actor', async () => {
    const { orchestrator, commerce } = makeOrchestrator(
      paymentPlan({ amount: 25, method: 'cash' }, [
        { type: 'create_invoice', payload: { items: [{ description: 'x', quantity: 1, unitPrice: 25 }], currency: 'TTD' } },
      ]),
    );
    const result = await orchestrator.executePlan(BIZ, INTAKE, APPROVER);
    expect(result.success).toBe(true);
    expect(commerce.recordPayment).toHaveBeenCalledWith(
      'inv_created_by_plan',
      BIZ,
      { amount: 25, method: 'cash', reference: undefined },
      { actorId: APPROVER },
    );
  });

  it('DIO-03: a recorder named in the plan payload never reaches recordPayment; the approver is the actor', async () => {
    const { orchestrator, commerce } = makeOrchestrator(
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
    const [, , input, options] = commerce.recordPayment.mock.calls[0];
    expect(input).toEqual({ amount: 10, method: 'cash', reference: 'DIO-3' });
    expect(options).toEqual({ actorId: APPROVER });
  });

  for (const placeholder of ['system', 'user']) {
    it(`DIO-04: a plan run with no human approver ("${placeholder}") records the payment with no actor; the placeholder is never the recorder`, async () => {
      const { orchestrator, commerce } = makeOrchestrator(
        paymentPlan({ invoiceId: 'inv_dio', amount: 5, method: 'cash', reference: 'DIO-4' }),
      );
      const result = await orchestrator.executePlan(BIZ, INTAKE, placeholder);
      expect(result.success).toBe(true);
      expect(commerce.recordPayment).toHaveBeenCalledTimes(1);
      const options = commerce.recordPayment.mock.calls[0][3] as { actorId?: string | null } | undefined;
      expect(options?.actorId ?? null).toBeNull();
      expect(JSON.stringify(commerce.recordPayment.mock.calls[0])).not.toContain(`"${placeholder}"`);
    });
  }
});
