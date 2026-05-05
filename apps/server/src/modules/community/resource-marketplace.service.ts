import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { NetworkActivityService } from './network-activity.service';
import { CatalogService } from '../catalog/catalog.service';

const businessSelect = {
  id: true, name: true, logoUrl: true, headline: true, industry: true, slug: true,
};

const RESOURCE_TYPES = ['TEMPLATE', 'PROMPT_LIBRARY', 'PROCESS_DOC', 'EDU_CONTENT', 'CANVA_KIT', 'OTHER'] as const;

@Injectable()
export class ResourceMarketplaceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(NetworkActivityService) private readonly activity: NetworkActivityService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  async publish(businessId: string, input: {
    name: string;
    description?: string;
    price: number;
    currency?: string;
    resourceType: typeof RESOURCE_TYPES[number];
    downloadUrl: string;
    previewUrl?: string;
    licenseTerms?: string;
    isFree?: boolean;
    fileSize?: number;
    imageUrl?: string;
  }) {
    if (!RESOURCE_TYPES.includes(input.resourceType as any)) {
      return { error: 'Invalid resource type' };
    }
    const isFree = input.isFree ?? input.price === 0;

    const product = await this.catalog.createProduct({
      businessId,
      name: input.name,
      description: input.description ?? null,
      price: isFree ? 0 : input.price,
      currency: input.currency ?? 'TTD',
      category: 'PRODUCT',
      imageUrl: input.imageUrl ?? null,
      isActive: true,
      resourceType: input.resourceType,
      downloadUrl: input.downloadUrl,
      previewUrl: input.previewUrl ?? null,
      licenseTerms: input.licenseTerms ?? null,
      isFree,
      fileSize: input.fileSize ?? null,
      fulfillmentModel: 'manual',
      inventoryMode: 'virtual',
    });

    await this.activity.log({
      actorBusinessId: businessId,
      type: 'RESOURCE_PUBLISHED',
      refType: 'product',
      refId: product.id,
      title: `New resource: ${product.name}`,
      body: product.description ?? undefined,
      metadata: { resourceType: product.resourceType, price: product.price, currency: product.currency, isFree },
    }).catch(() => {});

    return product;
  }

  async list(filters?: {
    resourceType?: string;
    search?: string;
    isFree?: boolean;
    businessId?: string;
    page?: number;
    limit?: number;
  }) {
    const where: any = {
      deletedAt: null,
      isActive: true,
      resourceType: { not: null },
    };
    if (filters?.resourceType) where.resourceType = filters.resourceType;
    if (filters?.businessId) where.businessId = filters.businessId;
    if (typeof filters?.isFree === 'boolean') where.isFree = filters.isFree;
    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 24;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.client.product.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        include: {
          business: { select: businessSelect },
          _count: { select: { resourceDownloads: true } },
        },
        skip,
        take: limit,
      }),
      this.prisma.client.product.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getById(productId: string) {
    return this.prisma.client.product.findFirst({
      where: { id: productId, resourceType: { not: null }, deletedAt: null },
      include: {
        business: { select: businessSelect },
        _count: { select: { resourceDownloads: true } },
      },
    });
  }

  async listForBusiness(businessId: string) {
    return this.prisma.client.product.findMany({
      where: { businessId, resourceType: { not: null }, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { resourceDownloads: true } } },
    });
  }

  async recordDownload(downloaderBusinessId: string, productId: string, source?: string) {
    const product = await this.prisma.client.product.findFirst({
      where: { id: productId, resourceType: { not: null }, deletedAt: null },
    });
    if (!product) return { error: 'Resource not found' };
    if (!product.downloadUrl) return { error: 'Resource has no download URL' };

    const download = await this.prisma.client.resourceDownload.create({
      data: {
        productId,
        downloaderBusinessId,
        pricePaid: product.isFree ? 0 : product.price,
        currency: product.currency,
        source: source ?? null,
      },
    });

    return { download, downloadUrl: product.downloadUrl, licenseTerms: product.licenseTerms };
  }

  async listMyDownloads(businessId: string) {
    return this.prisma.client.resourceDownload.findMany({
      where: { downloaderBusinessId: businessId },
      orderBy: { createdAt: 'desc' },
      include: {
        product: {
          include: { business: { select: businessSelect } },
        },
      },
    });
  }
}
