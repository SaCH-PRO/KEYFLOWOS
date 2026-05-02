/**
 * Shared TypeScript types for the marketplace / inventory / commerce modules.
 * These mirror the backend Prisma models in `packages/db/prisma/schema.prisma`
 * (Warehouse, InventoryStock, StockMovement, MarketplaceListing,
 * MarketplaceOrder, Shipment, PurchaseOrder, CustomsDeclaration, PreOrder,
 * ProductVariant, Product) but allow optional/extended fields used by the
 * frontend and AI tool result payloads.
 *
 * Where the backend response shape is loosely-typed (Json columns, AI tool
 * outputs), the corresponding fields are typed as `Record<string, unknown>`,
 * `unknown[]` or with the most specific structural shape we actually consume
 * in the UI. This file replaces the previous tech-debt `any` placeholders
 * tracked under task #278.
 */

export type Currency = string;

export interface Product {
  id: string;
  name?: string;
  description?: string | null;
  price?: number;
  currency?: Currency;
  category?: string;
  duration?: number | null;
  imageUrl?: string | null;
  sku?: string | null;
  isActive?: boolean;
  executionModel?: string | null;
  executionMeta?: Record<string, unknown> | null;
  fulfillmentModel?: string | null;
  inventoryMode?: string | null;
  compareAtPrice?: number | null;
  resourceType?: string | null;
  downloadUrl?: string | null;
  previewUrl?: string | null;
  licenseTerms?: string | null;
  isFree?: boolean;
  fileSize?: number | null;
  businessId?: string;
  createdAt?: string;
  updatedAt?: string;
  variants?: ProductVariant[];
  costProfile?: ProductCostProfile | null;
  meta?: Record<string, unknown> | null;
  type?: string;
  costPrice?: number | string | null;
  sourceUrl?: string | null;
  supplierName?: string | null;
}

export interface ProductVariant {
  id: string;
  productId?: string;
  attributes?: Record<string, unknown>;
  sku?: string | null;
  priceOverride?: number | null;
  imageUrl?: string | null;
  trackStock?: boolean;
  stockQty?: number;
  reservedQty?: number;
  isActive?: boolean;
  name?: string;
  price?: number | string | null;
}

export interface ProductCostProfile {
  id?: string;
  productId?: string;
  sourceCost?: number;
  shippingEstimate?: number;
  dutiesEstimate?: number;
  packagingCost?: number;
  transactionCost?: number;
  landedCostEstimate?: number;
  grossMargin?: number | null;
  marginBand?: string | null;
  currency?: Currency;
}

