import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { skipTenantIsolation } from '@keyflow/db';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { BlueprintService } from '../blueprint/blueprint.service';
import { DefaultTriggersService } from '../ai/default-triggers.service';
import { BUSINESS_META_PAYMENT_SECRET_KEYS, sanitizeBusiness } from '../../core/security/sanitize-business';
import { computeProfileCompleteness, computeTieredCompleteness, COMPLETENESS_TIERS, PROGRESSIVE_DEEPENING_PROMPTS } from './profile-completeness.constants';
import type { UserIdentityDataDto } from './dto/bootstrap.dto';
import {
  ACCESS_LEVELS,
  CANONICAL_MODULES,
  CRM_SUBPERMISSION_VALUES,
  DEFAULT_APPROVAL_TIERS as CANONICAL_APPROVAL_TIERS,
  ROLE_DEFAULT_SCOPES,
  rankOf,
} from '../../core/authority/module-vocabulary';
import { membershipApprovalTier } from '../../core/authority/approval-tier';
import { draftPayloadFollowingBusinessSlug } from '../site/presence/presence.service';
import { resolveCrmAccess, type CrmAccess } from '../crm/crm-permissions.helper';

/**
 * W6-IDENTITY-REKEY-CREATOR (D-73): the reserved key a trigger rule records its creator under,
 * TRIGGER_RULE_CREATOR_KEY of key-cortex-trigger.service (AgentTrigger.condition and
 * KeyCortexTriggerRule.filterJson). Restated, not imported: that module's imports reach this one
 * (through the KEY cortex settings adapter), so importing it would close a cycle.
 * test/identity-rekey-creator.integration.test.ts writes its rules with the real writers, so a
 * renamed key fails there.
 */
const TRIGGER_CREATOR_KEY = '$createdBy';

/** The three inputs that make up a membership's authority. */
type AuthorityEnvelope = { role: string; permissionScopes: unknown; maxApprovalTier: number | null };

/** CRM ownership scopes, weakest first; anything unrecognised ranks lowest. */
const CRM_SCOPE_RANK: Readonly<Record<string, number>> = { none: 0, owned: 1, any: 2 };
const crmScopeRank = (scope: string) => CRM_SCOPE_RANK[scope] ?? 0;

/**
 * Membership roles, weakest first. The role is a dimension of authority in its own
 * right, not only the source of default scopes: two gates grant by role name alone,
 * whatever the scope map says — PUT .../ai/governance (AiOversightService
 * .updateAutonomySettings) and approving a tier-4 AI plan (PlannerService.approvePlan)
 * both admit OWNER and ADMIN. An unrecognised role ranks with STAFF, the role every
 * reader falls back to and the one neither gate admits.
 */
const ROLE_RANK: Readonly<Record<string, number>> = { STAFF: 0, ADMIN: 1, OWNER: 2 };
const roleRank = (role: string) => ROLE_RANK[role] ?? 0;

/**
 * R0-SEC2b-WHATSAPP-SECRET-READS (R0-SEC2 review SEC2-R1, second writer):
 * Business.metaData keys the profile PATCH never writes, because another route
 * is their only writer. updateBusiness merges the caller's metaData bag over
 * the stored one, so without this an owner could write metaData.whatsapp (the
 * WhatsApp sending identity) directly: another business's credential
 * ciphertext, which one platform key decrypts, or a phoneNumberId another
 * business holds (the shared webhook's routing key), past every refusal
 * WhatsAppService.saveConfig (PATCH /whatsapp/businesses/:businessId/config)
 * applies. The d11-owner-writes static guard (D11W-09) reads this list.
 *
 * W3-D12b-SEO-SECRET-MASK review repair (CR-D12b-1, D12b-ST-1): ga4 and gsc,
 * the SEO connection entries (BUSINESS_META_SEO_CONNECTION_KEYS) whose only
 * writers are the SEO connector routes (SeoGoogleAnalyticsService and
 * SeoGoogleSearchConsoleService). A Business read answers each only as
 * {configured:true}, so without this a client echoing the read back would
 * merge that marker over the stored connection: the Google tokens lost, both
 * connectors disconnected, while the read went on answering configured.
 * business-meta-writers.spec.ts ([D12b-R1]) keeps this list a superset of
 * BUSINESS_META_SEO_CONNECTION_KEYS.
 */
export const PROFILE_PATCH_RESERVED_META_KEYS = ['whatsapp', 'ga4', 'gsc'] as const;

/** The 400 code updateBusiness answers a metaData bag naming a reserved key with. */
export const BUSINESS_METADATA_KEY_RESERVED = 'BUSINESS_METADATA_KEY_RESERVED';

/**
 * R0-SEC2c-PAYMENT-SECRETS-WRITE-ONLY: how the profile PATCH writes the payment
 * secrets (BUSINESS_META_PAYMENT_SECRET_KEYS) a Business read never answers.
 * `merged` is the stored metaData with the caller's bag spread over it; for
 * each secret the caller named:
 *   - a non-blank string is a new secret: stored trimmed;
 *   - null is an explicit clear: the key is removed;
 *   - anything else (blank, the {configured} marker a read answers, any other
 *     value) is no new secret: the stored value stays as it was, or stays
 *     absent. So a client that sends a read back never writes a mask over a
 *     secret.
 * A secret the caller did not name is the stored one, by the merge itself.
 */
function applyPaymentSecretWrites(
  merged: Record<string, unknown>,
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
): void {
  const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);
  for (const key of BUSINESS_META_PAYMENT_SECRET_KEYS) {
    if (!has(incoming, key)) continue;
    const value = incoming[key];
    if (typeof value === 'string' && value.trim() !== '') {
      merged[key] = value.trim();
    } else if (value === null || !has(stored, key)) {
      delete merged[key];
    } else {
      merged[key] = stored[key];
    }
  }
}

/**
 * R0-SEC2c review SEC2c-ST-1: the profile PATCH's transaction (the row lock,
 * the read of the stored row and the write). maxWait and timeout leave room
 * for a PATCH queued behind another holder of the business row.
 */
const PROFILE_PATCH_TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

/**
 * The CRM ownership authority a membership's scope map confers (level, crm_view,
 * crm_edit, crm_reassign, crm_delete), by `resolveCrmAccess` itself — the rule every
 * CRM read and write enforces — evaluated on an in-memory membership rather than a
 * stored row. Calling it keeps one rule: a transcription here could drift from it
 * (crm-permissions.helper.ts is outside R0-ID-F1-ROLE-ROUTE-AUTHORITY's write set).
 * The user is a plain USER, so SUPER_ADMIN never short-circuits the evaluation.
 */
function crmAccessOf(m: AuthorityEnvelope): Promise<CrmAccess> {
  const inMemory = {
    client: {
      user: { findUnique: async () => ({ role: 'USER' }) },
      membership: { findUnique: async () => ({ role: m.role, permissionScopes: m.permissionScopes }) },
    },
  } as unknown as PrismaService;
  return resolveCrmAccess(inMemory, '', '');
}

/**
 * Map a Business profile field to the onboarding-answer key that
 * `BlueprintService.inferFromOnboarding` understands. Only fields that have
 * a direct equivalent in an existing blueprint section are listed; the rest
 * are intentionally ignored so the bridge stays lossless.
 */
