import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface TemporalOverviewDto {
  today: {
    bookings: number;
    tasksDue: number;
    tasksOverdue: number;
    events: number;
  };
  upcoming: {
    pendingBookings: number;
    confirmedBookings: number;
    activeProjects: number;
    blockedTasks: number;
  };
  capacity: {
    staffCount: number;
    totalScheduledHours: number;
    utilizationPct: number;
    overloadedDays: number;
    underutilizedDays: number;
  };
}

@Injectable()
export class TemporalOverviewService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async getOverview(businessId: string): Promise<TemporalOverviewDto> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    const [
      todayBookings,
      tasksDue,
      tasksOverdue,
      todayEvents,
      pendingBookings,
      confirmedBookings,
      activeProjects,
      blockedTasks,
      staffCount,
    ] = await Promise.all([
      this.prisma.client.booking.count({
        where: { businessId, deletedAt: null, startTime: { gte: todayStart, lt: todayEnd } },
      }),
      this.prisma.client.projectTask.count({
        where: { businessId, deletedAt: null, isCompleted: false, dueDate: { gte: todayStart, lt: todayEnd } },
      }),
      this.prisma.client.projectTask.count({
        where: { businessId, deletedAt: null, isCompleted: false, dueDate: { lt: todayStart } },
      }),
      this.prisma.client.calendarEvent.count({
        where: { businessId, startTime: { gte: todayStart, lt: todayEnd } },
      }),
      this.prisma.client.booking.count({
        where: { businessId, deletedAt: null, status: 'PENDING' },
      }),
      this.prisma.client.booking.count({
        where: { businessId, deletedAt: null, status: 'CONFIRMED', startTime: { gte: now } },
      }),
      this.prisma.client.project.count({
        where: { businessId, deletedAt: null, status: { in: ['ACTIVE', 'IN_PROGRESS'] } },
      }),
      this.prisma.client.projectTask.count({
        where: { businessId, deletedAt: null, status: 'BLOCKED' },
      }),
      this.prisma.client.staffMember.count({ where: { businessId } }),
    ]);

    // Simple capacity heuristic: count upcoming booked hours this week
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    const weekBookings = await this.prisma.client.booking.findMany({
      where: {
        businessId,
        deletedAt: null,
        status: { in: ['PENDING', 'CONFIRMED'] },
        startTime: { gte: weekStart, lt: weekEnd },
      },
      select: { startTime: true, endTime: true },
    });
    const totalScheduledHours = weekBookings.reduce((sum, b) => {
      if (!b.startTime || !b.endTime) return sum;
      return sum + (b.endTime.getTime() - b.startTime.getTime()) / (1000 * 60 * 60);
    }, 0);
    const capacityHours = staffCount * 8 * 5; // 8 hrs/day, 5 days
    const utilizationPct = capacityHours > 0 ? Math.min(100, Math.round((totalScheduledHours / capacityHours) * 100)) : 0;

    return {
      today: {
        bookings: todayBookings,
        tasksDue: tasksDue,
        tasksOverdue: tasksOverdue,
        events: todayEvents,
      },
      upcoming: {
        pendingBookings,
        confirmedBookings,
        activeProjects,
        blockedTasks,
      },
      capacity: {
        staffCount,
        totalScheduledHours: Math.round(totalScheduledHours),
        utilizationPct,
        overloadedDays: 0, // would need day-by-day analysis
        underutilizedDays: 0,
      },
    };
  }
}
