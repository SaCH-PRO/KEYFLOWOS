import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface TrustSignals {
  reputationScore: number;
  badges: { id: string; label: string; icon: string }[];
  endorsementCount: number;
  topEndorsedSkills: { skill: string; count: number }[];
}

const BADGE_DEFINITIONS = [
  { id: 'complete_profile', label: 'Complete Profile', icon: 'shield-check', minCompleteness: 80 },
  { id: 'active_store', label: 'Active Store', icon: 'store', requiresProducts: true },
  { id: 'community_contributor', label: 'Community Contributor', icon: 'message-square', minPosts: 5 },
  { id: 'well_connected', label: 'Well Connected', icon: 'users', minFollowers: 5 },
  { id: 'endorsed', label: 'Endorsed', icon: 'award', minEndorsements: 3 },
  { id: 'cohort_member', label: 'Cohort Member', icon: 'graduation-cap', minCohorts: 1 },
] as const;

type Badge = { id: string; label: string; icon: string };

interface BadgeComputeInput {
  profileCompleteness: number;
  productCount: number;
  serviceCount: number;
  postCount: number;
  followerCount: number;
  endorsementCount: number;
  cohortCount: number;
}

function computeBadgesAndReputation(input: BadgeComputeInput): { badges: Badge[]; reputationScore: number } {
  const badges: Badge[] = [];
  for (const def of BADGE_DEFINITIONS) {
    let earned = false;
    if ('minCompleteness' in def) earned = input.profileCompleteness >= def.minCompleteness;
    if ('requiresProducts' in def) earned = (input.productCount + input.serviceCount) > 0;
    if ('minPosts' in def) earned = input.postCount >= def.minPosts;
    if ('minFollowers' in def) earned = input.followerCount >= def.minFollowers;
    if ('minEndorsements' in def) earned = input.endorsementCount >= def.minEndorsements;
    if ('minCohorts' in def) earned = input.cohortCount >= def.minCohorts;
    if (earned) badges.push({ id: def.id, label: def.label, icon: def.icon });
  }

  const completenessScore = Math.min(input.profileCompleteness, 100) * 0.25;
  const activityScore = Math.min(input.postCount * 3, 25);
  const connectionScore = Math.min(input.followerCount * 2, 20);
  const endorsementScore = Math.min(input.endorsementCount * 5, 20);
  const badgeScore = Math.min(badges.length * (10 / BADGE_DEFINITIONS.length), 10);
  const reputationScore = Math.min(
    Math.round(completenessScore + activityScore + connectionScore + endorsementScore + badgeScore),
    100,
  );

  return { badges, reputationScore };
}

