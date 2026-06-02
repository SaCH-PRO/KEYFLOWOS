import { Injectable } from '@nestjs/common';

export interface VisualClassification {
  detectedType: string;
  confidenceScore: number;
  extractedText: string;
  extractedData: Record<string, unknown>;
  recommendedActions: Record<string, unknown>[];
  summary: string;
}

/**
 * Deterministic visual intake classifier.
 *
 * Uses filename, content type, and extracted text heuristics to classify
 * captured images into business object types.
 *
 * Future: replace with actual vision API (Google Vision, OpenAI GPT-4V, etc.)
 */
@Injectable()
export class VisualClassifierService {
  classify(
    fileName: string,
    contentType: string,
    _sizeBytes: number | null,
    extractedText?: string,
  ): VisualClassification {
    const text = (extractedText ?? '').toLowerCase();
    const name = (fileName ?? '').toLowerCase();

    // Business card detection
    if (this.matchesAny(text, [
      'business card', 'call card', 'tel:', 'phone:', 'mobile:', 'email:', 'www.',
      'director', 'manager', 'consultant', 'services', 'limited', 'ltd',
    ]) || this.matchesAny(name, ['card', 'business', 'contact'])) {
      return this.classifyBusinessCard(text);
    }

    // Receipt detection
    if (this.matchesAny(text, [
      'receipt', 'invoice', 'total', 'subtotal', 'tax', 'vat', 'change',
      'cashier', 'pos', 'merchant', 'payment', 'paid', 'thank you for your',
      'purchase', 'qty', 'quantity', 'item', 'price',
    ]) || this.matchesAny(name, ['receipt', 'bill', 'invoice', 'ticket'])) {
      return this.classifyReceipt(text);
    }

    // Document/contract detection
    if (this.matchesAny(text, [
      'agreement', 'contract', 'terms', 'conditions', 'party', 'parties',
      'whereas', 'hereinafter', 'obligation', 'clause', 'signature',
      'letter', 'memo', 'report', 'proposal', 'quotation',
    ]) || this.matchesAny(name, ['contract', 'agreement', 'doc', 'letter'])) {
      return this.classifyDocument(text);
    }

    // Product/inventory detection
    if (this.matchesAny(text, [
      'sku', 'barcode', 'upc', 'product', 'item code', 'serial',
      'manufacturer', 'model', 'warranty', 'expiration', 'batch',
    ]) || this.matchesAny(name, ['product', 'inventory', 'sku', 'item'])) {
      return this.classifyProduct(text);
    }

    // Default: unknown image
    return {
      detectedType: 'unknown',
      confidenceScore: 30,
      extractedText: text.slice(0, 500),
      extractedData: {},
      recommendedActions: [
        { type: 'review_manually', label: 'Review and classify manually' },
        { type: 'ask_key', label: 'Ask KEY to analyze this image' },
      ],
      summary: 'Captured image could not be automatically classified. Please review.',
    };
  }

  private classifyBusinessCard(text: string): VisualClassification {
    const data = this.extractBusinessCardFields(text);
    return {
      detectedType: 'business_card',
      confidenceScore: 75,
      extractedText: text.slice(0, 1000),
      extractedData: data,
      recommendedActions: [
        { type: 'create_contact', label: 'Create contact from card', priority: 90 },
        { type: 'draft_follow_up', label: 'Draft follow-up message', priority: 80 },
        { type: 'create_command', label: 'Create follow-up command', priority: 70 },
      ],
      summary: `Business card detected. Name: ${data.name ?? 'unknown'}, Company: ${data.company ?? 'unknown'}.`,
    };
  }

