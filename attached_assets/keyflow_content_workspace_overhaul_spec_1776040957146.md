# KeyFlow Content Workspace Overhaul Spec
## AI Coder Implementation Document

### Objective
Redesign and strengthen the **Content** workspace comprehensively without removing functionality. Preserve the current capabilities for campaigns, social posts, scheduling, calendars, audiences, segments, and forms, but reorganize the workspace so it becomes a true **audience-aware content operating system** instead of a set of adjacent publishing utilities.

Do not remove features. Improve strategic hierarchy, creator workflow quality, AI usefulness, planning intelligence, and linkage between content, audience, and business outcomes.

---

## 1. Product Goal

The Content workspace should support four connected jobs:

1. **Create content**
   - email campaigns
   - social posts
   - content drafting
   - media attachment
   - templates

2. **Plan and schedule content**
   - calendar view
   - scheduling
   - draft management
   - posting cadence
   - campaign timing

3. **Target audiences**
   - segments
   - forms
   - audience health
   - lead capture
   - nurture entry points

4. **Improve content performance**
   - what to publish next
   - what audience to target
   - what channel to use
   - how to repurpose content
   - what is working / not working

The final workspace should feel:
- creative
- intelligent
- strategic
- calm
- premium
- growth-oriented

It should stop feeling like three adjacent tools and start feeling like one coherent system for content, audience, and distribution.

---

## 2. Existing Strengths to Preserve

Keep these strengths:

1. **Top-level mode structure**
   - Create & Schedule
   - Calendar
   - Audiences & Forms

2. **Email vs Social distinction**
   - Email Campaign
   - Social Post

3. **Strong empty states**
   - Launch your first campaign
   - Start posting on social media
   - No scheduled content
   - Capture leads with custom forms

4. **Social composer base**
   - content box
   - hashtags
   - channel selection
   - upload
   - paste URL
   - schedule
   - save draft
   - publish now
   - templates

5. **Calendar planning view**
6. **Audience Health + Segments**
7. **Forms / lead capture framing**

Do not regress these.

---

## 3. Core Problems to Solve

### A. The workspace is still more execution-oriented than intelligence-oriented
The page helps users make and schedule content, but it does not yet strongly help them decide:
- what content to publish next
- why
- for whom
- on what channel
- with what goal
- based on what performance or audience signal

### B. Create & Schedule is broad but not tightly structured enough
It currently allows several actions, but lacks a stronger internal model of:
- compose
- manage campaigns
- manage posts
- review scheduled items

### C. AI is present but not yet deeply embedded
“AI Content” is visible, but AI is not yet acting like a true integrated copilot for ideation, targeting, repurposing, and improvement.

### D. Social composer is capable but still too utilitarian
It works, but it does not yet feel like a premium AI-assisted content studio.

### E. Email campaign creation is too lightweight for long-term scale
The modal is a good quick-start, but not enough for a full campaign-building workflow.

### F. Calendar is clean but not insightful enough
The planner shows dates and states, but not enough content strategy intelligence.

### G. Audiences & Forms is promising but too detached
Audience and forms do not yet strongly feed back into content creation, targeting, and nurture flows.

### H. Audience Health is visually nice but strategically shallow
It needs more meaning, actionability, and direct linkage to campaign decisions.

---

## 4. Required Outcome

After overhaul, the Content workspace must support:

- faster content creation
- clearer content planning and scheduling
- stronger audience targeting
- practical AI assistance
- more strategic creation flow
- clearer linkage between content and growth
- a more studio-like experience for creators
- better visibility into what to create next and why

---

## 5. Information Architecture

### Sidebar label
Use **Content**

### Page title
Use **Content** or **Marketing** carefully and consistently.

Recommended pairing:
- Sidebar: Content
- Page title: Content
- Subtitle: Create, schedule, target, and grow

Reason:
“Marketing” is broader than what the current workspace actually delivers.
“Content” is more precise and aligns better with the user’s mental model.

