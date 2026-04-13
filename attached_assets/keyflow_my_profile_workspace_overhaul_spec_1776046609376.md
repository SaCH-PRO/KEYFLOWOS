# KeyFlow My Profile Workspace Overhaul Spec
## AI Coder Implementation Document

### Objective
Redesign and strengthen the **My Profile** workspace comprehensively without removing functionality. Preserve the current capabilities for personal profile, business profile, professional identity, business intelligence progress, intelligence packages, recommended documents, and security/preferences, but reorganize the page so it becomes a clear, premium **identity and intelligence foundation layer** for the entire system.

This page must not behave like a generic settings screen. It should become the place where the user defines who they are, what business they run, what stage they are in, what intelligence the system can generate, and which outputs the rest of the app can use.

Do not remove features. Improve information architecture, module clarity, downstream linkage, AI usefulness, and cross-system relevance.

---

## 1. Product Goal

The My Profile workspace should support five connected jobs:

1. **Manage personal identity**
   - user profile
   - display name
   - contact information
   - public/professional bio

2. **Define business identity**
   - business name
   - description
   - industry
   - stage
   - location
   - operating hours
   - team size

3. **Power the system’s intelligence**
   - business foundation
   - business maturity
   - business intelligence engine
   - AI package generation
   - recommendations

4. **Generate business outputs**
   - intelligence package
   - recommended documents
   - legal/financial/compliance materials
   - next-step guidance

5. **Manage account settings**
   - password
   - appearance
   - preferences

The final workspace should feel:
- foundational
- strategic
- intelligent
- premium
- useful
- system-wide

This page should become the **identity and intelligence root layer** of KeyFlow.

---

## 2. Existing Strengths to Preserve

Keep these strengths:

1. **Business Foundation progress**
2. **What KeyFlowOS sees**
3. **Business Intelligence progress and maturity layers**
4. **Business Intelligence Package**
5. **Recommended Documents**
6. **Personal profile details**
7. **Business profile fields**
8. **Professional profile fields**
9. **Security and appearance controls**
10. **AI-assisted generate buttons and contextual generation hints**

Do not regress these.

---

## 3. Core Problems to Solve

### A. Too many roles are stacked into one vertical experience
The page currently combines:
- personal profile
- business profile
- business maturity
- AI intelligence package
- recommended documents
- professional profile
- password
- appearance

That makes the page broad but not coherent enough.

### B. “My Profile” is underselling what this workspace actually is
This page is much more than a profile page. It is also:
- business identity
- intelligence readiness
- document engine
- business planning substrate
- recommendation source

### C. Information hierarchy is not strong enough
Intelligence, forms, generated outputs, and settings all compete in the same long page.

### D. Business intelligence surfaces are important enough to deserve clearer grouping
The Business Intelligence Engine and Intelligence Package are some of the strongest concepts in the product and need more deliberate structure.

### E. Forms are useful but too long-form and not sufficiently outcome-linked
The user needs clearer feedback on what each section unlocks and which modules become smarter because of the data.

### F. Recommended documents are strong but too disconnected from the rest of the system
Documents should visibly support other modules such as Revenue, Projects, Clients, Calendar, Content, and Flows.

### G. Security/preferences are valid but should be more isolated
These settings should not visually compete with business intelligence and profile-building.

---

## 4. Required Outcome

After overhaul, the My Profile workspace must support:

- clear separation of personal, business, intelligence, document, and preference layers
- stronger explanation of why fields matter
- more visible linkage to downstream modules
- more structured business maturity and intelligence guidance
- clearer AI outputs and regeneration paths
- a more coherent and premium identity foundation experience

---

## 5. Information Architecture

### Sidebar label
If this area remains under the current route, the user-facing label can stay **Profile**.

### Recommended page title
Prefer:
- **Profile & Intelligence**
or
- **Business Profile**
or
- **Profile**

If retaining **My Profile**, the subtitle must do more work.

Recommended subtitle:
> Manage your identity, business foundation, intelligence, and system-ready documents.

