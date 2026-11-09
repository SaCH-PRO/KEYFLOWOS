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
        // V1-44b (SEC-V44-3): the approval's compare-and-set claim (reviewing -> approved) wins.
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      aiApprovalItem: { findFirst: vi.fn().mockResolvedValue(null) },
      // V1-44b (SEC-V44-3): no credit note carries the plan step's number yet.
      creditNote: { findFirst: vi.fn().mockResolvedValue(null) },
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
  // V1-44b: the apply_credit_note step's collaborator (CreditNoteService).
  const creditNotes = {
    create: vi.fn().mockImplementation(async (_biz: string, input: { creditNoteNumber: string; invoiceId: string }) => ({
      id: 'cn_dio',
      status: 'DRAFT',
      invoiceId: input.invoiceId,
      creditNoteNumber: input.creditNoteNumber,
    })),
    apply: vi.fn().mockResolvedValue({ creditNote: { id: 'cn_dio', status: 'APPLIED' }, transactionId: 'txn_dio' }),
  };
  const orchestrator = new DriveIntakeOrchestrator(
    prisma as any,
    crm as any,
    {} as any,
    {} as any,
    governance as any,
    commerce as any,
    invoiceWorkflow as any,
    creditNotes as any,
    {} as any,
    paymentEvidence as any,
  );
  return { orchestrator, prisma, commerce, paymentEvidence, creditNotes };
}

