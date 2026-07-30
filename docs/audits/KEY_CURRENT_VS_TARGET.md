# KEY: Current Capability vs. Target Replaceability

This table compares what KEY can do **today** (as of `feat/key-phase-1-organ-maturation`) against the **target replaceability** once the P0/P1 gaps from the audit are closed.

| Rating | Meaning |
|---|---|
| **R** | Replaceable — KEY can own the majority of routine work. |
| **P** | Partially Replaceable — KEY handles a meaningful slice, human owns judgment/exceptions. |
| **N** | Not Replaceable — requires physical presence, licensure, high-stakes trust, or deep creativity. |

---

## Executive & Strategy

| Role | Core Functions | What KEY Can Do Today | Target | Blockers to Target |
|---|---|---|---|---|
| CEO / Founder | Vision, fundraising, board relations, final decisions, culture | Summarize data, draft reports, surface priorities | N | Liability, trust, relationships, legal accountability |
| Chief of Staff | Prioritization, briefing, meeting prep, follow-through | Command Center briefing, pulse, action tracking | P | Political judgment, negotiation, informal influence |
| Strategy Consultant | Market analysis, scenario planning, recommendations | Assemble data, generate options, run simulations | P | Original insight, client trust, synthesis |
| Business Analyst | Reporting, dashboards, KPI tracking, variance analysis | Build reports, detect anomalies, alert on thresholds | P | Interpretation, stakeholder communication |
| Board Secretary | Meeting minutes, action tracking, governance docs | Generate minutes, track actions, send reminders | R | Needs voice/transcription integration finalized |
| Executive Assistant | Calendar, travel, email triage, reminders, drafting | Calendar, inbox triage, task creation, drafting | P | Complex travel, relationship nuance, phone negotiation |

---

## Administrative & Office Support

| Role | Core Functions | What KEY Can Do Today | Target | Blockers to Target |
|---|---|---|---|---|
| Data Entry Clerk | Transcribe data, update records, form filling | Device capture, ingestion, form automation | R | Ingestion model drift; needs unified queue |
| Receptionist | Greet visitors, answer phones, route inquiries | Chat/voice routing, FAQ answers, visitor log | P | Physical presence and hospitality cannot be automated |
| Front Desk Coordinator | Check-ins, appointments, visitor logs | Appointment booking, reminders, digital logs | P | Physical check-in hardware/process |
| Office Manager | Supplies, facilities coordination, vendor management | Reorder supplies, schedule maintenance, vendor records | P | Vendor negotiation, physical oversight |
| File Clerk / Records Manager | Organize documents, tagging, retrieval | Document taxonomy, search, tagging | R | — |
| Mailroom Clerk | Sort mail, scan documents, route packages | Digital mail routing, document scanning | P | Physical package handling |
| Virtual Assistant | Inbox, calendar, travel, research, reminders | Inbox triage, calendar, reminders, research summaries | P | Judgment, phone negotiation, travel disruption |
| Meeting Scheduler | Find slots, send invites, reschedule | Google Calendar connector, booking links | R | — |
| Transcriptionist | Audio/video to text | STT + ingestion | R | Voice audio storage placeholder |
| Notetaker | Meeting notes, action items | Voice + LLM summary + task creation | R | Needs voice pipeline hardened |
| Travel Coordinator | Book flights, hotels, itineraries | Rule-based booking, itinerary assembly | P | Disruption handling, traveler preferences, negotiation |
| Expense Report Processor | Receipt capture, categorization, submission | Device capture + expense module | R | Extraction accuracy validation |
| Procurement Admin | Purchase orders, vendor records, approvals | PO creation, approval routing, vendor records | P | Vendor selection, exception handling |

---

## Finance & Accounting

