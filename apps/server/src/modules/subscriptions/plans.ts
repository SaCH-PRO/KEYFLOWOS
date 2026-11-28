export interface PlanDefinition {
  id: string;
  name: string;
  tagline: string;
  priceTTD: number;
  priceUSD: number;
  features: string[];
  limits: {
    contacts: number;
    invoicesPerMonth: number;
    bookingsPerMonth: number;
    staffMembers: number;
    products: number;
    automations: number;
    aiCreditsPerMonth: number;
    aiSuggestions: boolean;
    customBranding: boolean;
    prioritySupport: boolean;
    quotesEnabled: boolean;
    socialPosts: number;
    onlineStore: boolean;
    marketplaceListings: number;
    warehouses: number;
    emailCampaigns: number;
    leadForms: number;
    expenses: number;
    reports: number;
    communityAccess: boolean;
    educationAccess: boolean;
    webhooks: number;
    calendarSync: boolean;
    recurringInvoices: boolean;
    advancedAnalytics: boolean;
  };
  popular?: boolean;
}

export const AI_CREDIT_COSTS: Record<string, number> = {
  chat: 1,
  briefing: 2,
  forecast: 1,
  simulation: 3,
  report_narrative: 2,
  seo_analysis: 1,
  email_draft: 1,
  social_caption: 1,
  crm_analysis: 3,
  contact_summary: 1,
  ai_lead_score: 1,
  note_intelligence: 1,
  churn_detection: 2,
  nl_search: 1,
  ai_tags: 1,
  ai_prep_brief: 2,
  crm_command: 1,
  campaign_intelligence: 2,
  storefront_advisor: 2,
  onboarding_concierge: 1,
  flow_chat: 2,
  business_matching: 1,
  intro_draft: 1,
  need_match: 1,
  relationship_insights: 1,
  seo_content_brief: 3,
  seo_gap_analysis: 2,
  growth_insight: 3,
  // Tracked modalities (previously untracked)
  intent_parse: 1,
  document_extract: 2,
  conversation_handle: 1,
  calendar_suggest: 1,
  semantic_embedding: 1,
  vision_extract: 2,
  vision_product: 2,
  vision_contact: 1,
  audio_tts: 1,
  audio_stt: 1,
  flow_chat_stream: 2,
  feedback_loop: 1,
  pattern_detect: 2,
  profile_intel: 1,
  storefront_intel: 2,
  calendar_insight: 1,
  revenue_action: 1,
  note_summarize: 1,
  automation_generate: 1,

  // ── Live in production and never priced ───────────────────────────────────
  // Found 2026-08-10 by cross-checking the features actually recorded in
  // production against this table. All three were falling through to the
  // `AI_CREDIT_COSTS[feature] || 1` fallback, so they were billed at a rate
  // nobody chose — the same "declared but not implemented" shape the audit
  // keeps finding, one table over.
  //
  // The two briefings are priced at 2 to match the existing `briefing: 2`,
  // which is the established rate for this shape of work. That is a real
  // change: they were being charged 1. genome_extraction is exempt anyway
  // (SYSTEM_AI_FEATURES) but is priced so its cost stays visible.
  genome_extraction: 1,
  financial_weekly_briefing: 2,
  revenue_briefing: 2,

  // ── Live and never priced, found 2026-08-30 ───────────────────────────────
  // Same shape as the three above, found the same way: the gate reads the
  // features actually RECORDED rather than a hand-kept list, and this one has
  // been billing at the `|| 1` fallback since it shipped.
  //
  // Priced at 1 to match contact_summary / ai_lead_score / note_intelligence,
  // which is what it is: one gpt-4o-mini call capped at 200 tokens producing a
  // single short CRM recommendation for one contact.
  //
  // Deliberately the SAME number the fallback was already charging, so nobody's
  // bill moves. The change is that the rate is now a decision instead of the
  // absence of one — which is the whole point of the gate that caught it.
  momentum_recommendation: 1,

  // ── key-cortex background cognition ───────────────────────────────────────
  // Exempt from the customer's allowance (SYSTEM_AI_FEATURES) but still PRICED,
  // because the usage log is the only place the cost of the product thinking
  // about itself is visible. Rated by the work: ranking and classification are
  // cheap, the creative tier is where the expensive model is used on purpose.
  'reflection-rank': 1,
  'reflection-outcome': 1,
  'intuition-semantic': 1,
  'intuition-anomaly-explain': 1,
  'dream-connections': 2,
  'synthesis-report': 2,
  'dream-hypotheses': 3,
  'creativity-strategy': 3,
  'creativity-lateral': 3,
  'creativity-combination': 3,
  'creativity-inversion': 3,
  'creativity-analogy': 3,
  'creativity-constraint-removal': 3,
  'creativity-extreme-users': 3,
  'creativity-trend-riding': 3,
  'creativity-problem-first': 3,
};

