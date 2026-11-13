import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { CanonicalModule } from '../authority/module-vocabulary';
import type { ModuleLevelActor } from '../auth/member-module-level';
import { assertMayExport, receiverReadRefusal, type ExportAudience } from '../auth/receiver-reads';

/**
 * SWEEP-P0-SCOPES round 2 class repair (CLASS A; findings WHP-1, WHP-2): the connectors that send a
 * business's records to the account their stored credentials name, and the modules those records
 * belong to. The census spec pins it (CEN-11b): every connector class the export call graph finds
 * sending people or money rows out must be named here.
 *
 *   - quickbooks, xero: the accounting push (POST /accounting/.../invoices/push and /customers/push)
 *     sends each invoice's lines and amounts and each customer's name, email, company and phone;
 *   - mailchimp, klaviyo: the marketing push (POST /marketing/.../lists/push-contacts) sends each
 *     contact's email, name and (Klaviyo) phone;
 *   - outlook_contacts (round 3, WPH2-1): the Outlook contacts push (every contact.updated of a contact the
 *     sync linked) sends the contact's name, email, phone, company and job title to the Microsoft account
 *     whose consent was completed. Its binder is the member who started that consent (the signed state
 *     names them; MicrosoftOAuthController.buildAuthUrl checks these reads, the callback records them).
 *
 * The rule: the member who binds such an account (POST /connectors/.../credentials/:type) reads these
 * modules (assertMayBindExport), and is recorded as the account's receiver (ConnectorStatus
 * metadata.boundBy); a push needs the same reads of the member who sends it and of the recorded
 * receiver, and sends only the contacts both may open (exportAudience, contactIdsEveryReceiverMayOpen).
 */
export const CONNECTOR_EXPORT_READS: Readonly<Record<string, readonly CanonicalModule[]>> = {
  quickbooks: ['revenue', 'crm'],
  xero: ['revenue', 'crm'],
  mailchimp: ['crm'],
  klaviyo: ['crm'],
  outlook_contacts: ['crm'],
};

/** The modules a connector's export carries, or null for a connector that exports nothing. */
export function connectorExportReads(type: string): readonly CanonicalModule[] | null {
  return Object.prototype.hasOwnProperty.call(CONNECTOR_EXPORT_READS, type) ? CONNECTOR_EXPORT_READS[type] : null;
}

/** 403 unless the member binding `type`'s account reads what it exports (a connector that exports nothing: no rule). */
export async function assertMayBindExport(
  prisma: PrismaService,
  businessId: string,
  actor: ModuleLevelActor,
  type: string,
): Promise<void> {
  const reads = connectorExportReads(type);
  if (!reads) return;
  await assertMayExport(prisma, businessId, actor, reads, `connecting ${type}, which receives the business's ${reads.join(' and ')} records,`);
}

/**
 * Who receives what a push sends to `type`'s account: the member pushing and the member recorded as
 * the account's binder. The binder's reads are checked again now (an account keeps receiving after its
 * binder's access is narrowed otherwise); a binder who may no longer read them is a 403 naming why. An
 * account bound before binders were recorded has an unknown receiver (read as a non-owner).
 */
export async function exportAudience(
  prisma: PrismaService,
  businessId: string,
  type: string,
  pusher: ModuleLevelActor,
): Promise<ExportAudience> {
  const reads = connectorExportReads(type) ?? [];
  const row = await prisma.client.connectorStatus.findUnique({
    where: { businessId_connectorType: { businessId, connectorType: type as never } },
    select: { metadata: true },
  });
  const meta = row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? (row.metadata as Record<string, unknown>) : {};
  const binder = typeof meta.boundBy === 'string' && meta.boundBy ? meta.boundBy : null;
  const memberIds = [pusher?.id].filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (!binder) return { memberIds, unknownReceiver: true };
  const user = await prisma.client.user.findUnique({ where: { id: binder }, select: { role: true } });
  const refusal = await receiverReadRefusal(prisma, businessId, { id: binder, role: user?.role ?? undefined }, reads, `the ${type} account this push sends to`);
  if (refusal) {
    throw new ForbiddenException(
      `The ${type} account was connected by a member who may no longer read what it receives (${refusal.replace(/^Insufficient permissions: /, '')}); a settings admin who reads it must connect it again`,
    );
  }
  return { memberIds: [...memberIds, binder], unknownReceiver: false };
}
