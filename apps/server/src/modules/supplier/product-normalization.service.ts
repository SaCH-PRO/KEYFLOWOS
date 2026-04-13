import { Injectable, Logger, NotFoundException, Inject } from '@nestjs/common';
import { Prisma } from '@keyflow/db';
import { PrismaService } from '../../core/prisma/prisma.service';
import { NormalizedProduct } from './supplier-adapter.interface';

@Injectable()
export class ProductNormalizationService {
  private readonly logger = new Logger(ProductNormalizationService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private cleanTitle(title: string): string {
    return title
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s\-.,!?&()]/g, '')
      .substring(0, 255);
  }

  private cleanDescription(description: string): string {
    return description
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/<[^>]*>/g, '')
      .substring(0, 5000);
  }

  async normalizeAndUpsertProduct(
    supplierConnectionId: string,
    normalizedProduct: NormalizedProduct,
  ): Promise<{ supplierProductId: string }> {
    const {
      externalId,
      title,
      description,
      price,
      currency,
      images,
      availability,
      leadTimeDays,
      variants,
      rawData,
    } = normalizedProduct;

    const cleanedTitle = this.cleanTitle(title);
    const cleanedDescription = description ? this.cleanDescription(description) : undefined;

    const supplierProduct = await this.prisma.client.supplierProduct.upsert({
      where: {
        supplierConnectionId_externalId: {
          supplierConnectionId,
          externalId,
        },
      },
      create: {
        supplierConnectionId,
        externalId,
        rawData: rawData as Prisma.InputJsonValue,
        normalizedTitle: cleanedTitle,
        normalizedDescription: cleanedDescription,
        normalizedPrice: price,
        normalizedImages: images ?? [],
        availability,
        leadTimeDays,
        currency: currency ?? 'TTD',
      },
      update: {
        rawData: rawData as Prisma.InputJsonValue,
        normalizedTitle: cleanedTitle,
        normalizedDescription: cleanedDescription,
        normalizedPrice: price,
        normalizedImages: images ?? [],
        availability,
        leadTimeDays,
        currency: currency ?? 'TTD',
      },
    });

    if (variants && variants.length > 0) {
      for (const variant of variants) {
        const existingVariant = variant.externalVariantId
          ? await this.prisma.client.supplierVariant.findFirst({
              where: { supplierProductId: supplierProduct.id, externalVariantId: variant.externalVariantId },
            })
          : null;

        const variantData = {
          attributes: variant.attributes as Prisma.InputJsonValue,
          sku: variant.sku,
          price: variant.price,
          availability: variant.availability,
          stockQty: variant.stockQty,
        };

        if (existingVariant) {
          await this.prisma.client.supplierVariant.update({
            where: { id: existingVariant.id },
            data: variantData,
          });
        } else {
          await this.prisma.client.supplierVariant.create({
            data: {
              supplierProductId: supplierProduct.id,
              externalVariantId: variant.externalVariantId,
              ...variantData,
            },
          });
        }
      }
    }

    this.logger.log(`Normalized supplier product ${externalId} -> supplierProduct ${supplierProduct.id}`);

    return { supplierProductId: supplierProduct.id };
  }

  async createProductFromSupplierProduct(
    businessId: string,
    supplierProductId: string,
    overrides?: {
      name?: string;
      price?: number;
      category?: string;
      fulfillmentModel?: string;
    },
  ) {
    const supplierProduct = await this.prisma.client.supplierProduct.findUnique({
      where: { id: supplierProductId },
      include: { supplierConnection: { select: { businessId: true } } },
    });

    if (!supplierProduct) {
      throw new NotFoundException(`SupplierProduct ${supplierProductId} not found`);
    }

    if (supplierProduct.supplierConnection.businessId !== businessId) {
      throw new NotFoundException(`SupplierProduct ${supplierProductId} not found`);
    }

    const productName = overrides?.name ?? supplierProduct.normalizedTitle ?? supplierProduct.externalId;
    const productPrice = overrides?.price ?? supplierProduct.normalizedPrice ?? 0;

    const product = await this.prisma.client.product.create({
      data: {
        businessId,
        name: productName,
        description: supplierProduct.normalizedDescription,
        price: productPrice,
        currency: supplierProduct.currency,
        imageUrl: supplierProduct.normalizedImages[0] ?? null,
        category: overrides?.category ?? 'PRODUCT',
        fulfillmentModel: overrides?.fulfillmentModel ?? 'dropship',
        inventoryMode: 'virtual',
        isActive: true,
      },
    });

    await this.prisma.client.productSourceLink.create({
      data: {
        productId: product.id,
        supplierProductId: supplierProduct.id,
        sourceCost: supplierProduct.normalizedPrice,
        leadTimeDays: supplierProduct.leadTimeDays,
        availabilityState: supplierProduct.availability === 'in_stock' ? 'available' : 'unavailable',
        priority: 1,
      },
    });

    this.logger.log(`Created internal Product ${product.id} from SupplierProduct ${supplierProductId}`);

    return product;
  }

  async refreshProductFromSupplierProduct(
    businessId: string,
    productId: string,
    supplierProductId: string,
  ) {
    const [product, supplierProduct] = await Promise.all([
      this.prisma.client.product.findFirst({ where: { id: productId, businessId } }),
      this.prisma.client.supplierProduct.findUnique({
        where: { id: supplierProductId },
        include: { supplierConnection: { select: { businessId: true } } },
      }),
    ]);

    if (!product) throw new NotFoundException('Product not found');
    if (!supplierProduct || supplierProduct.supplierConnection.businessId !== businessId) {
      throw new NotFoundException('Supplier product not found');
    }

    const updatedProduct = await this.prisma.client.product.update({
      where: { id: productId },
      data: {
        description: supplierProduct.normalizedDescription,
        imageUrl: supplierProduct.normalizedImages[0] ?? product.imageUrl,
      },
    });

    await this.prisma.client.productSourceLink.updateMany({
      where: { productId, supplierProductId },
      data: {
        sourceCost: supplierProduct.normalizedPrice,
        leadTimeDays: supplierProduct.leadTimeDays,
        availabilityState: supplierProduct.availability === 'in_stock' ? 'available' : 'unavailable',
      },
    });

    this.logger.log(`Refreshed Product ${productId} from SupplierProduct ${supplierProductId}`);

    return updatedProduct;
  }
}
