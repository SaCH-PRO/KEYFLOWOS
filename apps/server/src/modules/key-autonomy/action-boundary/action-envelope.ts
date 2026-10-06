import { createHash } from 'crypto';

/**
 * ActionEnvelope: the material parameters of one business action, built on the
 * server, canonical, frozen and bound to a fingerprint (KF-EXEC-ACTION-001).
 *
 * WHY IT EXISTS
 *
 * Before this, the arguments of a KEY action were a mutable object that crossed
 * the client boundary twice. The chat path returned them to the browser as a
 * "pending confirmation" and executed whatever the browser sent back; nothing
 * compared the two. An approval therefore approved a tool NAME, and the
 * parameters were whatever arrived last.
 *
 * The envelope is what control evidence binds to. A confirmation or approval
 * names a fingerprint, and the claim transaction recomputes the fingerprint
 * from the stored envelope before it writes anything. Change one material
 * parameter and the evidence no longer names this action.
 */

export const HELPDESK_CREATE_TICKET = 'helpdesk_create_ticket';

/**
 * The capabilities the boundary governs. One, by directive: adopting a second
 * family is separate, separately-released work.
 */
export const BOUNDARY_CAPABILITIES: readonly string[] = [HELPDESK_CREATE_TICKET];

export function isBoundaryCapability(name: string | null | undefined): boolean {
  return typeof name === 'string' && BOUNDARY_CAPABILITIES.includes(name);
}

export const TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const TICKET_SOURCES = ['MANUAL', 'EMAIL', 'PORTAL', 'WHATSAPP'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export type TicketSource = (typeof TICKET_SOURCES)[number];

/** What a KEY-created ticket has always been given: the column default. */
export const DEFAULT_TICKET_PRIORITY: TicketPriority = 'NORMAL';
export const DEFAULT_TICKET_SOURCE: TicketSource = 'MANUAL';

export interface HelpdeskCreateTicketMaterial {
  title: string;
  description: string | null;
  contactId: string | null;
  priority: TicketPriority;
  /**
   * The registry has always declared `source`, and the handler has always
   * dropped it, so every KEY-created ticket was MANUAL whatever the caller
   * said. It is resolved here and written with the ticket.
   */
  source: TicketSource;
}

/**
 * The fields the fingerprint covers, in a fixed order.
 *
 * Named one by one, not `Object.keys(material)`: a field that is material but
 * missing from this list can be changed after approval without invalidating
 * the approval, and a list is something a reviewer can read.
 */
export const HELPDESK_CREATE_TICKET_FINGERPRINT_FIELDS = [
  'title',
  'description',
  'contactId',
  'priority',
  'source',
] as const satisfies ReadonlyArray<keyof HelpdeskCreateTicketMaterial>;

export interface ActionEnvelope {
  /** Envelope format version. Bump when the canonical form changes. */
  v: 1;
  capability: string;
  capabilityVersion: number;
  businessId: string;
  material: HelpdeskCreateTicketMaterial;
}

export class ActionEnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionEnvelopeError';
  }
}

function optionalString(raw: unknown, field: string): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    throw new ActionEnvelopeError(`Field "${field}" for ${HELPDESK_CREATE_TICKET} must be a string`);
  }
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

function enumValue<T extends string>(raw: unknown, field: string, allowed: readonly T[], fallback: T): T {
  if (raw === undefined || raw === null || raw === '') return fallback;
  // Rejected, never coerced: `priority: "urgent!"` is not URGENT, and guessing
  // would put a value in the envelope that nobody supplied.
  if (typeof raw !== 'string' || !(allowed as readonly string[]).includes(raw)) {
    throw new ActionEnvelopeError(
      `Field "${field}" for ${HELPDESK_CREATE_TICKET} must be one of: ${allowed.join(', ')}`,
    );
  }
  return raw as T;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/**
 * Build the envelope for helpdesk_create_ticket from untrusted arguments.
 *
 * Only the declared material fields are read. Anything else in `rawArgs` is
 * not carried: it cannot reach the ticket, so it is not material.
 */
export function buildHelpdeskCreateTicketEnvelope(input: {
  businessId: string;
  capabilityVersion: number;
  rawArgs: unknown;
}): ActionEnvelope {
  if (!input.businessId || typeof input.businessId !== 'string') {
    throw new ActionEnvelopeError('An action envelope needs a business');
  }
  const args =
    input.rawArgs && typeof input.rawArgs === 'object' && !Array.isArray(input.rawArgs)
      ? (input.rawArgs as Record<string, unknown>)
      : null;
  if (!args) throw new ActionEnvelopeError(`Arguments for ${HELPDESK_CREATE_TICKET} must be an object`);

  const title = optionalString(args.title, 'title');
  if (!title) throw new ActionEnvelopeError(`Missing required fields for ${HELPDESK_CREATE_TICKET}: title`);

  return deepFreeze({
    v: 1,
    capability: HELPDESK_CREATE_TICKET,
    capabilityVersion: input.capabilityVersion,
    businessId: input.businessId,
    material: {
      title,
      description: optionalString(args.description, 'description'),
      contactId: optionalString(args.contactId, 'contactId'),
      priority: enumValue(args.priority, 'priority', TICKET_PRIORITIES, DEFAULT_TICKET_PRIORITY),
      source: enumValue(args.source, 'source', TICKET_SOURCES, DEFAULT_TICKET_SOURCE),
    },
  } satisfies ActionEnvelope);
}

/**
 * Read an envelope back from storage. A stored envelope is data like any
 * other: it is re-validated through the same builder, so a row edited into a
 * shape the builder would refuse is refused here too.
 */
export function parseStoredEnvelope(stored: unknown): ActionEnvelope {
  const row = stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Record<string, unknown>) : null;
  if (!row || row.v !== 1 || row.capability !== HELPDESK_CREATE_TICKET) {
    throw new ActionEnvelopeError('Stored action envelope is not a helpdesk_create_ticket envelope');
  }
  if (typeof row.capabilityVersion !== 'number' || typeof row.businessId !== 'string') {
    throw new ActionEnvelopeError('Stored action envelope has no capability version or business');
  }
  const rebuilt = buildHelpdeskCreateTicketEnvelope({
    businessId: row.businessId,
    capabilityVersion: row.capabilityVersion,
    rawArgs: row.material,
  });
  return rebuilt;
}

/** Deterministic JSON: object keys sorted, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`;
}

/**
 * sha256 over the canonical envelope: format version, capability identity and
 * version, tenant, and every material field.
 */
export function fingerprintEnvelope(envelope: ActionEnvelope): string {
  const material: Record<string, unknown> = {};
  for (const field of HELPDESK_CREATE_TICKET_FINGERPRINT_FIELDS) {
    material[field] = envelope.material[field];
  }
  return createHash('sha256')
    .update(
      canonicalJson({
        v: envelope.v,
        capability: envelope.capability,
        capabilityVersion: envelope.capabilityVersion,
        businessId: envelope.businessId,
        material,
      }),
    )
    .digest('hex');
}
