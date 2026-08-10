# Strategic Automation Map — KEYFLOWOS vs. Industry

**Purpose:** Define what "remove people from the office" actually means for KEYFLOWOS, benchmark against the major players, and map where the product stands today.

**Sources:** `docs/audits/KEY_ROLE_REPLACEABILITY_MATRIX.md`, `docs/audits/KEY_CAPABILITIES_ASSESSMENT.md`, `docs/KEY_CAPACITY_MAP.md`, plus public 2025–2026 industry reporting on Salesforce, HubSpot, Microsoft, Google, ServiceNow, SAP, Zoho, Freshworks, OpenAI, and Anthropic.

---

## 1. Executive Summary

- **Thesis.** KEYFLOWOS is building an AI-native operating system for small and mid-market businesses. The goal is not to replace every human — it is to absorb the "administrative glue" that exists in every business tier, wholly automate routine digital roles, and leave humans in the loop only for judgment, relationships, liability, and physical work.
- **Addressable set is large.** Internal analysis identifies roughly **40+ roles as fully replaceable (R)** and **90+ roles as partially replaceable (P)** across admin, finance, sales, marketing, support, operations, procurement, IT, and compliance. Only licensed, physical, high-trust, and creative-leadership roles are classified as not replaceable (N).
- **Current readiness is uneven.** The `KEY_CAPACITY_MAP` scorecard shows **77 of 97 surveyed staff tasks are fully AI-executable** (79%), 13 are partial (backend exists, no tool wrapper), and 7 are genuinely missing (greenfield). The bottleneck is no longer data-model coverage; it is trust, safety, and tool-wrapping.
- **Industry is moving fast but hitting the same wall.** Salesforce, Microsoft, HubSpot, ServiceNow, SAP, and others are shipping agentic features, but adoption is shallow, failure rates are significant, and the same trust blockers (hallucination, rollback, governance) dominate.
- **KEYFLOWOS's differentiation.** Unlike point solutions, KEYFLOWOS owns the full business graph — CRM, commerce, finance, projects, bookings, communications, genome, and connectors — in one tenant-scoped system. If trust blockers are closed, it can act across departments in a way that CRM-only or support-only agents cannot.
- **Strategic priority.** Close the **trust blockers first**, then the remaining partial
  tasks, then the greenfield gaps. Do not add more domains until autonomous execution is
  credible in the existing ones. **See the 2026-08-10 corrections before planning off
  §6.4, §6.5, §6.8 or §6.10** — the "13 partial tasks" and three of the "7 greenfield gaps"
  are already built, and planning against them would fund work that is done.

---

## 2. What Is Possible: The Comprehensive Automation Spectrum

Legend:
- **R — Replaceable:** Majority of routine tasks can run with minimal or no human intervention.
- **P — Partially Replaceable:** AI handles a meaningful slice; human owns judgment, exceptions, relationships, or liability.
- **N — Not Replaceable:** Requires physical presence, deep creativity, regulated licensure, or interpersonal trust.

### 2.1 Fully Replaceable Digital Roles (R)

