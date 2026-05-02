/**
 * Marketplace / inventory DTOs returned by the legacy REST API. These mirror
 * the shapes returned by the backend route handlers in
 * `apps/api/src/marketplace` and `apps/api/src/commerce`. They are intentionally
 * loose (most fields optional) because different list endpoints project
 * different subsets of the underlying Prisma models.
 */

export interface ProductDto {
  id: string;
  name?: string;
  description?: string | null;
  sku?: string | null;
  category?: string;
  price?: number | string | null;
  currency?: string | null;
  isActive?: boolean;
  imageUrl?: string | null;
  imageUrls?: string[];
  duration?: number | null;
  cost?: number | string | null;
  trackInventory?: boolean;
  reorderLevel?: number | null;
  reorderAt?: number | null;
  variants?: ProductVariantDto[];
  inventoryStocks?: InventoryStockDto[];
  costProfile?: { landedCostEstimate?: number | null; [key: string]: unknown } | null;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface ProductVariantDto {
  id: string;
  productId?: string;
  name?: string;
  sku?: string | null;
  price?: number | string | null;
  attributes?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WarehouseDto {
  id: string;
  name: string;
  code?: string | null;
  type?: string | null;
  location?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  capacity?: number | null;
  capacityUtilization?: number | null;
  isActive?: boolean;
  isDefault?: boolean;
  [key: string]: unknown;
}

export interface InventoryStockMovementSummary {
  type?: string;
  quantityChange?: number;
  createdAt?: string;
  [key: string]: unknown;
}

export interface InventoryStockDto {
  id: string;
  productId: string;
  warehouseId?: string | null;
  variantId?: string | null;
  quantity: number;
  reserved?: number;
  available?: number;
  reorderLevel?: number | null;
  reorderAt?: number | null;
  reorderQuantity?: number | null;
  costPerUnit?: number | null;
  currency?: string | null;
  product?: ProductDto;
  warehouse?: WarehouseDto;
  variant?: ProductVariantDto;
  lastMovement?: InventoryStockMovementSummary | null;
  [key: string]: unknown;
}

export interface InventoryMovementDto {
  id: string;
  productId?: string;
  warehouseId?: string;
  type: string;
  quantityChange?: number;
  quantity?: number;
  reasonCode?: string | null;
  note?: string | null;
  createdAt?: string;
  product?: ProductDto;
  warehouse?: WarehouseDto;
  [key: string]: unknown;
}

export interface InventoryAlertDto {
  id?: string;
  productId?: string;
  warehouseId?: string;
  type?: string;
  level?: string;
  message?: string;
  productName?: string;
  productSku?: string | null;
  warehouseName?: string;
  quantity?: number;
  reserved?: number;
  available?: number;
  reorderAt?: number;
  reorderLevel?: number;
  salesVelocity30d?: number;
  avgDailySales?: number;
  daysOfStockLeft?: number | null;
  suggestedReorderQty?: number;
  product?: ProductDto;
  warehouse?: WarehouseDto;
  [key: string]: unknown;
}

export interface InventoryWarehouseBreakdown {
  id: string;
  name: string;
  skuCount: number;
  totalUnits: number;
  capacity?: number | null;
  capacityUtilization?: number | null;
  [key: string]: unknown;
}

export interface InventorySummaryDto {
  totalSKUs?: number;
  totalProducts?: number;
  totalSkus?: number;
  totalUnits?: number;
  totalValue?: number;
  totalStockValue?: number;
  belowReorderCount?: number;
  outOfStockCount?: number;
  healthScore?: number;
  outOfStock?: number;
  lowStock?: number;
  warehouseCount?: number;
  warehouseBreakdown?: InventoryWarehouseBreakdown[];
  byWarehouse?: Array<{
    warehouseId: string;
    warehouseName: string;
    totalUnits: number;
    totalValue: number;
  }>;
  topProducts?: Array<{
    productId: string;
    productName: string;
    totalUnits: number;
    totalValue: number;
  }>;
  [key: string]: unknown;
}

export interface PurchaseOrderItemDto {
  id?: string;
  productId?: string;
  variantId?: string | null;
  productName?: string;
  quantity: number;
  unitCost?: number | string;
  totalCost?: number | string;
  product?: ProductDto;
  [key: string]: unknown;
}

export interface PurchaseOrderDto {
  id: string;
  orderNumber?: string;
  poNumber?: string;
  status?: string;
  total?: number | string;
  totalAmount?: number | string;
  currency?: string | null;
  expectedDate?: string | null;
  expectedDelivery?: string | null;
  receivedDate?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  supplierEmail?: string | null;
  warehouseId?: string | null;
  notes?: string | null;
  items?: PurchaseOrderItemDto[];
  product?: ProductDto;
  warehouse?: WarehouseDto;
  quantity?: number | string;
  unitCost?: number | string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface ShipmentDto {
  id: string;
  trackingNumber?: string | null;
  carrier?: string | null;
  status?: string;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  estimatedDelivery?: string | null;
  destination?: string | null;
  orderId?: string | null;
  product?: ProductDto;
  [key: string]: unknown;
}

export interface ListingDto {
  id: string;
  productId?: string;
  channel?: string;
  status?: string;
  url?: string | null;
  price?: number | string | null;
  product?: ProductDto;
  productName?: string;
  marketReach?: string;
  countries?: string;
  hsCode?: string | null;
  shippingEnabled?: boolean;
  [key: string]: unknown;
}

export interface OrderDto {
  id: string;
  orderNumber?: string;
  status?: string;
  total?: number | string;
  currency?: string | null;
  customerName?: string | null;
  customerEmail?: string;
  customerPhone?: string;
  shippingAddress?: string;
  createdAt?: string;
  product?: ProductDto;
  [key: string]: unknown;
}

export interface SupplierDto {
  id: string;
  name: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  status?: string;
  isActive?: boolean;
  [key: string]: unknown;
}

export interface InventorySheetStatusDto {
  connected?: boolean;
  linkedSheetId?: string | null;
  linkedSheetName?: string | null;
  lastSyncAt?: string | null;
  lastPushAt?: string | null;
  lastPullAt?: string | null;
  [key: string]: unknown;
}

export interface InventorySheetDiffConflict {
  sku?: string;
  productName?: string;
  warehouseName?: string;
  systemQty?: number;
  sheetQty?: number;
  systemReorderAt?: number | null;
  sheetReorderAt?: number | null;
  isNew?: boolean;
  [key: string]: unknown;
}

export interface InventorySheetDiffDto {
  conflicts?: InventorySheetDiffConflict[];
  unchanged?: number;
  added?: unknown[];
  removed?: unknown[];
  [key: string]: unknown;
}

export interface InventorySheetPullPreviewDto {
  headers?: string[];
  rows?: Array<Record<string, string>>;
  [key: string]: unknown;
}

export interface InventoryImportResultDto {
  imported?: number;
  skipped?: number;
  errors?: string[];
  [key: string]: unknown;
}

export interface XlsxImportWizardState {
  file: File;
  headers: string[];
  previewRows: string[][];
  columnMap: Record<string, string>;
}
