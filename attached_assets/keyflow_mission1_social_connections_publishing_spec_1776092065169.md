# KeyFlow Mission 1 Spec
## Unified Social Connections, Publishing, Messaging, and Email Distribution System
### AI Coder Implementation Document

### Objective
Build a **fully fledged, seamless outbound communications system** inside KeyFlow that allows a user to connect relevant social and messaging channels, publish or schedule content across them, send outbound campaigns where appropriate, and manage channel health, delivery, preview, and AI-assisted adaptation from one unified operating surface.

This system must not feel like a loose set of integrations.
It must behave like a **coherent communications layer** across the product.

The system should support:
- connected social channels
- scheduled multi-channel publishing
- channel-specific adaptation
- email campaigns / blasts
- messaging flows where appropriate
- AI-assisted copy generation and transformation
- full observability
- retry/error handling
- seamless integration with Content, Flows, Clients, Calendar, Revenue, Profile, and Marketplace

Do not build this as a generic posting feature.
Build it as a **distribution and communications engine** for KeyFlow.

---

## 1. Product Goal

The user should be able to:

### A. Connect channels
- Facebook Page
- Instagram Business account
- WhatsApp Business
- TikTok business account/profile where supported
- LinkedIn page/profile where supported
- X/Twitter if retained
- YouTube if relevant later
- Email sending channels

### B. Create once, distribute intelligently
- write one master message/post/campaign
- adapt it for each selected destination
- preview by channel
- schedule once
- publish/send across selected channels
- track results per destination

### C. Use communications for business outcomes
- publish promotional content
- send email campaigns
- schedule nurture messages
- send follow-ups through flows
- trigger WhatsApp or email reminders where allowed
- connect content and messaging to clients, segments, forms, bookings, offers, and revenue opportunities

### D. Operate at production quality
- know what is connected
- know what is expired or broken
- know why something failed
- retry only failed destinations
- preserve draft state
- keep origin-aware workflow continuity
- let AI assist with generation, adaptation, and recommendations

---

## 2. Core Product Principle

This system should not be framed as:
- “social integrations”
or
- “post to social media”

It should be framed as:

> **KeyFlow’s unified outbound communications layer**

That means it should handle:
- public social publishing
- marketing email
- messaging-enabled follow-up flows
- campaign distribution
- audience-targeted outbound activity
- channel health and observability

This is a system, not a widget.

---

## 3. What Must Be Supported

## Manual user capabilities
The user must be able to:
- connect supported destinations
- see connected channels clearly
- choose destinations per post/campaign
- create social posts
- create email campaigns
- schedule distribution
- preview by channel
- save drafts
- publish now
- resend failed destinations
- disconnect/reconnect channels
- inspect delivery status
- inspect delivery history
- segment email blasts

## Intelligent system capabilities
The system must be able to:
- detect expired connections
- detect missing permissions
- detect invalid destination state
- recommend the best channels for a content type
- warn when a message is a poor fit for a channel
- suggest best posting/sending time
- recommend missing connection setup
- suggest follow-up channels
- highlight failed or degraded destinations

## Automatic system capabilities
The system must be able to:
- publish scheduled content
- send scheduled email campaigns
- retry eligible failed deliveries
- update delivery statuses
- trigger follow-up flows
- log all outbound events
- refresh tokens where appropriate
- detect and flag broken integrations

## AI capabilities
The AI must be able to:
- generate master content
- rewrite for specific channels
- generate email subject line and preview text
- generate CTA variants
- generate hashtags
- shorten/expand copy
- explain why a channel is recommended or not
- recommend audience segment
- recommend send/post time
- create cross-channel variants from one source idea
- repurpose one piece of content into multiple channel outputs

---

## 4. Scope Clarification

This mission covers:
- channel connection architecture
- social publishing architecture
- outbound email architecture
- messaging architecture where relevant
- channel health
- delivery tracking
- AI-assisted communications workflows
- seamless integration with current app systems

This mission does **not** require:
- becoming a full social analytics platform
- becoming a CRM inbox replacement
- building a complete ad platform
- supporting every niche network on day one