| Role | Core Work | KEYFLOWOS Readiness Today |
|---|---|---|
| Data Entry Clerk | Transcribe data, update records, form filling | ✅ Strong — device capture + ingestion + form automation |
| File Clerk / Records Manager | Organize, tag, retrieve documents | ✅ Strong — document taxonomy, search, object storage |
| Transcriptionist | Audio/video to text | ✅ Strong — STT + ingestion |
| Meeting Notetaker | Notes, action items | ✅ Strong — voice + LLM summary + task creation |
| Meeting Scheduler | Find slots, send invites, reschedule | ✅ Strong — Google Calendar connector + booking service |
| Expense Report Processor | Receipt capture, categorization, submission | ✅ Strong — device capture + expense module |
| Accounts Receivable Clerk | Invoices, payment links, reminders, deposits | ✅ Strong — invoicing + Stripe/PayPal/WiPay + dunning |
| Lead Qualifier / Router | Score leads, route to sales | ✅ Strong — scoring rules + routing |
| Sales Coordinator | Scheduling, follow-up, order entry | ✅ Strong — calendar + CRM + order entry |
| Contract Administrator | Storage, renewal alerts, routing | ✅ Strong — storage, alerts, routing |
| Vendor Onboarding Specialist | Document collection, setup, approvals | ✅ Strong — forms, verification, approvals |
| SaaS Administrator | User provisioning, access reviews | ✅ Strong — user lifecycle + access reviews |
| LMS Administrator | Enrollments, reporting, access | ✅ Strong — user management + reports |
| Training Coordinator | Scheduling, materials, attendance | ✅ Strong — calendar + materials + reminders |
| Reservation Agent | Bookings, modifications, cancellations | ✅ Strong — booking engine |
| Project Coordinator | Scheduling, note-taking, action tracking | ✅ Strong — project/task tracking |
| L1 Support Agent | FAQs, order status, password resets | ✅ Strong — KB + actions + chat |
| Board Secretary | Minutes, action tracking, governance docs | ✅ Strong — document generation + task tracking |
| Returns Processor (rule-based) | Authorize, inspect, refund | ✅ Strong — rule-based returns |
| Order Entry Clerk | Enter orders from forms/email | ✅ Strong — ingestion + order creation |

### 2.2 Partially Replaceable Roles (P)

| Role | Core Work | KEYFLOWOS Readiness Today | Why Partial |
|---|---|---|---|
| Executive Assistant | Calendar, inbox, travel, reminders | 🟡 35–45% | Complex travel, relationship nuance, phone negotiation |
| Chief of Staff | Prioritization, briefing, follow-through | 🟡 35–45% | Political judgment, informal influence |
| Bookkeeper | Record transactions, reconcile, reports | 🟡 40–50% | Reconciliation exceptions, bank feeds, safety shell |
| Accounts Payable Clerk | Bill entry, payment scheduling | 🟡 50–60% | Fraud review, negotiation, exceptions |
| Payroll Clerk | Timesheets, calculations, filings | 🟡 40–50% | Compliance, disputes, tax changes |
| Tax Preparer | Return prep, filings | 🟡 40–50% | Tax strategy, liability, licensed review |
| SDR / BDR | Lead research, outreach, booking | 🟡 20–30% | Objection handling, live conversation |
| Inside Sales Rep | Phone/email sales | 🟡 20–30% | Persuasive conversation, objection handling |
| Proposal Writer | RFP responses, quotes | 🟡 30–40% | Bespoke strategy, win-themes |
| Social Media Manager | Calendar, posting, engagement | 🟡 15–25% | Creative direction, crisis response |
| Content Marketer / Copywriter | Blog, email copy, ads | 🟡 30–40% | Strategy, brand voice, final edit |
| Email Marketer | Campaigns, segmentation | 🟡 30–40% | Strategy, creative |
| SEO / Paid Media Manager | Research, on-page, optimization | 🟡 30–40% | Authority building, budget judgment |
| L2 Support Agent | Troubleshooting, refunds, exceptions | 🟡 30–40% | Nuanced cases, escalation judgment |
| Help Desk Technician | Ticket triage, routing, KB | 🟡 30–40% | Hands-on fixes |
| Live Chat / Call Center Agent | Real-time support | 🟡 20–30% | Empathy, complex cases |
| Operations Coordinator | Task assignment, tracking | 🟡 30–40% | Supplier relations, exceptions |
| Project Manager | Planning, scheduling, status, risk | 🟡 25–35% | Stakeholder management |
| Logistics / Inventory Manager | Tracking, reorder, alerts | 🟡 30–40% | Exception resolution, physical counts |
| Procurement Buyer | Vendor selection, negotiation, POs | 🟡 40–50% | Negotiation, selection |
| HR Administrator | Onboarding docs, records | 🟡 60–70% | Benefits advice, sensitive conversations |
| Recruiter | Sourcing, screening, interviewing | 🟡 30–40% | Interviews, offers |
| IT Support Technician | Ticket triage, password resets | 🟡 40–50% | Hardware work |
| System Administrator / DevOps | Automation, monitoring | 🟡 40–50% | Incident command, architecture |
| Security / Database Analyst | Monitoring, log analysis | 🟡 30–40% | Response decisions, critical changes |
| Property / Facilities Manager | Rent, maintenance, vendors | 🟡 30–40% | Tenant relations, physical oversight |
| Medical Receptionist / Biller / Coder | Scheduling, claims, coding | 🟡 40–60% | In-person check-in, appeals, complex cases |
| Restaurant / Store Manager (back office) | Scheduling, inventory, alerts | 🟡 30–40% | Floor leadership, customer issues |
| Insurance Agent | Quoting, document collection | 🟡 40–50% | Sales, claims decisions |
| Graphic Designer / Video Producer | Visuals, editing | 🟡 30–40% | Original brand design, storytelling |
| Field Service Technician (remote) | Diagnostics, parts ordering | 🟡 30–40% | Hands-on work |
| Agronomist / Drone Operator | Analysis, flight planning | 🟡 30–40% | Field judgment, regulatory control |

