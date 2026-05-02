import { Injectable, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { ConnectorMeta } from '../connector.interface';
import { FormPlatformConnector } from './form-platform.base';

@Injectable()
export class TypeformConnector extends FormPlatformConnector {
  readonly meta: ConnectorMeta = {
    type: 'typeform',
    name: 'Typeform',
    description: 'Capture Typeform submissions as CRM leads',
    category: 'forms',
    group: 'forms',
    icon: 'file-text',
    supportsSync: true,
    supportsWebhook: true,
    authType: 'api_key',
  };
  protected readonly credentialKey = 'typeformApiKey';
  protected readonly source = 'typeform';

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(EventEmitter2) events: EventEmitter2,
    @Inject(EntityResolutionService) entityResolution: EntityResolutionService,
  ) {
    super(prisma, events, entityResolution);
  }
}
