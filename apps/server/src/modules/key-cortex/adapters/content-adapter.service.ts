import { Injectable } from '@nestjs/common';
import { ConnectorCommand, ConnectorResult } from '../key-cortex-connector.types';
import { connectorOk, connectorFail } from '../key-cortex-connector.utils';
import { ContentService } from '../../content/content.service';

/**
 * Typed adapter that exposes the content methods expected by
 * KeyCortexConnectorService.  Delegates to ContentService; also provides the
 * social-media execution surface because social actions are currently routed
 * through the content module.
 */
@Injectable()
export class ContentAdapterService {
  constructor(private readonly content: ContentService) {}

  async execute(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'create_post': {
        const post = await this.content.createPost({
          businessId: command.businessId,
          title: command.parameters.title as string,
          body: command.parameters.body as string,
          platform: (command.parameters.platform as string) || 'blog',
          status: (command.parameters.status as string) || 'draft',
          scheduledAt: command.parameters.scheduledAt as string,
          tags: command.parameters.tags as string[],
          seoTitle: command.parameters.seoTitle as string,
          seoDescription: command.parameters.seoDescription as string,
        });
        return connectorOk(command, start, post);
      }
      case 'schedule_post': {
        const scheduled = await this.content.schedulePost({
          businessId: command.businessId,
          postId: command.parameters.postId as string,
          scheduledAt: command.parameters.scheduledAt as string,
          platform: command.parameters.platform as string,
        });
        return connectorOk(command, start, scheduled);
      }
      case 'publish_post': {
        const published = await this.content.publishPost({
          businessId: command.businessId,
          postId: command.parameters.postId as string,
        });
        return connectorOk(command, start, published);
      }
      case 'create_campaign': {
        const campaign = await this.content.createCampaign({
          businessId: command.businessId,
          name: command.parameters.name as string,
          subject: command.parameters.subject as string,
          body: command.parameters.body as string,
          segment: command.parameters.segment as string,
          scheduledAt: command.parameters.scheduledAt as string,
        });
        return connectorOk(command, start, campaign);
      }
      case 'send_campaign': {
        const sent = await this.content.sendCampaign({
          businessId: command.businessId,
          campaignId: command.parameters.campaignId as string,
          testOnly: (command.parameters.testOnly as boolean) || false,
        });
        return connectorOk(command, start, sent);
      }
      case 'generate_content': {
        const generated = await this.content.generateContent({
          businessId: command.businessId,
          topic: command.parameters.topic as string,
          platform: command.parameters.platform as string,
          tone: (command.parameters.tone as string) || 'professional',
          length: (command.parameters.length as string) || 'medium',
        });
        return connectorOk(command, start, generated);
      }
      case 'update_post': {
        const updated = await this.content.updatePost({
          businessId: command.businessId,
          postId: command.parameters.postId as string,
          title: command.parameters.title as string,
          body: command.parameters.body as string,
          status: command.parameters.status as string,
        });
        return connectorOk(command, start, updated);
      }
      case 'delete_post': {
        await this.content.deletePost({
          businessId: command.businessId,
          postId: command.parameters.postId as string,
        });
        return connectorOk(command, start, { deleted: true });
      }
      default:
        return connectorFail(command, start, `Unknown content action: ${command.action}`);
    }
  }

  async getDrafts(input: { businessId: string; limit?: number }) {
    return this.content.getDrafts(input);
  }

  async getScheduledPosts(input: { businessId: string; from?: string; limit?: number }) {
    return this.content.getScheduledPosts(input);
  }
}
