import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ConnectorCommand, ConnectorResult } from '../key-cortex-connector.types';
import { connectorOk, connectorFail } from '../key-cortex-connector.utils';
import {
  CommunicationsService,
  SendMessageInput,
  SendBroadcastInput,
  SendReplyInput,
  ConversationInput,
  GetConversationInput,
  CreateTemplateInput,
  DeleteTemplateInput,
} from '../../communications/communications.service';

/**
 * Typed adapter that exposes the communications methods expected by
 * KeyCortexConnectorService.  All methods delegate directly to
 * CommunicationsService; this adapter exists only to remove the
 * `(this.communications as any)` cast used by getFullContext.
 */
@Injectable()
export class CommunicationsAdapterService {
  constructor(@Inject(forwardRef(() => CommunicationsService)) private readonly communications: CommunicationsService) {}

  async sendMessage(input: SendMessageInput) {
    return this.communications.sendMessage(input);
  }

  async sendWhatsapp(input: Omit<SendMessageInput, 'channel' | 'subject'>) {
    return this.communications.sendWhatsapp(input);
  }

  async sendEmail(input: Omit<SendMessageInput, 'channel'>) {
    return this.communications.sendEmail(input);
  }

  async createTemplate(input: CreateTemplateInput) {
    return this.communications.createTemplate(input);
  }

  async getConversation(input: GetConversationInput) {
    return this.communications.getConversation(input);
  }

  async sendBroadcast(input: SendBroadcastInput) {
    return this.communications.sendBroadcast(input);
  }

  async markRead(input: ConversationInput) {
    return this.communications.markRead(input);
  }

  async archiveConversation(input: ConversationInput) {
    return this.communications.archiveConversation(input);
  }

  async sendReply(input: SendReplyInput) {
    return this.communications.sendReply(input);
  }

  async deleteTemplate(input: DeleteTemplateInput) {
    return this.communications.deleteTemplate(input);
  }

  async getUnreadConversations(input: { businessId: string; limit?: number }) {
    return this.communications.getUnreadConversations(input);
  }

  async execute(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'send_message': {
        const msg = await this.sendMessage({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          channel: command.parameters.channel as 'email' | 'sms' | 'whatsapp',
          body: command.parameters.body as string,
          templateId: command.parameters.templateId as string,
          attachments: command.parameters.attachments as string[],
          scheduledAt: command.parameters.scheduledAt as string,
        });
        return connectorOk(command, start, msg);
      }
      case 'send_whatsapp': {
        const wa = await this.sendWhatsapp({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          body: command.parameters.body as string,
          templateId: command.parameters.templateId as string,
        });
        return connectorOk(command, start, wa);
      }
      case 'send_email': {
        const email = await this.sendEmail({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          subject: command.parameters.subject as string,
          body: command.parameters.body as string,
          attachments: command.parameters.attachments as string[],
        });
        return connectorOk(command, start, email);
      }
      case 'create_template': {
        const template = await this.createTemplate({
          businessId: command.businessId,
          name: command.parameters.name as string,
          channel: command.parameters.channel as string,
          subject: command.parameters.subject as string,
          body: command.parameters.body as string,
          variables: command.parameters.variables as string[],
        });
        return connectorOk(command, start, template);
      }
      case 'get_conversation': {
        const conv = await this.getConversation({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          channel: (command.parameters.channel as 'email' | 'sms' | 'whatsapp' | undefined) || 'all',
          limit: (command.parameters.limit as number) || 50,
        });
        return connectorOk(command, start, conv);
      }
      case 'send_broadcast': {
        const broadcast = await this.sendBroadcast({
          businessId: command.businessId,
          segment: command.parameters.segment as string,
          channel: command.parameters.channel as 'email' | 'sms' | 'whatsapp',
          body: command.parameters.body as string,
          templateId: command.parameters.templateId as string,
        });
        return connectorOk(command, start, broadcast);
      }
      case 'mark_read': {
        const marked = await this.markRead({
          businessId: command.businessId,
          conversationId: command.parameters.conversationId as string,
        });
        return connectorOk(command, start, marked);
      }
      case 'archive_conversation': {
        const archived = await this.archiveConversation({
          businessId: command.businessId,
          conversationId: command.parameters.conversationId as string,
        });
        return connectorOk(command, start, archived);
      }
      case 'send_reply': {
        const reply = await this.sendReply({
          businessId: command.businessId,
          conversationId: command.parameters.conversationId as string,
          body: command.parameters.body as string,
          attachments: command.parameters.attachments as string[],
        });
        return connectorOk(command, start, reply);
      }
      case 'delete_template': {
        await this.deleteTemplate({
          businessId: command.businessId,
          templateId: command.parameters.templateId as string,
        });
        return connectorOk(command, start, { deleted: true });
      }
      default:
        return connectorFail(command, start, `Unknown communications action: ${command.action}`);
    }
  }
}
