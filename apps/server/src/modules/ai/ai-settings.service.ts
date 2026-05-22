import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface TeamCapacityMember {
  id: string;
  name: string;
  type: 'membership' | 'staff';
  dailyCapacityHours: number | null;
  maxHoursPerWeek: number | null;
  hourlyRate: number | null;
  skills: { id: string; name: string; category: string }[];
  utilizationPercent: number;
  assignedHours: number;
}

@Injectable()
export class AiSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getWorkloadConfig(businessId: string) {
    const [memberships, staffMembers, skills, authorityGrants] = await Promise.all([
      this.prisma.client.membership.findMany({
        where: { businessId },
        select: { id: true, dailyCapacityHours: true, skills: { select: { id: true, name: true } } },
      }),
      this.prisma.client.staffMember.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, maxHoursPerWeek: true, hourlyRate: true, skills: { select: { id: true, name: true } } },
      }),
      this.prisma.client.skill.findMany({
        select: { id: true, name: true, category: true },
      }),
      this.prisma.client.authorityGrant.findMany({
        where: { businessId, revokedAt: null },
      }),
    ]);

    const capacityHours = memberships.reduce((sum, m) => sum + (m.dailyCapacityHours ?? 8), 0);

    return {
      capacityHours,
      skills,
      authorityGrants: authorityGrants.map((g) => ({
        id: g.id,
        businessId: g.businessId,
        grantorId: g.grantorId,
        granteeType: g.granteeType,
        granteeId: g.granteeId,
        scope: g.scope,
        maxAmount: g.maxAmount,
        validFrom: g.validFrom,
        validUntil: g.validUntil,
        revokedAt: g.revokedAt,
        createdAt: g.createdAt,
      })),
    };
  }

  async updateWorkloadConfig(businessId: string, membershipId: string, data: { dailyCapacityHours?: number; skillIds?: string[] }) {
    const membership = await this.prisma.client.membership.findFirst({
      where: { id: membershipId, businessId },
    });
    if (!membership) throw new NotFoundException('Membership not found');

    const updateData: Record<string, unknown> = {};
    if (data.dailyCapacityHours !== undefined) updateData.dailyCapacityHours = data.dailyCapacityHours;
    if (data.skillIds !== undefined) {
      updateData.skills = { set: data.skillIds.map((id) => ({ id })) };
    }

    const updated = await this.prisma.client.membership.update({
      where: { id: membershipId },
      data: updateData,
      include: { skills: { select: { id: true, name: true, category: true } } },
    });

    return { membership: updated };
  }

  async updateStaffWorkloadConfig(businessId: string, staffId: string, data: { maxHoursPerWeek?: number; hourlyRate?: number }) {
    const staff = await this.prisma.client.staffMember.findFirst({
      where: { id: staffId, businessId },
    });
    if (!staff) throw new NotFoundException('Staff member not found');

    const updated = await this.prisma.client.staffMember.update({
      where: { id: staffId },
      data: {
        ...(data.maxHoursPerWeek !== undefined ? { maxHoursPerWeek: data.maxHoursPerWeek } : {}),
        ...(data.hourlyRate !== undefined ? { hourlyRate: data.hourlyRate } : {}),
      },
      include: { skills: { select: { id: true, name: true, category: true } } },
    });

    return { staff: updated };
  }

  async listSkills() {
    return this.prisma.client.skill.findMany({
      orderBy: { category: 'asc', name: 'asc' },
    });
  }

  async createSkill(data: { name: string; category?: string; description?: string }) {
    const existing = await this.prisma.client.skill.findUnique({
      where: { name: data.name },
    });
    if (existing) throw new BadRequestException(`Skill "${data.name}" already exists`);

    return this.prisma.client.skill.create({
      data: {
        name: data.name,
        category: data.category ?? 'general',
        description: data.description,
      },
    });
  }

  async deleteSkill(id: string) {
    const skill = await this.prisma.client.skill.findUnique({ where: { id } });
    if (!skill) throw new NotFoundException('Skill not found');

    await this.prisma.client.skill.delete({ where: { id } });
    return { deleted: true };
  }

  async assignSkillToMembership(membershipId: string, skillId: string) {
    await this.prisma.client.membership.update({
      where: { id: membershipId },
      data: { skills: { connect: { id: skillId } } },
    });
    return { success: true };
  }

  async removeSkillFromMembership(membershipId: string, skillId: string) {
    await this.prisma.client.membership.update({
      where: { id: membershipId },
      data: { skills: { disconnect: { id: skillId } } },
    });
    return { success: true };
  }

  async assignSkillToStaff(staffId: string, skillId: string) {
    await this.prisma.client.staffMember.update({
      where: { id: staffId },
      data: { skills: { connect: { id: skillId } } },
    });
    return { success: true };
  }

  async removeSkillFromStaff(staffId: string, skillId: string) {
    await this.prisma.client.staffMember.update({
      where: { id: staffId },
      data: { skills: { disconnect: { id: skillId } } },
    });
    return { success: true };
  }

  async listAuthorityGrants(businessId: string) {
    return this.prisma.client.authorityGrant.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createAuthorityGrant(businessId: string, data: {
    grantorId: string;
    granteeType: 'KEY' | 'USER';
    granteeId: string;
    scope: 'tier4_financial' | 'tier4_publishing' | 'tier4_operations';
    maxAmount?: number;
    validFrom?: Date;
    validUntil?: Date | null;
  }) {
    return this.prisma.client.authorityGrant.create({
      data: {
        businessId,
        grantorId: data.grantorId,
        granteeType: data.granteeType,
        granteeId: data.granteeId,
        scope: data.scope,
        maxAmount: data.maxAmount,
        validFrom: data.validFrom ?? new Date(),
        validUntil: data.validUntil ?? null,
      },
    });
  }

  async revokeAuthorityGrant(businessId: string, id: string) {
    const grant = await this.prisma.client.authorityGrant.findFirst({
      where: { id, businessId },
    });
    if (!grant) throw new NotFoundException('Authority grant not found');

    const updated = await this.prisma.client.authorityGrant.update({
      where: { id },
      data: { revokedAt: new Date() },
    });

    return { grant: updated };
  }

  async getTeamCapacity(businessId: string): Promise<TeamCapacityMember[]> {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const [memberships, staffMembers] = await Promise.all([
      this.prisma.client.membership.findMany({
        where: { businessId },
        include: {
          user: { select: { id: true, name: true, firstName: true, lastName: true, email: true } },
          skills: { select: { id: true, name: true, category: true } },
        },
      }),
      this.prisma.client.staffMember.findMany({
        where: { businessId, deletedAt: null },
        include: {
          skills: { select: { id: true, name: true, category: true } },
        },
      }),
    ]);

    const result: TeamCapacityMember[] = [];

    for (const m of memberships) {
      const name = m.user.name || `${m.user.firstName ?? ''} ${m.user.lastName ?? ''}`.trim() || m.user.email;
      const capacityHours = (m.dailyCapacityHours ?? 8) * 5;

      const taskAssignments = await this.prisma.client.taskAssignment.findMany({
        where: { assignableType: 'User', assignableId: m.userId, unassignedAt: null },
        select: { taskType: true, taskId: true },
      });

      const contactTaskIds = taskAssignments.filter((t) => t.taskType === 'ContactTask').map((t) => t.taskId);
      const projectTaskIds = taskAssignments.filter((t) => t.taskType === 'ProjectTask').map((t) => t.taskId);

      const contactTasks = contactTaskIds.length > 0
        ? await this.prisma.client.contactTask.findMany({
            where: { id: { in: contactTaskIds }, status: { not: 'COMPLETED' } },
            select: { id: true },
          })
        : [];

      const projectTasks = projectTaskIds.length > 0
        ? await this.prisma.client.projectTask.findMany({
            where: { id: { in: projectTaskIds }, isCompleted: false },
            select: { id: true, estimatedHours: true, trackedHours: true },
          })
        : [];

      let assignedHours = 0;
      for (const pt of projectTasks) {
        assignedHours += Math.max(0, (pt.estimatedHours ?? 0) - (pt.trackedHours ?? 0));
      }
      assignedHours += contactTasks.length * 0.5;

      result.push({
        id: m.id,
        name,
        type: 'membership',
        dailyCapacityHours: m.dailyCapacityHours,
        maxHoursPerWeek: null,
        hourlyRate: null,
        skills: m.skills,
        utilizationPercent: capacityHours > 0 ? Math.round((assignedHours / capacityHours) * 100) : 0,
        assignedHours: Math.round(assignedHours * 10) / 10,
      });
    }

    for (const s of staffMembers) {
      const capacityHours = s.maxHoursPerWeek ?? 40;

      const bookings = await this.prisma.client.booking.findMany({
        where: {
          staffId: s.id,
          startTime: { gte: weekStart, lt: weekEnd },
          status: { in: ['CONFIRMED', 'PENDING'] },
        },
        select: { startTime: true, endTime: true },
      });

      const assignedHours = bookings.reduce((sum, b) => {
        const duration = (b.endTime?.getTime() ?? 0) - (b.startTime?.getTime() ?? 0);
        return sum + duration / (1000 * 60 * 60);
      }, 0);

      result.push({
        id: s.id,
        name: s.name,
        type: 'staff',
        dailyCapacityHours: null,
        maxHoursPerWeek: s.maxHoursPerWeek,
        hourlyRate: s.hourlyRate,
        skills: s.skills,
        utilizationPercent: capacityHours > 0 ? Math.round((assignedHours / capacityHours) * 100) : 0,
        assignedHours: Math.round(assignedHours * 10) / 10,
      });
    }

    return result;
  }
}