function creditPlan(steps: Array<Record<string, unknown>>, extra: DriveIntakePlan['actions'] = []): DriveIntakePlan {
  return {
    intakeFileId: INTAKE,
    documentType: 'credit_note',
    summary: 'dio credit note',
    actions: [...extra, ...steps.map((payload) => ({ type: 'apply_credit_note' as const, payload }))],
  };
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

/**
 * V1-44b-CREDIT-NOTE-ROUTES-AND-INTAKE (V1-44 review SEC-V44-3, SEC-V44-4).
 *
 * V1-44 made the apply_credit_note step reach the ledger. executePlan checked
 * 'reviewing' with a read and set 'approved' only after every write, and the
 * step created a note numbered CN-<Date.now()> and applied it with no key, so
 * two concurrent approvals of one plan credited the invoice twice (the review
 * repro: 2 APPLIED notes of 50 on a 100 invoice, FULLY_CREDITED). It also
 * applied as the raw userId ('system' from the ingestion auto-execute, 'user'
 * from the data-inbox fallback), where its own payment step passes
 * approverActorId.
 *
 *   DIO-06 the approval is a compare-and-set claim reviewing -> approved, taken before any step
 *   DIO-07 a lost claim (another approval holds the plan) is refused 400; no step runs, nothing
 *          is written (not even the 'error' flip)
 *   DIO-08 the credit step's note number is the plan step's identity CN-DRIVE-<intakeFileId>-<index>:
 *          a re-run uses the same numbers, two steps never share one, the approver is not in it
 *   DIO-09 a re-run whose step note is already APPLIED creates nothing and applies nothing; the
 *          step answers that note
 *   DIO-10 a step note left DRAFT (a run that failed after creating it) is applied, not created again
 *   DIO-11 a concurrent run of the same step that wins the create and the apply: this run answers
 *          that note (no second note, no second apply)
 *   DIO-12 a step note VOIDed by a member, or numbered for another invoice, is not applied again
 *   DIO-13 SEC-V44-4 the step applies as approverActorId: the approver, or null for 'system'/'user'
 *          (CreditNoteService.apply then refuses 403 and nothing posts)
 * The real rows are proven in test/credit-note-reversal.integration.test.ts CN-19, CN-20.
 */
describe('V1-44b: the Drive-intake approval is claimed once and its credit step is keyed per plan step (SEC-V44-3, SEC-V44-4)', () => {
  beforeEach(() => vi.clearAllMocks());

  const STEP = { invoiceId: 'inv_dio', amount: 50, reason: 'DIO credit' };
  const PAYMENT_STEP: DriveIntakePlan['actions'] = [{ type: 'record_payment', payload: { invoiceId: 'inv_dio', amount: 10, method: 'cash' } }];

  it('DIO-06: executePlan claims the plan compare-and-set (reviewing -> approved) before any step runs', async () => {
    const { orchestrator, prisma, creditNotes } = makeOrchestrator(creditPlan([STEP]));
    const result = await orchestrator.executePlan(BIZ, INTAKE, APPROVER);
    expect(result.success).toBe(true);
    // RED-BEFORE (V1-44 head): no claim; 'approved' was written only after every step.
    expect(prisma.client.driveIntakeFile.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.client.driveIntakeFile.updateMany).toHaveBeenCalledWith({
      where: { id: INTAKE, businessId: BIZ, status: 'reviewing' },
      data: { status: 'approved' },
    });
    expect(prisma.client.driveIntakeFile.updateMany.mock.invocationCallOrder[0]).toBeLessThan(creditNotes.create.mock.invocationCallOrder[0]);
  });

  it('DIO-07: a lost claim is refused 400 before any step; nothing is created, applied, recorded or flipped to error', async () => {
    const { orchestrator, prisma, creditNotes, paymentEvidence } = makeOrchestrator(creditPlan([STEP], PAYMENT_STEP));
    prisma.client.driveIntakeFile.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(orchestrator.executePlan(BIZ, INTAKE, APPROVER)).rejects.toMatchObject({ status: 400 });
    expect(creditNotes.create).not.toHaveBeenCalled();
    expect(creditNotes.apply).not.toHaveBeenCalled();
    expect(paymentEvidence.recordPendingPayment).not.toHaveBeenCalled();
    expect(prisma.client.driveIntakeFile.update).not.toHaveBeenCalled();
  });

  it('DIO-08: the credit note number is the plan step identity; a re-run reuses it, two steps never share one', async () => {
    const { orchestrator, creditNotes } = makeOrchestrator(creditPlan([STEP, { ...STEP, amount: 20 }], PAYMENT_STEP));
    await orchestrator.executePlan(BIZ, INTAKE, APPROVER);
    await orchestrator.executePlan(BIZ, INTAKE, 'user_dio_second_approver');
    const numbers = creditNotes.create.mock.calls.map((c: unknown[]) => (c[1] as { creditNoteNumber: string }).creditNoteNumber);
    // RED-BEFORE (V1-44 head): CN-<Date.now()>, a new number on every run.
    expect(numbers).toEqual([`CN-DRIVE-${INTAKE}-1`, `CN-DRIVE-${INTAKE}-2`, `CN-DRIVE-${INTAKE}-1`, `CN-DRIVE-${INTAKE}-2`]);
    expect(numbers.join(' ')).not.toContain(APPROVER);
    expect(creditNotes.create.mock.calls[0]).toEqual([
      BIZ,
      { invoiceId: 'inv_dio', creditNoteNumber: `CN-DRIVE-${INTAKE}-1`, amount: 50, reason: 'DIO credit' },
    ]);
  });

  it('DIO-09: a re-run whose step note is already APPLIED creates and applies nothing; the step answers that note', async () => {
    const { orchestrator, prisma, creditNotes } = makeOrchestrator(creditPlan([STEP]));
    prisma.client.creditNote.findFirst.mockResolvedValue({ id: 'cn_prev', status: 'APPLIED', invoiceId: 'inv_dio' });
    const result = await orchestrator.executePlan(BIZ, INTAKE, APPROVER);
    expect(result.success).toBe(true);
    expect(prisma.client.creditNote.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: BIZ, creditNoteNumber: `CN-DRIVE-${INTAKE}-0` } }),
    );
    // RED-BEFORE (V1-44 head): a second note created and applied.
    expect(creditNotes.create).not.toHaveBeenCalled();
    expect(creditNotes.apply).not.toHaveBeenCalled();
    expect(result.results).toEqual([{ action: 'apply_credit_note', success: true, entityId: 'cn_prev' }]);
  });

  it('DIO-10: a step note left DRAFT by a failed run is applied, not created again', async () => {
    const { orchestrator, prisma, creditNotes } = makeOrchestrator(creditPlan([STEP]));
    prisma.client.creditNote.findFirst.mockResolvedValue({ id: 'cn_draft', status: 'DRAFT', invoiceId: 'inv_dio' });
    const result = await orchestrator.executePlan(BIZ, INTAKE, APPROVER);
    expect(result.success).toBe(true);
    expect(creditNotes.create).not.toHaveBeenCalled();
    expect(creditNotes.apply).toHaveBeenCalledTimes(1);
    expect(creditNotes.apply).toHaveBeenCalledWith(BIZ, 'cn_draft', { userId: APPROVER });
    expect(result.results).toEqual([{ action: 'apply_credit_note', success: true, entityId: 'cn_draft' }]);
  });

  it('DIO-11: a concurrent run of the same step won the create and the apply: this run answers that note (no second note, no second apply)', async () => {
    const { orchestrator, prisma, creditNotes } = makeOrchestrator(creditPlan([STEP]));
    prisma.client.creditNote.findFirst
      .mockResolvedValueOnce(null) // before the create
      .mockResolvedValueOnce({ id: 'cn_won', status: 'DRAFT', invoiceId: 'inv_dio' }) // the other run created it
      .mockResolvedValueOnce({ id: 'cn_won', status: 'APPLIED', invoiceId: 'inv_dio' }); // and applied it
    creditNotes.create.mockRejectedValueOnce(Object.assign(new Error('Credit note number already exists'), { status: 400 }));
    creditNotes.apply.mockRejectedValueOnce(Object.assign(new Error('Credit note already applied or voided'), { status: 409 }));
    const result = await orchestrator.executePlan(BIZ, INTAKE, APPROVER);
    expect(result.success).toBe(true);
    expect(creditNotes.create).toHaveBeenCalledTimes(1);
    expect(creditNotes.apply).toHaveBeenCalledTimes(1);
    expect(creditNotes.apply).toHaveBeenCalledWith(BIZ, 'cn_won', { userId: APPROVER });
    expect(result.results).toEqual([{ action: 'apply_credit_note', success: true, entityId: 'cn_won' }]);
  });

  it('DIO-11b: an apply refused for this run (no member, 403) is not reported applied: the plan fails', async () => {
    const { orchestrator, prisma, creditNotes } = makeOrchestrator(creditPlan([STEP]));
    creditNotes.apply.mockRejectedValueOnce(Object.assign(new Error('A member with revenue write access must apply this credit note'), { status: 403 }));
    prisma.client.creditNote.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'cn_dio', status: 'DRAFT', invoiceId: 'inv_dio' });
    const result = await orchestrator.executePlan(BIZ, INTAKE, APPROVER);
    expect(result.success).toBe(false);
    expect(result.results).toEqual([]);
    expect(prisma.client.driveIntakeFile.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'error' }) }));
  });

  for (const [label, row] of [
    ['VOIDed by a member', { id: 'cn_void', status: 'VOID', invoiceId: 'inv_dio' }],
    ['numbered for another invoice', { id: 'cn_other', status: 'DRAFT', invoiceId: 'inv_other' }],
  ] as const) {
    it(`DIO-12: a step note ${label} is not applied again; the plan fails`, async () => {
      const { orchestrator, prisma, creditNotes } = makeOrchestrator(creditPlan([STEP]));
      prisma.client.creditNote.findFirst.mockResolvedValue(row);
      const result = await orchestrator.executePlan(BIZ, INTAKE, APPROVER);
      expect(result.success).toBe(false);
      expect(creditNotes.create).not.toHaveBeenCalled();
      expect(creditNotes.apply).not.toHaveBeenCalled();
      expect(prisma.client.driveIntakeFile.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'error' }) }));
    });
  }

  it('DIO-13 (SEC-V44-4): the credit step applies as the approving member', async () => {
    const { orchestrator, creditNotes } = makeOrchestrator(creditPlan([STEP]));
    await orchestrator.executePlan(BIZ, INTAKE, APPROVER);
    expect(creditNotes.apply).toHaveBeenCalledWith(BIZ, 'cn_dio', { userId: APPROVER });
  });

  for (const placeholder of ['system', 'user']) {
    it(`DIO-13 (SEC-V44-4): a plan run with no human approver ("${placeholder}") applies with no actor; the placeholder is never the actor`, async () => {
      const { orchestrator, creditNotes } = makeOrchestrator(creditPlan([STEP]));
      await orchestrator.executePlan(BIZ, INTAKE, placeholder);
      expect(creditNotes.apply).toHaveBeenCalledTimes(1);
      // RED-BEFORE (V1-44 head): { userId: 'system' } / { userId: 'user' }.
      expect(creditNotes.apply.mock.calls[0][2]).toEqual({ userId: null });
      expect(JSON.stringify([...creditNotes.apply.mock.calls, ...creditNotes.create.mock.calls])).not.toContain(`"${placeholder}"`);
    });
  }
});
