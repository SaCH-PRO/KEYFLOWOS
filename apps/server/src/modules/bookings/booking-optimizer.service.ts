import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { BookingCompletedPayload } from '../../core/event-bus/events.types';

interface SlotUtilization {
  date: string;
  dayOfWeek: string;
  totalSlots: number;
  bookedSlots: number;
  utilizationRate: number;
  emptySlots: number;
}

interface NoShowRisk {
  bookingId: string;
  contactId: string;
  contactName: string;
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  factors: string[];
}

interface PromotionSuggestion {
  date: string;
  dayOfWeek: string;
  emptySlots: number;
  suggestion: string;
  targetClientCount: number;
}

interface RebookingSuggestion {
  contactId: string;
  contactName: string;
  lastServiceName: string;
  averageIntervalDays: number;
  suggestedDate: string;
  reason: string;
}

interface ScheduleHealth {
  utilizationRate: number;
  noShowRate: number;
  noShowTrend: number;
  avgRevenuePerSlot: number;
  peakDay: string;
  slowestDay: string;
  weeklyUtilization: SlotUtilization[];
  promotionSuggestions: PromotionSuggestion[];
  noShowRisks: NoShowRisk[];
  rebookingSuggestions: RebookingSuggestion[];
  recommendations: string[];
}

