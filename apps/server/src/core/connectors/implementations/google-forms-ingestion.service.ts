import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { GoogleTokenHelper } from '../../../modules/connect/google-token.helper';
import { KeyInboxService } from '../../../modules/key-inbox/key-inbox.service';
import type { ConnectorSyncResult } from '../connector.interface';
import type { CreateInboxMessageInput } from '../../../modules/key-inbox/key-inbox.types';

const FORMS_API_BASE = 'https://forms.googleapis.com/v1/forms';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3/files';

interface DriveFile {
  id: string;
  name: string;
  createdTime?: string;
  modifiedTime?: string;
  webViewLink?: string;
}

interface DriveFileList {
  files?: DriveFile[];
  nextPageToken?: string;
}

interface FormTextAnswer {
  value?: string;
}

interface FormAnswer {
  questionId?: string;
  textAnswers?: {
    answers?: FormTextAnswer[];
  };
}

interface FormResponse {
  responseId: string;
  createTime?: string;
  lastSubmittedTime?: string;
  respondentEmail?: string;
  answers?: Record<string, FormAnswer>;
}

interface FormResponseList {
  responses?: FormResponse[];
  nextPageToken?: string;
}

interface ExtractedContact {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
}

@Injectable()
export class GoogleFormsIngestionService {
  private readonly logger = new Logger(GoogleFormsIngestionService.name);
  private readonly tokenHelper: GoogleTokenHelper;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EntityResolutionService) private readonly entityResolution: EntityResolutionService,
    @Inject(KeyInboxService) private readonly keyInbox: KeyInboxService,
  ) {
    this.tokenHelper = new GoogleTokenHelper(this.prisma);
  }

  async syncForms(businessId: string): Promise<ConnectorSyncResult> {
    const start = Date.now();

    try {
      const formsToken = await this.tokenHelper.getValidAccessToken(
        businessId,
        { access: 'formsAccessToken', refresh: 'formsRefreshToken', expiry: 'formsTokenExpiry' },
        'Google Forms',
      );
      const driveToken = await this.tokenHelper.getValidAccessToken(
        businessId,
        { access: 'driveAccessToken', refresh: 'driveRefreshToken', expiry: 'driveTokenExpiry' },
        'Google Drive (Forms list)',
      );

      const forms = await this.listForms(driveToken);
      let ingested = 0;
      const errors: string[] = [];

      for (const form of forms) {
        try {
          const responses = await this.listResponses(formsToken, form.id);
          for (const response of responses) {
            try {
              const alreadyExists = await this.prisma.client.keyInboxMessage.findFirst({
                where: {
                  businessId,
                  channel: 'google_forms',
                  externalMessageId: response.responseId,
                },
              });
              if (alreadyExists) continue;

              const body = this.buildResponseBody(form.name, response);
              const contact = this.extractContact(response);

              let contactId: string | null = null;
              if (contact.email || contact.phone || contact.fullName) {
                const resolved = await this.entityResolution.resolveContact(businessId, {
                  source: 'google_forms',
                  email: contact.email,
                  phone: contact.phone,
                  firstName: contact.firstName,
                  lastName: contact.lastName,
                });
                contactId = resolved.contactId || null;
              }

              const thread = await this.keyInbox.upsertThread({
                businessId,
                channel: 'google_forms',
                externalThreadId: form.id,
                contactId,
                subject: form.name,
                status: 'OPEN',
                priority: 'NORMAL',
                metadata: {
                  source: 'google_forms',
                  formId: form.id,
                  formTitle: form.name,
                  formLink: form.webViewLink ?? null,
                },
              });

              const messageInput: CreateInboxMessageInput = {
                businessId,
                threadId: thread.id,
                channel: 'google_forms',
                direction: 'INBOUND',
                senderName: contact.fullName || contact.email || response.respondentEmail || null,
                senderHandle: response.respondentEmail || contact.email || null,
                senderEmail: response.respondentEmail || contact.email || null,
                senderPhone: contact.phone || null,
                contentText: body,
                contentHtml: null,
                externalMessageId: response.responseId,
                receivedAt: response.createTime ? new Date(response.createTime) : new Date(),
                sentAt: null,
                metadata: {
                  source: 'google_forms',
                  formId: form.id,
                  formTitle: form.name,
                  responseId: response.responseId,
                  answers: response.answers ?? {},
                },
              };

              await this.keyInbox.addMessage(messageInput);
              ingested += 1;
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              this.logger.warn(`Failed to ingest form response ${response.responseId} for ${businessId}: ${message}`);
              errors.push(`${form.id}/${response.responseId}: ${message}`);
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Failed to sync form ${form.id} for ${businessId}: ${message}`);
          errors.push(`${form.id}: ${message}`);
        }
      }

      await this.prisma.client.connectorStatus.upsert({
        where: { businessId_connectorType: { businessId, connectorType: 'google_forms' } },
        create: {
          businessId,
          connectorType: 'google_forms',
          status: 'connected',
          lastSyncAt: new Date(),
          syncCount: 1,
          intakeEnabled: true,
        },
        update: {
          status: 'connected',
          lastSyncAt: new Date(),
          syncCount: { increment: 1 },
          intakeEnabled: true,
          lastError: errors.length > 0 ? errors.slice(0, 3).join('; ') : null,
          lastErrorAt: errors.length > 0 ? new Date() : undefined,
        },
      });

      return {
        success: errors.length === 0,
        itemsSynced: ingested,
        errors,
        duration: Date.now() - start,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Google Forms ingestion failed for ${businessId}: ${message}`);

      await this.prisma.client.connectorStatus.upsert({
        where: { businessId_connectorType: { businessId, connectorType: 'google_forms' } },
        create: {
          businessId,
          connectorType: 'google_forms',
          status: 'error',
          lastError: message,
          lastErrorAt: new Date(),
          errorCount: 1,
        },
        update: {
          status: 'error',
          lastError: message,
          lastErrorAt: new Date(),
          errorCount: { increment: 1 },
        },
      });

      return {
        success: false,
        itemsSynced: 0,
        errors: [message],
        duration: Date.now() - start,
      };
    }
  }

  private async listForms(accessToken: string): Promise<DriveFile[]> {
    const forms: DriveFile[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        q: "mimeType='application/vnd.google-apps.form' and trashed=false",
        fields: 'nextPageToken,files(id,name,createdTime,modifiedTime,webViewLink)',
        orderBy: 'modifiedTime desc',
        pageSize: '50',
        ...(pageToken ? { pageToken } : {}),
      });
      const res = await fetch(`${DRIVE_API_BASE}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Drive forms list ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
      }
      const data = (await res.json()) as DriveFileList;
      for (const file of data.files ?? []) {
        forms.push(file);
      }
      pageToken = data.nextPageToken;
    } while (pageToken);

    return forms;
  }

  private async listResponses(accessToken: string, formId: string): Promise<FormResponse[]> {
    const responses: FormResponse[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        pageSize: '100',
        ...(pageToken ? { pageToken } : {}),
      });
      const res = await fetch(`${FORMS_API_BASE}/${encodeURIComponent(formId)}/responses?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Forms responses ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
      }
      const data = (await res.json()) as FormResponseList;
      for (const response of data.responses ?? []) {
        responses.push(response);
      }
      pageToken = data.nextPageToken;
    } while (pageToken);

    return responses;
  }

  private buildResponseBody(formTitle: string, response: FormResponse): string {
    const lines: string[] = [`Form submission: ${formTitle}`];
    if (response.respondentEmail) {
      lines.push(`Respondent: ${response.respondentEmail}`);
    }
    lines.push(`Submitted: ${response.createTime ? new Date(response.createTime).toISOString() : 'unknown'}`);
    lines.push('');

    const answers = response.answers ?? {};
    for (const [questionId, answer] of Object.entries(answers)) {
      const values = answer?.textAnswers?.answers?.map((a) => a.value).filter(Boolean) ?? [];
      lines.push(`Q: ${questionId}`);
      lines.push(`A: ${values.join(', ') || '(no answer)'}`);
      lines.push('');
    }

    return lines.join('\n').trim();
  }

  private extractContact(response: FormResponse): ExtractedContact {
    const result: ExtractedContact = {};

    if (response.respondentEmail) {
      result.email = response.respondentEmail;
    }

    const allValues: string[] = [];
    for (const answer of Object.values(response.answers ?? {})) {
      const values = answer?.textAnswers?.answers?.map((a) => a.value ?? '').filter(Boolean) ?? [];
      allValues.push(...values);
    }

    for (const value of allValues) {
      if (!result.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        result.email = value;
      }
      if (!result.phone && /[\d\s\-+().]{7,}/.test(value)) {
        const digits = value.replace(/\D/g, '');
        if (digits.length >= 7) {
          result.phone = value;
        }
      }
      if (!result.fullName && /^[A-Za-z]+(\s+[A-Za-z]+)+$/.test(value.trim())) {
        result.fullName = value.trim();
        const parts = result.fullName.split(/\s+/);
        result.firstName = parts[0];
        result.lastName = parts.slice(1).join(' ');
      }
    }

    return result;
  }
}