Build for extensibility.
Launch with high-quality core channels first.

---

## 5. Recommended Phase 1 Channel Scope

Build the first version around channels with the strongest product fit.

### Required Phase 1
- Facebook Page
- Instagram Business
- Email
- WhatsApp Business messaging / notifications where allowed and compliant

### Strong Phase 2
- TikTok
- LinkedIn
- X/Twitter if retained

### Optional Phase 3
- YouTube
- Pinterest
- Telegram / SMS depending product strategy

The implementation must be channel-adapter-based so new platforms can be added without redesigning the whole system.

---

## 6. Architecture Overview

Build this system as five major layers:

1. **Connection Layer**
2. **Destination Layer**
3. **Content / Campaign Layer**
4. **Delivery Execution Layer**
5. **Observability + AI Layer**

---

## 7. Connection Layer

This layer manages provider authentication and long-lived connection state.

### Create / extend a model concept for:
- `SocialConnection`
- `EmailConnection`
- optionally a generic `ChannelConnection` abstraction if useful

### A connection represents:
- the authenticated provider account/session
- token lifecycle
- scopes/permissions
- refresh state
- connection health

### A connection is NOT the same as a publish destination
One Meta login can expose multiple destinations.

Examples:
- Facebook Page
- Instagram Business account
- WhatsApp Business number

So do not treat one OAuth connection as one publish endpoint.

### Required fields at connection level
- id
- businessId
- provider
- auth account id
- auth account name
- access token / refresh token storage reference
- scopes
- status
- connectedAt
- lastValidatedAt
- expiresAt if applicable
- healthState
- errorState
- metadata snapshot

### Health states
- Connected
- Needs Refresh
- Expired
- Missing Permission
- Destination Missing
- Disabled
- Error

---

## 8. Destination Layer

This is critical for seamlessness.

### Create a `ChannelDestination` or `SocialDestination` model
A destination is the actual send/publish target.

Examples:
- Facebook Page
- Instagram Business Profile
- WhatsApp Business Number
- TikTok Account
- LinkedIn Page
- Email Sender / From Identity / Campaign Sender

### Required destination fields
- id
- connectionId
- provider
- destinationType
- externalDestinationId
- displayName
- handle / page name
- avatar/image if available
- isActive
- isDefault
- capabilities
- healthState
- metadata

### Capability examples
- supports_image_post
- supports_video_post
- supports_text_only
- supports_link_post
- supports_story
- supports_scheduled_post
- supports_campaign_email
- supports_template_message
- supports_marketing_broadcast
- supports_replies_fetch (future)
- supports_carousel (future)

### Why this matters
This lets the UI show:
- what the user can actually publish to
- what format each destination supports
- which targets are healthy or broken

---

## 9. Adapter Architecture

Build provider-specific adapters behind a stable internal interface.

### Required adapters
- `MetaAdapter`
- `EmailAdapter`
- `WhatsAppAdapter`
- `TikTokAdapter` (phase 2)
- `LinkedInAdapter` (phase 2)
- `XAdapter` if retained

### Each adapter should implement
- connect()
- refreshConnection()
- validateConnection()
- listDestinations()
- getCapabilities()
- publish()
- scheduleIfNativeOrReturnForInternalScheduling()
- fetchPublishResult()
- normalizeError()
- disconnect()

### Why this matters
Without adapters, provider logic will leak into UI, flows, content, and schedulers.

---

## 10. Unified Content Object Model

Do not treat every outbound action as a separate silo.

Create a top-level content distribution object such as:
- `OutboundContent`
or extend current `SocialPost` carefully if you prefer

### It should represent
one master communication intent.

Examples:
- social promo post
- multi-channel announcement
- email blast
- launch message
- nurture message seed
- booking reminder campaign seed

### Required fields
- id
- businessId
- createdBy
- title / internal name
- masterBody
- objective
- audienceRef if any
- sourceModule
- sourceEntityId if any
- status
- contentType
- mediaRefs
- createdAt
- updatedAt

