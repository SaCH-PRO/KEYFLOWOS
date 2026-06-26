// ─────────────────────────────────────────────────────────────────────────────
// KeyStore Service Marketplace — Unit Tests
// ─────────────────────────────────────────────────────────────────────────────

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { vi } from 'vitest';
import { KeystoreService } from '../keystore.service';
import { db } from '@keyflow/db';
import { isValidStatusTransition } from '../types/keystore.types';
import type { CreateOrderDto, CreateListingDto, UpdateOrderStatusDto } from '../dto';

// Mock Prisma client
vi.mock('@keyflow/db', () => ({
  db: {
    keystoreServiceCategory: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    keystoreServiceListing: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    keystoreServiceOrder: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    keystoreServiceOrderMessage: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

describe('KeystoreService', () => {
  let service: KeystoreService;

  const mockBusinessId = 'biz_test123';
  const mockUserId = 'user_test123';
  const mockListingId = 'listing_test123';
  const mockOrderId = 'order_test123';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [KeystoreService],
    }).compile();

    service = module.get<KeystoreService>(KeystoreService);
    vi.clearAllMocks();
  });

  describe('Status Transitions', () => {
    it('should allow REQUESTED → QUOTED', () => {
      expect(isValidStatusTransition('REQUESTED', 'QUOTED')).toBe(true);
    });

    it('should allow REQUESTED → DECLINED', () => {
      expect(isValidStatusTransition('REQUESTED', 'DECLINED')).toBe(true);
    });

    it('should allow REQUESTED → CANCELLED', () => {
      expect(isValidStatusTransition('REQUESTED', 'CANCELLED')).toBe(true);
    });

    it('should allow QUOTED → ACCEPTED', () => {
      expect(isValidStatusTransition('QUOTED', 'ACCEPTED')).toBe(true);
    });

    it('should allow IN_PROGRESS → REVIEW', () => {
      expect(isValidStatusTransition('IN_PROGRESS', 'REVIEW')).toBe(true);
    });

    it('should allow REVIEW → COMPLETED', () => {
      expect(isValidStatusTransition('REVIEW', 'COMPLETED')).toBe(true);
    });

    it('should allow COMPLETED → DELIVERED', () => {
      expect(isValidStatusTransition('COMPLETED', 'DELIVERED')).toBe(true);
    });

    it('should not allow DELIVERED → anything', () => {
      expect(isValidStatusTransition('DELIVERED', 'REQUESTED')).toBe(false);
      expect(isValidStatusTransition('DELIVERED', 'COMPLETED')).toBe(false);
    });

    it('should not allow REQUESTED → IN_PROGRESS (skip quote)', () => {
      expect(isValidStatusTransition('REQUESTED', 'IN_PROGRESS')).toBe(false);
    });

    it('should not allow invalid statuses', () => {
      expect(isValidStatusTransition('INVALID' as any, 'QUOTED')).toBe(false);
    });
  });

  describe('getCategories', () => {
    it('should return active categories ordered by sortOrder', async () => {
      const mockCategories = [
        { id: 'cat1', name: 'Content', slug: 'content', sortOrder: 0, isActive: true },
        { id: 'cat2', name: 'Design', slug: 'design', sortOrder: 1, isActive: true },
      ];
      (db.keystoreServiceCategory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockCategories);

      const result = await service.getCategories(mockBusinessId);

      expect(db.keystoreServiceCategory.findMany).toHaveBeenCalledWith({
        where: { businessId: mockBusinessId, isActive: true },
        orderBy: { sortOrder: 'asc' },
      });
      expect(result).toEqual(mockCategories);
    });
  });

  describe('getListings', () => {
    it('should return active listings', async () => {
      const mockListings = [
        { id: 'list1', name: 'Blog Writing', slug: 'blog-writing', status: 'ACTIVE' },
      ];
      (db.keystoreServiceListing.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockListings);

      const result = await service.getListings(mockBusinessId);

      expect(db.keystoreServiceListing.findMany).toHaveBeenCalledWith({
        where: { businessId: mockBusinessId, status: 'ACTIVE' },
        include: { category: true },
        orderBy: { sortOrder: 'asc' },
      });
      expect(result).toEqual(mockListings);
    });

    it('should filter by categoryId when provided', async () => {
      const mockListings: any[] = [];
      (db.keystoreServiceListing.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockListings);

      await service.getListings(mockBusinessId, 'cat1');

      expect(db.keystoreServiceListing.findMany).toHaveBeenCalledWith({
        where: { businessId: mockBusinessId, status: 'ACTIVE', categoryId: 'cat1' },
        include: { category: true },
        orderBy: { sortOrder: 'asc' },
      });
    });
  });

  describe('getListingBySlug', () => {
    it('should return a listing by slug', async () => {
      const mockListing = { id: 'list1', name: 'Blog Writing', slug: 'blog-writing' };
      (db.keystoreServiceListing.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockListing);

      const result = await service.getListingBySlug(mockBusinessId, 'blog-writing');

      expect(result).toEqual(mockListing);
    });

    it('should throw NotFoundException for missing slug', async () => {
      (db.keystoreServiceListing.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(service.getListingBySlug(mockBusinessId, 'missing'))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('createOrder', () => {
    const mockListing = {
      id: mockListingId,
      name: 'Blog Writing',
      slug: 'blog-writing',
      pricingTiers: [{ name: 'Standard', price: 500 }],
      addons: [{ name: 'Rush Delivery', price: 100 }],
    };

    it('should create an order successfully', async () => {
      (db.keystoreServiceListing.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockListing);
      (db.keystoreServiceOrder.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: mockOrderId,
        status: 'REQUESTED',
      });
      (db.keystoreServiceOrderMessage.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const dto: CreateOrderDto = {
        listingId: mockListingId,
        pricingTier: 'Standard',
      };

      const result = await service.createOrder(mockBusinessId, mockUserId, dto);

      expect(db.keystoreServiceOrder.create).toHaveBeenCalled();
      expect(result.status).toBe('REQUESTED');
    });

    it('should throw BadRequestException for invalid pricing tier', async () => {
      (db.keystoreServiceListing.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockListing);

      const dto: CreateOrderDto = {
        listingId: mockListingId,
        pricingTier: 'NonExistentTier',
      };

      await expect(service.createOrder(mockBusinessId, mockUserId, dto))
        .rejects.toThrow(BadRequestException);
    });

    it('should calculate price with addons', async () => {
      (db.keystoreServiceListing.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockListing);
      (db.keystoreServiceOrder.create as ReturnType<typeof vi.fn>).mockImplementation((args: any) =>
        Promise.resolve({ id: mockOrderId, ...args.data }),
      );
      (db.keystoreServiceOrderMessage.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const dto: CreateOrderDto = {
        listingId: mockListingId,
        pricingTier: 'Standard',
        selectedAddons: [{ addonName: 'Rush Delivery', price: 100 }],
      };

      const result = await service.createOrder(mockBusinessId, mockUserId, dto);

      expect(result.estimatedPrice).toBe(600); // 500 + 100
    });
  });

  describe('cancelOrder', () => {
    it('should cancel an order in REQUESTED status', async () => {
      (db.keystoreServiceOrder.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: mockOrderId,
        status: 'REQUESTED',
        userId: mockUserId,
        timeline: [],
      });
      (db.keystoreServiceOrder.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: mockOrderId,
        status: 'CANCELLED',
      });

      const result = await service.cancelOrder(mockBusinessId, mockOrderId, mockUserId);

      expect(result.status).toBe('CANCELLED');
    });

    it('should not allow cancelling ACCEPTED orders', async () => {
      (db.keystoreServiceOrder.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: mockOrderId,
        status: 'ACCEPTED',
        userId: mockUserId,
      });

      await expect(service.cancelOrder(mockBusinessId, mockOrderId, mockUserId))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('adminUpdateOrderStatus', () => {
    it('should update order status with valid transition', async () => {
      (db.keystoreServiceOrder.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: mockOrderId,
        status: 'REQUESTED',
        timeline: [],
      });
      (db.keystoreServiceOrder.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: mockOrderId,
        status: 'QUOTED',
      });

      const dto: UpdateOrderStatusDto = { status: 'QUOTED' };
      const result = await service.adminUpdateOrderStatus(
        mockBusinessId,
        mockOrderId,
        dto,
        'admin123',
      );

      expect(result.status).toBe('QUOTED');
    });

    it('should reject invalid status transition', async () => {
      (db.keystoreServiceOrder.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: mockOrderId,
        status: 'DELIVERED',
        timeline: [],
      });

      const dto: UpdateOrderStatusDto = { status: 'REQUESTED' };
      await expect(
        service.adminUpdateOrderStatus(mockBusinessId, mockOrderId, dto, 'admin123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('createListing', () => {
    it('should create a listing with valid data', async () => {
      (db.keystoreServiceListing.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (db.keystoreServiceListing.create as ReturnType<typeof vi.fn>).mockImplementation((args: any) =>
        Promise.resolve({ id: 'list_new', ...args.data }),
      );

      const dto: CreateListingDto = {
        name: 'SEO Audit',
        slug: 'seo-audit',
        categoryId: 'cat1',
        description: 'Comprehensive SEO audit',
        pricingTiers: [{ name: 'Basic', price: 300 }],
      };

      const result = await service.createListing(mockBusinessId, dto);

      expect(result.name).toBe('SEO Audit');
      expect(db.keystoreServiceListing.create).toHaveBeenCalled();
    });

    it('should reject duplicate slugs', async () => {
      (db.keystoreServiceListing.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'existing' });

      const dto: CreateListingDto = {
        name: 'SEO Audit',
        slug: 'seo-audit',
        categoryId: 'cat1',
        description: 'Comprehensive SEO audit',
        pricingTiers: [{ name: 'Basic', price: 300 }],
      };

      await expect(service.createListing(mockBusinessId, dto))
        .rejects.toThrow(BadRequestException);
    });
  });

});
