import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async onApplicationBootstrap() {
    await this.seedTemplates();
    await this.seedCourses();
    await this.seedCohorts();
  }

  private async seedTemplates() {
    try {
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
    } catch (e) {
      this.logger.warn('Templates seed failed: ' + (e as Error).message);
    }
  }

  private async seedCourses() {
    try {
      const count = await this.prisma.client.course.count();
      if (count > 0) {
        this.logger.log('Courses already exist, skipping seed');
        return;
      }

      const courses = [
        {
          title: 'Getting Started with KeyFlowOS',
          description: 'Learn the basics of KeyFlowOS and set up your business for success.',
          category: 'Business',
          difficulty: 'BEGINNER',
          duration: 15,
          isPublished: true,
          isFree: true,
          lessons: [
            { id: 'gs-1', title: 'Welcome to KeyFlowOS', content: 'Learn what KeyFlowOS is and how it can help your business grow.', order: 1 },
            { id: 'gs-2', title: 'Setting Up Your Profile', content: 'Configure your business profile, add your logo, and set up branding.', order: 2 },
            { id: 'gs-3', title: 'Your First Contact', content: 'Add and manage contacts in the CRM.', order: 3 },
            { id: 'gs-4', title: 'Creating Your First Invoice', content: 'Create and send professional invoices.', order: 4 },
          ],
        },
        {
          title: 'Mastering Your Cash Flow',
          description: 'Understand and optimize your business cash flow for sustainable growth.',
          category: 'Finance',
          difficulty: 'BEGINNER',
          duration: 20,
          isPublished: true,
          isFree: true,
          lessons: [
            { id: 'cf-1', title: 'Understanding Cash Flow', content: 'Cash flow fundamentals: revenue vs profit, operating expenses.', order: 1 },
            { id: 'cf-2', title: 'Tracking Income', content: 'Track all revenue streams using invoicing and payment tools.', order: 2 },
            { id: 'cf-3', title: 'Managing Expenses', content: 'Categorize and monitor your business spending.', order: 3 },
            { id: 'cf-4', title: 'Cash Flow Forecasting', content: 'Predict future cash flow based on historical data.', order: 4 },
            { id: 'cf-5', title: 'Improving Cash Flow', content: 'Strategies: faster invoicing, payment terms, expense reduction.', order: 5 },
          ],
        },
        {
          title: 'Client Acquisition 101',
          description: 'Learn proven strategies to attract and convert new clients.',
          category: 'Marketing',
          difficulty: 'BEGINNER',
          duration: 25,
          isPublished: true,
          isFree: true,
          lessons: [
            { id: 'ca-1', title: 'Defining Your Ideal Client', content: 'Create client avatar, identify pain points, map buyer journey.', order: 1 },
            { id: 'ca-2', title: 'Building Your Online Presence', content: 'Create a professional digital footprint.', order: 2 },
            { id: 'ca-3', title: 'Lead Generation Strategies', content: 'Content marketing, referral programs, lead forms.', order: 3 },
            { id: 'ca-4', title: 'The Follow-Up System', content: 'Build a systematic follow-up process.', order: 4 },
            { id: 'ca-5', title: 'Converting Leads to Clients', content: 'Proposal writing, pricing, handling objections.', order: 5 },
          ],
        },
        {
          title: 'Pricing Your Services',
          description: 'Price your services for profitability and market competitiveness.',
          category: 'Strategy',
          difficulty: 'INTERMEDIATE',
          duration: 20,
          isPublished: true,
          isFree: true,
          lessons: [
            { id: 'ps-1', title: 'Cost-Based Pricing', content: 'Understand costs and build profitable pricing.', order: 1 },
            { id: 'ps-2', title: 'Value-Based Pricing', content: 'Price based on value delivered.', order: 2 },
            { id: 'ps-3', title: 'Package & Tier Pricing', content: 'Create service packages for different segments.', order: 3 },
            { id: 'ps-4', title: 'Raising Your Prices', content: 'When and how to increase prices.', order: 4 },
          ],
        },
        {
          title: 'Automating Your Business',
          description: 'Save time by automating repetitive business tasks.',
          category: 'Operations',
          difficulty: 'INTERMEDIATE',
          duration: 30,
          isPublished: true,
          isFree: true,
          lessons: [
            { id: 'ab-1', title: 'Identifying Automation Opportunities', content: 'Find tasks eating your time.', order: 1 },
            { id: 'ab-2', title: 'Email Automation', content: 'Automated email sequences for follow-ups and reminders.', order: 2 },
            { id: 'ab-3', title: 'Booking Automation', content: 'Online booking, confirmations, reminders.', order: 3 },
            { id: 'ab-4', title: 'Invoice Automation', content: 'Recurring invoices, payment reminders, receipts.', order: 4 },
            { id: 'ab-5', title: 'Social Media Automation', content: 'Content calendar and scheduled posting.', order: 5 },
            { id: 'ab-6', title: 'Building Your Automation Stack', content: 'Map processes, prioritize, and scale.', order: 6 },
          ],
        },
      ];

      for (const course of courses) {
        await this.prisma.client.course.create({ data: course });
      }
      this.logger.log(`Seeded ${courses.length} default courses`);
    } catch (e) {
      this.logger.warn('Courses seed failed: ' + (e as Error).message);
    }
  }

  private async seedCohorts() {
    try {
      const count = await this.prisma.client.cohort.count();
      if (count > 0) {
        this.logger.log('Cohorts already exist, skipping seed');
        return;
      }

      const cohorts = [
        { name: 'Caribbean Founders Circle', description: 'A community for Caribbean entrepreneurs to connect and grow together.', maxMembers: 10, industry: 'General', isActive: true },
        { name: 'Service Business Owners', description: 'Connect with other service-based business owners.', maxMembers: 10, industry: 'Services', isActive: true },
        { name: 'E-commerce Entrepreneurs', description: 'Join fellow e-commerce entrepreneurs to discuss online selling.', maxMembers: 10, industry: 'Retail', isActive: true },
      ];

      for (const cohort of cohorts) {
        await this.prisma.client.cohort.create({ data: cohort });
      }
      this.logger.log('Seeded 3 default cohorts');
    } catch (e) {
      this.logger.warn('Cohorts seed failed: ' + (e as Error).message);
    }
  }
}