### 2.3 Not Replaceable (N)

- C-suite executives (CEO, CFO, etc.), board members
- Licensed professionals: attorneys, CPAs/auditors (independent), physicians, nurses, pharmacists, counselors, teachers, real estate agents
- Physical trades: electrician, plumber, HVAC, mechanic, construction, warehouse, machine operator, driver, farmer
- Relationship owners: account executives, account managers, management consultants, executive recruiters, brand strategists, art directors
- High-trust judgment: product managers, UX researchers, network engineers, safety officers, compliance officers (final decisions)

---

## 3. Industry Benchmark: What the Big Names Have Actually Achieved

| Player | Focus | Scale / Adoption | Key Agentic Capabilities | Reported Limitations | Relevance to KEYFLOWOS |
|---|---|---|---|---|---|
| **Salesforce Agentforce** | CRM-embedded enterprise agents | $800M ARR (Q4 2026), 29,000 deals | Native access to every Salesforce object; sales, service, marketing agents; proactive agents triggered by CRM data | Enterprise complexity, requires clean Salesforce data, high implementation cost | Direct competitor in CRM/service automation; KEYFLOWOS must match depth but win on SMB all-in-one simplicity |
| **HubSpot Breeze** | SMB/mid-market CRM + marketing + service | Widely adopted in HubSpot ecosystem | Lead scoring, buyer intent, content drafting, task automation, data enrichment | ~40% agent failure rate reported in practice; less autonomous than marketed | Closest positioning competitor; KEYFLOWOS has broader operating-system scope |
| **Microsoft 365 Copilot / Dynamics 365** | Office + ERP + role-based agents | 20M paid M365 Copilot seats (Q3 2026); 20+ Dynamics first-party agents | Role-based agents for sales, service, finance; Outlook/Teams/Excel integration; ERP finance agents | Seat-license cost, fragmented across apps, requires Microsoft stack | Benchmark for role-based personas and ERP finance agents; KEYFLOWOS can move faster as a single-stack product |
| **Google Vertex AI / Project Mariner** | Enterprise agent builder + browser agent | Large enterprise push via Gemini | Multi-modal agents, cross-framework interoperability, browser navigation | General-purpose, high error rate, safety concerns | Relevant for future browser-agent expansion; not a near-term product threat |
| **ServiceNow Autonomous Workforce** | Enterprise ITSM / workflow | Leading ITSM AI platform | IT service desk automation, multi-step workflows, judgment calls, AI Agent Studio | IT-centric; not a general business OS | Benchmark for governance-heavy autonomous workflows; less overlap with SMB market |
| **SAP Joule** | ERP-embedded finance / HR / supply chain | 15+ agents announced | Finance accruals/reconciliations/exception handling, supply chain planning, role-specific assistants | Enterprise ERP only, massive integration cost | Direct benchmark for finance autonomous operations; KEYFLOWOS finance module can aim here |
| **Zoho Zia / Agent Studio** | SMB price-sensitive CRM | 700+ pre-built actions, custom agents | Lead scoring, task automation, generative content, custom agent builder | Less depth than Salesforce/HubSpot, fragmented UX | Direct SMB competitor; KEYFLOWOS can differentiate via unified data graph and stronger autonomy |
| **Freshworks Freddy AI** | ITSM / customer support | Mid-market focus | Self-service agents, Agent Studio, IT ticket resolution | Support-centric; limited finance/operations | Benchmark for L1/L2 support automation; KEYFLOWOS support module is comparable |
| **OpenAI Operator / Anthropic Computer Use** | General browser/desktop agents | Research/early consumer | Navigate UIs, fill forms, book travel, use computers | Unreliable for production business tasks, safety issues, no native business data | Long-term R&D direction; not a current product competitor |

