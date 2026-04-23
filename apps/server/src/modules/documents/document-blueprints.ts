export interface SectionBlueprint {
  key: string;
  name: string;
  guidance: string;
  riskScore?: 'GREEN' | 'YELLOW' | 'RED';
  editableMode?: 'FREE' | 'GUIDED' | 'RESTRICTED';
}

export interface DocumentBlueprint {
  sections: SectionBlueprint[];
  qualityDirective: string;
  legalFramework?: string;
  financialStandards?: string;
  modernPractices?: string;
}

export const DOCUMENT_BLUEPRINTS: Record<string, DocumentBlueprint> = {
  'service-agreement': {
    qualityDirective: 'Draft as a binding services agreement suitable for execution. Use numbered clauses with sub-clauses. Every obligation must be bilateral or explicitly one-sided. Avoid vague terms like "reasonable" without defining what reasonable means in context. Include fallback mechanisms for disputes.',
    legalFramework: 'Reference the governing law of the business jurisdiction. For Caribbean jurisdictions, cite relevant common-law contract principles. Include severability, entire agreement, and amendment clauses as standard boilerplate. Address force majeure with modern triggers (pandemic, cyber-attack, natural disaster).',
    financialStandards: 'Itemize payment terms precisely: due dates, accepted methods, currency, late-payment interest rate (specify per annum), and consequences of non-payment. Include a clear invoicing schedule and dispute resolution for billing disagreements.',
    modernPractices: 'Include data protection obligations referencing modern privacy standards. Address remote/digital service delivery. Include electronic signature acceptance and digital communication as valid notice.',
    sections: [
      { key: 'parties', name: 'Parties & Recitals', guidance: 'Full legal names, addresses, registration numbers. State the purpose of the agreement and relationship between parties.' },
      { key: 'scope', name: 'Scope of Services', guidance: 'Detailed description of services, deliverables, timelines, and acceptance criteria. Be specific — list what IS and IS NOT included.' },
      { key: 'term', name: 'Term & Termination', guidance: 'Start date, duration, renewal mechanism, termination for cause and convenience, notice periods, and wind-down obligations.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'compensation', name: 'Compensation & Payment', guidance: 'Fee structure, payment schedule, invoicing, accepted currencies, late payment penalties, expense reimbursement rules.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'ip', name: 'Intellectual Property', guidance: 'Ownership of work product, pre-existing IP, licenses granted, and moral rights. State clearly who owns what after engagement ends.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'confidentiality', name: 'Confidentiality', guidance: 'Definition of confidential information, obligations, duration of confidentiality, permitted disclosures, and return/destruction of materials.', riskScore: 'YELLOW' },
      { key: 'liability', name: 'Limitation of Liability', guidance: 'Cap on liability, exclusion of consequential damages, indemnification obligations, and insurance requirements.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'data_protection', name: 'Data Protection & Privacy', guidance: 'Data processing obligations, compliance with applicable privacy laws, breach notification, and data return/deletion.' },
      { key: 'dispute', name: 'Dispute Resolution', guidance: 'Escalation procedure, mediation, arbitration or court jurisdiction, governing law, and venue.', riskScore: 'YELLOW' },
      { key: 'general', name: 'General Provisions', guidance: 'Force majeure, severability, entire agreement, amendments, waiver, assignment, notices, and counterparts.' },
    ],
  },

  'privacy-policy': {
    qualityDirective: 'Draft a comprehensive privacy policy that would satisfy modern data protection scrutiny. Use clear, plain-language explanations accessible to non-legal readers while maintaining legal precision. Organize by data lifecycle: collection → use → storage → sharing → rights.',
    legalFramework: 'Reference GDPR principles as a global baseline even for Caribbean businesses. For Trinidad & Tobago, reference the Data Protection Act 2011. Address cookie consent, cross-border transfers, and children\'s data. Include lawful bases for processing.',
    modernPractices: 'Address modern data practices: analytics, third-party integrations, social media pixels, AI/ML processing, cloud storage, mobile app data collection, biometrics if applicable. Include automated decision-making disclosures.',
    sections: [
      { key: 'overview', name: 'Introduction & Scope', guidance: 'Who this policy applies to, what it covers, effective date, and how changes are communicated.' },
      { key: 'collection', name: 'Information We Collect', guidance: 'Categories of personal data: directly provided, automatically collected, from third parties. Be exhaustive and specific to the business.' },
      { key: 'purpose', name: 'How We Use Your Information', guidance: 'Specific purposes for each data category with lawful basis. Include service delivery, communications, analytics, marketing, and legal compliance.' },
      { key: 'sharing', name: 'Information Sharing & Disclosure', guidance: 'Categories of recipients, purpose of sharing, safeguards. Include service providers, legal obligations, business transfers, and public authorities.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'retention', name: 'Data Retention', guidance: 'Retention periods by data category with justification. Include deletion/anonymization procedures.' },
      { key: 'security', name: 'Security Measures', guidance: 'Technical and organizational measures to protect data. Be specific but avoid revealing exploitable details.' },
      { key: 'rights', name: 'Your Rights', guidance: 'Enumerated data subject rights: access, rectification, erasure, portability, objection, restriction. Include how to exercise them.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'cookies', name: 'Cookies & Tracking Technologies', guidance: 'Types of cookies used, purposes, consent mechanisms, and how to manage preferences.' },
      { key: 'international', name: 'International Data Transfers', guidance: 'If data moves across borders, explain safeguards (adequacy decisions, standard contractual clauses, etc.).' },
      { key: 'children', name: 'Children\'s Privacy', guidance: 'Age thresholds, parental consent, and COPPA/equivalent compliance if applicable.' },
      { key: 'contact', name: 'Contact & Complaints', guidance: 'Data controller identity, DPO contact if applicable, supervisory authority, and complaint process.' },
    ],
  },

  'employee-handbook': {
    qualityDirective: 'Create a definitive employee reference document that establishes clear expectations while fostering a positive work culture. Every policy must be actionable — tell employees exactly what to do, not just what not to do. Balance firmness with warmth.',
    legalFramework: 'Ensure compliance with local labor laws. For Caribbean jurisdictions, reference relevant employment legislation (e.g., Trinidad: Industrial Relations Act, Minimum Wages Act, Maternity Protection Act). Include at-will or statutory notice requirements as applicable.',
    modernPractices: 'Address hybrid/remote work, digital communication etiquette, social media use, mental health support, DEI commitments, and flexible working arrangements. Include technology acceptable use.',
    sections: [
      { key: 'welcome', name: 'Welcome & Company Culture', guidance: 'Founder welcome message, company mission/values, organizational structure, and what makes this workplace unique.' },
      { key: 'employment', name: 'Employment Basics', guidance: 'Employment classifications, probationary period, working hours, overtime, attendance expectations, and timekeeping.' },
      { key: 'compensation', name: 'Compensation & Benefits', guidance: 'Pay structure, pay periods, deductions, bonuses, benefits overview (health, pension, allowances), and expense reimbursement.' },
      { key: 'leave', name: 'Leave & Time Off', guidance: 'Vacation, sick leave, personal days, maternity/paternity, bereavement, jury duty, public holidays. Include accrual rules and request procedures.', riskScore: 'YELLOW' },
      { key: 'conduct', name: 'Code of Conduct', guidance: 'Professional behavior standards, dress code, conflict of interest, gifts policy, anti-harassment, anti-discrimination, and substance abuse policy.', riskScore: 'YELLOW' },
      { key: 'technology', name: 'Technology & Communication', guidance: 'Email, internet, device usage, social media, data security, password policies, and BYOD rules.' },
      { key: 'performance', name: 'Performance & Development', guidance: 'Review cycle, goal-setting framework, promotion criteria, training opportunities, and mentorship programs.' },
      { key: 'discipline', name: 'Disciplinary Process', guidance: 'Progressive discipline steps, investigation procedures, suspension, termination grounds, and appeal process.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'health_safety', name: 'Health & Safety', guidance: 'Workplace safety responsibilities, reporting procedures, emergency protocols, first aid, and workers\' compensation.' },
      { key: 'separation', name: 'Separation & Offboarding', guidance: 'Resignation notice, exit interviews, final pay, benefits continuation, return of property, and non-compete obligations.', riskScore: 'YELLOW' },
      { key: 'acknowledgment', name: 'Acknowledgment', guidance: 'Employee acknowledgment statement confirming receipt and understanding of the handbook. Include signature line.', riskScore: 'RED', editableMode: 'RESTRICTED' },
    ],
  },

  'proposal-template': {
    qualityDirective: 'Create a compelling, professional proposal that sells the business while being transparent and specific. Structure it to guide the reader from problem to solution to action. Every section should build confidence and urgency.',
    modernPractices: 'Include modern delivery methods (digital collaboration, project management tools, real-time reporting). Reference relevant technology capabilities. Make pricing transparent and options-based where possible.',
    sections: [
      { key: 'cover', name: 'Cover & Executive Summary', guidance: 'Client name, project title, date, and a 2-3 paragraph executive summary that captures the key value proposition and expected outcomes.' },
      { key: 'understanding', name: 'Understanding of Requirements', guidance: 'Demonstrate deep understanding of the client\'s situation, challenges, and goals. Reference specific pain points the business can solve.' },
      { key: 'approach', name: 'Proposed Approach & Methodology', guidance: 'Detailed methodology, phases, tools, and techniques. Explain WHY this approach works, not just what it is.' },
      { key: 'deliverables', name: 'Deliverables & Timeline', guidance: 'Specific list of deliverables with acceptance criteria, milestones, and realistic timeline with dependencies.' },
      { key: 'team', name: 'Team & Qualifications', guidance: 'Key team members, their roles, relevant experience, and why they\'re the right people for this project.' },
      { key: 'investment', name: 'Investment & Pricing', guidance: 'Clear pricing with line items, payment schedule, what\'s included/excluded, and optional add-ons. Use "investment" framing, not "cost."' },
      { key: 'terms', name: 'Terms & Conditions', guidance: 'Validity period, payment terms, change order process, cancellation policy, and IP ownership.' },
      { key: 'next_steps', name: 'Next Steps', guidance: 'Clear call to action with specific next steps, timeline for decision, and contact information.' },
    ],
  },

  'sop': {
    qualityDirective: 'Write an operational procedure that someone with no prior knowledge could follow and produce consistent results. Use numbered steps, decision points, and measurable quality checks. Include edge cases and troubleshooting.',
    modernPractices: 'Reference digital tools and automation where applicable. Include version control expectations and continuous improvement triggers. Design for both in-person and remote execution.',
    sections: [
      { key: 'purpose', name: 'Purpose & Scope', guidance: 'Why this SOP exists, what process it governs, who must follow it, and when it applies.' },
      { key: 'definitions', name: 'Definitions & Abbreviations', guidance: 'Key terms, acronyms, and role definitions used in this procedure.' },
      { key: 'responsibilities', name: 'Roles & Responsibilities', guidance: 'Who does what at each stage. Use role titles, not individual names. Include backup/escalation roles.' },
      { key: 'prerequisites', name: 'Prerequisites & Materials', guidance: 'What must be in place before starting: tools, access, approvals, templates, or training required.' },
      { key: 'procedure', name: 'Step-by-Step Procedure', guidance: 'Numbered steps with sub-steps. Include decision points (if/then), timing expectations, quality gates, and handoff points.' },
      { key: 'quality', name: 'Quality Checks & Validation', guidance: 'How to verify each output meets standards. Include checklists, sampling methods, or sign-off requirements.' },
      { key: 'exceptions', name: 'Exceptions & Troubleshooting', guidance: 'Common problems, edge cases, and their resolutions. Include escalation paths for unusual situations.' },
      { key: 'records', name: 'Records & Documentation', guidance: 'What records to keep, where to store them, retention period, and who has access.' },
      { key: 'review', name: 'Review & Revision History', guidance: 'Review frequency, who approves changes, and version history table.' },
    ],
  },

  'company-profile': {
    qualityDirective: 'Create a polished, confidence-building company profile suitable for sharing with clients, partners, banks, and government agencies. Combine factual accuracy with compelling narrative. This is the business\'s primary presentation document.',
    modernPractices: 'Include digital presence, technology capabilities, sustainability commitments, and social impact if applicable. Design for both print and digital distribution.',
    sections: [
      { key: 'overview', name: 'Company Overview', guidance: 'Founded date, legal structure, registration details, headquarters, and a compelling company narrative that tells the origin story.' },
      { key: 'mission', name: 'Mission, Vision & Values', guidance: 'Concise mission statement, aspirational vision, and 3-5 core values that genuinely guide business decisions.' },
      { key: 'services', name: 'Products & Services', guidance: 'Comprehensive listing with descriptions. Highlight differentiators, specializations, and competitive advantages. Group by category if needed.' },
      { key: 'leadership', name: 'Leadership & Team', guidance: 'Key leaders with brief bios highlighting relevant experience. Include team size, expertise areas, and organizational strengths.' },
      { key: 'experience', name: 'Experience & Track Record', guidance: 'Key achievements, project highlights, years of experience, industries served, and notable milestones.' },
      { key: 'clients', name: 'Clients & Partnerships', guidance: 'Types of clients served, industry verticals, strategic partnerships, and professional affiliations.' },
      { key: 'differentiators', name: 'Why Choose Us', guidance: 'Unique selling propositions, certifications, awards, guarantees, and specific advantages over competitors.' },
      { key: 'contact', name: 'Contact Information', guidance: 'All contact channels: address, phone, email, website, social media, office hours, and map/directions if applicable.' },
    ],
  },

  'contractor-agreement': {
    qualityDirective: 'Draft a robust independent contractor agreement that clearly establishes the non-employment relationship while protecting both parties. Address the key legal risk: misclassification. Every clause should reinforce independent contractor status.',
    legalFramework: 'Reference local employment vs. contractor classification tests. For Caribbean jurisdictions, address the common-law "control test" and "integration test." Include tax withholding responsibilities and statutory compliance.',
    financialStandards: 'Address payment terms, invoicing requirements, expense policies, tax obligations (contractor is responsible for own taxes), and currency specifications.',
    modernPractices: 'Address remote work, digital deliverables, cloud tool access, data security for remote contractors, and electronic deliverable acceptance.',
    sections: [
      { key: 'parties', name: 'Parties & Engagement', guidance: 'Full legal names, addresses, tax IDs. State explicitly this is an independent contractor relationship, not employment.' },
      { key: 'scope', name: 'Scope of Work', guidance: 'Detailed deliverables, milestones, acceptance criteria, and completion standards. Reference SOW attachment if applicable.' },
      { key: 'compensation', name: 'Compensation & Invoicing', guidance: 'Fee structure (fixed, hourly, milestone), invoicing schedule, payment terms, expense reimbursement, and tax responsibilities.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'relationship', name: 'Independent Contractor Status', guidance: 'Explicit statement of independence: contractor controls methods, provides own tools, serves multiple clients, no employee benefits. This section is legally critical.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'ip', name: 'Intellectual Property & Work Product', guidance: 'Assignment of all work product to the company. Address pre-existing IP, open-source usage, and moral rights waiver.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'confidentiality', name: 'Confidentiality & Non-Disclosure', guidance: 'Scope of confidential information, duration of obligation, permitted disclosures, and return/destruction requirements.' },
      { key: 'term', name: 'Term & Termination', guidance: 'Duration, renewal, termination rights for both parties, notice requirements, and wind-down obligations.', riskScore: 'YELLOW' },
      { key: 'liability', name: 'Indemnification & Insurance', guidance: 'Mutual indemnification, required insurance coverage, and limitation of liability.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'general', name: 'General Provisions', guidance: 'Governing law, dispute resolution, entire agreement, amendments, and severability.' },
    ],
  },

  'invoice-template': {
    qualityDirective: 'Create a professional, tax-compliant invoice template that meets accounting standards and local tax authority requirements. Include all fields required for valid tax documentation.',
    financialStandards: 'Include sequential invoice numbering, VAT/tax registration numbers, itemized line items with unit pricing, subtotals, tax calculations, and payment instructions. For Trinidad, reference VAT at the current rate.',
    sections: [
      { key: 'header', name: 'Invoice Header', guidance: 'Business name, logo placeholder, address, registration number, VAT/tax ID, invoice number, date, and due date.' },
      { key: 'client', name: 'Client Information', guidance: 'Client legal name, address, contact person, purchase order number if applicable, and client reference.' },
      { key: 'items', name: 'Line Items & Pricing', guidance: 'Table structure: item description, quantity, unit price, discount, line total. Include columns for taxable/non-taxable items.' },
      { key: 'totals', name: 'Totals & Tax', guidance: 'Subtotal, discount total, taxable amount, tax rate and amount, grand total. Show in both local and foreign currency if applicable.' },
      { key: 'payment', name: 'Payment Information', guidance: 'Bank details, accepted payment methods, payment terms, late payment penalties, and online payment link placeholder.' },
      { key: 'notes', name: 'Notes & Terms', guidance: 'Standard payment terms, thank you note, return/dispute procedures, and any applicable disclaimers.' },
    ],
  },

  'website-terms': {
    qualityDirective: 'Draft enforceable website terms that protect the business while being fair and transparent to users. Address all common digital interaction scenarios. Write in plain language with legal precision.',
    legalFramework: 'Create a browsewrap/clickwrap-appropriate agreement. Reference electronic transactions legislation. For Caribbean businesses, address cross-border users. Include DMCA-equivalent takedown provisions.',
    modernPractices: 'Address user-generated content, API usage, mobile app access, third-party integrations, AI-generated content, and accessibility commitments.',
    sections: [
      { key: 'acceptance', name: 'Acceptance of Terms', guidance: 'How users agree to terms, effective date, modification process, and continued use constituting acceptance.' },
      { key: 'eligibility', name: 'Eligibility & Accounts', guidance: 'Age requirements, account creation rules, account security responsibilities, and grounds for account suspension.' },
      { key: 'permitted_use', name: 'Permitted Use', guidance: 'What users may do on the site, prohibited activities, automated access restrictions, and content guidelines.' },
      { key: 'ip', name: 'Intellectual Property', guidance: 'Ownership of site content, user license grant, trademark notices, and restrictions on copying/reproduction.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'user_content', name: 'User-Generated Content', guidance: 'License grant from users, content moderation rights, takedown procedures, and responsibility disclaimers.' },
      { key: 'purchases', name: 'Purchases & Payments', guidance: 'Pricing accuracy, order acceptance, payment processing, refund policy cross-reference, and subscription terms if applicable.' },
      { key: 'disclaimers', name: 'Disclaimers & Warranties', guidance: '"As is" provision, no warranty of availability, accuracy disclaimers, and third-party content disclaimer.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'liability', name: 'Limitation of Liability', guidance: 'Cap on damages, excluded damages, jurisdictional limitations on exclusions, and indemnification.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'governing_law', name: 'Governing Law & Disputes', guidance: 'Governing law, jurisdiction, arbitration clause if applicable, and class action waiver where enforceable.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'general', name: 'General Provisions', guidance: 'Severability, entire agreement, assignment, waiver, force majeure, and contact information.' },
    ],
  },

  'nda-employee': {
    qualityDirective: 'Draft a tight, enforceable confidentiality agreement that protects trade secrets and proprietary information without being overreaching. Unreasonably broad NDAs are unenforceable — be specific about what constitutes confidential information.',
    legalFramework: 'Reference trade secret protection under local law. Ensure reasonable scope, duration, and geographic limitation. For Caribbean jurisdictions, note that courts scrutinize overbroad restrictive covenants.',
    sections: [
      { key: 'parties', name: 'Parties', guidance: 'Disclosing party (employer) and receiving party (employee) with full legal details.' },
      { key: 'definition', name: 'Definition of Confidential Information', guidance: 'Specific, comprehensive definition including: trade secrets, client lists, financial data, business strategies, software, processes. Also clearly state what is NOT confidential.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'obligations', name: 'Obligations of Receiving Party', guidance: 'Standard of care, permitted uses, restrictions on disclosure, permitted disclosures (legal compulsion), and need-to-know basis.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'duration', name: 'Term & Survival', guidance: 'Duration of agreement, survival period after employment ends (typically 2-5 years for general info, indefinite for trade secrets).', riskScore: 'YELLOW' },
      { key: 'return', name: 'Return of Materials', guidance: 'Obligation to return or destroy all confidential materials upon termination, including digital copies, notes, and derivatives.' },
      { key: 'remedies', name: 'Remedies for Breach', guidance: 'Acknowledgment that damages may be inadequate, injunctive relief, and specific performance.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'general', name: 'General Provisions', guidance: 'Governing law, entire agreement, severability, assignment, and dispute resolution.' },
    ],
  },

  'offer-letter': {
    qualityDirective: 'Create a warm yet legally precise offer letter that excites the candidate while clearly establishing employment terms. This is both a legal document and a brand touchpoint — the first official communication as an employer.',
    legalFramework: 'Comply with local employment law requirements. For Caribbean jurisdictions, reference statutory notice periods, probation rules, and mandatory benefits. Include at-will or fixed-term language as appropriate.',
    financialStandards: 'Specify compensation with precision: base salary, currency, pay frequency, deductions, bonus eligibility, equity if applicable. Reference benefits package separately.',
    sections: [
      { key: 'greeting', name: 'Offer Introduction', guidance: 'Congratulatory tone, position title, department, reporting line, and start date. Express genuine enthusiasm.' },
      { key: 'role', name: 'Position & Responsibilities', guidance: 'Job title, key responsibilities, department, work location, full-time/part-time status, and hybrid/remote expectations.' },
      { key: 'compensation', name: 'Compensation & Benefits', guidance: 'Base salary, currency, payment frequency, bonus structure, benefits overview, and any signing bonus or relocation assistance.', riskScore: 'YELLOW' },
      { key: 'terms', name: 'Employment Terms', guidance: 'Start date, probationary period, working hours, employment type, and reference to full employment agreement or handbook.', riskScore: 'YELLOW' },
      { key: 'conditions', name: 'Conditions of Offer', guidance: 'Contingencies: background check, references, right to work verification, medical clearance if applicable.', riskScore: 'YELLOW' },
      { key: 'acceptance', name: 'Acceptance & Next Steps', guidance: 'Deadline to accept, how to accept (sign and return), who to contact with questions, and onboarding preview.', riskScore: 'RED', editableMode: 'RESTRICTED' },
    ],
  },

  'founder-agreement': {
    qualityDirective: 'Draft a comprehensive co-founder agreement that prevents the most common startup conflicts: equity disputes, role ambiguity, departure scenarios, and decision-making deadlocks. This document saves companies — be thorough.',
    legalFramework: 'Reference local company law for shareholder agreements. Address vesting schedules, drag-along/tag-along rights, and pre-emption rights under the applicable Companies Act.',
    financialStandards: 'Address initial capital contributions, equity split rationale, vesting schedule (typically 4-year with 1-year cliff), valuation mechanisms for buybacks, and distribution policies.',
    sections: [
      { key: 'parties', name: 'Founders & Company', guidance: 'All founders with full legal names, addresses, and the company\'s legal details.' },
      { key: 'equity', name: 'Equity Allocation & Vesting', guidance: 'Equity split with rationale, vesting schedule, cliff period, acceleration triggers, and anti-dilution provisions.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'roles', name: 'Roles & Responsibilities', guidance: 'Each founder\'s title, domain, decision-making authority, time commitment, and exclusivity/non-compete obligations.' },
      { key: 'contributions', name: 'Capital & IP Contributions', guidance: 'Initial capital, IP assignments, ongoing funding obligations, and valuation of non-cash contributions.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'governance', name: 'Decision-Making & Governance', guidance: 'Board composition, voting thresholds, reserved matters requiring unanimity, and deadlock resolution mechanisms.', riskScore: 'YELLOW' },
      { key: 'compensation', name: 'Founder Compensation', guidance: 'Initial salary (if any), when salaries begin, adjustment mechanisms, expense policies, and benefit parity.', riskScore: 'YELLOW' },
      { key: 'departure', name: 'Departure & Transfer', guidance: 'Voluntary/involuntary exit provisions, buyback rights, valuation formula, drag-along/tag-along rights, and non-compete post-departure.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'ip', name: 'Intellectual Property', guidance: 'All IP created for the company is company property. Address pre-existing IP, side projects, and open-source contributions.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'dispute', name: 'Dispute Resolution', guidance: 'Mediation first, then arbitration. Include deadlock provisions and shotgun clause if appropriate.', riskScore: 'YELLOW' },
      { key: 'general', name: 'General Provisions', guidance: 'Confidentiality, entire agreement, amendments, governing law, and insurance (D&O).' },
    ],
  },

  'compliance-policy': {
    qualityDirective: 'Create a compliance framework document that establishes clear accountability, practical procedures, and measurable standards. This must be implementable, not just aspirational. Include monitoring mechanisms and consequences for non-compliance.',
    legalFramework: 'Reference all applicable regulatory frameworks for the business\'s industry and jurisdiction. Include penalties for non-compliance. Address both local and international regulations that may apply.',
    modernPractices: 'Address digital compliance (data privacy, cybersecurity, online marketing rules), ESG considerations, whistleblower protections, and automated compliance monitoring.',
    sections: [
      { key: 'overview', name: 'Policy Overview & Commitment', guidance: 'Statement of commitment to compliance from leadership. Scope, applicability, and relationship to other policies.' },
      { key: 'framework', name: 'Regulatory Framework', guidance: 'List all applicable laws, regulations, and industry standards with brief descriptions of their requirements.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'governance', name: 'Compliance Governance', guidance: 'Compliance officer role, reporting structure, compliance committee, board oversight, and independence guarantees.' },
      { key: 'risk_assessment', name: 'Risk Assessment & Monitoring', guidance: 'How compliance risks are identified, assessed, and prioritized. Include risk register methodology and monitoring frequency.' },
      { key: 'policies', name: 'Key Compliance Areas', guidance: 'Detailed sub-policies for each major compliance area: anti-bribery, conflicts of interest, competition law, sanctions, licensing, and environmental.' },
      { key: 'training', name: 'Training & Awareness', guidance: 'Mandatory training programs, frequency, record-keeping, and testing/certification requirements.' },
      { key: 'reporting', name: 'Reporting & Whistleblowing', guidance: 'How to report concerns, whistleblower protections, investigation process, and no-retaliation guarantee.', riskScore: 'YELLOW' },
      { key: 'enforcement', name: 'Enforcement & Consequences', guidance: 'Disciplinary measures for non-compliance, ranging from retraining to termination. Include escalation matrix.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'records', name: 'Record-Keeping & Audit', guidance: 'Compliance documentation requirements, audit schedule, external audit provisions, and records retention.' },
      { key: 'review', name: 'Review & Updates', guidance: 'Annual review process, triggers for interim updates, approval chain for changes, and version control.' },
    ],
  },

  'aml-policy': {
    qualityDirective: 'Draft an AML policy that demonstrates genuine commitment to preventing money laundering and terrorist financing. This must satisfy regulatory inspection — it needs specific procedures, not just principles.',
    legalFramework: 'Reference the Proceeds of Crime Act and Financial Obligations Regulations for Caribbean jurisdictions. Address FATF recommendations. Include STR/SAR filing obligations and penalties for non-compliance.',
    financialStandards: 'Include transaction monitoring thresholds, cash reporting limits, unusual activity indicators, and record retention periods as required by law.',
    sections: [
      { key: 'overview', name: 'Policy Statement', guidance: 'Organization\'s commitment to AML/CFT compliance, scope, and applicability.' },
      { key: 'cdd', name: 'Customer Due Diligence', guidance: 'KYC procedures, identity verification requirements, beneficial ownership identification, and enhanced due diligence triggers.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'risk_assessment', name: 'Risk-Based Approach', guidance: 'Customer risk categorization, product/service risk, geographic risk, and channel risk. Include risk scoring methodology.' },
      { key: 'monitoring', name: 'Transaction Monitoring', guidance: 'Monitoring procedures, suspicious activity indicators (red flags), escalation procedures, and technology tools used.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'reporting', name: 'Suspicious Activity Reporting', guidance: 'STR/SAR filing procedures, reporting timelines, tipping-off prohibitions, and interaction with Financial Intelligence Unit.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'records', name: 'Record Keeping', guidance: 'Retention periods (minimum 5-7 years), types of records, storage requirements, and retrieval procedures.' },
      { key: 'training', name: 'Staff Training', guidance: 'Training frequency, content requirements, attendance tracking, and ongoing awareness programs.' },
      { key: 'governance', name: 'Compliance Officer & Governance', guidance: 'MLRO/Compliance Officer appointment, qualifications, independence, reporting to board, and annual compliance reporting.' },
      { key: 'sanctions', name: 'Sanctions Screening', guidance: 'Sanctions list screening procedures, frequency, technology used, and escalation for potential matches.' },
    ],
  },

  'brand-guidelines': {
    qualityDirective: 'Create authoritative brand guidelines that ensure visual and verbal consistency across all touchpoints. Include specific, measurable rules — not vague guidance. Anyone should be able to apply these guidelines without consulting the designer.',
    modernPractices: 'Address digital-first applications: social media, email, mobile, dark mode, responsive design, motion/animation principles, and accessibility standards (WCAG contrast ratios).',
    sections: [
      { key: 'overview', name: 'Brand Overview', guidance: 'Brand story, positioning, personality traits, and the core promise. Set the emotional foundation for all visual decisions.' },
      { key: 'logo', name: 'Logo Usage', guidance: 'Primary/secondary/icon versions, minimum sizes, clear space rules, color variations, and prohibited modifications. Include specific measurements.' },
      { key: 'color', name: 'Color Palette', guidance: 'Primary, secondary, and accent colors with exact HEX, RGB, CMYK, and Pantone values. Include usage ratios, background rules, and accessible combinations.' },
      { key: 'typography', name: 'Typography', guidance: 'Primary and secondary typefaces, weights, sizes for headings/body/captions, line height, letter spacing, and web font specifications.' },
      { key: 'imagery', name: 'Photography & Imagery', guidance: 'Photography style, subject guidelines, color treatment, illustration style, icon style, and image don\'ts.' },
      { key: 'voice', name: 'Voice & Tone', guidance: 'Writing principles, vocabulary preferences, tone by context (formal/casual/urgent), and examples of on-brand vs. off-brand copy.' },
      { key: 'applications', name: 'Applications', guidance: 'Business cards, letterhead, email signatures, social media profiles, presentations, and packaging templates with specifications.' },
      { key: 'digital', name: 'Digital Standards', guidance: 'Website component styles, button styles, form styles, mobile app design tokens, dark mode adaptations, and animation principles.' },
    ],
  },

  'data-handling': {
    qualityDirective: 'Create a practical internal policy that staff can actually follow day-to-day. Focus on specific procedures and decision trees, not abstract principles. Include data classification levels with concrete examples.',
    legalFramework: 'Reference applicable data protection legislation. Address data subject access request procedures, breach notification timelines, and cross-border transfer rules.',
    sections: [
      { key: 'classification', name: 'Data Classification', guidance: 'Define classification levels (Public, Internal, Confidential, Restricted) with examples of each from the actual business context.' },
      { key: 'collection', name: 'Data Collection Standards', guidance: 'Lawful basis requirements, consent mechanisms, purpose limitation, data minimization, and collection procedures by channel.' },
      { key: 'storage', name: 'Storage & Access', guidance: 'Where data is stored by classification level, access controls, encryption requirements, and cloud storage policies.' },
      { key: 'processing', name: 'Processing & Use', guidance: 'Permitted processing activities, automated decision-making rules, profiling restrictions, and purpose limitation enforcement.' },
      { key: 'sharing', name: 'Data Sharing & Transfers', guidance: 'Internal sharing protocols, third-party sharing requirements, cross-border transfer safeguards, and data processing agreements.' },
      { key: 'retention', name: 'Retention & Disposal', guidance: 'Retention schedules by data type, secure deletion procedures, and archive vs. destroy decisions.' },
      { key: 'breach', name: 'Breach Response', guidance: 'Incident identification, containment steps, assessment, notification timelines (internal and regulatory), and post-incident review.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'training', name: 'Training & Compliance', guidance: 'Mandatory data handling training, frequency, record-keeping, and consequences of policy violations.' },
    ],
  },

  'business-continuity': {
    qualityDirective: 'Create a genuinely actionable BCP that the team can execute under pressure. Include specific contact chains, recovery time objectives, and step-by-step procedures. Avoid generic advice — tailor everything to the business\'s actual operations and risks.',
    modernPractices: 'Address both physical and digital disruptions: cyberattacks, cloud outages, remote work failover, supply chain disruption, social media crisis, and pandemic scenarios.',
    sections: [
      { key: 'overview', name: 'Plan Overview & Activation', guidance: 'Plan purpose, scope, activation triggers, authority to activate, and communication protocol for plan activation.' },
      { key: 'risk_analysis', name: 'Business Impact Analysis', guidance: 'Critical functions ranked by priority, maximum tolerable downtime, recovery time objectives (RTO), and recovery point objectives (RPO).' },
      { key: 'scenarios', name: 'Risk Scenarios', guidance: 'Top 5-10 disruption scenarios specific to this business with likelihood, impact, and tailored response for each.' },
      { key: 'response', name: 'Immediate Response Procedures', guidance: 'First 24-72 hours: life safety, damage assessment, stakeholder notification, and initial recovery steps.' },
      { key: 'recovery', name: 'Recovery Procedures', guidance: 'Detailed steps to restore each critical function: IT systems, customer service, supply chain, facilities, and communications.' },
      { key: 'contacts', name: 'Emergency Contacts & Resources', guidance: 'Contact chain with primary and backup contacts: leadership, IT, suppliers, insurance, legal, and emergency services.' },
      { key: 'communication', name: 'Crisis Communication Plan', guidance: 'Internal communication channels, customer notification templates, media response protocols, and social media management.' },
      { key: 'testing', name: 'Testing & Maintenance', guidance: 'Testing schedule (tabletop exercises, drills), update triggers, annual review process, and lessons learned integration.' },
    ],
  },

  'cross-border-agreement': {
    qualityDirective: 'Draft a service agreement designed for international engagements with clear allocation of risks across jurisdictions. Address the most common cross-border pitfalls: tax withholding, currency risk, conflicting laws, and enforcement.',
    legalFramework: 'Include choice of law and jurisdiction clauses with care. Address conflict of laws, recognition and enforcement of judgments, and international arbitration options (ICC, LCIA). Reference relevant double taxation treaties.',
    financialStandards: 'Address multi-currency billing, exchange rate mechanisms, withholding tax obligations, transfer pricing considerations, and international payment methods.',
    sections: [
      { key: 'parties', name: 'Parties & Jurisdictions', guidance: 'Full legal names, addresses, registration numbers, and jurisdiction of incorporation for each party.' },
      { key: 'scope', name: 'Scope & Deliverables', guidance: 'Services, deliverables, and performance locations. Specify where services are performed vs. where they are received.' },
      { key: 'compensation', name: 'Compensation & Currency', guidance: 'Payment amounts, currency, exchange rate mechanism, withholding tax responsibilities, and cross-border payment methods.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'tax', name: 'Tax & Compliance', guidance: 'Tax residency declarations, withholding obligations, VAT/GST treatment, transfer pricing compliance, and tax certificate requirements.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'ip', name: 'Intellectual Property', guidance: 'IP ownership by jurisdiction, cross-border licensing, moral rights by jurisdiction, and registration requirements.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'data', name: 'Data Protection & Cross-Border Transfers', guidance: 'Applicable data protection regimes, cross-border transfer mechanisms, and data localization requirements.', riskScore: 'YELLOW' },
      { key: 'dispute', name: 'Governing Law & Dispute Resolution', guidance: 'Choice of law, jurisdiction, international arbitration clause, enforcement of awards/judgments, and language of proceedings.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'compliance', name: 'Regulatory & Sanctions Compliance', guidance: 'Anti-corruption representations, sanctions screening obligations, export control compliance, and local regulatory requirements.' },
      { key: 'general', name: 'General Provisions', guidance: 'Force majeure (with pandemic/sanctions triggers), assignment, notices, entire agreement, and language precedence.' },
    ],
  },

  'vendor-agreement': {
    qualityDirective: 'Draft a vendor agreement that protects the business as buyer while maintaining fair partnership dynamics. Focus on quality assurance, delivery reliability, and clear remedies for non-performance.',
    legalFramework: 'Reference sale of goods legislation and commercial contract law for the jurisdiction. Include warranty provisions and limitation periods.',
    financialStandards: 'Address pricing mechanisms (fixed, variable, indexed), payment terms, volume discounts, price adjustment triggers, and audit rights.',
    sections: [
      { key: 'parties', name: 'Parties & Background', guidance: 'Full legal names, addresses, and context of the vendor relationship.' },
      { key: 'products_services', name: 'Products/Services & Specifications', guidance: 'Detailed specifications, quality standards, acceptance criteria, and performance benchmarks.' },
      { key: 'pricing', name: 'Pricing & Payment', guidance: 'Unit pricing, volume tiers, payment terms, currency, invoicing requirements, and price adjustment mechanisms.', riskScore: 'YELLOW' },
      { key: 'delivery', name: 'Delivery & Performance', guidance: 'Delivery schedules, lead times, shipping terms (Incoterms if applicable), and penalties for late delivery.' },
      { key: 'quality', name: 'Quality Assurance & Warranties', guidance: 'Quality standards, inspection rights, warranty period, warranty claims process, and defect remediation.', riskScore: 'YELLOW' },
      { key: 'liability', name: 'Liability & Indemnification', guidance: 'Product liability, consequential damages, indemnification for third-party claims, and insurance requirements.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'ip', name: 'Intellectual Property', guidance: 'IP ownership of custom-developed items, pre-existing IP licenses, and infringement indemnification.' },
      { key: 'confidentiality', name: 'Confidentiality', guidance: 'Mutual confidentiality obligations, permitted disclosures, and duration.' },
      { key: 'term', name: 'Term, Termination & Transition', guidance: 'Contract duration, renewal, termination triggers, notice period, and transition assistance obligations.', riskScore: 'YELLOW' },
      { key: 'general', name: 'General Provisions', guidance: 'Governing law, dispute resolution, force majeure, assignment, and compliance with laws.' },
    ],
  },

  'termination-letter': {
    qualityDirective: 'Draft a respectful, legally compliant termination letter that clearly communicates the decision while minimizing legal exposure. Be direct but compassionate. Every statement must be factually defensible.',
    legalFramework: 'Comply with local labor law notice requirements. For Caribbean jurisdictions, reference applicable employment legislation for minimum notice periods, severance calculations, and prohibited grounds for dismissal.',
    financialStandards: 'Detail all final compensation: last day worked, accrued vacation payout, severance if applicable, benefits continuation, and timeline for final payment.',
    sections: [
      { key: 'notification', name: 'Termination Notice', guidance: 'Clear statement of employment termination, effective date, and reason (performance, redundancy, restructuring). Be factual, not emotional.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'terms', name: 'Final Employment Terms', guidance: 'Last working day, garden leave if applicable, transition responsibilities, and handover expectations.' },
      { key: 'compensation', name: 'Final Compensation & Benefits', guidance: 'Final paycheck date, accrued vacation/leave payout, severance package details, bonus prorations, and benefits continuation.', riskScore: 'RED', editableMode: 'RESTRICTED' },
      { key: 'obligations', name: 'Continuing Obligations', guidance: 'Confidentiality, non-compete/non-solicitation reminders, IP assignment, and return of company property.' },
      { key: 'support', name: 'Transition Support', guidance: 'Outplacement assistance if offered, reference policy, and support resources available.' },
      { key: 'next_steps', name: 'Next Steps', guidance: 'Return of equipment/access, exit interview, final documentation, and contact person for questions.' },
    ],
  },

  'leave-policy': {
    qualityDirective: 'Create a clear, fair leave policy that employees can reference independently. Cover all leave types comprehensively with specific entitlements, eligibility criteria, and procedures.',
    legalFramework: 'Reference local statutory leave minimums. For Trinidad & Tobago: Maternity Protection Act, minimum vacation entitlements, and public holiday requirements.',
    sections: [
      { key: 'overview', name: 'Policy Overview', guidance: 'Scope, eligibility, and general principles governing all leave types.' },
      { key: 'vacation', name: 'Annual/Vacation Leave', guidance: 'Entitlement by tenure, accrual method, carry-over rules, blackout periods, and request procedures.' },
      { key: 'sick', name: 'Sick Leave', guidance: 'Entitlement, medical certificate requirements, extended illness procedures, and return-to-work protocols.' },
      { key: 'maternity_paternity', name: 'Maternity & Paternity Leave', guidance: 'Duration, eligibility, pay during leave, return-to-work protections, and adoption leave if applicable.', riskScore: 'YELLOW' },
      { key: 'personal', name: 'Personal & Bereavement Leave', guidance: 'Entitlement, qualifying relationships for bereavement, and approval procedures.' },
      { key: 'other', name: 'Other Leave Types', guidance: 'Jury duty, study leave, sabbatical, religious observance, and unpaid leave of absence policies.' },
      { key: 'procedures', name: 'Request & Approval Procedures', guidance: 'How to request leave, advance notice requirements, approval authority, and emergency leave procedures.' },
      { key: 'public_holidays', name: 'Public Holidays', guidance: 'Recognized public holidays, policy for working on holidays, and floating holiday provisions.' },
    ],
  },
};

export const CATEGORY_QUALITY_DIRECTIVES: Record<string, string> = {
  'identity': 'Company identity documents must be factually precise and reflect the legal reality of the business. Cross-reference all registration details, ownership structures, and license information against the business profile. These documents may be submitted to government agencies, banks, and partners — accuracy is non-negotiable.',

  'finance-tax': 'Financial documents must comply with local accounting standards and tax authority requirements. Use precise numerical formatting, include all legally required fields (tax IDs, registration numbers), and reference current tax rates. For Caribbean businesses, address VAT/GCT at applicable rates. All calculations must be verifiable.',

  'commercial': 'Commercial documents must be persuasive yet legally sound. Proposals should sell while agreements should protect. Every commercial term must be specific: no "TBD" pricing, no vague timelines, no undefined scope. Include clear acceptance mechanisms and dispute resolution.',

  'brand-messaging': 'Brand documents must authentically reflect the business\'s personality, market position, and value proposition. Avoid generic corporate language — every phrase should be specific to THIS business. Use the business context data to generate genuinely personalized content that a founder would recognize as their own.',

  'operations': 'Operational documents must be executable by someone who has never performed the task before. Use numbered steps, decision trees, checklists, and clear success criteria. Include troubleshooting for common failure points. Design for consistency and repeatability.',

  'audit-recordkeeping': 'Audit and recordkeeping documents must establish clear traceability, accountability, and compliance evidence. Include version control, approval workflows, and retention schedules. These documents may be examined by regulators — structure them accordingly.',

  'hr': 'HR documents carry significant legal exposure and directly impact employee relations. Comply with local employment legislation in every clause. Balance legal protection with employee-friendly tone. For Caribbean jurisdictions, reference relevant labor acts, statutory benefits, and mandatory notice periods.',

  'contractors': 'Contractor documents must unambiguously establish the independent contractor relationship to prevent misclassification claims. Every clause should reinforce that the contractor controls HOW work is performed. Address IP ownership, tax responsibilities, and insurance requirements explicitly.',

  'privacy-data': 'Privacy documents must satisfy both legal compliance and user trust. Use plain language for public-facing policies while maintaining legal precision. Reference applicable data protection legislation by name. Address the full data lifecycle: collection, processing, storage, sharing, retention, and deletion.',

  'website-ecommerce': 'Website legal documents must be enforceable in digital contexts. Address the unique challenges of online agreements: browsewrap vs. clickwrap, electronic consent, cross-border users, automated transactions, and digital content delivery. Include DMCA/takedown procedures and accessibility commitments.',

  'founders-investors': 'Founder and investor documents govern the most consequential business relationships. Be exhaustively thorough — every ambiguity becomes a dispute when money or control is at stake. Include vesting schedules, exit mechanisms, valuation formulas, and deadlock resolution. These documents should survive 10+ years of business evolution.',

  'vendors': 'Vendor documents should protect the business as buyer while fostering reliable supplier relationships. Focus on quality assurance, delivery reliability, and clear remedies for non-performance. Include audit rights, termination assistance, and transition support.',

  'insurance-risk': 'Insurance and risk documents must be precise enough to support claims and audits. Include specific policy numbers, coverage amounts, deductibles, and renewal dates. Risk assessments should use recognized frameworks (likelihood × impact) with specific mitigation actions and owners.',

  'brand-ip': 'Brand and IP documents protect the business\'s most valuable intangible assets. Be specific about what is protected, how it can be used, and what constitutes infringement. Include registration details, renewal dates, and enforcement procedures.',

  'facilities': 'Facilities documents must capture all material terms and conditions for physical assets. Include specific addresses, measurements, condition assessments, and maintenance responsibilities. Reference applicable property law and insurance requirements.',

  'inventory-quality': 'Inventory and quality documents must establish measurable standards and traceable processes. Include specific metrics, tolerance ranges, inspection frequencies, and corrective action procedures. Reference industry quality standards (ISO, etc.) where applicable.',

  'regulatory': 'Regulatory compliance documents must demonstrate genuine, implementable compliance — not just awareness. Reference specific regulations by name and section number. Include monitoring procedures, reporting requirements, and consequences for non-compliance. These documents may be examined by regulators under adversarial conditions.',

  'international': 'International documents must navigate multiple legal systems simultaneously. Specify which jurisdiction governs each obligation. Address tax treaty implications, currency risk, cross-border data transfers, sanctions screening, and enforcement of judgments across borders. Assume readers may be in different legal systems.',
};

export const SENSITIVITY_QUALITY_LAYERS: Record<string, string> = {
  legal: `LEGAL SENSITIVITY REQUIREMENTS:
- Use precise legal terminology consistently throughout
- Define all key terms in a definitions section or upon first use
- Include specific governing law and jurisdiction references
- Add appropriate severability clauses so individual invalid provisions don't void the whole document
- Reference specific legislation, statutes, or regulations by name where applicable
- For Caribbean jurisdictions, cite local Acts and Ordinances (e.g., Companies Act, Employment Relations Act)
- Include effective dates, amendment procedures, and version control
- Mark any section containing legal conclusions or liability allocation with riskScore RED
- Add a disclaimer that this document was AI-generated and should be reviewed by a qualified attorney before reliance`,

  financial: `FINANCIAL SENSITIVITY REQUIREMENTS:
- Use exact figures and formulas rather than vague terms like "competitive rates"
- Specify currency (default to TTD for Trinidad-based businesses, or business's operating currency)
- Include tax treatment: VAT/GCT rates, withholding tax, and tax-inclusive vs. exclusive pricing
- Reference payment terms with specific day counts (Net 30, Net 15, etc.)
- Include late payment consequences with specific interest rates (per annum)
- For financial templates, include all fields required by local tax authorities
- Address multi-currency scenarios if the business operates internationally
- Include audit trail requirements for financial records`,

  brand: `BRAND SENSITIVITY REQUIREMENTS:
- Deeply personalize all content using the business's actual name, industry, services, tagline, and description
- Mirror the brand's tone of voice — energetic vs. formal, playful vs. authoritative — based on business profile
- Use specific examples from the business's actual services, products, and client types
- Avoid generic placeholder language ("Lorem ipsum", "[Your Company]", "XYZ Corp")
- Ensure visual and verbal consistency with any stated brand guidelines
- Reference the business's unique value proposition and competitive differentiators
- For Caribbean businesses, incorporate culturally appropriate language and context`,

  jurisdiction: `JURISDICTION SENSITIVITY REQUIREMENTS:
- Reference specific local laws and regulations by name and section
- For Trinidad & Tobago: reference Companies Act, VAT Act, Data Protection Act 2011, Industrial Relations Act, Occupational Safety and Health Act, Environmental Management Act, Proceeds of Crime Act, as applicable
- For other Caribbean jurisdictions: reference equivalent local legislation
- Address CARICOM treaty implications if cross-border within the Caribbean
- Include relevant regulatory bodies and their filing requirements
- Specify local compliance deadlines and renewal dates where applicable
- Address any jurisdiction-specific consumer protection requirements
- Note where international standards (GDPR, SOX, PCI-DSS) may apply to local businesses serving international clients`,
};

export function getDocumentBlueprint(slug: string): DocumentBlueprint | null {
  return DOCUMENT_BLUEPRINTS[slug] || null;
}

export function getCategoryDirective(categorySlug: string): string {
  return CATEGORY_QUALITY_DIRECTIVES[categorySlug] || '';
}

export function getSensitivityLayers(docType: {
  brandSensitive: boolean;
  financialSensitive: boolean;
  legalSensitive: boolean;
  jurisdictionSensitive: boolean;
}): string[] {
  const layers: string[] = [];
  if (docType.legalSensitive) layers.push(SENSITIVITY_QUALITY_LAYERS.legal);
  if (docType.financialSensitive) layers.push(SENSITIVITY_QUALITY_LAYERS.financial);
  if (docType.brandSensitive) layers.push(SENSITIVITY_QUALITY_LAYERS.brand);
  if (docType.jurisdictionSensitive) layers.push(SENSITIVITY_QUALITY_LAYERS.jurisdiction);
  return layers;
}
