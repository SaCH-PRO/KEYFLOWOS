import { Injectable, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { ConnectorCredentialsService } from '../connector-credentials.service';
import { ConnectorMeta } from '../connector.interface';
import { FormPlatformConnector } from './form-platform.base';

/**
 * Generic landing-page / webhook form connector. Any landing page builder or custom form can
 * POST to /webhooks/forms/:businessId/webhook_form with a normalized payload and the events
 * flow through the same pipeline as Typeform / Jotform.
 *
 * The frontend exposes the per-business webhook URL + secret via `/connectors/businesses/:id/webhook-info/webhook_form`.
 * The secret is auto-generated on first request, so the user just clicks "Copy URL" / "Copy secret".
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
    connectMode: 'webhook',
    connectInstructions:
      'Copy your unique webhook URL and secret. Configure your form builder (Webflow, Framer, custom HTML) to POST submissions to that URL with the secret in the "x-keyflow-signature" header.',
    credentialFields: [
      { key: 'webhookSecret', label: 'Webhook secret', type: 'password', secret: true, helpText: 'Auto-generated. Send this in the x-keyflow-signature header on every webhook POST.' },
    ],
  };
  protected readonly primaryCredentialKey = 'webhookSecret';
  protected readonly legacyCredentialKey = 'webhookFormSecret';
  protected readonly source = 'webhook_form';

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(EventEmitter2) events: EventEmitter2,
    @Inject(EntityResolutionService) entityResolution: EntityResolutionService,
    @Inject(ConnectorCredentialsService) credentials: ConnectorCredentialsService,
  ) {
    super(prisma, events, entityResolution, credentials);
  }
}
