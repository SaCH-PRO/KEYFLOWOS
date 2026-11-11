import { Inject, Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { skipTenantIsolation } from '@keyflow/db';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';

// ---------------------------------------------------------------------------
// Schema — discriminated by section type so each section has typed, runtime-
// validated data. Anything that fails validation falls back to defaults; we
// never persist arbitrary unknown JSON.
// ---------------------------------------------------------------------------

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/).optional();
const urlSchema = z.string().max(1000).optional();
const shortStr = (max: number) => z.string().max(max);

const baseSection = {
  id: z.string().min(1).max(64),
  visible: z.boolean().default(true),
};

const heroSection = z.object({
  ...baseSection,
  type: z.literal('hero'),
  data: z.object({
    headline: shortStr(200).optional().default(''),
    subheadline: shortStr(400).optional().default(''),
    ctaLabel: shortStr(80).optional().default(''),
    coverImageUrl: urlSchema,
  }).default({}),
});

const aboutSection = z.object({
  ...baseSection,
  type: z.literal('about'),
  data: z.object({
    heading: shortStr(120).optional().default('About us'),
    body: shortStr(5000).optional().default(''),
  }).default({}),
});

const servicesSection = z.object({
  ...baseSection,
  type: z.literal('services'),
  data: z.object({ heading: shortStr(120).optional().default('Services') }).default({}),
});

const productsSection = z.object({
  ...baseSection,
  type: z.literal('products'),
  data: z.object({ heading: shortStr(120).optional().default('Products') }).default({}),
});

const trustSection = z.object({
  ...baseSection,
  type: z.literal('trust'),
  data: z.object({
    heading: shortStr(120).optional().default('Why choose us'),
    items: z.array(shortStr(160)).max(20).optional().default([]),
  }).default({}),
});

const gallerySection = z.object({
  ...baseSection,
  type: z.literal('gallery'),
  data: z.object({
    images: z.array(z.string().max(1000)).max(40).optional().default([]),
  }).default({}),
});

const faqSection = z.object({
  ...baseSection,
  type: z.literal('faq'),
  data: z.object({
    entries: z.array(z.object({
      question: shortStr(300),
      answer: shortStr(2000),
    })).max(40).optional().default([]),
  }).default({}),
});

const contactSection = z.object({
  ...baseSection,
  type: z.literal('contact'),
  data: z.object({
    heading: shortStr(120).optional().default('Contact us'),
    showWhatsApp: z.boolean().optional().default(true),
    showEmail: z.boolean().optional().default(true),
    showPhone: z.boolean().optional().default(true),
  }).default({}),
});

const locationSection = z.object({
  ...baseSection,
  type: z.literal('location'),
  data: z.object({
    showMap: z.boolean().optional().default(true),
    showHours: z.boolean().optional().default(true),
  }).default({}),
});

const customHtmlSection = z.object({
  ...baseSection,
  type: z.literal('custom_html'),
  data: z.object({
    html: shortStr(50_000).optional().default(''),
  }).default({}),
});

const reviewsSection = z.object({
  ...baseSection,
  type: z.literal('reviews'),
  data: z.object({
    heading: shortStr(120).optional().default('Testimonials'),
    entries: z.array(z.object({
      name: shortStr(200),
      rating: z.number().int().min(1).max(5),
      text: shortStr(2000),
      imageUrl: urlSchema,
    })).max(20).optional().default([]),
  }).default({}),
});

const sectionSchema = z.discriminatedUnion('type', [
  heroSection, aboutSection, servicesSection, productsSection, trustSection,
  gallerySection, faqSection, contactSection, locationSection, customHtmlSection,
  reviewsSection,
]);

const presenceSchema = z.object({
  branding: z.object({
    logoUrl: urlSchema,
    faviconUrl: urlSchema,
    primaryColor: colorSchema,
    secondaryColor: colorSchema,
    fontPairing: shortStr(60).optional(),
  }).default({}),
  sections: z.array(sectionSchema).max(30).default([]),
  seo: z.object({
    metaTitle: shortStr(200).optional(),
    metaDescription: shortStr(500).optional(),
    socialImageUrl: urlSchema,
    canonicalUrl: shortStr(500).optional(),
    robotsIndex: z.boolean().optional().default(true),
  }).default({}),
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/).optional(),
  customDomain: shortStr(200).optional(),
});

export type PresencePayload = z.infer<typeof presenceSchema>;
export type PresenceSection = z.infer<typeof sectionSchema>;
export type PresenceSectionType = PresenceSection['type'];

