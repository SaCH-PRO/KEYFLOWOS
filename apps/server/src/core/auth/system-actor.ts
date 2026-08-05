/**
 * Who KEY is, when it acts on a business.
 *
 * THE PROBLEM
 *
 * KEY passed the string `'key_ai'` as an actor id at 25 call sites, and no
 * `User` or `Membership` with that id has ever been created anywhere in this
 * codebase. So KEY worked wherever nobody checked, and threw wherever somebody
 * did — `commerce.markInvoicePaid` looks the actor up in `Membership` and
 * raises "Not authorized to update this invoice", meaning that tool failed on
 * 100% of calls from the day it shipped. An assistant with a made-up identity
 * card.
 *
 * WHY NOT JUST CREATE THE USER
 *
 * `User.id` corresponds to a Supabase `auth.users.id`. A row invented on this
 * side has no auth counterpart, and giving KEY a real `Membership` would grant
 * it whatever authority every membership-based check confers — in every
 * business, permanently, including checks written later by someone who never
 * considered a non-human member. That is a large, silent grant to fix a small,
 * loud error.
 *
 * WHAT THIS IS INSTEAD
 *
 * An explicit contract: KEY is a SYSTEM actor, and a system actor's authority
 * comes from the tenant scope its caller has already established — not from a
 * membership row.
 *
 * That trade is only sound if the tenant scope is genuinely established, so
 * every service recognising a system actor MUST also be given the businessId
 * and MUST enforce it against the row it is about to touch. The membership
 * lookup was, on those paths, the only thing standing between a caller and any
 * invoice in any business — the id lookups are by primary key alone. Waving KEY
 * past that check without adding the tenant assertion would turn a broken tool
 * into a cross-tenant write.
 *
 * So the rule is: recognise the system actor ONLY where businessId is present
 * and checked. A service that cannot prove the tenant must keep refusing.
 */

/** The actor id KEY presents when it acts on a business on its own behalf. */
export const KEY_SYSTEM_ACTOR_ID = 'key_ai';

/**
 * Is this actor KEY itself rather than a person?
 *
 * Callers must have already established and enforced the tenant scope; see the
 * header. This answers "is this a human whose membership we can look up", not
 * "is this action permitted".
 */
export function isSystemActor(actorId?: string | null): boolean {
  return actorId === KEY_SYSTEM_ACTOR_ID;
}
