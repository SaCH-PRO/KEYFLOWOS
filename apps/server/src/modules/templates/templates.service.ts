import { ForbiddenException, Inject, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { isBusinessOwnerMember } from '../../core/auth/business-owner';
import { CatalogService } from '../catalog/catalog.service';

/**
 * R0-09d (owner ruling D-11): the refusal a non-owner gets on POST
 * .../templates/:templateId/apply; the code the concierge auto-configure
 * refusal answers (OnboardingConciergeService, R0-09b).
 */
export const BUSINESS_PROFILE_OWNER_ONLY = 'BUSINESS_PROFILE_OWNER_ONLY';

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  async listTemplates() {
    return this.prisma.client.businessTemplate.findMany({
      where: { isPublished: true },
      orderBy: { name: 'asc' },
    });
  }

  async getTemplate(id: string) {
    const template = await this.prisma.client.businessTemplate.findFirst({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    return template;
  }

  /**
   * Who may apply a template: the business owner only —
   * R0-09d-D11-GENESIS-TEMPLATES, owner ruling D-11 (2026-10-31: editing the
   * business profile is OWNER only, regardless of granted scopes; R0-09b review
   * SEC-1). applyTemplate writes the template's industry and archetype onto the
   * Business row (fields of the owner-only profile PATCH, PATCH
   * /identity/businesses/:businessId, R0-09) and records which template the
   * business was set up from (business_template_usages), besides creating the
   * template's products, services and expense categories. Every apply records
   * that setup template, so no apply writes no owner-only configuration and the
   * route is refused as a whole: 403 BUSINESS_PROFILE_OWNER_ONLY, before the
   * template is read (a non-owner learns nothing about which template ids
   * exist) and before anything is written.
   *
   * The owner is a member holding an OWNER membership of this business, the
   * one owner rule core/auth/business-owner.ts isBusinessOwnerMember states
   * (owner rulings D-104, D-116, D-125: Business.ownerId grants nothing on its
   * own; W11-OWNER-HELPER-D11); a SUPER_ADMIN keeps the platform bypass
   * BusinessGuard already grants. The actor is the authenticated user
   * AuthMiddleware attached (req.user); none is not the owner (fails closed).
   */
  async assertProfileOwner(businessId: string, actor: { id?: string; role?: string } | undefined): Promise<void> {
    if (await this.isProfileOwner(businessId, actor)) return;
    throw new ForbiddenException({
      code: BUSINESS_PROFILE_OWNER_ONLY,
      message: 'Only the business owner can apply a business template.',
    });
  }

  private async isProfileOwner(businessId: string, actor: { id?: string; role?: string } | undefined): Promise<boolean> {
    if (!actor?.id) return false;
    if (actor.role === 'SUPER_ADMIN') return true;
    return isBusinessOwnerMember(this.prisma.client, businessId, actor.id);
  }

  async applyTemplate(businessId: string, templateId: string) {
    const template = await this.prisma.client.businessTemplate.findFirst({
      where: { id: templateId },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    const config = (template.config ?? {}) as {
      products?: Array<{ name?: string; description?: string | null; price?: number; category?: string; duration?: number | null }>;
      services?: Array<{ name?: string; description?: string | null; price?: number; duration?: number }>;
      expenseCategories?: Array<{ name?: string; icon?: string | null; color?: string | null }>;
    };

    const normalizeName = (name: unknown): string | null =>
      typeof name === 'string' && name.trim().length > 0 ? name.trim().toLowerCase() : null;

    // CATALOG-1 server half (SWP-TEMPLATE-APPLY-ONCE, BUG-075, V1-64, P78):
    // serialize template applications per business in one transaction so a
    // repeat or concurrent apply adds nothing twice (products, services,
    // expense categories, or usage) and never clobbers later Business edits.
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('template_apply'), hashtext(${businessId}))`;

      const existingUsage = await tx.businessTemplateUsage.findUnique({
        where: {
          businessId_templateId: { businessId, templateId },
        },
        select: { id: true },
      });
      if (existingUsage) {
        return { success: true, templateName: template.displayName, alreadyApplied: true };
      }

      const [existingProducts, existingServices] = await Promise.all([
        tx.product.findMany({
          where: { businessId, deletedAt: null },
          select: { name: true },
        }),
        tx.service.findMany({
          where: { businessId, deletedAt: null },
          select: { name: true },
        }),
      ]);
      const existingProductNames = new Set(
        existingProducts.map((p) => normalizeName(p.name)).filter((n): n is string => n !== null),
      );
      const existingServiceNames = new Set(
        existingServices.map((s) => normalizeName(s.name)).filter((n): n is string => n !== null),
      );

      if (Array.isArray(config.products)) {
        for (const product of config.products) {
          const key = normalizeName(product?.name);
          if (!key || existingProductNames.has(key)) continue;
          await this.catalog.createProduct(
            {
              businessId,
              name: product.name!.trim(),
              description: product.description ?? null,
              price: product.price ?? 0,
              category: product.category ?? 'PRODUCT',
              duration: product.duration ?? null,
            },
            tx,
          );
          existingProductNames.add(key);
        }
      }

      if (Array.isArray(config.services)) {
        for (const service of config.services) {
          const key = normalizeName(service?.name);
          if (!key || existingServiceNames.has(key)) continue;
          await this.catalog.createService(
            {
              businessId,
              name: service.name!.trim(),
              description: service.description ?? null,
              price: service.price ?? 0,
              duration: service.duration ?? 60,
            },
            tx,
          );
          existingServiceNames.add(key);
        }
      }

      if (Array.isArray(config.expenseCategories)) {
        const seenCategories = new Set<string>();
        for (const category of config.expenseCategories) {
          const trimmed = typeof category?.name === 'string' ? category.name.trim() : '';
          if (!trimmed || seenCategories.has(trimmed.toLowerCase())) continue;
          seenCategories.add(trimmed.toLowerCase());
          await tx.expenseCategory.upsert({
            where: {
              businessId_name: { businessId, name: trimmed },
            },
            create: {
              businessId,
              name: trimmed,
              icon: category.icon ?? null,
              color: category.color ?? null,
            },
            update: {},
          });
        }
      }

      if (template.archetype || template.industry) {
        await tx.business.update({
          where: { id: businessId },
          data: {
            ...(template.archetype && { archetype: template.archetype }),
            ...(template.industry && { industry: template.industry }),
          },
        });
      }

      await tx.businessTemplateUsage.create({
        data: { businessId, templateId },
      });

      return { success: true, templateName: template.displayName, alreadyApplied: false };
    });
  }

  async seedDefaultTemplates() {
    const count = await this.prisma.client.businessTemplate.count();
    if (count > 0) {
      this.logger.log('Templates already exist, skipping seed');
      return;
    }

    const templates = [
      {
        name: 'freelancer',
        displayName: 'Freelancer',
        description: 'Perfect for freelancers, consultants, and solo digital professionals.',
        icon: '💻',
        industry: 'Technology',
        archetype: 'DIGITAL_PRODUCT',
        config: {
          products: [
            { name: 'Web Design', description: 'Custom website design service', price: 2500, category: 'SERVICE' },
            { name: 'Logo Design', description: 'Professional logo design package', price: 800, category: 'SERVICE' },
            { name: 'SEO Audit', description: 'Comprehensive SEO audit and report', price: 500, category: 'SERVICE' },
          ],
          expenseCategories: [
            { name: 'Software', icon: '🖥️' },
            { name: 'Equipment', icon: '⚙️' },
            { name: 'Marketing', icon: '📣' },
          ],
        },
      },
      {
        name: 'restaurant-food',
        displayName: 'Restaurant / Food',
        description: 'For restaurants, caterers, and food service businesses.',
        icon: '🍽️',
        industry: 'Food & Beverage',
        archetype: 'LOCAL_SERVICE',
        config: {
          products: [
            { name: 'Catering Service', description: 'Full catering for events', price: 5000, category: 'SERVICE' },
            { name: 'Meal Prep Package', description: 'Weekly meal prep service', price: 150, category: 'PACKAGE' },
          ],
          services: [
            { name: 'Private Dining', description: 'Exclusive private dining experience', price: 2000, duration: 180 },
            { name: 'Event Catering', description: 'On-site event catering service', price: 3000, duration: 240 },
          ],
          expenseCategories: [
            { name: 'Ingredients', icon: '🥬' },
            { name: 'Equipment', icon: '🍳' },
            { name: 'Packaging', icon: '📦' },
          ],
        },
      },
      {
        name: 'salon-beauty',
        displayName: 'Salon / Beauty',
        description: 'For salons, spas, and beauty professionals.',
        icon: '💇',
        industry: 'Beauty',
        archetype: 'LOCAL_SERVICE',
        config: {
          services: [
            { name: 'Haircut', description: 'Professional haircut service', price: 50, duration: 45 },
            { name: 'Color', description: 'Hair coloring service', price: 120, duration: 90 },
            { name: 'Manicure', description: 'Professional manicure', price: 35, duration: 30 },
          ],
          products: [
            { name: 'Hair Care Bundle', description: 'Shampoo, conditioner, and treatment set', price: 65, category: 'PRODUCT' },
          ],
          expenseCategories: [
            { name: 'Supplies', icon: '🧴' },
            { name: 'Rent', icon: '🏠' },
            { name: 'Marketing', icon: '📣' },
          ],
        },
      },
      {
        name: 'ecommerce',
        displayName: 'E-commerce',
        description: 'For online stores and retail businesses.',
        icon: '🛒',
        industry: 'Retail',
        archetype: 'ECOMMERCE',
        config: {
          products: [
            { name: 'Product A', description: 'Sample product listing', price: 29.99, category: 'PRODUCT' },
            { name: 'Product B', description: 'Sample product listing', price: 49.99, category: 'PRODUCT' },
          ],
          expenseCategories: [
            { name: 'Inventory', icon: '📦' },
            { name: 'Shipping', icon: '🚚' },
            { name: 'Marketing', icon: '📣' },
            { name: 'Packaging', icon: '🎁' },
          ],
        },
      },
    ];

    for (const t of templates) {
      await this.prisma.client.businessTemplate.create({ data: t });
    }

    this.logger.log('Seeded 4 default business templates');
  }
}