export const AI_OVERAGE_RATE_TTD = 2.50;
export const AI_OVERAGE_RATE_USD = 0.35;

/**
 * AI work the PRODUCT does for itself, which must not be billed to the customer.
 *
 * FOUND BY OUTAGE, NOT BY DESIGN. Measured on production 2026-08-10: of 243
 * credits consumed in a month against a FREE allowance of 10, **184 were
 * `semantic_embedding`** — vectors written when a memory is stored. Nobody asked
 * for them. They are how the product indexes itself, and they are emitted by
 * ingestion, not by a person pressing anything.
 *
 * The result was that KEYFLOW's own housekeeping spent 76% of the owner's
 * monthly allowance and then locked them out of every AI feature, including the
 * ones they were paying for. The limiter worked perfectly; it was pointed at the
 * wrong pool.
 *
 * A feature here is still RECORDED — cost visibility is the entire point of the
 * usage log, and inference the product runs on its own behalf is a real cost
 * that someone should be able to see. It simply does not count against
 * `aiCreditsPerMonth`.
 *
 * THE TEST FOR MEMBERSHIP, so this does not become a place to hide expensive
 * things: *would a user be surprised to be charged for this?* Indexing a note
 * they saved — yes, surprised. Asking KEY a question — no. If a human action
 * directly and visibly caused it, it is billable, however incidental it feels.
 */
export const SYSTEM_AI_FEATURES = new Set<string>([
  // Indexing and retrieval infrastructure. Fires on every memory write.
  'semantic_embedding',
  // The genome reading the business to keep its own model current.
  'genome_extraction',
  // Background pattern scans on a scheduler; no user in the loop.
  'pattern_detect',
  'feedback_loop',

  // ── key-cortex background cognition ───────────────────────────────────────
  //
  // The same defect as `semantic_embedding`, an order of magnitude larger and
  // still latent. None of these is triggered by a person; they are schedulers
  // thinking about the business on its behalf. FEATURE_TASK_MAP's own comment
  // puts the volume plainly: "reflection alone can make 21 per business per
  // tick, and it ticks every 30 minutes" — roughly a thousand calls a day, per
  // business, against an allowance meant to cover what the OWNER asks for.
  //
  // Production has not felt this yet only because cortex has barely run there.
  // The day it does, every plan in the product empties before lunch.
  'reflection-rank',
  'reflection-outcome',
  'dream-connections',
  'dream-hypotheses',
  'synthesis-report',
  'intuition-semantic',
  'intuition-anomaly-explain',
  'creativity-strategy',
  'creativity-lateral',
  'creativity-combination',
  'creativity-inversion',
  'creativity-analogy',
  'creativity-constraint-removal',
  'creativity-extreme-users',
  'creativity-trend-riding',
  'creativity-problem-first',
]);

