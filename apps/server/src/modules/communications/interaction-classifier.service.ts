import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface ClassifiedIntent {
  intentType: string;
  confidence: number;
  extractedData: Record<string, unknown>;
  recommendedAction: string;
  riskLevel: string;
}

/**
 * Deterministic interaction classifier.
 *
 * Uses keyword + pattern matching to classify inbound messages/calls/forms
 * into business intents. This is intentionally simple and fast.
 * Future: replace with LLM-based classification for higher accuracy.
 */
@Injectable()
export class InteractionClassifierService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  classify(body: string, subject?: string, medium?: string): ClassifiedIntent {
    const text = `${subject ?? ''} ${body ?? ''}`.toLowerCase();

    // Booking intent
    if (this.matches(text, [
      'book', 'appointment', 'schedule', 'available', 'free slot',
      'when can i see you', 'can i come in', 'reserve', 'slot',
      'friday', 'monday', 'tuesday', 'wednesday', 'thursday', 'saturday', 'sunday',
      'next week', 'this week', 'tomorrow', 'today',
    ])) {
      return {
        intentType: 'booking_request',
        confidence: 85,
        extractedData: { detectedDate: this.extractDate(text) },
        recommendedAction: 'Check availability and draft booking confirmation',
        riskLevel: 'LOW',
      };
    }

    // Quote / pricing intent
    if (this.matches(text, [
      'how much', 'price', 'cost', 'quote', 'pricing', 'estimate',
      'what is the rate', 'what do you charge', 'fee', 'rate',
      'expensive', 'cheap', 'budget', 'afford',
    ])) {
      return {
        intentType: 'quote_request',
        confidence: 90,
        extractedData: {},
        recommendedAction: 'Draft quote with service pricing',
        riskLevel: 'LOW',
      };
    }

    // Payment / invoice intent
    if (this.matches(text, [
      'invoice', 'payment', 'paid', 'pay', 'receipt', 'bill',
      'how do i pay', 'bank transfer', 'deposit', 'balance',
      'overdue', 'outstanding', 'reminder',
    ])) {
      return {
        intentType: 'payment_question',
        confidence: 88,
        extractedData: {},
        recommendedAction: 'Check invoice status and draft payment guidance',
        riskLevel: 'LOW',
      };
    }

    // Complaint / negative sentiment
    if (this.matches(text, [
      'complaint', 'unhappy', 'disappointed', 'terrible', 'awful',
      'worst', 'horrible', 'bad service', 'rude', 'delay',
      'refund', 'money back', 'not satisfied', 'did not receive',
      'wrong', 'broken', 'missing', 'late', 'never',
    ])) {
      return {
        intentType: 'complaint',
        confidence: 92,
        extractedData: {},
        recommendedAction: 'Escalate to human immediately — draft empathetic reply',
        riskLevel: 'HIGH',
      };
    }

    // Review / testimonial
    if (this.matches(text, [
      'review', 'testimonial', 'feedback', 'star', 'rating',
      'google review', 'facebook review', 'yelp',
      'how was your experience', 'would you recommend',
    ])) {
      return {
        intentType: 'review',
        confidence: 80,
        extractedData: {},
        recommendedAction: 'Send review request link',
        riskLevel: 'LOW',
      };
    }

    // Referral
    if (this.matches(text, [
      'refer', 'recommend', 'friend', 'colleague', 'someone else',
      'do you know anyone', 'who else',
    ])) {
      return {
        intentType: 'referral',
        confidence: 75,
        extractedData: {},
        recommendedAction: 'Send referral program link',
        riskLevel: 'LOW',
      };
    }

    // Support / help
    if (this.matches(text, [
      'help', 'support', 'question', 'how do i', 'can you help',
      'issue', 'problem', 'trouble', 'not working', 'confused',
    ])) {
      return {
        intentType: 'support',
        confidence: 70,
        extractedData: {},
        recommendedAction: 'Draft helpful response or create support command',
        riskLevel: 'LOW',
      };
    }

    // Vendor / supplier
    if (this.matches(text, [
      'supplier', 'vendor', 'wholesale', 'bulk', 'distributor',
      'partnership', 'collaborate', 'b2b',
    ])) {
      return {
        intentType: 'vendor',
        confidence: 70,
        extractedData: {},
        recommendedAction: 'Create vendor evaluation command',
        riskLevel: 'LOW',
      };
    }

    // New lead detection
    if (this.matches(text, [
      'interested', 'looking for', 'want to', 'need a', 'do you offer',
      'hi, i', 'hello, i', 'good day', 'good morning',
    ])) {
      return {
        intentType: 'new_lead',
        confidence: 60,
        extractedData: {},
        recommendedAction: 'Qualify lead and capture contact details',
        riskLevel: 'LOW',
      };
    }

    // Spam / irrelevant
    if (this.matches(text, [
      'unsubscribe', 'stop', 'remove me', 'spam', 'promotion',
      'free money', 'click here', 'winner', 'lottery',
    ])) {
      return {
        intentType: 'spam',
        confidence: 95,
        extractedData: {},
        recommendedAction: 'Archive and log',
        riskLevel: 'LOW',
      };
    }

    // Default: generic inquiry
    return {
      intentType: 'general_inquiry',
      confidence: 50,
      extractedData: {},
      recommendedAction: 'Draft polite reply and offer next step',
      riskLevel: 'LOW',
    };
  }

  private matches(text: string, keywords: string[]): boolean {
    return keywords.some((k) => text.includes(k));
  }

  private extractDate(text: string): string | null {
    const patterns = [
      /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
      /(tomorrow|today|next week)/i,
      /(\d{1,2})(st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)/i,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[0];
    }
    return null;
  }

  async saveIntent(
    businessId: string,
    input: {
      messageId?: string;
      callLogId?: string;
      contactId?: string;
    } & ClassifiedIntent,
  ) {
    return this.prisma.client.interactionIntent.create({
      data: {
        businessId,
        messageId: input.messageId ?? null,
        callLogId: input.callLogId ?? null,
        contactId: input.contactId ?? null,
        intentType: input.intentType,
        confidence: input.confidence,
        extractedData: input.extractedData,
        recommendedAction: input.recommendedAction,
        riskLevel: input.riskLevel,
      },
    });
  }
}
