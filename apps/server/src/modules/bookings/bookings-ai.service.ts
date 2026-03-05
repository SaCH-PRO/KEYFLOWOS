import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';

@Injectable()
export class BookingsAiService {
  private readonly logger = new Logger(BookingsAiService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  private sanitizeInput(input: string, maxLen = 500): string {
    let sanitized = input;
    const injectionPatterns = [
      /<\|system\|>/gi,
      /<\|user\|>/gi,
      /<\|assistant\|>/gi,
      /\[INST\]/gi,
      /\[\/INST\]/gi,
      /<<SYS>>/gi,
      /<<\/SYS>>/gi,
      /<\/s>/gi,
      /^Human:/gim,
      /^Assistant:/gim,
      /^System:/gim,
    ];
    for (const pattern of injectionPatterns) {
      sanitized = sanitized.replace(pattern, '');
    }
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    return sanitized.slice(0, maxLen);
  }

  private async buildBookingsContext(businessId: string): Promise<string> {
    const [bookings, services, staff] = await Promise.all([
      this.db.booking.findMany({
        where: { businessId, deletedAt: null },
        select: {
          id: true, status: true, startTime: true, endTime: true, createdAt: true,
          contact: { select: { id: true, firstName: true, lastName: true, email: true } },
          service: { select: { id: true, name: true, duration: true, price: true } },
          staff: { select: { id: true, name: true } },
        },
        orderBy: { startTime: 'desc' },
        take: 100,
      }),
      this.db.service.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true, duration: true, price: true },
        orderBy: { name: 'asc' },
      }),
      this.db.staffMember.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const parts: string[] = [];

    parts.push(`Services (${services.length}):`);
    services.forEach((s) => {
      parts.push(`  - ${s.name} (${s.duration} min, $${s.price}) [ID: ${s.id}]`);
    });

    parts.push(`\nStaff (${staff.length}):`);
    staff.forEach((s) => {
      parts.push(`  - ${s.name} [ID: ${s.id}]`);
    });

    parts.push(`\nBookings (${bookings.length}):`);
    bookings.forEach((b) => {
      const contactName = b.contact
        ? `${b.contact.firstName ?? ''} ${b.contact.lastName ?? ''}`.trim() || b.contact.email || 'Unknown'
        : 'No contact';
      const serviceName = b.service?.name ?? 'Unknown service';
      const staffName = b.staff?.name ?? 'Unassigned';
      const start = new Date(b.startTime).toISOString();
      const end = new Date(b.endTime).toISOString();
      parts.push(`  - ${b.status} | ${serviceName} | ${contactName} | Staff: ${staffName} | ${start} - ${end} [ID: ${b.id}]`);
    });

    return parts.join('\n');
  }