**Key industry pattern:** Everyone is shipping agents, but production autonomous execution is limited to narrow, well-governed domains. The gap between demo and scaled deployment is the same trust/safety/rollback problem KEYFLOWOS is facing.

---

## 4. Where KEYFLOWOS Is Today

From `docs/audits/KEY_CAPABILITIES_ASSESSMENT.md` and `docs/KEY_CAPACITY_MAP.md`.

| Domain | Current State | % Replaceable Today | Main Blockers |
|---|---|---|---|
| **Customer-facing support (L1)** | Strong drafting/triage; cannot safely auto-send replies | 30–40% | Webhook security, auto-approve threshold not wired, escalation |
| **Sales / CRM / pipeline** | Lead capture, scoring, routing exist; no outreach automation | 20–30% | Outreach automation, objection handling, safety shell |
| **Marketing / campaigns / social** | Drafting and scheduling exist; publishing and optimization weak | 15–25% | Publishing connectors, creative strategy, campaign optimization UX |
| **Scheduling / calendar / bookings** | Booking loop is one of the most complete flows | 40–50% | Calendar rollback compensation is a TODO no-op |
| **Finance / invoicing / payments / expenses** | Invoicing, payment collection, reports are strong; reconciliation partial | 40–60% | Reconciliation, autonomous decisions, safety shell |
| **Operations / projects / tasks / inventory** | Task/project tracking solid; inventory/fulfillment weaker | 30–40% | Inventory/fulfillment integration, anomaly → action loop |
| **Executive / strategy / Business Genome** | Briefing, command queue, Genome context strong; strategic synthesis weak | 35–45% | Strategic synthesis, multi-stakeholder coordination |
| **Compliance / governance / risk** | Audit trail excellent; active prevention and rollback poor | 20–30% | Safety shell wiring, rollback, semantic value alignment |
| **Learning / autonomy / improvement** | Eval harness and learning services exist; live loop not closed | 10–20% | No live learning loop, no measured autonomy KPIs |

**Capacity scorecard summary (from `KEY_CAPACITY_MAP`):**
- 77/97 staff tasks fully AI-executable (79%)
- 13/97 partial (backend built, no tool wrapper)
- 7/97 missing (greenfield) — **3 of the 7 named here are no longer missing.** Corrected
  2026-08-10 against the registry: payroll has 7 tools (`payroll_list_rates`,
  `payroll_set_rate`, `payroll_generate_run`, `payroll_list_runs`, `payroll_get_run`,
  `payroll_approve_run`, `payroll_mark_paid`), staff performance has 4
  (`performance_scorecard`, `performance_team_summary`, `performance_take_snapshot`,
  `performance_trend`), and the journal-entry tool exists as `finance_post_journal_entry`.

  Genuinely absent, verified by negative search: **booking waitlist / staff reassignment**
  (no tool matches `waitlist`), **staff availability / capacity** (no tool matches
  `availab|capacity`), and **paid social / ads execution** (only `draft_campaign_bundle` —
  drafting, with no execution path). **Voice telephony is unresolved here** and is
  deliberately not called either way: the `call_*` tools are call *tasks and scripts*, not
  telephony execution, and distinguishing those needs someone to open the LiveKit worker
  rather than grep a tool list.

  Note the source doc is stale in the same place — `KEY_CAPACITY_MAP.md` still says
  "payroll and staff-performance tracking remain real gaps" as of its 2026-07-20 entry.

---

## 5. Strategic Gap Map

