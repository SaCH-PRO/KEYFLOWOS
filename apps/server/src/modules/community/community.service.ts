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
          business: {
            select: {
              id: true, name: true, logoUrl: true, headline: true, bio: true, industry: true,
              acceptingWork: true, currentCapacity: true, skills: true,
            },
          },
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
        business: { select: { id: true, name: true, logoUrl: true, headline: true, bio: true, industry: true } },
        comments: {
          include: {
            business: { select: { id: true, name: true, logoUrl: true, headline: true } },
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
        business: { select: { id: true, name: true, logoUrl: true, headline: true, bio: true, industry: true } },
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
        business: { select: { id: true, name: true, logoUrl: true, headline: true, bio: true, industry: true } },
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
        business: { select: { id: true, name: true, logoUrl: true, headline: true } },
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

  async searchDirectory(filters: {
    search?: string;
    industry?: string;
    city?: string;
    country?: string;
    skills?: string[];
    businessStage?: string;
    acceptingWork?: boolean;
    currentCapacity?: string;
    budgetFit?: string;
    serviceType?: string;
    priceMin?: number;
    priceMax?: number;
    page?: number;
    limit?: number;
    sort?: string;
  }) {
    const where: any = { deletedAt: null };
    const andClauses: any[] = [];

    if (filters.search) {
      andClauses.push({
        OR: [
          { name: { contains: filters.search, mode: 'insensitive' } },
          { headline: { contains: filters.search, mode: 'insensitive' } },
          { bio: { contains: filters.search, mode: 'insensitive' } },
          { positioningStatement: { contains: filters.search, mode: 'insensitive' } },
          { skills: { hasSome: [filters.search] } },
        ],
      });
    }

    if (filters.industry) where.industry = { contains: filters.industry, mode: 'insensitive' };
    if (filters.city) where.city = { contains: filters.city, mode: 'insensitive' };
    if (filters.country) where.country = { contains: filters.country, mode: 'insensitive' };
    if (filters.businessStage) where.businessStage = filters.businessStage;
    if (filters.acceptingWork !== undefined) where.acceptingWork = filters.acceptingWork;
    if (filters.currentCapacity) where.currentCapacity = filters.currentCapacity;
    if (filters.budgetFit) where.budgetFit = filters.budgetFit;
    if (filters.skills?.length) where.skills = { hasSome: filters.skills };

    if (filters.serviceType) {
      andClauses.push({
        OR: [
          { products: { some: { category: { contains: filters.serviceType, mode: 'insensitive' }, isActive: true } } },
          { services: { some: { name: { contains: filters.serviceType, mode: 'insensitive' } } } },
          { preferredProjectTypes: { hasSome: [filters.serviceType] } },
        ],
      });
    }

    if (filters.priceMin !== undefined || filters.priceMax !== undefined) {
      const priceWhere: any = {};
      if (filters.priceMin !== undefined) priceWhere.price = { ...priceWhere.price, gte: filters.priceMin };
      if (filters.priceMax !== undefined) priceWhere.price = { ...priceWhere.price, lte: filters.priceMax };
      andClauses.push({
        OR: [
          { products: { some: { ...priceWhere, isActive: true } } },
          { services: { some: priceWhere } },
        ],
      });
    }

    if (andClauses.length > 0) {
      where.AND = andClauses;
    }

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const skip = (page - 1) * limit;

    let orderBy: any = { profileCompleteness: 'desc' };
    if (filters.sort === 'newest') orderBy = { createdAt: 'desc' };
    if (filters.sort === 'name') orderBy = { name: 'asc' };

    const [data, total] = await Promise.all([
      this.prisma.client.business.findMany({
        where,
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
          headline: true,
          bio: true,
          industry: true,
          skills: true,
          businessStage: true,
          city: true,
          country: true,
          tagline: true,
          acceptingWork: true,
          currentCapacity: true,
          leadTime: true,
          preferredProjectTypes: true,
          budgetFit: true,
          positioningStatement: true,
          profileCompleteness: true,
          products: {
            where: { isActive: true },
            select: { id: true, name: true, price: true, currency: true, category: true },
            take: 3,
            orderBy: { createdAt: 'desc' },
          },
          services: {
            select: { id: true, name: true, price: true, currency: true },
            take: 3,
            orderBy: { createdAt: 'desc' },
          },
          _count: {
            select: {
              communityPosts: true,
              cohortMembers: true,
              networkConnectionsTo: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy,
      }),
      this.prisma.client.business.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async createConnection(fromBusinessId: string, toBusinessId: string, type: string = 'FOLLOW') {
    if (fromBusinessId === toBusinessId) return { error: 'Cannot connect to yourself' };

    const existing = await this.prisma.client.networkConnection.findUnique({
      where: {
        fromBusinessId_toBusinessId_type: { fromBusinessId, toBusinessId, type },
      },
    });
    if (existing) return existing;

    return this.prisma.client.networkConnection.create({
      data: { fromBusinessId, toBusinessId, type },
    });
  }

  async removeConnection(fromBusinessId: string, toBusinessId: string, type: string = 'FOLLOW') {
    try {
      return await this.prisma.client.networkConnection.delete({
        where: {
          fromBusinessId_toBusinessId_type: { fromBusinessId, toBusinessId, type },
        },
      });
    } catch {
      return null;
    }
  }

  async getConnections(businessId: string, direction: 'from' | 'to' = 'from', type?: string) {
    const where: any = direction === 'from'
      ? { fromBusinessId: businessId }
      : { toBusinessId: businessId };
    if (type) where.type = type;

    return this.prisma.client.networkConnection.findMany({
      where,
      include: {
        fromBusiness: {
          select: { id: true, name: true, logoUrl: true, headline: true, industry: true, acceptingWork: true, currentCapacity: true, slug: true },
        },
        toBusiness: {
          select: { id: true, name: true, logoUrl: true, headline: true, industry: true, acceptingWork: true, currentCapacity: true, slug: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getConnectionStatus(fromBusinessId: string, toBusinessId: string) {
    const connections = await this.prisma.client.networkConnection.findMany({
      where: { fromBusinessId, toBusinessId },
    });
    return {
      following: connections.some((c) => c.type === 'FOLLOW'),
      saved: connections.some((c) => c.type === 'SAVE'),
    };
  }
}
