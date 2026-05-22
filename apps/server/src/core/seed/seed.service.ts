import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseAdminService } from '../../core/auth/supabase-admin.service';
import { IdentityService } from '../../modules/identity/identity.service';
import { DOCUMENT_CATEGORIES, DOCUMENT_TYPES } from '../../modules/documents/document-taxonomy';

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SupabaseAdminService) private readonly supabaseAdmin: SupabaseAdminService,
    @Inject(IdentityService) private readonly identity: IdentityService,
  ) {}

  async onApplicationBootstrap() {
    await this.seedTemplates();
    await this.seedCourses();
    await this.seedCohorts();
    await this.seedDocumentTaxonomy();
    await this.seedSuperAdmin();
    await this.seedDevUser();
    // Dev auth bypass profile seeding was removed in the Tier 2 auth hardening
    // pass. Old dev profile rows in the DB are harmless (no real Supabase
    // identity backs them, so nobody can authenticate as them) but can be
    // cleaned up manually if desired.
  }

  private async seedSuperAdmin() {
    const SUPER_ADMIN_EMAIL = 'keyflowos.tt@gmail.com';
    try {
      const user = await this.prisma.client.user.findUnique({
        where: { email: SUPER_ADMIN_EMAIL },
        select: { id: true, role: true },
      });
      if (!user) {
        this.logger.log(`Super admin user (${SUPER_ADMIN_EMAIL}) not found yet — skipping promotion`);
        return;
      }
      if (user.role === 'SUPER_ADMIN') {
        this.logger.log(`Super admin (${SUPER_ADMIN_EMAIL}) already promoted`);
        return;
      }
      await this.prisma.client.user.update({
        where: { email: SUPER_ADMIN_EMAIL },
        data: { role: 'SUPER_ADMIN' },
      });
      this.logger.log(`Promoted ${SUPER_ADMIN_EMAIL} to SUPER_ADMIN`);
    } catch (e) {
      this.logger.warn('Super admin seed failed: ' + (e as Error).message);
    }
  }

  private async seedDevUser() {
    if (process.env.NODE_ENV !== 'development') return;
    const DEV_EMAIL = 'dev@keyflow.local';
    const DEV_PASSWORD = 'keyflowdev123';
    try {
      // Skip if Supabase admin is not configured
      if (!this.supabaseAdmin.isConfigured()) {
        this.logger.warn('Supabase admin not configured — skipping dev user seed');
        return;
      }
      // Check if dev user already exists in Prisma
      const existingLocalUser = await this.prisma.client.user.findUnique({
        where: { email: DEV_EMAIL },
        select: { id: true },
      });
      if (existingLocalUser) {
        this.logger.log(`Dev user (${DEV_EMAIL}) already exists — skipping seed`);
        return;
      }
      // Check if dev user exists in Supabase ( orphaned — no local row )
      const existingAuthUser = await this.supabaseAdmin.findUserByEmail(DEV_EMAIL);
      let supabaseUserId: string;
      if (existingAuthUser) {
        supabaseUserId = existingAuthUser.id;
        this.logger.log(`Dev user exists in Supabase auth; reusing id=${supabaseUserId}`);
      } else {
        // Create fresh Supabase auth user (auto-confirmed)
        const newUser = await this.supabaseAdmin.createUser({
          email: DEV_EMAIL,
          password: DEV_PASSWORD,
          emailConfirm: true,
          userMetadata: { full_name: 'Dev User', first_name: 'Dev', last_name: 'User' },
        });
        supabaseUserId = newUser.id;
        this.logger.log(`Created dev user in Supabase auth (id=${supabaseUserId})`);
      }
      // Bootstrap Prisma User + Business + Membership
      const { user, business } = await this.identity.bootstrapUser({
        userId: supabaseUserId,
        email: DEV_EMAIL,
        name: 'Dev User',
        firstName: 'Dev',
        lastName: 'User',
      });
      this.logger.log(
        `============================================================\n` +
        `  DEV USER READY  \n` +
        `  Email:    ${DEV_EMAIL}\n` +
        `  Password: ${DEV_PASSWORD}\n` +
        `  User ID:  ${user.id}\n` +
        `  Business: ${business.name} (${business.id})\n` +
        `============================================================`,
      );
    } catch (e) {
      this.logger.warn('Dev user seed failed: ' + (e as Error).message);
    }
  }

  private async seedDocumentTaxonomy() {
    try {
      const existingCats = await this.prisma.client.documentCategory.findMany();
      const existingTypes = await this.prisma.client.documentType.findMany();
      const existingCatSlugs = new Set(existingCats.map((c) => c.slug));
      const existingTypeSlugs = new Set(existingTypes.map((t) => t.slug));

      let newCats = 0;
      let newTypes = 0;

      for (const cat of DOCUMENT_CATEGORIES) {
        let catRecord = existingCats.find((c) => c.slug === cat.slug);
        if (!catRecord) {
          catRecord = await this.prisma.client.documentCategory.create({
            data: {
              name: cat.name,
              slug: cat.slug,
              description: cat.description,
              icon: cat.icon,
              sortOrder: cat.sortOrder,
              tier: cat.tier,
              trigger: cat.trigger,
            },
          });
          newCats++;
        }

        const typesForCat = DOCUMENT_TYPES.filter((t) => t.categorySlug === cat.slug);
        for (const dt of typesForCat) {
          if (!existingTypeSlugs.has(dt.slug)) {
            await this.prisma.client.documentType.create({
              data: {
                categoryId: catRecord.id,
                name: dt.name,
                slug: dt.slug,
                description: dt.description,
                riskTier: dt.riskTier,
                requiredProfileFields: dt.requiredProfileFields,
                brandSensitive: dt.brandSensitive,
                financialSensitive: dt.financialSensitive,
                legalSensitive: dt.legalSensitive,
                jurisdictionSensitive: dt.jurisdictionSensitive,
                sortOrder: dt.sortOrder,
              },
            });
            existingTypeSlugs.add(dt.slug);
            newTypes++;
          }
        }
      }

      const ruleCount = await this.prisma.client.impactRule.count();
      if (ruleCount === 0 || newTypes > 0) {
        await this.seedImpactRules();
      }

      if (newCats > 0 || newTypes > 0) {
        this.logger.log(`Seeded ${newCats} new categories and ${newTypes} new document types`);
      } else {
        this.logger.log('Document taxonomy up to date');
      }
    } catch (error) {
      this.logger.warn('Document taxonomy seed failed: ' + (error as Error).message);
    }
  }

  private async seedImpactRules() {
    const allDocTypes = await this.prisma.client.documentType.findMany();
    const typeSlugToId = new Map(allDocTypes.map((t) => [t.slug, t.id]));
    const existingRules = await this.prisma.client.impactRule.findMany({
      select: { documentTypeId: true, profileField: true },
    });
    const existingRuleKeys = new Set(existingRules.map((r) => `${r.documentTypeId}:${r.profileField}`));
    let ruleCount = 0;

    for (const dt of DOCUMENT_TYPES) {
      const docTypeId = typeSlugToId.get(dt.slug);
      if (!docTypeId) continue;
      for (const field of dt.requiredProfileFields) {
        const key = `${docTypeId}:${field}`;
        if (existingRuleKeys.has(key)) continue;
        await this.prisma.client.impactRule.create({
          data: {
            profileField: field,
            documentTypeId: docTypeId,
            impactLevel: dt.riskTier === 'RED' ? 'HIGH' : dt.riskTier === 'YELLOW' ? 'MEDIUM' : 'LOW',
            description: `Changes to "${field}" may affect ${dt.name}`,
          },
        });
        existingRuleKeys.add(key);
        ruleCount++;
      }
    }

    this.logger.log(`Seeded ${ruleCount} new impact rules`);
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
        {
          name: 'consulting-agency',
          displayName: 'Consulting / Agency',
          description: 'For consulting firms and agencies providing professional services.',
          icon: '🏢',
          industry: 'Professional Services',
          archetype: 'DIGITAL_PRODUCT',
          config: {
            products: [
              { name: 'Strategy Consultation', description: 'Strategic consulting services', price: 3000, category: 'SERVICE' },
              { name: 'Brand Audit', description: 'Comprehensive brand audit and recommendations', price: 1500, category: 'SERVICE' },
              { name: 'Market Research Report', description: 'In-depth market research report', price: 2000, category: 'SERVICE' },
              { name: 'Retainer Package', description: 'Monthly retainer package for ongoing consulting', price: 5000, category: 'SERVICE' },
            ],
            expenseCategories: [
              { name: 'Office', icon: '🏢' },
              { name: 'Travel', icon: '✈️' },
              { name: 'Software', icon: '💻' },
              { name: 'Team', icon: '👥' },
            ],
          },
        },
        {
          name: 'fitness-wellness',
          displayName: 'Fitness / Wellness',
          description: 'For gyms, personal trainers, and wellness professionals.',
          icon: '💪',
          industry: 'Health & Fitness',
          archetype: 'LOCAL_SERVICE',
          config: {
            services: [
              { name: 'Personal Training', description: 'One-on-one personal training session', price: 80, duration: 60 },
              { name: 'Group Class', description: 'Group fitness class', price: 25, duration: 45 },
              { name: 'Wellness Consultation', description: 'Wellness and nutrition consultation', price: 120, duration: 60 },
            ],
            products: [
              { name: 'Membership - Monthly', description: 'Monthly gym membership', price: 99, category: 'PACKAGE' },
              { name: 'Protein Supplements', description: 'Protein supplement package', price: 45, category: 'PRODUCT' },
            ],
            expenseCategories: [
              { name: 'Equipment', icon: '🏋️' },
              { name: 'Rent', icon: '🏠' },
              { name: 'Insurance', icon: '🛡️' },
              { name: 'Marketing', icon: '📣' },
            ],
          },
        },
        {
          name: 'photography-creative',
          displayName: 'Photography / Creative',
          description: 'For photographers, videographers, and creative professionals.',
          icon: '📸',
          industry: 'Creative Services',
          archetype: 'DIGITAL_PRODUCT',
          config: {
            services: [
              { name: 'Portrait Session', description: 'Professional portrait photography session', price: 300, duration: 90 },
              { name: 'Event Photography', description: 'Full event photography coverage', price: 1500, duration: 480 },
              { name: 'Video Production', description: 'Professional video production service', price: 2500, duration: 240 },
            ],
            products: [
              { name: 'Photo Print Package', description: 'High-quality photo prints', price: 200, category: 'PRODUCT' },
              { name: 'Digital Gallery Access', description: 'Cloud-based digital gallery access', price: 100, category: 'PRODUCT' },
            ],
            expenseCategories: [
              { name: 'Equipment', icon: '📷' },
              { name: 'Software', icon: '🖥️' },
              { name: 'Props & Sets', icon: '🎭' },
              { name: 'Travel', icon: '✈️' },
            ],
          },
        },
        {
          name: 'cleaning-services',
          displayName: 'Cleaning / Home Services',
          description: 'For cleaning companies, handyman services, and home maintenance.',
          icon: '🧹',
          industry: 'Home Services',
          archetype: 'LOCAL_SERVICE',
          config: {
            services: [
              { name: 'Standard Cleaning', description: 'Standard residential cleaning service', price: 120, duration: 120 },
              { name: 'Deep Cleaning', description: 'Comprehensive deep cleaning service', price: 250, duration: 240 },
              { name: 'Move-in/out Clean', description: 'Move-in or move-out cleaning service', price: 400, duration: 360 },
            ],
            products: [
              { name: 'Monthly Cleaning Plan', description: 'Monthly recurring cleaning service package', price: 350, category: 'PACKAGE' },
            ],
            expenseCategories: [
              { name: 'Supplies', icon: '🧴' },
              { name: 'Transport', icon: '🚗' },
              { name: 'Equipment', icon: '⚙️' },
              { name: 'Insurance', icon: '🛡️' },
            ],
          },
        },
        {
          name: 'tutoring-education',
          displayName: 'Tutoring / Education',
          description: 'For tutors, coaches, and online educators.',
          icon: '📚',
          industry: 'Education',
          archetype: 'DIGITAL_PRODUCT',
          config: {
            services: [
              { name: '1-on-1 Tutoring', description: 'One-on-one personalized tutoring session', price: 60, duration: 60 },
              { name: 'Group Workshop', description: 'Group learning workshop', price: 35, duration: 90 },
              { name: 'Course Mentorship', description: 'Personal mentorship for course completion', price: 200, duration: 60 },
            ],
            products: [
              { name: 'Online Course Bundle', description: 'Complete online course bundle', price: 299, category: 'PRODUCT' },
              { name: 'Study Materials', description: 'Comprehensive study materials package', price: 49, category: 'PRODUCT' },
            ],
            expenseCategories: [
              { name: 'Books & Resources', icon: '📖' },
              { name: 'Software', icon: '💻' },
              { name: 'Marketing', icon: '📣' },
              { name: 'Rent', icon: '🏠' },
            ],
          },
        },
        {
          name: 'event-planning',
          displayName: 'Event Planning',
          description: 'For event planners and wedding coordinators.',
          icon: '🎉',
          industry: 'Events',
          archetype: 'LOCAL_SERVICE',
          config: {
            services: [
              { name: 'Wedding Coordination', description: 'Full wedding coordination and planning', price: 5000, duration: 600 },
              { name: 'Corporate Event', description: 'Corporate event planning and execution', price: 3000, duration: 480 },
              { name: 'Birthday Party', description: 'Birthday party planning and coordination', price: 1500, duration: 300 },
            ],
            products: [
              { name: 'Decoration Package', description: 'Event decoration package', price: 800, category: 'PRODUCT' },
              { name: 'Audio/Visual Rental', description: 'Audio and visual equipment rental', price: 500, category: 'PRODUCT' },
            ],
            expenseCategories: [
              { name: 'Decor', icon: '🎨' },
              { name: 'Catering', icon: '🍽️' },
              { name: 'Venue', icon: '🏛️' },
              { name: 'Staff', icon: '👥' },
              { name: 'Rentals', icon: '🪑' },
            ],
          },
        },
      ];

      for (const t of templates) {
        await this.prisma.client.businessTemplate.create({ data: t });
      }
      this.logger.log('Seeded 10 default business templates');
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