| KEYFLOWOS Area | Closest Industry Equivalent | What They Have That KEYFLOWOS Lacks | What KEYFLOWOS Has That They Lack | Priority |
|---|---|---|---|---|
| **CRM / sales automation** | Salesforce Agentforce, HubSpot Breeze | Mature deal-stage AI, deep enterprise CRM, proven sales playbooks | Unified OS context (finance + projects + bookings + CRM in one graph) | Medium |
| **Support automation** | Freshworks Freddy, ServiceNow | Production self-service bots, ITSM depth | Native access to commerce/finance/bookings context for richer resolutions | Medium |
| **Finance / accounting** | SAP Joule, Dynamics 365 Finance | Autonomous reconciliations, accruals, exception handling in ERP | SMB-friendly invoice/payment/expense flow with connectors | High |
| **Marketing / social** | HubSpot Breeze, Salesforce Marketing Cloud | Publishing connectors, campaign optimization, paid ads | Integrated commerce + CRM + social in one tenant | Medium |
| **Scheduling / bookings** | Calendly, Square Appointments | Mature calendar rollback, waitlist, staff reassignment | Voice + chat + booking + payment in one flow | Medium |
| **Executive / strategy** | Microsoft Copilot, custom CEO copilots | Deep Office/Teams integration, role-based personas | Business Genome living model + command center + voice | High |
| **Trust / governance** | ServiceNow, SAP | Mature approval workflows, rollback, audit trails | Constitution-values check, autonomy orchestrator, eval harness (foundation) | Critical |
| **Connectors / integrations** | Zapier + CRM | Thousands of pre-built integrations | Native connectors with tenant scoping and encryption | Medium |
| **Physical / voice** | OpenAI Operator, voice agents | Browser/voice execution | LiveKit voice worker, OpenAI Realtime integration | Low (R&D) |

---

## 6. Strategic Recommendations

1. **Own the "all-in-one SMB operating system" position.** Do not try to out-CRM Salesforce or out-ERP SAP. Win by replacing the cross-departmental administrative glue that point solutions cannot address because their data is siloed.

2. **Close the trust blockers before adding domains.** The five blockers from `KEY_CAPABILITIES_ASSESSMENT` are still the highest-leverage work: safety shell wiring, real rollback, signed webhooks, unified ingestion queue, and valid Genome data. Without these, autonomy claims are not credible.

3. **Make KEY a credible autonomous operator in 3–5 bounded domains first.** The best candidates are: (a) accounts receivable / invoice collection, (b) appointment scheduling/reminders, (c) L1 support FAQ/status, (d) expense capture/categorization, (e) lead routing. Each has high backend coverage and clear success metrics.

4. **~~Wrap the 13 partial tasks immediately.~~ DONE — re-derive before acting on this.**
   *Corrected 2026-08-10 against the registry.* The list this recommendation named — bank
   reconciliation, chart of accounts, AP/bills, journal entries, project budget/timeline,
   contract CRUD + term extraction, ticket reply, broadcast messaging, key-inbox thread
   reply/escalate, deal/pipeline-stage tools, duplicate-contact merge, social analytics —
   is **substantially built**. Measured by parsing tool names out of `flow-tool-registry.ts`:
   reconciliation 6 tools, contracts 11, deals/pipeline 14, inbox 6, AP/bills 4, duplicate
   merge 3, plus `finance_post_journal_entry`, `finance_create_coa_account`,
   `helpdesk_reply_to_ticket`, `comms_send_broadcast`, `social_get_analytics`,
   `projects_get_budget`. Acting on this list as written would re-wrap tools that exist.

   The live list is the one in `KEY_CAPACITY_MAP.md` itself, which names different work:
   merge-execute for duplicate contacts, ticket delete / channel intake, response drafts,
   project plan approval, SEO remediation, front-office proactive reminders, refund
   execution. **Read that file, not this line.**

5. **Build job-level personas, not just department buckets.**
   *Corrected 2026-08-10: `RoleEngineService` has **8** department personas, not 7 —*
   `sales, finance, support, operations, marketing, general, operator, executive`.

   More importantly, the framing is wrong in a way that would send the work in the wrong
   direction. Job-level personas **already exist**: `JobRole`, `OrgAssignment` and
   `DelegationRule` are all real models, and `JobRolePolicy` already scopes tools by
   position. The problem the capability map identified is not missing personas — it is that
   there are **three disconnected role systems** with no edges between them: 8 department
   roles with tool envelopes, 35 named job titles that are read-only notification queues,
   and `JobRole` → tool envelope reachable only from a registered WhatsApp number.
   The deliverable is the **join**, not a fourth persona system.

