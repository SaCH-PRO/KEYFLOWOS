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
  { name: 'Budget Template', slug: 'budget-template', description: 'Monthly and annual budget planning with income and expense categories', categorySlug: 'finance-tax', riskTier: 'GREEN', requiredProfileFields: ['name', 'industry'], brandSensitive: false, financialSensitive: true, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 5 },
  { name: 'Receipt Template', slug: 'receipt-template', description: 'Customer payment receipt with itemized breakdown and tax details', categorySlug: 'finance-tax', riskTier: 'GREEN', requiredProfileFields: ['name', 'address'], brandSensitive: true, financialSensitive: true, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 6 },
  { name: 'Expense Report Template', slug: 'expense-report', description: 'Standard expense report form for tracking and reimbursing business expenses', categorySlug: 'finance-tax', riskTier: 'GREEN', requiredProfileFields: ['name'], brandSensitive: false, financialSensitive: true, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 7 },

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
  { name: 'Meeting Agenda Template', slug: 'meeting-agenda', description: 'Standard meeting agenda with objectives, action items, and follow-ups', categorySlug: 'operations', riskTier: 'GREEN', requiredProfileFields: ['name'], brandSensitive: false, financialSensitive: false, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 4 },
  { name: 'Project Handoff Checklist', slug: 'project-handoff', description: 'Checklist for transferring project ownership between team members or clients', categorySlug: 'operations', riskTier: 'GREEN', requiredProfileFields: ['name'], brandSensitive: false, financialSensitive: false, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 5 },
  { name: 'Communication Plan', slug: 'communication-plan', description: 'Internal and external communication protocols, channels, and escalation paths', categorySlug: 'operations', riskTier: 'GREEN', requiredProfileFields: ['name', 'teamSize'], brandSensitive: true, financialSensitive: false, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 6 },

  // Audit & Recordkeeping
  { name: 'Document Register', slug: 'document-register', description: 'Master list of all business documents and their status', categorySlug: 'audit-recordkeeping', riskTier: 'GREEN', requiredProfileFields: ['name'], brandSensitive: false, financialSensitive: false, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 1 },
  { name: 'Retention Schedule', slug: 'retention-schedule', description: 'How long to keep each type of document', categorySlug: 'audit-recordkeeping', riskTier: 'YELLOW', requiredProfileFields: ['country', 'industry'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 2 },
  { name: 'Change Log Template', slug: 'change-log', description: 'Record of significant business changes, decisions, and version updates', categorySlug: 'audit-recordkeeping', riskTier: 'GREEN', requiredProfileFields: ['name'], brandSensitive: false, financialSensitive: false, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 3 },
  { name: 'Annual Review Report', slug: 'annual-review', description: 'Year-end summary of business performance, milestones, and goals for next year', categorySlug: 'audit-recordkeeping', riskTier: 'GREEN', requiredProfileFields: ['name', 'industry'], brandSensitive: true, financialSensitive: true, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 4 },

  // HR (Triggered)
  { name: 'Employment Offer Letter', slug: 'offer-letter', description: 'Formal job offer with compensation and terms', categorySlug: 'hr', riskTier: 'RED', requiredProfileFields: ['name', 'address', 'country'], brandSensitive: true, financialSensitive: true, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 1 },
  { name: 'Employee Handbook', slug: 'employee-handbook', description: 'Company policies, expectations, and employee guidelines', categorySlug: 'hr', riskTier: 'YELLOW', requiredProfileFields: ['name', 'country', 'teamSize'], brandSensitive: true, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 2 },
  { name: 'Confidentiality Agreement', slug: 'nda-employee', description: 'Employee confidentiality and non-disclosure agreement', categorySlug: 'hr', riskTier: 'RED', requiredProfileFields: ['name', 'country'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 3 },
  { name: 'Job Description Template', slug: 'job-description', description: 'Standardized job posting with role requirements and responsibilities', categorySlug: 'hr', riskTier: 'GREEN', requiredProfileFields: ['name', 'industry'], brandSensitive: true, financialSensitive: false, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 4 },
  { name: 'Performance Review Template', slug: 'performance-review', description: 'Employee evaluation form with goals, achievements, and development areas', categorySlug: 'hr', riskTier: 'GREEN', requiredProfileFields: ['name'], brandSensitive: false, financialSensitive: false, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 5 },
  { name: 'Termination Letter', slug: 'termination-letter', description: 'Formal notice of employment termination with final settlement details', categorySlug: 'hr', riskTier: 'RED', requiredProfileFields: ['name', 'country'], brandSensitive: false, financialSensitive: true, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 6 },
  { name: 'Leave Policy', slug: 'leave-policy', description: 'Vacation, sick leave, maternity/paternity, and other leave entitlements', categorySlug: 'hr', riskTier: 'YELLOW', requiredProfileFields: ['name', 'country'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 7 },

  // Contractors (Triggered)
  { name: 'Independent Contractor Agreement', slug: 'contractor-agreement', description: 'Terms for engaging freelancers and contractors', categorySlug: 'contractors', riskTier: 'RED', requiredProfileFields: ['name', 'address', 'country'], brandSensitive: false, financialSensitive: true, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 1 },
  { name: 'Contractor SOW', slug: 'contractor-sow', description: 'Scope of work for contractor engagements', categorySlug: 'contractors', riskTier: 'YELLOW', requiredProfileFields: ['name'], brandSensitive: false, financialSensitive: true, legalSensitive: true, jurisdictionSensitive: false, sortOrder: 2 },
  { name: 'Contractor Invoice Template', slug: 'contractor-invoice', description: 'Standard invoice format for contractor payments and billing', categorySlug: 'contractors', riskTier: 'GREEN', requiredProfileFields: ['name'], brandSensitive: false, financialSensitive: true, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 3 },
  { name: 'Contractor IP Assignment', slug: 'contractor-ip', description: 'Assignment of intellectual property created by contractors to the business', categorySlug: 'contractors', riskTier: 'RED', requiredProfileFields: ['name', 'country'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 4 },

  // Privacy (Triggered)
  { name: 'Privacy Policy', slug: 'privacy-policy', description: 'How the business collects, uses, and protects personal data', categorySlug: 'privacy-data', riskTier: 'RED', requiredProfileFields: ['name', 'website', 'country'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 1 },
  { name: 'Data Handling Policy', slug: 'data-handling', description: 'Internal procedures for storing and processing data', categorySlug: 'privacy-data', riskTier: 'YELLOW', requiredProfileFields: ['name'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: false, sortOrder: 2 },
  { name: 'Cookie Policy', slug: 'cookie-policy', description: 'Policy explaining cookie use, tracking technologies, and user consent', categorySlug: 'privacy-data', riskTier: 'YELLOW', requiredProfileFields: ['name', 'website'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 3 },
  { name: 'Data Breach Response Plan', slug: 'breach-response', description: 'Step-by-step plan for responding to data breaches and security incidents', categorySlug: 'privacy-data', riskTier: 'RED', requiredProfileFields: ['name', 'country'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 4 },
  { name: 'Data Processing Agreement', slug: 'dpa', description: 'Terms for how third-party processors handle personal data on your behalf', categorySlug: 'privacy-data', riskTier: 'RED', requiredProfileFields: ['name', 'country'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 5 },

  // Website (Triggered)
  { name: 'Website Terms of Use', slug: 'website-terms', description: 'Terms governing use of the business website', categorySlug: 'website-ecommerce', riskTier: 'RED', requiredProfileFields: ['name', 'website', 'country'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 1 },
  { name: 'Returns & Shipping Policy', slug: 'returns-shipping', description: 'Product return conditions and shipping terms', categorySlug: 'website-ecommerce', riskTier: 'YELLOW', requiredProfileFields: ['name'], brandSensitive: false, financialSensitive: true, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 2 },
  { name: 'Acceptable Use Policy', slug: 'acceptable-use', description: 'Rules for appropriate use of your platform, app, or online services', categorySlug: 'website-ecommerce', riskTier: 'YELLOW', requiredProfileFields: ['name', 'website'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: false, sortOrder: 3 },
  { name: 'Disclaimer Page', slug: 'disclaimer', description: 'Legal disclaimers for content, advice, and liability limitations on your website', categorySlug: 'website-ecommerce', riskTier: 'YELLOW', requiredProfileFields: ['name', 'industry'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 4 },
  { name: 'E-Commerce Terms & Conditions', slug: 'ecommerce-terms', description: 'Complete terms governing online purchases, delivery, and consumer rights', categorySlug: 'website-ecommerce', riskTier: 'RED', requiredProfileFields: ['name', 'website', 'country'], brandSensitive: false, financialSensitive: true, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 5 },

  // Founders (Triggered)
  { name: 'Founder Agreement', slug: 'founder-agreement', description: 'Terms between co-founders covering roles, equity, and exits', categorySlug: 'founders-investors', riskTier: 'RED', requiredProfileFields: ['name', 'country'], brandSensitive: false, financialSensitive: true, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 1 },
  { name: 'Investor Update Template', slug: 'investor-update', description: 'Monthly/quarterly investor progress report', categorySlug: 'founders-investors', riskTier: 'YELLOW', requiredProfileFields: ['name'], brandSensitive: true, financialSensitive: true, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 2 },
  { name: 'Cap Table', slug: 'cap-table', description: 'Equity ownership structure showing shares, options, and vesting schedules', categorySlug: 'founders-investors', riskTier: 'YELLOW', requiredProfileFields: ['name'], brandSensitive: false, financialSensitive: true, legalSensitive: true, jurisdictionSensitive: false, sortOrder: 3 },
  { name: 'Shareholder Agreement', slug: 'shareholder-agreement', description: 'Rights, obligations, and protections for shareholders and investors', categorySlug: 'founders-investors', riskTier: 'RED', requiredProfileFields: ['name', 'country'], brandSensitive: false, financialSensitive: true, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 4 },
  { name: 'Pitch Deck Script', slug: 'pitch-deck-script', description: 'Narrative script and talking points for investor pitch presentations', categorySlug: 'founders-investors', riskTier: 'GREEN', requiredProfileFields: ['name', 'industry', 'description'], brandSensitive: true, financialSensitive: true, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 5 },

  // Vendors (Triggered)
  { name: 'Vendor Agreement', slug: 'vendor-agreement', description: 'Standard terms for engaging suppliers and vendors', categorySlug: 'vendors', riskTier: 'RED', requiredProfileFields: ['name', 'address', 'country'], brandSensitive: false, financialSensitive: true, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 1 },
  { name: 'Non-Disclosure Agreement', slug: 'nda-vendor', description: 'NDA for sharing confidential information with third parties', categorySlug: 'vendors', riskTier: 'RED', requiredProfileFields: ['name', 'country'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 2 },
  { name: 'Purchase Order Template', slug: 'purchase-order', description: 'Standard purchase order for goods and services from vendors', categorySlug: 'vendors', riskTier: 'YELLOW', requiredProfileFields: ['name', 'address'], brandSensitive: false, financialSensitive: true, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 3 },
  { name: 'Vendor Evaluation Checklist', slug: 'vendor-evaluation', description: 'Criteria and scorecard for evaluating potential suppliers', categorySlug: 'vendors', riskTier: 'GREEN', requiredProfileFields: ['name', 'industry'], brandSensitive: false, financialSensitive: false, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 4 },

  // Insurance & Risk (Triggered)
  { name: 'Insurance Policy Register', slug: 'insurance-register', description: 'Record of all active insurance policies, coverage amounts, and renewal dates', categorySlug: 'insurance-risk', riskTier: 'YELLOW', requiredProfileFields: ['name', 'industry'], brandSensitive: false, financialSensitive: true, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 1 },
  { name: 'Risk Assessment Report', slug: 'risk-assessment', description: 'Identify, evaluate, and prioritize business risks with mitigation strategies', categorySlug: 'insurance-risk', riskTier: 'YELLOW', requiredProfileFields: ['name', 'industry'], brandSensitive: false, financialSensitive: false, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 2 },
  { name: 'Incident Report Template', slug: 'incident-report', description: 'Template for documenting workplace incidents, injuries, or property damage', categorySlug: 'insurance-risk', riskTier: 'YELLOW', requiredProfileFields: ['name'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: false, sortOrder: 3 },
  { name: 'Liability Waiver', slug: 'liability-waiver', description: 'Release of liability form for clients, visitors, or event participants', categorySlug: 'insurance-risk', riskTier: 'RED', requiredProfileFields: ['name', 'country'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 4 },
  { name: 'Insurance Claim Checklist', slug: 'insurance-claim-checklist', description: 'Step-by-step checklist for filing and tracking insurance claims', categorySlug: 'insurance-risk', riskTier: 'GREEN', requiredProfileFields: ['name'], brandSensitive: false, financialSensitive: true, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 5 },

  // Brand & IP Protection (Triggered)
  { name: 'Brand Guidelines', slug: 'brand-guidelines', description: 'Logo usage, color palette, typography, and visual identity standards', categorySlug: 'brand-ip', riskTier: 'GREEN', requiredProfileFields: ['name'], brandSensitive: true, financialSensitive: false, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 1 },
  { name: 'Trademark Register', slug: 'trademark-register', description: 'Record of filed and registered trademarks with classes and jurisdictions', categorySlug: 'brand-ip', riskTier: 'YELLOW', requiredProfileFields: ['name', 'country'], brandSensitive: true, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 2 },
  { name: 'Copyright Notice Template', slug: 'copyright-notice', description: 'Standard copyright notice for content, software, and creative works', categorySlug: 'brand-ip', riskTier: 'GREEN', requiredProfileFields: ['name'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: false, sortOrder: 3 },
  { name: 'IP Assignment Agreement', slug: 'ip-assignment', description: 'Transfer of intellectual property rights from creators to the business', categorySlug: 'brand-ip', riskTier: 'RED', requiredProfileFields: ['name', 'country'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 4 },
  { name: 'Content Licensing Agreement', slug: 'content-license', description: 'Terms for licensing content, images, or media to or from third parties', categorySlug: 'brand-ip', riskTier: 'RED', requiredProfileFields: ['name', 'country'], brandSensitive: false, financialSensitive: true, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 5 },

  // Facilities & Assets (Triggered)
  { name: 'Lease Agreement Summary', slug: 'lease-summary', description: 'Key terms of commercial or office lease agreements', categorySlug: 'facilities', riskTier: 'YELLOW', requiredProfileFields: ['name', 'address'], brandSensitive: false, financialSensitive: true, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 1 },
  { name: 'Asset Register', slug: 'asset-register', description: 'Inventory of all business assets including equipment, vehicles, and technology', categorySlug: 'facilities', riskTier: 'GREEN', requiredProfileFields: ['name'], brandSensitive: false, financialSensitive: true, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 2 },
  { name: 'Maintenance Schedule', slug: 'maintenance-schedule', description: 'Planned maintenance calendar for equipment and facilities', categorySlug: 'facilities', riskTier: 'GREEN', requiredProfileFields: ['name'], brandSensitive: false, financialSensitive: false, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 3 },
  { name: 'Office & Workplace Policy', slug: 'workplace-policy', description: 'Rules for shared workspace use, cleanliness, security, and access', categorySlug: 'facilities', riskTier: 'GREEN', requiredProfileFields: ['name'], brandSensitive: false, financialSensitive: false, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 4 },
  { name: 'Equipment Loan Agreement', slug: 'equipment-loan', description: 'Terms for lending business equipment to employees or contractors', categorySlug: 'facilities', riskTier: 'YELLOW', requiredProfileFields: ['name', 'country'], brandSensitive: false, financialSensitive: true, legalSensitive: true, jurisdictionSensitive: false, sortOrder: 5 },

  // Inventory & Quality (Triggered)
  { name: 'Product Catalog', slug: 'product-catalog', description: 'Complete listing of products with descriptions, pricing, and specifications', categorySlug: 'inventory-quality', riskTier: 'GREEN', requiredProfileFields: ['name', 'industry'], brandSensitive: true, financialSensitive: true, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 1 },
  { name: 'Quality Control Checklist', slug: 'qc-checklist', description: 'Inspection checklist for product or service quality standards', categorySlug: 'inventory-quality', riskTier: 'GREEN', requiredProfileFields: ['name', 'industry'], brandSensitive: false, financialSensitive: false, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 2 },
  { name: 'Inventory Management Policy', slug: 'inventory-policy', description: 'Rules for stock tracking, reordering, and warehouse management', categorySlug: 'inventory-quality', riskTier: 'GREEN', requiredProfileFields: ['name'], brandSensitive: false, financialSensitive: true, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 3 },
  { name: 'Supplier Quality Agreement', slug: 'supplier-quality', description: 'Quality expectations and standards for suppliers and manufacturers', categorySlug: 'inventory-quality', riskTier: 'YELLOW', requiredProfileFields: ['name', 'industry'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: false, sortOrder: 4 },
  { name: 'Product Safety & Compliance Sheet', slug: 'product-safety', description: 'Safety data, certifications, and regulatory compliance for products', categorySlug: 'inventory-quality', riskTier: 'YELLOW', requiredProfileFields: ['name', 'industry', 'country'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 5 },

  // Regulatory Compliance (Advanced)
  { name: 'Compliance Policy', slug: 'compliance-policy', description: 'Company-wide compliance framework covering industry regulations and standards', categorySlug: 'regulatory', riskTier: 'RED', requiredProfileFields: ['name', 'industry', 'country'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 1 },
  { name: 'Anti-Money Laundering Policy', slug: 'aml-policy', description: 'AML procedures, customer due diligence, and suspicious activity reporting', categorySlug: 'regulatory', riskTier: 'RED', requiredProfileFields: ['name', 'industry', 'country'], brandSensitive: false, financialSensitive: true, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 2 },
  { name: 'Health & Safety Policy', slug: 'health-safety', description: 'Workplace health and safety standards, emergency procedures, and responsibilities', categorySlug: 'regulatory', riskTier: 'YELLOW', requiredProfileFields: ['name', 'industry'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 3 },
  { name: 'Environmental Policy', slug: 'environmental-policy', description: 'Sustainability practices, waste management, and environmental commitments', categorySlug: 'regulatory', riskTier: 'YELLOW', requiredProfileFields: ['name', 'industry'], brandSensitive: true, financialSensitive: false, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 4 },
  { name: 'Audit Preparation Checklist', slug: 'audit-prep', description: 'Checklist for preparing for regulatory, financial, or compliance audits', categorySlug: 'regulatory', riskTier: 'GREEN', requiredProfileFields: ['name', 'industry'], brandSensitive: false, financialSensitive: true, legalSensitive: false, jurisdictionSensitive: false, sortOrder: 5 },
  { name: 'Whistleblower Policy', slug: 'whistleblower-policy', description: 'Policy for reporting misconduct, fraud, or violations without retaliation', categorySlug: 'regulatory', riskTier: 'YELLOW', requiredProfileFields: ['name', 'country'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 6 },

  // International (Advanced)
  { name: 'Cross-Border Service Agreement', slug: 'cross-border-agreement', description: 'Service terms adapted for international clients with jurisdiction and tax clauses', categorySlug: 'international', riskTier: 'RED', requiredProfileFields: ['name', 'address', 'country'], brandSensitive: false, financialSensitive: true, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 1 },
  { name: 'Foreign Entity Registration Checklist', slug: 'foreign-registration', description: 'Requirements for registering or incorporating in a foreign jurisdiction', categorySlug: 'international', riskTier: 'YELLOW', requiredProfileFields: ['name', 'country'], brandSensitive: false, financialSensitive: false, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 2 },
  { name: 'International Tax Compliance Guide', slug: 'intl-tax-guide', description: 'Tax obligations, withholding requirements, and treaties for cross-border operations', categorySlug: 'international', riskTier: 'RED', requiredProfileFields: ['name', 'country', 'industry'], brandSensitive: false, financialSensitive: true, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 3 },
  { name: 'Export/Import Compliance Policy', slug: 'export-import-policy', description: 'Policies for complying with customs, trade sanctions, and import/export regulations', categorySlug: 'international', riskTier: 'RED', requiredProfileFields: ['name', 'country', 'industry'], brandSensitive: false, financialSensitive: true, legalSensitive: true, jurisdictionSensitive: true, sortOrder: 4 },
  { name: 'Multi-Currency Payment Policy', slug: 'multi-currency-policy', description: 'Procedures for invoicing, receiving, and managing payments in multiple currencies', categorySlug: 'international', riskTier: 'YELLOW', requiredProfileFields: ['name', 'country'], brandSensitive: false, financialSensitive: true, legalSensitive: false, jurisdictionSensitive: true, sortOrder: 5 },
];
