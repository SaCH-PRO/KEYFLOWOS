import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ModelGatewayService } from './model-gateway.service';
import { AiExecutionLogService } from './ai-execution-log.service';
import { AiOversightService } from './ai-oversight.service';
import { AiUsageService } from './ai-usage.service';

export interface DocumentExtractionRequest {
  businessId: string;
  source: string;
  mimeType: string;
  url?: string;
  base64Content?: string;
  filename: string;
  externalId?: string;
  sourceConnector?: string;
}

export interface ExtractedInvoiceData {
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  lineItems: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
  subtotal: number;
  taxRate?: number;
  taxAmount?: number;
  total: number;
  currency: string;
  issueDate?: string;
  dueDate?: string;
  invoiceNumber?: string;
  notes?: string;
  confidence: number;
}

export interface ExtractedContactData {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  address?: string;
  city?: string;
  country?: string;
  source?: string;
  confidence: number;
}

export interface ExtractedCreditNoteData {
  originalInvoiceNumber?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  amountPaid?: number;
  amountCredited?: number;
  totalOriginalAmount?: number;
  currency?: string;
  issueDate?: string;
  reason?: string;
  lineItems?: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
  confidence: number;
}

export interface DocumentExtractionResult {
  documentType: 'invoice' | 'receipt' | 'credit_note' | 'contact_card' | 'contract' | 'unknown';
  invoiceData?: ExtractedInvoiceData;
  creditNoteData?: ExtractedCreditNoteData;
  contactData?: ExtractedContactData;
  rawText?: string;
  confidence: number;
  suggestedActions: Array<{
    action: string;
    toolName?: string;
    description: string;
    payload: Record<string, any>;
  }>;
}

@Injectable()
export class DocumentIntelligenceService {
  private readonly logger = new Logger(DocumentIntelligenceService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(ModelGatewayService) private readonly gateway: ModelGatewayService,
    @Inject(AiExecutionLogService) private readonly executionLog: AiExecutionLogService,
    @Inject(AiOversightService) private readonly governance: AiOversightService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
  ) {}