6. **Make approval and delegation a first-class product.** The `OrgAssignment` / `JobRole` / `DelegationRule` system is a real differentiator. Surface it in chat so KEY can route spend/cancellations/refunds to the right human approver by role, not by hardcoded rules.

7. **Measure autonomy KPIs.** The specs target 90% plan completion without escalation and <1 escalation per critical decision. Build the dashboard and make it a CI/product gate. If it is not measured, it cannot improve.

8. **Close the remaining greenfield gaps selectively.**
   *Corrected 2026-08-10 — three of the seven are already built (see §4).* What is actually
   left: **booking waitlist / staff reassignment**, **staff availability / capacity**, and
   **paid social / ads execution**. Voice telephony needs a person to check rather than a
   grep. Prioritize by which unlocks the most fully replaceable roles — on that test,
   staff availability and booking waitlist both feed the Reservation Agent and Scheduler
   rows in §2.1, which are already marked ✅, so the gap is narrower than it reads.

9. **Do not over-promise on physical-world or licensed-professional roles.** KEYFLOWOS should market replacement of administrative and operational digital roles, not doctors, lawyers, or trades. Overreach damages trust and invites regulatory scrutiny.

10. **Treat connector security and token encryption as product features, not chores.**
    Salesforce and HubSpot have entire trust teams.

    *Corrected 2026-08-10: the plaintext-token half of this is closed.* The at-rest
    encryption middleware now covers four field sets — `BUSINESS_ENCRYPTED_FIELDS`,
    `SOCIAL_ENCRYPTED_FIELDS`, `CHANNEL_ENCRYPTED_FIELDS` and `WEBHOOK_ENCRYPTED_FIELDS`
    (`packages/db/src/middleware/token-encryption.ts`, shipped in `798a651f` and deployed).
    That commit closed a specific hole worth remembering: `channel-connection.service.ts`
    read an encrypted `SocialConnection` token — decrypting it — and wrote the plaintext
    into `ChannelConnection`, a table the extension did not then cover. The same secret,
    protected in one table and cleartext in another, put there by our own sync.

    The **webhook signing** half of this recommendation is NOT verified closed. I found HMAC
    machinery in several modules but did not establish that every inbound webhook verifies a
    signature, and that is the claim that matters. Treat it as open until someone enumerates
    the inbound endpoints.

---

## 7. Risks: What Could Go Wrong

1. **Trust collapse.** If KEY makes autonomous financial or customer-facing mistakes without rollback, customers will disable autonomy and the brand will be damaged.
2. **Compliance exposure.** GDPR hard-purge failures and plaintext token storage are not just engineering debt — they are regulatory liabilities.
3. **Over-promising in marketing.** Claiming to "replace employees" broadly sets expectations that the product cannot meet today.
4. **Integration fragility.** Connectors to Gmail, WhatsApp, Meta, Stripe, PayPal, etc. are attack surfaces and failure points. One broken webhook or revoked token can break a customer's front desk.
5. **Competitive squeeze.** Salesforce and HubSpot are pouring resources into AI agents. KEYFLOWOS must move faster in its chosen SMB niche before incumbents close the simplicity gap.
6. **Scope creep.** Adding more domains before existing ones are autonomous will spread engineering thin and leave many half-working features.
7. **Safety-vs-speed tension.** The pressure to ship autonomous features can override the governance work that makes them safe.

---

## 8. Appendix: Source Index

