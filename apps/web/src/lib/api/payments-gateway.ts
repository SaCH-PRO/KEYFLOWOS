import { apiGet, apiPost } from "@/lib/api";

export type PayableType = "invoice" | "storefront_order" | "event_ticket" | "mass_comm";

export interface OpenPayable {
  type: PayableType;
  id: string;
  title: string;
  customer: string;
  amount: number;
  currency: string;
  status: string;
  dueAt: string | null;
  createdAt: string;
  href: string;
}

export interface OpenPayablesResult {
  payables: OpenPayable[];
  counts: {
    invoices: number;
    massComms: number;
    storefrontOrders: number;
    eventTickets: number;
  };
}

export async function listOpenPayables(businessId: string) {
  return apiGet<OpenPayablesResult>(
    `/payments/businesses/${businessId}/gateways/payables`,
  );
}

export async function createCheckout(body: {
  payableType: PayableType;
  payableId: string;
  gateway: "stripe" | "paypal" | "wipay";
  returnUrl?: string;
  successUrl?: string;
  cancelUrl?: string;
}) {
  return apiPost<{ type: "redirect" | "paypal_order"; redirectUrl?: string; orderId?: string }>({
    path: "/payments/create-checkout",
    body,
  });
}
