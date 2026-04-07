export const DOCUMENT_CATEGORIES = [
  {
    name: 'Company Identity',
    slug: 'identity',
    description: 'Core business identity, registration, and governance documents',
    icon: 'Building2',
    sortOrder: 1,
    tier: 'UNIVERSAL_CORE',
    trigger: null,
  },
  {
    name: 'Finance & Tax',
    slug: 'finance-tax',
    description: 'Financial records, tax filings, and accounting documents',
    icon: 'DollarSign',
    sortOrder: 2,
    tier: 'UNIVERSAL_CORE',
    trigger: null,
  },
  {
    name: 'Commercial',
    slug: 'commercial',
    description: 'Sales, proposals, agreements, and payment terms',
    icon: 'FileText',
    sortOrder: 3,
    tier: 'UNIVERSAL_CORE',
    trigger: null,
  },
  {
    name: 'Brand & Messaging',
    slug: 'brand-messaging',
    description: 'Company bios, messaging, tone of voice, and brand assets',
    icon: 'Palette',
    sortOrder: 4,
    tier: 'UNIVERSAL_CORE',
    trigger: null,
  },
  {
    name: 'Operations',
    slug: 'operations',
    description: 'SOPs, approval workflows, and operational procedures',
    icon: 'Settings',
    sortOrder: 5,
    tier: 'UNIVERSAL_CORE',
    trigger: null,
  },
  {
    name: 'Audit & Recordkeeping',
    slug: 'audit-recordkeeping',
    description: 'Version history, approval logs, and compliance records',
    icon: 'Shield',
    sortOrder: 6,
    tier: 'UNIVERSAL_CORE',
    trigger: null,
  },
  {
    name: 'People & HR',
    slug: 'hr',
    description: 'Employment agreements, handbooks, and HR policies',
    icon: 'Users',
    sortOrder: 7,
    tier: 'TRIGGERED_CORE',
    trigger: 'EMPLOYEES',
  },
  {
    name: 'Contractors & Freelancers',
    slug: 'contractors',
    description: 'Contractor agreements, SOWs, and IP assignments',
    icon: 'UserCheck',
    sortOrder: 8,
    tier: 'TRIGGERED_CORE',
    trigger: 'CONTRACTORS',
  },
  {
    name: 'Privacy & Data',
    slug: 'privacy-data',
    description: 'Privacy policies, data handling, and cybersecurity docs',
    icon: 'Lock',
    sortOrder: 9,
    tier: 'TRIGGERED_CORE',
    trigger: 'PERSONAL_DATA',
  },
  {
    name: 'Website & E-Commerce',
    slug: 'website-ecommerce',
    description: 'Website terms, checkout policies, and digital commerce docs',
    icon: 'Globe',
    sortOrder: 10,
    tier: 'TRIGGERED_CORE',
    trigger: 'WEBSITE',
  },
  {
    name: 'Founders & Investors',
    slug: 'founders-investors',
    description: 'Shareholder agreements, cap tables, and investor documents',
    icon: 'TrendingUp',
    sortOrder: 11,
    tier: 'TRIGGERED_CORE',
    trigger: 'MULTIPLE_FOUNDERS',
  },
  {
    name: 'Vendors & Procurement',
    slug: 'vendors',
    description: 'Vendor agreements, purchase orders, and supplier management',
    icon: 'Truck',
    sortOrder: 12,
    tier: 'TRIGGERED_CORE',
    trigger: 'VENDORS',
  },
  {
    name: 'Insurance & Risk',
    slug: 'insurance-risk',
    description: 'Insurance records, claims, and business continuity plans',
    icon: 'ShieldCheck',
    sortOrder: 13,
    tier: 'TRIGGERED_CORE',
    trigger: 'INSURANCE',
  },
  {
    name: 'Brand & IP Protection',
    slug: 'brand-ip',
    description: 'Trademark filings, copyright registers, and brand guidelines',
    icon: 'Award',
    sortOrder: 14,
    tier: 'TRIGGERED_CORE',
    trigger: 'STRONG_BRAND',
  },
  {
    name: 'Facilities & Assets',
    slug: 'facilities',
    description: 'Leases, asset registers, and property management',
    icon: 'Home',
    sortOrder: 15,
    tier: 'TRIGGERED_CORE',
    trigger: 'PHYSICAL_PREMISES',
  },
  {
    name: 'Inventory & Quality',
    slug: 'inventory-quality',
    description: 'Purchase orders, QC checklists, and product quality docs',
    icon: 'Package',
    sortOrder: 16,
    tier: 'TRIGGERED_CORE',
    trigger: 'PHYSICAL_GOODS',
  },
  {
    name: 'Regulatory Compliance',
    slug: 'regulatory',
    description: 'Industry-specific compliance, disclosures, and audit plans',
    icon: 'Scale',
    sortOrder: 17,
    tier: 'ADVANCED',
    trigger: 'REGULATED_INDUSTRY',
  },
  {
    name: 'International',
    slug: 'international',
    description: 'Cross-border contracts, local registrations, and multi-jurisdiction docs',
    icon: 'Globe2',
    sortOrder: 18,
    tier: 'ADVANCED',
    trigger: 'MULTI_JURISDICTION',
  },
];