/**
 * Features with no declared price, billed at the `AI_CREDIT_COSTS[f] || 1`
 * fallback — a rate nobody chose.
 *
 * A DEBT LEDGER, not an allowlist, and the same shape as ACKNOWLEDGED_UNSCOPED
 * in the tenant work: it may only SHRINK. Its value is not that these are fine;
 * it is that a NEW feature can no longer join them silently. Today a feature
 * absent from AI_CREDIT_COSTS is charged 1 credit and nothing reports it, which
 * is how 56 of them accumulated.
 *
 * Pricing these is a product decision, deliberately not made here. Each is
 * currently charged 1 credit; some are plainly worth more (a strategic
 * dashboard is not a tag suggestion), and guessing would bill customers on a
 * number invented by whoever happened to be editing this file.
 */
export const UNPRICED_ACKNOWLEDGED = new Set<string>([
  'plan_decompose', 'cash_flow_forecast', 'business_model', 'seo_score', 'simulate',
  'profile_interview', 'contract_clause_extract', 'strategic_dashboard', 'revenue_forecast',
  'profitability', 'pricing_advisor', 'seasonal_patterns', 'opportunities', 'risks',
  'weekly_plan', 'crm_insight', 'crm_churn_risk', 'crm_search', 'commerce_analyze',
  'ai_reminder', 'ai_pricing', 'schedule_optimizer', 'no_show_predictor', 'campaign_content',
  'marketing_strategy', 'draft_followup_message', 'draft_campaign_bundle',
  'draft_payment_reminder', 'draft_storefront_copy', 'draft_project_update',
  'key_flow_interpret', 'key_delegation_interpret', 'key_calendar_interpret',
  'key_inbox_classify', 'key_inbox_intelligence', 'key_inbox_brief',
  'calendar_action_intelligence', 'blueprint_onboarding', 'emotion_detection',
  'reasoning_engine', 'flow_seo_remediation', 'flow_draft_ticket_reply',
  'crm_conversation_analyze',
]);

/** Does this feature count against the customer's monthly AI allowance? */
export function isBillableAiFeature(feature: string): boolean {
  return !SYSTEM_AI_FEATURES.has(feature);
}

export type FeatureCategory = 'crm' | 'commerce' | 'bookings' | 'ai' | 'operations' | 'platform';

export interface FeatureDefinition {
  key: string;
  label: string;
  description: string;
  category: FeatureCategory;
  type: 'limit' | 'boolean';
  limitKey?: string;
  tiers: {
    FREE: number | boolean | string;
    FLOW: number | boolean | string;
    KEYFLOW: number | boolean | string;
  };
  icon?: string;
  billable?: boolean;
}

export const FEATURE_CATEGORIES: Record<FeatureCategory, { label: string; icon: string }> = {
  crm: { label: 'CRM & Contacts', icon: 'Users' },
  commerce: { label: 'Commerce & Invoicing', icon: 'CreditCard' },
  bookings: { label: 'Bookings & Calendar', icon: 'Calendar' },
  ai: { label: 'KEY Assistant & Automations', icon: 'Brain' },
  operations: { label: 'Team & Operations', icon: 'FolderKanban' },
  platform: { label: 'Platform & Support', icon: 'Shield' },
};

