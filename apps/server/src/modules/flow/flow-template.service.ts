import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface FlowTemplateSeed {
  key: string;
  name: string;
  description: string;
  category: string;
  nodes: unknown[];
  edges: unknown[];
  businessTypes?: string[];
  requiredConnectors?: string[];
  estimatedImpact?: string;
  riskTier?: number;
}

const SYSTEM_TEMPLATES: FlowTemplateSeed[] = [
  {
    key: 'missed_call_text_back',
    name: 'Missed Call Text-Back',
    description: 'When a call is missed, immediately send a follow-up text message via WhatsApp/SMS.',
    category: 'communication',
    businessTypes: ['service', 'retail', 'healthcare', 'professional'],
    riskTier: 2,
    nodes: [
      { id: 'trigger', type: 'trigger', data: { triggerType: 'missed_call' } },
      { id: 'delay', type: 'delay', data: { seconds: 30 } },
      { id: 'send_message', type: 'action', data: { actionType: 'draft_message', channel: 'whatsapp', body: 'Sorry we missed your call. How can we help?' } },
      { id: 'create_task', type: 'action', data: { actionType: 'create_task', title: 'Follow up missed call' } },
    ],
    edges: [
      { source: 'trigger', target: 'delay' },
      { source: 'delay', target: 'send_message' },
      { source: 'send_message', target: 'create_task' },
    ],
  },
  {
    key: 'whatsapp_price_to_booking',
    name: 'WhatsApp Price Inquiry → Booking',
    description: 'Reply to price inquiries on WhatsApp with a quote and booking link.',
    category: 'revenue',
    businessTypes: ['service', 'retail', 'healthcare'],
    riskTier: 2,
    nodes: [
      { id: 'trigger', type: 'trigger', data: { triggerType: 'new_message', channel: 'whatsapp' } },
      { id: 'classify', type: 'condition', data: { conditionType: 'if_message_contains', keywords: ['price', 'cost', 'how much', 'rate'] } },
      { id: 'draft_reply', type: 'action', data: { actionType: 'draft_message', channel: 'whatsapp', purpose: 'quote' } },
      { id: 'create_lead_cmd', type: 'action', data: { actionType: 'create_command_item', category: 'SALES', title: 'Qualify WhatsApp price inquiry' } },
    ],
    edges: [
      { source: 'trigger', target: 'classify' },
      { source: 'classify', target: 'draft_reply' },
      { source: 'draft_reply', target: 'create_lead_cmd' },
    ],
  },
  {
    key: 'overdue_invoice_reminder',
    name: 'Overdue Invoice Reminder',
    description: 'When an invoice becomes overdue, send a friendly reminder and create a collection task.',
    category: 'finance',
    businessTypes: ['service', 'retail', 'professional'],
    riskTier: 3,
    nodes: [
      { id: 'trigger', type: 'trigger', data: { triggerType: 'invoice_overdue' } },
      { id: 'check_amount', type: 'condition', data: { conditionType: 'if_amount_over', amount: 0 } },
      { id: 'draft_reminder', type: 'action', data: { actionType: 'draft_message', channel: 'email', purpose: 'invoice_reminder' } },
      { id: 'create_task', type: 'action', data: { actionType: 'create_task', title: 'Collect overdue invoice' } },
      { id: 'notify_owner', type: 'action', data: { actionType: 'notify_user', message: 'Invoice is overdue' } },
    ],
    edges: [
      { source: 'trigger', target: 'check_amount' },
      { source: 'check_amount', target: 'draft_reminder' },
      { source: 'draft_reminder', target: 'create_task' },
      { source: 'create_task', target: 'notify_owner' },
    ],
  },
  {
    key: 'quote_follow_up',
    name: 'Quote Follow-Up Sequence',
    description: 'After a quote is sent, send a follow-up if not accepted within 3 days.',
    category: 'sales',
    businessTypes: ['service', 'retail', 'professional'],
    riskTier: 2,
    nodes: [
      { id: 'trigger', type: 'trigger', data: { triggerType: 'quote_viewed' } },
      { id: 'delay', type: 'delay', data: { hours: 72 } },
      { id: 'draft_followup', type: 'action', data: { actionType: 'draft_message', channel: 'email', purpose: 'follow_up' } },
      { id: 'create_cmd', type: 'action', data: { actionType: 'create_command_item', category: 'SALES', title: 'Follow up on quote' } },
    ],
    edges: [
      { source: 'trigger', target: 'delay' },
      { source: 'delay', target: 'draft_followup' },
      { source: 'draft_followup', target: 'create_cmd' },
    ],
  },
  {
    key: 'business_card_to_followup',
    name: 'Business Card Scan → Follow-Up',
    description: 'When a business card is scanned, create a contact and draft a follow-up message.',
    category: 'operations',
    businessTypes: ['service', 'retail', 'professional', 'healthcare'],
    riskTier: 1,
    nodes: [
      { id: 'trigger', type: 'trigger', data: { triggerType: 'device_capture_created', captureType: 'business_card' } },
      { id: 'create_contact', type: 'action', data: { actionType: 'create_contact' } },
      { id: 'draft_message', type: 'action', data: { actionType: 'draft_message', channel: 'whatsapp', purpose: 'follow_up' } },
      { id: 'create_task', type: 'action', data: { actionType: 'create_task', title: 'Nurture new contact from card' } },
    ],
    edges: [
      { source: 'trigger', target: 'create_contact' },
      { source: 'create_contact', target: 'draft_message' },
      { source: 'draft_message', target: 'create_task' },
    ],
  },
  {
    key: 'post_booking_review_request',
    name: 'Post-Booking Review Request',
    description: 'After a booking is completed, request a review after 24 hours.',
    category: 'customer_success',
    businessTypes: ['service', 'retail', 'healthcare'],
    riskTier: 1,
    nodes: [
      { id: 'trigger', type: 'trigger', data: { triggerType: 'booking_completed' } },
      { id: 'delay', type: 'delay', data: { hours: 24 } },
      { id: 'draft_review', type: 'action', data: { actionType: 'draft_message', channel: 'whatsapp', purpose: 'review_request' } },
      { id: 'create_cmd', type: 'action', data: { actionType: 'create_command_item', category: 'CUSTOMER_SUCCESS', title: 'Follow up for review' } },
    ],
    edges: [
      { source: 'trigger', target: 'delay' },
      { source: 'delay', target: 'draft_review' },
      { source: 'draft_review', target: 'create_cmd' },
    ],
  },
];

