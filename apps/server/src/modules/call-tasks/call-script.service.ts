import {
  Injectable,
  Inject,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ModelGatewayService } from '../ai/model-gateway.service';

export interface CallScriptResult {
  greeting: string;
  talkingPoints: string[];
  ask: string;
  close: string;
  durationEstimate: number;
}

@Injectable()
export class CallScriptService {
  private readonly logger = new Logger(CallScriptService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ModelGatewayService) private readonly gateway: ModelGatewayService,
  ) {}

  async generateScript(
    businessId: string,
    callLogId: string,
    contactId: string,
  ): Promise<CallScriptResult> {
    const contact = await this.prisma.client.contact.findUnique({
      where: { id: contactId },
      include: {
        deals: {
          where: { status: 'OPEN' },
          take: 5,
          include: { stage: true },
        },
        invoices: { orderBy: { issueDate: 'desc' }, take: 5 },
        bookings: { orderBy: { startTime: 'desc' }, take: 5 },
        tasks: {
          where: { status: 'OPEN' },
          orderBy: { dueDate: 'asc' },
          take: 5,
        },
      },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    const callLog = await this.prisma.client.callLog.findUnique({
      where: { id: callLogId },
    });

    if (!callLog) {
      throw new NotFoundException('Call log not found');
    }

    const contactName =
      contact.displayName ||
      [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
      'there';
    const companyName = contact.companyName || 'their company';

    const openDeals =
      contact.deals
        .map(
          (d) =>
            `- ${d.title}: ${d.value ? `${d.currency} ${d.value.toLocaleString()}` : 'value TBD'} (${d.stage?.name ?? d.status})`,
        )
        .join('\n') || 'None';

    const recentInvoices =
      contact.invoices
        .map(
          (i) =>
            `- Invoice ${i.invoiceNumber || i.id}: ${i.currency} ${i.total.toLocaleString()} (${i.status})${i.dueDate && i.status !== 'PAID' ? ` due ${new Date(i.dueDate).toLocaleDateString()}` : ''}`,
        )
        .join('\n') || 'None';

    const recentBookings =
      contact.bookings
        .map(
          (b) =>
            `- ${b.startTime ? new Date(b.startTime).toLocaleDateString() : 'TBD'}: ${b.status}`,
        )
        .join('\n') || 'None';

    const openTasks =
      contact.tasks
        .map((t) => `- ${t.title}${t.dueDate ? ` (due ${new Date(t.dueDate).toLocaleDateString()})` : ''}`)
        .join('\n') || 'None';

    const goal = this.inferGoal(contact, contact.invoices, contact.deals, contact.bookings);

    const prompt = `You are a sales assistant. Generate a brief, natural call script for calling ${contactName}.

Context:
- Contact: ${contactName} at ${companyName}
- Status: ${contact.status}
- Last interaction: ${contact.lastInteractionAt ? new Date(contact.lastInteractionAt).toLocaleDateString() : 'Unknown'}
- Open deals:
${openDeals}
- Recent invoices:
${recentInvoices}
- Recent bookings:
${recentBookings}
- Open tasks:
${openTasks}

Goal: ${goal}

Return a JSON object with these exact keys: { "greeting": string, "talkingPoints": string[], "ask": string, "close": string, "durationEstimate": number }
Keep the script concise (under 200 words total). Be natural and conversational.`;

    const response = await this.gateway.complete({
      businessId,
      taskCategory: 'content-generation',
      messages: [
        {
          role: 'system',
          content:
            'You are a helpful sales assistant that generates concise, natural call scripts. Always return valid JSON with no markdown formatting.',
        },
        { role: 'user', content: prompt },
      ],
      maxTokens: 600,
      temperature: 0.7,
    });

    let script: CallScriptResult;
    try {
      const content = response.content || '{}';
      script = JSON.parse(content) as CallScriptResult;
    } catch (err: any) {
      this.logger.error(
        `Failed to parse AI response for call script: ${err?.message}`,
      );
      throw new Error('Failed to generate call script', { cause: err });
    }

    if (
      !script.greeting ||
      !Array.isArray(script.talkingPoints) ||
      !script.ask ||
      !script.close
    ) {
      this.logger.error('AI response missing required call script fields');
      throw new Error('Invalid call script format from AI');
    }

    await this.prisma.client.callLog.update({
      where: { id: callLogId },
      data: { script: JSON.stringify(script) },
    });

    return script;
  }

  private inferGoal(
    contact: any,
    invoices: any[],
    deals: any[],
    bookings: any[],
  ): string {
    const now = new Date();
    const hasOverdue = invoices.some(
      (i) =>
        i.status === 'OVERDUE' ||
        (i.dueDate && new Date(i.dueDate) < now && i.status !== 'PAID'),
    );
    if (hasOverdue) return 'Collect payment on overdue invoice';
    if (deals.length > 0) return 'Follow up on open deal';
    if (bookings.some((b) => b.status === 'PENDING'))
      return 'Confirm upcoming booking';
    if (!contact.lastInteractionAt) return 'Introduce yourself and understand needs';
    return 'Check in and maintain relationship';
  }
}