### Content type examples
- social_post
- outbound_broadcast
- email_campaign_seed
- reminder_template
- nurture_seed

This allows the same core content intent to generate multiple channel-specific deliveries.

---

## 11. Channel Variant Model

One master content object should produce channel-specific variants.

### Create `OutboundVariant`
- id
- outboundContentId
- destinationType or provider
- generatedBody
- generatedSubject if email
- generatedPreviewText if email
- generatedHashtags
- mediaRefs
- callToAction
- url
- characterWarnings
- previewPayload
- generationSource (manual / ai / adapted / copied)
- readinessState

### This allows:
- one master draft
- several destination-specific versions
- human review before publish
- AI adaptation without overwriting the master

This is essential for a premium system.

---

## 12. Delivery Model (Critical)

Do not keep delivery state only as a blob on the parent content object.

### Create `OutboundDelivery`
Each selected destination gets its own delivery record.

### Required fields
- id
- outboundContentId
- variantId
- destinationId
- provider
- destinationType
- scheduledAt
- sentAt / publishedAt
- status
- retries
- externalPostId / externalMessageId
- externalUrl if available
- errorCode
- errorMessage
- lastAttemptAt
- payloadSnapshot
- resultSnapshot

### Status examples
- Draft
- Scheduled
- Queued
- Sending
- Sent
- Published
- PartiallyFailed
- Failed
- Cancelled
- RetryPending

### Why this matters
The user must be able to:
- resend only failed destinations
- see exactly what happened where
- inspect per-channel results
- keep a true audit trail

---

## 13. Content Workspace UX Structure

This system should primarily live inside the Content workspace, but feed Flows and other modules.

### Content should gain a stronger outbound communications architecture:

#### Top-level content modes
- Create & Schedule
- Calendar
- Audiences & Forms
- optional future: Insights

#### Inside Create & Schedule
Add stronger internal submodes:
- Compose
- Campaigns
- Posts
- Scheduled
- optional future: Outbound / Broadcast

### Compose must support:
- Email Campaign
- Social Post
- Multi-Channel Broadcast

This is important.
The user should feel that they are composing one communication intent that can branch intelligently.

---

## 14. Unified Composer Requirements

Create a premium composer that supports:
- master content body
- media upload
- URL paste
- objective selection
- audience selection
- channel selection
- schedule
- AI generation
- AI adaptation
- per-channel preview
- email subject line if email selected
- save draft
- publish now / schedule

### Objective selector examples
- awareness
- promotion
- lead capture
- nurture
- reminder
- announcement
- re-engagement

### Audience selector examples
- all
- VIP
- segment-based
- clients with upcoming bookings
- leads from form X
- customers with overdue invoice (if appropriate for email/allowed messaging)
- inactive clients

This is how the communications layer connects to the rest of the app.

---

## 15. Channel-Specific Preview Requirements

The user must be able to preview how content will look on each destination.

### Required preview types
- Facebook Page preview
- Instagram preview
- WhatsApp message preview
- Email preview
- TikTok / LinkedIn preview later

### Show:
- final body
- media presence
- subject line for email
- CTA/link
- warnings or limitations
- unsupported format warnings

### Example warnings
- Instagram destination does not support link-first formatting the way email does
- WhatsApp message exceeds recommended length
- Email subject missing
- selected destination requires image/video
- channel connection expired

This is a key seamlessness requirement.

---

## 16. Scheduling Architecture

Use internal scheduling as the source of truth even if some providers support native scheduling.

### Required scheduler behavior
- queue all scheduled deliveries
- execute provider adapter publish calls at scheduled time
- update delivery status
- store result details
- retry transient failures
- fail gracefully
- log all events

### Required behaviors
- timezone aware
- support per-delivery status
- support reschedule
- support cancel scheduled delivery
- support publish now
- support “retry failed only”

The user must not feel that scheduling behavior changes unpredictably by channel.

---

## 17. Email System Requirements

Email must be first-class, but not incorrectly merged into pure social publishing.