@Injectable()
export class FlowTemplateService implements OnModuleInit {
  private readonly logger = new Logger(FlowTemplateService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    await this.seedSystemTemplates();
  }

  async seedSystemTemplates() {
    const existingKeys = await this.prisma.client.flowTemplate.findMany({
      where: { isSystem: true },
      select: { key: true },
    });
    const existingSet = new Set(existingKeys.map((t) => t.key));

    let created = 0;
    for (const t of SYSTEM_TEMPLATES) {
      if (!existingSet.has(t.key)) {
        await this.prisma.client.flowTemplate.create({
          data: {
            key: t.key,
            name: t.name,
            description: t.description,
            category: t.category,
            nodes: t.nodes as any,
            edges: t.edges as any,
            businessTypes: t.businessTypes ?? [],
            requiredConnectors: t.requiredConnectors ?? [],
            estimatedImpact: t.estimatedImpact ?? null,
            riskTier: t.riskTier ?? 1,
            isSystem: true,
          },
        });
        created++;
        this.logger.log(`Seeded flow template: ${t.key}`);
      }
    }
    if (created > 0) {
      this.logger.log(`Flow template seeding complete. Created ${created} new templates.`);
    }
    return { seeded: created };
  }

  async findMany() {
    return this.prisma.client.flowTemplate.findMany({
      where: { isSystem: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async count() {
    return this.prisma.client.flowTemplate.count({
      where: { isSystem: true },
    });
  }

  async createFromTemplate(businessId: string, templateId: string, createdBy: string) {
    const template = await this.prisma.client.flowTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw new Error('Template not found');

    const result = await this.prisma.client.$transaction(async (tx) => {
      const flow = await tx.automationFlow.create({
        data: {
          businessId,
          name: template.name,
          description: template.description,
          category: template.category,
          status: 'DRAFT',
          goal: template.estimatedImpact ?? null,
          triggerSummary: null,
          riskTier: template.riskTier,
          createdBy,
          blueprintTags: template.businessTypes as any,
        },
      });

      await tx.flowVersion.create({
        data: {
          flowId: flow.id,
          version: 1,
          nodes: template.nodes as any,
          edges: template.edges as any,
          settings: template.requiredConnectors as any,
          status: 'DRAFT',
        },
      });

      return flow;
    });

    return result;
  }
}
