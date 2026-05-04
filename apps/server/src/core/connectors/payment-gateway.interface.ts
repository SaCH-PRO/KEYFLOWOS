export interface PaymentGatewayTransaction {
  id: string;
  provider: 'stripe' | 'paypal' | 'wipay';
  type: 'charge' | 'refund';
  status: string;
  amount: number;
  currency: string;
  customerName: string | null;
  customerEmail: string | null;
  description: string | null;
  invoiceId: string | null;
  externalUrl: string | null;
  createdAt: Date;
}

export interface PaymentLinkInput {
  amount: number;
  currency: string;
  description: string;
  customerEmail?: string;
}

export interface PaymentLinkResult {
  id: string;
  url: string;
  provider: 'stripe' | 'paypal' | 'wipay';
  amount: number;
  currency: string;
  description: string;
  active: boolean;
  createdAt: Date;
}

export interface RefundInput {
  chargeId: string;
  amount?: number;
  reason?: string;
}

export interface RefundResult {
  id: string;
  chargeId: string;
  amount: number;
  currency: string;
  status: string;
  provider: 'stripe' | 'paypal' | 'wipay';
  createdAt: Date;
}

export class GatewayNotSupportedError extends Error {
  constructor(provider: string, action: string) {
    super(`${action} is not supported on ${provider}`);
    this.name = 'GatewayNotSupportedError';
  }
}

export interface IPaymentGatewayConnector {
  listRecentTransactions(
    businessId: string,
    limit?: number,
  ): Promise<PaymentGatewayTransaction[]>;
  createPaymentLink(
    businessId: string,
    input: PaymentLinkInput,
  ): Promise<PaymentLinkResult>;
  listPaymentLinks(businessId: string): Promise<PaymentLinkResult[]>;
  revokePaymentLink(businessId: string, linkId: string): Promise<void>;
  refundCharge(businessId: string, input: RefundInput): Promise<RefundResult>;
}