### Recommended model
Use the shared composer and outbound intent layer,
but preserve a dedicated `EmailCampaign` behavior if needed.

### Email-specific requirements
- subject line
- preview text
- sender identity
- audience segment
- unsubscribe/compliance support as applicable
- campaign status
- recipient tracking
- open/click plumbing later if supported
- template support

### Email should support
- blast to selected segment
- AI-generated subject/body
- scheduling
- draft
- send now
- cross-link to audiences/forms

---

## 18. WhatsApp Messaging Requirements

WhatsApp should be handled as a communications channel with stronger compliance and template awareness than public social posting.

### WhatsApp use cases
- reminders
- confirmations
- re-engagement messages
- campaign-like messaging where allowed
- flow-triggered outreach
- business notifications

### Requirements
- destination health
- sender identity / business number
- allowed message type handling
- template message support where required
- integration with Flows
- logging into activity timeline

Do not model WhatsApp as just “another social feed post.”

---

## 19. Channel Health & Diagnostics

Expose a dedicated health layer.

### Required UI
- Connected channels count
- Expired channels
- Missing permissions
- Publish failures
- Reconnect required
- Destination inactive

### Health states should be visible in:
- Content Studio / Connections
- Composer channel picker
- Publish preview
- delivery history
- diagnostics cards

### If the user tries to publish with a broken channel
show:
- why it is blocked
- what is missing
- Connect/Reconnect CTA
- return to draft after fix

This should use the navigation continuity model we already defined.

---

## 20. Content Studio / Connections Surface

Create or strengthen a setup/configuration surface inside Content Studio.

### Suggested sections
- Connected Channels
- Destination Picker / Defaults
- Channel Health
- Email Sender Setup
- WhatsApp Setup
- AI Defaults
- Publishing Defaults

### Each connection card should show
- provider
- connected account
- destinations available
- health state
- last checked
- reconnect/manage button

This should not feel like generic settings.
It should feel like communications infrastructure.

---

## 21. AI Layer Requirements

The AI is central here and must feel deeply embedded.

### AI must help with:
- generate master draft
- rewrite for each channel
- generate email subject and preview text
- generate hashtags
- suggest CTA
- adjust tone
- shorten / expand
- convert from social post to email
- convert from email to social variants
- suggest best channels
- suggest best time to send
- suggest audience segment
- recommend content based on business context

### Example AI actions in composer
- Draft for all selected channels
- Rewrite for Instagram
- Convert to email blast
- Generate WhatsApp version
- Add CTA
- Make more promotional
- Make shorter
- Suggest best publish time

This should be one of the strongest differentiators of the entire app.

---

## 22. Cross-Module Intelligence Requirements

This mission must not be isolated.

### Content / outbound communications should draw from:
- Clients
- Segments
- Forms
- Calendar / bookings
- Revenue offers / packages
- Flows
- Profile / business context
- Marketplace listings later

### Example intelligent recommendations
- promote underbooked service this week
- send nurture email to leads from form X
- publish reminder for new package launch
- re-engage inactive VIP clients
- schedule booking-promo post for underperforming Tuesday
- create upsell campaign for clients with completed projects

This is where the system becomes truly powerful.

---

## 23. Flow Integration Requirements

Flows must be able to trigger and use this system.

### Flow triggers should include
- content scheduled
- content published
- email campaign sent
- email campaign failed
- destination disconnected
- form submitted
- campaign opened later if tracked
- booking completed
- invoice overdue
- project milestone complete

### Flow actions should include
- create outbound content
- send email
- send WhatsApp message
- schedule follow-up content
- generate nurture draft
- notify owner if publishing fails
- tag client based on campaign action

This allows communications to become operational, not just editorial.

---

## 24. Observability & Delivery Log

The user must be able to inspect what happened.

### Required history surfaces
- outbound history
- delivery log
- failed sends
- scheduled queue
- published history
- per-channel success/failure

### Each delivery record should show
- content title
- destination
- scheduled time
- actual publish time
- status
- result summary
- error if failed
- retry action
- open external result if available

This is necessary for trust.

---

## 25. Redirect / Continuity Requirements

