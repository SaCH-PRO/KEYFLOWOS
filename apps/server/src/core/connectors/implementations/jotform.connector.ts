import { Injectable, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { ConnectorCredentialsService } from '../connector-credentials.service';
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
    connectMode: 'dialog',
    connectInstructions:
      'In Jotform: My Account → API → create a key (Read access). Then add a webhook on each form pointing at the URL shown after saving and use the secret in the "Secret" field.',
    credentialFields: [
      { key: 'apiKey', label: 'API key', type: 'password', required: true, secret: true },
      { key: 'webhookSecret', label: 'Webhook secret (for signature)', type: 'password', secret: true, helpText: 'Auto-generated. Paste this when configuring the webhook in Jotform.' },
    ],
  };
  protected readonly primaryCredentialKey = 'apiKey';
  protected readonly legacyCredentialKey = 'jotformApiKey';
  protected readonly source = 'jotform';

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(EventEmitter2) events: EventEmitter2,
    @Inject(EntityResolutionService) entityResolution: EntityResolutionService,
    @Inject(ConnectorCredentialsService) credentials: ConnectorCredentialsService,
  ) {
    super(prisma, events, entityResolution, credentials);
  }
}
