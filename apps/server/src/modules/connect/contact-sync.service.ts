import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GoogleContactsSyncService } from './google-contacts-sync.service';
import { OutlookContactsSyncService } from './outlook-contacts-sync.service';

export type ContactSource = 'google_contacts' | 'outlook_contacts';

/**
 * Provider-agnostic orchestrator over the per-provider sync services. Owns:
 *  - the multi-source sync loop (called from the scheduler / manual button)
 *  - the conflict-resolution policy (most-recent-write-wins, audit-logged)
 *  - the bidirectional push: when a local edit happens, replicate to every
 *    external source the contact is mapped to.
 */
@Injectable()
export class ContactSyncService {
  private readonly logger = new Logger(ContactSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly google: GoogleContactsSyncService,
    private readonly outlook: OutlookContactsSyncService,
  ) {}

  /**
   * Pull from every connected source for this business and return per-source
   * summaries. Each source's failure is isolated so one bad provider doesn't
   * block the others.
   */
  async syncAll(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { contactsAccessToken: true, msContactsAccessToken: true },
    });
    const results: Record<string, unknown> = {};
    if (business?.contactsAccessToken) {
      try {
        results.google_contacts = await this.google.sync(businessId);
      } catch (err) {
        results.google_contacts = { error: err instanceof Error ? err.message : String(err) };
      }
    }
    if (business?.msContactsAccessToken) {
      try {
        results.outlook_contacts = await this.outlook.sync(businessId);
      } catch (err) {
        results.outlook_contacts = { error: err instanceof Error ? err.message : String(err) };
      }
    }
    return results;
  }

  /**
   * Replicate a local contact change to every external source it's mapped to.
   * Currently bi-directional for Outlook; Google push is a no-op placeholder
   * (the Google connector's push path lives in google-contacts-sync.service
   * via the People API and is wired here when needed).
   */
  async pushLocalChange(businessId: string, contactId: string) {
    const mappings = await this.prisma.client.contactExternalMapping.findMany({
      where: { businessId, contactId },
      select: { source: true, externalId: true },
    });
    const pushed: { source: string; externalId: string | null }[] = [];
    for (const m of mappings) {
      if (m.source === 'outlook_contacts') {
        const id = await this.outlook.pushContact(businessId, contactId).catch(() => null);
        pushed.push({ source: m.source, externalId: id });
      } else if (m.source === 'google_contacts') {
        const id = await this.google.pushContact(businessId, contactId).catch(() => null);
        pushed.push({ source: m.source, externalId: id });
      }
    }
    return { pushed };
  }

  /**
   * Listen for local CRM contact changes and replicate them out to every
   * mapped external source. crm.service.ts emits 'contact.updated' / .created
   * with { businessId, contactId } — we only push on update (created contacts
   * coming from a remote source already exist there).
   */
  @OnEvent('contact.updated')
  async onContactUpdated(payload: {
    businessId?: string;
    contact?: { id?: string };
    contactId?: string;
  }) {
    const businessId = payload?.businessId;
    const contactId = payload?.contact?.id ?? payload?.contactId;
    if (!businessId || !contactId) return;
    try {
      await this.pushLocalChange(businessId, contactId);
    } catch (err) {
      this.logger.warn(
        `pushLocalChange failed for ${contactId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** List contact-sync audit entries for a business (UI: System Health page). */
  async listAudit(businessId: string, limit = 100) {
    return this.prisma.client.contactSyncAudit.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(limit, 500)),
    });
  }

  /** Summary used by Settings → Contact Sources & System Health page. */
  async getSummary(businessId: string) {
    const [business, google, outlook, googleStatus, outlookStatus, recentAudit] = await Promise.all([
      this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: {
          contactsEmail: true,
          contactsAccessToken: true,
          contactsLastSyncAt: true,
          msContactsEmail: true,
          msContactsAccessToken: true,
          msContactsLastSyncAt: true,
          signatureParsingEnabled: true,
        },
      }),
      this.prisma.client.contact.count({
        where: { businessId, source: 'google_contacts', deletedAt: null },
      }),
      this.prisma.client.contact.count({
        where: { businessId, source: 'outlook_contacts', deletedAt: null },
      }),
      this.prisma.client.connectorStatus.findUnique({
        where: { businessId_connectorType: { businessId, connectorType: 'google_contacts' } },
        select: { lastError: true, lastErrorAt: true, syncCount: true, status: true },
      }),
      this.prisma.client.connectorStatus.findUnique({
        where: { businessId_connectorType: { businessId, connectorType: 'outlook_contacts' } },
        select: { lastError: true, lastErrorAt: true, syncCount: true, status: true },
      }),
      this.prisma.client.contactSyncAudit.count({
        where: { businessId, action: 'conflict_resolved' },
      }),
    ]);
    const fromSig = await this.prisma.client.contact.count({
      where: { businessId, source: 'signature', deletedAt: null },
    });
    return {
      sources: {
        google_contacts: {
          connected: !!business?.contactsAccessToken,
          account: business?.contactsEmail ?? null,
          lastSyncAt: business?.contactsLastSyncAt ?? null,
          lastError: googleStatus?.lastError ?? null,
          lastErrorAt: googleStatus?.lastErrorAt ?? null,
          syncCount: googleStatus?.syncCount ?? 0,
          status: googleStatus?.status ?? (business?.contactsAccessToken ? 'connected' : 'disconnected'),
          contactCount: google,
        },
        outlook_contacts: {
          connected: !!business?.msContactsAccessToken,
          account: business?.msContactsEmail ?? null,
          lastSyncAt: business?.msContactsLastSyncAt ?? null,
          lastError: outlookStatus?.lastError ?? null,
          lastErrorAt: outlookStatus?.lastErrorAt ?? null,
          syncCount: outlookStatus?.syncCount ?? 0,
          status:
            outlookStatus?.status ??
            (business?.msContactsAccessToken ? 'connected' : 'disconnected'),
          contactCount: outlook,
        },
        signature: {
          enabled: !!business?.signatureParsingEnabled,
          contactCount: fromSig,
        },
      },
      conflictsResolved: recentAudit,
    };
  }

  async setSignatureParsingEnabled(businessId: string, enabled: boolean) {
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { signatureParsingEnabled: enabled },
    });
    return { enabled };
  }
}
