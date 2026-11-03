import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import type { Payment } from '@keyflow/db';
import { DocumentIntelligenceService, DocumentExtractionResult } from '../ai/document-intelligence.service';
import { GoogleDriveService } from '../google-drive/google-drive.service';
import { ObjectStorageService } from '../../core/object-storage/objectStorage';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CommerceService } from './commerce.service';
import { roundMoney } from './invoice-workflow.service';
import { moneyEquals, toCents } from './money';
import { KEY_SYSTEM_ACTOR_ID, isSystemActor } from '../../core/auth/system-actor';
import { LEVEL_RANK, defaultScopesForRole, rankOf } from '../../core/authority/module-vocabulary';

interface ProcessEvidenceInput {
  businessId: string;
  invoiceId: string;
  evidenceUrl: string;
  evidenceMimeType: string;
  filename: string;
  source: 'drive' | 'upload';
  driveFileId?: string;
}

interface ProcessEvidenceResult {
  payment: {
    id: string;
    amount: number;
    currency: string;
    status: string;
    provider: string;
    method: string;
    reference: string | null;
    notes: string | null;
    evidenceUrl: string | null;
    evidenceMimeType: string | null;
  };
  invoiceStatus: string;
  extracted: {
    amount: number;
    method: string;
    reference?: string;
    notes?: string;
    confidence: number;
  };
  /** V1-41 (D-27): the payment is PENDING until a member confirms it (confirmPendingPayment). */
  requiresConfirmation: true;
}

/**
 * V1-41-DM-UNTRUSTED-MONEY-INPUTS (M32, D-27): the providerPaymentId prefix of
 * a Payment written PENDING from an untrusted input (an AI-extracted amount
 * from payment evidence, a Drive intake record_payment step). It marks the
 * rows confirmPendingPayment may confirm; no other writer uses it (manual
 * payments are `manual_...`, customer intents `manual_<id>_intent_...`).
 */
export const EXTRACTED_PAYMENT_ID_PREFIX = 'extracted_';

/**
 * V1-41 review (SEC-V41-1, SEC-V41-2, CR-V41-1): Payment.provider of an
 * extracted pending row. The method extracted or planned stays in
 * Payment.method; the provider is never a method, because the anonymous
 * customer intent (CommerceService.recordPublicPaymentIntent) keeps one
 * PENDING row per invoice and method, found by `{ status: 'PENDING', method,
 * provider: method }`, and rewrites its amount. With provider = method an
 * intent through a pay link found the extracted row (every credit-note plan
 * uses method 'other', an intent method) and replaced the extracted amount
 * with the customer's, which a member then confirmed as money. No intent
 * method, and no other Payment writer, uses this provider.
 */
export const EXTRACTED_PAYMENT_PROVIDER = 'extracted';

/**
 * V1-41 review (AUD-V41-3, CR-V41-2): the `activities` action written with
 * each new extracted pending row (see recordPendingPayment).
 */
export const PENDING_PAYMENT_AUDIT_ACTION = 'payment_pending_recorded';

/**
 * V1-41: the status an extracted pending row takes once a member confirmed it.
 * It is not money: computeBalance, CASH_NET_PAYMENT_WHERE and the posting door
 * read SUCCESSFUL and REFUNDED rows only. The money is the SUCCESSFUL row the
 * member recorded through CommerceService.recordPayment; this row keeps what
 * was extracted and who recorded it, and keeps its idempotency slot, so a
 * Drive plan re-run after the confirmation replays it instead of proposing the
 * payment again.
 */
export const CONFIRMED_EXTRACTED_PAYMENT_STATUS = 'CONFIRMED';

/** The input of an untrusted payment, the fields CommerceService.recordPayment takes. */
export interface ExtractedPaymentInput {
  amount: number;
  method: string;
  reference?: string;
  notes?: string;
  evidenceUrl?: string;
  evidenceMimeType?: string;
  /** Caller identity for a replay-safe step (Drive: `drive:<intakeFileId>:<actionIndex>`). */
  idempotencyKey?: string;
}

