# KF-EXEC-GROWTH-001 — Closed-Loop Marketing, Advertising & Social Growth Engine

Status: **EXECUTION-GRADE PRE-IMPLEMENTATION PACKET / NO PRODUCTION AUTHORIZATION**  
Wave: C/D bridge  
Primary journey: J9 Marketing / Lead Generation  
Primary kernels: K3/K4/K5/K7/K8/K9/K10/K11/K12  
Dependencies: KF-EXEC-ACTION-001, KF-EXEC-COMMERCIAL-001, KF-EXEC-FINANCE-001, KF-EXEC-PLAYBOOK-001, KF-EXEC-PUBLIC-001, KF-EXEC-SPACE-001, KF-EXEC-CONNECTOR-001  
Product blueprint: `docs/intelligence/product/KEYFLOW-GROWTH-ENGINE-BLUEPRINT.md`

## Objective

Converge current marketing, email, social, SEO, attribution, content and growth-intelligence seams into one closed-loop Growth Engine that can plan, create, distribute, advertise, capture, attribute, experiment and optimize under explicit authority/budget/consent policy.

## Required no-edit characterization

Before later implementation:
- enumerate MarketingCampaignPlan / EmailCampaign / OutboundCampaign identities;
- enumerate social publishing/scheduler/analytics paths;
- enumerate content generation/request/approval paths;
- inventory SEO/GSC/GA4 data;
- inventory CRM sequences/lead forms/customer journeys;
- inventory attribution/revenue-attribution sources;
- inventory provider social/ad connectors;
- determine current paid-ad API support vs missing adapters;
- inventory consent/suppression enforcement;
- enumerate direct AI/content publishing bypasses;
- inspect existing campaign budget fields vs real spend evidence;
- identify current brand/audience/creative metadata;
- map public Space landing destinations.

## Implementation slices

### G1 Growth strategy memory
Goal, offer, audience, capacity, brand, channel and historical performance context.

### G2 Campaign identity
One semantic growth campaign with versioned audience/creative/landing/tracking/budget associations.

### G3 Organic social
Planning, creation, rendition, scheduling, publishing, replies, social analytics and content-gap learning.

### G4 Lifecycle/email
Segments, campaigns, sequences, consent, health, send-time, re-engagement and recovery.

### G5 SEO/discovery
Keyword/content opportunities, Search Console/analytics observations and Space content coordination.

### G6 Paid media adapters
Provider account/grant, campaign/ad-set/ad identities, activation, pause/resume, budget and metrics.

### G7 Creative system
Brand-grounded concepts, channel renditions, approval, asset lineage and variant identity.

### G8 Experiment system
Hypothesis, variants, allocation, metrics, observation window, stop/learning policy.

### G9 Attribution/economic reconciliation
Occurrence-safe source observations, compatible value stages, currency/time/model generation.

### G10 Optimization
Recommendations and bounded automated changes to budget/audience/creative/channel/timing.

### G11 Growth Cockpit
Outcome-oriented projections, exceptions, spend, attributed value, experiment state and KEY actions.

## Locked invariants

1. campaign plan/provider campaign/creative rendition are distinct identities;
2. current provider grant required for any effect;
3. marketing permission checked at execution;
4. spend-changing actions require explicit delegated financial authority;
5. budget cap semantics are explicit and concurrency-safe where hard;
6. provider success cannot be erased by local failure;
7. paid delivery/organic publication evidence is destination-specific;
8. source observations preserve occurrence/time/provider identity;
9. economic conversions reconcile with K10 financial truth;
10. attribution generation is versioned/freshness-bound;
11. ROAS/CAC use compatible numerator/denominator/currency/window;
12. experiment variants bind audience/creative/landing revisions;
13. paid promotion never silently changes KeyFlow Index reputation;
14. performance optimization cannot bypass approval/control;
15. pause/stop can prevent future requests but cannot pretend remote effects were undone;
16. capacity/fulfilment constraints are visible to growth planning;
17. no vanity metric is treated as revenue/customer truth;
18. ad/social/email replay does not duplicate economic occurrences.

## Paid advertising control requirements

Characterize/adopt:
- ad account identity;
- business/provider binding;
- campaign/ad-set/ad external IDs;
- budget currency;
- authorized spend ceiling;
- current spend evidence;
- pending/in-flight spend semantics;
- approval revision;
- provider status/evidence;
- emergency pause;
- reconciliation after uncertain provider outcome.

## Required proof families

- wrong-business ad account rejected;
- revoked connector cannot create/modify ads;
- duplicate activation request does not duplicate campaign spend objects;
- budget change above authority requires approval;
- hard budget concurrency does not overspend selected contract;
- provider accepts ad but local write fails: known outcome retained;
- creative revision maps to correct observations;
- landing-page revision not mixed silently;
- social multi-target partial publication truthful;
- suppression after audience expansion prevents later send;
- attribution does not double count one payment;
- different currencies not summed silently;
- stale/incomplete attribution generation not presented current;
- experiment insufficient sample remains uncertain;
- paid placement does not alter Network Index;
- growth recommendation respects business capacity.

## KEY capability candidates

```text
analyze_growth
build_marketing_strategy
create_campaign_draft
create_content_calendar
generate_social_variants
schedule_social_post
publish_social_post
create_email_campaign
create_growth_segment
create_landing_page_draft
create_ad_campaign_draft
activate_ad_campaign
pause_ad_campaign
adjust_ad_budget
create_experiment
evaluate_experiment
reallocate_growth_budget
request_review
launch_referral_campaign
generate_growth_report
```

Exact risk/control metadata belongs to K5/K3 during implementation characterization.

## Rollback floor

Preserve:
- campaign/provider identities;
- creative/audience/landing revisions;
- spend/provider receipts;
- publication/delivery observations;
- lead/conversion occurrence history;
- consent/suppression decisions;
- experiment assignments/results;
- attribution generations;
- financial/economic evidence.

Code rollback must not reactivate paused spend or resend suppressed audiences.

## Workforce target

Primary replacement/reduction:
- marketing coordinator;
- social media coordinator;
- campaign operator;
- email marketing operator;
- junior media buyer;
- marketing analyst;
- content scheduler;
- lead-generation administrator;
- SEO reporting/admin;
- review/referral coordinator;
- junior copywriter.

## Non-goals

- hiding ad spend authority in generic autonomy;
- pretending attribution proves causality;
- building a proprietary social network ad exchange before justified;
- using protected traits for impermissible targeting;
- optimizing engagement at the expense of business outcomes;
- replacing senior creative/brand strategy where human judgment remains material.