export interface DocTypeDef {
  name: string;
  slug: string;
  description: string;
  categorySlug: string;
  riskTier: 'GREEN' | 'YELLOW' | 'RED';
  requiredProfileFields: string[];
  brandSensitive: boolean;
  financialSensitive: boolean;
  legalSensitive: boolean;
  jurisdictionSensitive: boolean;
  sortOrder: number;
}

export const DOCUMENT_TYPES: DocTypeDef[] = [
  // Identity Pack
  { name: 'Company Description', slug: 'company-description', description: 'One-line and extended company description', categorySlug: 'identity', riskTier: 'GREEN', requiredProfileFields: ['name', 'industry'], brandSensitive: true, financialSensitive: false, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 1 },
  { name: 'Business Registration Record', slug: 'registration-record', description: 'Registration certificate and formation details', categorySlug: 'identity', riskTier: 'YELLOW', requiredProfileFields: ['name', 'country'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 2 },
  { name: 'Owner & Director Register', slug: 'owner-register', description: 'List of owners, directors, and authorized signatories', categorySlug: 'identity', riskTier: 'YELLOW', requiredProfileFields: ['name'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: false, sortOrder: 3 },
  { name: 'License & Permit Register', slug: 'license-register', description: 'Active licenses, permits, and their renewal dates', categorySlug: 'identity', riskTier: 'YELLOW', requiredProfileFields: ['name', 'industry', 'country'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 4 },

  // Finance & Tax Pack
  { name: 'Invoice Template', slug: 'invoice-template', description: 'Standardized invoice layout with tax and payment terms', categorySlug: 'finance-tax', riskTier: 'YELLOW', requiredProfileFields: ['name', 'address', 'email'], brandSensitive: true, financialSensitive: true, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 1 },
  { name: 'Tax Calendar', slug: 'tax-calendar', description: 'Key tax filing dates and deadlines', categorySlug: 'finance-tax', riskTier: 'YELLOW', requiredProfileFields: ['country'], brandSensitive: false, financialSensitive: true, legalSensitive: false, jurisdictionSensitive: true, sortOrder: 2 },
  { name: 'Chart of Accounts', slug: 'chart-of-accounts', description: 'Account structure for bookkeeping and reporting', categorySlug: 'finance-tax', riskTier: 'YELLOW', requiredProfileFields: ['industry'], brandSensitive: false, financialSensitive: true, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 3 },
  { name: 'Financial Statement Template', slug: 'financial-statement', description: 'P&L, balance sheet, and cash flow statement templates', categorySlug: 'finance-tax', riskTier: 'YELLOW', requiredProfileFields: ['name'], brandSensitive: false, financialSensitive: true, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 4 },

  // Commercial Pack
  { name: 'Proposal Template', slug: 'proposal-template', description: 'Professional service or product proposal', categorySlug: 'commercial', riskTier: 'YELLOW', requiredProfileFields: ['name', 'industry', 'description'], brandSensitive: true, financialSensitive: true, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 1 },
  { name: 'Service Agreement', slug: 'service-agreement', description: 'Standard terms for client engagements', categorySlug: 'commercial', riskTier: 'RED', requiredProfileFields: ['name', 'address', 'country'], brandSensitive: false, financialSensitive: true, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 2 },
  { name: 'Payment Terms', slug: 'payment-terms', description: 'Standard payment terms, late fees, and collection policies', categorySlug: 'commercial', riskTier: 'YELLOW', requiredProfileFields: ['name'], brandSensitive: false, financialSensitive: true, legalSensitive: true, jurisdictionSensitive: false, sortOrder: 3 },
  { name: 'Pricing Sheet', slug: 'pricing-sheet', description: 'Rate card and pricing schedule', categorySlug: 'commercial', riskTier: 'GREEN', requiredProfileFields: ['name', 'industry'], brandSensitive: true, financialSensitive: true, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 4 },
  { name: 'Client Onboarding Form', slug: 'client-onboarding', description: 'New client intake and information gathering form', categorySlug: 'commercial', riskTier: 'GREEN', requiredProfileFields: ['name'], brandSensitive: true, financialSensitive: false, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 5 },
  { name: 'Refund & Cancellation Policy', slug: 'refund-policy', description: 'Refund conditions, cancellation procedures, and exceptions', categorySlug: 'commercial', riskTier: 'YELLOW', requiredProfileFields: ['name', 'industry'], brandSensitive: false, financialSensitive: true, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 6 },

  // Brand & Messaging Pack
  { name: 'Company Tagline', slug: 'company-tagline', description: 'Short memorable tagline or slogan', categorySlug: 'brand-messaging', riskTier: 'GREEN', requiredProfileFields: ['name', 'industry'], brandSensitive: true, financialSensitive: false, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 1 },
  { name: 'Founder Bio', slug: 'founder-bio', description: 'Professional biography for founders and key team members', categorySlug: 'brand-messaging', riskTier: 'GREEN', requiredProfileFields: ['name'], brandSensitive: true, financialSensitive: false, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 2 },
  { name: 'Company Profile', slug: 'company-profile', description: 'Comprehensive company overview for partners and clients', categorySlug: 'brand-messaging', riskTier: 'GREEN', requiredProfileFields: ['name', 'industry', 'description'], brandSensitive: true, financialSensitive: false, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 3 },
  { name: 'Elevator Pitch', slug: 'elevator-pitch', description: '30-second pitch for networking and introductions', categorySlug: 'brand-messaging', riskTier: 'GREEN', requiredProfileFields: ['name', 'industry', 'description'], brandSensitive: true, financialSensitive: false, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 4 },
  { name: 'Mission & Vision Statement', slug: 'mission-vision', description: 'Core mission, vision, and positioning statement', categorySlug: 'brand-messaging', riskTier: 'GREEN', requiredProfileFields: ['name', 'industry'], brandSensitive: true, financialSensitive: false, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 5 },
  { name: 'Tone of Voice Guide', slug: 'tone-guide', description: 'Brand voice, style, and communication guidelines', categorySlug: 'brand-messaging', riskTier: 'GREEN', requiredProfileFields: ['name', 'industry'], brandSensitive: true, financialSensitive: false, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 6 },
  { name: 'Sales One-Pager', slug: 'sales-one-pager', description: 'Single-page sales and capabilities overview', categorySlug: 'brand-messaging', riskTier: 'GREEN', requiredProfileFields: ['name', 'industry', 'description'], brandSensitive: true, financialSensitive: false, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 7 },
  { name: 'FAQ Document', slug: 'faq-document', description: 'Frequently asked questions and answers', categorySlug: 'brand-messaging', riskTier: 'GREEN', requiredProfileFields: ['name', 'industry'], brandSensitive: true, financialSensitive: false, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 8 },

  // Operations Pack
  { name: 'Standard Operating Procedure', slug: 'sop', description: 'Step-by-step procedure for delivering services or products', categorySlug: 'operations', riskTier: 'YELLOW', requiredProfileFields: ['name', 'industry'], brandSensitive: false, financialSensitive: false, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 1 },
  { name: 'Approval Matrix', slug: 'approval-matrix', description: 'Who can approve what and at what thresholds', categorySlug: 'operations', riskTier: 'YELLOW', requiredProfileFields: ['name', 'teamSize'], brandSensitive: false, financialSensitive: true, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 2 },
  { name: 'Business Continuity Plan', slug: 'business-continuity', description: 'Plan for maintaining operations during disruptions', categorySlug: 'operations', riskTier: 'YELLOW', requiredProfileFields: ['name', 'industry'], brandSensitive: false, financialSensitive: false, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 3 },

  // Audit & Recordkeeping
  { name: 'Document Register', slug: 'document-register', description: 'Master list of all business documents and their status', categorySlug: 'audit-recordkeeping', riskTier: 'GREEN', requiredProfileFields: ['name'], brandSensitive: false, financialSensitive: false, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 1 },
  { name: 'Retention Schedule', slug: 'retention-schedule', description: 'How long to keep each type of document', categorySlug: 'audit-recordkeeping', riskTier: 'YELLOW', requiredProfileFields: ['country', 'industry'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 2 },

  // HR (Triggered)
  { name: 'Employment Offer Letter', slug: 'offer-letter', description: 'Formal job offer with compensation and terms', categorySlug: 'hr', riskTier: 'RED', requiredProfileFields: ['name', 'address', 'country'], brandSensitive: true, financialSensitive: true, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 1 },
  { name: 'Employee Handbook', slug: 'employee-handbook', description: 'Company policies, expectations, and employee guidelines', categorySlug: 'hr', riskTier: 'YELLOW', requiredProfileFields: ['name', 'country', 'teamSize'], brandSensitive: true, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 2 },
  { name: 'Confidentiality Agreement', slug: 'nda-employee', description: 'Employee confidentiality and non-disclosure agreement', categorySlug: 'hr', riskTier: 'RED', requiredProfileFields: ['name', 'country'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 3 },

  // Contractors (Triggered)
  { name: 'Independent Contractor Agreement', slug: 'contractor-agreement', description: 'Terms for engaging freelancers and contractors', categorySlug: 'contractors', riskTier: 'RED', requiredProfileFields: ['name', 'address', 'country'], brandSensitive: false, financialSensitive: true, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 1 },
  { name: 'Contractor SOW', slug: 'contractor-sow', description: 'Scope of work for contractor engagements', categorySlug: 'contractors', riskTier: 'YELLOW', requiredProfileFields: ['name'], brandSensitive: false, financialSensitive: true, legalSensitive: true, jurisdictionSensitive: false, sortOrder: 2 },

  // Privacy (Triggered)
  { name: 'Privacy Policy', slug: 'privacy-policy', description: 'How the business collects, uses, and protects personal data', categorySlug: 'privacy-data', riskTier: 'RED', requiredProfileFields: ['name', 'website', 'country'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 1 },
  { name: 'Data Handling Policy', slug: 'data-handling', description: 'Internal procedures for storing and processing data', categorySlug: 'privacy-data', riskTier: 'YELLOW', requiredProfileFields: ['name'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: false, sortOrder: 2 },

  // Website (Triggered)
  { name: 'Website Terms of Use', slug: 'website-terms', description: 'Terms governing use of the business website', categorySlug: 'website-ecommerce', riskTier: 'RED', requiredProfileFields: ['name', 'website', 'country'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 1 },
  { name: 'Returns & Shipping Policy', slug: 'returns-shipping', description: 'Product return conditions and shipping terms', categorySlug: 'website-ecommerce', riskTier: 'YELLOW', requiredProfileFields: ['name'], brandSensitive: false, financialSensitive: true, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 2 },

  // Founders (Triggered)
  { name: 'Founder Agreement', slug: 'founder-agreement', description: 'Terms between co-founders covering roles, equity, and exits', categorySlug: 'founders-investors', riskTier: 'RED', requiredProfileFields: ['name', 'country'], brandSensitive: false, financialSensitive: true, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 1 },
  { name: 'Investor Update Template', slug: 'investor-update', description: 'Monthly/quarterly investor progress report', categorySlug: 'founders-investors', riskTier: 'YELLOW', requiredProfileFields: ['name'], brandSensitive: true, financialSensitive: true, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 2 },

  // Vendors (Triggered)
  { name: 'Vendor Agreement', slug: 'vendor-agreement', description: 'Standard terms for engaging suppliers and vendors', categorySlug: 'vendors', riskTier: 'RED', requiredProfileFields: ['name', 'address', 'country'], brandSensitive: false, financialSensitive: true, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 1 },
  { name: 'Non-Disclosure Agreement', slug: 'nda-vendor', description: 'NDA for sharing confidential information with third parties', categorySlug: 'vendors', riskTier: 'RED', requiredProfileFields: ['name', 'country'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 2 },
];