| Role | Core Functions | What KEY Can Do Today | Target | Blockers to Target |
|---|---|---|---|---|
| Bookkeeper | Record transactions, reconcile accounts, reports | Transaction categorization, reports, data entry | P | Reconciliation exceptions, bank/connector feeds, safety shell |
| Accounts Receivable Clerk | Invoices, payment links, reminders, deposits | Invoicing, payment links, Stripe/WiPay/PayPal, reminders | R | Dunning rules fine-tuning |
| Accounts Payable Clerk | Bill entry, payment scheduling, vendor payments | Bill capture, scheduling, payment execution | P | Fraud review, negotiation, exceptions |
| Payroll Clerk | Timesheets, payroll calculations, filings | Time tracking + calculations + filings | P | Compliance, disputes, tax law changes |
| Tax Preparer | Tax return prep, filings | Document assembly, form filling | P | Tax strategy, liability, licensed review |
| Financial Analyst | Forecasting, modeling, variance analysis | Reports, anomaly detection, scenario inputs | P | Interpretation, model design |
| CFO | Financial strategy, investor relations, risk | Summaries, dashboards, risk alerts | N | Accountability, judgment, external trust |
| Auditor | Verify records, test controls, issue opinions | Evidence collection, checklists | N | Independence, licensure, legal liability |
| Collections Agent | Payment follow-up, negotiation | Automated reminders, payment plans | P | Negotiation, legal escalations |
| Billing Specialist | Generate invoices, resolve billing issues | Routine invoicing, status lookup | R/P | Complex disputes remain P |
| Budget Coordinator | Budget tracking, alerts, variance reports | Tracking, alerts, reports | P | Budget-setting judgment |

---

## Sales & Business Development

| Role | Core Functions | What KEY Can Do Today | Target | Blockers to Target |
|---|---|---|---|---|
| SDR | Lead research, outreach, meeting booking | Lead scoring, sequences, booking links | P | Objection handling, live conversation |
| Account Executive | Discovery, demos, negotiation, closing | Summaries, deal context, proposal drafting | N | Trust, negotiation, closing judgment |
| Account Manager | Retention, upsell, relationship | Health alerts, renewal reminders, reports | N | Relationship ownership |
| Inside Sales Rep | Phone/email sales | Email drafting, follow-up, CRM updates | P | Persuasive conversation, objection handling |
| Lead Qualifier | Score leads, route to sales | Scoring rules, routing | R | — |
| CRM Administrator | Data hygiene, workflow setup, reporting | Data hygiene, workflow execution, reports | P | Workflow design, governance |
| Sales Operations Analyst | Pipeline analysis, forecasting, tooling | Pipeline reports, forecasting inputs | P | Forecast judgment |
| Business Development Rep | Partnership outreach, research | Research, templated outreach | P | Negotiation, relationship |
| Proposal Writer | RFP responses, quotes, proposals | Templated generation, quote assembly | P | Bespoke strategy, win-themes |
| Quoting Specialist | Generate quotes, pricing, approvals | Quote generation, approval routing | R/P | Complex pricing exceptions |
| Sales Coordinator | Scheduling, follow-up, order entry | Calendar, reminders, CRM order entry | R | — |

---

## Marketing & Communications

