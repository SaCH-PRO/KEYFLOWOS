import { Injectable } from '@nestjs/common';
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
  constructor(private readonly communications: CommunicationsService) {}

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
}
