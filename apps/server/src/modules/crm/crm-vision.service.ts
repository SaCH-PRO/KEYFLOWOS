import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';

interface ExtractedContact {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  jobTitle?: string;
  address?: string;
  website?: string;
}

@Injectable()
export class CrmVisionService {
  private readonly logger = new Logger(CrmVisionService.name);
  private openai: OpenAI | null;

  constructor() {
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

  async extractContactFromImage(imageBase64: string): Promise<ExtractedContact> {
    if (!this.openai) {
      throw new Error('OpenAI API key is not configured');
    }

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are a contact information extractor. Analyze the image (likely a business card or contact info) and extract any contact details you can find. Return a JSON object with these fields (use null for missing fields):
- firstName: string or null
- lastName: string or null
- email: string or null
- phone: string or null (include country code if visible)
- companyName: string or null
- jobTitle: string or null
- address: string or null
- website: string or null

Only return the JSON object, no markdown or explanation.`,
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
                text: 'Extract contact information from this image.',
              },
            ],
          },
        ],
        max_tokens: 500,
      });

      const content = response.choices[0]?.message?.content || '{}';
      const cleanJson = content.replace(/```json\n?|\n?```/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      
      return {
        firstName: parsed.firstName || undefined,
        lastName: parsed.lastName || undefined,
        email: parsed.email || undefined,
        phone: parsed.phone || undefined,
        companyName: parsed.companyName || undefined,
        jobTitle: parsed.jobTitle || undefined,
        address: parsed.address || undefined,
        website: parsed.website || undefined,
      };
    } catch (error) {
      this.logger.error('Failed to extract contact from image', error);
      throw error;
    }
  }

  parseVCard(vcardContent: string): ExtractedContact[] {
    const contacts: ExtractedContact[] = [];
    const vcards = vcardContent.split('BEGIN:VCARD').filter(v => v.trim());

    for (const vcard of vcards) {
      const contact: ExtractedContact = {};
      const lines = vcard.split('\n').map(l => l.trim());

      for (const line of lines) {
        if (line.startsWith('FN:')) {
          const fullName = line.substring(3).trim();
          const parts = fullName.split(' ');
          contact.firstName = parts[0];
          contact.lastName = parts.slice(1).join(' ') || undefined;
        } else if (line.startsWith('N:')) {
          const nameParts = line.substring(2).split(';');
          contact.lastName = nameParts[0]?.trim() || undefined;
          contact.firstName = nameParts[1]?.trim() || undefined;
        } else if (line.startsWith('EMAIL') || line.includes('EMAIL:')) {
          const emailMatch = line.match(/EMAIL[^:]*:(.+)/i);
          if (emailMatch) contact.email = emailMatch[1].trim();
        } else if (line.startsWith('TEL') || line.includes('TEL:')) {
          const telMatch = line.match(/TEL[^:]*:(.+)/i);
          if (telMatch) contact.phone = telMatch[1].trim();
        } else if (line.startsWith('ORG:')) {
          contact.companyName = line.substring(4).split(';')[0].trim();
        } else if (line.startsWith('TITLE:')) {
          contact.jobTitle = line.substring(6).trim();
        } else if (line.startsWith('ADR') || line.includes('ADR:')) {
          const adrMatch = line.match(/ADR[^:]*:(.+)/i);
          if (adrMatch) {
            contact.address = adrMatch[1].split(';').filter(p => p.trim()).join(', ');
          }
        } else if (line.startsWith('URL:')) {
          contact.website = line.substring(4).trim();
        }
      }

      if (contact.firstName || contact.email || contact.phone) {
        contacts.push(contact);
      }
    }

    return contacts;
  }
}
