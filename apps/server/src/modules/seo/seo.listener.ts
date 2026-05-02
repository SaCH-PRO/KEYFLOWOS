import { Injectable, Logger, Inject } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  SeoRankingDropPayload,
  SeoIssueDetectedPayload,
  SeoContentBriefCreatedPayload,
} from '../../core/event-bus/events.types';

@Injectable()
export class SeoListener {
  private readonly logger = new Logger(SeoListener.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @OnEvent('seo.ranking_drop')
  async onRankingDrop(payload: SeoRankingDropPayload) {
    try {
      const drop = (payload.previousPosition ?? 0) - payload.currentPosition;
      const priority = drop < -10 ? 'URGENT' : drop < -5 ? 'HIGH' : 'NORMAL';

      await this.prisma.client.autopilotTask.create({
        data: {
          businessId: payload.businessId,
          title: `Keyword "${payload.keyword}" dropped to position ${payload.currentPosition}`,
          description: `This keyword previously ranked at position ${payload.previousPosition} but is now at ${payload.currentPosition}. Investigate the affected page and consider refreshing content or building backlinks.`,
          category: 'MARKETING',
          priority,
          status: 'PENDING',
          relatedType: 'SEO_KEYWORD',
          relatedId: payload.keywordId,
          aiContext: {
            keyword: payload.keyword,
            previousPosition: payload.previousPosition,
            currentPosition: payload.currentPosition,
            source: 'seo.ranking_drop',
          },
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to create task from ranking drop: ${(err as Error).message}`);
    }
  }

  @OnEvent('seo.issue_detected')
  async onIssueDetected(payload: SeoIssueDetectedPayload) {
    if (payload.severity !== 'critical' && payload.severity !== 'high') return;

    try {
      await this.prisma.client.autopilotTask.create({
        data: {
          businessId: payload.businessId,
          title: `SEO issue: ${payload.title}`,
          description: `A ${payload.severity}-severity SEO issue was detected: ${payload.issueType}.`,
          category: 'MARKETING',
          priority: payload.severity === 'critical' ? 'URGENT' : 'HIGH',
          status: 'PENDING',
          relatedType: 'SEO_ISSUE',
          relatedId: payload.issueId,
          aiContext: {
            issueType: payload.issueType,
            severity: payload.severity,
            source: 'seo.issue_detected',
          },
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to create task from SEO issue: ${(err as Error).message}`);
    }
  }

  @OnEvent('seo.content_brief_created')
  async onContentBriefCreated(payload: SeoContentBriefCreatedPayload) {
    try {
      await this.prisma.client.autopilotTask.create({
        data: {
          businessId: payload.businessId,
          title: `Write content: ${payload.title}`,
          description: `A content brief has been generated for the keyword "${payload.targetKeyword}". Review the brief and write the content.`,
          category: 'MARKETING',
          priority: 'NORMAL',
          status: 'PENDING',
          requiresApproval: true,
          relatedType: 'CONTENT_BRIEF',
          relatedId: payload.briefId,
          aiContext: {
            targetKeyword: payload.targetKeyword,
            source: 'seo.content_brief_created',
          },
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to create task from content brief: ${(err as Error).message}`);
    }
  }
}
