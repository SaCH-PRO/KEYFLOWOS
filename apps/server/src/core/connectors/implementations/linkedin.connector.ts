import { Injectable, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { ConnectorMeta } from '../connector.interface';
import { SocialPlatformConnector } from './social-platform.base';

@Injectable()
export class LinkedInConnector extends SocialPlatformConnector {
  readonly meta: ConnectorMeta = {
    type: 'linkedin',
    name: 'LinkedIn',
    description: 'Schedule posts, track engagement, and sync messages with LinkedIn',
    category: 'social',
    group: 'social',
    icon: 'linkedin',
    supportsSync: true,
    supportsWebhook: true,
    authType: 'oauth2',
  };
  protected readonly platformKey = 'LINKEDIN';

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(EventEmitter2) events: EventEmitter2,
    @Inject(EntityResolutionService) entityResolution: EntityResolutionService,
  ) {
    super(prisma, events, entityResolution);
  }
}