This better reflects the real role of the page.

---

## 6. Final Top-Level Mode Structure

This is the most important structural change.

Split the page into strong internal modes:

1. **Overview**
2. **Business**
3. **Professional**
4. **Documents & Intelligence**
5. **Security & Preferences**

This immediately solves most of the current architectural confusion.

---

## 7. Overview Mode

Overview should be the strategic landing layer.

### Include:
- Business Foundation completion
- What KeyFlowOS sees
- Business Intelligence progress
- major maturity areas
- recommended next steps
- key unlocks
- critical missing fields
- top document recommendations
- recent generated outputs / intelligence package status

### Purpose
When the user lands here, they should immediately understand:
- what the system knows
- what is missing
- what becomes stronger next
- what the AI can already generate

This mode should feel like the summary dashboard of the profile/intelligence system.

---

## 8. Business Mode

Move the business-facing data here.

### Include:
- Business Identity
- Team & Scale
- Operating Hours
- Industry & Stage
- Location
- related business metadata

### For each section, show:
- completion state
- why it matters
- what it powers
- downstream module impact

### Example field impact notes
- **Industry** → powers templates, recommended documents, strategy guidance
- **Business Stage** → powers growth recommendations and intelligence package logic
- **Team Size** → powers staffing, operations, and automation recommendations
- **Operating Hours** → powers bookings and storefront display
- **Location** → powers tax, compliance, permit guidance, and local relevance

This makes the forms feel more alive and purposeful.

---

## 9. Professional Mode

Separate public/professional identity from business-operating identity.

### Include:
- Identity & Bio
- Professional Headline
- Skills & Expertise
- Interests
- public-facing professional details

### Purpose
This mode should answer:
- how the user/business appears publicly
- what expertise and positioning are being communicated
- what Profile/Community/Marketplace presence is being shaped

This helps prevent business setup from being mixed with personal/professional presentation.

---

## 10. Documents & Intelligence Mode

This should become a first-class, highly strategic surface.

### Include:
- Business Intelligence Engine
- Business Intelligence Package
- quality scorecard
- confidence assessment
- key assumptions
- needs validation
- expert review needed
- take action buttons
- recommended documents
- regenerate/export/share actions

This mode should feel like:
> the place where raw profile/business data becomes strategic output.

This is one of the strongest opportunities in the product.

---

## 11. Security & Preferences Mode

Move all account-specific, lower-context settings here.

### Include:
- Change Password
- Appearance
- future preferences
- account-specific settings

### Purpose
These are valid and important, but they should not interrupt the business/intelligence story of the main profile experience.

---

## 12. Overview Mode Detailed Requirements

### 12.1 Business Foundation Summary
Keep the current progress indicator, but add:
- missing highest-impact items
- current unlock status
- next best step

Example:
- Complete target customer profile to improve CRM and marketing AI
- Complete revenue profile to unlock smarter cash flow guidance

### 12.2 What KeyFlowOS Sees
Keep and strengthen this section.

Required visible fields:
- business name
- industry
- stage
- location
- team size
- service type / business model if available

Add copy like:
> This data powers AI recommendations, documents, templates, and module-level guidance across KeyFlow.

This section is extremely valuable and should remain prominent.

### 12.3 Intelligence Readiness
Add a compact summary for:
- foundation
- market position
- operations
- financial reality
- strategy

For each, show:
- score/progress
- what is missing
- what it unlocks

---

## 13. Business Intelligence Engine Overhaul

The Business Intelligence Engine is one of the strongest concepts in the app and should be treated as a premium product surface.

### It should include:
- maturity stages
- completion progress
- conceptualize / execute / maintain / profit & scale mapping
- stage-specific outputs
- package generation status
- recommended actions

### Improve with:
- clearer explanation of each maturity lane
- stronger next-step guidance
- visible connection to module improvements

### Example
- Complete “Market Position” to improve Content, Clients, and Revenue recommendations
- Complete “Operations” to improve Flows, Projects, and Documents guidance