| Role | Core Functions | What KEY Can Do Today | Target | Blockers to Target |
|---|---|---|---|---|
| Social Media Manager | Content calendar, posting, engagement | Scheduling, templated replies, analytics | P | Creative direction, crisis response |
| Social Media Responder | Reply to comments/DMs | Ingestion + drafting + routing | P | Brand-risk escalation |
| Content Marketer | Blog posts, ebooks, email copy | Draft generation, research | P | Strategy, brand voice, final edit |
| Copywriter | Ad copy, landing pages, descriptions | First drafts, variants | P | Creative judgment |
| Email Marketer | Campaigns, segmentation, automation | Campaign execution, segmentation | P | Strategy, creative |
| SEO Specialist | Keyword research, on-page, reporting | Research, technical checks, reports | P | Authority building, strategy |
| Paid Media Manager | Ad buying, budget, optimization | Rule-based optimization, reporting | P | Budget judgment, creative |
| Marketing Analyst | Campaign reporting, attribution | Reports, dashboards | P | Attribution interpretation |
| PR Specialist | Press releases, media relations | Draft releases | N | Media relationships, crisis |
| Brand Manager | Brand strategy, guidelines, campaigns | Maintain guidelines, generate assets | N | Creative judgment |
| Community Manager | Forum/Discord moderation, engagement | Moderation rules, routing | P | Nuanced conflict resolution |
| Graphic Designer | Visual design, layouts | AI-assisted generation | P | Original brand design |
| Video Editor | Editing, captions, variants | Assisted editing | P | Storytelling |
| Event Coordinator | Vendor booking, registrations, reminders | Scheduling, reminders, registrations | P | On-site coordination |

---

## Customer Service & Support

| Role | Core Functions | What KEY Can Do Today | Target | Blockers to Target |
|---|---|---|---|
| L1 Support Agent | FAQs, order status, password resets | Knowledge base + actions + chat | R | Auto-approve threshold not wired |
| L2 Support Agent | Troubleshooting, refunds, exceptions | Structured troubleshooting, refund rules | P | Nuanced cases, escalation judgment |
| Technical Support Engineer | Bug diagnosis, workaround guidance | Log analysis, KB routing | P | Hands-on debugging |
| Customer Success Manager | Onboarding, adoption, retention | Onboarding workflows, health alerts | N | Relationship, strategic advice |
| Help Desk Technician | Ticket triage, routing, knowledge base | Triage, routing, KB suggestions | P | Hands-on fixes |
| Live Chat Agent | Real-time chat support | Chatbot + escalation | P | Empathy, complex cases |
| Call Center Agent | Phone support | Voice + IVR | P | Complex empathy-driven calls |
| Complaints Handler | Escalated complaints, retention | Summarize, route, suggest responses | N | High-emotion, brand-risk |
| Returns / Refunds Processor | Return authorization, refunds | Rule-based returns | R/P | Exceptions remain P |
| Feedback Analyst | Survey analysis, sentiment, reporting | Sentiment, summaries, reports | P | Action planning |

---

## Operations & Logistics

| Role | Core Functions | What KEY Can Do Today | Target | Blockers to Target |
|---|---|---|---|
| Operations Coordinator | Task assignment, tracking, reminders | Command queue, project tracking | P | Supplier relations, exceptions |
| Project Manager | Planning, scheduling, status, risk | Planning, Gantt-like tracking, status | P | Stakeholder management |
| Project Coordinator | Scheduling, note-taking, action tracking | Calendar, notes, task tracking | R | — |
| Logistics Coordinator | Shipment tracking, routing, alerts | Tracking, routing, alerts | P | Exception resolution |
| Warehouse Clerk | Pick/pack/ship, inventory counts | Dispatch docs, inventory alerts | N | Physical work |
| Dispatch Coordinator | Assign drivers, route optimization | Routing, assignment | P | Real-time disruption |
| Inventory Manager | Stock levels, reorder points, counts | Alerts, reorder suggestions | P | Physical counts, negotiation |
| Quality Control Inspector | Inspect goods, defect logging | Image capture + logging | P | Physical inspection |
| Process Analyst | Document processes, metrics, improvements | Documentation, metrics | P | Redesign judgment |
| Facilities Coordinator | Maintenance scheduling, vendor calls | Scheduling, vendor calls | P | Physical oversight |

---

## Supply Chain & Procurement

