import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export type InventoryRiskType = 'out_of_stock' | 'low_stock' | 'unverified_supplier_inventory' | 'no_inventory_tracked';

export interface InventoryRiskSignal {
  type: InventoryRiskType;
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  detail?: string;
  warehouseId?: string;
  warehouseName?: string;
  currentQty?: number;
  reorderAt?: number;
}

export interface ProductInventoryRisk {
  productId: string;
  productName: string;
  inventoryMode: string | null;
  fulfillmentModel: string | null;
  totalQty: number;
  reservedQty: number;
  availableQty: number;
  hasReorderThreshold: boolean;
  signals: InventoryRiskSignal[];
  riskLevel: 'critical' | 'high' | 'medium' | 'low' | 'none';
}

export interface InventoryRiskReport {
  businessId: string;
  totalProducts: number;
  outOfStockCount: number;
  lowStockCount: number;
  unverifiedCount: number;
  products: ProductInventoryRisk[];
}

const UNVERIFIED_DAYS_THRESHOLD = 7;

@Injectable()
export class InventoryRiskService {
  private readonly logger = new Logger(InventoryRiskService.name);

  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  private classifyOverallRisk(signals: InventoryRiskSignal[]): 'critical' | 'high' | 'medium' | 'low' | 'none' {
    if (signals.some(s => s.severity === 'critical')) return 'critical';
    if (signals.some(s => s.severity === 'high')) return 'high';
    if (signals.some(s => s.severity === 'medium')) return 'medium';
    if (signals.some(s => s.severity === 'low')) return 'low';
    return 'none';
  }

  async evaluateProduct(productId: string, businessId: string): Promise<ProductInventoryRisk | null> {
    const product = await this.db.product.findFirst({
      where: { id: productId, businessId, deletedAt: null },
      include: {
        inventoryStocks: {
          include: { warehouse: { select: { id: true, name: true } } },
        },
        sourceLinks: {
          where: { isActive: true },
          include: {
            supplierProduct: { select: { availability: true, updatedAt: true } },
          },
        },
      },
    });
    if (!product) return null;

    const signals: InventoryRiskSignal[] = [];
    const inventoryMode = product.inventoryMode;
    const fulfillmentModel = product.fulfillmentModel;

    const stocks = product.inventoryStocks;
    const totalQty = stocks.reduce((s, st) => s + st.quantity, 0);
    const reservedQty = stocks.reduce((s, st) => s + st.reserved, 0);
    const availableQty = totalQty - reservedQty;

    const reorderStocks = stocks.filter(st => st.reorderAt !== null && st.reorderAt !== undefined);
    const hasReorderThreshold = reorderStocks.length > 0;

    if (inventoryMode === 'tracked' || (stocks.length > 0)) {
      for (const stock of stocks) {
        const available = stock.quantity - stock.reserved;
        if (available <= 0) {
          signals.push({
            type: 'out_of_stock',
            severity: 'critical',
            message: `Out of stock at ${stock.warehouse.name}`,
            detail: `Quantity: ${stock.quantity}, Reserved: ${stock.reserved}. Restock immediately.`,
            warehouseId: stock.warehouse.id,
            warehouseName: stock.warehouse.name,
            currentQty: stock.quantity,
          });
        } else if (stock.reorderAt !== null && stock.reorderAt !== undefined && available <= stock.reorderAt) {
          signals.push({
            type: 'low_stock',
            severity: 'high',
            message: `Low stock at ${stock.warehouse.name}: ${available} units (reorder at ${stock.reorderAt})`,
            detail: 'Stock has reached or passed the reorder threshold.',
            warehouseId: stock.warehouse.id,
            warehouseName: stock.warehouse.name,
            currentQty: available,
            reorderAt: stock.reorderAt,
          });
        }
      }
    }

    if (fulfillmentModel === 'dropship' || fulfillmentModel === 'preorder') {
      const now = new Date();
      const staleThreshold = new Date(now.getTime() - UNVERIFIED_DAYS_THRESHOLD * 86400000);
      const staleLinks = product.sourceLinks.filter(l => {
        const updatedAt = l.supplierProduct?.updatedAt;
        return updatedAt && new Date(updatedAt) < staleThreshold;
      });
      if (staleLinks.length > 0) {
        signals.push({
          type: 'unverified_supplier_inventory',
          severity: 'medium',
          message: `${staleLinks.length} supplier(s) not verified in ${UNVERIFIED_DAYS_THRESHOLD}+ days`,
          detail: 'Supplier inventory data may be outdated. Verify availability before accepting orders.',
        });
      }

      const unavailableLinks = product.sourceLinks.filter(l => l.supplierProduct?.availability === 'out_of_stock');
      if (unavailableLinks.length > 0 && unavailableLinks.length === product.sourceLinks.length) {
        signals.push({
          type: 'out_of_stock',
          severity: 'critical',
          message: 'All supplier sources report out of stock',
          detail: 'No supplier can fulfill this product. Disable the listing or find alternatives.',
        });
      }
    }

    if (inventoryMode === 'tracked' && stocks.length === 0) {
      signals.push({
        type: 'no_inventory_tracked',
        severity: 'medium',
        message: 'Inventory mode is tracked but no stock records exist',
        detail: 'Add inventory records for this product or change the inventory mode.',
      });
    }

    return {
      productId: product.id,
      productName: product.name,
      inventoryMode,
      fulfillmentModel,
      totalQty,
      reservedQty,
      availableQty,
      hasReorderThreshold,
      signals,
      riskLevel: this.classifyOverallRisk(signals),
    };
  }

  async evaluateAllProducts(businessId: string): Promise<InventoryRiskReport> {
    const products = await this.db.product.findMany({
      where: { businessId, deletedAt: null },
      select: { id: true },
    });

    const results: ProductInventoryRisk[] = [];
    for (const p of products) {
      const risk = await this.evaluateProduct(p.id, businessId);
      if (risk) results.push(risk);
    }

    const outOfStockCount = results.filter(r => r.signals.some(s => s.type === 'out_of_stock')).length;
    const lowStockCount = results.filter(r => r.signals.some(s => s.type === 'low_stock')).length;
    const unverifiedCount = results.filter(r => r.signals.some(s => s.type === 'unverified_supplier_inventory')).length;

    return {
      businessId,
      totalProducts: products.length,
      outOfStockCount,
      lowStockCount,
      unverifiedCount,
      products: results
        .filter(r => r.riskLevel !== 'none')
        .sort((a, b) => {
          const order = { critical: 0, high: 1, medium: 2, low: 3, none: 4 };
          return order[a.riskLevel] - order[b.riskLevel];
        }),
    };
  }
}