const METHOD_MAP: Record<string, string> = {
  cash: 'CASH',
  bank_transfer: 'BANK_TRANSFER',
  card: 'CARD',
  credit_card: 'CARD',
  debit_card: 'CARD',
  check: 'CHECK',
  cheque: 'CHECK',
  paypal: 'PAYPAL',
  wipay: 'WIPAY',
  other: 'OTHER',
};

function normalizeMethod(raw?: string): string {
  if (!raw) return 'OTHER';
  const key = raw.toLowerCase().replace(/\s+/g, '_').replace(/\//g, '_');
  return METHOD_MAP[key] || METHOD_MAP[raw.toLowerCase()] || 'OTHER';
}

@Injectable()
export class PaymentEvidenceService {
  private readonly logger = new Logger(PaymentEvidenceService.name);

  private readonly storage = new ObjectStorageService();

  constructor(
    @Inject(DocumentIntelligenceService) private readonly docIntel: DocumentIntelligenceService,
    @Inject(GoogleDriveService) private readonly drive: GoogleDriveService,
    @Inject(CommerceService) private readonly commerce: CommerceService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /**
   * Extract payment details from evidence without recording against an invoice.
   * Used for the standalone "Record Payment" flow where the user uploads evidence
   * first, then selects which invoice to apply it to.
   */
  async extractEvidence(input: Omit<ProcessEvidenceInput, 'invoiceId'>): Promise<{
    extracted: {
      amount: number;
      method: string;
      reference?: string;
      notes?: string;
      confidence: number;
      date?: string;
      payer?: string;
    } | null;
    raw: DocumentExtractionResult;
  }> {
    const { businessId, evidenceUrl, evidenceMimeType, filename, source, driveFileId } = input;

    // 1. Resolve file content for AI analysis
    let base64Content: string | undefined;
    let analysisUrl: string | undefined;

    if (source === 'drive' && driveFileId) {
      const downloaded = await this.drive.downloadBinary(businessId, driveFileId);
      base64Content = downloaded.base64;
    } else if (source === 'upload') {
      analysisUrl = evidenceUrl;
    }

    // 2. Run document intelligence
    const extraction = await this.docIntel.extractFromDocument({
      businessId,
      source: source === 'drive' ? 'google_drive' : 'upload',
      mimeType: evidenceMimeType,
      url: analysisUrl,
      base64Content,
      filename,
    });

    // 3. Parse extraction
    const extractedPayment = this.parsePaymentFromExtraction(extraction, filename);

    // Try to extract additional fields from raw text
    let date: string | undefined;
    let payer: string | undefined;
    if (extraction.rawText) {
      const dateMatch = extraction.rawText.match(/(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})/);
      if (dateMatch) date = dateMatch[1];
      const payerMatch = extraction.rawText.match(/(?:from|payer|sender|paid by)[\s:]*([A-Za-z][A-Za-z\s]+?)(?:\n|$|\d)/i);
      if (payerMatch) payer = payerMatch[1].trim();
    }

    return {
      extracted: extractedPayment
        ? { ...extractedPayment, date, payer }
        : null,
      raw: extraction,
    };
  }

  /**
   * V1-41 (D-27): the extracted payment is recorded PENDING
   * (recordPendingPayment): no posting, no reconcile, no balance moves. The
   * money is recorded once a member with revenue:write confirms it
   * (confirmPendingPayment). The response is the pending row, the invoice
   * status as it stands and the extracted figures.
   *
   * @param options.initiatedBy R0-PL-07 review (PL07-ST-3): the authenticated
   *   person who submitted the evidence. The recorder stays KEY's system actor
   *   (the figures are machine-extracted). A separate argument, never part of
   *   `input`, so a request body spread into `input` can not name it. V1-41:
   *   recordPayment kept it on the invoice.payment_recorded contact event; a
   *   PENDING row writes no contact event (CONTACT_EVENT_TYPES in
   *   packages/shared has no pending-payment type). V1-41 review (AUD-V41-3,
   *   CR-V41-2): it is kept as data.initiatedBy on the pending row's
   *   payment_pending_recorded `activities` row, written with the row and kept
   *   after the confirmation (recordPendingPayment). The confirming member is
   *   the recorder of the money (confirmPendingPayment).
   */
  async processEvidence(
    input: ProcessEvidenceInput,
    options: { initiatedBy?: string | null } = {},
  ): Promise<ProcessEvidenceResult> {
    const { businessId, invoiceId, evidenceUrl, evidenceMimeType, filename, source, driveFileId } = input;

    // 1. Resolve file content for AI analysis
    let base64Content: string | undefined;
    let analysisUrl: string | undefined;

    if (source === 'drive' && driveFileId) {
      const downloaded = await this.drive.downloadBinary(businessId, driveFileId);
      base64Content = downloaded.base64;
    } else if (source === 'upload') {
      // For S3 uploads, the evidenceUrl is a signed read URL that GPT-4o can access
      analysisUrl = evidenceUrl;
    }

    // 2. Run document intelligence
    const extraction = await this.docIntel.extractFromDocument({
      businessId,
      source: source === 'drive' ? 'google_drive' : 'upload',
      mimeType: evidenceMimeType,
      url: analysisUrl,
      base64Content,
      filename,
    });

    // 3. Validate extraction
    const extractedPayment = this.parsePaymentFromExtraction(extraction, filename);
    if (!extractedPayment) {
      throw new BadRequestException('Could not extract payment details from the document. Please record the payment manually.');
    }

    // 4. Record the payment PENDING with evidence attached (V1-41, D-27): an
    // AI-extracted amount moves no balance until a member confirms it.
    // R0-PL-07: the amount, method and reference are machine-extracted, so the
    // recorder is KEY's system actor, distinct from a person keying a manual
    // payment.
    const payment = await this.recordPendingPayment(invoiceId, businessId, {
      amount: extractedPayment.amount,
      method: extractedPayment.method,
      reference: extractedPayment.reference,
      notes: extractedPayment.notes,
      evidenceUrl,
      evidenceMimeType,
    }, { actorId: KEY_SYSTEM_ACTOR_ID, initiatedBy: options.initiatedBy ?? null });

    // 5. Nothing was reconciled: the invoice status is read as it stands.
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId },
      select: { status: true },
    });

    return {
      payment: {
        id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        provider: payment.provider,
        method: payment.method ?? 'OTHER',
        reference: payment.reference ?? null,
        notes: payment.notes ?? null,
        evidenceUrl: payment.evidenceUrl ?? null,
        evidenceMimeType: payment.evidenceMimeType ?? null,
      },
      invoiceStatus: String(invoice?.status ?? ''),
      requiresConfirmation: true,
      extracted: {
        amount: extractedPayment.amount,
        method: extractedPayment.method,
        reference: extractedPayment.reference,
        notes: extractedPayment.notes,
        confidence: extractedPayment.confidence,
      },
    };
  }

  /**
   * V1-41-DM-UNTRUSTED-MONEY-INPUTS (M32, D-27): record a payment read from an
   * untrusted input (an AI-extracted amount, a Drive intake plan) as one
   * PENDING Payment row. Nothing is posted, the invoice is not reconciled and
   * no balance moves: computeBalance and the V1-36 read contract ignore
   * PENDING. A member confirms it with confirmPendingPayment.
   *
   * The refusals are the operator door's (CommerceService.recordPayment): a
   * malformed amount or method 400, an invoice outside the tenant 404, a
   * DRAFT, PAID or VOID invoice 409. With `idempotencyKey` the row is keyed on
   * it (scoped to the invoice): a repeat with the same amount answers the row
   * already written (PENDING, or CONFIRMED once a member confirmed it) and
   * writes nothing; a repeat with another amount is a 409. Without one, every
   * call writes its own row, as the evidence path did before (review CR-1).
   *
   * `actorId` is Payment.recordedBy (KEY for extracted evidence, the approver
   * of a Drive plan, null with no human). No contact event is written: the
   * money is not recorded yet (confirmPendingPayment writes
   * invoice.payment_recorded through recordPayment).
   *
   * The row's provider is EXTRACTED_PAYMENT_PROVIDER, never the method (V1-41
   * review SEC-V41-1 / SEC-V41-2 / CR-V41-1), so the anonymous customer
   * intent upsert can not find it and rewrite its amount.
   *
   * V1-41 review (AUD-V41-3, CR-V41-2, PL07-ST-3): a new row is written with
   * one COMMERCE payment_pending_recorded `activities` row, in the same
   * transaction (a row that can not be audited is not written; R0-CMF2 wrote
   * the refund audit row the same way, since the contact-event registry has
   * no type for it). It names the recorder (actorType SYSTEM for KEY, USER for
   * a person, none without one) and, beside KEY only, `initiatedBy`: the
   * person on whose behalf KEY extracted it (the uploader, from req.user),
   * never a system actor, the same rule recordPayment applies. A replay writes
   * no second row; the row stays after the confirmation.
   */
  async recordPendingPayment(
    invoiceId: string,
    businessId: string,
    input: ExtractedPaymentInput,
    options: { actorId?: string | null; initiatedBy?: string | null } = {},
  ): Promise<Payment> {
    const actorId = options.actorId ?? null;
    const initiatedBy =
      isSystemActor(actorId) && options.initiatedBy && !isSystemActor(options.initiatedBy)
        ? options.initiatedBy
        : null;
    if (typeof input.amount !== 'number' || !Number.isFinite(input.amount)) {
      throw new BadRequestException('Payment amount must be a number');
    }
    if (toCents(input.amount) <= 0) {
      throw new BadRequestException('Payment amount must be positive');
    }
    if (typeof input.method !== 'string' || input.method.trim().length === 0) {
      throw new BadRequestException('Payment method is required');
    }
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId, deletedAt: null },
      select: { id: true, status: true, currency: true, invoiceNumber: true, contactId: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const amount = roundMoney(input.amount);
    const key = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
    const providerPaymentId = key
      ? `${EXTRACTED_PAYMENT_ID_PREFIX}${invoiceId}_key_${createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 32)}`
      : `${EXTRACTED_PAYMENT_ID_PREFIX}${invoiceId}_${randomBytes(16).toString('hex')}`;
    // A replay comes before the state guard: the confirmed payment may have
    // settled the invoice since the step first ran.
    const replayOf = async (): Promise<Payment | null> => {
      if (!key) return null;
      const existing = await this.prisma.client.payment.findFirst({ where: { providerPaymentId, businessId, invoiceId } });
      if (existing && !moneyEquals(Number(existing.amount), amount)) {
        throw new ConflictException('Idempotency key already used on this invoice with a different amount');
      }
      return existing;
    };
    const replayed = await replayOf();
    if (replayed) return replayed;

    if (invoice.status === 'PAID' || invoice.status === 'VOID' || invoice.status === 'DRAFT') {
      throw new ConflictException(`Cannot record payment on a ${invoice.status} invoice`);
    }

    let payment: Payment;
    try {
      payment = await this.prisma.client.$transaction(async (tx) => {
        const created = await tx.payment.create({
          data: {
            amount,
            currency: invoice.currency,
            // D-27: untrusted until a member confirms it; nothing is posted.
            status: 'PENDING',
            // Review SEC-V41-1: never the method (EXTRACTED_PAYMENT_PROVIDER).
            provider: EXTRACTED_PAYMENT_PROVIDER,
            method: input.method,
            providerPaymentId,
            reference: input.reference ?? null,
            notes: input.notes ?? null,
            evidenceUrl: input.evidenceUrl ?? null,
            evidenceMimeType: input.evidenceMimeType ?? null,
            recordedBy: actorId,
            businessId,
            invoiceId,
          },
        });
        // Review AUD-V41-3 / CR-V41-2: not caught; a row that can not be
        // audited rolls the pending row back.
        await tx.activity.create({
          data: {
            businessId,
            module: 'COMMERCE',
            action: PENDING_PAYMENT_AUDIT_ACTION,
            type: 'invoice.payment_pending',
            category: 'PAYMENT',
            status: 'PENDING',
            entityType: 'payment',
            entityId: created.id,
            title: 'Payment awaiting confirmation',
            detail: `Invoice ${invoice.invoiceNumber ?? invoiceId}`,
            contactId: invoice.contactId ?? null,
            data: {
              invoiceId,
              amount,
              currency: invoice.currency,
              method: input.method,
              reference: input.reference ?? null,
              recordedBy: actorId,
              ...(initiatedBy ? { initiatedBy } : {}),
            },
            // KEY is a SYSTEM actor, a person is USER; with no actor none is named.
            actorType: actorId ? (isSystemActor(actorId) ? 'SYSTEM' : 'USER') : null,
            actorId,
          },
        });
        return created;
      });
    } catch (err: unknown) {
      // Two runs of the same keyed step raced: the winner's row is the answer.
      if (key && (err as { code?: string } | null)?.code === 'P2002') {
        const winner = await replayOf();
        if (winner) return winner;
        throw new ConflictException('Payment identifier already in use; use a new idempotency key');
      }
      throw err;
    }

    return payment;
  }

  /**
   * V1-41-DM-UNTRUSTED-MONEY-INPUTS (D-27): a member confirms a payment an
   * untrusted input recorded PENDING (recordPendingPayment). The money goes
   * through the operator door, CommerceService.recordPayment, as the
   * confirming member: one SUCCESSFUL row recorded by the member, its
   * Payment:<id>:payment_recorded posting created by the member, the invoice
   * reconciled, the contact event naming the member. The pending row then
   * takes CONFIRMED_EXTRACTED_PAYMENT_STATUS and is never posted itself.
   *
   * Authority: the member holds revenue:write in this business, the rule
   * ModuleScopeGuard applies to POST .../invoices/:id/payments (an explicit
   * scope map, else the role defaults), restated here as UndoService does; a
   * membership is required (no SUPER_ADMIN bypass, D-46). 403 otherwise.
   *
   * Refusals write nothing: a payment that is not this tenant's 404; a row of
   * this tenant that no untrusted input wrote, or one no longer PENDING
   * (already confirmed), 409; recordPayment's own refusals (a PAID / VOID /
   * DRAFT invoice 409) leave the row PENDING.
   *
   * The money is keyed on the pending row (idempotencyKey
   * `extracted-confirm:<paymentId>`), so two concurrent confirmations, or a
   * retry after a failure between the record and the retirement, record it
   * once: the second replays the first payment and then finds the row already
   * retired (409).
   *
   * V1-41 review (SEC-V41-1): `options.amount` is the amount the member was
   * shown and approved. When given it must be a finite number (400) equal, in
   * cents, to the pending row's amount, or the confirmation is refused 409
   * and writes nothing, so the money recorded is never other than what the
   * member approved. A confirm route passes it from the member's request.
   *
   * V1-41b-PENDING-PAYMENT-CONFIRM-ROUTE: `options.invoiceId` binds the row
   * to the invoice the caller named (the HTTP route's :invoiceId); a pending
   * row of another invoice is not found (404) and nothing is written. The
   * route projects the answer (toInvoiceWriteResponse, DISC-V41-6).
   */
  async confirmPendingPayment(
    paymentId: string,
    businessId: string,
    memberId: string | null | undefined,
    options: { amount?: unknown; invoiceId?: string } = {},
  ) {
    let approved: number | undefined;
    if (options.amount !== undefined) {
      if (typeof options.amount !== 'number' || !Number.isFinite(options.amount)) {
        throw new BadRequestException('The approved amount must be a number');
      }
      approved = options.amount;
    }
    await this.assertMemberMayRecordPayments(businessId, memberId);
    const pending = await this.prisma.client.payment.findFirst({
      where: { id: paymentId, businessId, ...(options.invoiceId !== undefined ? { invoiceId: options.invoiceId } : {}) },
    });
    if (!pending) throw new NotFoundException('Payment not found');
    if (
      !pending.providerPaymentId.startsWith(EXTRACTED_PAYMENT_ID_PREFIX) ||
      pending.provider !== EXTRACTED_PAYMENT_PROVIDER
    ) {
      throw new ConflictException('Only a payment extracted from evidence or a Drive intake can be confirmed');
    }
    if (pending.status !== 'PENDING') {
      throw new ConflictException(`This payment was already confirmed (it is ${pending.status})`);
    }
    if (approved !== undefined && !moneyEquals(Number(pending.amount), approved)) {
      throw new ConflictException('The pending payment amount differs from the amount approved; reload it and try again');
    }

    const recorded = await this.commerce.recordPayment(pending.invoiceId, businessId, {
      amount: Number(pending.amount),
      // The extracted method (the row's provider is EXTRACTED_PAYMENT_PROVIDER).
      method: pending.method ?? 'OTHER',
      reference: pending.reference ?? undefined,
      notes: pending.notes ?? undefined,
      evidenceUrl: pending.evidenceUrl ?? undefined,
      evidenceMimeType: pending.evidenceMimeType ?? undefined,
      idempotencyKey: `extracted-confirm:${pending.id}`,
    }, { actorId: memberId });

    const retired = await this.prisma.client.payment.updateMany({
      where: { id: pending.id, businessId, status: 'PENDING' },
      data: { status: CONFIRMED_EXTRACTED_PAYMENT_STATUS },
    });
    if (retired.count !== 1) {
      throw new ConflictException('This payment was already confirmed');
    }
    // V1-41b review (CR-V41b-2): recordPayment (and its keyed replay) read the
    // invoice with its payments before the row above was retired, so that
    // read still carries this row PENDING. The answer reports the row as it
    // now is, so a caller that lists invoice.payments never counts the
    // confirmed row as a pending payment beside the money recorded from it.
    // Only `status` changed (a Payment row has no updatedAt).
    const invoice = recorded.invoice
      ? {
          ...recorded.invoice,
          payments: recorded.invoice.payments.map((p) =>
            p.id === pending.id ? { ...p, status: CONFIRMED_EXTRACTED_PAYMENT_STATUS } : p,
          ),
        }
      : recorded.invoice;
    return { ...recorded, invoice, confirmedPaymentId: pending.id };
  }

  /** ModuleScopeGuard's legacy rule for revenue >= write, for a member named by a service caller. */
  private async assertMemberMayRecordPayments(businessId: string, memberId: string | null | undefined): Promise<void> {
    if (!memberId || isSystemActor(memberId)) throw new ForbiddenException('A member must confirm this payment');
    const membership = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: memberId, businessId } },
      select: { role: true, permissionScopes: true },
    });
    if (!membership) throw new ForbiddenException('Not a member of this business');
    const scopes: Record<string, string> =
      membership.permissionScopes && typeof membership.permissionScopes === 'object'
        ? (membership.permissionScopes as Record<string, string>)
        : defaultScopesForRole(membership.role);
    const level = scopes.revenue || 'none';
    if (rankOf(level) < LEVEL_RANK.write) {
      throw new ForbiddenException(`Insufficient permissions: revenue requires write access (you have ${level})`);
    }
  }

  private parsePaymentFromExtraction(
    result: DocumentExtractionResult,
    filename: string,
  ): { amount: number; method: string; reference?: string; notes?: string; confidence: number } | null {
    if (!result.invoiceData && result.documentType !== 'receipt' && result.documentType !== 'invoice') {
      this.logger.warn(`Document type ${result.documentType} is not a receipt or invoice`);
      // Still try to extract if invoiceData is present
    }

    const data = result.invoiceData;
    if (!data) {
      // Fallback: try to use rawText to guess
      if (result.rawText) {
        const amountMatch = result.rawText.match(/(?:total|amount|paid)[\s:]*[$€£]?\s*([\d,]+\.?\d*)/i);
        if (amountMatch) {
          const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
          if (amount > 0) {
            return {
              amount,
              method: 'OTHER',
              notes: `Imported from ${filename}. Raw text: ${result.rawText.slice(0, 200)}`,
              confidence: 0.3,
            };
          }
        }
      }
      return null;
    }

    const amount = data.total || data.subtotal || 0;
    if (amount <= 0) return null;

    const method = normalizeMethod(data.notes);
    const reference = data.invoiceNumber || undefined;
    const notes = `Imported from ${filename}.${data.notes ? ` ${data.notes}` : ''}`;

    return {
      amount,
      method,
      reference,
      notes,
      confidence: result.confidence,
    };
  }
}