If “Marketing” is kept as the page title, the subtitle should do more work:
> Create, schedule, target, and measure content-driven growth

---

## 6. Final Mode Structure

Keep the existing top-level structure, but make it more intentional:

1. **Create & Schedule**
2. **Calendar**
3. **Audiences & Forms**
4. Optional future mode: **Insights**

The first three are already solid.
The future Insights mode is important for long-term growth.

---

## 7. Create & Schedule Overhaul

This section needs a stronger internal structure.

### Add clear internal submodes
Inside Create & Schedule, use:

- **Compose**
- **Campaigns**
- **Posts**
- **Scheduled**

These can be tabs, segmented controls, or equivalent internal views.

### Why
Right now the section is doing too many things in one flat surface.
This change creates clarity without removing any features.

---

## 8. Compose Submode

This should become the true content creation studio.

### Support creation types
- Email Campaign
- Social Post

### Shared composer principles
The user should be able to choose:
- channel or content type
- objective
- target audience
- timing
- draft vs publish flow

This is where the workspace can become truly differentiated.

---

## 9. Social Composer Overhaul

The current social composer is a strong functional base and should be upgraded into a richer studio.

### Keep
- compose box
- hashtags
- channel selection
- upload
- paste URL
- schedule
- save draft
- publish now
- templates

### Add
- **Objective selector**
  - awareness
  - engagement
  - lead capture
  - promotion
  - reminder
  - nurture

- **Audience target**
  - all
  - VIP
  - stage-changed
  - segment-specific

- **Tone / style options**
  - informative
  - promotional
  - warm
  - authority
  - concise

- **Channel adaptation**
  - optimize per platform
  - shorten / expand / rewrite for channel

- **AI actions**
  - generate draft
  - improve hook
  - generate CTA
  - suggest hashtags
  - rewrite for engagement
  - repurpose from another post/campaign

- **Content score / readiness state**
  - draft quality
  - CTA present / missing
  - channel selected / missing
  - image/media missing if recommended

- **Preview support**
  - preview for channel(s)
  - character limits / truncation warnings

### Goal
The composer should feel like a premium AI content studio, not just a text box with tools.

---

## 10. Email Campaign Workflow Overhaul

The current New Campaign modal should remain only as a **quick-start launcher**.

### Keep modal for:
- campaign name
- subject line
- campaign type
- initial segment
- initial draft selection

### After create:
Route the user into a fuller **Campaign Builder**.

### Campaign Builder should support:
- subject line
- body/content
- template selection
- audience selection
- scheduling / send now
- preview
- link/CTA setup
- open/click goal framing
- AI writing assistance
- performance notes / campaign objective

This is necessary if email campaigns are meant to become a serious capability.

---

## 11. Campaigns Submode

This should be a clearer management view for email campaigns.

### Include:
- search
- Draft / Scheduled / Sent / Archived
- audience segment
- send date
- open/click state if available
- quick actions:
  - edit
  - duplicate
  - schedule
  - send
  - archive

### Add strategic metrics:
- campaigns sent this month
- scheduled this week
- top-performing campaign
- audience coverage
- under-contacted segments

This helps campaigns become more than just a list.

---

## 12. Posts Submode

This should manage social drafts and published items.

### Include:
- Draft
- Scheduled
- Published
- Failed / Needs Review

### Show:
- channel(s)
- scheduled time
- objective
- post type
- engagement state if available
- draft completeness

### Quick actions
- edit
- duplicate
- reschedule
- publish now
- move to campaign
- archive

---

## 13. Scheduled Submode

This is a crucial planning layer.

### Show:
- all upcoming content across channels
- scheduled emails
- scheduled posts
- timing conflicts
- channel gaps
- unscheduled drafts ready to go

### Add intelligence:
- no content scheduled for next 5 days
- too many items on Wednesday
- audience X has not been targeted in 2 weeks
- campaign cadence below recommended level

This is where planning becomes more intelligent.

---

## 14. Calendar Overhaul