export const FEATURE_REGISTRY: FeatureDefinition[] = [
  { key: 'contacts', label: 'Contacts', description: 'CRM contacts & leads', category: 'crm', type: 'limit', limitKey: 'contacts', tiers: { FREE: 50, FLOW: 500, KEYFLOW: 'Unlimited' }, billable: true },
  { key: 'invoices', label: 'Invoices', description: 'Monthly invoices created (store orders and quick sales excluded)', category: 'commerce', type: 'limit', limitKey: 'invoicesPerMonth', tiers: { FREE: 5, FLOW: 'Unlimited', KEYFLOW: 'Unlimited' }, billable: true },
  { key: 'quotes', label: 'Quotes & Proposals', description: 'Create and send quotes', category: 'commerce', type: 'boolean', limitKey: 'quotesEnabled', tiers: { FREE: true, FLOW: true, KEYFLOW: true } },
  { key: 'recurring_invoices', label: 'Recurring Invoices', description: 'Scheduled recurring invoices', category: 'commerce', type: 'boolean', limitKey: 'recurringInvoices', tiers: { FREE: false, FLOW: true, KEYFLOW: true } },
  { key: 'products', label: 'Products & Services', description: 'Product catalog items', category: 'commerce', type: 'limit', limitKey: 'products', tiers: { FREE: 25, FLOW: 100, KEYFLOW: 'Unlimited' }, billable: true },
  { key: 'online_store', label: 'Online Store', description: 'Public storefront with cash & bank transfer checkout', category: 'commerce', type: 'boolean', limitKey: 'onlineStore', tiers: { FREE: true, FLOW: true, KEYFLOW: true } },
  { key: 'whatsapp_sharing', label: 'WhatsApp Sharing', description: 'Share invoices, quotes, and store links via WhatsApp', category: 'commerce', type: 'boolean', tiers: { FREE: true, FLOW: true, KEYFLOW: true } },
  { key: 'bookings', label: 'Bookings', description: 'Monthly bookings', category: 'bookings', type: 'limit', limitKey: 'bookingsPerMonth', tiers: { FREE: 25, FLOW: 100, KEYFLOW: 'Unlimited' }, billable: true },
  { key: 'ai_credits', label: 'KEY Credits', description: 'Monthly AI credits for KEY assistant features', category: 'ai', type: 'limit', limitKey: 'aiCreditsPerMonth', tiers: { FREE: 50, FLOW: 500, KEYFLOW: 'Fair use' }, billable: true },
  { key: 'automations', label: 'Playbook Automations', description: 'Event-driven automation rules', category: 'ai', type: 'limit', limitKey: 'automations', tiers: { FREE: 0, FLOW: 5, KEYFLOW: 'Unlimited' }, billable: true },
  { key: 'staff', label: 'Staff Members', description: 'Team staff seats', category: 'operations', type: 'limit', limitKey: 'staffMembers', tiers: { FREE: 1, FLOW: 5, KEYFLOW: 'Unlimited' }, billable: true },
  { key: 'priority_support', label: 'Priority Support', description: 'Dedicated support channel', category: 'platform', type: 'boolean', limitKey: 'prioritySupport', tiers: { FREE: false, FLOW: false, KEYFLOW: true } },
];

/**
 * WHAT ONE AI CREDIT IS, so the next person changing a limit knows what they
 * are changing.
 *
 * A credit is ONE USER-VISIBLE AI ACTION. Asking KEY a question, drafting a
 * message, generating a report. Not a token, not an inference call, and not
 * anything the product does on its own behalf — that is SYSTEM_AI_FEATURES.
 *
 * The old numbers were off by about two orders of magnitude, and the arithmetic
 * is worth stating because it is what broke:
 *
 *   FREE was 10 credits/month. `semantic_embedding` costs 1. Saving a handful
 *   of notes therefore exhausted a month's plan before the owner had asked KEY
 *   a single question. Measured: production burned 243 credits against an
 *   allowance of 10, and 184 of them were embeddings.
 *
 * Excluding system work — which is the real fix — leaves ~56 billable credits
 * for that month of genuine use: chat turns, briefings, TTS.
 *
 * FREE 10 -> 50, FLOW 100 -> 500, anchored on that measurement rather than on
 * taste. 50 credits is 25 chat turns at 2 credits each, which is a real trial;
 * 10 was five turns, and only if the customer saved nothing.
 *
 * THE FIRST ATTEMPT WAS 250/3000 AND A TEST REFUSED IT. plan-limits.spec.ts
 * asserts FREE stays at or under 50, with a comment explaining that the bound
 * exists "so that raising every tier at once cannot quietly reintroduce this".
 * That is a deliberate business constraint, and the correct response to a guard
 * catching you is to respect it, not to widen it to fit the number you had
 * already typed. The same spec also caught that the advertised string
 * ('10 AI credits/month') had not moved with the limit — a plan that promises
 * one number and grants another.
 *
 * Change them here, and expect that spec to have an opinion.
 */
