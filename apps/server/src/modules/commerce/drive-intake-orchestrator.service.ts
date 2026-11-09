import { Injectable, Inject, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmService } from '../crm/crm.service';
import { CrmCommunicationService } from '../crm/crm-communication.service';
import { TransactionalEmailService } from '../notifications/transactional-email.service';
import { AiOversightService } from '../ai/ai-oversight.service';
import { CommerceService } from './commerce.service';
import { InvoiceWorkflowService } from './invoice-workflow.service';
import { CreditNoteService } from '../finance/credit-note.service';
import { TaskAssignmentService } from '../task-assignments/task-assignment.service';
import type { DocumentExtractionResult } from '../ai/document-intelligence.service';
import { PaymentEvidenceService } from './payment-evidence.service';

export type DriveIntakeActionType =
  | 'create_invoice'
  | 'record_payment'
  | 'apply_credit_note'
  | 'send_notification'
  | 'create_follow_up_task';

export interface DriveIntakeAction {
  type: DriveIntakeActionType;
  payload: Record<string, unknown>;
}

export interface DriveIntakePlan {
  intakeFileId: string;
  documentType: string;
  contactId?: string;
  contactName?: string;
  contactEmail?: string;
  originalInvoiceId?: string;
  actions: DriveIntakeAction[];
  summary: string;
}

interface ActionResult {
  action: DriveIntakeActionType;
  success: boolean;
  entityId?: string;
  error?: string;
}

@Injectable()
export class DriveIntakeOrchestrator {
  private readonly logger = new Logger(DriveIntakeOrchestrator.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(CrmCommunicationService) private readonly crmCommunication: CrmCommunicationService,
    @Inject(TransactionalEmailService) private readonly transactionalEmail: TransactionalEmailService,
    @Inject(AiOversightService) private readonly governance: AiOversightService,
    @Inject(CommerceService) private readonly commerce: CommerceService,
    @Inject(InvoiceWorkflowService) private readonly invoiceWorkflow: InvoiceWorkflowService,
    @Inject(CreditNoteService) private readonly creditNotes: CreditNoteService,
    @Inject(TaskAssignmentService) private readonly taskAssignment: TaskAssignmentService,
    @Inject(PaymentEvidenceService) private readonly paymentEvidence: PaymentEvidenceService,
  ) {}

  /**
   * R0-CMF2-PAYMENT-ACTOR-GAPS: the placeholders callers pass when no person
   * approved the plan: the ingestion auto-execute ('system') and the data-inbox
   * fallback when the request carries no user ('user'). Neither is a User id,
   * so neither is recorded as a payment's recorder: none is invented (the
   * payments-actor PA-08 rule).
   */
  private static readonly NO_HUMAN_APPROVER_IDS: ReadonlySet<string> = new Set(['system', 'user']);

  private static approverActorId(userId: string | null | undefined): string | null {
    return userId && !DriveIntakeOrchestrator.NO_HUMAN_APPROVER_IDS.has(userId) ? userId : null;
  }