The calendar is visually clean and should stay, but it needs to become more useful for planning.

### Keep
- Month / Week
- Today
- date navigation
- All / Campaigns / Posts / Bookings filters

### Improve with:
- content density indicators
- channel markers
- type markers (campaign, post, booking)
- draft reminders
- scheduling gaps
- overloaded day warnings
- best-time hints (future-ready)

### Calendar should help answer:
- what is scheduled?
- what is missing?
- where are the gaps?
- where should content be moved?

It should become a planning surface, not just a display surface.

---

## 15. Content Planning Intelligence (New)

Add a compact planning intelligence layer to Create & Schedule and/or Calendar.

Examples:
- No content scheduled for the next 4 days
- Facebook cadence is below weekly target
- No campaign sent to VIP segment this month
- 3 drafts are ready to schedule
- Wednesday is the best-performing posting window historically

Each item should offer a CTA:
- Schedule draft
- Create post
- Generate campaign
- Repurpose content
- Target segment

This is one of the most important upgrades.

---

## 16. Audiences & Forms Overhaul

This section is already strategically valuable and should become more connected to the rest of Content.

### Keep
- Audience Health
- Contact Segments
- Forms
- empty state / form CTA

### Improve with:
- direct actions from audience segments
- direct actions from forms
- campaign targeting recommendations
- nurture path suggestions
- segment growth visibility

This should feel like the audience engine for content, not a separate utility page.

---

## 17. Audience Health Redesign

The current health visualization is clean, but its meaning needs to be clearer and more actionable.

### Clarify what health means
Break health into states like:
- Engaged
- Cooling
- At Risk
- Disengaged
- Growing
- High-value

### Add action recommendations
Examples:
- At-risk audience increasing → launch re-engagement campaign
- VIP segment has low recent contact frequency → create nurture touchpoint
- Form submissions rising → create welcome sequence

### Add compact explanations
Users should understand how health is determined:
- opens
- clicks
- responses
- activity recency
- conversions
- form engagement

---

## 18. Contact Segments Improvements

Segments are useful but should connect more directly to creation.

### Add quick actions per segment:
- Create campaign
- Generate post
- Build form
- Start nurture
- View contacts

### Show additional info if available:
- size
- recent growth
- recent campaign coverage
- engagement state

This makes segments more than labels.

---

## 19. Forms Section Overhaul

The current forms area is directionally good but should be framed more as a **lead capture engine**.

### Keep the current CTA and explanation
### Add:
- form status
- submissions count
- conversion trend
- source/location
- linked segment
- linked automation / nurture destination

### Future-ready actions:
- edit form
- duplicate
- preview
- embed
- connect to campaign
- connect to flow

This will link forms more tightly to growth workflows.

---

## 20. AI Layer Overhaul

This is the largest product-differentiation opportunity.

AI should be embedded across the workspace, not only branded visually.

### AI should help with:
- idea generation
- draft creation
- rewriting
- tone adaptation
- channel adaptation
- hashtag generation
- CTA generation
- scheduling recommendations
- segment targeting recommendations
- repurposing content
- re-engagement ideas
- follow-up campaign suggestions

### Suggested AI entry points
- inside composer
- inside campaign builder
- inside scheduled/planning surface
- inside audience segments
- inside forms suggestions

The user should feel that AI is working with them, not just labeled in the UI.

---

## 21. Visual Hierarchy Rules

### The workspace should feel like a studio + planner
Not a generic marketing admin panel.

### Creation should feel central
The user should feel there is a strong place to make content.

### Planning should feel distinct
Calendar and scheduling should feel like orchestration, not just another subpage.

### Audiences should feel like targeting intelligence
Not a separate side utility.

---

## 22. Search / Filter Rules

### Create & Schedule
Allow search by:
- campaign name
- post content
- status
- channel
- segment
- date

### Calendar
Allow filters by:
- campaigns
- posts
- bookings
- channel
- scheduled / draft / sent / posted

