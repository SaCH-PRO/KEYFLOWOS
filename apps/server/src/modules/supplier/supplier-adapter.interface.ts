export interface NormalizedProduct {
  externalId: string;
  title: string;
  description?: string;
  price?: number;
  currency?: string;
  images?: string[];
  availability: 'in_stock' | 'out_of_stock' | 'limited' | 'unknown';
  leadTimeDays?: number;
  variants?: NormalizedVariant[];
  rawData: Record<string, unknown>;
}

export interface NormalizedVariant {
  externalVariantId?: string;
  attributes: Record<string, string>;
  sku?: string;
  price?: number;
  availability: 'in_stock' | 'out_of_stock' | 'limited' | 'unknown';
  stockQty?: number;
}

export interface NormalizedOrder {
  externalOrderId: string;
  status: string;
  trackingNumber?: string;
  carrier?: string;
  estimatedDelivery?: Date;
  rawData: Record<string, unknown>;
}

export interface SupplierConnectionConfig {
  providerType: string;
  credentials: Record<string, unknown>;
  accountMeta?: Record<string, unknown>;
}

export interface SupplierValidationResult {
  valid: boolean;
  health: 'healthy' | 'degraded' | 'error';
  capabilities: string[];
  message?: string;
}

export interface SupplierCatalogAdapter {
  providerType: string;

  connect(config: SupplierConnectionConfig): Promise<void>;

  validate(config: SupplierConnectionConfig): Promise<SupplierValidationResult>;

  importCatalog(supplierConnectionId: string, options?: {
    page?: number;
    pageSize?: number;
    since?: Date;
  }): Promise<NormalizedProduct[]>;

  fetchProduct(supplierConnectionId: string, externalId: string): Promise<NormalizedProduct | null>;

  normalize(rawProduct: Record<string, unknown>): NormalizedProduct;
}

export interface SupplierOrderAdapter {
  providerType: string;

  placeOrder(params: {
    supplierConnectionId: string;
    externalProductId: string;
    variantId?: string;
    quantity: number;
    shippingAddress: Record<string, unknown>;
  }): Promise<{ externalOrderId: string; status: string }>;

  fetchOrderStatus(supplierConnectionId: string, externalOrderId: string): Promise<NormalizedOrder>;
}

export interface CarrierAdapter {
  carrierCode: string;

  getTrackingInfo(trackingNumber: string): Promise<{
    status: string;
    estimatedDelivery?: Date;
    events: { timestamp: Date; location?: string; description: string }[];
  }>;

  getRates(params: {
    originCountry: string;
    destinationCountry: string;
    weight: number;
    weightUnit?: string;
    dimensions?: { length: number; width: number; height: number; unit: string };
  }): Promise<{ service: string; cost: number; currency: string; estimatedDays: number }[]>;
}