@Injectable()
export class BookingOptimizerService {
  private readonly logger = new Logger(BookingOptimizerService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  async getScheduleHealth(businessId: string): Promise<ScheduleHealth> {
    const [weeklyUtilization, cancellationStats, revenueStats, noShowRisks, rebookingSuggestions] =
      await Promise.all([
        this.getWeeklyUtilization(businessId),
        this.getCancellationStats(businessId),
        this.getRevenuePerSlot(businessId),
        this.getNoShowRisks(businessId),
        this.getRebookingSuggestions(businessId),
      ]);

    const promotionSuggestions = await this.buildPromotionSuggestions(businessId, weeklyUtilization);

    const openDays = weeklyUtilization.filter((d) => d.totalSlots > 0);
    const avgUtilization =
      openDays.length > 0
        ? openDays.reduce((sum, d) => sum + d.utilizationRate, 0) / openDays.length
        : 0;

    let peakDay = 'N/A';
    let slowestDay = 'N/A';
    let maxRate = -1;
    let minRate = 101;
    for (const day of openDays) {
      if (day.utilizationRate > maxRate) {
        maxRate = day.utilizationRate;
        peakDay = day.dayOfWeek;
      }
      if (day.utilizationRate < minRate) {
        minRate = day.utilizationRate;
        slowestDay = day.dayOfWeek;
      }
    }

    const recommendations = this.generateRecommendations(
      Math.round(avgUtilization),
      cancellationStats.rate,
      cancellationStats.trend,
      promotionSuggestions,
      peakDay,
      slowestDay,
    );

    return {
      utilizationRate: Math.round(avgUtilization),
      noShowRate: Math.round(cancellationStats.rate),
      noShowTrend: cancellationStats.trend,
      avgRevenuePerSlot: Math.round(revenueStats * 100) / 100,
      peakDay,
      slowestDay,
      weeklyUtilization,
      promotionSuggestions,
      noShowRisks,
      rebookingSuggestions,
      recommendations,
    };
  }

  private async getBusinessHours(businessId: string): Promise<Record<string, { open: string; close: string; closed: boolean }>> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { businessHours: true },
    });

    const defaultHours: Record<string, { open: string; close: string; closed: boolean }> = {
      sun: { open: '09:00', close: '17:00', closed: true },
      mon: { open: '09:00', close: '17:00', closed: false },
      tue: { open: '09:00', close: '17:00', closed: false },
      wed: { open: '09:00', close: '17:00', closed: false },
      thu: { open: '09:00', close: '17:00', closed: false },
      fri: { open: '09:00', close: '17:00', closed: false },
      sat: { open: '09:00', close: '17:00', closed: true },
    };

    return (business?.businessHours as any) ?? defaultHours;
  }

  private getSlotsForDay(hours: { open: string; close: string; closed: boolean }, slotDurationMins = 60): number {
    if (hours.closed) return 0;
    const [oh, om] = hours.open.split(':').map(Number);
    const [ch, cm] = hours.close.split(':').map(Number);
    const totalMinutes = (ch * 60 + cm) - (oh * 60 + om);
    return Math.max(0, Math.floor(totalMinutes / slotDurationMins));
  }

  async getWeeklyUtilization(businessId: string): Promise<SlotUtilization[]> {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endDate = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000);

    const businessHours = await this.getBusinessHours(businessId);
    const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const bookings = await this.prisma.client.booking.findMany({
      where: {
        businessId,
        deletedAt: null,
        startTime: { gte: startOfToday, lt: endDate },
        status: { in: ['PENDING', 'CONFIRMED', 'COMPLETED'] },
      },
      select: { startTime: true },
    });

    const bookingsByDate = new Map<string, number>();
    bookings.forEach((b) => {
      const key = new Date(b.startTime).toISOString().split('T')[0];
      bookingsByDate.set(key, (bookingsByDate.get(key) ?? 0) + 1);
    });

    const staff = await this.prisma.client.staffMember.count({
      where: { businessId, deletedAt: null },
    });
    const staffCount = Math.max(1, staff);

    const result: SlotUtilization[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(startOfToday.getTime() + i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];
      const dayKey = dayKeys[date.getDay()];
      const dayHours = businessHours[dayKey];

      if (!dayHours || dayHours.closed) {
        result.push({
          date: dateStr,
          dayOfWeek: dayNames[date.getDay()],
          totalSlots: 0,
          bookedSlots: 0,
          utilizationRate: 0,
          emptySlots: 0,
        });
        continue;
      }

      const slotsPerStaff = this.getSlotsForDay(dayHours);
      const totalSlots = slotsPerStaff * staffCount;
      const bookedSlots = bookingsByDate.get(dateStr) ?? 0;
      const utilizationRate = totalSlots > 0 ? Math.min(100, Math.round((bookedSlots / totalSlots) * 100)) : 0;

      result.push({
        date: dateStr,
        dayOfWeek: dayNames[date.getDay()],
        totalSlots,
        bookedSlots,
        utilizationRate,
        emptySlots: Math.max(0, totalSlots - bookedSlots),
      });
    }

    return result;
  }

  async getCancellationStats(businessId: string): Promise<{ rate: number; trend: number }> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const [recentTotal, recentCancelled, priorTotal, priorCancelled] = await Promise.all([
      this.prisma.client.booking.count({
        where: {
          businessId,
          deletedAt: null,
          startTime: { gte: thirtyDaysAgo, lt: now },
          status: { in: ['COMPLETED', 'CANCELLED'] },
        },
      }),
      this.prisma.client.booking.count({
        where: {
          businessId,
          deletedAt: null,
          startTime: { gte: thirtyDaysAgo, lt: now },
          status: 'CANCELLED',
        },
      }),
      this.prisma.client.booking.count({
        where: {
          businessId,
          deletedAt: null,
          startTime: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
          status: { in: ['COMPLETED', 'CANCELLED'] },
        },
      }),
      this.prisma.client.booking.count({
        where: {
          businessId,
          deletedAt: null,
          startTime: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
          status: 'CANCELLED',
        },
      }),
    ]);

    const recentRate = recentTotal > 0 ? (recentCancelled / recentTotal) * 100 : 0;
    const priorRate = priorTotal > 0 ? (priorCancelled / priorTotal) * 100 : 0;
    const trend = recentRate - priorRate;

    return { rate: recentRate, trend: Math.round(trend * 10) / 10 };
  }

  async getRevenuePerSlot(businessId: string): Promise<number> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const bookings = await this.prisma.client.booking.findMany({
      where: {
        businessId,
        deletedAt: null,
        startTime: { gte: thirtyDaysAgo },
        status: { in: ['CONFIRMED', 'COMPLETED'] },
      },
      include: {
        service: { select: { price: true } },
      },
    });

    if (bookings.length === 0) return 0;
    const totalRevenue = bookings.reduce((sum, b) => sum + (b.service?.price ?? 0), 0);
    return totalRevenue / bookings.length;
  }

  private async buildPromotionSuggestions(businessId: string, utilization: SlotUtilization[]): Promise<PromotionSuggestion[]> {
    const activeContactCount = await this.prisma.client.contact.count({
      where: { businessId, deletedAt: null, status: { not: 'ARCHIVED' } },
    });
    const targetCount = Math.min(20, activeContactCount);

    const suggestions: PromotionSuggestion[] = [];

    for (const day of utilization) {
      if (day.totalSlots === 0) continue;
      if (day.utilizationRate < 40 && day.emptySlots >= 2) {
        suggestions.push({
          date: day.date,
          dayOfWeek: day.dayOfWeek,
          emptySlots: day.emptySlots,
          suggestion: `${day.dayOfWeek} has ${day.emptySlots} empty slots — send a flash offer to your top ${targetCount} clients?`,
          targetClientCount: targetCount,
        });
      }
    }

    return suggestions;
  }

  async getPromotionSuggestions(businessId: string): Promise<PromotionSuggestion[]> {
    const utilization = await this.getWeeklyUtilization(businessId);
    return this.buildPromotionSuggestions(businessId, utilization);
  }

  async getNoShowRisks(businessId: string): Promise<NoShowRisk[]> {
    const now = new Date();
    const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const upcomingBookings = await this.prisma.client.booking.findMany({
      where: {
        businessId,
        deletedAt: null,
        startTime: { gte: now, lt: endDate },
        status: { in: ['PENDING', 'CONFIRMED'] },
      },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (upcomingBookings.length === 0) return [];

    const contactIds = [...new Set(upcomingBookings.map((b) => b.contactId).filter(Boolean))];

    const historicalBookings = await this.prisma.client.booking.findMany({
      where: {
        businessId,
        deletedAt: null,
        contactId: { in: contactIds },
        status: { in: ['COMPLETED', 'CANCELLED'] },
      },
      select: { contactId: true, status: true, startTime: true },
    });

    const contactStats = new Map<string, { total: number; cancelled: number }>();
    historicalBookings.forEach((b) => {
      if (!b.contactId) return;
      const stats = contactStats.get(b.contactId) ?? { total: 0, cancelled: 0 };
      stats.total++;
      if (b.status === 'CANCELLED') stats.cancelled++;
      contactStats.set(b.contactId, stats);
    });

    const risks: NoShowRisk[] = [];
    for (const booking of upcomingBookings) {
      if (!booking.contactId || !booking.contact) continue;

      const stats = contactStats.get(booking.contactId);
      const factors: string[] = [];
      let riskScore = 10;

      if (stats && stats.total > 0) {
        const cancelRate = (stats.cancelled / stats.total) * 100;
        if (cancelRate > 30) {
          riskScore += 40;
          factors.push(`${Math.round(cancelRate)}% cancellation history`);
        } else if (cancelRate > 15) {
          riskScore += 20;
          factors.push(`${Math.round(cancelRate)}% cancellation history`);
        }
      }

      const startHour = new Date(booking.startTime).getHours();
      if (startHour < 9 || startHour >= 17) {
        riskScore += 10;
        factors.push('Off-peak time slot');
      }

      const leadTime = (new Date(booking.startTime).getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      if (leadTime > 14) {
        riskScore += 15;
        factors.push('Booked far in advance');
      }

      if (booking.status === 'PENDING') {
        riskScore += 15;
        factors.push('Not yet confirmed');
      }

      riskScore = Math.min(100, riskScore);
      const riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = riskScore >= 60 ? 'HIGH' : riskScore >= 35 ? 'MEDIUM' : 'LOW';
      const contactName = [booking.contact.firstName, booking.contact.lastName].filter(Boolean).join(' ') || 'Unknown';

      if (riskScore >= 25) {
        risks.push({
          bookingId: booking.id,
          contactId: booking.contactId,
          contactName,
          riskScore,
          riskLevel,
          factors,
        });
      }
    }

    return risks.sort((a, b) => b.riskScore - a.riskScore).slice(0, 10);
  }

  async getRebookingSuggestions(businessId: string): Promise<RebookingSuggestion[]> {
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const completedBookings = await this.prisma.client.booking.findMany({
      where: {
        businessId,
        deletedAt: null,
        status: 'COMPLETED',
        startTime: { gte: ninetyDaysAgo },
      },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true } },
        service: { select: { id: true, name: true } },
      },
      orderBy: { startTime: 'asc' },
    });

    const contactBookings = new Map<string, { contactName: string; serviceName: string; dates: Date[] }>();
    completedBookings.forEach((b) => {
      if (!b.contactId || !b.contact) return;
      const key = `${b.contactId}:${b.serviceId}`;
      const entry = contactBookings.get(key) ?? {
        contactName: [b.contact.firstName, b.contact.lastName].filter(Boolean).join(' ') || 'Unknown',
        serviceName: b.service?.name ?? 'Service',
        dates: [],
      };
      entry.dates.push(new Date(b.startTime));
      contactBookings.set(key, entry);
    });

    const suggestions: RebookingSuggestion[] = [];

    contactBookings.forEach((entry, key) => {
      if (entry.dates.length < 2) return;

      const intervals: number[] = [];
      for (let i = 1; i < entry.dates.length; i++) {
        const diff = (entry.dates[i].getTime() - entry.dates[i - 1].getTime()) / (1000 * 60 * 60 * 24);
        intervals.push(diff);
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      if (avgInterval < 7 || avgInterval > 90) return;

      const lastDate = entry.dates[entry.dates.length - 1];
      const suggestedDate = new Date(lastDate.getTime() + avgInterval * 24 * 60 * 60 * 1000);

      if (suggestedDate < now) {
        const daysSinceOverdue = Math.round((now.getTime() - suggestedDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceOverdue > avgInterval * 2) return;

        suggestions.push({
          contactId: key.split(':')[0],
          contactName: entry.contactName,
          lastServiceName: entry.serviceName,
          averageIntervalDays: Math.round(avgInterval),
          suggestedDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          reason: `Usually books every ${Math.round(avgInterval)} days — overdue by ${daysSinceOverdue} days`,
        });
      } else if (suggestedDate.getTime() - now.getTime() < 14 * 24 * 60 * 60 * 1000) {
        suggestions.push({
          contactId: key.split(':')[0],
          contactName: entry.contactName,
          lastServiceName: entry.serviceName,
          averageIntervalDays: Math.round(avgInterval),
          suggestedDate: suggestedDate.toISOString().split('T')[0],
          reason: `Usually books every ${Math.round(avgInterval)} days`,
        });
      }
    });

    return suggestions.slice(0, 10);
  }

  async getUpcomingReminders(businessId: string): Promise<
    {
      bookingId: string;
      contactName: string;
      contactEmail: string | null;
      serviceName: string;
      staffName: string | null;
      startTime: Date;
      hoursUntil: number;
    }[]
  > {
    const now = new Date();

    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { bookingReminderMins: true },
    });
    const reminderMins = business?.bookingReminderMins ?? 60;
    const reminderMs = reminderMins * 60 * 1000;
    const toleranceMs = 30 * 60 * 1000;
    const windowStart = new Date(Math.max(now.getTime(), now.getTime() + reminderMs - toleranceMs));
    const windowEnd = new Date(now.getTime() + reminderMs + toleranceMs);

    const bookings = await this.prisma.client.booking.findMany({
      where: {
        businessId,
        deletedAt: null,
        startTime: { gte: windowStart, lt: windowEnd },
        status: { in: ['PENDING', 'CONFIRMED'] },
      },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true } },
        service: { select: { name: true } },
        staff: { select: { name: true } },
      },
    });

    return bookings.map((b) => ({
      bookingId: b.id,
      contactName: b.contact
        ? [b.contact.firstName, b.contact.lastName].filter(Boolean).join(' ') || 'Customer'
        : 'Customer',
      contactEmail: b.contact?.email ?? null,
      serviceName: b.service?.name ?? 'Appointment',
      staffName: b.staff?.name ?? null,
      startTime: b.startTime,
      hoursUntil: Math.round((new Date(b.startTime).getTime() - now.getTime()) / (1000 * 60 * 60)),
    }));
  }

  @OnEvent('booking.completed')
  async handleBookingCompleted(payload: BookingCompletedPayload) {
    try {
      if (!payload.booking.contactId || !payload.booking.serviceId) return;

      const contactId = payload.booking.contactId;
      const serviceId = payload.booking.serviceId;
      const businessId = payload.businessId;

      const completedBookings = await this.prisma.client.booking.findMany({
        where: {
          businessId,
          contactId,
          serviceId,
          deletedAt: null,
          status: 'COMPLETED',
        },
        include: {
          service: { select: { name: true } },
        },
        orderBy: { startTime: 'asc' },
      });

      if (completedBookings.length < 2) return;

      const intervals: number[] = [];
      for (let i = 1; i < completedBookings.length; i++) {
        const diff =
          (new Date(completedBookings[i].startTime).getTime() - new Date(completedBookings[i - 1].startTime).getTime()) /
          (1000 * 60 * 60 * 24);
        intervals.push(diff);
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      if (avgInterval < 7 || avgInterval > 90) return;

      const suggestedDate = new Date(
        new Date(payload.booking.startTime).getTime() + avgInterval * 24 * 60 * 60 * 1000,
      );

      const contactName = payload.contact
        ? [payload.contact.firstName, payload.contact.lastName].filter(Boolean).join(' ') || 'Customer'
        : 'Customer';

      const serviceName = completedBookings[completedBookings.length - 1].service?.name ?? 'appointment';

      await (this.prisma.client as any).notification.create({
        data: {
          businessId,
          type: 'booking.rebooking_suggestion',
          title: 'Rebooking Suggestion',
          body: `${contactName} typically books a ${serviceName} every ${Math.round(avgInterval)} days. Suggest rebooking for ${suggestedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}?`,
          data: {
            contactId,
            serviceId,
            suggestedDate: suggestedDate.toISOString(),
            averageIntervalDays: Math.round(avgInterval),
            serviceName,
          },
        },
      });

      this.logger.log(
        `Rebooking suggestion created for contact ${contactId} — next ${serviceName} in ~${Math.round(avgInterval)} days`,
      );
    } catch (err) {
      this.logger.error(`Failed to generate rebooking suggestion: ${(err as Error).message}`);
    }
  }

  private generateRecommendations(
    utilization: number,
    cancellationRate: number,
    cancellationTrend: number,
    promotions: PromotionSuggestion[],
    peakDay: string,
    slowestDay: string,
  ): string[] {
    const recs: string[] = [];

    if (utilization < 50) {
      recs.push(
        `Your schedule is at ${utilization}% utilization. Consider running promotions to fill empty slots.`,
      );
    } else if (utilization > 85) {
      recs.push(
        `Great utilization at ${utilization}%! Consider extending hours or adding staff to handle demand.`,
      );
    }

    if (cancellationRate > 20) {
      recs.push(
        `Your cancellation rate is ${Math.round(cancellationRate)}%. Consider requiring deposits for bookings.`,
      );
    } else if (cancellationRate > 10) {
      recs.push(
        `Cancellation rate is ${Math.round(cancellationRate)}%. Automated reminders can help reduce this.`,
      );
    }

    if (cancellationTrend > 5) {
      recs.push(`Cancellations are trending up by ${cancellationTrend}%. Take action before it impacts revenue.`);
    } else if (cancellationTrend < -5) {
      recs.push(`Cancellations are trending down by ${Math.abs(cancellationTrend)}% — your reminder strategy is working!`);
    }

    if (promotions.length > 0) {
      recs.push(
        `${promotions.length} day(s) this week have low bookings. Send targeted offers to fill them.`,
      );
    }

    if (peakDay !== 'N/A' && slowestDay !== 'N/A' && peakDay !== slowestDay) {
      recs.push(
        `${peakDay} is your busiest day, ${slowestDay} is slowest. Offer ${slowestDay} discounts to balance demand.`,
      );
    }

    if (recs.length === 0) {
      recs.push('Your schedule is looking healthy! Keep up the great work.');
    }

    return recs;
  }
}
