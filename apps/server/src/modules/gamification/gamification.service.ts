import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  achieved: boolean;
  achievedAt?: string;
  category: 'setup' | 'sales' | 'growth' | 'engagement' | 'mastery';
  xpReward: number;
}

interface Challenge {
  id: string;
  title: string;
  description: string;
  icon: string;
  progress: number;
  target: number;
  expiresAt?: string;
  xpReward: number;
  type: 'daily' | 'weekly' | 'monthly';
}

export interface GamificationStats {
  level: number;
  currentXp: number;
  xpToNextLevel: number;
  totalXp: number;
  streakDays: number;
  achievements: Achievement[];
  challenges: Challenge[];
  recentXpGains: { action: string; xp: number; timestamp: string }[];
}

const ACHIEVEMENTS_DEFINITIONS: Omit<Achievement, 'achieved' | 'achievedAt'>[] = [
  { id: 'first-contact', title: 'First Connection', description: 'Added your first contact', icon: 'UserPlus', category: 'setup', xpReward: 50 },
  { id: 'first-product', title: 'Catalog Started', description: 'Created your first product or service', icon: 'Package', category: 'setup', xpReward: 50 },
  { id: 'first-invoice', title: 'Money Moves', description: 'Sent your first invoice', icon: 'FileText', category: 'setup', xpReward: 75 },
  { id: 'first-booking', title: 'Calendar Active', description: 'Received your first booking', icon: 'Calendar', category: 'setup', xpReward: 75 },
  { id: 'first-sale', title: 'First Sale', description: 'Got your first payment', icon: 'Trophy', category: 'sales', xpReward: 100 },
  { id: 'first-quote', title: 'Quote Master', description: 'Sent your first quote', icon: 'Quote', category: 'setup', xpReward: 50 },
  { id: 'first-automation', title: 'Automation Unlocked', description: 'Created your first playbook', icon: 'Zap', category: 'setup', xpReward: 100 },
  { id: 'first-post', title: 'Social Starter', description: 'Published your first social post', icon: 'Share2', category: 'engagement', xpReward: 50 },
  { id: 'ten-contacts', title: 'Growing Network', description: 'Reached 10 contacts', icon: 'Users', category: 'growth', xpReward: 100 },
  { id: 'hundred-contacts', title: 'Community Builder', description: 'Reached 100 contacts', icon: 'Globe', category: 'growth', xpReward: 250 },
  { id: 'five-sales', title: 'Sales Streak', description: 'Completed 5 sales', icon: 'TrendingUp', category: 'sales', xpReward: 150 },
  { id: 'twenty-five-sales', title: 'Sales Pro', description: 'Completed 25 sales', icon: 'Award', category: 'sales', xpReward: 500 },
  { id: 'profile-complete', title: 'Brand Identity', description: 'Completed your business profile', icon: 'Building2', category: 'setup', xpReward: 75 },
  { id: 'calendar-connected', title: 'Calendar Synced', description: 'Connected Google Calendar', icon: 'Calendar', category: 'setup', xpReward: 50 },
  { id: 'gmail-connected', title: 'Email Ready', description: 'Connected Gmail for quotes', icon: 'Mail', category: 'setup', xpReward: 50 },
  { id: 'week-streak', title: 'Week Warrior', description: 'Active 7 days in a row', icon: 'Flame', category: 'engagement', xpReward: 100 },
  { id: 'month-streak', title: 'Monthly Master', description: 'Active 30 days in a row', icon: 'Star', category: 'mastery', xpReward: 300 },
  { id: 'no-overdue', title: 'Flawless Flow', description: 'No overdue invoices for a week', icon: 'CheckCircle', category: 'mastery', xpReward: 75 },
];

