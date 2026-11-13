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

/** The account of a stored connection, as rebindsChannelAccount compares it (its token read decrypted). */
export interface StoredChannelAccount {
  token?: string | null;
  refreshToken?: string | null;
  accountEmail?: string | null;
  providerMeta?: unknown;
}

/** A JSON value with object keys in order, so two provider metas compare by content. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** A provider meta less the binder the server records (a boundBy in a body is never stored, so it changes nothing). */
function metaWithoutBinder(providerMeta: unknown): Record<string, unknown> {
  if (!providerMeta || typeof providerMeta !== 'object' || Array.isArray(providerMeta)) return {};
  const rest = { ...(providerMeta as Record<string, unknown>) };
  delete rest.boundBy;
  return rest;
}

const sameMailbox = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/**
 * True when an update body changes the stored connection's account: a token, refresh token, mailbox or provider meta
 * that differs from what is stored. A field sent back unchanged binds nothing (review COR-2: the web's sender form
 * always sends {label, accountEmail}, so renaming the sender counted as a rebind: an ADMIN who renamed the owner's
 * sender became its binder and the owner's PRIVATE contacts dropped out of the owner's own sends, and a settings
 * admin whose map says crm none could not rename it). A label or health change is never a rebind.
 */
export function rebindsChannelAccount(stored: StoredChannelAccount | null | undefined, data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const body = data as Record<string, unknown>;
  const was = stored ?? {};
  if (body.token !== undefined && (body.token ?? null) !== (was.token ?? null)) return true;
  if (body.refreshToken !== undefined && (body.refreshToken ?? null) !== (was.refreshToken ?? null)) return true;
  if (body.accountEmail !== undefined && !sameMailbox(body.accountEmail, was.accountEmail)) return true;
  if (body.providerMeta !== undefined && canonicalJson(metaWithoutBinder(body.providerMeta)) !== canonicalJson(metaWithoutBinder(was.providerMeta))) return true;
  return false;
}

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

/** The code a delivery fails with when its contact is not one every receiver of the sending account may open now. */
export const RECEIVER_MAY_NOT_OPEN = 'RECEIVER_MAY_NOT_OPEN';

/**
 * SWEEP-P0-FOLLOWUP repair (review SEC-FU-2): the receiver rule, again when a queued delivery is sent. channelRecipients
 * ran when the delivery was queued (publish, schedule, KEY's broadcast, a flow, a sequence), but the delivery goes out
 * through the connection's account as it is when it is sent: a PATCH that rebinds the account after a send was
 * scheduled, or before a failed delivery is retried, sent the contacts to the new binder's account although that
 * binder may not open them. Why the delivery to `contactId` through `connection` may not go out now (its recorded
 * binder may no longer read crm, or may not open the contact; an account with no recorded binder is read as a
 * non-owner's), in plain words, or null when it may. A delivery to no contact, or through a connection that sends no
 * messages, is not held here.
 */
export async function channelSendRefusal(
  prisma: PrismaService,
  businessId: string,
  connection: { provider?: string | null; providerMeta?: unknown } | null | undefined,
  contactId: string | null | undefined,
): Promise<string | null> {
  if (!contactId || !connection || !isMessagingProvider(connection.provider)) return null;
  let open: Set<string>;
  try {
    open = await channelRecipients(prisma, businessId, [{ provider: String(connection.provider), providerMeta: connection.providerMeta }], null, [contactId]);
  } catch (err) {
    if (err instanceof ForbiddenException) return `Not sent: ${err.message}`;
    throw err;
  }
  if (open.has(contactId)) return null;
  return 'Not sent: the member who connected the sending account may not open this contact (the account was connected again, or the contact made private, after this send was queued). Send it through an account connected by a member who may open the contact.';
}
