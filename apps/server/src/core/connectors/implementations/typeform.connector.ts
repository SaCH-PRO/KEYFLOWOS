import { Injectable, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { ConnectorCredentialsService } from '../connector-credentials.service';
import { ConnectorMeta, ConnectorSmokeResult } from '../connector.interface';
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
    connectMode: 'dialog',
    externalUrl: 'https://admin.typeform.com/',
    connectInstructions:
      'In Typeform: Workspace → Settings → Personal tokens — generate a token. Then create a webhook on each form pointing at the URL shown after saving and use the secret in the "Secret" field.',
    credentialFields: [
      { key: 'apiKey', label: 'Personal access token', type: 'password', required: true, secret: true, placeholder: 'tfp_xxxxxxxxxxxxxxxx' },
      { key: 'webhookSecret', label: 'Webhook secret (for signature)', type: 'password', secret: true, helpText: 'Auto-generated. Paste this when configuring the webhook in Typeform.' },
    ],
  };
  protected readonly primaryCredentialKey = 'apiKey';
  protected readonly legacyCredentialKey = 'typeformApiKey';
  protected readonly source = 'typeform';

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(EventEmitter2) events: EventEmitter2,
    @Inject(EntityResolutionService) entityResolution: EntityResolutionService,
    @Inject(ConnectorCredentialsService) credentials: ConnectorCredentialsService,
  ) {
    super(prisma, events, entityResolution, credentials);
  }

  protected async pingProvider(token: string): Promise<ConnectorSmokeResult> {
    const meRes = await fetch('https://api.typeform.com/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!meRes.ok) {
      const body = await meRes.text().catch(() => '');
      return { success: false, error: `Typeform /me ${meRes.status}${body ? `: ${body}` : ''}` };
    }
    const me = (await meRes.json()) as { alias?: string; email?: string };
    const formsRes = await fetch('https://api.typeform.com/forms?page_size=1', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!formsRes.ok) {
      const body = await formsRes.text().catch(() => '');
      return { success: false, error: `Typeform /forms ${formsRes.status}${body ? `: ${body}` : ''}` };
    }
    const forms = (await formsRes.json()) as { total_items?: number; page_count?: number };
    return {
      success: true,
      action: 'Listed Typeform forms',
      account: me.email ?? me.alias ?? 'Typeform Account',
      detail: `${forms.total_items ?? 0} form(s)`,
    };
  }
}