### Audiences & Forms
Allow search by:
- segment name
- form name
- status
- audience state

Do not let one generic search behavior try to cover all use cases poorly.

---

## 23. Functional Integration Requirements

Content should visibly connect to:
- Clients / segments
- Flows / automations
- Bookings
- Revenue if campaigns promote offers
- Forms / lead capture
- audience health
- performance and outcomes

Examples:
- build campaign from segment
- build post promoting service/package
- generate nurture content from form submissions
- view campaign linked to booked offer
- repurpose high-performing content into another channel

This is essential for making Content part of the operating system.

---

## 24. Suggested Final Component Tree

```text
ContentPage
  ContentHeader
    Breadcrumbs
    Title + subtitle
    ContentPrimaryActions

  ContentModeTabs
    CreateAndSchedule
    Calendar
    AudiencesAndForms
    Insights (future)

  CreateAndScheduleView
    ContentIntelligenceStrip
    ContentTypeToggle
      EmailCampaign
      SocialPost
    ContentSubTabs
      Compose
      Campaigns
      Posts
      Scheduled

    ComposeView
      ComposerTypeSelector
      ObjectiveSelector
      AudienceSelector
      ToneSelector
      AiAssistActions
      SocialComposer or CampaignQuickStart

    CampaignBuilder
      Subject
      Body
      Segment
      Template
      Preview
      ScheduleOrSend

    PostsManager
      Search
      Filters
      PostList

    ScheduledManager
      UpcomingItems
      DraftsReady
      CadenceWarnings

  CalendarView
    CalendarToolbar
    ContentCalendar
    SchedulingInsightStrip
    EmptyOrScheduledState

  AudiencesAndFormsView
    AudienceHealthCard
    SegmentCards
    FormsListOrEmptyState
    AudienceActions
```

---

## 25. Prioritized Implementation Plan

### Phase 1 — Structural clarity
1. Standardize page identity as **Content**
2. Keep top-level modes but clarify copy and purpose
3. Add Create & Schedule internal submodes:
   - Compose
   - Campaigns
   - Posts
   - Scheduled
4. Keep Calendar and Audiences & Forms distinct

### Phase 2 — Creator workflow upgrades
5. Upgrade social composer into a richer AI-assisted studio
6. Keep campaign modal as quick start only
7. Build fuller campaign builder after creation
8. Add audience and objective selection to creation flow

### Phase 3 — Planning intelligence
9. Add content intelligence strip
10. Improve calendar with content planning signals
11. Add draft readiness / cadence / gap insights
12. Add actionable recommendations

### Phase 4 — Audience integration
13. Make Audience Health more interpretable
14. Add actions from segments into content creation
15. Improve forms as a lead capture engine
16. Link forms and segments to campaigns and flows

### Phase 5 — AI and polish
17. Embed AI actions across composer, campaigns, scheduling, and segments
18. Improve copy, spacing, hierarchy, and CTA clarity
19. Add richer previews and readiness states

---

## 26. Acceptance Criteria

The Content overhaul is successful if:

1. Users can clearly understand where to create, manage, schedule, and target content
2. Content creation feels richer and more guided
3. The workspace helps users decide what to create next, not only create it
4. Calendar helps with planning, not just date display
5. Audiences & Forms clearly support targeting and growth
6. AI is embedded in meaningful ways, not just labeled
7. Email campaigns have a scalable builder flow
8. Social posting feels like a real content studio
9. No existing capability is removed

---

## 27. Non-Negotiables

- Do not remove Email Campaign or Social Post paths
- Do not remove Calendar mode
- Do not remove Audiences & Forms
- Do not reduce content creation to a shallow modal-only flow
- Do not leave AI as a mostly decorative label
- Do not let audience data remain disconnected from content actions

---

## 28. Target Outcome Statement

The final Content workspace should feel like:

> a premium, audience-aware content operating system that helps the user decide what to create, create it faster, schedule it intelligently, target the right people, and connect content to growth outcomes.