| Role | Core Functions | What KEY Can Do Today | Target | Blockers to Target |
|---|---|---|---|
| Procurement Buyer | Vendor selection, negotiation, POs | PO creation, reorder logic | P | Negotiation, selection |
| Purchasing Clerk | PO creation, order tracking, receiving | Routine POs, tracking | R/P | Discrepancies remain P |
| Supplier Relationship Manager | Negotiation, performance reviews | Performance reports | N | Relationship, negotiation |
| Demand Planner | Forecasting, inventory planning | Statistical forecasting | P | Market judgment |
| Supply Chain Analyst | Reports, dashboards, exceptions | Reporting, alerts | P | Strategic decisions |
| Vendor Onboarding Specialist | Document collection, setup, approvals | Forms, verification, approvals | R | — |

---

## Manufacturing & Production

| Role | Core Functions | What KEY Can Do Today | Target | Blockers to Target |
|---|---|---|---|
| Production Worker | Machine operation, assembly | Work instructions, alerts | N | Physical labor |
| Production Planner | Scheduling, capacity, material planning | Scheduling, material planning | P | Shop-floor judgment |
| Machine Operator | Run equipment, monitor output | Monitor telemetry, alert | N | Physical operation |
| Maintenance Technician | Repairs, preventive maintenance | Schedule PM, order parts | N | Physical repairs |
| Quality Engineer | Root cause analysis, specs | Data analysis, spec checks | P | Root-cause judgment |
| Safety Officer | Inspections, incident reporting | Incident intake, reports | N | Physical inspection |
| Process Engineer | Design processes, tooling | Documentation, simulations | N | Engineering design |

---

## Product / R&D / Engineering

| Role | Core Functions | What KEY Can Do Today | Target | Blockers to Target |
|---|---|---|---|
| Software Engineer | Write, test, deploy code | Code generation, tests | P | Accountability, architecture |
| QA Engineer | Test cases, bug reporting, regression | Generate tests, run suites | P | Exploratory testing |
| Product Manager | Roadmap, prioritization, user research | Data inputs, recommendations | N | Judgment, vision |
| Product Analyst | Usage metrics, A/B tests, reports | Metrics, reports | P | Insight, prioritization |
| UX Researcher | User interviews, synthesis | Summarize notes | N | Human empathy |
| UX Designer | Wireframes, flows, usability | AI-assisted drafts | P | Final UX judgment |
| Technical Writer | Docs, API references, guides | Draft generation | P | Accuracy review |
| DevOps Engineer | CI/CD, infra, monitoring | Automation, monitoring | P | Incident command |
| Data Engineer | Pipelines, transformations | Pipeline generation | P | Schema design |
| Data Scientist | Models, experiments, insights | Modeling assistance | P | Problem framing |

---

## Human Resources

| Role | Core Functions | What KEY Can Do Today | Target | Blockers to Target |
|---|---|---|---|
| HR Administrator | Onboarding docs, benefits admin, records | Document collection, routing | R/P | Benefits advice remains P |
| Recruiter | Sourcing, screening, interviewing | Sourcing, screening | P | Interviews, offers |
| Talent Acquisition Coordinator | Scheduling interviews, feedback collection | Calendar + forms + reminders | R | — |
| Payroll Administrator | Payroll inputs, changes, filings | Calculations, filings | P | Disputes, compliance |
| HR Business Partner | Employee relations, strategy | Data, recommendations | N | Coaching, conflict |
| L&D Specialist | Training design, delivery | Content delivery, quizzes | P | Live facilitation |
| Compensation Analyst | Salary benchmarking, reports | Data assembly, reports | P | Strategy, equity |
| Employee Engagement Manager | Surveys, action planning | Surveys, summaries | P | Culture change |

---

## Legal & Compliance

| Role | Core Functions | What KEY Can Do Today | Target | Blockers to Target |
|---|---|---|---|
| Paralegal | Document review, research, filing | Document analysis, filing | P | Legal judgment |
| Contract Administrator | Contract storage, renewal alerts, routing | Storage, alerts, routing | R | — |
| Compliance Analyst | Policy checks, audit evidence, reports | Checklists, evidence, reports | P | Interpretation |
| Compliance Officer | Risk decisions, regulatory liaison | Risk summaries | N | Accountability |
| Lawyer / Attorney | Legal advice, representation | Research, drafting | N | Licensure, liability |
| Risk Manager | Risk assessment, mitigation | Data aggregation, scoring | P | Mitigation decisions |
| Internal Auditor | Controls testing, reports | Evidence collection | N | Independence |