  /**
   * Build an action plan from an extracted Drive file. This resolves/creates the
   * contact and prepares the financial actions, but it does NOT post anything.
   */
  async buildPlan(businessId: string, intakeFileId: string): Promise<DriveIntakePlan> {
    const intake = await this.prisma.client.driveIntakeFile.findFirst({
      where: { id: intakeFileId, businessId },
    });
    if (!intake) throw new NotFoundException('Drive intake file not found');

    const extraction = intake.extractedData as DocumentExtractionResult | null;
    if (!extraction) throw new BadRequestException('No extraction data available');

    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { currency: true },
    });
    const currency = business?.currency ?? 'TTD';

    const contactInput = this.extractContactInput(extraction);
    const contact = await this.crm.findOrCreateContact(businessId, {
      ...contactInput,
      source: 'google_drive_intake',
      sourceDetail: intake.name,
      status: 'LEAD',
    });

    const plan: DriveIntakePlan = {
      intakeFileId,
      documentType: extraction.documentType,
      contactId: contact.id,
      contactName: contactInput.firstName
        ? `${contactInput.firstName} ${contactInput.lastName ?? ''}`.trim()
        : undefined,
      contactEmail: contactInput.email ?? undefined,
      actions: [],
      summary: '',
    };

    if (extraction.documentType === 'invoice' || extraction.documentType === 'receipt') {
      const data = extraction.invoiceData;
      if (!data) throw new BadRequestException('Invoice data missing from extraction');

      plan.actions.push({
        type: 'create_invoice',
        payload: {
          items: data.lineItems.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
          currency: data.currency ?? currency,
          taxRate: data.taxRate ?? 0,
          notes: `Extracted from Drive: ${intake.name}\n${data.notes ?? ''}`.trim(),
        },
      });

      plan.summary = `Create invoice for ${plan.contactName ?? 'customer'} (${data.currency ?? currency} ${data.total}) from ${intake.name}`;
    } else if (extraction.documentType === 'credit_note') {
      const data = extraction.creditNoteData;
      if (!data) throw new BadRequestException('Credit note data missing from extraction');

      const originalInvoice = data.originalInvoiceNumber
        ? await this.prisma.client.invoice.findFirst({
            where: {
              businessId,
              invoiceNumber: data.originalInvoiceNumber,
              deletedAt: null,
            },
            select: { id: true, status: true, total: true, invoiceNumber: true },
          })
        : null;

      if (originalInvoice) {
        plan.originalInvoiceId = originalInvoice.id;
        if (data.amountPaid && data.amountPaid > 0) {
          plan.actions.push({
            type: 'record_payment',
            payload: {
              invoiceId: originalInvoice.id,
              amount: data.amountPaid,
              method: 'other',
              reference: `Drive credit note: ${intake.name}`,
            },
          });
        }
        if (data.amountCredited && data.amountCredited > 0) {
          plan.actions.push({
            type: 'apply_credit_note',
            payload: {
              invoiceId: originalInvoice.id,
              amount: data.amountCredited,
              reason: data.reason ?? `Extracted from Drive: ${intake.name}`,
            },
          });
        }
        plan.summary = `Apply credit note (${data.currency ?? currency} ${data.amountCredited}) and record payment (${data.amountPaid}) against invoice ${originalInvoice.invoiceNumber}`;
      } else if (data.totalOriginalAmount && data.totalOriginalAmount > 0) {
        // Fallback: no matching invoice found, create the original invoice first.
        plan.actions.push({
          type: 'create_invoice',
          payload: {
            items: data.lineItems?.length
              ? data.lineItems.map((item) => ({
                  description: item.description,
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                }))
              : [{ description: data.reason ?? 'Original invoice per credit note', quantity: 1, unitPrice: data.totalOriginalAmount }],
            currency: data.currency ?? currency,
            notes: `Original invoice inferred from credit note in Drive: ${intake.name}`,
          },
        });
        if (data.amountPaid && data.amountPaid > 0) {
          plan.actions.push({
            type: 'record_payment',
            payload: {
              amount: data.amountPaid,
              method: 'other',
              reference: `Drive credit note: ${intake.name}`,
            },
          });
        }
        if (data.amountCredited && data.amountCredited > 0) {
          plan.actions.push({
            type: 'apply_credit_note',
            payload: {
              amount: data.amountCredited,
              reason: data.reason ?? `Extracted from Drive: ${intake.name}`,
            },
          });
        }
        plan.summary = `Create original invoice, apply credit note (${data.currency ?? currency} ${data.amountCredited}) and record payment (${data.amountPaid}) from ${intake.name}`;
      } else {
        throw new BadRequestException('Credit note references an invoice that could not be found and no original amount was provided');
      }
    } else {
      throw new BadRequestException(`Unsupported document type for action planning: ${extraction.documentType}`);
    }

    // Always notify the contact after the financial actions are approved.
    if (plan.contactEmail) {
      plan.actions.push({
        type: 'send_notification',
        payload: {
          channel: 'email',
          subject: this.notificationSubject(plan),
          body: this.notificationBody(plan, intake.name),
        },
      });
    }

    return plan;
  }

  /**
   * Persist the plan as an AI approval item and move the intake file to
   * `reviewing` so the user can approve/reject it.
   */
  async createApprovalItem(businessId: string, plan: DriveIntakePlan) {
    const affectedEntities: Record<string, unknown>[] = [];
    if (plan.contactId) {
      affectedEntities.push({ type: 'contact', id: plan.contactId });
    }
    if (plan.originalInvoiceId) {
      affectedEntities.push({ type: 'invoice', id: plan.originalInvoiceId });
    }

    const item = await this.governance.createApprovalItem(businessId, {
      toolName: 'drive_intake_financial_action',
      module: 'commerce',
      title: `Drive intake: ${plan.summary}`,
      description: `KEY detected a ${plan.documentType} in Google Drive and prepared the following actions:\n${plan.actions
        .map((a) => `- ${a.type}: ${JSON.stringify(a.payload)}`)
        .join('\n')}`,
      rationale: 'Document intelligence extraction from connected Google Drive',
      inputPayload: { intakeFileId: plan.intakeFileId, plan },
      affectedEntities,
    });

    await this.prisma.client.driveIntakeFile.update({
      where: { id: plan.intakeFileId },
      data: {
        status: 'reviewing',
        proposedActions: plan as unknown as Record<string, unknown>,
      },
    });

    return item;
  }

  /**
   * Execute an approved plan. This is the only path that writes financial records.
   *
   * V1-41-DM-UNTRUSTED-MONEY-INPUTS (M32, D-27): a record_payment step writes
   * the payment PENDING (PaymentEvidenceService.recordPendingPayment): the
   * amount is read from a document, so approving the plan moves no balance and
   * posts nothing. A member with revenue:write confirms it through the
   * operator door (PaymentEvidenceService.confirmPendingPayment).
   */
  async executePlan(
    businessId: string,
    intakeFileId: string,
    userId: string,
    planOverride?: DriveIntakePlan,
  ): Promise<{ success: boolean; results: ActionResult[] }> {
    const intake = await this.prisma.client.driveIntakeFile.findFirst({
      where: { id: intakeFileId, businessId },
    });
    if (!intake) throw new NotFoundException('Drive intake file not found');
    if (intake.status === 'approved') {
      throw new BadRequestException('This intake plan has already been executed');
    }
    if (intake.status !== 'reviewing') {
      throw new BadRequestException(`Intake file is ${intake.status}, cannot execute`);
    }

    const plan = planOverride ?? (intake.proposedActions as unknown as DriveIntakePlan | null);
    if (!plan) throw new BadRequestException('No action plan found for this intake file');

    // V1-44b (V1-44 review SEC-V44-3): the approval is a compare-and-set
    // claim. The status checks above are reads and 'approved' was written only
    // after every step, so two concurrent approvals (two members, a double
    // click, the ingestion auto-execute beside a member) both ran the plan:
    // once V1-44 made apply_credit_note reach the ledger, the invoice was
    // credited twice. Exactly one caller moves the intake reviewing ->
    // approved; the other is refused here, before any step, and writes
    // nothing. A failed run still ends 'error' (below); a successful one
    // stamps processedAt.
    const claimed = await this.prisma.client.driveIntakeFile.updateMany({
      where: { id: intakeFileId, businessId, status: 'reviewing' },
      data: { status: 'approved' },
    });
    if (claimed.count !== 1) {
      throw new BadRequestException('This intake plan is already being executed or has been executed');
    }

    const results: ActionResult[] = [];
    let createdInvoiceId: string | undefined;

    try {
      for (const [actionIndex, action] of plan.actions.entries()) {
        switch (action.type) {
          case 'create_invoice': {
            const payload = action.payload as {
              items: { description: string; quantity: number; unitPrice: number }[];
              currency: string;
              taxRate?: number;
              notes?: string;
            };
            const invoice = await this.commerce.createInvoice({
              businessId,
              contactId: plan.contactId,
              items: payload.items,
              currency: payload.currency,
              taxRate: payload.taxRate ?? 0,
              notes: payload.notes,
            });
            createdInvoiceId = invoice.id;
            // Finalize immediately so the ledger posts (Dr AR / Cr Revenue).
            await this.invoiceWorkflow.transition(invoice.id, 'SENT');
            results.push({ action: 'create_invoice', success: true, entityId: invoice.id });
            break;
          }
          case 'record_payment': {
            const payload = action.payload as {
              invoiceId?: string;
              amount: number;
              method: string;
              reference?: string;
            };
            const invoiceId = payload.invoiceId ?? createdInvoiceId;
            if (!invoiceId) throw new BadRequestException('No invoice available for payment');
            // R0-CMF2-PAYMENT-ACTOR-GAPS (ST-R011-3): the approver records the
            // payment (Payment.recordedBy, the posting's createdById, the
            // contact event). The recorder comes from the caller, never from
            // the extracted plan payload.
            //
            // R0-CMF2 review (SEC-CMF2-2): the status check above is a read,
            // and the intake flips to 'approved' only after every write, so
            // two concurrent approvals (or a re-run after a crash before that
            // flip) both reach this step. The key, derived from this intake
            // file and this step, makes the second answer with the first's
            // payment instead of proposing it twice.
            //
            // V1-41 (D-27): the payment is recorded PENDING, never posted
            // here; it moves no balance until a member confirms it. The key
            // keeps answering the same row after that confirmation, so a
            // re-run never proposes the payment again.
            const pending = await this.paymentEvidence.recordPendingPayment(invoiceId, businessId, {
              amount: payload.amount,
              method: payload.method,
              reference: payload.reference,
              idempotencyKey: `drive:${intakeFileId}:${actionIndex}`,
            }, { actorId: DriveIntakeOrchestrator.approverActorId(userId) });
            results.push({ action: 'record_payment', success: true, entityId: pending.id });
            break;
          }
          case 'apply_credit_note': {
            const payload = action.payload as {
              invoiceId?: string;
              amount: number;
              reason?: string;
            };
            const invoiceId = payload.invoiceId ?? createdInvoiceId;
            if (!invoiceId) throw new BadRequestException('No invoice available for credit note');
            // V1-44b (SEC-V44-3): the step is keyed on this intake file and
            // this step's position, as record_payment is (SEC-CMF2-2): the
            // note's number is that key (unique per business), so a second
            // execution of the same step (a concurrent run that got past the
            // claim's reads, or a re-run of the plan) finds the step's own note
            // instead of crediting the invoice again: one note, one apply, one
            // REVERSAL. CN-<Date.now()> was a new note on every run.
            const creditNoteNumber = DriveIntakeOrchestrator.creditNoteNumberFor(intakeFileId, actionIndex);
            const cn = await this.keyedCreditNote(businessId, creditNoteNumber, {
              invoiceId,
              amount: payload.amount,
              reason: payload.reason,
            });
            if (cn.status === 'DRAFT') {
              // V1-44b (SEC-V44-4): applied as the approving member, never as a
              // placeholder ('system', 'user'), as the payment step records
              // its payment; with no member CreditNoteService.apply refuses 403
              // and the note stays DRAFT for a member to apply.
              try {
                await this.creditNotes.apply(businessId, cn.id, { userId: DriveIntakeOrchestrator.approverActorId(userId) });
              } catch (applyErr) {
                // A concurrent run of this same step applied it first: that is this step done.
                const now = await this.findKeyedCreditNote(businessId, creditNoteNumber);
                if (now?.status !== 'APPLIED') throw applyErr;
              }
            } else if (cn.status !== 'APPLIED') {
              throw new ConflictException(`Credit note ${creditNoteNumber} is ${cn.status}; this plan step does not apply it again`);
            }
            results.push({ action: 'apply_credit_note', success: true, entityId: cn.id });
            break;
          }
          case 'send_notification': {
            const payload = action.payload as {
              channel: 'email' | 'whatsapp' | 'sms';
              subject: string;
              body: string;
            };
            if (plan.contactId) {
              const sent = await this.crmCommunication.reply({
                businessId,
                contactId: plan.contactId,
                channel: payload.channel,
                body: payload.body,
                actorId: userId,
              });
              results.push({ action: 'send_notification', success: sent.ok, entityId: plan.contactId });
            } else {
              results.push({ action: 'send_notification', success: false, error: 'No contact to notify' });
            }
            break;
          }
        }
      }

      // Contact follow-up task: ensure a human/KEY reviews the financial action.
      if (plan.contactId) {
        try {
          const followUpTask = await this.crm.addTask({
            businessId,
            contactId: plan.contactId,
            title: `Follow up: ${plan.documentType} from Drive — ${plan.summary}`,
            priority: 'HIGH',
            source: 'drive_intake',
            creatorId: userId,
          });
          await this.taskAssignment.assign({
            taskType: 'ContactTask',
            taskId: followUpTask.id,
            assignableType: 'KEY',
            assignableId: 'key_ai',
            assignedBy: userId,
            reason: 'Auto-assigned by Drive intake orchestrator for follow-up',
          });
          results.push({ action: 'create_follow_up_task', success: true, entityId: followUpTask.id });
        } catch (taskErr) {
          const message = taskErr instanceof Error ? taskErr.message : String(taskErr);
          this.logger.warn(`Failed to create follow-up task for intake ${intakeFileId}: ${message}`);
          results.push({ action: 'create_follow_up_task', success: false, error: message });
        }
      }

      await this.prisma.client.driveIntakeFile.update({
        where: { id: intakeFileId },
        data: { status: 'approved', processedAt: new Date() },
      });

      await this.resolvePendingApproval(businessId, intakeFileId, 'approved', userId);

      return { success: true, results };
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Drive intake execution failed for ${intakeFileId}: ${message}`);
      await this.prisma.client.driveIntakeFile.update({
        where: { id: intakeFileId },
        data: { status: 'error', errorMessage: message },
      });
      return { success: false, results };
    }
  }

  /** V1-44b (SEC-V44-3): the credit note number of one apply_credit_note step: the step's identity, never the approver's. */
  private static creditNoteNumberFor(intakeFileId: string, actionIndex: number): string {
    return `CN-DRIVE-${intakeFileId}-${actionIndex}`;
  }

  private findKeyedCreditNote(businessId: string, creditNoteNumber: string) {
    return this.prisma.client.creditNote.findFirst({
      where: { businessId, creditNoteNumber },
      select: { id: true, status: true, invoiceId: true },
    });
  }

  /**
   * V1-44b (SEC-V44-3): the step's note, created on its first execution. A
   * note already carrying the step's number is that step's (a re-run, or a
   * concurrent run that created it first; the number is unique per business,
   * so of two creates one is refused and reads the other's). A note with the
   * number for another invoice is not this step's and is refused 409.
   */
  private async keyedCreditNote(
    businessId: string,
    creditNoteNumber: string,
    input: { invoiceId: string; amount: number; reason?: string },
  ): Promise<{ id: string; status: string; invoiceId: string }> {
    const sameStep = (note: { id: string; status: string; invoiceId: string }) => {
      if (note.invoiceId !== input.invoiceId) {
        throw new ConflictException(`Credit note ${creditNoteNumber} belongs to another invoice`);
      }
      return note;
    };
    const existing = await this.findKeyedCreditNote(businessId, creditNoteNumber);
    if (existing) return sameStep(existing);
    try {
      const created = await this.creditNotes.create(businessId, {
        invoiceId: input.invoiceId,
        creditNoteNumber,
        amount: input.amount,
        reason: input.reason,
      });
      return { id: created.id, status: created.status, invoiceId: created.invoiceId };
    } catch (createErr) {
      const raced = await this.findKeyedCreditNote(businessId, creditNoteNumber);
      if (!raced) throw createErr;
      return sameStep(raced);
    }
  }

  async rejectIntakeFile(businessId: string, intakeFileId: string, userId?: string): Promise<void> {
    const intake = await this.prisma.client.driveIntakeFile.findFirst({
      where: { id: intakeFileId, businessId },
    });
    if (!intake) throw new NotFoundException('Drive intake file not found');
    await this.prisma.client.driveIntakeFile.update({
      where: { id: intakeFileId },
      data: { status: 'rejected', processedAt: new Date() },
    });
    if (userId) {
      await this.resolvePendingApproval(businessId, intakeFileId, 'rejected', userId).catch((err) => {
        this.logger.warn(`Failed to resolve approval on reject: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  private async resolvePendingApproval(
    businessId: string,
    intakeFileId: string,
    resolution: 'approved' | 'rejected',
    userId: string,
  ) {
    const item = await this.prisma.client.aiApprovalItem.findFirst({
      where: {
        businessId,
        status: 'pending',
        inputPayload: { path: ['intakeFileId'], equals: intakeFileId },
      },
    });
    if (item) {
      await this.governance.resolveApproval(item.id, businessId, resolution, userId);
    }
  }

  private extractContactInput(extraction: DocumentExtractionResult) {
    const data: any =
      extraction.invoiceData ??
      extraction.creditNoteData ??
      extraction.contactData;
    return {
      firstName: data?.contactName?.split(' ')[0] ?? null,
      lastName: data?.contactName?.split(' ').slice(1).join(' ') ?? null,
      email: data?.contactEmail ?? null,
      phone: data?.contactPhone ?? null,
    };
  }

  private notificationSubject(plan: DriveIntakePlan): string {
    if (plan.documentType === 'credit_note') return 'Credit note applied';
    return 'Invoice issued';
  }

  private notificationBody(plan: DriveIntakePlan, fileName: string): string {
    const lines: string[] = [
      `Hi ${plan.contactName ?? 'there'},`,
      '',
      `We processed a ${plan.documentType} from your Google Drive file "${fileName}".`,
      '',
      'Actions taken:',
      ...plan.actions.map((a) => `- ${a.type}`),
      '',
      'If you have any questions, please reply to this message.',
    ];
    return lines.join('\n');
  }
}
