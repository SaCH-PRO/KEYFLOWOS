import { Inject, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
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

  async applyTemplate(businessId: string, templateId: string) {
    const template = await this.prisma.client.businessTemplate.findFirst({
      where: { id: templateId },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    const config = template.config as any;

    if (config.products && Array.isArray(config.products)) {
      for (const product of config.products) {
        await this.prisma.client.product.create({
          data: {
            businessId,
            name: product.name,
            description: product.description ?? null,
            price: product.price ?? 0,
            category: product.category ?? 'PRODUCT',
            duration: product.duration ?? null,
          },
        });
      }
    }

    if (config.services && Array.isArray(config.services)) {
      for (const service of config.services) {
        await this.prisma.client.service.create({
          data: {
            businessId,
            name: service.name,
            description: service.description ?? null,
            price: service.price ?? 0,
            duration: service.duration ?? 60,
          },
        });
      }
    }

    if (config.expenseCategories && Array.isArray(config.expenseCategories)) {
      for (const category of config.expenseCategories) {
        await this.prisma.client.expenseCategory.upsert({
          where: {
            businessId_name: { businessId, name: category.name },
          },
          create: {
            businessId,
            name: category.name,
            icon: category.icon ?? null,
            color: category.color ?? null,
          },
          update: {},
        });
      }
    }

    if (template.archetype || template.industry) {
      await this.prisma.client.business.update({
        where: { id: businessId },
        data: {
          ...(template.archetype && { archetype: template.archetype }),
          ...(template.industry && { industry: template.industry }),
        },
      });
    }

    await this.prisma.client.businessTemplateUsage.upsert({
      where: {
        businessId_templateId: { businessId, templateId },
      },
      create: { businessId, templateId },
      update: { appliedAt: new Date() },
    });

    return { success: true, templateName: template.displayName };
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
