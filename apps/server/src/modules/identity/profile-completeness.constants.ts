export interface ProfileCompletenessField {
  key: string;
  label: string;
  description: string;
}

export const PROFILE_COMPLETENESS_FIELDS: ProfileCompletenessField[] = [
  { key: 'name', label: 'Business Name', description: 'Your business name is required.' },
  { key: 'logoUrl', label: 'Logo', description: 'Upload a logo to represent your business.' },
  { key: 'headline', label: 'Headline', description: 'A short professional headline for your business.' },
  { key: 'bio', label: 'Bio', description: 'A brief bio introducing your business to the community.' },
  { key: 'industry', label: 'Industry', description: 'The industry your business operates in.' },
  { key: 'skills', label: 'Skills', description: 'Skills and expertise your business offers.' },
  { key: 'businessStage', label: 'Business Stage', description: 'The current stage of your business.' },
  { key: 'location', label: 'Location', description: 'Your city or country.' },
  { key: 'interests', label: 'Interests', description: 'Topics and areas your business is interested in.' },
  { key: 'taglineOrDescription', label: 'Tagline or Description', description: 'A tagline or description of your business.' },
  { key: 'positioningStatement', label: 'Positioning Statement', description: 'A statement explaining your unique value and what sets you apart.' },
  { key: 'currentCapacity', label: 'Availability Status', description: 'Whether you are currently accepting new work and your capacity level.' },
  { key: 'preferredProjectTypes', label: 'Preferred Project Types', description: 'The types of projects or work you prefer to take on.' },
];

