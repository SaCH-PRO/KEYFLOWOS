import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { randomUUID } from 'crypto';

@Injectable()
export class EducationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async listCourses(filters?: { category?: string; difficulty?: string }) {
    const where: any = { isPublished: true };
    if (filters?.category) where.category = filters.category;
    if (filters?.difficulty) where.difficulty = filters.difficulty;

    return this.prisma.client.course.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { enrollments: true } },
      },
    });
  }

  async getCourse(id: string) {
    return this.prisma.client.course.findUnique({
      where: { id },
      include: {
        _count: { select: { enrollments: true } },
      },
    });
  }

  async createCourse(input: {
    title: string;
    description?: string;
    thumbnail?: string;
    category: string;
    difficulty?: string;
    duration?: number;
    lessons: any;
    isPublished?: boolean;
    isFree?: boolean;
    price?: number;
    businessId?: string;
  }) {
    return this.prisma.client.course.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        thumbnail: input.thumbnail ?? null,
        category: input.category,
        difficulty: input.difficulty ?? 'BEGINNER',
        duration: input.duration ?? null,
        lessons: input.lessons,
        isPublished: input.isPublished ?? false,
        isFree: input.isFree ?? true,
        price: input.price ?? null,
        businessId: input.businessId ?? null,
      },
    });
  }

  async updateCourse(input: {
    id: string;
    title?: string;
    description?: string;
    thumbnail?: string;
    category?: string;
    difficulty?: string;
    duration?: number;
    lessons?: any;
    isPublished?: boolean;
    isFree?: boolean;
    price?: number;
  }) {
    return this.prisma.client.course.update({
      where: { id: input.id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.thumbnail !== undefined && { thumbnail: input.thumbnail }),
        ...(input.category !== undefined && { category: input.category }),
        ...(input.difficulty !== undefined && { difficulty: input.difficulty }),
        ...(input.duration !== undefined && { duration: input.duration }),
        ...(input.lessons !== undefined && { lessons: input.lessons }),
        ...(input.isPublished !== undefined && { isPublished: input.isPublished }),
        ...(input.isFree !== undefined && { isFree: input.isFree }),
        ...(input.price !== undefined && { price: input.price }),
      },
    });
  }

  async enrollInCourse(businessId: string, courseId: string) {
    return this.prisma.client.courseEnrollment.create({
      data: {
        businessId,
        courseId,
        progress: {},
      },
      include: { course: true },
    });
  }

  async updateProgress(businessId: string, courseId: string, lessonId: string, completed: boolean) {
    const enrollment = await this.prisma.client.courseEnrollment.findUnique({
      where: { courseId_businessId: { courseId, businessId } },
      include: { course: true },
    });
    if (!enrollment) return null;

    const progress: Record<string, boolean> = (enrollment.progress as any) ?? {};
    progress[lessonId] = completed;

    const lessons = (enrollment.course.lessons as any[]) ?? [];
    const allCompleted = lessons.length > 0 && lessons.every((l: any) => progress[l.id] === true);

    return this.prisma.client.courseEnrollment.update({
      where: { courseId_businessId: { courseId, businessId } },
      data: {
        progress,
        ...(allCompleted && !enrollment.completedAt ? { completedAt: new Date() } : {}),
      },
      include: { course: true },
    });
  }

  async getMyEnrollments(businessId: string) {
    return this.prisma.client.courseEnrollment.findMany({
      where: { businessId },
      include: { course: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getCertificate(businessId: string, courseId: string) {
    const enrollment = await this.prisma.client.courseEnrollment.findUnique({
      where: { courseId_businessId: { courseId, businessId } },
      include: { course: true },
    });
    if (!enrollment) return null;

    const lessons = (enrollment.course.lessons as any[]) ?? [];
    const progress: Record<string, boolean> = (enrollment.progress as any) ?? {};
    const allCompleted = lessons.length > 0 && lessons.every((l: any) => progress[l.id] === true);

    if (!allCompleted) return { eligible: false, message: 'Not all lessons completed' };

    if (!enrollment.certificateId) {
      const certId = `CERT-${randomUUID().slice(0, 8).toUpperCase()}`;
      await this.prisma.client.courseEnrollment.update({
        where: { courseId_businessId: { courseId, businessId } },
        data: { certificateId: certId, completedAt: enrollment.completedAt ?? new Date() },
      });
      return { eligible: true, certificateId: certId, course: enrollment.course };
    }

    return { eligible: true, certificateId: enrollment.certificateId, course: enrollment.course };
  }

  async seedDefaultCourses() {
    const count = await this.prisma.client.course.count();
    if (count > 0) return { seeded: false, message: 'Courses already exist' };

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
          { id: 'gs-1', title: 'Welcome to KeyFlowOS', content: '# Welcome to KeyFlowOS\n\nIn this lesson, you\'ll learn what KeyFlowOS is and how it can help your business grow.\n\n## What is KeyFlowOS?\n\nKeyFlowOS is an all-in-one business management platform designed for Caribbean entrepreneurs.', order: 1 },
          { id: 'gs-2', title: 'Setting Up Your Profile', content: '# Setting Up Your Profile\n\nLearn how to configure your business profile, add your logo, and set up your branding.\n\n## Steps\n1. Navigate to Settings\n2. Fill in your business details\n3. Upload your logo', order: 2 },
          { id: 'gs-3', title: 'Your First Contact', content: '# Adding Your First Contact\n\nLearn how to add and manage contacts in the CRM.\n\n## Adding a Contact\nGo to the CRM section and click "Add Contact" to get started.', order: 3 },
          { id: 'gs-4', title: 'Creating Your First Invoice', content: '# Creating Your First Invoice\n\nLearn how to create and send professional invoices.\n\n## Steps\n1. Go to Commerce\n2. Click "New Invoice"\n3. Add line items and send', order: 4 },
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
          { id: 'cf-1', title: 'Understanding Cash Flow', content: '# Understanding Cash Flow\n\nCash flow is the lifeblood of any business. Learn the fundamentals of money coming in and going out.\n\n## Key Concepts\n- Revenue vs Profit\n- Operating Expenses\n- Cash Flow Cycle', order: 1 },
          { id: 'cf-2', title: 'Tracking Income', content: '# Tracking Income\n\nLearn how to track all revenue streams using KeyFlowOS invoicing and payment tools.', order: 2 },
          { id: 'cf-3', title: 'Managing Expenses', content: '# Managing Expenses\n\nUse the expense tracker to categorize and monitor your business spending.', order: 3 },
          { id: 'cf-4', title: 'Cash Flow Forecasting', content: '# Cash Flow Forecasting\n\nLearn to predict future cash flow based on historical data and upcoming commitments.', order: 4 },
          { id: 'cf-5', title: 'Improving Cash Flow', content: '# Improving Cash Flow\n\nStrategies to improve cash flow:\n- Faster invoicing\n- Payment terms optimization\n- Expense reduction', order: 5 },
        ],
      },
      {
        title: 'Client Acquisition 101',
        description: 'Learn proven strategies to attract and convert new clients for your business.',
        category: 'Marketing',
        difficulty: 'BEGINNER',
        duration: 25,
        isPublished: true,
        isFree: true,
        lessons: [
          { id: 'ca-1', title: 'Defining Your Ideal Client', content: '# Defining Your Ideal Client\n\nBefore you can attract clients, you need to know who they are.\n\n## Exercises\n- Create a client avatar\n- Identify pain points\n- Map the buyer journey', order: 1 },
          { id: 'ca-2', title: 'Building Your Online Presence', content: '# Building Your Online Presence\n\nCreate a professional digital footprint that attracts clients.\n\n## Channels\n- Social media profiles\n- Business website\n- Google Business Profile', order: 2 },
          { id: 'ca-3', title: 'Lead Generation Strategies', content: '# Lead Generation Strategies\n\nLearn multiple strategies to generate leads:\n- Content marketing\n- Referral programs\n- Lead forms & landing pages', order: 3 },
          { id: 'ca-4', title: 'The Follow-Up System', content: '# The Follow-Up System\n\nMost sales happen after the 5th follow-up. Learn to build a systematic follow-up process.', order: 4 },
          { id: 'ca-5', title: 'Converting Leads to Clients', content: '# Converting Leads to Clients\n\nMaster the art of closing:\n- Proposal writing\n- Pricing presentation\n- Handling objections', order: 5 },
        ],
      },
      {
        title: 'Pricing Your Services',
        description: 'Learn how to price your services for profitability and market competitiveness.',
        category: 'Strategy',
        difficulty: 'INTERMEDIATE',
        duration: 20,
        isPublished: true,
        isFree: true,
        lessons: [
          { id: 'ps-1', title: 'Cost-Based Pricing', content: '# Cost-Based Pricing\n\nUnderstand your costs and build pricing that ensures profitability.\n\n## Calculate\n- Direct costs\n- Overhead costs\n- Desired profit margin', order: 1 },
          { id: 'ps-2', title: 'Value-Based Pricing', content: '# Value-Based Pricing\n\nPrice based on the value you deliver, not just your costs.\n\n## Framework\n- Identify client outcomes\n- Quantify the value\n- Set price as fraction of value', order: 2 },
          { id: 'ps-3', title: 'Package & Tier Pricing', content: '# Package & Tier Pricing\n\nCreate service packages that appeal to different market segments.\n\n## Structure\n- Basic / Standard / Premium tiers\n- Bundle complementary services\n- Create clear value differentiation', order: 3 },
          { id: 'ps-4', title: 'Raising Your Prices', content: '# Raising Your Prices\n\nLearn when and how to increase prices without losing clients.\n\n## Best Practices\n- Give advance notice\n- Grandfather existing clients\n- Add new value with price increases', order: 4 },
        ],
      },
      {
        title: 'Automating Your Business',
        description: 'Save time and reduce errors by automating repetitive business tasks.',
        category: 'Operations',
        difficulty: 'INTERMEDIATE',
        duration: 30,
        isPublished: true,
        isFree: true,
        lessons: [
          { id: 'ab-1', title: 'Identifying Automation Opportunities', content: '# Identifying Automation Opportunities\n\nFind the tasks that are eating up your time.\n\n## Common Candidates\n- Follow-up emails\n- Invoice reminders\n- Appointment confirmations\n- Social media posting', order: 1 },
          { id: 'ab-2', title: 'Email Automation', content: '# Email Automation\n\nSet up automated email sequences for:\n- Welcome series\n- Follow-ups\n- Payment reminders\n- Re-engagement campaigns', order: 2 },
          { id: 'ab-3', title: 'Booking Automation', content: '# Booking Automation\n\nAutomate your scheduling:\n- Online booking pages\n- Confirmation emails\n- Reminder notifications\n- Calendar syncing', order: 3 },
          { id: 'ab-4', title: 'Invoice Automation', content: '# Invoice Automation\n\nStreamline your billing:\n- Recurring invoices\n- Payment reminders\n- Receipt generation\n- Overdue notifications', order: 4 },
          { id: 'ab-5', title: 'Social Media Automation', content: '# Social Media Automation\n\nSchedule and automate your social presence:\n- Content calendar\n- Scheduled posting\n- Multi-platform publishing', order: 5 },
          { id: 'ab-6', title: 'Building Your Automation Stack', content: '# Building Your Automation Stack\n\nPut it all together:\n- Map your business processes\n- Prioritize automations by impact\n- Monitor and optimize\n- Scale what works', order: 6 },
        ],
      },
    ];

    for (const course of courses) {
      await this.prisma.client.course.create({ data: course });
    }

    return { seeded: true, count: courses.length };
  }
}
