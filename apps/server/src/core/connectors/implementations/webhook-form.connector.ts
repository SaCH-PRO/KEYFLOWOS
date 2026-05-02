import { Injectable, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { ConnectorMeta } from '../connector.interface';
import { FormPlatformConnector } from './form-platform.base';

/**
 * Generic landing-page / webhook form connector. Any landing page builder or custom form can
 * POST to /webhooks/forms/:businessId with a normalized payload and the events flow through
 * the same pipeline as Typeform / Jotform.
 */
@Injectable()
export class WebhookFormConnector extends FormPlatformConnector {
  readonly meta: ConnectorMeta = {
    type: 'webhook_form',
    name: 'Webhook Forms',
    description: 'Generic webhook ingest for landing pages and custom forms',
    category: 'forms',
    group: 'forms',
    icon: 'webhook',
    supportsSync: false,
    supportsWebhook: true,
    authType: 'api_key',
  };
  protected readonly credentialKey = 'webhookFormSecret';
  protected readonly source = 'webhook_form';

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(EventEmitter2) events: EventEmitter2,
    @Inject(EntityResolutionService) entityResolution: EntityResolutionService,
  ) {
    super(prisma, events, entityResolution);
  }
}