@Injectable()
export class CommunityService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
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
              endorsementsReceived: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy,
      }),
      this.prisma.client.business.count({ where }),
    ]);

    const enriched = data.map((biz) => {
      const { badges, reputationScore } = computeBadgesAndReputation({
        profileCompleteness: biz.profileCompleteness,
        productCount: biz.products?.length ?? 0,
        serviceCount: biz.services?.length ?? 0,
        postCount: biz._count.communityPosts,
        followerCount: biz._count.networkConnectionsTo,
        endorsementCount: biz._count.endorsementsReceived ?? 0,
        cohortCount: biz._count.cohortMembers,
      });
      return { ...biz, reputationScore, badges };
    });

    return { data: enriched, total, page, limit };
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

  async createEndorsement(fromBusinessId: string, toBusinessId: string, skill: string, message?: string) {
    if (fromBusinessId === toBusinessId) return { error: 'Cannot endorse yourself' };

    const isConnected = await this.prisma.client.networkConnection.findFirst({
      where: {
        OR: [
          { fromBusinessId, toBusinessId, type: 'FOLLOW' },
          { fromBusinessId: toBusinessId, toBusinessId: fromBusinessId, type: 'FOLLOW' },
        ],
      },
    });
    if (!isConnected) return { error: 'Must be connected to endorse' };

    const existing = await this.prisma.client.endorsement.findUnique({
      where: {
        fromBusinessId_toBusinessId_skill: { fromBusinessId, toBusinessId, skill },
      },
    });
    if (existing) return { error: 'Already endorsed this skill' };

    const endorsement = await this.prisma.client.endorsement.create({
      data: { fromBusinessId, toBusinessId, skill, message: message ?? null },
      include: {
        fromBusiness: { select: { id: true, name: true, logoUrl: true, headline: true } },
      },
    });

    this.notificationsService.create({
      businessId: toBusinessId,
      type: 'endorsement',
      title: `${endorsement.fromBusiness.name} endorsed your skill`,
      body: `${endorsement.fromBusiness.name} endorsed you for "${skill}"`,
      data: {
        endorserBusinessId: fromBusinessId,
        endorserName: endorsement.fromBusiness.name,
        skill,
        link: `/app/community/profile/${fromBusinessId}`,
      },
    }).catch(() => {});

    return endorsement;
  }

  async updateEndorsement(fromBusinessId: string, toBusinessId: string, skill: string, message: string) {
    const endorsement = await this.prisma.client.endorsement.findUnique({
      where: {
        fromBusinessId_toBusinessId_skill: { fromBusinessId, toBusinessId, skill },
      },
    });
    if (!endorsement) return { error: 'Endorsement not found' };

    return this.prisma.client.endorsement.update({
      where: {
        fromBusinessId_toBusinessId_skill: { fromBusinessId, toBusinessId, skill },
      },
      data: { message: message || null },
      include: {
        fromBusiness: { select: { id: true, name: true, logoUrl: true, headline: true } },
      },
    });
  }

  async removeEndorsement(fromBusinessId: string, toBusinessId: string, skill: string) {
    try {
      return await this.prisma.client.endorsement.delete({
        where: {
          fromBusinessId_toBusinessId_skill: { fromBusinessId, toBusinessId, skill },
        },
      });
    } catch {
      return null;
    }
  }

  async getEndorsements(businessId: string) {
    const endorsements = await this.prisma.client.endorsement.findMany({
      where: { toBusinessId: businessId },
      include: {
        fromBusiness: { select: { id: true, name: true, logoUrl: true, headline: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const skillMap = new Map<string, number>();
    for (const e of endorsements) {
      skillMap.set(e.skill, (skillMap.get(e.skill) || 0) + 1);
    }
    const topSkills = Array.from(skillMap.entries())
      .map(([skill, count]) => ({ skill, count }))
      .sort((a, b) => b.count - a.count);

    return { endorsements, topSkills, total: endorsements.length };
  }

  async getMyEndorsementsGiven(fromBusinessId: string, toBusinessId: string) {
    return this.prisma.client.endorsement.findMany({
      where: { fromBusinessId, toBusinessId },
      select: { skill: true, message: true },
    });
  }

  async getTrustSignals(businessId: string): Promise<TrustSignals> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: {
        profileCompleteness: true,
        acceptingWork: true,
        _count: {
          select: {
            communityPosts: true,
            cohortMembers: true,
            networkConnectionsTo: true,
            endorsementsReceived: true,
            products: true,
            services: true,
          },
        },
      },
    });

    if (!business) return { reputationScore: 0, badges: [], endorsementCount: 0, topEndorsedSkills: [] };

    const endorsementData = await this.getEndorsements(businessId);

    const { badges, reputationScore } = computeBadgesAndReputation({
      profileCompleteness: business.profileCompleteness,
      productCount: business._count.products,
      serviceCount: business._count.services,
      postCount: business._count.communityPosts,
      followerCount: business._count.networkConnectionsTo,
      endorsementCount: endorsementData.total,
      cohortCount: business._count.cohortMembers,
    });

    return {
      reputationScore,
      badges,
      endorsementCount: endorsementData.total,
      topEndorsedSkills: endorsementData.topSkills.slice(0, 5),
    };
  }

  private readonly businessSelect = {
    id: true, name: true, logoUrl: true, headline: true, industry: true,
  } as const;

  async getOrCreateConversation(businessIdA: string, businessIdB: string) {
    if (businessIdA === businessIdB) return { error: 'Cannot message yourself' };

    const [participantAId, participantBId] = [businessIdA, businessIdB].sort();

    const existing = await this.prisma.client.conversation.findUnique({
      where: { participantAId_participantBId: { participantAId, participantBId } },
      include: {
        participantA: { select: this.businessSelect },
        participantB: { select: this.businessSelect },
      },
    });
    if (existing) return existing;

    return this.prisma.client.conversation.create({
      data: { participantAId, participantBId },
      include: {
        participantA: { select: this.businessSelect },
        participantB: { select: this.businessSelect },
      },
    });
  }

  async sendMessage(senderBusinessId: string, toBusinessId: string, content: string) {
    if (senderBusinessId === toBusinessId) return { error: 'Cannot message yourself' };
    if (!content.trim()) return { error: 'Message cannot be empty' };

    const [participantAId, participantBId] = [senderBusinessId, toBusinessId].sort();

    let conversation = await this.prisma.client.conversation.findUnique({
      where: { participantAId_participantBId: { participantAId, participantBId } },
    });

    if (!conversation) {
      conversation = await this.prisma.client.conversation.create({
        data: { participantAId, participantBId, lastMessageAt: new Date() },
      });
    } else {
      await this.prisma.client.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      });
    }

    const message = await this.prisma.client.directMessage.create({
      data: {
        conversationId: conversation.id,
        senderBusinessId,
        content: content.trim(),
      },
      include: {
        senderBusiness: { select: this.businessSelect },
      },
    });

    const sender = await this.prisma.client.business.findUnique({
      where: { id: senderBusinessId },
      select: { name: true },
    });

    await this.prisma.client.communityNotification.create({
      data: {
        businessId: toBusinessId,
        type: 'MESSAGE',
        title: `New message from ${sender?.name ?? 'a business'}`,
        body: content.trim().substring(0, 100),
        referenceId: conversation.id,
        referenceType: 'CONVERSATION',
      },
    });

    return message;
  }

  async getConversations(businessId: string) {
    const conversations = await this.prisma.client.conversation.findMany({
      where: {
        OR: [
          { participantAId: businessId },
          { participantBId: businessId },
        ],
      },
      include: {
        participantA: { select: this.businessSelect },
        participantB: { select: this.businessSelect },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            senderBusiness: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
    });

    return conversations.map((c) => {
      const otherBusiness = c.participantAId === businessId ? c.participantB : c.participantA;
      const lastMessage = c.messages[0] ?? null;
      return {
        id: c.id,
        otherBusiness,
        lastMessage: lastMessage ? {
          id: lastMessage.id,
          content: lastMessage.content,
          senderName: lastMessage.senderBusiness.name,
          isMine: lastMessage.senderBusinessId === businessId,
          createdAt: lastMessage.createdAt,
          readAt: lastMessage.readAt,
        } : null,
        lastMessageAt: c.lastMessageAt,
        createdAt: c.createdAt,
      };
    });
  }

  async getConversationMessages(businessId: string, conversationId: string, page = 1, limit = 50) {
    const conversation = await this.prisma.client.conversation.findFirst({
      where: {
        id: conversationId,
        OR: [
          { participantAId: businessId },
          { participantBId: businessId },
        ],
      },
      include: {
        participantA: { select: this.businessSelect },
        participantB: { select: this.businessSelect },
      },
    });

    if (!conversation) return { error: 'Conversation not found' };

    const skip = (page - 1) * limit;
    const [messages, total] = await Promise.all([
      this.prisma.client.directMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        include: {
          senderBusiness: { select: this.businessSelect },
        },
        skip,
        take: limit,
      }),
      this.prisma.client.directMessage.count({ where: { conversationId } }),
    ]);

    await this.prisma.client.directMessage.updateMany({
      where: {
        conversationId,
        senderBusinessId: { not: businessId },
        readAt: null,
      },
      data: { readAt: new Date() },
    });

    const otherBusiness = conversation.participantAId === businessId
      ? conversation.participantB : conversation.participantA;

    return { messages, total, page, limit, otherBusiness, conversationId };
  }

  async getUnreadMessageCount(businessId: string) {
    const conversations = await this.prisma.client.conversation.findMany({
      where: {
        OR: [
          { participantAId: businessId },
          { participantBId: businessId },
        ],
      },
      select: { id: true },
    });

    if (conversations.length === 0) return { count: 0 };

    const count = await this.prisma.client.directMessage.count({
      where: {
        conversationId: { in: conversations.map((c) => c.id) },
        senderBusinessId: { not: businessId },
        readAt: null,
      },
    });

    return { count };
  }

  async createCollabRequest(
    fromBusinessId: string,
    toBusinessId: string,
    input: { type?: string; title: string; message?: string },
  ) {
    if (fromBusinessId === toBusinessId) return { error: 'Cannot send a request to yourself' };

    const existing = await this.prisma.client.collaborationRequest.findFirst({
      where: {
        fromBusinessId,
        toBusinessId,
        status: 'PENDING',
      },
    });
    if (existing) return { error: 'You already have a pending request with this business' };

    const request = await this.prisma.client.collaborationRequest.create({
      data: {
        fromBusinessId,
        toBusinessId,
        type: input.type ?? 'COLLABORATION',
        title: input.title,
        message: input.message ?? null,
      },
      include: {
        fromBusiness: { select: this.businessSelect },
        toBusiness: { select: this.businessSelect },
      },
    });

    await this.prisma.client.communityNotification.create({
      data: {
        businessId: toBusinessId,
        type: 'COLLAB_REQUEST',
        title: `${request.fromBusiness.name} sent you a ${request.type.toLowerCase()} request`,
        body: request.title,
        referenceId: request.id,
        referenceType: 'COLLAB_REQUEST',
      },
    });

    return request;
  }

  async respondToCollabRequest(businessId: string, requestId: string, status: 'ACCEPTED' | 'DECLINED') {
    const request = await this.prisma.client.collaborationRequest.findFirst({
      where: { id: requestId, toBusinessId: businessId, status: 'PENDING' },
      include: {
        toBusiness: { select: { name: true } },
      },
    });
    if (!request) return { error: 'Request not found or already responded' };

    const updated = await this.prisma.client.collaborationRequest.update({
      where: { id: requestId },
      data: { status, respondedAt: new Date() },
      include: {
        fromBusiness: { select: this.businessSelect },
        toBusiness: { select: this.businessSelect },
      },
    });

    await this.prisma.client.communityNotification.create({
      data: {
        businessId: request.fromBusinessId,
        type: 'COLLAB_RESPONSE',
        title: `${request.toBusiness.name} ${status.toLowerCase()} your ${request.type.toLowerCase()} request`,
        body: request.title,
        referenceId: request.id,
        referenceType: 'COLLAB_REQUEST',
      },
    });

    return updated;
  }

  async getCollabRequests(businessId: string, direction: 'incoming' | 'outgoing' = 'incoming', status?: string) {
    const where: any = direction === 'incoming'
      ? { toBusinessId: businessId }
      : { fromBusinessId: businessId };
    if (status) where.status = status;

    return this.prisma.client.collaborationRequest.findMany({
      where,
      include: {
        fromBusiness: { select: this.businessSelect },
        toBusiness: { select: this.businessSelect },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getNotifications(businessId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total, unreadCount] = await Promise.all([
      this.prisma.client.communityNotification.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.client.communityNotification.count({ where: { businessId } }),
      this.prisma.client.communityNotification.count({ where: { businessId, isRead: false } }),
    ]);

    return { data, total, unreadCount, page, limit };
  }

  async markNotificationRead(businessId: string, notificationId: string) {
    return this.prisma.client.communityNotification.update({
      where: { id: notificationId, businessId },
      data: { isRead: true },
    });
  }

  async markAllNotificationsRead(businessId: string) {
    return this.prisma.client.communityNotification.updateMany({
      where: { businessId, isRead: false },
      data: { isRead: true },
    });
  }

  async getUnreadNotificationCount(businessId: string) {
    const count = await this.prisma.client.communityNotification.count({
      where: { businessId, isRead: false },
    });
    return { count };
  }
}