---

## IT & Technology

| Role | Core Functions | What KEY Can Do Today | Target | Blockers to Target |
|---|---|---|---|
| IT Support Technician | Ticket triage, password resets, setup | Triage, KB routing, resets | P | Hardware work |
| System Administrator | Server/config management | Automation, monitoring | P | Incident command |
| Network Engineer | Network design, troubleshooting | Documentation, monitoring | N | Physical infrastructure |
| Security Analyst | Monitoring, alerts, incident response | Alert triage, log analysis | P | Response decisions |
| Database Administrator | Backups, tuning, schema changes | Monitoring, maintenance | P | Critical changes |
| IT Procurement | License tracking, renewals | Tracking, renewals | R/P | Negotiation remains P |
| SaaS Admin | User provisioning, access reviews | User lifecycle, access reviews | R | — |

---

## Real Estate & Facilities

| Role | Core Functions | What KEY Can Do Today | Target | Blockers to Target |
|---|---|---|---|
| Property Manager | Tenant relations, maintenance, rent | Rent collection, maintenance scheduling | P | Tenant relations |
| Leasing Agent | Showings, applications, leases | Application processing, screening | P | Showings, negotiation |
| Facilities Manager | Maintenance, vendors, safety | Scheduling, vendor management | P | Physical oversight |
| Cleaning Crew / Janitor | Cleaning, sanitization | Work orders | N | Physical work |
| Security Guard | Physical security | Alerts, logs | N | Physical presence |

---

## Healthcare & Wellness

| Role | Core Functions | What KEY Can Do Today | Target | Blockers to Target |
|---|---|---|---|
| Physician / NP | Diagnosis, treatment | Triage questionnaires, summaries | N | Licensure, liability |
| Nurse | Patient care, vitals, meds | Care reminders, documentation | N | Physical care |
| Medical Receptionist | Scheduling, check-in, reminders | Scheduling, reminders | R/P | In-person check-in |
| Medical Biller | Claims, coding, payments | Coding, claim submission | P | Appeals, audits |
| Medical Coder | Diagnosis/procedure coding | Rule-based coding | P | Complex cases |
| Patient Coordinator | Scheduling, follow-up, intake | Digital coordination | P | Sensitive conversations |
| Mental Health Counselor | Therapy, counseling | Session reminders | N | Empathy, licensure |
| Wellness Coach | Check-ins, plans, motivation | Plans, reminders | P | Motivation |
| Pharmacy Technician | Prescription filling, inventory | Inventory alerts | N | Physical dispensing |

---

## Hospitality & Food Service

| Role | Core Functions | What KEY Can Do Today | Target | Blockers to Target |
|---|---|---|---|
| Front Desk Agent | Check-in, reservations, guest requests | Reservations, requests | P | In-person service |
| Reservations Agent | Bookings, modifications, cancellations | Booking engine | R | — |
| Concierge | Recommendations, arrangements | Templated recommendations | P | High-touch requests |
| Housekeeper | Room cleaning | Work orders | N | Physical work |
| Chef / Cook | Food preparation | Recipes, inventory | N | Physical work |
| Server / Waiter | Table service | Ordering kiosk integration | N | Physical service |
| Restaurant Manager | Scheduling, inventory, customer issues | Scheduling, inventory, alerts | P | Floor management |
| Event Planner | Design, vendor coordination, day-of | Coordination, reminders | P | Creative design, on-site |
| Catering Coordinator | Orders, delivery scheduling, billing | Orders, scheduling, billing | R/P | Last-mile coordination |

---