const BUSINESS_FIELD_TO_BLUEPRINT_ANSWER: Record<string, string> = {
  name: 'businessName',
  businessIntent: 'businessIntent',
  industry: 'industry',
  tagline: 'tagline',
  country: 'country',
  primaryColor: 'primaryColor',
  secondaryColor: 'secondaryColor',
  logoUrl: 'logoUrl',
  currency: 'currency',
  teamSize: 'teamSize',
};

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  /**
   * Retries allowed when a concurrent bootstrap loses the Serializable race.
   *
   * Bounded on purpose: a persistent failure must surface, not spin forever.
   *
   * Five rather than one. A two-way race needs a single retry, but the losers of
   * a wider pile-up retry at the same instant and collide with each other, so a
   * tight budget exhausts on contention that would have resolved. Measured
   * against real Postgres with six simultaneous bootstraps, three retries
   * without backoff still failed.
   */
  private static readonly BOOTSTRAP_CONFLICT_RETRIES = 5;

  /**
   * Base backoff between bootstrap retries, in milliseconds.
   *
   * Doubling per attempt with jitter on top. The jitter is the part that
   * matters: every loser of a given round aborts at the same moment, so a fixed
   * delay just reschedules the same collision. Staggering them lets one through
   * at a time, and each one that gets through finds the winner's business and
   * takes the cheap read path.
   */
  private static readonly BOOTSTRAP_RETRY_BASE_MS = 15;

  /**
   * Owner ruling D-104 (W10-OWNER-MEMBERSHIP; reviews SEC-W10OM-3, OMV-2): the
   * 403 code POST /identity/bootstrap answers a caller recorded as
   * Business.ownerId of a live business who holds no Membership on any live
   * business. A caller who is a member somewhere is answered that business
   * instead (ensureBootstrapWorkspace).
   */
  static readonly OWNER_MEMBERSHIP_REQUIRED = 'OWNER_MEMBERSHIP_REQUIRED';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BlueprintService) private readonly blueprint: BlueprintService,
    // Appended. IdentityModule already imports AiModule and AiModule does not
    // import IdentityModule, so this needs no forwardRef.
    @Inject(DefaultTriggersService) private readonly defaultTriggers: DefaultTriggersService,
  ) {}

  /**
   * Ordinary workspace discovery, Membership-first.
   *
   * KF-EXEC-TENANT-001. This used to filter on `ownerId` alone, which meant a
   * legitimate STAFF or ADMIN member — a row `inviteTeamMember` had already
   * written — saw an empty workspace list and could not reach a business they
   * were plainly a member of. Membership is the ordinary authenticated-human to
   * Business relationship, so it leads the predicate.
   *
   * Owner ruling D-104 (W10-OWNER-MEMBERSHIP): Membership is the single rule.
   * The `ownerId` compatibility arm is gone: an owner recorded only as
   * Business.ownerId is refused by BusinessGuard, so listing them a workspace
   * they cannot open helped no one. scripts/backfill-owner-memberships.ts
   * (operator, dry run by default) writes their OWNER Membership.
   *
   * Tenant scoping: `Business` is the tenant root and carries no businessId, so
   * it is absent from BUSINESS_ID_MODELS and the S0 isolation extension injects
   * nothing here. The nested `members` filter is a relation predicate on
   * Business, not a Membership operation, so S0's default Membership scoping
   * does not reach it either. This route also carries no `:businessId`, so no
   * ambient tenant context exists to truncate the result. All three have to stay
   * true together; if a future route ever lists workspaces from inside a tenant
   * context, this query needs an explicit `skipTenantIsolation`.
   */
  async listBusinesses(userId: string) {
    if (!userId) throw new UnauthorizedException('User ID is required to list businesses');
    const items = await this.prisma.client.business.findMany({
      where: { deletedAt: null, members: { some: { userId } } },
    });
    return items.map((b) => sanitizeBusiness(b));
  }

  async getBusiness(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
    });
    if (!business) throw new NotFoundException('Business not found');
    return sanitizeBusiness(business);
  }

  private static readonly PUBLIC_BUSINESS_FIELDS = {
    id: true,
    name: true,
    slug: true,
    logoUrl: true,
    tagline: true,
    description: true,
    address: true,
    city: true,
    country: true,
    phone: true,
    email: true,
    website: true,
    facebook: true,
    instagram: true,
    twitter: true,
    linkedin: true,
    tiktok: true,
    youtube: true,
    whatsapp: true,
    primaryColor: true,
    secondaryColor: true,
    defaultTaxRate: true,
    invoiceTemplate: true,
    quoteTemplate: true,
    timezone: true,
    currency: true,
    storeEnabled: true,
    businessHours: true,
  } as const;

  async getBusinessBySlug(slug: string) {
    const business = await this.prisma.client.business.findFirst({
      where: { slug, deletedAt: null },
    });
    if (!business) throw new NotFoundException('Business not found');
    return sanitizeBusiness(business);
  }

  async getPublicBusiness(slug: string) {
    const business = await this.prisma.client.business.findFirst({
      where: { slug, deletedAt: null },
      select: IdentityService.PUBLIC_BUSINESS_FIELDS,
    });
    if (!business) throw new NotFoundException('Business not found');
    return business;
  }

  async getPublicBusinessById(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: IdentityService.PUBLIC_BUSINESS_FIELDS,
    });
    if (!business) throw new NotFoundException('Business not found');
    return business;
  }

  async updateUser(userId: string, input: { firstName?: string; lastName?: string; phone?: string; name?: string; avatarUrl?: string }) {
    const user = await this.prisma.client.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const data: Record<string, unknown> = {};
    if (input.firstName !== undefined) data.firstName = input.firstName.trim();
    if (input.lastName !== undefined) data.lastName = input.lastName.trim();
    if (input.phone !== undefined) data.phone = input.phone.trim();
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.avatarUrl !== undefined) data.avatarUrl = input.avatarUrl.trim();

    return this.prisma.client.user.update({
      where: { id: userId },
      data,
      select: { id: true, email: true, name: true, firstName: true, lastName: true, phone: true, avatarUrl: true, role: true },
    });
  }

  async checkSlugAvailability(slug: string, userId?: string) {
    const existing = await this.prisma.client.business.findFirst({
      where: { slug, deletedAt: null },
    });
    if (!existing) return { available: true, slug };
    if (userId && existing.ownerId === userId) return { available: true, slug, ownedByYou: true };
    return { available: false, slug };
  }

  async createBusiness(input: { name: string; ownerId: string }) {
    if (!input.ownerId) {
      throw new UnauthorizedException('Owner ID is required to create a business');
    }
    // KF-EXEC-TENANT-001: one transaction, or neither row.
    //
    // This path used to write the Business and stop. The owner ended up with
    // `ownerId` set and no Membership, which BusinessGuard tolerates (it accepts
    // ownerId OR Membership) but ModuleScopeGuard does not — it reads
    // `membership.findUnique` and throws 'Not a member of this business'. The
    // result was an owner who could open their own business and then be refused
    // by every `@RequireModuleScope` route in the app.
    //
    // Explicit creation stays non-idempotent by design: asking for another
    // business is a request for another business, not a bootstrap retry. What
    // must hold is that each one arrives with exactly one founding OWNER
    // Membership, or not at all.
    //
    // Membership.userId is a real foreign key to User, so an ownerId that names
    // no user now fails the transaction and creates nothing, where before it
    // silently produced an orphan Business. That is the invariant's
    // "fails atomically" arm doing its job, not a regression.
    // A nested relation write, not an explicit transaction. Prisma runs a
    // nested create in one implicit transaction, so the atomicity is identical
    // while the business id never has to be read back and carried to a second
    // statement.
    const business = await this.prisma.client.business.create({
      data: {
        name: input.name.trim(),
        ownerId: input.ownerId,
        members: { create: { userId: input.ownerId, role: 'OWNER' } },
      },
    });

    // Seed the autopilot defaults for this business.
    //
    // This is the only point at which a business first exists, and
    // createBusiness emits no `business.created` event, so there is no event
    // hook to use instead. seedForBusiness had NO callers anywhere, which left
    // two things broken: AgentTriggerService matched every emitted event
    // against an empty rule table, and AutopilotSettings — whose only writer is
    // that same method — never existed, so maxDailyAutoActions was never
    // enforced and MorningBriefingService had no settings to read.
    //
    // Rules are seeded DISABLED (see seedForBusiness); this creates the
    // settings row and the reviewable rules without KEY starting to act.
    //
    // Wrapped: a business must be created even if seeding fails. The seed is
    // idempotent, so a later retry costs nothing.
    try {
      const seeded = await this.defaultTriggers.seedForBusiness(business.id);
      this.logger.log(`Seeded ${seeded} autopilot triggers for business ${business.id}`);
    } catch (err: unknown) {
      this.logger.warn(
        `Autopilot seed failed for business ${business.id}: ` +
          `${err instanceof Error ? err.message : 'unknown'}`,
      );
    }

    return business;
  }

  /**
   * R0-09-ID-HARDEN, owner ruling D-11 (2026-10-31): editing the business profile
   * (PATCH /identity/businesses/:businessId) is OWNER only, regardless of granted
   * scopes — settings:write or settings:admin does not admit a STAFF or ADMIN.
   *
   * The owner is the OWNER membership or the distinguished owner (Business.ownerId)
   * holding an OWNER membership (owner rulings D-116 / D-125: a recorded owner
   * holding only ADMIN or STAFF is that role). A SUPER_ADMIN keeps the platform
   * bypass BusinessGuard already grants it on this route; nothing here widens that.
   */
  async assertBusinessOwner(businessId: string, actor: { id: string; role?: string }): Promise<void> {
    if (actor.role === 'SUPER_ADMIN') return;
    const membership = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: actor.id, businessId } },
      select: { role: true },
    });
    if (membership?.role === 'OWNER') return;
    const owned = await this.prisma.client.business.findFirst({
      // Owner ruling D-104 (W10-OWNER-MEMBERSHIP): the ownerId arm counts only with a Membership row.
      // Owner rulings D-116 / D-125 (W11-D116-PROFILE-OWNER; review SEC-W10OM-4 answered): only an
      // OWNER-role one. A recorded owner holding only ADMIN or STAFF is that role and is refused here.
      where: { id: businessId, ownerId: actor.id, members: { some: { userId: actor.id, role: 'OWNER' } } },
      select: { id: true },
    });
    if (owned) return;
    throw new ForbiddenException('Only the business owner can edit the business profile');
  }

  /**
   * The generic profile write. It does not write onboardingComplete (R0-09, CF-22):
   * completion goes through the onboarding concierge's gated path. It returns the
   * updated row through sanitizeBusiness, like getBusiness: no OAuth token column
   * leaves through the PATCH response or the KEY settings adapter.
   */
  async updateBusiness(businessId: string, input: {
    name?: string;
    slug?: string;
    timezone?: string;
    currency?: string;
    logoUrl?: string;
    address?: string;
    phone?: string;
    email?: string;
    website?: string;
    facebook?: string;
    instagram?: string;
    twitter?: string;
    linkedin?: string;
    tiktok?: string;
    youtube?: string;
    whatsapp?: string;
    primaryColor?: string;
    secondaryColor?: string;
    defaultTaxRate?: number;
    complianceStatus?: string;
    complianceData?: Record<string, boolean>;
    lastHealthCheck?: string;
    storeEnabled?: boolean;
    businessHours?: Record<string, { open: string; close: string; closed: boolean }>;
    messageIntakeEnabled?: boolean;
    tagline?: string;
    description?: string;
    city?: string;
    country?: string;
    industry?: string;
    businessIntent?: string;
    metaData?: Record<string, any>;
    headline?: string;
    bio?: string;
    skills?: string[];
    businessStage?: string;
    interests?: string[];
    teamSize?: string;
    acceptingWork?: boolean;
    currentCapacity?: string;
    leadTime?: string;
    preferredProjectTypes?: string[];
    budgetFit?: string;
    positioningStatement?: string;
  }) {
    // R0-SEC2b: a reserved metaData key (present at all, null included) refuses
    // the whole PATCH before anything is read or written (W3-D12b review
    // CR-D12b-1: the masked SEO connections too, so an echoed read writes nothing).
    if (input.metaData && typeof input.metaData === 'object') {
      for (const key of PROFILE_PATCH_RESERVED_META_KEYS) {
        if (Object.prototype.hasOwnProperty.call(input.metaData, key)) {
          throw new BadRequestException({
            code: BUSINESS_METADATA_KEY_RESERVED,
            message: `metaData.${key} cannot be written through the business profile; it is saved through its own settings route.`,
          });
        }
      }
    }

    if (input.slug) {
      const existing = await this.prisma.client.business.findFirst({
        where: { slug: input.slug.trim(), NOT: { id: businessId } },
      });
      if (existing) throw new BadRequestException('Slug is already taken');
    }

    const {
      lastHealthCheck, metaData,
      skills, interests, preferredProjectTypes,
      acceptingWork, currentCapacity, leadTime, budgetFit, positioningStatement,
      ...rest
    } = input;

    // R0-SEC2c review SEC2c-ST-1: Business.metaData is one jsonb column that
    // many writers read, change and write back whole. Reading the stored row
    // outside the write let a profile PATCH write a stale copy over a writer
    // that committed in between, and let two PATCHes in flight undo each other
    // (an owner's cleared or rotated secret written back by a co-owner's edit).
    // The row is locked first (FOR NO KEY UPDATE: the lock GmailService takes on
    // it, and the one the UPDATE takes anyway), then read and written in the
    // same transaction, so a concurrent writer's UPDATE waits for this one and
    // this read sees every write committed before it. A writer that read
    // without the lock and wrote its whole copy back afterwards (the public
    // storefront event among them) could still undo this write; that fix
    // belonged to those writers, and FOLLOW3-D12-METADATA-LOCKED-WRITES made it:
    // each takes this lock first (lockBusinessMeta, core/prisma/business-meta.ts)
    // or writes one atomic statement, the census in
    // core/prisma/business-meta-writers.spec.ts names one that does neither, and
    // the storefront event is the live case SEC2c-C03 in
    // test/payment-secrets-write-only.integration.test.ts (W8-HOUSEKEEPING: this
    // comment called it an it.todo).
    const { oldBusiness: previous, result } = await this.prisma.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${businessId} FOR NO KEY UPDATE`;
      const oldBusiness = await tx.business.findUnique({ where: { id: businessId } });
      if (!oldBusiness) throw new NotFoundException('Business not found');

      const stringFields: (keyof typeof rest)[] = [
        'name', 'slug', 'timezone', 'currency', 'logoUrl', 'address', 'phone',
        'email', 'website', 'facebook', 'instagram', 'twitter', 'linkedin',
        'tiktok', 'youtube', 'whatsapp', 'primaryColor', 'secondaryColor',
        'complianceStatus', 'tagline', 'description', 'city', 'country',
        'industry', 'businessIntent', 'headline', 'bio', 'businessStage', 'teamSize',
      ];

      const data: Record<string, unknown> = {};
      for (const key of stringFields) {
        if (rest[key] !== undefined) {
          const val = rest[key];
          data[key] = typeof val === 'string' ? val.trim() : val;
        }
      }

      if (currentCapacity !== undefined) data.currentCapacity = currentCapacity?.trim();
      if (leadTime !== undefined) data.leadTime = leadTime?.trim();
      if (budgetFit !== undefined) data.budgetFit = budgetFit?.trim();
      if (positioningStatement !== undefined) data.positioningStatement = positioningStatement?.trim();

      const nonStringFields: (keyof typeof rest)[] = [
        'defaultTaxRate', 'complianceData', 'storeEnabled', 'businessHours', 'messageIntakeEnabled',
      ];
      for (const key of nonStringFields) {
        if (rest[key] !== undefined) {
          data[key] = rest[key];
        }
      }

      if (acceptingWork !== undefined) {
        data.acceptingWork = acceptingWork;
      }

      if (skills !== undefined) {
        data.skills = skills.map((s) => s.trim());
      }
      if (interests !== undefined) {
        data.interests = interests.map((s) => s.trim());
      }
      if (preferredProjectTypes !== undefined) {
        data.preferredProjectTypes = preferredProjectTypes.map((s) => s.trim());
      }

      if (lastHealthCheck) {
        data.lastHealthCheck = new Date(lastHealthCheck);
      }

      if (metaData) {
        const existingMeta = (oldBusiness.metaData as Record<string, any>) || {};
        const merged: Record<string, unknown> = { ...existingMeta, ...metaData };
        applyPaymentSecretWrites(merged, existingMeta, metaData);
        data.metaData = merged;
      }

      const getStr = (key: string): string | null => {
        const v = data[key] ?? (oldBusiness as Record<string, unknown>)[key];
        return typeof v === 'string' ? v : null;
      };
      const getStrArr = (key: string): string[] => {
        const v = data[key] ?? (oldBusiness as Record<string, unknown>)[key];
        return Array.isArray(v) ? (v as string[]) : [];
      };
      data.profileCompleteness = computeProfileCompleteness({
        name: getStr('name'),
        logoUrl: getStr('logoUrl'),
        headline: getStr('headline'),
        bio: getStr('bio'),
        industry: getStr('industry'),
        skills: getStrArr('skills'),
        businessStage: getStr('businessStage'),
        city: getStr('city'),
        country: getStr('country'),
        interests: getStrArr('interests'),
        tagline: getStr('tagline'),
        description: getStr('description'),
        positioningStatement: getStr('positioningStatement'),
        currentCapacity: getStr('currentCapacity'),
        preferredProjectTypes: getStrArr('preferredProjectTypes'),
      });

      const result = await tx.business.update({
        where: { id: businessId },
        data,
      });

      // W7-SLUG-PRESENCE-DRAFT (owner ruling D-11, review CR-1): a presence
      // draft saved before this PATCH still carries an older slug, and the
      // owner's next presence publish copies the draft's slug onto
      // Business.slug, which put the replaced address back. When the PATCH
      // moves the slug, the draft's slug follows it in this transaction (a
      // draft with no slug stays without one; see
      // draftPayloadFollowingBusinessSlug). A PATCH that keeps the slug leaves
      // the draft untouched.
      // Repair SEC-W7SPD-1: the draft row is locked (FOR UPDATE) before it is
      // read, so no draft write lands between this read and the write below;
      // PresenceService.saveDraft also takes FOR SHARE on the business row this
      // transaction holds FOR NO KEY UPDATE, so a member's save waits for the
      // PATCH (and the PATCH for a save already in flight) instead of putting
      // the replaced slug back or being overwritten by the older draft.
      // Repair SEC-W7SPD-2 / CRR-1: the draft remembers the replaced slugs
      // (the draft's and oldBusiness.slug), so a non-owner's editor still
      // sending one of them keeps saving content.
      if (typeof data.slug === 'string' && data.slug !== oldBusiness.slug) {
        await tx.$queryRaw`SELECT id FROM site_page_drafts WHERE business_id = ${businessId} FOR UPDATE`;
        const draft = await tx.sitePageDraft.findUnique({ where: { businessId }, select: { payload: true } });
        const followed = draft ? draftPayloadFollowingBusinessSlug(draft.payload, data.slug, oldBusiness.slug) : undefined;
        if (followed) await tx.sitePageDraft.update({ where: { businessId }, data: { payload: followed } });
      }
      return { oldBusiness, result };
    }, PROFILE_PATCH_TX_OPTIONS);

    const oldBusinessRecord = previous as Record<string, unknown>;
    const changedFields = Object.keys(rest).filter((k) => {
      const key = k as keyof typeof rest;
      if (rest[key] === undefined) return false;
      const oldVal = oldBusinessRecord[k];
      const newVal = rest[key];
      return JSON.stringify(oldVal) !== JSON.stringify(newVal);
    });

    if (changedFields.length > 0) {
      this.detectDocumentImpact(businessId, changedFields, previous.name).catch((err) =>
        this.logger.warn(`Document impact detection failed for business "${previous.name}" (${businessId}): ${err?.message ?? err}`),
      );

      // Mirror the changed Business fields into the BusinessBlueprint so KEY's
      // grounding (and every AI surface that pulls blueprint context) stays in
      // sync with day-to-day profile edits. Best-effort, non-blocking — a
      // failed mirror must never break the underlying business update.
      const mirrored: Record<string, unknown> = {};
      for (const field of changedFields) {
        const answerKey = BUSINESS_FIELD_TO_BLUEPRINT_ANSWER[field];
        if (!answerKey) continue;
        const value = (rest as Record<string, unknown>)[field];
        if (value !== undefined) mirrored[answerKey] = value;
      }
      if (Object.keys(mirrored).length > 0) {
        this.blueprint.inferFromOnboarding(businessId, mirrored).catch((err) =>
          this.logger.warn(`Blueprint mirror failed for business ${businessId}: ${(err as Error)?.message ?? err}`),
        );
      }
    }

    // R0-09 review (R09-ST-1): the updated row carries every Business OAuth
    // token column; GET already redacts them, so the PATCH response and the
    // KEY settings adapter's connector result must too.
    return sanitizeBusiness(result);
  }

  async getBusinessCommunityProfile(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        headline: true,
        bio: true,
        industry: true,
        skills: true,
        businessStage: true,
        city: true,
        country: true,
        interests: true,
        profileCompleteness: true,
        tagline: true,
        acceptingWork: true,
        currentCapacity: true,
        leadTime: true,
        preferredProjectTypes: true,
        budgetFit: true,
        positioningStatement: true,
        createdAt: true,
        products: {
          where: { isActive: true },
          select: { id: true, name: true, price: true, currency: true, category: true, imageUrl: true, description: true },
          take: 6,
          orderBy: { createdAt: 'desc' },
        },
        services: {
          select: { id: true, name: true, price: true, duration: true, description: true },
          take: 6,
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: {
            communityPosts: true,
            cohortMembers: true,
            networkConnectionsTo: true,
            endorsementsReceived: true,
          },
        },
      },
    });
    if (!business) throw new NotFoundException('Business not found');
    return business;
  }

  /**
   * KF-EXEC-AUTH-001: these were a SECOND, divergent copy of ModuleScopeGuard's tables.
   *
   * This list held 11 keys; the guard enforces 14. The two missing ones were
   * `operations` and `analytics`, and because every writer below persists an explicit
   * scope map — which the guard reads INSTEAD of its own defaults — every member
   * invited here was denied on all 58 `operations` routes and all 14 `analytics`
   * routes. `validateScopesPayload` then rejected both names as `Invalid module`, so
   * an admin could not grant them back either. Only the founding owner escaped it,
   * because the TENANT-001 constructor writes no scope map at all.
   *
   * Both now come from `core/authority/module-vocabulary`, the single table the guard
   * also reads. The role defaults are the guard's pre-existing values, so this
   * converges the writer on semantics that were already declared rather than minting
   * a new role policy. `connect` joins the vocabulary at 'none' for every role and is
   * reachable only through an explicit validated grant.
   */
  static readonly PERMISSION_MODULES = CANONICAL_MODULES;

  static readonly DEFAULT_SCOPES: Record<string, Record<string, string>> = ROLE_DEFAULT_SCOPES;

  static readonly DEFAULT_APPROVAL_TIERS: Record<string, number> = CANONICAL_APPROVAL_TIERS;

  private resolveScopes(membership: { role: string; permissionScopes: unknown }): Record<string, string> {
    if (membership.permissionScopes && typeof membership.permissionScopes === 'object') {
      return membership.permissionScopes as Record<string, string>;
    }
    return IdentityService.DEFAULT_SCOPES[membership.role] ?? IdentityService.DEFAULT_SCOPES.STAFF;
  }

  /**
   * One of three identical copies of this rule before KF-EXEC-AUTH-001. Now delegates
   * to the canonical helper, which is a transcription of this exact logic — CG-REVIEW
   * chose R2_FREEZE_EXISTING_RULE, so the result must not change for any input.
   */
  private resolveApprovalTier(membership: { role: string; maxApprovalTier: number | null; permissionScopes?: unknown }): number {
    return membershipApprovalTier(membership);
  }

  /**
   * `minLevel` is the team scope a requester who is neither the OWNER nor a
   * SUPER_ADMIN must hold: 'write' for invite and remove (their routes are guarded at
   * team:write), 'admin' for a role or permissions change, both of which rewrite the
   * target's scope map and tier (PATCH .../permissions and, since
   * R0-ID-F1-ROLE-ROUTE-AUTHORITY ST-1, PATCH .../team/:m are guarded at team:admin).
   *
   * Returns the requester's membership, and `bounded: true` when the requester's own
   * authority caps what it may grant — every member except the OWNER and a SUPER_ADMIN.
   */
  private async assertTeamAdmin(
    businessId: string,
    requesterId: string,
    minLevel: 'write' | 'admin' = 'write',
  ): Promise<{ requester: { userId: string; role: string; permissionScopes: unknown; maxApprovalTier: number }; bounded: boolean }> {
    const requester = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: requesterId, businessId } },
    });
    if (!requester) throw new ForbiddenException('You are not a member of this business');
    if (requester.role === 'OWNER') return { requester, bounded: false };
    const user = await this.prisma.client.user.findUnique({ where: { id: requesterId } });
    if (user?.role === 'SUPER_ADMIN') return { requester, bounded: false };
    const scopes = this.resolveScopes(requester);
    if (scopes.team !== 'admin' && (minLevel === 'admin' || scopes.team !== 'write')) {
      throw new ForbiddenException(
        minLevel === 'admin' ? 'Changing a role or permissions requires team admin access' : 'You do not have permission to manage team members',
      );
    }
    return { requester, bounded: true };
  }

  /**
   * The first dimension in which `subject` holds more authority than `bound`, or null
   * when it holds no more in any. Each dimension is read the way its enforcer reads it:
   *   - the role, ranked STAFF < ADMIN < OWNER, as the role-name gates read it
   *     (ROLE_RANK; V1-07 review F1): without it a bounded STAFF member minted an
   *     ADMIN-role account with every scope 'none', and that account could set AI
   *     autonomy and approve tier-4 plans, both of which refuse its inviter;
   *   - every canonical module level, as ModuleScopeGuard does (explicit map, missing
   *     key = none; no map = role defaults);
   *   - the approval tier, as membershipApprovalTier does;
   *   - CRM ownership (level, crm_view, crm_edit, crm_reassign, crm_delete), as
   *     resolveCrmAccess does — a map with no crm_* keys falls back to the level's
   *     defaults there, so omitting them is not a restriction (ST-F3).
   */
  private async authorityExcess(subject: AuthorityEnvelope, bound: AuthorityEnvelope): Promise<string | null> {
    if (roleRank(subject.role) > roleRank(bound.role)) return 'role';
    const s = this.resolveScopes(subject);
    const b = this.resolveScopes(bound);
    for (const module of CANONICAL_MODULES) {
      if (rankOf(s[module]) > rankOf(b[module])) return module;
    }
    if (this.resolveApprovalTier(subject) > this.resolveApprovalTier(bound)) return 'maxApprovalTier';
    const [sc, bc] = await Promise.all([crmAccessOf(subject), crmAccessOf(bound)]);
    if (rankOf(sc.level) > rankOf(bc.level)) return 'crm';
    if (sc.viewAll && !bc.viewAll) return 'crm_view';
    if (crmScopeRank(sc.editScope) > crmScopeRank(bc.editScope)) return 'crm_edit';
    if (sc.reassign && !bc.reassign) return 'crm_reassign';
    if (crmScopeRank(sc.deleteScope) > crmScopeRank(bc.deleteScope)) return 'crm_delete';
    return null;
  }

  /**
   * R0-ID-F1-ROLE-ROUTE-AUTHORITY: the rules every write of another member's scope map
   * and approval tier obeys (PATCH .../team/:m {role} and PATCH .../team/:m/permissions).
   * Runs after the OWNER-membership check, so the target is never the OWNER here.
   *   - a non-OWNER cannot change its own membership (ST-1, ST-F1);
   *   - a bounded requester cannot change a member whose CURRENT authority exceeds its
   *     own in any dimension (ST-F5) ...
   *   - ... nor leave it with more authority than its own (K2; ST-F2, ST-F3).
   * The OWNER and a SUPER_ADMIN are not bounded.
   */
  private async assertMayRewriteAuthority(
    requesterId: string,
    requester: AuthorityEnvelope,
    bounded: boolean,
    target: AuthorityEnvelope & { userId: string },
    granted: AuthorityEnvelope,
  ): Promise<void> {
    if (target.userId === requesterId && requester.role !== 'OWNER') {
      throw new ForbiddenException('You cannot change your own role or permissions');
    }
    if (!bounded) return;
    if (await this.authorityExcess(target, requester)) {
      throw new ForbiddenException('You cannot change a member whose authority exceeds your own');
    }
    if (await this.authorityExcess(granted, requester)) {
      throw new ForbiddenException('You cannot grant more authority than your own');
    }
  }

  async listTeamMembers(businessId: string) {
    const members = await this.prisma.client.membership.findMany({
      where: { businessId },
      include: {
        user: { select: { id: true, email: true, name: true, firstName: true, lastName: true, avatarUrl: true } },
        orgAssignments: {
          where: { endedAt: null, isPrimary: true },
          include: { orgUnit: true, jobRole: true },
          take: 1,
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => ({
      ...m,
      permissionScopes: this.resolveScopes(m),
      maxApprovalTier: this.resolveApprovalTier(m),
      orgUnit: m.orgAssignments[0]?.orgUnit?.name ?? null,
      jobRole: m.orgAssignments[0]?.jobRole?.name ?? null,
      orgUnitId: m.orgAssignments[0]?.orgUnitId ?? null,
      jobRoleId: m.orgAssignments[0]?.jobRoleId ?? null,
    }));
  }

  /**
   * POST .../team (team:write). V1-07-AUTH-INVITE-CEILING (CF-26; ST-F4 in
   * identity-boundary.integration.test.ts): the new membership is a grant, so it is
   * bounded by the inviter's own authority exactly as a role or permissions change is
   * (K2) — the role, every canonical module level, the approval tier and CRM ownership,
   * the role defaults included when no scopes are given. Above it the invite is REFUSED
   * with 403 before any User or Membership is written; it is not clamped, which would
   * create a member with less than was asked for and no signal. The OWNER and a
   * SUPER_ADMIN are not bounded. Without this a team:write member invited an account it
   * controls with team:admin, which then rewrote the inviter through the role route.
   *
   * Consequence for callers that send no scopes (KEY's add_team_member, and POST
   * .../team without scopes): the 14-module role defaults are the grant, so an inviter
   * whose explicit map lacks a module those defaults hold is refused. An ADMIN invited
   * through the web team form holds that form's 11-key map, which has no `analytics`
   * and no `operations`, so its no-scope STAFF invite is refused (STAFF defaults hold
   * both at read); it was created before V1-07. Under K2 that is correct — the ADMIN
   * really lacks both — and an invite with explicit scopes within its own (the web
   * form's STAFF map) still succeeds. Converging the web form's DEFAULT_SCOPES on
   * core/authority/module-vocabulary is a follow-up outside this packet's write set.
   */
  async inviteTeamMember(businessId: string, email: string, role: string, inviterId: string, scopes?: Record<string, string>, maxApprovalTier?: number) {
    const { requester, bounded } = await this.assertTeamAdmin(businessId, inviterId);
    this.validateRole(role);
    const permissionScopes = scopes ?? (IdentityService.DEFAULT_SCOPES[role] || IdentityService.DEFAULT_SCOPES.STAFF);
    const tier = maxApprovalTier ?? (IdentityService.DEFAULT_APPROVAL_TIERS[role] || 0);
    if (scopes || maxApprovalTier !== undefined) {
      this.validateScopesPayload(permissionScopes, tier);
    }
    if (bounded && (await this.authorityExcess({ role, permissionScopes, maxApprovalTier: tier }, requester))) {
      throw new ForbiddenException('You cannot grant more authority than your own');
    }
    let user = await this.prisma.client.user.findUnique({ where: { email } });
    if (!user) {
      // The invitee has no account yet, so this row is a placeholder that holds
      // the address and the pending membership. The marker is what lets the
      // invitee's first bootstrap adopt it (adoptInvitePlaceholder); a row
      // without it is never moved to another sign-in (R0-SEC-01).
      user = await this.prisma.client.user.create({
        data: {
          email,
          name: email.split('@')[0],
          role: 'USER',
          metaData: { [IdentityService.INVITE_PLACEHOLDER_KEY]: true },
        },
      });
    }
    const existing = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: user.id, businessId } },
    });
    if (existing) throw new BadRequestException('User is already a team member');
    const membership = await this.prisma.client.membership.create({
      data: {
        userId: user.id,
        businessId,
        role,
        permissionScopes,
        maxApprovalTier: tier,
      },
      include: { user: { select: { id: true, email: true, name: true, firstName: true, lastName: true, avatarUrl: true } } },
    });
    await this.logTeamActivity(businessId, inviterId, 'team', 'member_invited', 'membership', membership.id, `Invited ${email} as ${role}`, undefined, { invitedEmail: email, role });
    return membership;
  }

  async removeTeamMember(businessId: string, membershipId: string, requesterId: string) {
    await this.assertTeamAdmin(businessId, requesterId);
    const membership = await this.prisma.client.membership.findUnique({
      where: { id: membershipId },
      include: { user: { select: { email: true } } },
    });
    if (!membership || membership.businessId !== businessId) {
      throw new NotFoundException('Membership not found');
    }
    if (membership.role === 'OWNER') {
      throw new BadRequestException('Cannot remove the owner');
    }
    await this.prisma.client.membership.delete({ where: { id: membershipId } });
    await this.logTeamActivity(businessId, requesterId, 'team', 'member_removed', 'membership', membershipId, `Removed ${membership.user.email} from team`, undefined, { removedEmail: membership.user.email });
    return { success: true };
  }

  /**
   * R0-ID-F1-ROLE-ROUTE-AUTHORITY (ST-1). A role change overwrites the target's scope
   * map and approval tier with the role defaults, so it is a permissions write. It
   * needed only team:write, which let a team:write member undo an OWNER's restriction
   * on itself or widen anyone else's without the team:admin gate on .../permissions.
   * Now (assertMayRewriteAuthority, shared with updateMemberPermissions):
   *   - the requester must be the OWNER, a SUPER_ADMIN, or hold team:admin, the same
   *     authority PATCH .../permissions needs; with no requester it fails closed;
   *   - a non-OWNER cannot change its own membership through either route;
   *   - a bounded requester cannot change a member whose current authority exceeds its
   *     own, nor grant a role whose defaults exceed its own authority: no role above its
   *     own (a STAFF with team:admin cannot make an ADMIN, nor change one, even when its
   *     scope map equals the ADMIN defaults; V1-07 review F1), no module above its own
   *     level, no approval tier above its own, no CRM ownership authority above its own
   *     (K2).
   * The OWNER role is not assignable here (validateRole) and the OWNER membership
   * cannot be changed here; there is no ownership-transfer route.
   *
   * The team:write invite route applies the same grant ceiling (V1-07, inviteTeamMember).
   * NOT closed here (a route outside this service, pinned as OPEN DEFECT CR-1 in
   * identity-boundary.integration.test.ts): the team:write structure routes copy a
   * JobRole's permissions and tier onto any membership in the business, the caller's
   * own included (V1-21).
   */
  async updateMemberRole(businessId: string, membershipId: string, role: string, requesterId: string) {
    this.validateRole(role);
    if (!requesterId) throw new ForbiddenException('A role change needs an authenticated requester');
    const { requester, bounded } = await this.assertTeamAdmin(businessId, requesterId, 'admin');
    const membership = await this.prisma.client.membership.findUnique({
      where: { id: membershipId },
    });
    if (!membership || membership.businessId !== businessId) {
      throw new NotFoundException('Membership not found');
    }
    if (membership.role === 'OWNER') {
      throw new BadRequestException('Cannot change owner role');
    }
    const permissionScopes = IdentityService.DEFAULT_SCOPES[role] || IdentityService.DEFAULT_SCOPES.STAFF;
    const maxApprovalTier = IdentityService.DEFAULT_APPROVAL_TIERS[role] || 0;
    await this.assertMayRewriteAuthority(requesterId, requester, bounded, membership, { role, permissionScopes, maxApprovalTier });
    const updated = await this.prisma.client.membership.update({
      where: { id: membershipId },
      data: { role, permissionScopes, maxApprovalTier },
      include: { user: { select: { id: true, email: true, name: true, firstName: true, lastName: true, avatarUrl: true } } },
    });
    await this.logTeamActivity(businessId, requesterId, 'team', 'role_changed', 'membership', membershipId, `Changed ${updated.user.email} role to ${role}`, undefined, { newRole: role });
    return updated;
  }

  /**
   * `users.meta_data` key that inviteTeamMember sets on the placeholder User it
   * creates for an address with no account. Only the server writes User
   * metadata; no route lets a caller set it.
   */
  private static readonly INVITE_PLACEHOLDER_KEY = 'invitePlaceholder';

  private static isMarkedInvitePlaceholder(metaData: unknown): boolean {
    return (
      typeof metaData === 'object' &&
      metaData !== null &&
      (metaData as Record<string, unknown>)[IdentityService.INVITE_PLACEHOLDER_KEY] === true
    );
  }

  private static readonly ASSIGNABLE_ROLES = ['ADMIN', 'STAFF'] as const;

  private validateRole(role: string): void {
    if (!(IdentityService.ASSIGNABLE_ROLES as readonly string[]).includes(role)) {
      throw new BadRequestException(`Invalid role: ${role}. Allowed roles: ${IdentityService.ASSIGNABLE_ROLES.join(', ')}`);
    }
  }

  private validateScopesPayload(scopes: Record<string, string>, tier: number): void {
    const validLevels = new Set(ACCESS_LEVELS as readonly string[]);
    // The canonical vocabulary, so what this accepts and what the guard enforces can
    // no longer drift apart — that divergence is what closed 72 routes.
    const validModules = new Set(CANONICAL_MODULES as readonly string[]);
    // M7 CRM ownership sub-permissions layered on top of the per-module level.
    const crmExtraKeys: Record<string, ReadonlySet<string>> = CRM_SUBPERMISSION_VALUES;
    for (const [key, value] of Object.entries(scopes)) {
      if (validModules.has(key)) {
        if (!validLevels.has(value)) throw new BadRequestException(`Invalid permission level: ${value} for module ${key}`);
        continue;
      }
      const allowed = crmExtraKeys[key];
      if (allowed) {
        if (!allowed.has(value)) throw new BadRequestException(`Invalid value '${value}' for ${key}`);
        continue;
      }
      throw new BadRequestException(`Invalid module: ${key}`);
    }
    if (typeof tier !== 'number' || tier < 0 || tier > 4 || !Number.isInteger(tier)) {
      throw new BadRequestException('maxApprovalTier must be an integer between 0 and 4');
    }
  }

  /**
   * PATCH .../team/:m/permissions. The service gate is team:admin, as the route's guard
   * metadata always was (it was team:write here). R0-ID-F1-ROLE-ROUTE-AUTHORITY review
   * repairs: the same rules as a role change (assertMayRewriteAuthority) — no self-target
   * for a non-OWNER (ST-F1), no rewrite of a member above the requester (ST-F5), and no
   * grant above the requester's own authority, CRM ownership sub-permissions included
   * (K2; ST-F2, ST-F3).
   */
  async updateMemberPermissions(businessId: string, membershipId: string, scopes: Record<string, string>, maxApprovalTier: number, requesterId: string) {
    if (!requesterId) throw new ForbiddenException('A permissions change needs an authenticated requester');
    const { requester, bounded } = await this.assertTeamAdmin(businessId, requesterId, 'admin');
    this.validateScopesPayload(scopes, maxApprovalTier);
    const membership = await this.prisma.client.membership.findUnique({
      where: { id: membershipId },
    });
    if (!membership || membership.businessId !== businessId) {
      throw new NotFoundException('Membership not found');
    }
    if (membership.role === 'OWNER') {
      throw new BadRequestException('Cannot modify owner permissions');
    }
    await this.assertMayRewriteAuthority(requesterId, requester, bounded, membership, {
      role: membership.role,
      permissionScopes: scopes,
      maxApprovalTier,
    });
    const updated = await this.prisma.client.membership.update({
      where: { id: membershipId },
      data: { permissionScopes: scopes, maxApprovalTier },
      include: { user: { select: { id: true, email: true, name: true, firstName: true, lastName: true, avatarUrl: true } } },
    });
    await this.logTeamActivity(businessId, requesterId, 'team', 'permissions_updated', 'membership', membershipId, `Updated permissions for ${updated.user.email}`, undefined, { scopes, maxApprovalTier });
    return {
      ...updated,
      permissionScopes: scopes,
    };
  }

  async logTeamActivity(businessId: string, userId: string, module: string, action: string, entityType?: string, entityId?: string, title?: string, detail?: string, meta?: Record<string, unknown>) {
    try {
      await this.prisma.client.teamActivityLog.create({
        data: {
          businessId,
          userId,
          module,
          action,
          title: title ?? action,
          ...(entityType !== undefined ? { entityType } : {}),
          ...(entityId !== undefined ? { entityId } : {}),
          ...(detail !== undefined ? { detail } : {}),
          ...(meta !== undefined ? { meta } : {}),
        },
      });
    } catch (e) {
      this.logger.warn(`Failed to log team activity: ${e instanceof Error ? e.message : e}`);
    }
  }

  async getTeamActivityFeed(businessId: string, opts: { limit?: number; offset?: number; module?: string; userId?: string }) {
    const where: Record<string, unknown> = { businessId };
    if (opts.module) where.module = opts.module;
    if (opts.userId) where.userId = opts.userId;
    const [items, total] = await Promise.all([
      this.prisma.client.teamActivityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: opts.limit || 50,
        skip: opts.offset || 0,
      }),
      this.prisma.client.teamActivityLog.count({ where }),
    ]);
    return { items, total };
  }

  async getTeamDashboard(businessId: string) {
    const members = await this.listTeamMembers(businessId);
    const [recentActivity, taskCounts] = await Promise.all([
      this.prisma.client.teamActivityLog.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.client.contactTask.groupBy({
        by: ['assigneeId'],
        where: { businessId, status: 'OPEN', deletedAt: null, assigneeId: { not: null } },
        _count: true,
      }).catch(() => []),
    ]);

    const taskCountMap = new Map<string, number>();
    for (const t of taskCounts) {
      if (t.assigneeId) taskCountMap.set(t.assigneeId, t._count);
    }

    const memberSummaries = members.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      user: m.user,
      permissionScopes: m.permissionScopes,
      maxApprovalTier: m.maxApprovalTier,
      activeTasks: taskCountMap.get(m.userId) ?? 0,
      recentActions: recentActivity.filter((a) => a.userId === m.userId).slice(0, 3),
    }));

    return {
      members: memberSummaries,
      totalMembers: members.length,
      recentActivity: recentActivity.slice(0, 10),
      permissionModules: IdentityService.PERMISSION_MODULES,
    };
  }

  async getMemberApprovalTier(businessId: string, userId: string): Promise<number> {
    const membership = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId, businessId } },
    });
    if (!membership) return 0;
    return this.resolveApprovalTier(membership);
  }

  async getUser(userId: string) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, firstName: true, lastName: true, phone: true, avatarUrl: true, role: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /**
   * Migrate an existing local User row from `oldId` to the new Supabase auth id
   * `input.userId`, in a single transaction.
   *
   * Why this exists: Supabase auth.users.id is the source of truth — every
   * subsequent authenticated request will arrive with the Supabase id, so the
   * local row's primary key must match it. We can't simply `UPDATE users SET
   * id = …` because Postgres FKs in this schema are not declared
   * `ON UPDATE CASCADE` and the unique-email constraint blocks creating a
   * second row with the same email. We therefore: (1) park the old user under
   * a placeholder email to free the unique-email slot, (2) create the new
   * user with the desired id and original email, (3) re-point all child
   * references (FK and non-FK), (4) delete the parked row.
   *
   * NEVER CALLED FOR AN ACCOUNT (R0-SEC-01-BOOTSTRAP-TAKEOVER). bootstrapUser
   * called this on an email match alone, so any caller could take over any
   * account, its role and its businesses: nothing here proves that
   * `input.userId` is the same person as `oldId`. Its one caller is
   * adoptInvitePlaceholder, for a row inviteTeamMember created and nobody ever
   * signed in as, and it passes `guard`, which re-checks that inside this
   * transaction with the row locked. Moving a real account to a new subject is
   * the manual operator migration in docs/auth-pathway.md ("Fixed by R0-SEC-01").
   */
  private async reconcileUserId(
    oldId: string,
    input: {
      userId: string;
      email: string;
      username?: string;
      name?: string;
      firstName?: string;
      lastName?: string;
      phone?: string;
      avatarUrl?: string;
    },
    // Runs first, inside the transaction; a throw rolls everything back.
    guard?: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    const newId = input.userId;
    const desiredName = input.username ?? input.name;

    try {
      return await this.prisma.client.$transaction(async (tx) => {
        if (guard) await guard(tx as unknown as Prisma.TransactionClient);
        // Logged once the guard has admitted the move, not for a refused one.
        this.logger.warn(`Reconciling User id ${oldId} -> ${newId} for email=${input.email}.`);
        const placeholderEmail = `__migrated_${oldId}_${Date.now()}@local.invalid`;
        const oldUser = await tx.user.update({
          where: { id: oldId },
          data: { email: placeholderEmail },
        });

        const newUser = await tx.user.create({
          data: {
            id: newId,
            email: input.email,
            name: oldUser.name ?? desiredName?.trim() ?? input.email,
            role: oldUser.role ?? 'USER',
            firstName: oldUser.firstName ?? input.firstName?.trim() ?? null,
            lastName: oldUser.lastName ?? input.lastName?.trim() ?? null,
            phone: oldUser.phone ?? input.phone?.trim() ?? null,
            avatarUrl: oldUser.avatarUrl ?? input.avatarUrl?.trim() ?? null,
            referralCode: await this.generateReferralCode(),
          },
        });

        // FK references to User.id (must be re-pointed before old user delete).
        // These match the relations declared in packages/db/prisma/schema.prisma:
        // Membership.userId, Session.userId, AiExecutionLog.userId,
        // AiApprovalItem.userId, AiApprovalItem.resolvedByUserId, AiPlan.userId.
        await tx.membership.updateMany(
          skipTenantIsolation({ where: { userId: oldId }, data: { userId: newId } }),
        );
        await tx.session.updateMany({ where: { userId: oldId }, data: { userId: newId } });
        await tx.aiExecutionLog.updateMany({ where: { userId: oldId }, data: { userId: newId } });
        await tx.aiApprovalItem.updateMany({ where: { userId: oldId }, data: { userId: newId } });
        await tx.aiApprovalItem.updateMany({
          where: { resolvedByUserId: oldId },
          data: { resolvedByUserId: newId },
        });
        await tx.aiPlan.updateMany({ where: { userId: oldId }, data: { userId: newId } });

        // Non-FK references (no constraint declared in schema, but data
        // integrity still matters): Business.ownerId, TeamActivityLog.userId.
        await tx.business.updateMany({ where: { ownerId: oldId }, data: { ownerId: newId } });
        await tx.teamActivityLog.updateMany({ where: { userId: oldId }, data: { userId: newId } });

        // W6-IDENTITY-REKEY-CREATOR (owner ruling D-73): the member a trigger rule records as its
        // creator, whose plans it fires run as, kept in the rule's own JSON config:
        // AgentTrigger.condition (W5-AGENT-TRIGGERS-AUTHORITY) and KeyCortexTriggerRule.filterJson
        // (KEY-R3b-PLAN-AUTHORITY). Left on the old id, the rule fires a plan for a deleted user whose
        // ai_plans insert fails on the user foreign key. jsonb_set changes that one key in place, in
        // every business, and leaves the rule's own filter as it is.
        // Reach (review SEC-RKC-1, RK-CR-1): this method's one caller moves a never-signed-in invite
        // placeholder, and every rule writer records the authenticated member as the creator, so through
        // the API these match no row today; they keep this re-key complete. A real account moves to a new
        // subject only by the manual operator step in docs/auth-pathway.md ("Fixed by R0-SEC-01", step 4),
        // which runs these same two statements with the old and the new id; without them that member's
        // rules keep the deleted id: their plans fail on the user foreign key and the member gets 403
        // AGENT_TRIGGER_CREATOR_ONLY on their own rule. Since W7-AUTH-DOCS-REKEY (D-73) the step names
        // them, and the live case RK-03 in test/identity-rekey-creator.integration.test.ts runs them as
        // written (W8-HOUSEKEEPING: this comment called RK-03 an it.todo).
        await tx.$executeRaw`UPDATE agent_triggers
          SET condition = jsonb_set(condition, ARRAY[${TRIGGER_CREATOR_KEY}::text], to_jsonb(${newId}::text))
          WHERE condition ->> ${TRIGGER_CREATOR_KEY}::text = ${oldId}::text`;
        await tx.$executeRaw`UPDATE key_cortex_trigger_rules
          SET filter_json = jsonb_set(filter_json, ARRAY[${TRIGGER_CREATOR_KEY}::text], to_jsonb(${newId}::text))
          WHERE filter_json ->> ${TRIGGER_CREATOR_KEY}::text = ${oldId}::text`;

        await tx.user.delete({ where: { id: oldId } });
        return newUser;
      });
    } catch (err: any) {
      const code = (err as { code?: string })?.code;
      if (code === 'P2002') {
        this.logger.warn(
          `[bootstrap] email conflict during reconcile (userId=${input.userId})`,
        );
        throw new ConflictException({
          code: 'account_email_conflict',
          message:
            'An account with this email already exists. Please sign in with email and password instead.',
        });
      }
      throw err;
    }
  }

  private async generateReferralCode(): Promise<string> {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code: string;
    let attempts = 0;
    do {
      code = '';
      for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      const existing = await this.prisma.client.user.findUnique({ where: { referralCode: code }, select: { id: true } });
      if (!existing) return code;
      attempts++;
    } while (attempts < 10);
    // Fallback with timestamp suffix if collisions persist
    return code + Date.now().toString(36).slice(-4).toUpperCase();
  }

  async bootstrapUser(input: {
    userId: string;
    email: string;
    username?: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    avatarUrl?: string;
    company?: string;
    referralCode?: string;
    /**
     * D-97 (W8-RISC-SIGNIN-CUTOFF) / W7-RISC-REVOKE review SEC-W7RR-1: the
     * VERIFIED provider record's identities only (IdentityController reads
     * them from GoTrue's admin user record for the token's subject), never a
     * request body's: persistUserIdentities upserts each Google sub onto this
     * user, and a RISC event for that sub then revokes this user's sessions.
     */
    identities?: UserIdentityDataDto[];
  }, options: {
    /**
     * Resolves true only when the caller is proven to own `input.email`. Asked
     * only when a pending team invitation holds the address, and never for an
     * account. Absent means unproven.
     */
    proveEmailOwnership?: () => Promise<boolean>;
  } = {}) {
    if (input.username) {
      const usernameInUse = await this.prisma.client.user.findFirst({
        where: { name: input.username, NOT: { id: input.userId } },
        select: { id: true },
      });
      if (usernameInUse) {
        throw new BadRequestException('Username is already taken.');
      }
    }

    const desiredName = input.username ?? input.name;

    const existingUser = await this.prisma.client.user.findUnique({ where: { id: input.userId } });
    let user;

    let referredByUserId: string | undefined;
    if (input.referralCode && input.referralCode.trim()) {
      const referrer = await this.prisma.client.user.findUnique({
        where: { referralCode: input.referralCode.trim().toUpperCase() },
        select: { id: true },
      });
      if (referrer) referredByUserId = referrer.id;
    }

    if (existingUser) {
      const updateData: Record<string, unknown> = {};
      if (input.firstName && !existingUser.firstName) updateData.firstName = input.firstName.trim();
      if (input.lastName && !existingUser.lastName) updateData.lastName = input.lastName.trim();
      if (input.phone && !existingUser.phone) updateData.phone = input.phone.trim();
      if (input.avatarUrl && !existingUser.avatarUrl) updateData.avatarUrl = input.avatarUrl.trim();
      if (desiredName && !existingUser.name) {
        updateData.name = desiredName.trim();
      }
      if (!existingUser.referralCode) {
        updateData.referralCode = await this.generateReferralCode();
      }
      if (referredByUserId && !existingUser.referredByUserId) {
        updateData.referredByUserId = referredByUserId;
      }

      if (Object.keys(updateData).length > 0) {
        user = await this.prisma.client.user.update({
          where: { id: input.userId },
          data: updateData,
        });
      } else {
        user = existingUser;
      }
    } else {
      // Look up by email before creating: a local User may already hold this
      // address under a different id (task #308). R0-SEC-01-BOOTSTRAP-TAKEOVER:
      // an account is NEVER moved to the caller. Bootstrap used to call
      // reconcileUserId here, which re-created the row under the caller's id
      // with its role (SUPER_ADMIN included) and re-pointed its memberships and
      // Business.ownerId, on nothing more than an email match: an account
      // takeover. A local User is bound to the verified token subject, so a
      // different-id holder is a 409 and nothing is written. Moving a row to a
      // new subject (same person, new Supabase project) is an operator step
      // (docs/auth-pathway.md, "Fixed by R0-SEC-01"). The one row that is not
      // an account is the marked placeholder inviteTeamMember creates for an
      // address with no account; the invitee's first bootstrap adopts it
      // under the conditions in adoptInvitePlaceholder (review repair
      // SEC01-T1/CR-1).
      const collidingByEmail = await this.prisma.client.user.findUnique({
        where: { email: input.email },
        select: { id: true, metaData: true },
      });

      if (collidingByEmail && collidingByEmail.id !== input.userId) {
        if (!IdentityService.isMarkedInvitePlaceholder(collidingByEmail.metaData)) {
          throw this.emailInUse(input.userId);
        }
        user = await this.adoptInvitePlaceholder(collidingByEmail.id, input, options.proveEmailOwnership);
      } else {
        const userData: Record<string, unknown> = {};
        if (input.firstName) userData.firstName = input.firstName.trim();
        if (input.lastName) userData.lastName = input.lastName.trim();
        if (input.phone) userData.phone = input.phone.trim();
        if (input.avatarUrl) userData.avatarUrl = input.avatarUrl.trim();

        try {
          user = await this.prisma.client.user.create({
            data: {
              id: input.userId,
              email: input.email,
              name: desiredName?.trim() ?? input.email,
              role: 'USER',
              referralCode: await this.generateReferralCode(),
              referredByUserId,
              ...userData,
            },
          });
        } catch (err: any) {
          // Defence-in-depth: if a race created a colliding row between the
          // findUnique above and the create here, surface a clean 409 instead
          // of an opaque Prisma 500.
          const code = (err as { code?: string })?.code;
          if (code === 'P2002') {
            this.logger.warn(
              `[bootstrap] email conflict on user create (userId=${input.userId})`,
            );
            throw new ConflictException({
              code: 'account_email_conflict',
              message:
                'An account with this email already exists. Please sign in with email and password instead.',
            });
          }
          throw err;
        }
      }
    }

    // Persist external identity-provider links (Google sub, etc.) so that
    // Cross-Account Protection (RISC) events can be mapped back to this user.
    await this.persistUserIdentities(user.id, input.identities);

    const businessName = (input.company || `${input.firstName || desiredName}'s Workspace`).trim();

    const { business, isNewBusiness } = await this.ensureBootstrapWorkspace(user.id, businessName);

    // R0-SEC2b review SEC2b-R1: POST /identity/bootstrap answers the business it
    // found, a Business read like GET /identity/businesses/:id: no OAuth token
    // column and metaData.whatsapp masked, for the owner too.
    return { user, business: sanitizeBusiness(business), isNewBusiness };
  }

  /** 409 for an address another local account holds; bootstrap writes nothing. */
  private emailInUse(userId: string): ConflictException {
    this.logger.warn(`[bootstrap] refused: the token email is held by another local user (userId=${userId})`);
    return new ConflictException({
      code: 'account_email_in_use',
      message:
        'This email address already belongs to another account. Sign in with that account, or contact support to move it to this sign-in.',
    });
  }

  /** 409 for a pending invitation the caller has not proven the address for; bootstrap writes nothing. */
  private inviteNeedsProvenEmail(userId: string): ConflictException {
    this.logger.warn(`[bootstrap] refused: a pending invitation holds the token email, ownership not proven (userId=${userId})`);
    return new ConflictException({
      code: 'invite_email_unverified',
      message:
        'This email address has a pending team invitation. It can be accepted only by a sign-in that has confirmed the address. ' +
        'Confirm your email address and sign in again, or ask the person who invited you to remove the invitation and invite you again after you sign up.',
    });
  }

  /**
   * R0-SEC-01 review repair (SEC01-T1, CR-1): accept a team invitation on the
   * invitee's first bootstrap.
   *
   * For an address with no account, inviteTeamMember creates a placeholder
   * User (generated id, role USER, the invited address, the invite marker) and
   * hangs the pending membership on it. Before R0-SEC-01 bootstrap adopted it
   * through reconcileUserId on the email match; R0-SEC-01 answered 409 like for
   * an account, so an invitation to anyone without an account could never be
   * accepted, and any user could lock an address out of sign-up by inviting it
   * and removing the membership.
   *
   * The placeholder is moved to the caller's id (reconcileUserId) only while it
   * is still exactly what inviteTeamMember made. assertAdoptableInvitePlaceholder
   * re-checks that inside the move's transaction with the row locked; anything
   * else is an account and keeps the 409 account_email_in_use. The pending
   * memberships grant authority in the inviting business, so they move only when
   * the caller is proven to own the address (`proveEmailOwnership`); otherwise
   * 409 invite_email_unverified and nothing is written. A placeholder with no
   * membership left (the invitation was removed) carries nothing and is adopted
   * without proof.
   */
  private async adoptInvitePlaceholder(
    placeholderId: string,
    input: {
      userId: string;
      email: string;
      username?: string;
      name?: string;
      firstName?: string;
      lastName?: string;
      phone?: string;
      avatarUrl?: string;
    },
    proveEmailOwnership?: () => Promise<boolean>,
  ) {
    // Ask for proof before the transaction, so its round trip holds no lock,
    // and only when there is a pending membership to move.
    const pending = await this.prisma.client.membership.count(
      skipTenantIsolation({ where: { userId: placeholderId } }),
    );
    let proven = false;
    if (pending > 0 && proveEmailOwnership) {
      try {
        proven = (await proveEmailOwnership()) === true;
      } catch {
        proven = false;
      }
    }
    const user = await this.reconcileUserId(placeholderId, input, (tx) =>
      this.assertAdoptableInvitePlaceholder(tx, placeholderId, input, proven),
    );
    this.logger.log(`[bootstrap] adopted an invite placeholder (userId=${input.userId}, pendingMemberships=${pending})`);
    return user;
  }

  /**
   * Inside reconcileUserId's transaction: throw unless `placeholderId` is a
   * never-bound invite placeholder for `input.email` whose pending memberships
   * (if any) the caller may take. Nothing has been written when it throws.
   */
  private async assertAdoptableInvitePlaceholder(
    tx: Prisma.TransactionClient,
    placeholderId: string,
    input: { userId: string; email: string },
    proven: boolean,
  ): Promise<void> {
    // Lock the row. An invite that adds a membership to it takes a key-share
    // lock on it, so it waits for this transaction: the memberships read
    // below are exactly the ones that move.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${placeholderId} FOR UPDATE`;
    const row = await tx.user.findUnique({
      where: { id: placeholderId },
      select: { email: true, role: true, metaData: true, referralCode: true, deletedAt: true, bannedAt: true },
    });
    // Never bound: nobody has signed in as it. Every bootstrap sets a referral
    // code, and only a sign-in creates a session, an identity link or an owned
    // business.
    const neverBound =
      row !== null &&
      row.email === input.email &&
      IdentityService.isMarkedInvitePlaceholder(row.metaData) &&
      row.role === 'USER' &&
      !row.deletedAt &&
      !row.bannedAt &&
      !row.referralCode &&
      (await tx.session.count({ where: { userId: placeholderId } })) === 0 &&
      (await tx.userIdentity.count({ where: { userId: placeholderId } })) === 0 &&
      (await tx.business.count({ where: { ownerId: placeholderId } })) === 0;
    if (!neverBound) throw this.emailInUse(input.userId);

    const memberships = await tx.membership.findMany(
      skipTenantIsolation({ where: { userId: placeholderId }, select: { role: true } }),
    );
    if (memberships.some((m) => m.role === 'OWNER')) throw this.emailInUse(input.userId);
    if (memberships.length > 0 && !proven) throw this.inviteNeedsProvenEmail(input.userId);
  }

  /**
   * Find-or-create the bootstrap workspace for a user, atomically, and converge
   * when two bootstraps for the same user run at once.
   *
   * KF-EXEC-TENANT-001. Two separate defects lived in the old inline version:
   *
   *   1. `business.create` and `membership.upsert` were consecutive awaits with
   *      no transaction. A failure in the gap left a Business with no founding
   *      Membership and no repair path.
   *   2. The find-then-create was unsynchronised. Two concurrent bootstraps for
   *      one user both read "no business", both created one, and the user ended
   *      up with two workspaces. The `@@unique([userId, businessId])` key on
   *      Membership cannot catch this — the two founding relationships are on
   *      two *different* businesses, so both are perfectly legal rows.
   *
   * The fix is a Serializable transaction, which is the pattern this repository
   * already uses for exactly this find-then-create shape (see
   * `CrmService.findOrCreateContact`, `{ isolationLevel: 'Serializable' }`).
   * Under Postgres SSI the losing transaction aborts with a serialization
   * failure rather than committing a duplicate, so the retry below re-reads and
   * finds the winner's business. Convergence, not exclusion.
   *
   * Deliberately NOT solved with a unique constraint on `ownerId`: the packet
   * allows one owner to hold many businesses, and a global uniqueness rule would
   * forbid the explicit multi-create that `createBusiness` is required to keep
   * supporting. The constraint would be wrong, not merely heavy-handed.
   *
   * "The bootstrap business" keeps its existing definition — the oldest
   * non-deleted business owned by the user. That is unchanged from main, and it
   * is what lets a user bootstrap once and then explicitly create as many more
   * businesses as they like without a later bootstrap adopting one of them.
   *
   * Owner ruling D-104 (W10-OWNER-MEMBERSHIP; reviews SEC-W10OM-3, OMV-2): the
   * answer is always a business the caller holds a Membership on, and nothing
   * is written on a business that exists. A caller recorded as Business.ownerId
   * who is no member of the bootstrap business (a co-owner removed them, or the
   * with_another_owner class the operator backfill skips by default) is
   * answered, in order:
   *
   *   1. the oldest non-deleted business they own and are a member of;
   *   2. else the business of their oldest Membership on a non-deleted
   *      business (any role, read across tenants);
   *   3. else 403 OWNER_MEMBERSHIP_REQUIRED: recorded as an owner, a member
   *      nowhere.
   *
   * Steps 1 and 2 answer isNewBusiness false, so the web sign-in restores the
   * caller's last workspace choice as it does for any returning user.
   */
  private async ensureBootstrapWorkspace(userId: string, businessName: string) {
    let lastError: unknown;

    for (let attempt = 0; attempt <= IdentityService.BOOTSTRAP_CONFLICT_RETRIES; attempt++) {
      try {
        return await this.prisma.client.$transaction(
          async (tx) => {
            const existingBusiness = await tx.business.findFirst({
              where: { ownerId: userId, deletedAt: null },
              orderBy: { createdAt: 'asc' },
            });

            if (existingBusiness) {
              // Owner ruling D-104 (W10-OWNER-MEMBERSHIP; review SEC-W10OM-3):
              // Membership is the single rule for business access, and only the
              // operator backfill (scripts/backfill-owner-memberships.ts, dry
              // run first) writes a missing OWNER row. The bootstrap writes no
              // Membership on a business it did not create in this call, and
              // never changes one: it used to upsert { role: 'OWNER' }, so one
              // sign-in re-admitted an owner D-104 refuses (one recorded only
              // as Business.ownerId, or one a co-owner removed) and promoted a
              // Business.ownerId holding STAFF to OWNER. A business the caller
              // holds no Membership on is never answered to them.
              const member = await tx.business.findFirst({
                where: { id: existingBusiness.id, members: { some: { userId } } },
                select: { id: true },
              });
              if (member) return { business: existingBusiness, isNewBusiness: false };

              // Review OMV-2: refusing here locked a caller out of sign-in
              // altogether when they were a member elsewhere (the web sign-in
              // throws on a bootstrap error). Answer a business they are a
              // member of instead: the oldest one they own (1), else that of
              // their oldest Membership (2). Reads only.
              const ownedMember = await tx.business.findFirst({
                where: { ownerId: userId, deletedAt: null, members: { some: { userId } } },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              });
              if (ownedMember) return { business: ownedMember, isNewBusiness: false };

              // Across tenants: POST /identity/bootstrap may run under a tenant
              // context TenantInterceptor verified for the caller (a
              // ?businessId= they belong to), which must not narrow this read.
              const oldestMembership = await tx.membership.findFirst(
                skipTenantIsolation({
                  where: { userId, business: { deletedAt: null } },
                  // `as const`: skipTenantIsolation's generic widens the literal to `string`.
                  orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
                  select: { business: true as const },
                }),
              );
              if (oldestMembership) return { business: oldestMembership.business, isNewBusiness: false };

              // Recorded as an owner, a member nowhere (3).
              throw new ForbiddenException({
                code: IdentityService.OWNER_MEMBERSHIP_REQUIRED,
                message:
                  'Your access to this workspace has to be restored by an administrator before you can sign in to it. Contact support.',
              });
            }

            const business = await tx.business.create({
              data: {
                name: businessName,
                ownerId: userId,
                onboardingStep: 'welcome',
                onboardingStartedAt: new Date(),
              },
            });

            // The founding OWNER row of the business just created (KF-EXEC-TENANT-001).
            // `update: {}`: a row already there is kept exactly as it is.
            await tx.membership.upsert({
              where: {
                userId_businessId: { userId, businessId: business.id },
              },
              create: {
                userId,
                businessId: business.id,
                role: 'OWNER',
              },
              update: {},
            });

            return { business, isNewBusiness: true };
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (err: unknown) {
        if (!IdentityService.isWriteConflict(err)) throw err;
        lastError = err;
        this.logger.warn(
          `[bootstrap] write conflict resolving workspace for user ${userId} ` +
            `(attempt ${attempt + 1}/${IdentityService.BOOTSTRAP_CONFLICT_RETRIES + 1})`,
        );
        if (attempt < IdentityService.BOOTSTRAP_CONFLICT_RETRIES) {
          await IdentityService.backoff(attempt);
        }
      }
    }

    // Exhausting the retries is a real failure, not something to paper over with
    // a non-transactional fallback — that would reintroduce the duplicate the
    // Serializable transaction exists to prevent.
    throw lastError;
  }

  /** Exponential backoff with full jitter, so simultaneous losers do not retry in lockstep. */
  private static backoff(attempt: number): Promise<void> {
    const ceiling = IdentityService.BOOTSTRAP_RETRY_BASE_MS * 2 ** attempt;
    return new Promise((resolve) => setTimeout(resolve, Math.random() * ceiling));
  }

  /**
   * A Postgres serialization failure surfaced through Prisma.
   *
   * P2034 is Prisma's "transaction failed due to a write conflict or a
   * deadlock". SQLSTATE 40001 is the underlying serialization_failure and 40P01
   * is deadlock_detected; the driver adapter does not always map them, so both
   * shapes are matched rather than trusting one.
   */
  private static isWriteConflict(err: unknown): boolean {
    const code = (err as { code?: unknown })?.code;
    return code === 'P2034' || code === '40001' || code === '40P01';
  }

  /**
   * Upsert external identity-provider links for a user.
   *
   * Only `provider` + `providerSubject` (the IdP's stable user id, e.g.
   * Google's `sub`) are required. This mapping is what lets Cross-Account
   * Protection (RISC) security events resolve to a KeyFlowOS account.
   * `identities` must come from the verified provider record of `userId`
   * (D-97, SEC-W7RR-1; see bootstrapUser), never from client input.
   */
  private async persistUserIdentities(
    userId: string,
    identities: UserIdentityDataDto[] | undefined,
  ): Promise<void> {
    if (!identities || identities.length === 0) return;

    for (const identity of identities) {
      const provider = identity.provider?.trim().toLowerCase();
      const providerSubject =
        identity.id?.trim() ||
        (typeof identity.identity_data?.sub === 'string' ? identity.identity_data.sub.trim() : '');
      if (!provider || !providerSubject) continue;

      const email =
        typeof identity.identity_data?.email === 'string'
          ? identity.identity_data.email.trim().toLowerCase() || null
          : null;

      try {
        await this.prisma.client.userIdentity.upsert({
          where: { provider_providerSubject: { provider, providerSubject } },
          update: { userId, email },
          create: { userId, provider, providerSubject, email },
        });
      } catch (err: any) {
        // Identity mapping is best-effort; don't fail bootstrap because of it.
        this.logger.warn(
          `Failed to persist ${provider} identity for user ${userId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  async getTieredCompleteness(businessId: string) {
    const [business, guidanceProfile] = await Promise.all([
      this.prisma.client.business.findUnique({ where: { id: businessId } }),
      this.prisma.client.businessGuidanceProfile.findUnique({
        where: { businessId },
        include: {
          identity: true,
          founder: true,
          offer: true,
          customer: true,
          revenue: true,
          finance: true,
          operations: true,
          compliance: true,
          growth: true,
          goals: true,
          sales: true,
          marketingStrategy: true,
          people: true,
          technology: true,
          partnerships: true,
          intellectualProperty: true,
        },
      }).catch(() => null),
    ]);

    if (!business) throw new NotFoundException('Business not found');

    const subProfiles: Record<string, unknown> = {};
    if (guidanceProfile) {
      subProfiles.identity = guidanceProfile.identity;
      subProfiles.founder = guidanceProfile.founder;
      subProfiles.offer = guidanceProfile.offer;
      subProfiles.customer = guidanceProfile.customer;
      subProfiles.revenue = guidanceProfile.revenue;
      subProfiles.finance = guidanceProfile.finance;
      subProfiles.operations = guidanceProfile.operations;
      subProfiles.compliance = guidanceProfile.compliance;
      subProfiles.growth = guidanceProfile.growth;
      subProfiles.goals = guidanceProfile.goals;
      subProfiles.sales = guidanceProfile.sales;
      subProfiles.marketingStrategy = guidanceProfile.marketingStrategy;
      subProfiles.people = guidanceProfile.people;
      subProfiles.technology = guidanceProfile.technology;
      subProfiles.partnerships = guidanceProfile.partnerships;
      subProfiles.intellectualProperty = guidanceProfile.intellectualProperty;
    }

    return computeTieredCompleteness(
      {
        name: business.name,
        logoUrl: business.logoUrl,
        headline: business.headline,
        bio: business.bio,
        industry: business.industry,
        skills: business.skills as string[] | null,
        businessStage: business.businessStage,
        city: business.city,
        country: business.country,
        interests: business.interests as string[] | null,
        tagline: business.tagline,
        description: business.description,
      },
      subProfiles as Record<string, Record<string, unknown> | null | undefined>,
    );
  }

  async getProgressivePrompts(businessId: string) {
    const guidanceProfile = await this.prisma.client.businessGuidanceProfile.findUnique({
      where: { businessId },
      include: {
        identity: true,
        founder: true,
        offer: true,
        customer: true,
        revenue: true,
        finance: true,
        operations: true,
        compliance: true,
        growth: true,
        goals: true,
        sales: true,
        marketingStrategy: true,
        people: true,
        technology: true,
        partnerships: true,
        intellectualProperty: true,
      },
    }).catch(() => null);

    const completedProfiles = new Set<string>();
    if (guidanceProfile) {
      const profileMap: Record<string, unknown> = {
        identity: guidanceProfile.identity,
        founder: guidanceProfile.founder,
        offer: guidanceProfile.offer,
        customer: guidanceProfile.customer,
        revenue: guidanceProfile.revenue,
        finance: guidanceProfile.finance,
        operations: guidanceProfile.operations,
        compliance: guidanceProfile.compliance,
        growth: guidanceProfile.growth,
        goals: guidanceProfile.goals,
        sales: guidanceProfile.sales,
        marketingStrategy: guidanceProfile.marketingStrategy,
        people: guidanceProfile.people,
        technology: guidanceProfile.technology,
        partnerships: guidanceProfile.partnerships,
        intellectualProperty: guidanceProfile.intellectualProperty,
      };

      for (const [key, value] of Object.entries(profileMap)) {
        if (value && typeof value === 'object') {
          const record = value as Record<string, unknown>;
          const skip = new Set(['id', 'guidanceProfileId', 'createdAt', 'updatedAt', 'notes']);
          const fields = Object.entries(record).filter(([k]) => !skip.has(k));
          const filled = fields.filter(([, v]) => {
            if (v == null || v === '' || v === false) return false;
            if (Array.isArray(v) && v.length === 0) return false;
            return true;
          });
          if (filled.length >= 2) completedProfiles.add(key);
        }
      }
    }

    const [invoiceCount, contactCount, bookingCount, docCount, expenseCount, memberCount, storeEnabled, campaignCount] = await Promise.all([
      this.prisma.client.invoice.count({ where: { businessId, deletedAt: null }, take: 1 }).catch(() => 0),
      this.prisma.client.contact.count({ where: { businessId, deletedAt: null }, take: 1 }).catch(() => 0),
      this.prisma.client.booking.count({ where: { businessId, deletedAt: null }, take: 1 }).catch(() => 0),
      this.prisma.client.documentInstance.count({ where: { businessId } }).catch(() => 0),
      this.prisma.client.expense.count({ where: { businessId, deletedAt: null }, take: 1 }).catch(() => 0),
      this.prisma.client.membership.count({ where: { businessId } }).catch(() => 0),
      this.prisma.client.business.findUnique({ where: { id: businessId }, select: { storeEnabled: true } }).then(b => b?.storeEnabled || false).catch(() => false),
      this.prisma.client.campaignBriefing.count({ where: { businessId } }).catch(() => 0),
    ]);

    const activeTriggers = new Set<string>();
    if (invoiceCount > 0) activeTriggers.add('first_invoice');
    if (contactCount > 0) activeTriggers.add('first_contact');
    if (bookingCount > 0) activeTriggers.add('first_booking');
    if (docCount > 0) activeTriggers.add('first_document');
    if (expenseCount > 0) activeTriggers.add('first_expense');
    if (memberCount > 1) activeTriggers.add('first_team_member');
    if (storeEnabled) activeTriggers.add('store_enabled');
    if (campaignCount > 0) activeTriggers.add('first_campaign');

    return PROGRESSIVE_DEEPENING_PROMPTS.filter(p => {
      if (!activeTriggers.has(p.trigger)) return false;
      if (completedProfiles.has(p.subProfile)) return false;
      return true;
    });
  }

  async getGuidanceSubProfile(businessId: string, subProfileName: string) {
    const guidanceProfile = await this.prisma.client.businessGuidanceProfile.findUnique({
      where: { businessId },
    });

    if (!guidanceProfile) return null;

    const validNames = [
      'identity', 'founder', 'offer', 'customer', 'revenue', 'finance',
      'operations', 'compliance', 'growth', 'goals', 'sales', 'marketingStrategy',
      'people', 'technology', 'partnerships', 'intellectualProperty',
    ];
    if (!validNames.includes(subProfileName)) {
      throw new BadRequestException(`Invalid sub-profile name: ${subProfileName}`);
    }

    const full = await this.prisma.client.businessGuidanceProfile.findUnique({
      where: { businessId },
      include: { [subProfileName]: true },
    });

    return (full as Record<string, unknown>)?.[subProfileName] || null;
  }

  async upsertGuidanceSubProfile(businessId: string, subProfileName: string, data: Record<string, unknown>) {
    const validNames = [
      'identity', 'founder', 'offer', 'customer', 'revenue', 'finance',
      'operations', 'compliance', 'growth', 'goals', 'sales', 'marketingStrategy',
      'people', 'technology', 'partnerships', 'intellectualProperty',
    ];
    if (!validNames.includes(subProfileName)) {
      throw new BadRequestException(`Invalid sub-profile name: ${subProfileName}`);
    }

    let guidanceProfile = await this.prisma.client.businessGuidanceProfile.findUnique({
      where: { businessId },
    });

    if (!guidanceProfile) {
      guidanceProfile = await this.prisma.client.businessGuidanceProfile.create({
        data: { businessId },
      });
    }

    const { id, guidanceProfileId, createdAt, updatedAt, ...rawData } = data as Record<string, unknown>;
    const cleanData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawData)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value) || value === null) {
        cleanData[key] = value;
      }
    }

    const gpId = guidanceProfile.id;
    type PrismaDelegate = {
      findUnique(args: { where: { guidanceProfileId: string } }): Promise<unknown>;
      update(args: { where: { guidanceProfileId: string }; data: Record<string, unknown> }): Promise<unknown>;
      create(args: { data: Record<string, unknown> }): Promise<unknown>;
    };
    const upsertFor = (delegate: PrismaDelegate) =>
      delegate.findUnique({ where: { guidanceProfileId: gpId } }).then((existing: unknown) =>
        existing
          ? delegate.update({ where: { guidanceProfileId: gpId }, data: cleanData })
          : delegate.create({ data: { ...cleanData, guidanceProfileId: gpId } }),
      );

    const db = this.prisma.client;
    switch (subProfileName) {
      case 'identity': return upsertFor(db.businessIdentityProfile);
      case 'founder': return upsertFor(db.founderProfile);
      case 'offer': return upsertFor(db.offerProfile);
      case 'customer': return upsertFor(db.customerProfile);
      case 'revenue': return upsertFor(db.revenueProfile);
      case 'finance': return upsertFor(db.financeProfile);
      case 'operations': return upsertFor(db.operationsProfile);
      case 'compliance': return upsertFor(db.complianceGuidanceProfile);
      case 'growth': return upsertFor(db.growthProfile);
      case 'goals': return upsertFor(db.goalsProfile);
      case 'sales': return upsertFor(db.salesProfile);
      case 'marketingStrategy': return upsertFor(db.marketingStrategyProfile);
      case 'people': return upsertFor(db.peopleProfile);
      case 'technology': return upsertFor(db.technologyProfile);
      case 'partnerships': return upsertFor(db.partnershipsProfile);
      case 'intellectualProperty': return upsertFor(db.intellectualPropertyProfile);
      default: throw new BadRequestException(`Model not found for sub-profile: ${subProfileName}`);
    }
  }

  private async detectDocumentImpact(businessId: string, changedFields: string[], businessName: string) {
    const rules = await this.prisma.client.impactRule.findMany({
      where: { profileField: { in: changedFields } },
    });
    if (rules.length === 0) return;

    const docTypeIds = [...new Set(rules.map((r) => r.documentTypeId))];
    const affected = await this.prisma.client.documentInstance.findMany({
      where: { businessId, documentTypeId: { in: docTypeIds }, status: { not: 'ARCHIVED' } },
    });

    for (const doc of affected) {
      await this.prisma.client.documentInstance.update({
        where: { id: doc.id },
        data: {
          healthStatus: 'IMPACTED',
          healthReason: `Profile field(s) changed: ${changedFields.join(', ')}`,
        },
      });
    }

    if (affected.length > 0) {
      this.logger.log(
        `Document impact: ${affected.length} document(s) affected by profile change [${changedFields.join(', ')}] for business "${businessName}" (${businessId})`,
      );
    }
  }
}
