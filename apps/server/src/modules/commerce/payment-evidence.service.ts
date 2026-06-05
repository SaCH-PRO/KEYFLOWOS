import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import { DocumentIntelligenceService, DocumentExtractionResult } from '../ai/document-intelligence.service';
import { GoogleDriveService } from '../google-drive/google-drive.service';
import { ObjectStorageService } from '../../core/object-storage/objectStorage';
import { CommerceService } from './commerce.service';
import { InvoiceWorkflowService } from './invoice-workflow.service';

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
    @Inject(InvoiceWorkflowService) private readonly invoiceWorkflow: InvoiceWorkflowService,
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

  async processEvidence(input: ProcessEvidenceInput): Promise<ProcessEvidenceResult> {
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

    // 4. Record the payment with evidence attached
    const result = await this.commerce.recordPayment(invoiceId, businessId, {
      amount: extractedPayment.amount,
      method: extractedPayment.method,
      reference: extractedPayment.reference,
      notes: extractedPayment.notes,
      evidenceUrl,
      evidenceMimeType,
    });

    // 5. Reconcile invoice status
    const reconciled = await this.invoiceWorkflow.reconcileFromPayments(invoiceId);

    return {
      payment: {
        id: result.payment.id,
        amount: result.payment.amount,
        currency: result.payment.currency,
        status: result.payment.status,
        provider: result.payment.provider,
        method: result.payment.method ?? 'OTHER',
        reference: result.payment.reference ?? null,
        notes: result.payment.notes ?? null,
        evidenceUrl: result.payment.evidenceUrl ?? null,
        evidenceMimeType: result.payment.evidenceMimeType ?? null,
      },
      invoiceStatus: reconciled.status,
      extracted: {
        amount: extractedPayment.amount,
        method: extractedPayment.method,
        reference: extractedPayment.reference,
        notes: extractedPayment.notes,
        confidence: extractedPayment.confidence,
      },
    };
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
