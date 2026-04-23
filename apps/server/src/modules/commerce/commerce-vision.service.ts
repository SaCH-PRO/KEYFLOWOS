import { Injectable, Logger, Inject } from '@nestjs/common';
import OpenAI from 'openai';
import { AiUsageService } from '../ai/ai-usage.service';

export interface ExtractedProduct {
  name?: string;
  description?: string;
  price?: number;
  currency?: string;
  category?: 'SERVICE' | 'PRODUCT' | 'PACKAGE';
  duration?: number;
  sku?: string;
}

@Injectable()
export class CommerceVisionService {
  private readonly logger = new Logger(CommerceVisionService.name);
  private openai: OpenAI | null;

  constructor(
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
  ) {
    const apiKey =
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||
      process.env.OPENAI_API_KEY;
    this.openai = apiKey
      ? new OpenAI({
          apiKey,
          baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
        })
      : null;
  }

  async extractProductsFromImage(imageBase64: string, businessCurrency?: string): Promise<ExtractedProduct[]> {
    if (!this.openai) {
      this.logger.warn('OpenAI API key is not configured; skipping image extraction');
      return [];
    }

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are a product catalog extractor. Analyze the image and extract ALL products, services, or packages you can identify.

For each item found, return a JSON object with:
- name: string (required — the product/service name)
- description: string or null
- price: number or null (numeric value only, no currency symbols)
- currency: string or null (ISO 4217 code like "TTD", "USD", "EUR"; default "${businessCurrency || 'TTD'}" if not specified)
- category: "SERVICE" | "PRODUCT" | "PACKAGE" (infer from context)
- duration: number or null (in minutes, for services only)
- sku: string or null (if visible)

Return a JSON array of objects. If only one item is found, still return an array with one element.
Only return the JSON array, no markdown or explanation.`,
          },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: imageBase64.startsWith('data:')
                    ? imageBase64
                    : `data:image/jpeg;base64,${imageBase64}`,
                },
              },
              {
                type: 'text',
                text: 'Extract all products, services, or packages from this image. This could be a menu, price list, catalog, business card, flyer, or any document listing items for sale.',
              },
            ],
          },
        ],
        max_tokens: 2000,
      });

      const content = response.choices[0]?.message?.content || '[]';
      const cleanJson = content.replace(/```json\n?|\n?```/g, '').trim();

      let parsed: any;
      try {
        parsed = JSON.parse(cleanJson);
      } catch {
        this.logger.warn('AI returned invalid JSON, attempting recovery', { content: cleanJson.substring(0, 200) });
        const arrayMatch = cleanJson.match(/\[[\s\S]*\]/);
        const objectMatch = cleanJson.match(/\{[\s\S]*\}/);
        try {
          parsed = arrayMatch ? JSON.parse(arrayMatch[0]) : objectMatch ? JSON.parse(objectMatch[0]) : null;
        } catch {
          this.logger.error('Could not recover JSON from AI response');
          return [];
        }
      }

      if (!parsed) return [];
      const items: ExtractedProduct[] = Array.isArray(parsed) ? parsed : [parsed];

      return items.map(item => ({
        name: item.name || undefined,
        description: item.description || undefined,
        price: typeof item.price === 'number' ? item.price : (item.price ? parseFloat(item.price) || undefined : undefined),
        currency: item.currency || businessCurrency || 'TTD',
        category: (item.category && ['SERVICE', 'PRODUCT', 'PACKAGE'].includes(item.category) ? item.category : 'PRODUCT') as ExtractedProduct['category'],
        duration: typeof item.duration === 'number' ? item.duration : undefined,
        sku: item.sku || undefined,
      })).filter(item => item.name);
    } catch (error) {
      this.logger.error('Failed to extract products from image', error);
      return [];
    }
  }

  parseProductsCsv(csvContent: string): ExtractedProduct[] {
    const lines = csvContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) return [];

    const headerLine = lines[0];
    const headers = this.parseCsvLine(headerLine).map(h => h.toLowerCase().trim());

    const fieldMap: Record<string, string[]> = {
      name: ['name', 'product', 'service', 'item', 'title', 'product name', 'service name', 'item name'],
      description: ['description', 'desc', 'details', 'notes', 'about'],
      price: ['price', 'cost', 'amount', 'rate', 'unit price', 'unit_price', 'unitprice'],
      currency: ['currency', 'curr', 'cur'],
      category: ['category', 'type', 'kind', 'product type', 'service type'],
      duration: ['duration', 'time', 'minutes', 'mins', 'length'],
      sku: ['sku', 'code', 'product code', 'item code', 'barcode', 'upc'],
    };

    const colMap: Record<string, number> = {};
    for (const [field, synonyms] of Object.entries(fieldMap)) {
      const idx = headers.findIndex(h => synonyms.includes(h));
      if (idx !== -1) colMap[field] = idx;
    }

    if (colMap.name === undefined) {
      colMap.name = 0;
      if (headers.length > 1 && colMap.price === undefined) {
        colMap.price = 1;
      }
    }

    const products: ExtractedProduct[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCsvLine(lines[i]);
      const name = colMap.name !== undefined ? values[colMap.name]?.trim() : undefined;
      if (!name) continue;

      const rawCategory = colMap.category !== undefined ? values[colMap.category]?.trim().toUpperCase() : undefined;
      const category = rawCategory && ['SERVICE', 'PRODUCT', 'PACKAGE'].includes(rawCategory)
        ? rawCategory as ExtractedProduct['category']
        : undefined;

      const rawPrice = colMap.price !== undefined ? values[colMap.price]?.trim() : undefined;
      const price = rawPrice ? parseFloat(rawPrice.replace(/[^0-9.-]/g, '')) : undefined;

      const rawDuration = colMap.duration !== undefined ? values[colMap.duration]?.trim() : undefined;
      const duration = rawDuration ? parseInt(rawDuration.replace(/[^0-9]/g, ''), 10) : undefined;

      products.push({
        name,
        description: colMap.description !== undefined ? values[colMap.description]?.trim() || undefined : undefined,
        price: price && !isNaN(price) ? price : undefined,
        currency: colMap.currency !== undefined ? values[colMap.currency]?.trim() || undefined : undefined,
        category,
        duration: duration && !isNaN(duration) ? duration : undefined,
        sku: colMap.sku !== undefined ? values[colMap.sku]?.trim() || undefined : undefined,
      });
    }

    return products;
  }

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }
}
