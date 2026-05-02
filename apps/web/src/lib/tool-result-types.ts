/**
 * Loosely-typed shapes for AI tool result payloads rendered by the
 * commerce / crm / store / marketing / bookings tool result components.
 *
 * The backend AI tool layer returns a union of shapes keyed by tool id; the
 * exact JSON contract is still in flux. Until a shared schema package is
 * generated, the renderers depend on optional structural fields rather than
 * `any`. Each interface below mirrors only the fields the UI actually
 * accesses (e.g. `data.healthScore`, `data.trends.map(...)`) so that adding
 * a new field on the backend stays additive.
 *
 * This file replaces the previous tech-debt `any` placeholders tracked under
 * task #278.
 */

export interface ToolResultLabel {
  label?: string;
  detail?: string;
  description?: string;
  title?: string;
}

export interface TrendItem {
  label?: string;
  detail?: string;
  direction?: string; // up | down | stable
}

export interface TopClientItem {
  name?: string;
  revenue?: number | string;
  invoiceCount?: number;
}

export interface RecommendationItem {
  title?: string;
  description?: string;
  priority?: string;
  estimatedImpact?: string;
}

export interface RiskItem {
  description?: string;
  severity?: string;
  mitigation?: string;
}

export interface CollectionPriorityItem {
  contactName?: string;
  invoiceRef?: string;
  daysPastDue?: number;
  amount?: number | string;
  suggestedAction?: string;
}

export interface OpportunityItem {
  description?: string;
  estimatedValue?: number | string;
  timeframe?: string;
}

export interface ForecastPeriod {
  conservative?: number | string;
  expected?: number | string;
  optimistic?: number | string;
}

export interface ForecastObject {
  thirtyDay?: ForecastPeriod;
  sixtyDay?: ForecastPeriod;
  ninetyDay?: ForecastPeriod;
}

export interface AlternativeMessageItem {
  tone?: string;
  message?: string;
}

export interface PriceFactorItem {
  factor?: string;
  detail?: string;
  impact?: string; // positive | negative | neutral
}

export interface PricingStrategyItem {
  name?: string;
  description?: string;
  expectedImpact?: string;
}

export interface PriceRange {
  min?: number | string;
  max?: number | string;
}

export interface TopProductItem {
  name?: string;
  count?: number;
  revenue?: number | string;
}

export interface RevenueByMonthItem {
  month?: string;
  revenue?: number | string;
  invoiceCount?: number;
}

export interface IssueItem {
  productName?: string;
  severity?: string;
  issue?: string;
  suggestion?: string;
  completeness?: number;
  field?: string;
  contactName?: string;
}

export interface IssueCount {
  high?: number;
  medium?: number;
  low?: number;
}

export interface RecentInvoiceItem {
  invoiceNumber?: string;
  total?: number | string;
  status?: string;
}

export interface RecentQuoteItem {
  quoteNumber?: string;
  total?: number | string;
  status?: string;
  contactName?: string;
}

export interface InvoiceSummaryStats {
  total?: number;
  paid?: number;
  overdue?: number;
  pending?: number;
}

export interface QuoteSummaryStats {
  total?: number;
  draft?: number;
  sent?: number;
  accepted?: number;
  rejected?: number;
  expired?: number;
  conversionRate?: number;
}

export interface QuoteValuesStats {
  totalWonValue?: number | string;
  pipelineValue?: number | string;
  avgAcceptedValue?: number | string;
  avgRejectedValue?: number | string;
}

export interface AtRiskContactItem {
  name?: string;
  contactName?: string;
  reason?: string;
  riskLevel?: string;
  daysSinceContact?: number;
  lifetimeValue?: number | string;
  suggestion?: string;
}

export interface FieldBreakdownItem {
  field?: string;
  completeness?: number;
}

export interface DuplicateClusterItem {
  similarity?: number;
  reason?: string;
  contacts?: Array<{ name?: string; email?: string; phone?: string }>;
}

