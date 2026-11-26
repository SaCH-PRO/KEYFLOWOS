import { apiGet, apiPostSimple } from "@/lib/api";

/**
 * TODAY-4BLOCK: the client for Today's one server read, GET /business-command-center/businesses/:b/today
 * (TODAY-AGGREGATE, P79). The types mirror apps/server/src/modules/business-command-center/business-command-center.types.ts
 * ("TODAY-AGGREGATE (V1-65, P79)"); the server filters every block by the caller's own module scopes, so what is
 * here is what this member may see.
 */

export type TodayNeedsYouKind = "CLAIM" | "ACCEPTED_QUOTE" | "KEY_PROPOSAL" | "APPROVAL_REQUEST" | "PLAN_STEP";

export interface TodayNeedsYouAction {
  label: string;
  actionType: "APPROVE" | "EXECUTE" | "REJECT" | "CONFIRM" | "DISMISS" | "CONVERT" | "OPEN";
  href?: string;
  method?: "GET" | "POST";
  endpoint?: string;
}

export interface TodayNeedsYouItem {
  id: string;
  kind: TodayNeedsYouKind;
  sourceId: string;
  title: string;
  summary: string;
  contactId: string | null;
  customerName: string | null;
  amount?: number | null;
  currency?: string | null;
  createdAt: string;
  href: string;
  actions: TodayNeedsYouAction[];
}

export interface TodayBookingItem {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  serviceName: string | null;
  customerName: string | null;
  contactId: string | null;
}

export interface TodayInvoiceItem {
  id: string;
  invoiceNumber: string;
  status: string;
  dueDate: string | null;
  remaining: number;
  total: number;
  currency: string;
  customerName: string | null;
  contactId: string | null;
  isOverdue: boolean;
}

export interface TodayAcceptedQuoteItem {
  id: string;
  quoteNumber: string;
  total: number;
  currency: string;
  acceptedAt: string | null;
  customerName: string | null;
  contactId: string | null;
}

export interface TodayTaskItem {
  id: string;
  title: string;
  dueDate: string | null;
  priority: string;
  contactId: string | null;
  customerName: string | null;
}

export interface TodayOrderItem {
  id: string;
  orderNumber: string;
  status: string;
  total: number | null;
  currency: string;
  customerName: string | null;
  createdAt: string;
}

export interface TodayReminderItem {
  kind: "invoice" | "booking";
  id: string;
  contactId: string | null;
  customerName: string;
  whatsappUrl: string | null;
  messageText: string;
  dueAt: string;
  reference: string;
  amountDue?: number;
  currency?: string;
  serviceName?: string;
}

export interface TodayPulse {
  cash: number;
  cashBasis: "ledger";
  cashCurrency: string;
  otherCurrencyCash: Array<{ currency: string; amount: number }>;
  owedToYou: number;
  owedCount: number;
  overdueAmount: number;
  overdueCount: number;
  youOwe: number;
  youOweCount: number;
  monthRevenue: number;
  monthExpenses: number;
  monthProfit: number;
  safeToSpend: number;
  currency: string;
}

export interface TodaySetupStep {
  key: "catalog" | "hours" | "payments" | "share_link";
  label: string;
  done: boolean;
  href: string;
}

export interface TodayAggregate {
  businessId: string;
  generatedAt: string;
  timezone: string;
  needsYou: { items: TodayNeedsYouItem[]; totalCount: number; hasMore: boolean };
  today: {
    bookings: TodayBookingItem[];
    invoices: TodayInvoiceItem[];
    acceptedQuotes: TodayAcceptedQuoteItem[];
    tasks: TodayTaskItem[];
    orders: TodayOrderItem[];
    reminders: TodayReminderItem[];
    counts: Record<"bookings" | "invoices" | "acceptedQuotes" | "tasks" | "orders" | "reminders" | "total", number>;
  };
  pulseStatus: "OK" | "RESTRICTED";
  pulse: TodayPulse | null;
  getSetUp: { complete: boolean; steps: TodaySetupStep[] };
}

export function fetchToday(businessId: string) {
  return apiGet<TodayAggregate>(`/business-command-center/businesses/${encodeURIComponent(businessId)}/today`);
}

/**
 * A Needs you action the server named with its own endpoint (Confirm, Not yet, Convert, Approve, Reject, Run).
 * Only a relative API path is sent: an endpoint that is not one is refused here, never fetched.
 */
export function postTodayAction(endpoint: string) {
  if (!/^\/[A-Za-z0-9/_\-.~%]+$/.test(endpoint) || endpoint.includes("..") || endpoint.startsWith("//")) {
    return Promise.resolve({ data: null, error: "This action cannot be sent from here.", status: undefined });
  }
  return apiPostSimple<unknown>(endpoint, {});
}

/** A staff approval request's Approve or Reject (approval.controller.ts), decided from Today. */
export function decideApprovalRequest(businessId: string, approvalId: string, decision: "approve" | "reject") {
  return apiPostSimple<unknown>(
    `/businesses/${encodeURIComponent(businessId)}/approvals/${encodeURIComponent(approvalId)}/${decision}`,
    { decision },
  );
}

/**
 * Whether KEY is switched off for this deployment (KEY_DISABLED): GET /identity/me carries keyDisabled
 * (SWP-KEY-SHELL-SMOKE). null when it could not be read.
 */
export async function fetchKeyDisabled(): Promise<boolean | null> {
  const { data } = await apiGet<{ keyDisabled?: boolean }>("/identity/me");
  if (!data || typeof data.keyDisabled !== "boolean") return null;
  return data.keyDisabled;
}