  async naturalLanguageSearch(businessId: string, query: string) {
    const start = Date.now();
    const sanitized = this.sanitizeInput(query, 500);

    const [bookings, services, staff] = await Promise.all([
      this.db.booking.findMany({
        where: { businessId, deletedAt: null },
        select: {
          id: true, status: true, startTime: true, endTime: true,
          contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
          service: { select: { id: true, name: true, duration: true, price: true } },
          staff: { select: { id: true, name: true } },
        },
        orderBy: { startTime: 'desc' },
        take: 200,
      }),
      this.db.service.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true, duration: true, price: true },
      }),
      this.db.staffMember.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true },
      }),
    ]);

    const knownStatuses = [...new Set(bookings.map(b => b.status))];
    const knownServices = services.map(s => s.name);
    const knownStaff = staff.map(s => s.name);

    const prompt = `You are a Bookings search translator for a Caribbean service business (TTD currency, Trinidad & Tobago).
Convert a natural language query into structured Booking filter parameters.

Available filter fields:
- type: "bookings" | "services" | "staff"
- search: text search across client name, email, service name, staff name
- status: booking status (known: ${knownStatuses.join(', ') || 'PENDING, CONFIRMED, CANCELLED, COMPLETED'})
- serviceName: filter by service (known: ${knownServices.join(', ') || 'none'})
- staffName: filter by staff member (known: ${knownStaff.join(', ') || 'none'})
- dateFrom: ISO date string (start of range)
- dateTo: ISO date string (end of range)
- today: boolean (only today's bookings)
- thisWeek: boolean (only this week's bookings)
- upcoming: boolean (only future bookings)
- sortBy: newest|oldest|startTime|status

Respond in valid JSON:
{
  "type": "bookings",
  "filters": { ... relevant filters only ... },
  "interpretation": "What you understood the user wants",
  "confidence": 0.9
}

Only include filters relevant to the query. Current date: ${new Date().toISOString()}.`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'bookings_nl_search',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: sanitized },
      ],
      maxTokens: 600,
      temperature: 0.2,
    });

    const duration = Date.now() - start;
    if (duration > 1000) this.logger.warn(`Bookings NL search took ${duration}ms`);

    try {
      const parsed = JSON.parse(result.content);
      const resultData = await this.executeNlSearch(businessId, parsed);
      return { ...parsed, results: resultData };
    } catch {
      return { type: 'bookings', filters: {}, interpretation: result.content, confidence: 0, results: [] };
    }
  }

  private async executeNlSearch(businessId: string, parsed: any) {
    const { type, filters } = parsed;
    if (!filters) return [];

    if (type === 'services') {
      const where: any = { businessId, deletedAt: null };
      if (filters.search) where.name = { contains: filters.search, mode: 'insensitive' };
      return this.db.service.findMany({ where, orderBy: { name: 'asc' }, take: 50 });
    }

    if (type === 'staff') {
      const where: any = { businessId, deletedAt: null };
      if (filters.search) where.name = { contains: filters.search, mode: 'insensitive' };
      return this.db.staffMember.findMany({ where, orderBy: { name: 'asc' }, take: 50 });
    }

    const where: any = { businessId, deletedAt: null };
    if (filters.status) where.status = filters.status;

    const now = new Date();
    if (filters.today) {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
      where.startTime = { gte: startOfDay, lt: endOfDay };
    } else if (filters.thisWeek) {
      const startOfWeek = new Date(now);
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      const endOfWeek = new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000);
      where.startTime = { gte: startOfWeek, lt: endOfWeek };
    } else if (filters.upcoming) {
      where.startTime = { gte: now };
    } else if (filters.dateFrom || filters.dateTo) {
      where.startTime = {};
      if (filters.dateFrom) where.startTime.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.startTime.lte = new Date(filters.dateTo);
    }

    if (filters.serviceName) {
      const service = await this.db.service.findFirst({
        where: { businessId, name: { contains: filters.serviceName, mode: 'insensitive' }, deletedAt: null },
      });
      if (service) where.serviceId = service.id;
    }

    if (filters.staffName) {
      const staffMember = await this.db.staffMember.findFirst({
        where: { businessId, name: { contains: filters.staffName, mode: 'insensitive' }, deletedAt: null },
      });
      if (staffMember) where.staffId = staffMember.id;
    }

    const orderBy: any = {};
    if (filters.sortBy === 'oldest') orderBy.startTime = 'asc';
    else if (filters.sortBy === 'status') orderBy.status = 'asc';
    else orderBy.startTime = 'desc';

    return this.db.booking.findMany({
      where,
      orderBy,
      take: 50,
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        service: { select: { id: true, name: true, duration: true, price: true } },
        staff: { select: { id: true, name: true } },
      },
    });
  }

  async scheduleOptimizer(businessId: string) {
    const start = Date.now();
    const context = await this.buildBookingsContext(businessId);

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const recentBookings = await this.db.booking.findMany({
      where: { businessId, deletedAt: null, startTime: { gte: thirtyDaysAgo } },
      select: { startTime: true, endTime: true, status: true, staffId: true, serviceId: true },
      orderBy: { startTime: 'asc' },
    });

    const hourDistribution: Record<number, number> = {};
    const dayDistribution: Record<number, number> = {};
    recentBookings.forEach((b) => {
      const hour = new Date(b.startTime).getHours();
      const day = new Date(b.startTime).getDay();
      hourDistribution[hour] = (hourDistribution[hour] || 0) + 1;
      dayDistribution[day] = (dayDistribution[day] || 0) + 1;
    });

    const statsContext = `
Booking patterns (last 30 days, ${recentBookings.length} bookings):
Hour distribution: ${JSON.stringify(hourDistribution)}
Day distribution (0=Sun): ${JSON.stringify(dayDistribution)}
Statuses: ${JSON.stringify(recentBookings.reduce((acc: Record<string, number>, b) => { acc[b.status] = (acc[b.status] || 0) + 1; return acc; }, {}))}`;

    const prompt = `You are a scheduling optimization AI for a Caribbean service business.
Analyze booking patterns and suggest optimal scheduling strategies.

${context}
${statsContext}

Respond in valid JSON:
{
  "summary": "Brief overview of scheduling patterns",
  "peakHours": [{"hour": 10, "bookings": 15, "label": "10:00 AM"}],
  "peakDays": [{"day": "Monday", "bookings": 20}],
  "gaps": [{"description": "Low bookings on Wednesday afternoons", "suggestion": "Offer promotions"}],
  "recommendations": [
    {"title": "Extend peak hours", "description": "...", "impact": "high|medium|low", "category": "scheduling|staffing|pricing"}
  ],
  "utilizationScore": 75,
  "utilizationLabel": "good"
}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'bookings_schedule_optimizer',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: 'Analyze my booking patterns and suggest scheduling optimizations.' },
      ],
      maxTokens: 2000,
      temperature: 0.4,
    });

    const duration = Date.now() - start;
    if (duration > 1000) this.logger.warn(`Schedule optimizer took ${duration}ms`);

    try {
      return JSON.parse(result.content);
    } catch {
      return {
        summary: result.content,
        peakHours: [], peakDays: [], gaps: [], recommendations: [],
        utilizationScore: 50, utilizationLabel: 'fair',
      };
    }
  }

  async noShowPredictor(businessId: string) {
    const start = Date.now();

    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [historicalBookings, upcomingBookings] = await Promise.all([
      this.db.booking.findMany({
        where: { businessId, deletedAt: null, startTime: { gte: ninetyDaysAgo, lt: now } },
        select: {
          id: true, status: true, startTime: true,
          contact: { select: { id: true, firstName: true, lastName: true, email: true } },
          service: { select: { name: true } },
          staff: { select: { name: true } },
        },
        orderBy: { startTime: 'desc' },
      }),
      this.db.booking.findMany({
        where: { businessId, deletedAt: null, startTime: { gte: now, lte: sevenDaysFromNow }, status: { in: ['PENDING', 'CONFIRMED'] } },
        select: {
          id: true, status: true, startTime: true,
          contact: { select: { id: true, firstName: true, lastName: true, email: true } },
          service: { select: { name: true, price: true } },
          staff: { select: { name: true } },
        },
        orderBy: { startTime: 'asc' },
      }),
    ]);

    const totalHistorical = historicalBookings.length;
    const cancelledCount = historicalBookings.filter(b => b.status === 'CANCELLED').length;
    const cancellationRate = totalHistorical > 0 ? (cancelledCount / totalHistorical * 100).toFixed(1) : '0';

    const contactCancellations: Record<string, { total: number; cancelled: number; name: string }> = {};
    historicalBookings.forEach((b) => {
      if (!b.contact) return;
      const cid = b.contact.id;
      if (!contactCancellations[cid]) {
        contactCancellations[cid] = {
          total: 0, cancelled: 0,
          name: `${b.contact.firstName ?? ''} ${b.contact.lastName ?? ''}`.trim() || b.contact.email || 'Unknown',
        };
      }
      contactCancellations[cid].total++;
      if (b.status === 'CANCELLED') contactCancellations[cid].cancelled++;
    });

    const context = `Historical data (last 90 days):
Total bookings: ${totalHistorical}
Cancelled: ${cancelledCount} (${cancellationRate}%)
Completed: ${historicalBookings.filter(b => b.status === 'COMPLETED').length}

Upcoming bookings (next 7 days): ${upcomingBookings.length}
${upcomingBookings.map(b => {
  const contactName = b.contact
    ? `${b.contact.firstName ?? ''} ${b.contact.lastName ?? ''}`.trim() || b.contact.email || 'Unknown'
    : 'Walk-in';
  const contactHistory = b.contact ? contactCancellations[b.contact.id] : null;
  const historyNote = contactHistory ? ` (${contactHistory.cancelled}/${contactHistory.total} cancelled historically)` : '';
  return `  - ${b.status} | ${b.service?.name ?? 'Unknown'} | ${contactName}${historyNote} | ${new Date(b.startTime).toISOString()} [ID: ${b.id}]`;
}).join('\n')}`;

    const prompt = `You are a no-show/cancellation prediction AI for a Caribbean service business.
Analyze historical booking patterns and predict which upcoming bookings are at risk.

${context}

Respond in valid JSON:
{
  "summary": "Brief overview of cancellation patterns",
  "overallCancellationRate": 15.5,
  "atRiskBookings": [
    {
      "bookingId": "...",
      "clientName": "...",
      "serviceName": "...",
      "scheduledTime": "ISO date",
      "riskScore": 75,
      "riskLevel": "high|medium|low",
      "reasons": ["High cancellation history", "Monday morning slot"],
      "suggestedAction": "Send reminder 24h before"
    }
  ],
  "patterns": [
    {"pattern": "Monday mornings have 2x cancellation rate", "impact": "high"}
  ],
  "recommendations": [
    {"title": "Implement deposit policy", "description": "...", "expectedImpact": "Reduce no-shows by 30%"}
  ]
}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'bookings_no_show_predictor',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: 'Predict no-show risks for upcoming bookings and suggest preventive actions.' },
      ],
      maxTokens: 2000,
      temperature: 0.3,
    });

    const duration = Date.now() - start;
    if (duration > 1000) this.logger.warn(`No-show predictor took ${duration}ms`);

    try {
      return JSON.parse(result.content);
    } catch {
      return {
        summary: result.content,
        overallCancellationRate: parseFloat(cancellationRate),
        atRiskBookings: [], patterns: [], recommendations: [],
      };
    }
  }

  async revenueInsights(businessId: string) {
    const start = Date.now();

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const [currentPeriodBookings, previousPeriodBookings, services, staff] = await Promise.all([
      this.db.booking.findMany({
        where: { businessId, deletedAt: null, startTime: { gte: thirtyDaysAgo } },
        select: {
          id: true, status: true, startTime: true,
          service: { select: { id: true, name: true, price: true, duration: true } },
          staff: { select: { id: true, name: true } },
          contact: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.db.booking.findMany({
        where: { businessId, deletedAt: null, startTime: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
        select: {
          id: true, status: true,
          service: { select: { price: true } },
        },
      }),
      this.db.service.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true, price: true, duration: true },
      }),
      this.db.staffMember.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true },
      }),
    ]);

    const completedCurrent = currentPeriodBookings.filter(b => b.status === 'COMPLETED');
    const currentRevenue = completedCurrent.reduce((sum, b) => sum + (b.service?.price ?? 0), 0);
    const completedPrev = previousPeriodBookings.filter(b => b.status === 'COMPLETED');
    const prevRevenue = completedPrev.reduce((sum, b) => sum + (b.service?.price ?? 0), 0);

    const serviceRevenue: Record<string, { name: string; revenue: number; bookings: number; hours: number }> = {};
    completedCurrent.forEach((b) => {
      if (!b.service) return;
      if (!serviceRevenue[b.service.id]) {
        serviceRevenue[b.service.id] = { name: b.service.name, revenue: 0, bookings: 0, hours: 0 };
      }
      serviceRevenue[b.service.id].revenue += b.service.price;
      serviceRevenue[b.service.id].bookings++;
      serviceRevenue[b.service.id].hours += b.service.duration / 60;
    });

    const staffRevenue: Record<string, { name: string; revenue: number; bookings: number }> = {};
    completedCurrent.forEach((b) => {
      if (!b.staff) return;
      if (!staffRevenue[b.staff.id]) {
        staffRevenue[b.staff.id] = { name: b.staff.name, revenue: 0, bookings: 0 };
      }
      staffRevenue[b.staff.id].revenue += (b.service?.price ?? 0);
      staffRevenue[b.staff.id].bookings++;
    });

    const hourlyRevenue: Record<number, number> = {};
    completedCurrent.forEach((b) => {
      const hour = new Date(b.startTime).getHours();
      hourlyRevenue[hour] = (hourlyRevenue[hour] || 0) + (b.service?.price ?? 0);
    });

    const context = `Revenue Analysis (last 30 days):
Current period revenue: $${currentRevenue}
Previous period revenue: $${prevRevenue}
Growth: ${prevRevenue > 0 ? (((currentRevenue - prevRevenue) / prevRevenue) * 100).toFixed(1) : 'N/A'}%
Total bookings (current): ${currentPeriodBookings.length}
Completed: ${completedCurrent.length}
Cancelled: ${currentPeriodBookings.filter(b => b.status === 'CANCELLED').length}

Revenue by Service:
${Object.values(serviceRevenue).sort((a, b) => b.revenue - a.revenue).map(s => `  - ${s.name}: $${s.revenue} (${s.bookings} bookings, ${s.hours.toFixed(1)}h)`).join('\n')}

Revenue by Staff:
${Object.values(staffRevenue).sort((a, b) => b.revenue - a.revenue).map(s => `  - ${s.name}: $${s.revenue} (${s.bookings} bookings)`).join('\n')}

Peak Revenue Hours:
${Object.entries(hourlyRevenue).sort(([, a], [, b]) => b - a).slice(0, 5).map(([h, r]) => `  - ${h}:00: $${r}`).join('\n')}

Available services: ${services.length}
Active staff: ${staff.length}`;

    const prompt = `You are a booking revenue analytics AI for a Caribbean service business (TTD currency).
Analyze booking revenue data and provide actionable insights.

${context}

Respond in valid JSON:
{
  "summary": "Executive summary of revenue performance",
  "totalRevenue": 15000,
  "revenueGrowth": 12.5,
  "averageBookingValue": 250,
  "topServices": [{"name": "...", "revenue": 5000, "bookings": 20, "revenuePerHour": 500}],
  "topStaff": [{"name": "...", "revenue": 3000, "bookings": 12}],
  "peakHours": [{"hour": "10:00 AM", "revenue": 2000}],
  "trends": [{"trend": "...", "direction": "up|down|stable", "impact": "high|medium|low"}],
  "recommendations": [
    {"title": "...", "description": "...", "expectedImpact": "$X additional monthly revenue", "priority": "high|medium|low"}
  ],
  "revenueHealthScore": 75,
  "revenueHealthLabel": "good"
}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'bookings_revenue_insights',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: 'Analyze my booking revenue and provide insights on performance, trends, and optimization opportunities.' },
      ],
      maxTokens: 2000,
      temperature: 0.4,
    });

    const duration = Date.now() - start;
    if (duration > 1000) this.logger.warn(`Revenue insights took ${duration}ms`);

    try {
      return JSON.parse(result.content);
    } catch {
      return {
        summary: result.content,
        totalRevenue: currentRevenue, revenueGrowth: 0,
        averageBookingValue: completedCurrent.length > 0 ? currentRevenue / completedCurrent.length : 0,
        topServices: [], topStaff: [], peakHours: [], trends: [], recommendations: [],
        revenueHealthScore: 50, revenueHealthLabel: 'fair',
      };
    }
  }
}