export function computeProfileCompleteness(biz: {
  name?: string | null;
  logoUrl?: string | null;
  headline?: string | null;
  bio?: string | null;
  industry?: string | null;
  skills?: string[] | null;
  businessStage?: string | null;
  city?: string | null;
  country?: string | null;
  interests?: string[] | null;
  tagline?: string | null;
  description?: string | null;
  positioningStatement?: string | null;
  currentCapacity?: string | null;
  preferredProjectTypes?: string[] | null;
}): number {
  const checks = [
    !!biz.name,
    !!biz.logoUrl,
    !!biz.headline,
    !!biz.bio,
    !!biz.industry,
    biz.skills != null && biz.skills.length > 0,
    !!biz.businessStage,
    !!biz.city || !!biz.country,
    biz.interests != null && biz.interests.length > 0,
    !!biz.tagline || !!biz.description,
    !!biz.positioningStatement,
    !!biz.currentCapacity,
    biz.preferredProjectTypes != null && biz.preferredProjectTypes.length > 0,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export interface TierDefinition {
  id: string;
  label: string;
  description: string;
  weight: number;
  unlocksCapabilities: string[];
  subProfiles: string[];
  basicFields: string[];
}

export const COMPLETENESS_TIERS: TierDefinition[] = [
  {
    id: 'foundation',
    label: 'Foundation',
    description: 'Basic business identity and presence',
    weight: 25,
    unlocksCapabilities: [
      'Basic document generation',
      'AI business advisor chat',
      'Simple profile recommendations',
    ],
    subProfiles: [],
    basicFields: ['name', 'logoUrl', 'industry', 'businessStage', 'taglineOrDescription', 'location'],
  },
  {
    id: 'market',
    label: 'Market Position',
    description: 'Define your offering, customers, and brand identity',
    weight: 25,
    unlocksCapabilities: [
      'Targeted marketing content generation',
      'Customer persona-aware proposals',
      'Competitive analysis in documents',
      'Brand-consistent copywriting',
    ],
    subProfiles: ['offer', 'customer', 'identity'],
    basicFields: ['headline', 'bio', 'skills', 'positioningStatement', 'currentCapacity', 'preferredProjectTypes'],
  },
  {
    id: 'operations',
    label: 'Operations',
    description: 'Team, processes, technology, and people strategy',
    weight: 20,
    unlocksCapabilities: [
      'Operations-aware SOPs and policies',
      'HR document generation (handbooks, job descriptions)',
      'Technology-informed recommendations',
      'Staffing and capacity planning insights',
    ],
    subProfiles: ['operations', 'people', 'technology'],
    basicFields: ['interests'],
  },
  {
    id: 'financial',
    label: 'Financial Reality',
    description: 'Revenue streams, costs, and financial health',
    weight: 15,
    unlocksCapabilities: [
      'Accurate cash flow forecasts',
      'Revenue-aware financial documents',
      'Budget and pricing recommendations',
      'Investor-ready financial summaries',
    ],
    subProfiles: ['revenue', 'finance'],
    basicFields: [],
  },
  {
    id: 'strategy',
    label: 'Strategy',
    description: 'Growth plans, sales approach, partnerships, and IP protection',
    weight: 15,
    unlocksCapabilities: [
      'Strategic growth recommendations',
      'Sales-optimized CRM intelligence',
      'Partnership and supplier analysis',
      'IP-aware legal documents',
      'Full business intelligence in all AI features',
    ],
    subProfiles: ['growth', 'goals', 'sales', 'marketingStrategy', 'partnerships', 'intellectualProperty', 'compliance', 'founder'],
    basicFields: [],
  },
];

interface SubProfileData {
  [key: string]: unknown;
}

function countSubProfileFields(profile: SubProfileData | null | undefined): { filled: number; total: number } {
  if (!profile) return { filled: 0, total: 0 };
  const skip = new Set(['id', 'guidanceProfileId', 'createdAt', 'updatedAt', 'notes']);
  let filled = 0;
  let total = 0;
  for (const [key, value] of Object.entries(profile)) {
    if (skip.has(key)) continue;
    total++;
    if (value != null && value !== '' && value !== false) {
      if (Array.isArray(value)) {
        if (value.length > 0) filled++;
      } else {
        filled++;
      }
    }
  }
  return { filled, total };
}

export interface TierScore {
  tierId: string;
  label: string;
  description: string;
  score: number;
  weight: number;
  unlocksCapabilities: string[];
  subProfileScores: Array<{ name: string; filled: number; total: number; score: number }>;
  basicFieldsComplete: number;
  basicFieldsTotal: number;
}

export interface TieredCompletenessResult {
  overallScore: number;
  tiers: TierScore[];
  nextUnlock: { tierId: string; label: string; capabilities: string[]; currentScore: number } | null;
}

export function computeTieredCompleteness(
  biz: {
    name?: string | null;
    logoUrl?: string | null;
    headline?: string | null;
    bio?: string | null;
    industry?: string | null;
    skills?: string[] | null;
    businessStage?: string | null;
    city?: string | null;
    country?: string | null;
    interests?: string[] | null;
    tagline?: string | null;
    description?: string | null;
    positioningStatement?: string | null;
    currentCapacity?: string | null;
    preferredProjectTypes?: string[] | null;
  },
  guidanceSubProfiles: Record<string, SubProfileData | null | undefined>,
): TieredCompletenessResult {
  const fieldChecks: Record<string, boolean> = {
    name: !!biz.name,
    logoUrl: !!biz.logoUrl,
    headline: !!biz.headline,
    bio: !!biz.bio,
    industry: !!biz.industry,
    skills: (biz.skills?.length ?? 0) > 0,
    businessStage: !!biz.businessStage,
    location: !!(biz.city || biz.country),
    interests: (biz.interests?.length ?? 0) > 0,
    taglineOrDescription: !!(biz.tagline || biz.description),
    positioningStatement: !!biz.positioningStatement,
    currentCapacity: !!biz.currentCapacity,
    preferredProjectTypes: (biz.preferredProjectTypes?.length ?? 0) > 0,
  };

  const EXPECTED_FIELD_COUNTS: Record<string, number> = {
    identity: 8, founder: 8, offer: 8, customer: 8,
    revenue: 8, finance: 8, operations: 8, compliance: 8,
    growth: 8, goals: 8, sales: 10, marketingStrategy: 10,
    people: 10, technology: 10, partnerships: 8, intellectualProperty: 8,
  };

  const tiers: TierScore[] = [];
  let weightedTotal = 0;
  let weightedSum = 0;

  for (const tier of COMPLETENESS_TIERS) {
    const basicComplete = tier.basicFields.filter(f => fieldChecks[f]).length;
    const basicTotal = tier.basicFields.length;

    const subScores: TierScore['subProfileScores'] = [];
    for (const spName of tier.subProfiles) {
      const sp = guidanceSubProfiles[spName];
      const { filled, total } = countSubProfileFields(sp);
      const expectedTotal = total > 0 ? total : (EXPECTED_FIELD_COUNTS[spName] || 8);
      subScores.push({
        name: spName,
        filled,
        total: expectedTotal,
        score: expectedTotal > 0 ? Math.round((filled / expectedTotal) * 100) : 0,
      });
    }

    let totalItems = basicTotal;
    let completedItems = basicComplete;

    for (const ss of subScores) {
      totalItems += ss.total;
      completedItems += ss.filled;
    }

    const score = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

    tiers.push({
      tierId: tier.id,
      label: tier.label,
      description: tier.description,
      score,
      weight: tier.weight,
      unlocksCapabilities: tier.unlocksCapabilities,
      subProfileScores: subScores,
      basicFieldsComplete: basicComplete,
      basicFieldsTotal: basicTotal,
    });

    weightedTotal += tier.weight;
    weightedSum += (score / 100) * tier.weight;
  }

  const overallScore = weightedTotal > 0 ? Math.round((weightedSum / weightedTotal) * 100) : 0;

  let nextUnlock: TieredCompletenessResult['nextUnlock'] = null;
  for (const t of tiers) {
    if (t.score < 100) {
      nextUnlock = {
        tierId: t.tierId,
        label: t.label,
        capabilities: t.unlocksCapabilities,
        currentScore: t.score,
      };
      break;
    }
  }

  return { overallScore, tiers, nextUnlock };
}

export interface ProgressivePrompt {
  id: string;
  trigger: string;
  subProfile: string;
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
}

export const PROGRESSIVE_DEEPENING_PROMPTS: ProgressivePrompt[] = [
  {
    id: 'after-first-invoice',
    trigger: 'first_invoice',
    subProfile: 'revenue',
    title: 'Unlock smarter financial insights',
    body: 'You just created your first invoice! Complete your Revenue & Finance profile so the AI can generate accurate cash flow forecasts and financial documents.',
    ctaLabel: 'Complete Revenue Profile',
    ctaHref: '/app/profile?tab=profile&guidance=revenue',
  },
  {
    id: 'after-first-contact',
    trigger: 'first_contact',
    subProfile: 'customer',
    title: 'Sharpen your customer intelligence',
    body: 'Great — you added your first contact! Tell us about your ideal customer so the CRM and marketing AI can work smarter for you.',
    ctaLabel: 'Define Your Customer',
    ctaHref: '/app/profile?tab=profile&guidance=customer',
  },
  {
    id: 'after-first-contact-sales',
    trigger: 'first_contact',
    subProfile: 'sales',
    title: 'Define your sales process',
    body: 'With contacts flowing in, describe your sales approach so the AI can help with lead scoring and follow-up strategies.',
    ctaLabel: 'Set Up Sales Profile',
    ctaHref: '/app/profile?tab=profile&guidance=sales',
  },
  {
    id: 'after-first-campaign',
    trigger: 'first_campaign',
    subProfile: 'marketingStrategy',
    title: 'Power up your marketing AI',
    body: 'You launched a campaign! Share your brand voice and content strategy so future campaigns are even more on-brand.',
    ctaLabel: 'Complete Marketing Strategy',
    ctaHref: '/app/profile?tab=profile&guidance=marketingStrategy',
  },
  {
    id: 'after-first-booking',
    trigger: 'first_booking',
    subProfile: 'operations',
    title: 'Optimize your operations',
    body: 'Your first booking is in! Tell us about your team and processes so the AI can help you scale efficiently.',
    ctaLabel: 'Complete Operations Profile',
    ctaHref: '/app/profile?tab=profile&guidance=operations',
  },
  {
    id: 'after-first-document',
    trigger: 'first_document',
    subProfile: 'compliance',
    title: 'Strengthen your compliance',
    body: 'You generated your first document. Complete your compliance profile for more accurate legal and regulatory content.',
    ctaLabel: 'Complete Compliance Profile',
    ctaHref: '/app/profile?tab=profile&guidance=compliance',
  },
  {
    id: 'after-first-document-ip',
    trigger: 'first_document',
    subProfile: 'intellectualProperty',
    title: 'Protect your intellectual property',
    body: 'Now that you\'re creating business documents, tell us about your IP so we can help protect it.',
    ctaLabel: 'Set Up IP Profile',
    ctaHref: '/app/profile?tab=profile&guidance=intellectualProperty',
  },
  {
    id: 'after-first-expense',
    trigger: 'first_expense',
    subProfile: 'finance',
    title: 'Complete your financial picture',
    body: 'You tracked your first expense. Fill in your financial details so the AI can give you better budgeting and forecasting advice.',
    ctaLabel: 'Complete Finance Profile',
    ctaHref: '/app/profile?tab=profile&guidance=finance',
  },
  {
    id: 'after-first-team-member',
    trigger: 'first_team_member',
    subProfile: 'people',
    title: 'Build your people strategy',
    body: 'Your team is growing! Define your culture, hiring criteria, and HR approach so the AI can help with hiring documents and team management.',
    ctaLabel: 'Set Up People Profile',
    ctaHref: '/app/profile?tab=profile&guidance=people',
  },
  {
    id: 'after-store-enabled',
    trigger: 'store_enabled',
    subProfile: 'technology',
    title: 'Document your tech stack',
    body: 'Your storefront is live! Tell us about your technology setup so the AI can make better recommendations.',
    ctaLabel: 'Complete Technology Profile',
    ctaHref: '/app/profile?tab=profile&guidance=technology',
  },
];
