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
};

export const AI_OVERAGE_RATE_TTD = 2.50;
export const AI_OVERAGE_RATE_USD = 0.35;

export type FeatureCategory = 'crm' | 'commerce' | 'marketplace' | 'bookings' | 'marketing' | 'ai' | 'operations' | 'analytics' | 'platform';

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
  marketplace: { label: 'Global Marketplace', icon: 'Globe' },
  bookings: { label: 'Bookings & Calendar', icon: 'Calendar' },
  marketing: { label: 'Marketing & Social', icon: 'Megaphone' },
  ai: { label: 'AI & Automation', icon: 'Brain' },
  operations: { label: 'Operations & Projects', icon: 'FolderKanban' },
  analytics: { label: 'Analytics & Reports', icon: 'BarChart3' },
  platform: { label: 'Platform & Support', icon: 'Shield' },
};

export const FEATURE_REGISTRY: FeatureDefinition[] = [
  { key: 'contacts', label: 'Contacts', description: 'CRM contacts & leads', category: 'crm', type: 'limit', limitKey: 'contacts', tiers: { FREE: 50, FLOW: 500, KEYFLOW: 'Unlimited' }, billable: true },
  { key: 'lead_forms', label: 'Lead Capture Forms', description: 'Custom lead capture forms', category: 'crm', type: 'limit', limitKey: 'leadForms', tiers: { FREE: 1, FLOW: 10, KEYFLOW: 'Unlimited' }, billable: true },
  { key: 'invoices', label: 'Invoices', description: 'Monthly invoices created', category: 'commerce', type: 'limit', limitKey: 'invoicesPerMonth', tiers: { FREE: 5, FLOW: 'Unlimited', KEYFLOW: 'Unlimited' }, billable: true },
  { key: 'quotes', label: 'Quotes & Proposals', description: 'Create and send quotes', category: 'commerce', type: 'boolean', limitKey: 'quotesEnabled', tiers: { FREE: false, FLOW: true, KEYFLOW: true } },
  { key: 'recurring_invoices', label: 'Recurring Invoices', description: 'Auto-generating scheduled invoices', category: 'commerce', type: 'boolean', limitKey: 'recurringInvoices', tiers: { FREE: false, FLOW: true, KEYFLOW: true } },
  { key: 'products', label: 'Products & Services', description: 'Product catalog items', category: 'commerce', type: 'limit', limitKey: 'products', tiers: { FREE: 10, FLOW: 100, KEYFLOW: 'Unlimited' }, billable: true },
  { key: 'online_store', label: 'Online Store', description: 'Public storefront', category: 'commerce', type: 'boolean', limitKey: 'onlineStore', tiers: { FREE: false, FLOW: true, KEYFLOW: true } },
  { key: 'marketplace_listings', label: 'Marketplace Listings', description: 'Global commerce listings', category: 'marketplace', type: 'limit', limitKey: 'marketplaceListings', tiers: { FREE: 0, FLOW: 20, KEYFLOW: 'Unlimited' }, billable: true },
  { key: 'warehouses', label: 'Warehouses', description: 'Inventory warehouses', category: 'marketplace', type: 'limit', limitKey: 'warehouses', tiers: { FREE: 0, FLOW: 3, KEYFLOW: 'Unlimited' }, billable: true },
  { key: 'bookings', label: 'Bookings', description: 'Monthly bookings', category: 'bookings', type: 'limit', limitKey: 'bookingsPerMonth', tiers: { FREE: 10, FLOW: 100, KEYFLOW: 'Unlimited' }, billable: true },
  { key: 'calendar_sync', label: 'Google Calendar Sync', description: 'Sync with Google Calendar', category: 'bookings', type: 'boolean', limitKey: 'calendarSync', tiers: { FREE: false, FLOW: true, KEYFLOW: true } },
  { key: 'social_posts', label: 'Social Posts', description: 'Monthly social media posts', category: 'marketing', type: 'limit', limitKey: 'socialPosts', tiers: { FREE: 0, FLOW: 20, KEYFLOW: 'Unlimited' }, billable: true },
  { key: 'email_campaigns', label: 'Email Campaigns', description: 'Monthly email campaigns', category: 'marketing', type: 'limit', limitKey: 'emailCampaigns', tiers: { FREE: 0, FLOW: 10, KEYFLOW: 'Unlimited' }, billable: true },
  { key: 'ai_credits', label: 'AI Credits', description: 'Monthly AI credits for all AI features', category: 'ai', type: 'limit', limitKey: 'aiCreditsPerMonth', tiers: { FREE: 10, FLOW: 100, KEYFLOW: 'Unlimited' }, billable: true },
  { key: 'ai_suggestions', label: 'AI Business Advisor', description: 'AI-powered insights & suggestions', category: 'ai', type: 'boolean', limitKey: 'aiSuggestions', tiers: { FREE: false, FLOW: true, KEYFLOW: true } },
  { key: 'automations', label: 'Playbook Automations', description: 'Event-driven automation rules', category: 'ai', type: 'limit', limitKey: 'automations', tiers: { FREE: 0, FLOW: 5, KEYFLOW: 'Unlimited' }, billable: true },
  { key: 'staff', label: 'Staff Members', description: 'Team members & roles', category: 'operations', type: 'limit', limitKey: 'staffMembers', tiers: { FREE: 1, FLOW: 5, KEYFLOW: 'Unlimited' }, billable: true },
  { key: 'expenses', label: 'Expense Tracking', description: 'Monthly tracked expenses', category: 'operations', type: 'limit', limitKey: 'expenses', tiers: { FREE: 10, FLOW: 'Unlimited', KEYFLOW: 'Unlimited' }, billable: true },
  { key: 'webhooks', label: 'Webhooks', description: 'Custom webhook integrations', category: 'operations', type: 'limit', limitKey: 'webhooks', tiers: { FREE: 0, FLOW: 5, KEYFLOW: 'Unlimited' }, billable: true },
  { key: 'reports', label: 'Business Reports', description: 'AI-generated reports (uses AI credits)', category: 'analytics', type: 'limit', limitKey: 'reports', tiers: { FREE: 2, FLOW: 20, KEYFLOW: 'Unlimited' }, billable: true },
  { key: 'advanced_analytics', label: 'Advanced Analytics', description: 'Deep business intelligence & trends', category: 'analytics', type: 'boolean', limitKey: 'advancedAnalytics', tiers: { FREE: false, FLOW: false, KEYFLOW: true } },
  { key: 'custom_branding', label: 'Custom Branding', description: 'Custom logo, colors & domain', category: 'platform', type: 'boolean', limitKey: 'customBranding', tiers: { FREE: false, FLOW: true, KEYFLOW: true } },
  { key: 'priority_support', label: 'Priority Support', description: 'Dedicated support channel', category: 'platform', type: 'boolean', limitKey: 'prioritySupport', tiers: { FREE: false, FLOW: false, KEYFLOW: true } },
  { key: 'community', label: 'Community Hub', description: 'Founder community access', category: 'platform', type: 'boolean', limitKey: 'communityAccess', tiers: { FREE: true, FLOW: true, KEYFLOW: true } },
  { key: 'education', label: 'MasterClass Courses', description: 'Education & certification', category: 'platform', type: 'boolean', limitKey: 'educationAccess', tiers: { FREE: true, FLOW: true, KEYFLOW: true } },
];

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
      '10 bookings per month',
      '1 staff member',
      '10 products/services',
      '10 AI credits/month',
      'Basic CRM',
      'Public booking page',
    ],
    limits: {
      contacts: 50,
      invoicesPerMonth: 5,
      bookingsPerMonth: 10,
      staffMembers: 1,
      products: 10,
      automations: 0,
      aiCreditsPerMonth: 10,
      aiSuggestions: false,
      customBranding: false,
      prioritySupport: false,
      quotesEnabled: false,
      socialPosts: 0,
      onlineStore: false,
      marketplaceListings: 0,
      warehouses: 0,
      emailCampaigns: 0,
      leadForms: 1,
      expenses: 10,
      reports: 2,
      communityAccess: true,
      educationAccess: true,
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
      '100 AI credits/month',
      'AI business advisor',
      'Quotes & proposals',
      '5 automations',
      'Online store',
      '20 social posts/month',
      'Custom branding',
      '20 marketplace listings',
      '10 email campaigns/month',
    ],
    limits: {
      contacts: 500,
      invoicesPerMonth: -1,
      bookingsPerMonth: 100,
      staffMembers: 5,
      products: 100,
      automations: 5,
      aiCreditsPerMonth: 100,
      aiSuggestions: true,
      customBranding: true,
      prioritySupport: false,
      quotesEnabled: true,
      socialPosts: 20,
      onlineStore: true,
      marketplaceListings: 20,
      warehouses: 3,
      emailCampaigns: 10,
      leadForms: 10,
      expenses: -1,
      reports: 20,
      communityAccess: true,
      educationAccess: true,
      webhooks: 5,
      calendarSync: true,
      recurringInvoices: true,
      advancedAnalytics: false,
    },
  },
  KEYFLOW: {
    id: 'KEYFLOW',
    name: 'KeyFlow',
    tagline: 'Full autopilot for your business',
    priceTTD: 249,
    priceUSD: 39,
    features: [
      'Unlimited contacts',
      'Unlimited invoices',
      'Unlimited bookings',
      'Unlimited staff',
      'Unlimited products/services',
      'Unlimited AI credits',
      'AI Autopilot & all AI features',
      'Online store',
      'Unlimited social posts',
      'Custom branding',
      'Priority support',
      'Advanced analytics',
      'Unlimited marketplace',
      'Unlimited email campaigns',
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
      socialPosts: -1,
      onlineStore: true,
      marketplaceListings: -1,
      warehouses: -1,
      emailCampaigns: -1,
      leadForms: -1,
      expenses: -1,
      reports: -1,
      communityAccess: true,
      educationAccess: true,
      webhooks: -1,
      calendarSync: true,
      recurringInvoices: true,
      advancedAnalytics: true,
    },
  },
};

export const TRIAL_DURATION_DAYS = 1;