## Retail & E-commerce

| Role | Core Functions | What KEY Can Do Today | Target | Blockers to Target |
|---|---|---|---|
| Cashier | Transaction processing | Online checkout | P/R | In-person POS partially |
| Sales Associate | Customer assistance, upsell | Recommendations, chat | P | In-person selling |
| Store Manager | Scheduling, inventory, ops | Scheduling, inventory, alerts | P | Floor leadership |
| E-commerce Manager | Listings, orders, campaigns | Execution, reporting | P | Strategy, creative |
| Order Fulfillment Clerk | Pick/pack/ship | Dispatch docs | N | Physical work |
| Inventory Counter | Physical stock counts | Alerts | N | Physical work |
| Returns Processor | Authorize, inspect, refund | Rule-based refunds | P | Inspection, disputes |
| Visual Merchandiser | Store layout, displays | Planning | N | Physical creative work |

---

## Professional Services

| Role | Core Functions | What KEY Can Do Today | Target | Blockers to Target |
|---|---|---|---|
| Attorney | Legal advice, representation | Research, drafting | N | Licensure, liability |
| CPA / Accountant | Tax, audit, advisory | Reporting, filing | N/P | Advisory and liability N |
| Management Consultant | Strategy, change management | Data, options | N | Judgment, relationships |
| Financial Advisor | Investment advice | Portfolio summaries | N | Fiduciary, licensure |
| Insurance Agent | Policy sales, claims support | Quoting, document collection | P | Sales, claims decisions |
| Real Estate Agent | Showings, negotiation | Listing management | N | Licensing, negotiation |
| Recruiting Consultant | Executive search | Research | N | Relationship |
| Agency Account Manager | Client relationship, oversight | Status reports | N | Relationship |
| Agency Project Manager | Scheduling, resourcing, status | Tracking, reporting | P | Client diplomacy |

---

## Creative & Content

| Role | Core Functions | What KEY Can Do Today | Target | Blockers to Target |
|---|---|---|---|
| Graphic Designer | Visual design | AI generation | P | Original brand design |
| Art Director | Creative vision, brand | Asset curation | N | Vision |
| Copywriter | Ad copy, content | Drafts, variants | P | Final brand voice |
| Video Producer | Filming, editing, story | Editing assistance | P | Filming, story |
| Photographer | Image capture | Curation | N | Physical creative work |
| Animator / Motion Designer | Animation | Assisted animation | P | Direction |
| Musician / Composer | Original music | AI generation | P | Creative direction |
| Brand Strategist | Positioning, architecture | Research | N | Strategic judgment |

---

## Education & Training

| Role | Core Functions | What KEY Can Do Today | Target | Blockers to Target |
|---|---|---|---|
| Teacher / Professor | Instruction, mentoring, assessment | Content delivery, quizzes | N | Pedagogy, accreditation |
| Tutor | 1:1 help, explanation | AI tutoring | P | Accountability |
| Curriculum Designer | Course design, outcomes | AI-assisted design | P | Pedagogy |
| Instructional Designer | Learning materials, quizzes | Content generation | P | Learning science |
| LMS Administrator | Enrollments, reporting, access | User management, reports | R | — |
| Training Coordinator | Scheduling, materials, attendance | Calendar + materials + reminders | R | — |

---

## Field Services & Trades

| Role | Core Functions | What KEY Can Do Today | Target | Blockers to Target |
|---|---|---|---|
| Electrician / Plumber / HVAC Tech | Installation, repair | Diagnostics, parts ordering | N | Licensed physical work |
| Field Service Technician | On-site repair, diagnostics | Remote diagnostics, parts | P | Hands-on work |
| Dispatcher | Assign jobs, route technicians | Routing, assignment | P | Real-time judgment |
| Service Coordinator | Scheduling, parts, billing | Scheduling, billing | P | Exception handling |
| Safety Inspector | Site inspections | Checklists, reports | N | Physical inspection |
| Estimator | Cost estimates, quotes | Rule-based quotes | P | Site conditions, negotiation |

