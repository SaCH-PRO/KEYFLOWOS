import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { LEVEL_RANK, type CanonicalModule } from '../authority/module-vocabulary';
import { memberModuleLevel, type ModuleLevelActor } from '../auth/member-module-level';
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
  // SWEEP-P0-FOLLOWUP (WH3-1): an EMAIL / Gmail or WhatsApp channel connection's sending account receives every
  // message sent through it, with the recipient's address or phone (modules/communications/channel-audience.ts).
  channel_messaging: ['crm'],
  // FU-FINANCE-SETTINGS-SCOPE (V1-71): the accountant export's saved recipient (Business.accountantEmail) receives the
  // books ZIP whenever a member sends it without naming a `to` (the Reports and Tax pages prefill it): the P&L, balance
  // sheet, cash flow, aging, tax summary, trial balance, general ledger and audit log. POST
  // .../accountant-export/email, the route that builds it, needs revenue read (FOLLOW3-A6), so binding the address does.
  accountant_email: ['revenue'],
};

/** FU-FINANCE-SETTINGS-SCOPE: the export type the accountant export's saved recipient binds (assertMaySetExportDestination). */
export const ACCOUNTANT_EMAIL_EXPORT_TYPE = 'accountant_email';

/** The modules a connector's export carries, or null for a connector that exports nothing. */
export function connectorExportReads(type: string): readonly CanonicalModule[] | null {
  return Object.prototype.hasOwnProperty.call(CONNECTOR_EXPORT_READS, type) ? CONNECTOR_EXPORT_READS[type] : null;
}

/**
 * SWEEP-P0-FOLLOWUP repair (review COR-2): what the binding refusal calls an export account whose type name is internal,
 * and what it receives, in plain words ("connecting channel_messaging, which receives the business's crm records" was
 * what a settings admin renaming the sender read).
 */
const EXPORT_ACCOUNT_WORDS: Readonly<Record<string, { act?: string; account: string; receives: string }>> = {
  channel_messaging: { account: 'an email or WhatsApp sending account', receives: "the business's contacts" },
  // FU-FINANCE-SETTINGS-SCOPE: an address is saved, not connected.
  accountant_email: { act: 'saving', account: "the accountant's email address", receives: "the business's books (the accountant export)" },
};

/** What a binding refusal calls binding `type`'s account ("connecting ..., which receives ...,"). */
function exportBindingWhat(type: string, reads: readonly CanonicalModule[]): string {
  const words = Object.prototype.hasOwnProperty.call(EXPORT_ACCOUNT_WORDS, type) ? EXPORT_ACCOUNT_WORDS[type] : null;
  return words
    ? `${words.act ?? 'connecting'} ${words.account}, which receives ${words.receives},`
    : `connecting ${type}, which receives the business's ${reads.join(' and ')} records,`;
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
  await assertMayExport(prisma, businessId, actor, reads, exportBindingWhat(type, reads));
}

/**
 * FU-FINANCE-SETTINGS-SCOPE (V1-71): the export-binding rule SWEEP-P0-FOLLOWUP set (WH3-1: binding a destination that
 * receives the business's data needs read of that data beside settings admin), for a destination a route binds without a
 * settings-admin guard in front of it. The connector and channel binding routes carry settings admin on the route
 * (RequireModuleScope + ModuleScopeGuard) and call assertMayBindExport for the reads; POST
 * finance/.../accountant-export/email is open to every revenue reader (each sends the export to an address they name and
 * read everything sent) and only its saveRecipient binds a destination, Business.accountantEmail, so the check is made
 * here: settings admin, then the reads of what the destination receives (CONNECTOR_EXPORT_READS), both read as
 * ModuleScopeGuard reads them (memberModuleLevel: the explicit map, else the role defaults; a SUPER_ADMIN is admin) and
 * refused with the same shape (403 "Insufficient permissions: <what> needs <module> <level> access (you have <level>)").
 * The owner (every module admin by role default) and a platform SUPER_ADMIN pass, as they do there. A type with no reads
 * named is a programming error and refuses (fails closed).
 */
export async function assertMaySetExportDestination(
  prisma: PrismaService,
  businessId: string,
  actor: ModuleLevelActor,
  type: string,
): Promise<void> {
  const reads = connectorExportReads(type);
  if (!reads) throw new ForbiddenException(`No export rule is named for ${type}`);
  if (!actor?.id) throw new ForbiddenException('Authentication required');
  const what = exportBindingWhat(type, reads);
  const settings = await memberModuleLevel(prisma, businessId, actor, 'settings');
  if (LEVEL_RANK[settings] < LEVEL_RANK.admin) {
    throw new ForbiddenException(`Insufficient permissions: ${what} needs settings admin access (you have ${settings})`);
  }
  await assertMayExport(prisma, businessId, actor, reads, what);
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