@Injectable()
export class GamificationService {
  private readonly logger = new Logger(GamificationService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getGamificationStats(businessId: string): Promise<GamificationStats> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const [business, contacts, products, invoices, bookings, quotes, automations, socialPosts] = await Promise.all([
      this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: { metaData: true, logoUrl: true, name: true, address: true, phone: true, email: true, calendarEmail: true, gmailEmail: true, createdAt: true },
      }),
      this.prisma.client.contact.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.product.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.invoice.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, status: true, paidAt: true, createdAt: true, dueDate: true },
      }),
      this.prisma.client.booking.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.quote.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.automation.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.socialPost.count({ where: { businessId, deletedAt: null, status: 'POSTED' } }),
    ]);

    if (!business) {
      throw new Error('Business not found');
    }

    const metaData = (business.metaData as Record<string, unknown>) || {};
    const paidInvoices = invoices.filter(i => i.status === 'PAID').length;
    const sentInvoices = invoices.filter(i => ['SENT', 'PAID'].includes(i.status)).length;
    const overdueInvoices = invoices.filter(i => i.status === 'OVERDUE' || (i.status === 'SENT' && i.dueDate && new Date(i.dueDate) < now)).length;
    const profileComplete = !!(business.name && business.address && business.phone && business.email && business.logoUrl);

    const achievementStatus: Record<string, boolean> = {
      'first-contact': contacts > 0,
      'first-product': products > 0,
      'first-invoice': sentInvoices > 0,
      'first-booking': bookings > 0,
      'first-sale': paidInvoices > 0,
      'first-quote': quotes > 0,
      'first-automation': automations > 0,
      'first-post': socialPosts > 0,
      'ten-contacts': contacts >= 10,
      'hundred-contacts': contacts >= 100,
      'five-sales': paidInvoices >= 5,
      'twenty-five-sales': paidInvoices >= 25,
      'profile-complete': profileComplete,
      'calendar-connected': !!business.calendarEmail,
      'gmail-connected': !!business.gmailEmail,
      'week-streak': (metaData.streakDays as number) >= 7,
      'month-streak': (metaData.streakDays as number) >= 30,
      'no-overdue': overdueInvoices === 0 && sentInvoices > 0,
    };

    const achievements: Achievement[] = ACHIEVEMENTS_DEFINITIONS.map(def => ({
      ...def,
      achieved: achievementStatus[def.id] || false,
      achievedAt: achievementStatus[def.id] ? (metaData[`${def.id}-at`] as string) || undefined : undefined,
    }));

    const totalXp = achievements.filter(a => a.achieved).reduce((sum, a) => sum + a.xpReward, 0);
    const { level, currentXp, xpToNextLevel } = this.calculateLevel(totalXp);

    const challenges: Challenge[] = [
      {
        id: 'weekly-invoices',
        title: 'Invoice Rush',
        description: 'Send 3 invoices this week',
        icon: 'FileText',
        progress: invoices.filter(i => new Date(i.createdAt) >= startOfWeek).length,
        target: 3,
        xpReward: 50,
        type: 'weekly',
      },
      {
        id: 'weekly-bookings',
        title: 'Booking Blitz',
        description: 'Get 5 bookings this week',
        icon: 'Calendar',
        progress: Math.min(5, bookings),
        target: 5,
        xpReward: 75,
        type: 'weekly',
      },
      {
        id: 'daily-activity',
        title: 'Daily Flow',
        description: 'Complete any business action today',
        icon: 'Activity',
        progress: 1,
        target: 1,
        xpReward: 10,
        type: 'daily',
      },
    ];

    const recentXpGains: { action: string; xp: number; timestamp: string }[] = [];
    if (metaData.recentXpGains && Array.isArray(metaData.recentXpGains)) {
      recentXpGains.push(...(metaData.recentXpGains as typeof recentXpGains).slice(0, 10));
    }

    return {
      level,
      currentXp,
      xpToNextLevel,
      totalXp,
      streakDays: (metaData.streakDays as number) || 0,
      achievements,
      challenges,
      recentXpGains,
    };
  }

  private calculateLevel(totalXp: number): { level: number; currentXp: number; xpToNextLevel: number } {
    const xpPerLevel = 500;
    const level = Math.floor(totalXp / xpPerLevel) + 1;
    const currentXp = totalXp % xpPerLevel;
    const xpToNextLevel = xpPerLevel - currentXp;
    return { level, currentXp, xpToNextLevel };
  }

  async awardXp(businessId: string, action: string, xp: number): Promise<void> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });

    if (!business) return;

    const metaData = (business.metaData as Record<string, unknown>) || {};
    const recentXpGains = (metaData.recentXpGains as { action: string; xp: number; timestamp: string }[]) || [];

    recentXpGains.unshift({
      action,
      xp,
      timestamp: new Date().toISOString(),
    });

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        metaData: {
          ...metaData,
          recentXpGains: recentXpGains.slice(0, 20),
          lastActivityAt: new Date().toISOString(),
        },
      },
    });

    this.logger.debug(`Awarded ${xp} XP to business ${businessId} for action: ${action}`);
  }

  async updateStreak(businessId: string): Promise<number> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });

    if (!business) return 0;

    const metaData = (business.metaData as Record<string, unknown>) || {};
    const lastActivityAt = metaData.lastActivityAt as string | undefined;
    const currentStreak = (metaData.streakDays as number) || 0;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let newStreak: number;

    if (lastActivityAt) {
      const lastActivity = new Date(lastActivityAt);
      const lastActivityDate = new Date(lastActivity.getFullYear(), lastActivity.getMonth(), lastActivity.getDate());
      const diffDays = Math.floor((today.getTime() - lastActivityDate.getTime()) / (24 * 60 * 60 * 1000));

      if (diffDays === 0) {
        return currentStreak;
      } else if (diffDays === 1) {
        newStreak = currentStreak + 1;
      } else {
        newStreak = 1;
      }
    } else {
      newStreak = 1;
    }

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        metaData: {
          ...metaData,
          streakDays: newStreak,
          lastActivityAt: now.toISOString(),
        },
      },
    });

    return newStreak;
  }
}
