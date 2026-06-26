import { Injectable, Logger } from '@nestjs/common';

/**
 * Communications stub service.
 *
 * Provides a compatibility surface for the KEY Cortex universal connector while
 * the communications module is being hardened with full typed adapters.  This
 * service is intentionally thin; it simply satisfies the dependency graph and
 * returns empty results for connector-driven calls.
 */
@Injectable()
export class CommunicationsService {
  private readonly logger = new Logger(CommunicationsService.name);

  async sendMessage(...args: any[]): Promise<any> {
    this.logger.warn('sendMessage stub called', args);
    return {};
  }
  async sendWhatsapp(...args: any[]): Promise<any> {
    this.logger.warn('sendWhatsapp stub called', args);
    return {};
  }
  async sendEmail(...args: any[]): Promise<any> {
    this.logger.warn('sendEmail stub called', args);
    return {};
  }
  async createTemplate(...args: any[]): Promise<any> {
    this.logger.warn('createTemplate stub called', args);
    return {};
  }
  async getConversation(...args: any[]): Promise<any> {
    this.logger.warn('getConversation stub called', args);
    return {};
  }
  async sendBroadcast(...args: any[]): Promise<any> {
    this.logger.warn('sendBroadcast stub called', args);
    return {};
  }
  async markRead(...args: any[]): Promise<any> {
    this.logger.warn('markRead stub called', args);
    return {};
  }
  async archiveConversation(...args: any[]): Promise<any> {
    this.logger.warn('archiveConversation stub called', args);
    return {};
  }
  async sendReply(...args: any[]): Promise<any> {
    this.logger.warn('sendReply stub called', args);
    return {};
  }
  async deleteTemplate(...args: any[]): Promise<any> {
    this.logger.warn('deleteTemplate stub called', args);
    return {};
  }
  async getUnreadConversations(...args: any[]): Promise<any> {
    this.logger.warn('getUnreadConversations stub called', args);
    return [];
  }
}
