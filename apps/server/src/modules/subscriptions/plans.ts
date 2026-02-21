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
};

export const AI_OVERAGE_RATE_TTD = 2.50;
export const AI_OVERAGE_RATE_USD = 0.35;

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
    },
  },
};

export const TRIAL_DURATION_DAYS = 1;
