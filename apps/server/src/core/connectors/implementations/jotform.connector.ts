import { Injectable, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { ConnectorMeta } from '../connector.interface';
import { FormPlatformConnector } from './form-platform.base';

@Injectable()
export class JotformConnector extends FormPlatformConnector {
  readonly meta: ConnectorMeta = {
    type: 'jotform',
    name: 'Jotform',
    description: 'Capture Jotform submissions as CRM leads',
    category: 'forms',
    group: 'forms',
    icon: 'clipboard',
    supportsSync: true,
    supportsWebhook: true,
    authType: 'api_key',
  };
  protected readonly credentialKey = 'jotformApiKey';
  protected readonly source = 'jotform';

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(EventEmitter2) events: EventEmitter2,
    @Inject(EntityResolutionService) entityResolution: EntityResolutionService,
  ) {
    super(prisma, events, entityResolution);
  }
}