  private classifyReceipt(text: string): VisualClassification {
    const data = this.extractReceiptFields(text);
    return {
      detectedType: 'receipt',
      confidenceScore: 80,
      extractedText: text.slice(0, 1000),
      extractedData: data,
      recommendedActions: [
        { type: 'create_expense', label: 'Create expense record', priority: 90 },
        { type: 'suggest_category', label: 'Suggest expense category', priority: 70 },
        { type: 'create_vendor', label: 'Create vendor if new', priority: 50 },
      ],
      summary: `Receipt detected from ${data.merchant ?? 'unknown merchant'} for ${data.total ?? 'unknown amount'}.`,
    };
  }

  private classifyDocument(text: string): VisualClassification {
    return {
      detectedType: 'document',
      confidenceScore: 65,
      extractedText: text.slice(0, 1000),
      extractedData: { wordCount: text.split(/\s+/).length },
      recommendedActions: [
        { type: 'summarize', label: 'Summarize document', priority: 80 },
        { type: 'extract_obligations', label: 'Extract deadlines/obligations', priority: 70 },
        { type: 'attach_to_project', label: 'Attach to project/contact', priority: 60 },
      ],
      summary: `Document detected (${text.split(/\s+/).length} words). Review for business obligations.`,
    };
  }

  private classifyProduct(text: string): VisualClassification {
    return {
      detectedType: 'product',
      confidenceScore: 60,
      extractedText: text.slice(0, 1000),
      extractedData: {},
      recommendedActions: [
        { type: 'create_product', label: 'Create product draft', priority: 80 },
        { type: 'update_inventory', label: 'Update inventory count', priority: 70 },
        { type: 'suggest_storefront', label: 'Suggest storefront listing', priority: 50 },
      ],
      summary: 'Product or inventory image detected. Review and update catalog.',
    };
  }

  private extractBusinessCardFields(text: string): Record<string, unknown> {
    const lines = text.split(/\n|,/);
    const result: Record<string, unknown> = {};

    for (const line of lines) {
      const l = line.trim();
      if (/^\+?[\d\s\-\(\)]{7,}$/.test(l) && !result.phone) {
        result.phone = l.replace(/\s/g, '');
      }
      if (l.includes('@') && l.includes('.') && !result.email) {
        result.email = l.trim();
      }
      if (/www\.|\.com|\.tt|\.net|\.org/i.test(l) && !result.website) {
        result.website = l.trim();
      }
      if (/director|manager|consultant|owner|founder|ceo|cto|cfo/i.test(l) && !result.title) {
        result.title = l.trim();
      }
      if (/services|limited|ltd|inc|llc|corp/i.test(l) && !result.company) {
        result.company = l.trim();
      }
    }

    // Heuristic: first reasonable line might be a name
    const firstNameLike = lines.find((l) => {
      const t = l.trim();
      return t.length > 3 && t.length < 40 && !t.includes('@') && !/^\+?\d/.test(t) && !/www\.|\.com/i.test(t);
    });
    if (firstNameLike && !result.name) {
      result.name = firstNameLike.trim();
    }

    return result;
  }

  private extractReceiptFields(text: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // Try to find total
    const totalMatch = text.match(/(?:total|amount|sum)[\s:]*([\d,]+\.?\d*)/i);
    if (totalMatch) result.total = totalMatch[1];

    // Try to find tax
    const taxMatch = text.match(/(?:tax|vat|gst)[\s:]*([\d,]+\.?\d*)/i);
    if (taxMatch) result.tax = taxMatch[1];

    // Try to find date
    const dateMatch = text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
    if (dateMatch) result.date = dateMatch[1];

    // Try to find merchant name (first line that looks like a business name)
    const lines = text.split(/\n/);
    for (const line of lines) {
      const l = line.trim();
      if (l.length > 3 && l.length < 50 && /[a-zA-Z]{3,}/.test(l) && !/total|tax|cash|change|qty/i.test(l)) {
        result.merchant = l;
        break;
      }
    }

    return result;
  }

  private matchesAny(text: string, keywords: string[]): boolean {
    return keywords.some((k) => text.includes(k.toLowerCase()));
  }
}
