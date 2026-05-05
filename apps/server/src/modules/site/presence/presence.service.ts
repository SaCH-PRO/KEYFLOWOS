import { Inject, Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
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

const sectionSchema = z.discriminatedUnion('type', [
  heroSection, aboutSection, servicesSection, productsSection, trustSection,
  gallerySection, faqSection, contactSection, locationSection, customHtmlSection,
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

  async saveDraft(businessId: string, payload: unknown, userId?: string) {
    const cleaned = sanitizePayload(payload);
    const existing = await this.prisma.client.sitePageDraft.findUnique({ where: { businessId } });
    const data = {
      payload: asJson(cleaned),
      status: 'DRAFT',
      lastSavedById: userId ?? null,
      version: existing ? existing.version + 1 : 1,
    };
    const upserted = await this.prisma.client.sitePageDraft.upsert({
      where: { businessId },
      update: data,
      create: { businessId, ...data },
    });
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
    const draft = await this.prisma.client.sitePageDraft.findUnique({
      where: { previewToken: token },
      include: { business: { select: {
        id: true, name: true, slug: true, logoUrl: true, tagline: true, description: true,
        address: true, city: true, country: true, phone: true, email: true, whatsapp: true,
      } } },
    });
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

  async publish(businessId: string, userId?: string) {
    const draft = await this.prisma.client.sitePageDraft.findUnique({ where: { businessId } });
    if (!draft) throw new BadRequestException('No draft to publish');
    const cleaned = sanitizePayload(draft.payload);
    const existing = await this.prisma.client.sitePagePublished.findUnique({ where: { businessId } });
    const nextVersion = (existing?.version ?? 0) + 1;
    const published = await this.prisma.client.sitePagePublished.upsert({
      where: { businessId },
      update: {
        payload: asJson(cleaned),
        version: nextVersion,
        publishedAt: new Date(),
        publishedById: userId ?? null,
        unpublishedAt: null,
      },
      create: {
        businessId,
        payload: asJson(cleaned),
        version: nextVersion,
        publishedById: userId ?? null,
      },
    });
    // Mark the draft as PUBLISHED so the editor reflects the live state.
    await this.prisma.client.sitePageDraft.update({
      where: { businessId },
      data: { status: 'PUBLISHED' },
    });
    if (cleaned.slug) {
      try {
        await this.prisma.client.business.update({ where: { id: businessId }, data: { slug: cleaned.slug } });
      } catch (err) {
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
    } catch {}
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
    } catch {}
    this.events.emit('SITE_UNPUBLISHED', { businessId, version: updated.version });
    return { id: updated.id, unpublishedAt: updated.unpublishedAt };
  }

  async getPublishedBySlug(slug: string) {
    const business = await this.prisma.client.business.findFirst({
      where: { slug, deletedAt: null },
      select: {
        id: true, name: true, slug: true, logoUrl: true, tagline: true, description: true,
        address: true, city: true, country: true, phone: true, email: true, whatsapp: true,
        primaryColor: true, secondaryColor: true, businessHours: true,
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
    return {
      business,
      payload: fromJson(published.payload),
      version: published.version,
      publishedAt: published.publishedAt,
      catalog: { services, products },
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
      let hasContent = false;
      switch (s.type) {
        case 'hero': hasContent = !!(s.data.headline && s.data.headline.trim()); break;
        case 'about': hasContent = !!(s.data.body && s.data.body.trim().length > 20); break;
        case 'faq': hasContent = (s.data.entries ?? []).length > 0; break;
        case 'gallery': hasContent = (s.data.images ?? []).length > 0; break;
        case 'trust': hasContent = (s.data.items ?? []).length > 0; break;
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
