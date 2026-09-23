import { DEFAULT_APPROVAL_TIERS } from './module-vocabulary';

/**
 * The Membership approval-tier rule, in one place.
 *
 * This rule was implemented three times, independently and identically:
 *
 *   IdentityService.resolveApprovalTier        (identity.service.ts)
 *   AiOversightService.resolveApproval         (inline)
 *   AiController.assertCanResolveApproval      (inline)
 *
 * CG-REVIEW-AUTH-PRECEDENCE-001 chose R2_FREEZE_EXISTING_RULE: consolidate the three
 * copies behind one helper, and do not change what any of them returns. This function
 * is therefore a transcription, not a redesign — if it disagrees with any of the three
 * originals on any input, the helper is wrong.
 *
 * THE KNOWN GAP, LEFT OPEN ON PURPOSE
 *
 * `maxApprovalTier` is `Int @default(0)` and NOT NULL, so the column cannot distinguish
 * "never configured" from "deliberately restricted to zero". The rule below disambiguates
 * by consulting a DIFFERENT column — whether an explicit `permissionScopes` map exists.
 * The consequence is that an OWNER with a null scope map who is explicitly set to tier 0
 * resolves back to tier 4: the most restrictive choice is the one the schema cannot
 * record. That is `tier_zero_ambiguity`, surfaced in the resolver's provenance rather
 * than fixed here — a nullable migration on an authority column is not in this packet.
 */
export interface MembershipTierInput {
  role: string;
  maxApprovalTier: number | null | undefined;
  permissionScopes?: unknown;
}

export interface ApprovalTierResolution {
  tier: number;
  /** Which branch produced the tier — carried into EffectiveAuthorityResult.provenance. */
  source: 'stored_max_approval_tier' | 'role_default';
  /**
   * True when the stored value was 0 AND no explicit scope map existed, so the stored
   * zero was discarded in favour of the role default. The one case where a deliberate
   * restriction is indistinguishable from an unset column.
   */
  tierZeroAmbiguity: boolean;
}

export function resolveMembershipApprovalTier(membership: MembershipTierInput): ApprovalTierResolution {
  const hasExplicitScopes = membership.permissionScopes !== null && membership.permissionScopes !== undefined;
  const stored = membership.maxApprovalTier;

  if (stored !== null && stored !== undefined && (hasExplicitScopes || stored !== 0)) {
    return { tier: stored, source: 'stored_max_approval_tier', tierZeroAmbiguity: false };
  }

  return {
    tier: DEFAULT_APPROVAL_TIERS[membership.role] ?? 0,
    source: 'role_default',
    // Only ambiguous when a real 0 was present and discarded. A null column, which
    // Prisma does not produce for this NOT NULL field but the type permits, is not.
    tierZeroAmbiguity: stored === 0 && !hasExplicitScopes,
  };
}

/** The bare number, for the three call sites that only ever wanted that. */
export function membershipApprovalTier(membership: MembershipTierInput): number {
  return resolveMembershipApprovalTier(membership).tier;
}
