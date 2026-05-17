export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  logs?: string[];
}

export type ToolFn = (businessId: string, input: Record<string, unknown>, prisma: any) => Promise<ToolResult>;

export const keyToolRegistry: Record<string, Record<string, ToolFn>> = {
  contacts: {
    searchContacts: async (businessId, input, prisma) => {
      const query = (input.query as string) || '';
      const contacts = await prisma.contact.findMany({
        where: {
          businessId,
          deletedAt: null,
          OR: [
            { firstName: { contains: query, mode: 'insensitive' } },
            { lastName: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
            { companyName: { contains: query, mode: 'insensitive' } },
          ],
        },
        take: 20,
        orderBy: { updatedAt: 'desc' },
      });
      return { success: true, data: { contacts, count: contacts.length } };
    },
    summarizeContact: async (businessId, input, prisma) => {
      const contact = await prisma.contact.findUnique({
        where: { id: input.contactId as string },
        include: {
          deals: { where: { deletedAt: null } },
          invoices: { where: { deletedAt: null } },
          bookings: { where: { deletedAt: null } },
          tasks: { where: { status: 'OPEN' } },
        },
      });
      if (!contact) return { success: false, error: 'Contact not found' };
      return { success: true, data: { contact } };
    },
    recommendFollowUps: async (businessId, _input, prisma) => {
      const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000);
      const contacts = await prisma.contact.findMany({
        where: {
          businessId,
          deletedAt: null,
          lastInteractionAt: { lt: fourteenDaysAgo },
          status: { not: 'DORMANT' },
        },
        orderBy: { lastInteractionAt: 'asc' },
        take: 10,
      });
      return { success: true, data: { contacts, count: contacts.length } };
    },
    createContactTask: async (businessId, input, prisma) => {
      const task = await prisma.contactTask.create({
        data: {
          businessId,
          contactId: input.contactId as string,
          title: input.title as string,
          description: (input.description as string) || null,
          status: 'OPEN',
          dueDate: input.dueDate ? new Date(input.dueDate as string) : null,
          priority: (input.priority as string) || 'MEDIUM',
        },
      });
      return { success: true, data: { task } };
    },
  },
  commerce: {
    summarizeRevenue: async (businessId, _input, prisma) => {
      const agg = await prisma.invoice.aggregate({
        where: { businessId, deletedAt: null, status: 'PAID' },
        _sum: { total: true },
      });
      const count = await prisma.invoice.count({ where: { businessId, deletedAt: null, status: 'PAID' } });
      return { success: true, data: { totalRevenue: Number(agg._sum.total ?? 0), paidInvoiceCount: count } };
    },
    draftQuote: async (businessId, input, prisma) => {
      const quote = await prisma.quote.create({
        data: {
          businessId,
          contactId: input.contactId as string,
          quoteNumber: `QT-${Date.now()}`,
          status: 'DRAFT',
          issueDate: new Date(),
          subtotal: 0,
          taxRate: 0,
          taxAmount: 0,
          total: 0,
          currency: 'TTD',
        },
      });
      return { success: true, data: { quote } };
    },
    draftInvoice: async (businessId, input, prisma) => {
      const invoice = await prisma.invoice.create({
        data: {
          businessId,
          contactId: input.contactId as string,
          invoiceNumber: `INV-${Date.now()}`,
          status: 'DRAFT',
          issueDate: new Date(),
          subtotal: 0,
          taxRate: 0,
          taxAmount: 0,
          total: 0,
          currency: 'TTD',
        },
      });
      return { success: true, data: { invoice } };
    },
    recommendPricing: async (businessId, _input, prisma) => {
      const products = await prisma.product.findMany({
        where: { businessId, deletedAt: null, isActive: true },
        orderBy: { price: 'desc' },
        take: 5,
      });
      return { success: true, data: { topProducts: products } };
    },
    analyzeCatalog: async (businessId, _input, prisma) => {
      const [productCount, serviceCount] = await Promise.all([
        prisma.product.count({ where: { businessId, deletedAt: null } }),
        prisma.service.count({ where: { businessId, deletedAt: null } }),
      ]);
      return { success: true, data: { productCount, serviceCount } };
    },
  },
  bookings: {
    findAvailability: async (businessId, input, prisma) => {
      const date = input.date ? new Date(input.date as string) : new Date();
      const startOfDay = new Date(date.setHours(0, 0, 0, 0));
      const endOfDay = new Date(date.setHours(23, 59, 59, 999));
      const bookings = await prisma.booking.findMany({
        where: {
          businessId,
          deletedAt: null,
          startTime: { gte: startOfDay, lte: endOfDay },
          status: { not: 'CANCELLED' },
        },
        select: { startTime: true, endTime: true, staffId: true },
      });
      return { success: true, data: { date: input.date, bookedSlots: bookings } };
    },
    createBookingDraft: async (businessId, input, prisma) => {
      const booking = await prisma.booking.create({
        data: {
          businessId,
          contactId: input.contactId as string,
          serviceId: input.serviceId as string,
          staffId: input.staffId as string | undefined,
          startTime: new Date(input.startTime as string),
          endTime: new Date(input.endTime as string),
          status: 'PENDING',
          notes: (input.notes as string) || null,
        },
      });
      return { success: true, data: { booking } };
    },
    summarizeSchedule: async (businessId, _input, prisma) => {
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const [todayCount, upcomingCount] = await Promise.all([
        prisma.booking.count({ where: { businessId, deletedAt: null, startTime: { gte: now, lt: tomorrow }, status: { not: 'CANCELLED' } } }),
        prisma.booking.count({ where: { businessId, deletedAt: null, startTime: { gte: tomorrow }, status: { not: 'CANCELLED' } } }),
      ]);
      return { success: true, data: { todayCount, upcomingCount } };
    },
  },
  timeline: {
    summarizePeriod: async (businessId, input, prisma) => {
      const from = input.from ? new Date(input.from as string) : new Date(Date.now() - 30 * 86400000);
      const to = input.to ? new Date(input.to as string) : new Date();
      const events = await prisma.timelineEvent.count({
        where: { businessId, occurredAt: { gte: from, lte: to } },
      });
      return { success: true, data: { from, to, eventCount: events } };
    },
    createReminder: async (businessId, input, prisma) => {
      const task = await prisma.contactTask.create({
        data: {
          businessId,
          contactId: input.contactId as string | undefined,
          title: input.title as string,
          status: 'OPEN',
          dueDate: input.dueDate ? new Date(input.dueDate as string) : null,
        },
      });
      return { success: true, data: { reminder: task } };
    },
    createScheduledAction: async (businessId, input, prisma) => {
      const action = await prisma.contactTask.create({
        data: {
          businessId,
          title: input.action as string,
          status: 'OPEN',
          dueDate: input.scheduledAt ? new Date(input.scheduledAt as string) : null,
        },
      });
      return { success: true, data: { action } };
    },
  },
  storefront: {
    auditStorefront: async (businessId, _input, prisma) => {
      const [productCount, serviceCount, config] = await Promise.all([
        prisma.product.count({ where: { businessId, deletedAt: null, isActive: true } }),
        prisma.service.count({ where: { businessId, deletedAt: null } }),
        prisma.business.findUnique({ where: { id: businessId }, select: { metaData: true } }),
      ]);
      return { success: true, data: { productCount, serviceCount, hasStorefront: !!(config?.metaData as any)?.storefront } };
    },
    recommendLayout: async (businessId, _input, _prisma) => {
      return { success: true, data: { recommendation: 'Consider adding a hero section and featured products block' } };
    },
    draftCopy: async (businessId, input, _prisma) => {
      return { success: true, data: { businessId, section: input.section, draft: `Draft copy for ${input.section} section` } };
    },
  },
  blueprint: {
    analyzeBlueprint: async (businessId, _input, prisma) => {
      const [contactCount, invoiceCount, bookingCount] = await Promise.all([
        prisma.contact.count({ where: { businessId, deletedAt: null } }),
        prisma.invoice.count({ where: { businessId, deletedAt: null } }),
        prisma.booking.count({ where: { businessId, deletedAt: null } }),
      ]);
      return { success: true, data: { contactCount, invoiceCount, bookingCount } };
    },
    recommendSetupSteps: async (businessId, _input, prisma) => {
      const business = await prisma.business.findUnique({ where: { id: businessId } });
      const steps = [];
      if (!business?.logoUrl) steps.push('Upload business logo');
      if (!business?.primaryColor) steps.push('Set brand color');
      return { success: true, data: { steps, completionPercent: Math.max(0, 100 - steps.length * 20) } };
    },
    inferFromData: async (businessId, _input, prisma) => {
      const contacts = await prisma.contact.findMany({ where: { businessId, deletedAt: null }, take: 1 });
      return { success: true, data: { hasData: contacts.length > 0, industryHint: contacts[0]?.industry } };
    },
  },
  procurement: {
    generateBrief: async (businessId, input, _prisma) => {
      return { success: true, data: { businessId, requestId: input.requestId, brief: 'Procurement brief stub' } };
    },
    recommendPackage: async (businessId, input, _prisma) => {
      return { success: true, data: { businessId, requestId: input.requestId, package: 'Standard package recommended' } };
    },
    notifyOwner: async (businessId, input, _prisma) => {
      return { success: true, data: { businessId, message: input.message, notified: true } };
    },
  },
};
