import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ConnectorRegistryService } from './connector-registry.service';
import { ConnectorCredentialsService } from './connector-credentials.service';
import { TypeformConnector, JotformConnector, WebhookFormConnector } from './implementations';
import type { ConnectorType } from './connector.interface';
import type { FormPlatformConnector } from './implementations/form-platform.base';

const ALLOWED: ConnectorType[] = ['typeform', 'jotform', 'webhook_form'];

interface FormSubmissionPayload {
  formId?: string;
  formName?: string;
  externalId?: string;
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  fields?: Record<string, unknown>;
  data?: Record<string, unknown>;
  submittedAt?: string;
}

/**
 * Public webhook ingestion endpoint for the form connectors. Each business gets a
 * unique URL of the form `/webhooks/forms/:businessId/:type`, paired with an HMAC
 * secret stored in `ConnectorStatus.metadata`. Inbound POSTs must include the secret
 * in the `x-keyflow-signature` header.
 *
 * Typeform / Jotform's native webhook formats are normalized into the connector's
 * `ingestSubmission` contract so they emit the same `form.submitted` /
 * `lead_form.submitted` events as the rest of the platform.
 */
@Controller('webhooks/forms')
export class FormWebhookController {
  private readonly logger = new Logger(FormWebhookController.name);

  constructor(
    @Inject(ConnectorRegistryService) private readonly registry: ConnectorRegistryService,
    @Inject(ConnectorCredentialsService) private readonly credentials: ConnectorCredentialsService,
  ) {}

  @Post(':businessId/:type')
  async ingest(
    @Param('businessId') businessId: string,
    @Param('type') type: string,
    @Headers('x-keyflow-signature') signature: string | undefined,
    @Body() body: unknown,
  ) {
    if (!ALLOWED.includes(type as ConnectorType)) {
      throw new NotFoundException(`Webhook ingest not supported for ${type}`);
    }
    const connector = this.registry.get(type as ConnectorType) as
      | TypeformConnector
      | JotformConnector
      | WebhookFormConnector
      | null;
    if (!connector) throw new NotFoundException(`Connector ${type} not found`);

    const stored = (await this.credentials.getCredentials(businessId, type as ConnectorType)) ?? {};
    const expected = stored.webhookSecret;
    if (!expected) {
      throw new ForbiddenException('Webhook secret not configured. Visit Settings → Connectors to set up.');
    }
    if (!signature || signature !== expected) {
      throw new ForbiddenException('Invalid webhook signature');
    }

    const normalized = normalize(type as ConnectorType, body);
    if (!normalized.formId) {
      throw new BadRequestException('Submission is missing a form identifier');
    }

    const formConnector = connector as unknown as FormPlatformConnector;
    const result = await formConnector.ingestSubmission(businessId, {
      formId: normalized.formId,
      formName: normalized.formName,
      externalId: normalized.externalId,
      email: normalized.email,
      phone: normalized.phone,
      firstName: normalized.firstName,
      lastName: normalized.lastName,
      fields: normalized.fields ?? {},
      submittedAt: normalized.submittedAt ? new Date(normalized.submittedAt) : undefined,
    });

    this.logger.log(`Form webhook ingested for business=${businessId} type=${type} formId=${normalized.formId}`);
    return { success: true, contactId: result.contactId };
  }
}

function normalize(type: ConnectorType, body: unknown): FormSubmissionPayload {
  const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;

  if (type === 'typeform') {
    const event = raw.form_response as Record<string, unknown> | undefined;
    if (!event) {
      return passthrough(raw);
    }
    const definition = event.definition as Record<string, unknown> | undefined;
    const answers = (event.answers as Array<Record<string, unknown>> | undefined) ?? [];
    const fields: Record<string, unknown> = {};
    let email: string | undefined;
    let phone: string | undefined;
    let firstName: string | undefined;
    let lastName: string | undefined;
    for (const ans of answers) {
      const field = (ans.field as Record<string, unknown> | undefined) ?? {};
      const ref = (field.ref as string | undefined) ?? (field.id as string | undefined) ?? 'answer';
      const value = ans.text ?? ans.email ?? ans.phone_number ?? ans.number ?? ans.choice ?? ans.choices ?? ans.boolean ?? ans.date ?? null;
      fields[ref] = value;
      if (!email && typeof ans.email === 'string') email = ans.email;
      if (!phone && typeof ans.phone_number === 'string') phone = ans.phone_number;
      if (typeof ans.text === 'string') {
        if (/first[_-]?name/i.test(ref) && !firstName) firstName = ans.text as string;
        if (/last[_-]?name/i.test(ref) && !lastName) lastName = ans.text as string;
      }
    }
    return {
      formId: (definition?.id as string | undefined) ?? (event.form_id as string | undefined) ?? 'typeform',
      formName: definition?.title as string | undefined,
      externalId: event.token as string | undefined,
      email,
      phone,
      firstName,
      lastName,
      fields,
      submittedAt: event.submitted_at as string | undefined,
    };
  }

  if (type === 'jotform') {
    const fields: Record<string, unknown> = {};
    let email: string | undefined;
    let phone: string | undefined;
    let firstName: string | undefined;
    let lastName: string | undefined;
    const rawRequest = raw.rawRequest;
    let parsed: Record<string, unknown> = {};
    if (typeof rawRequest === 'string') {
      try {
        parsed = JSON.parse(rawRequest) as Record<string, unknown>;
      } catch {
        parsed = {};
      }
    } else if (typeof rawRequest === 'object' && rawRequest !== null) {
      parsed = rawRequest as Record<string, unknown>;
    }
    for (const [k, v] of Object.entries(parsed)) {
      fields[k] = v;
      const sv = typeof v === 'string' ? v : '';
      if (!email && /email/i.test(k) && /@/.test(sv)) email = sv;
      if (!phone && /phone/i.test(k) && sv) phone = sv;
      if (!firstName && /(first|fname|name_first)/i.test(k) && sv) firstName = sv;
      if (!lastName && /(last|lname|name_last)/i.test(k) && sv) lastName = sv;
      if (typeof v === 'object' && v !== null) {
        const obj = v as Record<string, unknown>;
        if (!firstName && typeof obj.first === 'string') firstName = obj.first as string;
        if (!lastName && typeof obj.last === 'string') lastName = obj.last as string;
      }
    }
    return {
      formId: (raw.formID as string | undefined) ?? (raw.formId as string | undefined) ?? 'jotform',
      formName: raw.formTitle as string | undefined,
      externalId: raw.submissionID as string | undefined,
      email,
      phone,
      firstName,
      lastName,
      fields,
    };
  }

  return passthrough(raw);
}

function passthrough(raw: Record<string, unknown>): FormSubmissionPayload {
  const fields = (raw.fields ?? raw.data ?? raw) as Record<string, unknown>;
  return {
    formId: (raw.formId as string | undefined) ?? (raw.form_id as string | undefined) ?? 'webhook_form',
    formName: raw.formName as string | undefined,
    externalId: (raw.externalId as string | undefined) ?? (raw.id as string | undefined),
    email: (raw.email as string | undefined) ?? (fields?.email as string | undefined),
    phone: (raw.phone as string | undefined) ?? (fields?.phone as string | undefined),
    firstName: (raw.firstName as string | undefined) ?? (fields?.firstName as string | undefined),
    lastName: (raw.lastName as string | undefined) ?? (fields?.lastName as string | undefined),
    fields,
    submittedAt: raw.submittedAt as string | undefined,
  };
}