---

## Agriculture & Outdoor

| Role | Core Functions | What KEY Can Do Today | Target | Blockers to Target |
|---|---|---|---|
| Farmer / Grower | Planting, harvesting, animal care | Data, recommendations | N | Physical labor |
| Agronomist | Crop advice, soil analysis | Data analysis, recommendations | P | Field judgment |
| Logger / Fisher / Miner | Resource extraction | Monitoring | N | Physical work |
| Landscape Worker | Maintenance, planting | Work orders | N | Physical work |
| Drone Operator | Aerial surveys, spraying | Flight planning | P | Regulatory/emergency control |

---

## Summary by Replaceability

### Replaceable (R) — Today or near-term
Data Entry Clerk, File/Records Clerk, Transcriptionist, Notetaker, Meeting Scheduler, Expense Processor, AR Clerk, Lead Qualifier, Sales Coordinator, Contract Administrator, Vendor Onboarding Specialist, SaaS/LMS Admin, Training Coordinator, Reservation Agent, Board Secretary, Project Coordinator, File Clerk.

### Partially Replaceable (P) — Human-in-the-loop
Executive Assistant, Chief of Staff, Bookkeeper, AP/Payroll Clerk, Billing Specialist, Collections, Financial/Budget Analyst, SDR, Inside Sales, Proposal Writer, Quoting Specialist, Social Media Manager/Responder, Content/Copywriter, Email Marketer, SEO/Paid Media Manager, Marketing Analyst, Community Manager, Graphic Designer, Video Producer, Animator, L1/L2 Support, Help Desk, Live Chat, Call Center, Feedback Analyst, Operations/Project Coordinator, Logistics/Inventory Manager, QC Inspector, Process Analyst, Facilities Coordinator, Procurement Buyer/Purchasing Clerk, Demand Planner, Supply Chain Analyst, Production Planner, Quality Engineer, Software/QA Engineer, Product/Data/UX Analyst, UX Designer, Technical Writer, DevOps/Data Engineer, Data Scientist, HR Admin, Recruiter, Talent Coordinator, Payroll Admin, L&D/Engagement/Compensation, Compliance/Risk Analyst, Paralegal, IT Support, Sysadmin, Security/DBA, IT Procurement, Property/Leasing Admin, Medical Receptionist/Biller/Coder, Patient Coordinator, Wellness Coach, Front Desk/Concierge, Catering Coordinator, Cashier (online), Sales Associate (digital), Store Manager (back office), E-commerce Manager, Insurance Agent, Agency PM, Photographer (assisted), Musician/Composer (assisted), Tutor, Curriculum/Instructional Designer, Field Service Tech, Dispatcher, Service Coordinator, Estimator, Agronomist, Drone Operator.

### Not Replaceable (N)
CEO/CFO/C-suite, Board member, Attorney, CPA/Auditor (independent), Physician/Nurse/Pharmacist/Counselor, Teacher/Professor, Physical security, Firefighter/EMT, Chef/Server/Bartender, Housekeeper, Farmer, Electrician/Plumber/HVAC, Mechanic, Truck/Delivery Driver, Warehouse Worker, Machine Operator, Safety Inspector, Construction Worker, Real Estate Agent, Management Consultant, Account Executive/Manager, Recruiting Consultant, Brand Strategist, Art Director, Photographer (original), Product Manager, UX Researcher, Network Engineer.

---

## Key Insight

The dividing line is not “white collar vs. blue collar” — it is:

- **Digital + rule-based + low liability = R**
- **Digital + judgment/exceptions/relationships = P**
- **Physical + licensed + high-trust + creative leadership = N**

KEY’s immediate headcount impact is replacing the **administrative glue** that exists inside every business tier. That alone is a large addressable set of roles.
