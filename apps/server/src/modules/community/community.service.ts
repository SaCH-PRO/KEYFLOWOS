import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class CommunityService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async listPosts(filters?: { type?: string; tag?: string; page?: number; limit?: number }) {
    const where: any = { deletedAt: null };
    if (filters?.type) where.type = filters.type;
    if (filters?.tag) where.tags = { has: filters.tag };

    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 50;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.client.communityPost.findMany({
        where,
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        include: {
          business: { select: { id: true, name: true, logoUrl: true } },
          _count: { select: { comments: true } },
        },
        skip,
        take: limit,
      }),
      this.prisma.client.communityPost.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getPost(id: string) {
    return this.prisma.client.communityPost.findFirst({
      where: { id, deletedAt: null },
      include: {
        business: { select: { id: true, name: true, logoUrl: true } },
        comments: {
          include: {
            business: { select: { id: true, name: true, logoUrl: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  async createPost(businessId: string, input: { title?: string; content: string; type?: string; tags?: string[] }) {
    return this.prisma.client.communityPost.create({
      data: {
        businessId,
        title: input.title ?? null,
        content: input.content,
        type: input.type ?? 'DISCUSSION',
        tags: input.tags ?? [],
      },
      include: {
        business: { select: { id: true, name: true, logoUrl: true } },
        _count: { select: { comments: true } },
      },
    });
  }

  async updatePost(businessId: string, postId: string, input: { title?: string; content?: string; type?: string; tags?: string[] }) {
    return this.prisma.client.communityPost.update({
      where: { id: postId, businessId },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.content !== undefined && { content: input.content }),
        ...(input.type !== undefined && { type: input.type }),
        ...(input.tags !== undefined && { tags: input.tags }),
      },
      include: {
        business: { select: { id: true, name: true, logoUrl: true } },
        _count: { select: { comments: true } },
      },
    });
  }

  async deletePost(businessId: string, postId: string) {
    return this.prisma.client.communityPost.update({
      where: { id: postId, businessId },
      data: { deletedAt: new Date() },
    });
  }

  async likePost(postId: string) {
    return this.prisma.client.communityPost.update({
      where: { id: postId },
      data: { likes: { increment: 1 } },
    });
  }

  async addComment(businessId: string, postId: string, content: string) {
    return this.prisma.client.communityComment.create({
      data: {
        businessId,
        postId,
        content,
      },
      include: {
        business: { select: { id: true, name: true, logoUrl: true } },
      },
    });
  }

  async deleteComment(businessId: string, commentId: string) {
    return this.prisma.client.communityComment.delete({
      where: { id: commentId, businessId },
    });
  }

  async listCohorts() {
    return this.prisma.client.cohort.findMany({
      where: { isActive: true },
      include: {
        _count: { select: { members: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async joinCohort(businessId: string, cohortId: string) {
    const cohort = await this.prisma.client.cohort.findUnique({
      where: { id: cohortId },
      include: { _count: { select: { members: true } } },
    });
    if (!cohort) return null;
    if (cohort._count.members >= cohort.maxMembers) {
      return { error: 'Cohort is full' };
    }

    return this.prisma.client.cohortMember.create({
      data: { businessId, cohortId },
      include: { cohort: true },
    });
  }

  async leaveCohort(businessId: string, cohortId: string) {
    return this.prisma.client.cohortMember.delete({
      where: { cohortId_businessId: { cohortId, businessId } },
    });
  }

  async getMyCohorts(businessId: string) {
    return this.prisma.client.cohortMember.findMany({
      where: { businessId },
      include: {
        cohort: {
          include: { _count: { select: { members: true } } },
        },
      },
    });
  }

  async seedDefaultCohorts() {
    const count = await this.prisma.client.cohort.count();
    if (count > 0) return { seeded: false, message: 'Cohorts already exist' };

    const cohorts = [
      { name: 'Caribbean Founders Circle', description: 'A community for Caribbean entrepreneurs to connect, share experiences, and grow together.', maxMembers: 10, industry: 'General', isActive: true },
      { name: 'Service Business Owners', description: 'Connect with other service-based business owners to share strategies and best practices.', maxMembers: 10, industry: 'Services', isActive: true },
      { name: 'E-commerce Entrepreneurs', description: 'Join fellow e-commerce entrepreneurs to discuss online selling, marketing, and logistics.', maxMembers: 10, industry: 'Retail', isActive: true },
    ];

    for (const cohort of cohorts) {
      await this.prisma.client.cohort.create({ data: cohort });
    }

    return { seeded: true, count: cohorts.length };
  }
}
