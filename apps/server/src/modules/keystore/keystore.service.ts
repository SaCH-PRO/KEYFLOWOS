// ─────────────────────────────────────────────────────────────────────────────
// KeyStore Service Marketplace — Core Service
// ─────────────────────────────────────────────────────────────────────────────

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { db } from '@keyflow/db';
import type {
  KeystoreDeliveryFile,
  KeystoreOrderStatus,
  OrderTimelineEvent,
} from './types/keystore.types';
import {
  isValidStatusTransition,
} from './types/keystore.types';
import type {
  CreateOrderDto,
  SendMessageDto,
  UpdateOrderStatusDto,
  AcceptQuoteDto,
  RateOrderDto,
  CreateListingDto,
  UpdateListingDto,
  DeliverFilesDto,
} from './dto';

@Injectable()
export class KeystoreService {
  // ═══════════════════════════════════════════════════════════════════════════
  // Categories
  // ═══════════════════════════════════════════════════════════════════════════

  async getCategories(businessId: string) {
    return db.keystoreServiceCategory.findMany({
      where: { businessId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getCategoryBySlug(businessId: string, slug: string) {
    return db.keystoreServiceCategory.findFirst({
      where: { businessId, slug, isActive: true },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Listings (Public)
  // ═══════════════════════════════════════════════════════════════════════════

  async getListings(businessId: string, categoryId?: string) {
    return db.keystoreServiceListing.findMany({
      where: {
        businessId,
        status: 'ACTIVE',
        ...(categoryId ? { categoryId } : {}),
      },
      include: { category: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getListingBySlug(businessId: string, slug: string) {
    const listing = await db.keystoreServiceListing.findFirst({
      where: { businessId, slug, status: 'ACTIVE' },
      include: { category: true },
    });
    if (!listing) throw new NotFoundException(`Listing "${slug}" not found`);
    return listing;
  }

  async getListingById(businessId: string, id: string) {
    const listing = await db.keystoreServiceListing.findFirst({
      where: { businessId, id },
      include: { category: true },
    });
    if (!listing) throw new NotFoundException(`Listing "${id}" not found`);
    return listing;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Orders (User)
  // ═══════════════════════════════════════════════════════════════════════════

  async createOrder(
    businessId: string,
    userId: string,
    dto: CreateOrderDto,
  ) {
    const listing = await this.getListingById(businessId, dto.listingId);

    // Validate pricing tier exists
    const tiers = (listing.pricingTiers as Array<{ name: string; price: number }>) || [];
    const selectedTier = tiers.find((t) => t.name === dto.pricingTier);
    if (!selectedTier) {
      throw new BadRequestException(
        `Pricing tier "${dto.pricingTier}" not found for this listing`,
      );
    }

    // Calculate estimated price with addons
    let estimatedPrice = selectedTier.price;
    if (dto.selectedAddons?.length) {
      const addons = (listing.addons as Array<{ name: string; price: number }>) || [];
      for (const addon of dto.selectedAddons) {
        const found = addons.find((a) => a.name === addon.addonName);
        if (found) estimatedPrice += found.price;
      }
    }

    // Build timeline
    const timeline: OrderTimelineEvent[] = [
      {
        status: 'REQUESTED',
        timestamp: new Date().toISOString(),
        actor: { type: 'USER', id: userId },
      },
    ];

    const order = await db.keystoreServiceOrder.create({
      data: {
        businessId,
        listingId: dto.listingId,
        userId,
        contactId: dto.contactId,
        status: 'REQUESTED',
        pricingTier: dto.pricingTier,
        selectedAddons: dto.selectedAddons as unknown as any,
        briefAnswers: dto.briefAnswers as unknown as any,
        estimatedPrice,
        notes: dto.notes,
        timeline: timeline as unknown as any,
      },
      include: { listing: true, messages: true },
    });

    // Create initial system message
    await db.keystoreServiceOrderMessage.create({
      data: {
        orderId: order.id,
        senderType: 'SYSTEM',
        senderId: 'system',
        message: `Your order for "${listing.name}" has been received. Our team will review your request and send you a quote shortly.`,
      },
    });

    return order;
  }

  async getUserOrders(businessId: string, userId: string) {
    return db.keystoreServiceOrder.findMany({
      where: { businessId, userId },
      include: { listing: { select: { name: true, slug: true, category: true } }, messages: { take: 1, orderBy: { createdAt: 'desc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOrder(businessId: string, orderId: string, userId?: string) {
    const order = await db.keystoreServiceOrder.findFirst({
      where: { businessId, id: orderId },
      include: {
        listing: { include: { category: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) throw new NotFoundException(`Order "${orderId}" not found`);
    if (userId && order.userId !== userId) {
      throw new ForbiddenException('You do not have access to this order');
    }
    return order;
  }

  async sendMessage(
    businessId: string,
    orderId: string,
    userId: string,
    dto: SendMessageDto,
  ) {
    const order = await this.getOrder(businessId, orderId, userId);

    const message = await db.keystoreServiceOrderMessage.create({
      data: {
        orderId,
        senderType: 'USER',
        senderId: userId,
        message: dto.message,
        attachments: dto.attachments as unknown as any,
        internal: false,
      },
    });

    return message;
  }

  async acceptQuote(
    businessId: string,
    orderId: string,
    userId: string,
    _dto?: AcceptQuoteDto,
  ) {
    const order = await this.getOrder(businessId, orderId, userId);

    if (order.status !== 'QUOTED') {
      throw new BadRequestException(
        `Cannot accept quote: order status is "${order.status}"`,
      );
    }

    return this.transitionStatus(businessId, orderId, 'ACCEPTED', userId, {
      note: _dto?.notes,
    });
  }

  async cancelOrder(
    businessId: string,
    orderId: string,
    userId: string,
    reason?: string,
  ) {
    const order = await this.getOrder(businessId, orderId, userId);

    // Users can only cancel before acceptance
    if (!['REQUESTED', 'QUOTED'].includes(order.status)) {
      throw new BadRequestException(
        `Cannot cancel: order is already "${order.status}"`,
      );
    }

    return this.transitionStatus(businessId, orderId, 'CANCELLED', userId, {
      note: reason || 'Cancelled by user',
    });
  }

  async rateOrder(
    businessId: string,
    orderId: string,
    userId: string,
    dto: RateOrderDto,
  ) {
    const order = await this.getOrder(businessId, orderId, userId);

    if (order.status !== 'DELIVERED') {
      throw new BadRequestException('Can only rate delivered orders');
    }
    if (order.rating) {
      throw new BadRequestException('Order has already been rated');
    }

    return db.keystoreServiceOrder.update({
      where: { id: orderId },
      data: { rating: dto.rating, review: dto.review },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Admin Methods (KeyFlowOS Team)
  // ═══════════════════════════════════════════════════════════════════════════

  async getAllOrders(
    businessId: string,
    filters?: { status?: string; userId?: string; listingId?: string },
  ) {
    return db.keystoreServiceOrder.findMany({
      where: {
        businessId,
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.userId ? { userId: filters.userId } : {}),
        ...(filters?.listingId ? { listingId: filters.listingId } : {}),
      },
      include: {
        listing: { select: { name: true, slug: true } },
        messages: { take: 1, orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async adminUpdateOrderStatus(
    businessId: string,
    orderId: string,
    dto: UpdateOrderStatusDto,
    adminId: string,
  ) {
    return this.transitionStatus(
      businessId,
      orderId,
      dto.status as KeystoreOrderStatus,
      adminId,
      { note: dto.note, metadata: dto.metadata },
    );
  }

  async adminSendMessage(
    businessId: string,
    orderId: string,
    adminId: string,
    dto: SendMessageDto,
  ) {
    const order = await db.keystoreServiceOrder.findFirst({
      where: { businessId, id: orderId },
    });
    if (!order) throw new NotFoundException(`Order "${orderId}" not found`);

    return db.keystoreServiceOrderMessage.create({
      data: {
        orderId,
        senderType: dto.internal ? 'SYSTEM' : 'KEYFLOW_TEAM',
        senderId: adminId,
        message: dto.message,
        attachments: dto.attachments as unknown as any,
        internal: dto.internal ?? false,
      },
    });
  }

  async deliverFiles(
    businessId: string,
    orderId: string,
    adminId: string,
    dto: DeliverFilesDto,
  ) {
    const order = await db.keystoreServiceOrder.findFirst({
      where: { businessId, id: orderId },
    });
    if (!order) throw new NotFoundException(`Order "${orderId}" not found`);

    if (!['COMPLETED', 'REVIEW'].includes(order.status)) {
      throw new BadRequestException(
        `Cannot deliver: order status is "${order.status}"`,
      );
    }

    // Update order with delivery files and transition to DELIVERED
    const deliveryFiles = dto.files as KeystoreDeliveryFile[];

    await db.keystoreServiceOrder.update({
      where: { id: orderId },
      data: {
        deliveryFiles: deliveryFiles as unknown as any,
        deliveredAt: new Date(),
      },
    });

    // Transition to DELIVERED
    return this.transitionStatus(businessId, orderId, 'DELIVERED', adminId, {
      note: dto.note || 'Files delivered',
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Listing Management (Admin)
  // ═══════════════════════════════════════════════════════════════════════════

  async createListing(businessId: string, dto: CreateListingDto) {
    // Check slug uniqueness
    const existing = await db.keystoreServiceListing.findFirst({
      where: { businessId, slug: dto.slug },
    });
    if (existing) {
      throw new BadRequestException(
        `Listing with slug "${dto.slug}" already exists`,
      );
    }

    return db.keystoreServiceListing.create({
      data: {
        businessId,
        categoryId: dto.categoryId,
        name: dto.name,
        slug: dto.slug,
        description: dto.description,
        shortDescription: dto.shortDescription,
        features: dto.features ?? [],
        deliverables: dto.deliverables as unknown as any,
        pricingTiers: dto.pricingTiers as unknown as any,
        addons: dto.addons as unknown as any,
        faq: dto.faq as unknown as any,
        briefQuestions: dto.briefQuestions as unknown as any,
        estimatedDays: dto.estimatedDays ?? 7,
        requiresBrief: dto.requiresBrief ?? true,
        status: 'ACTIVE',
        metadata: dto.metadata ?? {},
      },
    });
  }

  async updateListing(
    businessId: string,
    id: string,
    dto: UpdateListingDto,
  ) {
    const listing = await db.keystoreServiceListing.findFirst({
      where: { businessId, id },
    });
    if (!listing) throw new NotFoundException(`Listing "${id}" not found`);

    // Prevent slug collision
    if (dto.slug && dto.slug !== listing.slug) {
      const existing = await db.keystoreServiceListing.findFirst({
        where: { businessId, slug: dto.slug, NOT: { id } },
      });
      if (existing) {
        throw new BadRequestException(
          `Listing with slug "${dto.slug}" already exists`,
        );
      }
    }

    const updateData: Record<string, unknown> = {};
    if (dto.name) updateData.name = dto.name;
    if (dto.slug) updateData.slug = dto.slug;
    if (dto.description) updateData.description = dto.description;
    if (dto.shortDescription !== undefined)
      updateData.shortDescription = dto.shortDescription;
    if (dto.features) updateData.features = dto.features;
    if (dto.deliverables) updateData.deliverables = dto.deliverables as unknown as any;
    if (dto.pricingTiers) updateData.pricingTiers = dto.pricingTiers as unknown as any;
    if (dto.addons) updateData.addons = dto.addons as unknown as any;
    if (dto.faq) updateData.faq = dto.faq as unknown as any;
    if (dto.briefQuestions)
      updateData.briefQuestions = dto.briefQuestions as unknown as any;
    if (dto.estimatedDays !== undefined)
      updateData.estimatedDays = dto.estimatedDays;
    if (dto.requiresBrief !== undefined)
      updateData.requiresBrief = dto.requiresBrief;
    if (dto.metadata) updateData.metadata = dto.metadata;

    return db.keystoreServiceListing.update({
      where: { id },
      data: updateData,
    });
  }

  async archiveListing(businessId: string, id: string) {
    const listing = await db.keystoreServiceListing.findFirst({
      where: { businessId, id },
    });
    if (!listing) throw new NotFoundException(`Listing "${id}" not found`);

    return db.keystoreServiceListing.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });
  }

  async pauseListing(businessId: string, id: string) {
    const listing = await db.keystoreServiceListing.findFirst({
      where: { businessId, id },
    });
    if (!listing) throw new NotFoundException(`Listing "${id}" not found`);

    return db.keystoreServiceListing.update({
      where: { id },
      data: { status: 'PAUSED' },
    });
  }

  async activateListing(businessId: string, id: string) {
    const listing = await db.keystoreServiceListing.findFirst({
      where: { businessId, id },
    });
    if (!listing) throw new NotFoundException(`Listing "${id}" not found`);

    return db.keystoreServiceListing.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  private async transitionStatus(
    businessId: string,
    orderId: string,
    newStatus: KeystoreOrderStatus,
    actorId: string,
    opts?: { note?: string; metadata?: Record<string, unknown> },
  ) {
    const order = await db.keystoreServiceOrder.findFirst({
      where: { businessId, id: orderId },
    });
    if (!order) throw new NotFoundException(`Order "${orderId}" not found`);

    const currentStatus = order.status as KeystoreOrderStatus;

    if (!isValidStatusTransition(currentStatus, newStatus)) {
      throw new BadRequestException(
        `Invalid status transition: "${currentStatus}" → "${newStatus}"`,
      );
    }

    // Build timeline
    const existingTimeline = (order.timeline as unknown as OrderTimelineEvent[]) ?? [];
    const newEvent: OrderTimelineEvent = {
      status: newStatus,
      timestamp: new Date().toISOString(),
      actor: { type: actorId === 'system' ? 'SYSTEM' : 'USER', id: actorId },
      note: opts?.note,
    };
    const timeline = [...existingTimeline, newEvent];

    // Set timestamps based on status
    const updateData: Record<string, unknown> = {
      status: newStatus,
      timeline: timeline as unknown as any,
    };

    if (newStatus === 'ACCEPTED') {
      updateData.acceptedAt = new Date();
    }
    if (newStatus === 'IN_PROGRESS') {
      updateData.startedAt = new Date();
    }
    if (newStatus === 'COMPLETED') {
      updateData.completedAt = new Date();
    }
    if (newStatus === 'DELIVERED') {
      updateData.deliveredAt = new Date();
    }

    return db.keystoreServiceOrder.update({
      where: { id: orderId },
      data: updateData as any,
      include: { listing: true, messages: true },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Statistics (Admin Dashboard)
  // ═══════════════════════════════════════════════════════════════════════════

  async getOrderStats(businessId: string) {
    const [
      totalOrders,
      pendingQuote,
      inProgress,
      completed,
      delivered,
      cancelled,
    ] = await Promise.all([
      db.keystoreServiceOrder.count({ where: { businessId } }),
      db.keystoreServiceOrder.count({
        where: { businessId, status: 'REQUESTED' },
      }),
      db.keystoreServiceOrder.count({
        where: {
          businessId,
          status: { in: ['ACCEPTED', 'IN_PROGRESS', 'REVIEW', 'REVISION_REQUESTED'] },
        },
      }),
      db.keystoreServiceOrder.count({
        where: { businessId, status: 'COMPLETED' },
      }),
      db.keystoreServiceOrder.count({
        where: { businessId, status: 'DELIVERED' },
      }),
      db.keystoreServiceOrder.count({
        where: { businessId, status: 'CANCELLED' },
      }),
    ]);

    // Aggregate revenue
    const revenueResult = await db.keystoreServiceOrder.aggregate({
      where: { businessId, status: { in: ['DELIVERED', 'COMPLETED'] } },
      _sum: { finalPrice: true },
    });

    return {
      totalOrders,
      pendingQuote,
      inProgress,
      completed,
      delivered,
      cancelled,
      totalRevenue: revenueResult._sum.finalPrice ?? 0,
    };
  }
}