const DEFAULT_PAYLOAD: PresencePayload = presenceSchema.parse({
  branding: { primaryColor: '#F97316', secondaryColor: '#14B8A6', fontPairing: 'inter-inter' },
  sections: [
    { id: 'sec_hero', type: 'hero', visible: true, data: { headline: '', subheadline: '', ctaLabel: 'Book now' } },
    { id: 'sec_about', type: 'about', visible: true, data: { heading: 'About us', body: '' } },
    { id: 'sec_services', type: 'services', visible: true, data: { heading: 'Services' } },
    { id: 'sec_products', type: 'products', visible: true, data: { heading: 'Products' } },
    { id: 'sec_trust', type: 'trust', visible: false, data: { heading: 'Why choose us', items: [] } },
    { id: 'sec_gallery', type: 'gallery', visible: false, data: { images: [] } },
    { id: 'sec_faq', type: 'faq', visible: false, data: { entries: [] } },
    { id: 'sec_contact', type: 'contact', visible: true, data: { showWhatsApp: true, showEmail: true, showPhone: true } },
    { id: 'sec_location', type: 'location', visible: true, data: { showMap: true, showHours: true } },
    { id: 'sec_custom_html', type: 'custom_html', visible: false, data: { html: '' } },
    { id: 'sec_reviews', type: 'reviews', visible: false, data: { heading: 'Testimonials', entries: [] } },
  ],
  seo: { robotsIndex: true },
});

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

function asJson(p: PresencePayload): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(p)) as Prisma.InputJsonValue;
}

function fromJson(value: Prisma.JsonValue | null | undefined): PresencePayload {
  if (!value || typeof value !== 'object') return clone(DEFAULT_PAYLOAD);
  const parsed = presenceSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  return clone(DEFAULT_PAYLOAD);
}

/**
 * Validate, normalize, and backfill the canonical fixed section set so every
 * draft contains every section type (each appended hidden if missing). Drops
 * unknown fields, dedupes section ids, and falls back to the default-shape
 * when validation fails so we never persist malformed presence data.
 */
function sanitizePayload(input: unknown): PresencePayload {
  const merged = (input && typeof input === 'object') ? input : {};
  const parsed = presenceSchema.safeParse(merged);
  const cleaned = parsed.success ? parsed.data : clone(DEFAULT_PAYLOAD);
  const seen = new Set<string>();
  cleaned.sections = cleaned.sections.map((s, i) => {
    let id = s.id;
    while (seen.has(id)) id = `${id}_${i}`;
    seen.add(id);
    return { ...s, id };
  });
  const presentTypes = new Set(cleaned.sections.map((s) => s.type));
  for (const def of DEFAULT_PAYLOAD.sections) {
    if (!presentTypes.has(def.type)) {
      cleaned.sections.push({ ...clone(def), visible: false });
    }
  }
  return cleaned;
}

/**
 * W7-SLUG-PRESENCE-DRAFT repair (owner ruling D-11, review CR-1; SEC-W7SPD-2,
 * CRR-1): beside the presence payload, the stored draft payload remembers the
 * slugs the owner's PATCH /identity/businesses/:businessId replaced (the
 * draft's slug and Business.slug before the PATCH). The key is not part of
 * presenceSchema, so fromJson and sanitizePayload drop it from every response,
 * preview and published page, and a client cannot send it; saveDraft carries
 * it from the stored row to the next. A non-owner's editor loaded before the
 * PATCH still sends one of those slugs with every save and autosave; saveDraft
 * reads it as that stale copy, keeps the draft's slug and saves the content,
 * instead of refusing a slug change the member never made. A remembered slug
 * is never put on the draft or on Business.slug for a non-owner.
 */
const REPLACED_SLUGS_KEY = 'replacedSlugs';
/** How many replaced slugs a draft remembers (the latest ones). */
const REPLACED_SLUGS_MAX = 20;

/** The slugs the owner's PATCH replaced, as the stored draft payload remembers them. */
function replacedSlugsOf(stored: Prisma.JsonValue | null | undefined): string[] {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return [];
  const list = (stored as Prisma.JsonObject)[REPLACED_SLUGS_KEY];
  return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : [];
}

/** The draft payload to store: the cleaned presence payload and the replaced slugs it remembers (none: no key). */
function withReplacedSlugs(cleaned: PresencePayload, replaced: string[]): Prisma.InputJsonValue {
  const json = asJson(cleaned) as Prisma.InputJsonObject;
  return (replaced.length ? { ...json, [REPLACED_SLUGS_KEY]: replaced } : json) as Prisma.InputJsonValue;
}