This ties intelligence directly into the rest of the system.

---

## 14. Business Intelligence Package Overhaul

The Intelligence Package deserves stronger presentation and structure.

### Preserve:
- brief
- canvas
- SWOT
- finance
- roadmap
- actions
- risks
- govern

### Improve:
- clearer packaging as a generated strategic asset
- better summary panel
- generation status/history
- regenerate controls with explanation
- versioning and confidence interpretation
- stronger connections to:
  - Documents
  - Revenue
  - Projects
  - Reports
  - Flows

### Add:
- “what changed since last generation”
- “what data this package is based on”
- “what confidence is reduced by missing fields”

This makes the package feel more rigorous and useful.

---

## 15. Recommended Documents Overhaul

The Recommended Documents section is already strong and should be made more system-linked.

### Keep:
- categorized document recommendations
- priority tags
- legal / financial / constitutional grouping

### Improve by showing:
- why the document is recommended
- which business stage it supports
- which module(s) it affects
- whether data is sufficient to generate it
- what missing fields would improve it

### Examples of module linkage
- Client Service Agreement → Clients + Projects
- Financial Statement → Revenue + Reports
- Privacy Policy → storefront/public presence + compliance
- Terms of Service → public pages + Revenue + marketplace/storefront
- Budget Template → Revenue + Reports
- License & Permit Register → Flows reminders + compliance tracking

This is critical.
Documents should feel embedded in the system, not just suggested from the profile page.

---

## 16. Forms and Section Behavior Rules

All data-entry sections in Business and Professional modes should follow these rules:

### Each section should show:
- completion %
- fields completed / total
- unlocks or impact
- recommended next step

### Example
**Industry & Stage**
- 2/2 complete
- Powers smarter documents, market guidance, and growth recommendations

**Team & Scale**
- 1/3 complete
- Completing this improves automation and staffing recommendations

### This shifts the experience from:
- form filling

to:
- intelligence activation

---

## 17. AI Integration Requirements

The My Profile workspace must deeply feed the AI and receive AI assistance in a similar, system-wide manner.

### AI should use this page to:
- understand business context
- infer missing strategic gaps
- generate better documents
- improve recommendations in every module
- improve module-specific guidance across Clients, Calendar, Revenue, Content, Flows, and Projects

### AI should help the user here by:
- generating tagline
- generating business description
- refining headline and bio
- suggesting skills
- explaining why a field matters
- recommending next best completion step
- regenerating the business intelligence package
- identifying missing data weakening confidence

This is one of the most important pages for AI leverage.

---

## 18. Cross-Module Intelligence Requirements

This page must feed the rest of the app.

### Business data from Profile should affect:
- **Clients** → ideal customer / relationship guidance / segment interpretation
- **Calendar** → operating hours / service readiness / scheduling context
- **Revenue** → financial assumptions / compliance / document readiness
- **Content** → audience framing / positioning / offer communication
- **Flows** → recommended automations by stage/business type
- **Projects** → delivery templates / package-to-project mapping / role structure
- **Documents** → all recommendations and generation quality

### This should be visible in the UI
Users should not have to guess why the data matters.

For example:
> Completing Business Stage improves growth guidance in Revenue, Content, and Flows.

---

## 19. Recommended Next Steps Engine

Overview mode should include a prioritized list of “best next steps.”

### Examples:
- Define your customer profile to sharpen CRM and marketing AI
- Complete your revenue profile to unlock smarter financial forecasts
- Add operating hours to improve bookings and storefront readiness
- Finish business description to improve documents and public profile
- Generate intelligence package after completing Market Position

This is one of the clearest ways to make the page feel active and intelligent.

---

## 20. Public / Professional / Internal Separation

The page should more clearly distinguish:

### A. Internal operating data
Used for AI, recommendations, and business planning

### B. Public/professional-facing data
Used for community profile, public presence, and bio

### C. Account settings
Used for password, appearance, preferences