This mission must use the new navigation continuity model.

### If the user starts publishing and a prerequisite is missing
do not hard-redirect to settings without preserving context.

### Required pattern
- show missing requirement
- open contextual setup drawer or focused setup view
- preserve draft
- show return-to-draft CTA
- automatically return after successful connection when possible

### Examples
- no Facebook page connected → connect now → return to composer
- email sender not configured → setup sender → return to campaign draft
- WhatsApp not verified → show blocked state and setup path, preserve current work

This is mandatory for seamlessness.

---

## 26. Recommended Internal Models

Suggested internal model set:

- `ChannelConnection`
- `ChannelDestination`
- `OutboundContent`
- `OutboundVariant`
- `OutboundDelivery`
- `DeliveryEvent`
- `ChannelCapability`
- `ConnectionHealthState`
- `DeliveryStatus`
- reuse / integrate with `EmailCampaign` where necessary

The coder may adapt names, but the separation of concerns must remain.

---

## 27. Suggested Final Component Tree

```text
ContentWorkspace
  ContentHeader
  ContentModeTabs
    CreateAndSchedule
    Calendar
    AudiencesAndForms
    Insights (future)

  CreateAndScheduleView
    ContentSubTabs
      Compose
      Campaigns
      Posts
      Scheduled
      OutboundHistory

    UnifiedComposer
      MasterContentEditor
      ObjectiveSelector
      AudienceSelector
      ChannelSelector
      MediaPanel
      AiAssistActions
      ChannelVariantsPanel
      ChannelPreviewPanel
      ScheduleControls
      SaveDraftButton
      PublishNowButton

  ContentStudio
    ConnectedChannels
    ChannelHealthPanel
    EmailSenderSetup
    WhatsAppSetup
    PublishingDefaults

  DeliveryLogView
    DeliveryFilters
    DeliveryTable
    DeliveryDetailPanel
```

---

## 28. Prioritized Implementation Plan

### Phase 1 — Core architecture
1. Build connection layer
2. Build destination layer
3. Build adapter interfaces
4. Build delivery model
5. Build channel health states

### Phase 2 — Core UX
6. Build unified composer
7. Add channel selector
8. Add per-channel variants
9. Add per-channel previews
10. Add scheduling and delivery queue integration

### Phase 3 — Email and messaging
11. Add email sender setup
12. Add email blast workflow
13. Add WhatsApp channel handling
14. Integrate with audiences/segments

### Phase 4 — Intelligence and continuity
15. Add AI actions in composer
16. Add cross-module recommendations
17. Add contextual prerequisite handling
18. Add return-to-draft continuity

### Phase 5 — Observability and polish
19. Build outbound history and delivery logs
20. Add retry flows
21. Add better diagnostics and error normalization
22. Refine copy, previews, warnings, and health indicators

---

## 29. Acceptance Criteria

This mission is successful if:

1. Users can connect major outbound channels clearly and reliably
2. One master content object can generate multiple destination-specific variants
3. Users can preview and schedule content across channels seamlessly
4. Email is first-class and integrated, not bolted on
5. WhatsApp is handled appropriately as a messaging channel
6. Delivery status is visible per destination
7. Connection and destination health are visible and actionable
8. AI can generate, adapt, and recommend content/channel behavior meaningfully
9. Flows can use outbound communications as triggers and actions
10. The entire experience feels like one coherent communications engine, not scattered integrations

---

## 30. Non-Negotiables

- Do not model one connection as one destination
- Do not store delivery state only as an opaque blob
- Do not treat email as just another social post
- Do not treat WhatsApp as a normal public social channel
- Do not publish without per-destination status visibility
- Do not force hard redirects to settings without task continuity
- Do not make AI a decorative add-on instead of an active assistant

---

## 31. Target Outcome Statement

The final Mission 1 system should feel like:

> a premium, unified outbound communications engine where users can connect channels, create once, adapt intelligently, publish and send seamlessly across destinations, track every delivery, recover from failures, and use AI plus automation to communicate across the entire business with context and control.