export interface Warehouse {
  id: string;
  businessId?: string;
  name: string;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  type?: string;
  capacity?: number | null;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface InventoryStock {
  id: string;
  businessId?: string;
  productId: string;
  warehouseId: string;
  quantity: number;
  reserved: number;
  reorderAt?: number | null;
  costPerUnit?: number | null;
  currency?: Currency;
  updatedAt?: string;
  product?: Product | null;
  warehouse?: Warehouse | null;
  lastMovement?: StockMovement | null;
}

export interface StockMovement {
  id: string;
  businessId?: string;
  warehouseId?: string | null;
  productId?: string | null;
  type: string;
  quantityChange: number;
  reasonCode?: string | null;
  note?: string | null;
  referenceId?: string | null;
  createdBy?: string | null;
  createdAt: string;
}

export interface PurchaseOrderItem {
  productId?: string;
  name?: string;
  sku?: string | null;
  quantity: number;
  unitPrice: number;
  total?: number;
  currency?: Currency;
}

export interface PurchaseOrder {
  id: string;
  businessId?: string;
  poNumber: string;
  status: string;
  supplierName: string;
  supplierEmail?: string | null;
  supplierPhone?: string | null;
  supplierCountry?: string | null;
  supplierConnectionId?: string | null;
  items: PurchaseOrderItem[];
  subtotal?: number;
  shippingCost?: number;
  taxAmount?: number;
  total?: number;
  currency?: Currency;
  expectedDelivery?: string | null;
  receivedAt?: string | null;
  submittedAt?: string | null;
  acknowledgedAt?: string | null;
  shippedAt?: string | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface MarketplaceListing {
  id: string;
  businessId?: string;
  productId: string;
  marketReach?: string;
  countries?: string[];
  regions?: string[];
  fulfillmentStrategy?: string;
  supplierName?: string | null;
  supplierEmail?: string | null;
  supplierPhone?: string | null;
  supplierCountry?: string | null;
  depositPercent?: number | null;
  pricingOverrides?: Record<string, unknown> | null;
  shippingEnabled?: boolean;
  digitalDelivery?: boolean;
  hsCode?: string | null;
  originCountry?: string | null;
  weight?: number | null;
  weightUnit?: string;
  dimensions?: Record<string, unknown> | null;
  minOrderQty?: number;
  maxOrderQty?: number | null;
  leadTimeDays?: number | null;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
  product?: Product | null;
}

export interface MarketplaceOrderItem {
  id?: string;
  orderId?: string;
  productId: string;
  name: string;
  sku?: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
  currency?: Currency;
}

export interface MarketplaceOrder {
  id: string;
  businessId?: string;
  orderNumber: string;
  status: string;
  type?: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerCountry?: string | null;
  shippingAddress?: Record<string, unknown> | null;
  billingAddress?: Record<string, unknown> | null;
  subtotal?: number;
  shippingFee?: number;
  taxAmount?: number;
  dutyAmount?: number;
  discountAmount?: number;
  total?: number;
  currency?: Currency;
  paymentStatus?: string;
  paymentMethod?: string | null;
  paymentRef?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  items?: MarketplaceOrderItem[];
  shipments?: Shipment[];
  createdAt?: string;
  updatedAt?: string;
}

export interface Shipment {
  id: string;
  businessId?: string;
  orderId?: string | null;
  trackingNumber?: string | null;
  carrier?: string | null;
  status: string;
  originCountry?: string | null;
  destinationCountry?: string | null;
  destinationAddress?: Record<string, unknown> | null;
  weight?: number | null;
  weightUnit?: string;
  dimensions?: Record<string, unknown> | null;
  shippingCost?: number | null;
  currency?: Currency;
  estimatedDelivery?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  milestones?: Array<{ label?: string; at?: string; note?: string }> | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CustomsDeclaration {
  id: string;
  businessId?: string;
  declarationType?: string;
  referenceNumber?: string | null;
  status: string;
  hsCode?: string | null;
  goodsDescription?: string | null;
  originCountry?: string | null;
  destinationCountry?: string | null;
  declaredValue?: number | null;
  currency?: Currency;
  dutyRate?: number | null;
  dutyAmount?: number | null;
  vatAmount?: number | null;
  totalCharges?: number | null;
  documents?: Record<string, unknown> | null;
  notes?: string | null;
  filedAt?: string | null;
  clearedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface PreOrder {
  id: string;
  businessId?: string;
  productId: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  quantity: number;
  unitPrice: number;
  depositAmount?: number | null;
  depositPaid?: boolean;
  total: number;
  currency?: Currency;
  status: string;
  expectedDate?: string | null;
  fulfilledAt?: string | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface FulfillmentRoute {
  id: string;
  businessId?: string;
  orderId: string;
  orderItemId?: string | null;
  listingId?: string | null;
  strategy: string;
  status: string;
  sourceType?: string | null;
  warehouseId?: string | null;
  purchaseOrderId?: string | null;
  preOrderId?: string | null;
  shipmentId?: string | null;
  sourceLinkId?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  resolvedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface InventoryWarehouseBreakdown {
  id: string;
  name: string;
  skuCount: number;
  totalUnits: number;
  capacity?: number | null;
  capacityUtilization?: number | null;
}

export interface InventorySummary {
  totalSKUs?: number;
  totalStockValue?: number;
  belowReorderCount?: number;
  outOfStockCount?: number;
  healthScore?: number;
  warehouseBreakdown?: InventoryWarehouseBreakdown[];
  recentOrders?: MarketplaceOrder[];
}

export interface InventoryAlert {
  id?: string;
  productId?: string;
  warehouseId?: string;
  productName?: string;
  warehouseName?: string;
  severity?: string;
  type?: string;
  message?: string;
  quantity?: number;
  reorderAt?: number | null;
  suggestion?: string;
}

export interface InventorySheetStatus {
  driveConnected?: boolean;
  linkedSheetId?: string | null;
  linkedSheetName?: string | null;
  lastSyncAt?: string | null;
  lastPushAt?: string | null;
  lastPullAt?: string | null;
}

export interface InventorySheetConflict {
  sku?: string;
  productName?: string;
  warehouseName?: string;
  systemQty?: number;
  sheetQty?: number;
  systemReorderAt?: number | null;
  sheetReorderAt?: number | null;
  isNew?: boolean;
}

export interface InventorySheetDiff {
  conflicts?: InventorySheetConflict[];
  added?: Array<Record<string, unknown>>;
  removed?: Array<Record<string, unknown>>;
  unchanged?: number;
}

export interface InventorySheetPullPreview {
  rows?: Array<Record<string, unknown>>;
  headers?: string[];
  warnings?: string[];
}

export interface InventoryImportResult {
  imported?: number;
  skipped?: number;
  errors?: string[];
}

export interface InventoryDashboardData {
  stats?: {
    totalSKUs?: number;
    totalStockValue?: number;
    pendingOrders?: number;
    activeShipments?: number;
    recentOrders?: MarketplaceOrder[];
  };
  recentOrders?: MarketplaceOrder[];
}