  async extractFromDocument(req: DocumentExtractionRequest): Promise<DocumentExtractionResult> {
    const startTime = Date.now();

    // Build prompt based on available data
    const hasImage = req.mimeType.startsWith('image/') || req.mimeType === 'application/pdf';
    const context = `Document: ${req.filename}\nSource: ${req.source}\nType: ${req.mimeType}`;

    const systemPrompt = `You are a document intelligence engine. Extract structured business data from documents.

For INVOICES/RECEIPTS, extract:
- lineItems: array of {description, quantity, unitPrice, total}
- subtotal, taxRate, taxAmount, total, currency
- contact info (name, email, phone)
- dates (issueDate, dueDate)
- invoiceNumber

For CREDIT NOTES / PARTIAL-PAYMENT NOTES, extract:
- originalInvoiceNumber (the invoice this credit relates to)
- contact info (name, email, phone)
- totalOriginalAmount (full invoice amount before credit)
- amountPaid (amount the customer actually paid)
- amountCredited (amount being written off as credit)
- currency, issueDate, reason
- lineItems if listed

For CONTACT CARDS/BUSINESS CARDS, extract:
- firstName, lastName, email, phone, companyName, address

For CONTRACTS, extract:
- parties involved, key dates, amounts, renewal terms

Respond ONLY with valid JSON in this exact shape:
{
  "documentType": "invoice" | "receipt" | "credit_note" | "contact_card" | "contract" | "unknown",
  "confidence": 0.0-1.0,
  "invoiceData": { ... } | null,
  "creditNoteData": { ... } | null,
  "contactData": { ... } | null,
  "rawText": "extracted text summary",
  "suggestedActions": [
    { "action": "create_invoice", "toolName": "commerce_create_invoice", "description": "...", "payload": {} }
  ]
}`;

    try {
        const messages: any[] = [{ role: 'system', content: systemPrompt }];

      // Use GPT-4o vision when image data is available
      const hasVisionData = req.url || req.base64Content;
      if (hasVisionData && (req.mimeType.startsWith('image/') || req.mimeType === 'application/pdf')) {
        const imageUrl = req.base64Content
          ? `data:${req.mimeType};base64,${req.base64Content}`
          : req.url;

        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: `${context}\n\nAnalyze this document and extract structured data.` },
            { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
          ],
        });
      } else {
        messages.push({
          role: 'user',
          content: `${context}\n\n${req.url ? `Document URL: ${req.url}` : 'Document content available for analysis.'}`,
        });
      }

      const response = await this.aiUsage.trackAndComplete(
        req.businessId,
        undefined,
        'document_extract',
        {
          messages,
          maxTokens: 1200,
          temperature: 0.2,
        },
      );

      const content = response.content?.trim() ?? '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in AI response');
      }

      const result = JSON.parse(jsonMatch[0]) as DocumentExtractionResult;
      const durationMs = Date.now() - startTime;

      await this.executionLog.log({
        businessId: req.businessId,
        action: 'document:extract',
        mode: 'autonomous',
        actor: 'ai',
        success: true,
        durationMs,
        inputSummary: { filename: req.filename, mimeType: req.mimeType },
        outputSummary: { documentType: result.documentType, confidence: result.confidence },
      }).catch(() => {});

      // Emit event for downstream processing
      this.events.emit('document.extracted', {
        businessId: req.businessId,
        source: req.source,
        filename: req.filename,
        result,
      });

      return result;
    } catch (err: any) {
      this.logger.error(`Document extraction failed: ${(err as Error).message}`);
      return {
        documentType: 'unknown',
        confidence: 0,
        rawText: '',
        suggestedActions: [],
      };
    }
  }

  async processExtractedDocument(
    businessId: string,
    result: DocumentExtractionResult,
    opts?: { autoCreate?: boolean; userId?: string },
  ): Promise<Array<{ action: string; success: boolean; entityId?: string; error?: string }>> {
    const outcomes: Array<{ action: string; success: boolean; entityId?: string; error?: string }> = [];

    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { currency: true },
    });
    const businessCurrency = business?.currency ?? 'TTD';

    if (result.documentType === 'invoice' || result.documentType === 'receipt') {
      if (result.invoiceData && result.invoiceData.confidence > 0.7) {
        // Check governance
        const decision = await this.governance.evaluateAutoApproval(businessId, 'commerce_create_invoice');

        if (decision.autoApproved || opts?.autoCreate) {
          try {
            // Create or find contact
            let contactId: string | undefined;
            if (result.invoiceData.contactName || result.invoiceData.contactEmail) {
              const existing = await this.prisma.client.contact.findFirst({
                where: {
                  businessId,
                  OR: [
                    ...(result.invoiceData.contactEmail ? [{ email: result.invoiceData.contactEmail }] : []),
                    ...(result.invoiceData.contactPhone ? [{ phone: result.invoiceData.contactPhone }] : []),
                  ],
                  deletedAt: null,
                },
                select: { id: true },
              });

              if (existing) {
                contactId = existing.id;
              } else if (result.invoiceData.contactName) {
                const names = result.invoiceData.contactName.split(' ');
                const newContact = await this.prisma.client.contact.create({
                  data: {
                    businessId,
                    firstName: names[0] || null,
                    lastName: names.slice(1).join(' ') || null,
                    email: result.invoiceData.contactEmail ?? null,
                    phone: result.invoiceData.contactPhone ?? null,
                    status: 'LEAD',
                    source: 'document_extraction',
                  },
                });
                contactId = newContact.id;
              }
            }

            // Ensure we have a contactId (required field)
            if (!contactId) {
              const fallbackContact = await this.prisma.client.contact.create({
                data: {
                  businessId,
                  firstName: result.invoiceData.contactName?.split(' ')[0] ?? 'Unknown',
                  lastName: result.invoiceData.contactName?.split(' ').slice(1).join(' ') ?? 'Customer',
                  email: result.invoiceData.contactEmail ?? null,
                  phone: result.invoiceData.contactPhone ?? null,
                  status: 'LEAD',
                  source: 'document_extraction',
                },
              });
              contactId = fallbackContact.id;
            }

            // Create invoice
            const invoice = await this.prisma.client.invoice.create({
              data: {
                businessId,
                contactId,
                invoiceNumber: result.invoiceData.invoiceNumber ?? `AI-${Date.now()}`,
                status: 'DRAFT',
                currency: result.invoiceData.currency ?? businessCurrency,
                subtotal: result.invoiceData.subtotal ?? result.invoiceData.total ?? 0,
                taxRate: result.invoiceData.taxRate ?? 0,
                taxAmount: result.invoiceData.taxAmount ?? 0,
                total: result.invoiceData.total ?? 0,
                notes: result.invoiceData.notes ?? null,
                items: {
                  create: result.invoiceData.lineItems.map((item) => ({
                    description: item.description,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    total: item.total,
                  })),
                },
              },
            });

            outcomes.push({ action: 'create_invoice', success: true, entityId: invoice.id });

            this.events.emit('invoice.created', {
              businessId,
              invoiceId: invoice.id,
              source: 'document_intelligence',
            });
          } catch (err: any) {
            outcomes.push({ action: 'create_invoice', success: false, error: (err as Error).message });
          }
        } else {
          outcomes.push({ action: 'create_invoice', success: false, error: 'Requires approval - not auto-approved' });
        }
      }
    }

    if (result.documentType === 'credit_note') {
      if (result.creditNoteData && result.creditNoteData.confidence > 0.6) {
        try {
          const existing = await this.prisma.client.contact.findFirst({
            where: {
              businessId,
              OR: [
                ...(result.creditNoteData.contactEmail ? [{ email: result.creditNoteData.contactEmail }] : []),
                ...(result.creditNoteData.contactPhone ? [{ phone: result.creditNoteData.contactPhone }] : []),
              ],
              deletedAt: null,
            },
            select: { id: true },
          });
          if (!existing && result.creditNoteData.contactName) {
            const names = result.creditNoteData.contactName.split(' ');
            await this.prisma.client.contact.create({
              data: {
                businessId,
                firstName: names[0] || null,
                lastName: names.slice(1).join(' ') || null,
                email: result.creditNoteData.contactEmail ?? null,
                phone: result.creditNoteData.contactPhone ?? null,
                status: 'LEAD',
                source: 'document_extraction',
              },
            });
          }
          outcomes.push({ action: 'resolve_credit_note_contact', success: true });
        } catch (err: any) {
          outcomes.push({ action: 'resolve_credit_note_contact', success: false, error: (err as Error).message });
        }
      }
    }

    if (result.documentType === 'contact_card') {
      if (result.contactData && result.contactData.confidence > 0.7) {
        try {
          const existing = await this.prisma.client.contact.findFirst({
            where: {
              businessId,
              OR: [
                ...(result.contactData.email ? [{ email: result.contactData.email }] : []),
                ...(result.contactData.phone ? [{ phone: result.contactData.phone }] : []),
              ],
              deletedAt: null,
            },
            select: { id: true },
          });

          if (existing) {
            // Update existing contact
            await this.prisma.client.contact.update({
              where: { id: existing.id },
              data: {
                firstName: result.contactData.firstName ?? undefined,
                lastName: result.contactData.lastName ?? undefined,
                phone: result.contactData.phone ?? null,
                companyName: result.contactData.companyName ?? undefined,
              },
            });
            outcomes.push({ action: 'update_contact', success: true, entityId: existing.id });
          } else {
            const contact = await this.prisma.client.contact.create({
              data: {
                businessId,
                firstName: result.contactData.firstName ?? null,
                lastName: result.contactData.lastName ?? null,
                email: result.contactData.email ?? null,
                phone: result.contactData.phone ?? null,
                companyName: result.contactData.companyName ?? null,
                status: 'LEAD',
                source: 'document_extraction',
              },
            });
            outcomes.push({ action: 'create_contact', success: true, entityId: contact.id });
          }
        } catch (err: any) {
          outcomes.push({ action: 'create_contact', success: false, error: (err as Error).message });
        }
      }
    }

    return outcomes;
  }
}