This distinction will dramatically improve coherence.

---

## 21. Visual Hierarchy Rules

### The page should feel like:
- identity foundation
- intelligence unlock system
- generated outputs hub

### Keep:
- calm visual style
- clean cards
- progress indicators
- AI assist buttons

### Improve:
- stronger mode separation
- less endless vertical stacking
- clearer “what this powers” messaging
- better grouping of generated outputs
- better isolation of settings/preferences

### Avoid:
- mixing password/theme controls into strategic business planning areas
- making the user feel they are filling a giant settings form
- hiding the downstream effect of data fields

---

## 22. Suggested Final Component Tree

```text
ProfileWorkspace
  ProfileHeader
    Breadcrumbs
    Title + subtitle

  ProfileModeTabs
    Overview
    Business
    Professional
    DocumentsAndIntelligence
    SecurityAndPreferences

  OverviewView
    FoundationSummary
    WhatKeyFlowSees
    IntelligenceReadiness
    RecommendedNextSteps
    KeyUnlocks
    TopDocumentRecommendations

  BusinessView
    BusinessIdentitySection
    TeamAndScaleSection
    OperatingHoursSection
    IndustryAndStageSection
    LocationSection

  ProfessionalView
    IdentityAndBioSection
    SkillsAndInterestsSection
    PublicProfileContext

  DocumentsAndIntelligenceView
    BusinessIntelligenceEngine
    IntelligencePackage
    ConfidenceAssessment
    QualityScorecard
    NeedsValidation
    ExpertReviewNeeded
    TakeActionPanel
    RecommendedDocuments

  SecurityAndPreferencesView
    ChangePasswordSection
    AppearanceSection
    PreferencesSection
```

---

## 23. Prioritized Implementation Plan

### Phase 1 — Structural clarity
1. Add internal mode tabs:
   - Overview
   - Business
   - Professional
   - Documents & Intelligence
   - Security & Preferences
2. Reorganize content into the correct modes
3. Make Overview the default strategic landing page

### Phase 2 — Outcome-linked forms
4. Add “what this powers” and “what it unlocks” to business/professional sections
5. Add completion states and progress indicators to each section
6. Add recommended next step engine

### Phase 3 — Documents and intelligence upgrade
7. Make Business Intelligence Engine a more deliberate premium surface
8. Improve Business Intelligence Package structure and explainability
9. Deepen Recommended Documents with module impact and data readiness notes

### Phase 4 — AI and integration
10. Add stronger AI assistance for profile/business/professional fields
11. Make downstream module impact explicit
12. Connect this page more visibly to Clients, Revenue, Content, Flows, Projects, and Documents

### Phase 5 — polish
13. Refine copy
14. Improve hierarchy
15. Improve transition between generated outputs and editable source data

---

## 24. Acceptance Criteria

The My Profile overhaul is successful if:

1. Users can clearly understand the difference between personal, business, intelligence, document, and settings layers
2. Overview mode makes the page feel strategic instead of form-heavy
3. Business fields clearly show what they power in the rest of the system
4. The Business Intelligence Engine and Package feel like premium, high-value surfaces
5. Recommended documents visibly connect to other modules and use cases
6. AI is embedded meaningfully and not just as a decorative label
7. Security/preferences no longer interrupt the intelligence/business flow
8. The page feels foundational to the entire app
9. No existing major capability is removed

---

## 25. Non-Negotiables

- Do not reduce the page to a simple profile/settings form
- Do not remove Business Foundation or Intelligence progress
- Do not demote the Intelligence Package into a hidden secondary surface
- Do not keep all content in one undifferentiated long vertical page
- Do not leave documents disconnected from the rest of the app
- Do not leave profile data’s downstream impact unclear

---

## 26. Target Outcome Statement

The final My Profile workspace should feel like:

> the foundational identity and intelligence layer of KeyFlow — a premium, structured workspace where personal identity, business context, AI readiness, strategic outputs, and system-wide document intelligence all come together in a clear and useful way.