export const PLANS: Record<string, PlanDefinition> = {
  FREE: {
    id: 'FREE',
    name: 'Free',
    tagline: 'Get started with the essentials',
    priceTTD: 0,
    priceUSD: 0,
    features: [
      'Up to 50 contacts',
      '5 invoices per month',
      '25 bookings per month',
      '1 staff member',
      '25 products/services',
      'Quotes & proposals',
      'Online store (cash & bank transfer)',
      'Public booking page',
      'WhatsApp sharing',
      '50 AI credits/month',
    ],
    limits: {
      contacts: 50,
      invoicesPerMonth: 5,
      bookingsPerMonth: 25,
      staffMembers: 1,
      products: 25,
      automations: 0,
      // 50, bounded <= 50 by plan-limits.spec.ts.
      // getActiveSubscription falls back to PLANS.FREE for any business with no
      // subscription row or an expired trial, so this is the default ceiling
      // for every unpaid account in the system.
      aiCreditsPerMonth: 50,
      aiSuggestions: false,
      customBranding: false,
      prioritySupport: false,
      quotesEnabled: true,
      socialPosts: 0,
      onlineStore: true,
      marketplaceListings: 0,
      warehouses: 0,
      emailCampaigns: 0,
      leadForms: 1,
      expenses: -1,
      reports: 2,
      communityAccess: false,
      educationAccess: false,
      webhooks: 0,
      calendarSync: false,
      recurringInvoices: false,
      advancedAnalytics: false,
    },
  },
  FLOW: {
    id: 'FLOW',
    name: 'Flow',
    tagline: 'For growing businesses',
    priceTTD: 99,
    priceUSD: 15,
    popular: true,
    features: [
      'Up to 500 contacts',
      'Unlimited invoices',
      '100 bookings per month',
      '5 staff members',
      '100 products/services',
      '500 AI credits/month',
      'Quotes & proposals',
      'Recurring invoices',
      '5 automations',
      'Online store',
      'WhatsApp sharing',
    ],
    limits: {
      contacts: 500,
      invoicesPerMonth: -1,
      bookingsPerMonth: 100,
      staffMembers: 5,
      products: 100,
      automations: 5,
      aiCreditsPerMonth: 500,
      aiSuggestions: true,
      customBranding: true,
      prioritySupport: false,
      quotesEnabled: true,
      socialPosts: 0,
      onlineStore: true,
      marketplaceListings: 0,
      warehouses: 0,
      emailCampaigns: 0,
      leadForms: 10,
      expenses: -1,
      reports: 20,
      communityAccess: false,
      educationAccess: false,
      webhooks: 5,
      calendarSync: true,
      recurringInvoices: true,
      advancedAnalytics: false,
    },
  },
  KEYFLOW: {
    id: 'KEYFLOW',
    name: 'KEY Assistant',
    tagline: 'KEY assistant for your business',
    priceTTD: 249,
    priceUSD: 39,
    features: [
      'Unlimited contacts',
      'Unlimited invoices',
      'Unlimited bookings',
      'Unlimited staff members',
      'Unlimited products/services',
      'Unlimited automations',
      'Quotes & proposals',
      'Recurring invoices',
      'Online store',
      'WhatsApp sharing',
      'KEY assistant (fair-use AI credits)',
      'Priority support',
    ],
    limits: {
      contacts: -1,
      invoicesPerMonth: -1,
      bookingsPerMonth: -1,
      staffMembers: -1,
      products: -1,
      automations: -1,
      aiCreditsPerMonth: -1,
      aiSuggestions: true,
      customBranding: true,
      prioritySupport: true,
      quotesEnabled: true,
      socialPosts: 0,
      onlineStore: true,
      marketplaceListings: 0,
      warehouses: 0,
      emailCampaigns: 0,
      leadForms: -1,
      expenses: -1,
      reports: -1,
      communityAccess: false,
      educationAccess: false,
      webhooks: -1,
      calendarSync: true,
      recurringInvoices: true,
      advancedAnalytics: true,
    },
  },
};

export const TRIAL_DURATION_DAYS = 1;