/**
 * W7-SLUG-PRESENCE-DRAFT (owner ruling D-11, review CR-1): the stored draft
 * payload once the owner's PATCH /identity/businesses/:businessId has moved
 * Business.slug to `businessSlug` (IdentityService.updateBusiness writes it in
 * the PATCH's transaction, under the business row lock and a lock on the draft
 * row). The draft cannot tell a stale slug (the address before the PATCH) from
 * a pending one (saved by the owner, not yet published), and the PATCH is the
 * owner's latest word on the address, so a draft carrying either takes the
 * PATCHed slug: the owner's next publish cannot put an older address back on
 * Business.slug. A slug the presence payload cannot carry (presenceSchema.slug)
 * leaves the draft without one, so the publish keeps the PATCHed Business.slug.
 * Repair SEC-W7SPD-2 / CRR-1: the draft's replaced slug and
 * `previousBusinessSlug` (Business.slug before the PATCH) join the slugs the
 * draft remembers (REPLACED_SLUGS_KEY), so a non-owner's editor still holding
 * one of them keeps saving content. Only the slug and that key change; the rest
 * of the stored payload stays as stored. Undefined when there is nothing to
 * write: the draft carries no slug, or already carries this one.
 */
export function draftPayloadFollowingBusinessSlug(
  stored: Prisma.JsonValue | null | undefined,
  businessSlug: string,
  previousBusinessSlug?: string | null,
): Prisma.InputJsonObject | undefined {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return undefined;
  const { slug: draftSlug, ...rest } = stored as Prisma.JsonObject;
  if (typeof draftSlug !== 'string' || draftSlug === businessSlug) return undefined;
  delete rest[REPLACED_SLUGS_KEY];
  const replaced = [...replacedSlugsOf(stored), draftSlug, previousBusinessSlug]
    .filter((s): s is string => typeof s === 'string' && s.length > 0 && s !== businessSlug);
  // Each slug once, at its latest position; the latest REPLACED_SLUGS_MAX are kept.
  const remembered = replaced.filter((s, i) => replaced.lastIndexOf(s) === i).slice(-REPLACED_SLUGS_MAX);
  const carried = presenceSchema.shape.slug.safeParse(businessSlug).success;
  return {
    ...rest,
    ...(carried ? { slug: businessSlug } : {}),
    [REPLACED_SLUGS_KEY]: remembered,
  } as Prisma.InputJsonObject;
}

/** The Prisma client inside an interactive transaction (the shape catalog.service.ts names). */
type TransactionClient = Parameters<Parameters<PrismaService['client']['$transaction']>[0]>[0];
/** saveDraft's transaction: it waits only behind an in-flight PATCH of the same business (SEC-W7SPD-1). */
const SAVE_DRAFT_TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

/** The authenticated caller of a presence write, as AuthMiddleware attaches it (req.user). */
export type PresenceActor = { id: string; role?: string };

/** R0-09b (owner ruling D-11): the refusal a non-owner gets for saving a new public slug in the draft. */
export const PRESENCE_SLUG_OWNER_ONLY = 'PRESENCE_SLUG_OWNER_ONLY';

