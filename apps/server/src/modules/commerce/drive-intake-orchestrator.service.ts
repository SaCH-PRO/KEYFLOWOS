import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
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
  ) {}

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
   */
  async executePlan(businessId: string, intakeFileId: string, userId: string): Promise<{ success: boolean; results: ActionResult[] }> {
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

    const plan = intake.proposedActions as unknown as DriveIntakePlan | null;
    if (!plan) throw new BadRequestException('No action plan found for this intake file');

    const results: ActionResult[] = [];
    let createdInvoiceId: string | undefined;

    try {
      for (const action of plan.actions) {
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
            const res = await this.commerce.recordPayment(invoiceId, businessId, {
              amount: payload.amount,
              method: payload.method,
              reference: payload.reference,
            });
            results.push({ action: 'record_payment', success: true, entityId: res.payment.id });
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
            const cn = await this.creditNotes.create(businessId, {
              invoiceId,
              creditNoteNumber: `CN-${Date.now()}`,
              amount: payload.amount,
              reason: payload.reason,
            });
            await this.creditNotes.apply(businessId, cn.id, { userId });
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Drive intake execution failed for ${intakeFileId}: ${message}`);
      await this.prisma.client.driveIntakeFile.update({
        where: { id: intakeFileId },
        data: { status: 'error', errorMessage: message },
      });
      return { success: false, results };
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