### Internal documents
- `docs/audits/KEY_ROLE_REPLACEABILITY_MATRIX.md` — comprehensive role replaceability matrix (R/P/N).
- `docs/audits/KEY_CAPABILITIES_ASSESSMENT.md` — current capability reality vs. target, critical blockers.
- `docs/KEY_CAPACITY_MAP.md` — 97-task staff-replacement scorecard, tool coverage, build order.
- `docs/audits/KEY_AUDIT_REPORT.md` — P0/P1 trust and safety blockers.
- `docs/KEY_MIND_SOUL_EVOLUTION_MASTER_PLAN.md` — long-term autonomy vision.
- `docs/KEYFLOWOS_10_OUT_OF_10_CONSTRUCTION_MANUAL.md` — construction targets.

### External sources
- Salesforce Agentforce: https://www.salesforce.com/agentforce/
- Salesforce Agentforce guide: https://www.getmacha.com/blog/agentforce-complete-guide
- Salesforce Agentforce CRM automation: https://www.digitalapplied.com/blog/salesforce-agentforce-2026-crm-automation-guide
- HubSpot Breeze: https://www.hublead.io/blog/hubspot-breeze-ai
- Microsoft Dynamics 365 release plan: https://learn.microsoft.com/en-us/dynamics365/release-plan/2025wave2/
- Microsoft 365 Copilot guide: https://www.dynamicssmartz.com/blog/microsoft-365-copilot-guide/
- Microsoft Dynamics 365 first-party agents: https://www.drdynamics.co.uk/blog/every-microsoft-first-party-ai-agent-in-dynamics-365
- ServiceNow AI agents: https://www.servicenow.com/products/ai-agents.html
- ServiceNow Autonomous Workforce: https://futurumgroup.com/insights/will-servicenows-autonomous-workforce-redraw-the-map-for-enterprise-ai-execution/
- SAP Joule agentic AI: https://www.savictech.com/insights/sap-joule-agentic-ai-2026/
- SAP Joule use cases: https://leverx.com/newsroom/sap-joule-ai-use-cases
- Zoho Zia / Agent Studio: https://www.lowcode.agency/blog/zoho-crm-zia-ai-limitations
- Zoho Zia features: https://www.zonestsolutions.com/blog/zoho-zia-features-and-benefits
- Freshworks Freddy AI: https://www.freshworks.com/freshservice/ai-itsm/
- OpenAI Operator alternatives: https://www.vellum.ai/blog/best-openai-operator-alternatives
- Anthropic measuring agent autonomy: https://www.anthropic.com/research/measuring-agent-autonomy
- GUI AI agents state of the art: https://zylos.ai/research/2026-01-09-gui-ai-agents-computer-use/
- AI agents in production overview: https://grandpasai.com/research/ai-agents-in-production.html

---

---

## 9. Correction log

**2026-08-10 — four claims re-derived against the code, four were wrong or stale.**

This document sets priority, so a stale claim here funds work that is already done. Each
correction above is marked inline; how they were checked, so the next reader can redo it:

| Claim | Was | Is | How checked |
|---|---|---|---|
| `RoleEngineService` personas | 7 | **8** | parsed the `BusinessRole` union in `role-engine.service.ts` |
| "13 partial tasks, cheap wins" | pending | **substantially built** | parsed tool names from `flow-tool-registry.ts` and matched each named task |
| 7 greenfield gaps | 7 | **3 built, 3 open, 1 unresolved** | same parse; negative search for `waitlist`, `availab\|capacity` |
| plaintext tokens | open | **closed** (webhook signing still open) | read `token-encryption.ts` field sets |

**Method note, because it changed the answer.** The first pass at the tool-coverage check
used `grep -c` with loose patterns and produced numbers that were wrong in both directions —
it reported "0 tools" for ticket reply when `helpdesk_reply_to_ticket` exists, and counted
substring collisions elsewhere. The table above comes from parsing `name:` fields out of the
registry and matching them explicitly. **Do not re-derive these with a regex count**; parse
the names. The tool total is **282**, not the 245 quoted in `CAPABILITY_MAP_2026-08-09.md`.

**What was NOT checked**, and so should not be treated as verified: the 77/97 capacity
scorecard itself (this only checked the 20 tasks called partial or missing, not the 77
called covered), the per-domain readiness percentages in §4, the industry adoption figures
in §3, and whether every inbound webhook verifies a signature.

---

*Last updated: 2026-08-10. This is a living document; update it as the product and industry evolve.*