type Diff = { path: string; before: unknown; after: unknown };
function diffPayload(a: unknown, b: unknown, path = ''): Diff[] {
  const diffs: Diff[] = [];
  if (a === b) return diffs;
  const aIsObj = a && typeof a === 'object' && !Array.isArray(a);
  const bIsObj = b && typeof b === 'object' && !Array.isArray(b);
  if (aIsObj && bIsObj) {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
    for (const k of keys) diffs.push(...diffPayload(ao[k], bo[k], path ? `${path}.${k}` : k));
    return diffs;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push({ path: path || 'root', before: a, after: b });
  return diffs;
}

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  defaultPayload(): PresencePayload { return clone(DEFAULT_PAYLOAD); }

  async getDraft(businessId: string) {
    let draft = await this.prisma.client.sitePageDraft.findUnique({ where: { businessId } });
    if (!draft) {
      const business = await this.prisma.client.business.findFirst({
        where: { id: businessId, deletedAt: null },
        select: { id: true, slug: true, name: true, tagline: true, description: true, primaryColor: true, secondaryColor: true, logoUrl: true },
      });
      if (!business) throw new NotFoundException('Business not found');
      const seeded: PresencePayload = clone(DEFAULT_PAYLOAD);
      if (business.primaryColor && /^#[0-9a-fA-F]{6}$/.test(business.primaryColor)) seeded.branding.primaryColor = business.primaryColor;
      if (business.secondaryColor && /^#[0-9a-fA-F]{6}$/.test(business.secondaryColor)) seeded.branding.secondaryColor = business.secondaryColor;
      if (business.logoUrl) seeded.branding.logoUrl = business.logoUrl;
      if (business.slug) seeded.slug = business.slug;
      const heroIdx = seeded.sections.findIndex((s) => s.type === 'hero');
      if (heroIdx >= 0 && seeded.sections[heroIdx].type === 'hero') {
        seeded.sections[heroIdx].data.headline = business.name;
        seeded.sections[heroIdx].data.subheadline = business.tagline ?? '';
      }
      const aboutIdx = seeded.sections.findIndex((s) => s.type === 'about');
      if (aboutIdx >= 0 && seeded.sections[aboutIdx].type === 'about') {
        seeded.sections[aboutIdx].data.body = business.description ?? '';
      }
      seeded.seo.metaTitle = business.name;
      seeded.seo.metaDescription = business.tagline ?? business.description ?? undefined;
      draft = await this.prisma.client.sitePageDraft.create({
        data: { businessId, payload: asJson(seeded), status: 'DRAFT', version: 1 },
      });
    }
    const published = await this.prisma.client.sitePagePublished.findUnique({ where: { businessId } });
    return {
      draft: {
        id: draft.id,
        version: draft.version,
        status: draft.status,
        payload: fromJson(draft.payload),
        previewToken: draft.previewToken,
        previewExpiresAt: draft.previewExpiresAt,
        updatedAt: draft.updatedAt,
      },
      published: published ? {
        id: published.id,
        version: published.version,
        publishedAt: published.publishedAt,
        unpublishedAt: published.unpublishedAt,
        payload: fromJson(published.payload),
      } : null,
    };
  }

  /**
   * Any member may save the draft (BusinessGuard), except that a non-owner may
   * not put a new public slug in it (R0-09b, owner ruling D-11): a slug that is
   * neither the Business's current slug nor the one the draft already carries
   * answers 403 PRESENCE_SLUG_OWNER_ONLY and nothing is saved. Keeping the
   * draft's slug, or sending none, is today's rule (see assertSlugOwner).
   *
   * W7-SLUG-PRESENCE-DRAFT repair (D-11, review CR-1):
   * - SEC-W7SPD-2 / CRR-1: a non-owner whose editor was loaded before the
   *   owner's PATCH /identity/businesses/:id moved the slug still sends the
   *   replaced slug with every save and autosave. A slug the draft remembers
   *   as replaced (REPLACED_SLUGS_KEY) is that stale copy, not a change: the
   *   save keeps the draft's own slug (none, when the draft has none) and
   *   saves the content (200). Any other new slug is still refused.
   * - SEC-W7SPD-1: the check and the write run in one transaction that first
   *   takes FOR SHARE on the businesses row. The PATCH holds FOR NO KEY UPDATE
   *   on that row while it moves Business.slug and the draft's slug, so a save
   *   that arrives during the PATCH waits for it and checks against the
   *   committed slugs, and a PATCH that arrives during a save waits for the
   *   save and moves the slug of what it saved.
   */
  async saveDraft(businessId: string, payload: unknown, actor?: PresenceActor) {
    const cleaned = sanitizePayload(payload);
    const upserted = await this.prisma.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${businessId} FOR SHARE`;
      const existing = await tx.sitePageDraft.findUnique({ where: { businessId } });
      const replaced = replacedSlugsOf(existing?.payload);
      if (cleaned.slug !== undefined) {
        const draftSlug = existing ? fromJson(existing.payload).slug : undefined;
        if (cleaned.slug !== draftSlug && cleaned.slug !== (await this.businessSlug(businessId, tx))) {
          if (!replaced.includes(cleaned.slug)) {
            await this.assertSlugOwner(businessId, actor, tx);
          } else if (!(await this.isSlugOwner(businessId, actor, tx))) {
            // A non-owner's stale copy of a slug the owner's PATCH replaced: the draft keeps its own.
            if (draftSlug === undefined) delete cleaned.slug;
            else cleaned.slug = draftSlug;
          }
        }
      }
      const data = {
        payload: withReplacedSlugs(cleaned, replaced),
        status: 'DRAFT',
        lastSavedById: actor?.id ?? null,
        version: existing ? existing.version + 1 : 1,
      };
      return tx.sitePageDraft.upsert({
        where: { businessId },
        update: data,
        create: { ...data, businessId },
      });
    }, SAVE_DRAFT_TX_OPTIONS);
    return {
      id: upserted.id,
      version: upserted.version,
      status: upserted.status,
      payload: fromJson(upserted.payload),
      updatedAt: upserted.updatedAt,
    };
  }

  async createPreviewToken(businessId: string) {
    const draft = await this.prisma.client.sitePageDraft.findUnique({ where: { businessId } });
    if (!draft) throw new NotFoundException('No draft to preview');
    const token = randomBytes(24).toString('base64url');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const updated = await this.prisma.client.sitePageDraft.update({
      where: { businessId },
      data: { previewToken: token, previewExpiresAt: expires, status: 'PREVIEW' },
    });
    return { previewToken: updated.previewToken, previewExpiresAt: updated.previewExpiresAt };
  }

  async getByPreviewToken(token: string) {
    const draft = await this.prisma.client.sitePageDraft.findUnique(
      skipTenantIsolation({
        where: { previewToken: token },
        include: { business: { select: {
          id: true, name: true, slug: true, logoUrl: true, tagline: true, description: true,
          address: true, city: true, country: true, phone: true, email: true, whatsapp: true,
        } } },
      }),
    );
    if (!draft) throw new NotFoundException('Preview not found');
    if (draft.previewExpiresAt && draft.previewExpiresAt < new Date()) {
      throw new NotFoundException('Preview link expired');
    }
    return {
      business: draft.business,
      payload: fromJson(draft.payload),
      version: draft.version,
      preview: true,
    };
  }

  async previewDiff(businessId: string) {
    const draft = await this.prisma.client.sitePageDraft.findUnique({ where: { businessId } });
    if (!draft) throw new NotFoundException('No draft to publish');
    const published = await this.prisma.client.sitePagePublished.findUnique({ where: { businessId } });
    const before: PresencePayload | Record<string, never> = published ? fromJson(published.payload) : {};
    const after = fromJson(draft.payload);
    return {
      hasPublished: !!published,
      diffs: diffPayload(before, after).slice(0, 50),
      draftVersion: draft.version,
      publishedVersion: published?.version ?? 0,
    };
  }

  /**
   * Publishing puts the draft live and, for the owner, copies the draft's slug
   * onto Business.slug, the public address.
   *
   * R0-09b (owner ruling D-11, review R09-ST-2): only the owner (or a
   * SUPER_ADMIN) moves Business.slug. Any member may publish, but a
   * non-owner's publish never changes the address: when the draft's slug
   * differs from Business.slug, the page goes live at the current Business.slug
   * (the published payload carries that slug), Business.slug is not written,
   * and the draft keeps its slug for the owner's next publish. A draft slug
   * differs either because the owner saved a new one that is still pending, or
   * because the owner moved Business.slug through PATCH /identity/businesses/:id
   * after the draft was seeded; the draft cannot tell the two apart, and
   * neither may block a non-owner's content publish (review CR-1). A publish
   * that leaves the slug as it is does not rewrite the Business row.
   * W7-SLUG-PRESENCE-DRAFT (D-11, review CR-1): the PATCH now carries the
   * draft's slug along in its transaction (draftPayloadFollowingBusinessSlug),
   * so the owner's publish no longer puts a slug the PATCH replaced back; a
   * stale slug can only remain in a draft saved and left over from before
   * that change.
   */
  async publish(businessId: string, actor?: PresenceActor) {
    const userId = actor?.id;
    const draft = await this.prisma.client.sitePageDraft.findUnique({ where: { businessId } });
    if (!draft) throw new BadRequestException('No draft to publish');
    const cleaned = sanitizePayload(draft.payload);
    const liveSlug = await this.businessSlug(businessId);
    const draftSlugDiffers = !!cleaned.slug && cleaned.slug !== liveSlug;
    const slugChange = draftSlugDiffers && (await this.isSlugOwner(businessId, actor));
    const toPublish: PresencePayload = draftSlugDiffers && !slugChange
      ? { ...cleaned, slug: liveSlug ?? undefined }
      : cleaned;
    const existing = await this.prisma.client.sitePagePublished.findUnique({ where: { businessId } });
    const nextVersion = (existing?.version ?? 0) + 1;
    const published = await this.prisma.client.sitePagePublished.upsert({
      where: { businessId },
      update: {
        payload: asJson(toPublish),
        version: nextVersion,
        publishedAt: new Date(),
        publishedById: userId ?? null,
        unpublishedAt: null,
      },
      create: {
        businessId,
        payload: asJson(toPublish),
        version: nextVersion,
        publishedById: userId ?? null,
      },
    });
    // Mark the draft as PUBLISHED so the editor reflects the live state.
    await this.prisma.client.sitePageDraft.update({
      where: { businessId },
      data: { status: 'PUBLISHED' },
    });
    if (slugChange) {
      try {
        await this.prisma.client.business.update({ where: { id: businessId }, data: { slug: cleaned.slug } });
      } catch (err: any) {
        this.logger.warn(`Slug update for ${businessId} failed: ${err}`);
      }
    }
    try {
      await this.prisma.client.activity.create({
        data: {
          businessId,
          module: 'site',
          action: 'published',
          entityType: 'site_page',
          entityId: published.id,
          title: 'Public site published',
          detail: `Version ${published.version}`,
          tone: 'success',
        },
      });
    } catch {
      /* intentionally empty */
    }
    this.events.emit('SITE_PUBLISHED', { businessId, version: published.version });
    return {
      id: published.id,
      version: published.version,
      publishedAt: published.publishedAt,
    };
  }

  async unpublish(businessId: string) {
    const published = await this.prisma.client.sitePagePublished.findUnique({ where: { businessId } });
    if (!published) throw new NotFoundException('Nothing to unpublish');
    const updated = await this.prisma.client.sitePagePublished.update({
      where: { businessId },
      data: { unpublishedAt: new Date() },
    });
    // Per state-machine spec: unpublish reverts the draft back to DRAFT and
    // rotates/clears the preview token so any shared preview link is voided.
    await this.prisma.client.sitePageDraft.update({
      where: { businessId },
      data: { status: 'DRAFT', previewToken: null, previewExpiresAt: null },
    }).catch(() => undefined);
    try {
      await this.prisma.client.activity.create({
        data: {
          businessId,
          module: 'site',
          action: 'unpublished',
          entityType: 'site_page',
          entityId: updated.id,
          title: 'Public site unpublished',
          tone: 'warning',
        },
      });
    } catch {
      /* intentionally empty */
    }
    this.events.emit('SITE_UNPUBLISHED', { businessId, version: updated.version });
    return { id: updated.id, unpublishedAt: updated.unpublishedAt };
  }

  private async businessSlug(businessId: string, client: TransactionClient = this.prisma.client): Promise<string | null> {
    const business = await client.business.findFirst({ where: { id: businessId }, select: { slug: true } });
    return business?.slug ?? null;
  }

  /**
   * R0-09b-D11-SIBLING-WRITES, owner ruling D-11 (2026-10-31): editing the
   * business profile is OWNER only, regardless of granted scopes. Of the
   * owner-only profile fields (the ones PATCH /identity/businesses/:businessId
   * writes: name, slug, currency, timezone, tax, store settings and the rest),
   * the presence routes write exactly one onto the Business row: slug, at
   * publish. Branding, sections, seo and customDomain live in site_page_drafts
   * and site_pages_published only, so those edits keep the BusinessGuard rule
   * (any member) and are not gated here. saveDraft refuses a non-owner a new
   * slug (assertSlugOwner); publish asks isSlugOwner and, for a non-owner,
   * publishes at the current address instead of refusing.
   *
   * The owner is the OWNER membership or the distinguished owner
   * (Business.ownerId), the two arms IdentityService.assertBusinessOwner and
   * BusinessGuard admit an owner by; a SUPER_ADMIN keeps the platform bypass
   * BusinessGuard already grants. The rule is restated rather than imported, as
   * R0-08c did: IdentityModule imports AiModule, which reaches SiteModule
   * through KeyCortexModule. No actor is not the owner (fails closed).
   */
  private async isSlugOwner(
    businessId: string,
    actor: PresenceActor | undefined,
    client: TransactionClient = this.prisma.client,
  ): Promise<boolean> {
    if (!actor?.id) return false;
    if (actor.role === 'SUPER_ADMIN') return true;
    const membership = await client.membership.findUnique({
      where: { userId_businessId: { userId: actor.id, businessId } },
      select: { role: true },
    });
    if (membership?.role === 'OWNER') return true;
    const owned = await client.business.findFirst({
      // Owner ruling D-104 (W10-OWNER-MEMBERSHIP): the ownerId arm counts only with a Membership row.
      where: { id: businessId, ownerId: actor.id, members: { some: { userId: actor.id } } },
      select: { id: true },
    });
    return !!owned;
  }

  /** 403 PRESENCE_SLUG_OWNER_ONLY unless the actor is the owner (see isSlugOwner). */
  private async assertSlugOwner(
    businessId: string,
    actor: PresenceActor | undefined,
    client: TransactionClient = this.prisma.client,
  ): Promise<void> {
    if (await this.isSlugOwner(businessId, actor, client)) return;
    throw new ForbiddenException({
      code: PRESENCE_SLUG_OWNER_ONLY,
      message: 'Only the business owner can change the public site address (slug).',
    });
  }

  async getPublishedBySlug(slug: string) {
    const business = await this.prisma.client.business.findFirst({
      where: { slug, deletedAt: null },
      select: {
        id: true, name: true, slug: true, logoUrl: true, tagline: true, description: true,
        address: true, city: true, country: true, phone: true, email: true, whatsapp: true,
        primaryColor: true, secondaryColor: true, businessHours: true,
        industry: true, headline: true, currency: true, website: true,
        facebook: true, instagram: true, twitter: true, linkedin: true, tiktok: true, youtube: true,
      },
    });
    if (!business) return null;
    const published = await this.prisma.client.sitePagePublished.findUnique({ where: { businessId: business.id } });
    if (!published || published.unpublishedAt) return null;
    // Catalog snapshot for schema.org Service / Product JSON-LD on the public
    // presence page. Capped + minimal projection to keep the public payload
    // small.
    const [services, products] = await Promise.all([
      this.prisma.client.service.findMany({
        where: { businessId: business.id, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, name: true, description: true, price: true, duration: true },
      }).catch(() => [] as Array<{ id: string; name: string; description: string | null; price: number; duration: number }>),
      this.prisma.client.product.findMany({
        where: { businessId: business.id, deletedAt: null, isActive: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, name: true, description: true, price: true, currency: true, imageUrl: true, sku: true },
      }).catch(() => [] as Array<{ id: string; name: string; description: string | null; price: number | null; currency: string | null; imageUrl: string | null; sku: string | null }>),
    ]);

    // Resolve the active plan tier so the public renderer can decide whether
    // to show the Powered-by KeyFlow badge (free tier only). Direct Prisma
    // lookup avoids importing SubscriptionsModule (which would create a
    // module dependency cycle through CrmModule -> NotificationsModule).
    let plan: 'FREE' | 'FLOW' | 'KEYFLOW' = 'FREE';
    try {
      const sub = await this.prisma.client.subscription.findFirst({
        where: { businessId: business.id, status: { in: ['ACTIVE', 'TRIALING'] } },
        orderBy: { createdAt: 'desc' },
        select: { plan: true, status: true, trialEndsAt: true },
      });
      if (sub) {
        const trialExpired = sub.status === 'TRIALING' && sub.trialEndsAt && sub.trialEndsAt < new Date();
        if (!trialExpired && (sub.plan === 'FLOW' || sub.plan === 'KEYFLOW')) {
          plan = sub.plan as 'FLOW' | 'KEYFLOW';
        }
      }
    } catch {
      // Non-fatal — default to FREE.
    }

    // Canonical directory metadata exposed on the public payload so the
    // community directory + third-party crawlers can build uniform listings
    // without re-querying private tables.
    const directoryListing = {
      slug: business.slug,
      name: business.name,
      logoUrl: business.logoUrl,
      tagline: business.tagline,
      headline: business.headline,
      industry: business.industry,
      city: business.city,
      country: business.country,
      website: business.website,
      services: services.slice(0, 10).map((s) => ({ id: s.id, name: s.name, price: s.price ?? null })),
      products: products.slice(0, 10).map((p) => ({ id: p.id, name: p.name, price: p.price ?? null, currency: p.currency ?? null })),
      serviceCount: services.length,
      productCount: products.length,
    };

    return {
      business,
      payload: fromJson(published.payload),
      version: published.version,
      publishedAt: published.publishedAt,
      catalog: { services, products },
      plan,
      directoryListing,
    };
  }

  /**
     * Public directory listing of every business that has a current published
     * presence (no unpublishedAt). Returns the canonical directoryListing
     * shape used by the storefront payload so the public /directory page and
     * any third-party crawlers see consistent data. Supports lightweight
     * server-side filtering and pagination so the list scales as the
     * platform grows.
     */
    async listDirectory(opts: {
      industry?: string;
      city?: string;
      q?: string;
      page?: number;
      pageSize?: number;
    } = {}) {
      const safePage = Number.isFinite(opts.page) ? Math.floor(opts.page as number) : 1;
      const safePageSize = Number.isFinite(opts.pageSize) ? Math.floor(opts.pageSize as number) : 24;
      const page = Math.max(1, safePage);
      const pageSize = Math.min(60, Math.max(1, safePageSize));
      const baseAggWhere: Prisma.BusinessWhereInput = {
        deletedAt: null,
        slug: { not: null },
        sitePagePublished: { is: { unpublishedAt: null } },
      };
      const businessWhere: Prisma.BusinessWhereInput = { ...baseAggWhere };
      if (opts.industry) businessWhere.industry = { equals: opts.industry, mode: 'insensitive' };
      if (opts.city) businessWhere.city = { equals: opts.city, mode: 'insensitive' };
      if (opts.q && opts.q.trim()) {
        const q = opts.q.trim().slice(0, 80);
        businessWhere.OR = [
          { name: { contains: q, mode: 'insensitive' } },
          { tagline: { contains: q, mode: 'insensitive' } },
          { headline: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ];
      }
      const [total, businesses, industriesAgg, citiesAgg] = await Promise.all([
        this.prisma.client.business.count({ where: businessWhere }),
        this.prisma.client.business.findMany({
          where: businessWhere,
          orderBy: [{ name: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true, slug: true, name: true, logoUrl: true, tagline: true,
            headline: true, industry: true, city: true, country: true, website: true,
            sitePagePublished: { select: { publishedAt: true, version: true } },
          },
        }),
        this.prisma.client.business.groupBy({
          by: ['industry'],
          where: { ...baseAggWhere, industry: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { industry: 'desc' } },
          take: 30,
        }).catch(() => [] as Array<{ industry: string | null; _count: { _all: number } }>),
        this.prisma.client.business.groupBy({
          by: ['city'],
          where: { ...baseAggWhere, city: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { city: 'desc' } },
          take: 30,
        }).catch(() => [] as Array<{ city: string | null; _count: { _all: number } }>),
      ]);
      const items = businesses.map((b) => ({
        slug: b.slug,
        name: b.name,
        logoUrl: b.logoUrl,
        tagline: b.tagline,
        headline: b.headline,
        industry: b.industry,
        city: b.city,
        country: b.country,
        website: b.website,
        publishedAt: b.sitePagePublished?.publishedAt ?? null,
      }));
      return {
        items,
        total,
        page,
        pageSize,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
        filters: {
          industries: industriesAgg
            .filter((g) => typeof g.industry === 'string' && (g.industry as string).length > 0)
            .map((g) => ({ value: g.industry as string, count: g._count._all })),
          cities: citiesAgg
            .filter((g) => typeof g.city === 'string' && (g.city as string).length > 0)
            .map((g) => ({ value: g.city as string, count: g._count._all })),
        },
      };
    }

    /**
     * Compute the section completion contributions toward Presence Health Score.
   * Each visible required section that has meaningful content scores 1; the
   * sibling Health Score task aggregates these with branding/SEO checks.
   */
  async getSectionCompleteness(businessId: string) {
    const draft = await this.prisma.client.sitePageDraft.findUnique({ where: { businessId } });
    const payload = draft ? fromJson(draft.payload) : clone(DEFAULT_PAYLOAD);
    const checks = payload.sections.map((s) => {
      let hasContent: boolean;
      switch (s.type) {
        case 'hero': hasContent = !!(s.data.headline && s.data.headline.trim()); break;
        case 'about': hasContent = !!(s.data.body && s.data.body.trim().length > 20); break;
        case 'faq': hasContent = (s.data.entries ?? []).length > 0; break;
        case 'gallery': hasContent = (s.data.images ?? []).length > 0; break;
        case 'trust': hasContent = (s.data.items ?? []).length > 0; break;
        case 'reviews': hasContent = (s.data.entries ?? []).length > 0; break;
        case 'custom_html': hasContent = !!(s.data.html && s.data.html.trim()); break;
        default: hasContent = s.visible;
      }
      return { id: s.id, type: s.type, visible: s.visible, complete: hasContent };
    });
    const seoComplete = !!(payload.seo.metaTitle && payload.seo.metaDescription);
    const brandingComplete = !!(payload.branding.logoUrl && payload.branding.primaryColor);
    const total = checks.length + 2;
    const completed = checks.filter((c) => c.complete && c.visible).length + (seoComplete ? 1 : 0) + (brandingComplete ? 1 : 0);
    const score = Math.round((completed / total) * 100);
    return { score, sections: checks, seoComplete, brandingComplete };
  }
}
