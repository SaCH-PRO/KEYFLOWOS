/**
 * D-280 / SEC-WAW-1 (P60: FU-WA-INBOUND-KEY-EXCLUDE)
 *
 * Canonical helpers ensuring pasted inbound WhatsApp text
 * (`ContactNote.source = 'whatsapp_inbound'` and `ContactEvent` with
 * `type = 'communication.whatsapp'` / `source = 'whatsapp_inbound'` /
 * `data.source = 'pasted_whatsapp'`) never reaches automatic KEY prompts,
 * background scans, or indirect ledger/touchpoint body copies.
 *
 * Owner-initiated KEY use (interactive chat, explicit UI AI buttons) stays
 * allowed per D-280.
 */

import type { Prisma } from '@prisma/client';

export const WHATSAPP_INBOUND_SOURCE = 'whatsapp_inbound';
export const WHATSAPP_PASTED_DATA_SOURCE = 'pasted_whatsapp';
export const WHATSAPP_COMMUNICATION_EVENT_TYPE = 'communication.whatsapp';

/**
 * NULL-safe Prisma `where` fragment excluding `source = 'whatsapp_inbound'`.
 * Plain `{ source: { not: 'whatsapp_inbound' } }` evaluates to SQL UNKNOWN
 * when `source IS NULL` and would silently drop legacy team notes/events.
 */
export const EXCLUDE_WHATSAPP_INBOUND_SOURCE: {
  OR: Array<{ source: null } | { source: { not: string } }>;
} = {
  OR: [{ source: null }, { source: { not: WHATSAPP_INBOUND_SOURCE } }],
};

/**
 * NULL-safe Prisma `where` fragment excluding both `source = 'whatsapp_inbound'`
 * and `type = 'communication.whatsapp'` ContactEvent rows from automatic KEY
 * readers.
 */
export const EXCLUDE_WHATSAPP_INBOUND_CONTACT_EVENTS: Prisma.ContactEventWhereInput = {
  AND: [
    EXCLUDE_WHATSAPP_INBOUND_SOURCE,
    { type: { not: WHATSAPP_COMMUNICATION_EVENT_TYPE } },
  ],
};

export function isInboundWhatsAppEvent(ev: {
  source?: string | null;
  type?: string | null;
  data?: unknown;
}): boolean {
  if (ev.source === WHATSAPP_INBOUND_SOURCE) return true;
  if (ev.type === WHATSAPP_COMMUNICATION_EVENT_TYPE) return true;
  if (ev.data && typeof ev.data === 'object' && !Array.isArray(ev.data)) {
    const rec = ev.data as Record<string, unknown>;
    if (rec.source === WHATSAPP_PASTED_DATA_SOURCE || rec.source === WHATSAPP_INBOUND_SOURCE) {
      return true;
    }
  }
  return false;
}

/**
 * Strips free-text message `body` / `message` fields when copying a
 * `communication.whatsapp` or `whatsapp_inbound` event payload into secondary
 * tables (`activities`, `journey_touchpoints`), preserving non-body metadata
 * (channel, direction, source, senderPhone, noteId).
 */
export function stripInboundWhatsAppBody(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const copy: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  delete copy.body;
  delete copy.message;
  return copy;
}
