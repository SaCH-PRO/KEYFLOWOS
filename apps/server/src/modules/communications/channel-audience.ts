import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { ModuleLevelActor } from '../../core/auth/member-module-level';
import { assertMayExport, contactIdsEveryReceiverMayOpen, receiverReadRefusal } from '../../core/auth/receiver-reads';

/**
 * SWEEP-P0-FOLLOWUP (round 3 recheck WH3-1, CLASS A): a send through a messaging channel connection is an export of
 * the business's contacts to the account the connection names.
 *
 * The sending account of an EMAIL / Gmail or WhatsApp channel connection is the mailbox or WhatsApp business
 * account of whoever bound it (a settings admin: POST communications .../connections, whatsapp/connect). Every
 * message it sends lands in that account (its sent folder, its WhatsApp history) with the recipient's address or
 * phone. Round 3 listed these adapters as sending "to the contact the record names; no member-chosen account
 * receives it", which was wrong: an ADMIN whose map says crm none (D-114) bound their own mailbox and every
 * audience send queued the owner's PRIVATE contacts through it. The rule is the integration pushes' (round 2,
 * WHP-1 / WHP-2) and the Outlook push's (round 3, WPH2-1):
 *
 *   - binding a messaging connection needs read on what it receives (crm), checked as an export binding
 *     (assertMayBindExport, CONNECTOR_EXPORT_READS.channel_messaging), and records the binder
 *     (providerMeta.boundBy, written by the server, never taken from the body);
 *   - every send through such connections reaches only the contacts every receiver may open: the member who sends
 *     (when a member sends) and each connection's binder (channelRecipients). A connection bound before binders
 *     were recorded has an unknown receiver, read as a non-owner (no PRIVATE contact); a recorded binder who may
 *     no longer read crm is a 403 naming why, until a settings admin who reads it connects the account again.
 */

/** The providers whose connection sends messages to the business's contacts. */
export const MESSAGING_CHANNEL_PROVIDERS: ReadonlySet<string> = new Set(['EMAIL', 'GOOGLE', 'WHATSAPP']);

/** The export type a messaging channel connection's account is bound as (CONNECTOR_EXPORT_READS). */
export const CHANNEL_EXPORT_TYPE = 'channel_messaging';

export const isMessagingProvider = (provider: unknown): boolean =>
  typeof provider === 'string' && MESSAGING_CHANNEL_PROVIDERS.has(provider.toUpperCase());

/** The fields of a connection update that change its account (its token, mailbox or provider meta), so rebind it. */
export const CHANNEL_ACCOUNT_FIELDS = ['token', 'refreshToken', 'accountEmail', 'providerMeta'] as const;

/** True when an update body changes the connection's account (a label or health change does not). */
export const rebindsChannelAccount = (data: unknown): boolean =>
  !!data && typeof data === 'object' && CHANNEL_ACCOUNT_FIELDS.some((k) => (data as Record<string, unknown>)[k] !== undefined);

/** The member a connection's providerMeta records as its binder, or null (none recorded). */
export function channelBinderOf(providerMeta: unknown): string | null {
  if (!providerMeta || typeof providerMeta !== 'object' || Array.isArray(providerMeta)) return null;
  const boundBy = (providerMeta as Record<string, unknown>).boundBy;
  return typeof boundBy === 'string' && boundBy.length > 0 ? boundBy : null;
}

/**
 * A connection's providerMeta as the server writes it for `binder`: the body's providerMeta less any boundBy it
 * names, and, for a messaging provider, the binder recorded.
 */
export function providerMetaBoundBy(provider: unknown, providerMeta: unknown, binder: string | undefined): Record<string, unknown> | undefined {
  const base = providerMeta && typeof providerMeta === 'object' && !Array.isArray(providerMeta) ? { ...(providerMeta as Record<string, unknown>) } : undefined;
  if (base) delete base.boundBy;
  if (!isMessagingProvider(provider) || !binder) return base;
  return { ...(base ?? {}), boundBy: binder };
}

/**
 * The contact ids among `contactIds` a send through `connections` may go to: every receiver may open them (the
 * sending member, when there is one, and each messaging connection's binder). 403 when the sending member does
 * not read crm, or a recorded binder no longer does. Connections that send no messages (social pages) add no
 * receiver; with none of them, every candidate is kept.
 */
export async function channelRecipients(
  prisma: PrismaService,
  businessId: string,
  connections: ReadonlyArray<{ provider: string; providerMeta?: unknown }>,
  sender: ModuleLevelActor | null,
  contactIds: readonly string[],
): Promise<Set<string>> {
  const messaging = connections.filter((c) => isMessagingProvider(c.provider));
  if (messaging.length === 0 || contactIds.length === 0) return new Set(contactIds);
  if (sender) await assertMayExport(prisma, businessId, sender, ['crm'], "sending to the business's contacts through a connected sending account");
  const memberIds = sender?.id ? [sender.id] : [];
  let unknownReceiver = false;
  for (const connection of messaging) {
    const binder = channelBinderOf(connection.providerMeta);
    if (!binder) {
      unknownReceiver = true;
      continue;
    }
    const user = await prisma.client.user.findUnique({ where: { id: binder }, select: { role: true } });
    const refusal = await receiverReadRefusal(prisma, businessId, { id: binder, role: user?.role ?? undefined }, ['crm'], 'the sending account this goes through');
    if (refusal) {
      throw new ForbiddenException(
        `The sending account was connected by a member who may no longer read the business's contacts (${refusal.replace(/^Insufficient permissions: /, '')}); a settings admin who reads them must connect it again`,
      );
    }
    memberIds.push(binder);
  }
  return contactIdsEveryReceiverMayOpen(prisma, businessId, { memberIds, unknownReceiver }, contactIds);
}