export interface ReengagementSuggestionItem {
  name?: string;
  contactName?: string;
  reason?: string;
  daysSinceContact?: number;
  suggestedMessage?: string;
  channel?: string;
}

export interface RevenueOpportunityItem {
  description?: string;
  estimatedValue?: number | string;
  contactName?: string;
  type?: string;
  reasoning?: string;
}

export interface FollowUpMessageItem {
  channel?: string;
  tone?: string;
  message?: string;
  subject?: string;
}

export interface SuggestedTagItem {
  tag?: string;
  reason?: string;
  confidence?: number;
}

export interface SuggestedActionItem {
  action?: string;
  description?: string;
  priority?: string;
  reasoning?: string;
}

/**
 * Permissive base for AI tool result data. Each renderer narrows it via the
 * specific interfaces above and accepts a superset structure shaped by the
 * backend.
 */
export interface AiToolResultData {
  summary?: string | { activeProducts?: number; totalProducts?: number; total?: number; draft?: number; sent?: number; accepted?: number; rejected?: number; expired?: number };
  healthScore?: number;
  healthLabel?: string;
  reliabilityScore?: number;
  reliabilityLabel?: string;
  contactName?: string;
  trends?: TrendItem[];
  topClients?: TopClientItem[];
  recommendations?: RecommendationItem[];
  forecast?: ForecastObject;
  risks?: RiskItem[];
  collectionPriority?: CollectionPriorityItem[];
  opportunities?: (OpportunityItem | RevenueOpportunityItem)[];
  tone?: string;
  subject?: string;
  message?: string;
  suggestedFollowUpDate?: string;
  alternativeMessages?: AlternativeMessageItem[];
  currentPrice?: number;
  suggestedPrice?: number;
  priceRange?: PriceRange;
  reasoning?: string;
  competitivePosition?: string;
  factors?: PriceFactorItem[] | FieldBreakdownItem[];
  strategies?: PricingStrategyItem[];
  quoteConversionRate?: number;
  averageInvoiceValue?: number;
  invoiceCount?: number;
  quoteCount?: number;
  totalRevenue?: number;
  outstandingAmount?: number;
  outstandingBalance?: number;
  quoteStatusBreakdown?: Record<string, number>;
  topProducts?: TopProductItem[];
  revenueByMonth?: RevenueByMonthItem[];
  rejectionRate?: number;
  conversionRate?: number;
  invoiceSummary?: InvoiceSummaryStats;
  quoteSummary?: QuoteSummaryStats;
  values?: QuoteValuesStats;
  recentInvoices?: RecentInvoiceItem[];
  recentQuotes?: RecentQuoteItem[];
  paymentDelayLabel?: string;
  avgPaymentDelay?: number;
  lifetimeValue?: number | string;
  avgMonthlyRevenue?: number;
  monthsActive?: number;
  overdueAmount?: number;
  issueCount?: IssueCount;
  issues?: IssueItem[];
  topIssues?: IssueItem[];
  averageCompleteness?: number;
  fieldBreakdown?: FieldBreakdownItem[];
  duplicateClusters?: DuplicateClusterItem[];
  atRiskContacts?: AtRiskContactItem[];
  suggestions?: ReengagementSuggestionItem[];
  messages?: FollowUpMessageItem[];
  suggestedTags?: SuggestedTagItem[];
  suggestedActions?: SuggestedActionItem[];
  sentiment?: string;
  label?: string;
  // Pricing/store-specific
  frictionPoints?: Array<{ stage?: string; description?: string; severity?: string; suggestion?: string }>;
  // Generic pass-through
  [key: string]: unknown;
}

/**
 * Generic key/value bag for nl-search style results that come back as a
 * heterogeneous array of records keyed by a `type` discriminator.
 */
export type SearchResultRecord = Record<string, unknown> & {
  id?: string;
  name?: string;
  title?: string;
  total?: number | string;
  amount?: number | string;
  status?: string;
  date?: string;
  type?: string;
};
