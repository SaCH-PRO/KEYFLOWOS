
Here is the KeyFlow OS Master Execution Blueprint, a standalone document synthesizing all strategic, technical, and philosophical components into a single, actionable plan.
This document is built on the "Modular-Isolationist" development approach. Each module will be built and tested as a complete, standalone component first. Only after all modules are proven stable will we build the final integration layer to enable cross-module automation and AI. This ensures stability, easy debugging, and a clear, checklist-style path to completion.

________________________________________

1. KeyFlow OS: Core Philosophy & Strategic Architecture

The Problem: Modern Business is Fragmented
Modern businesses do not fail only because they lack customers. They fail because they cannot coordinate everything that must happen between "I have an idea" and "the business runs itself."
Most entrepreneurs, especially in service industries (clinics, agencies, coaches, wellness), live in a tool maze:
 * Leads: WhatsApp / Instagram DMs
 * Content: Canva
 * Scheduling: Meta Business Suite
 * Bookings: Google Calendar
 * Invoicing: Excel or a notebook
 * Payments: A separate bank app or payment link
This fragmentation produces systemic problems: context loss (the business doesn't remember the customer's story), execution friction (quotes don't become invoices automatically), channel silos (social media is not tied to revenue), and no intelligence loop (the business never learns what is working).

The Solution: An AI-Powered Operating System
KeyFlow OS is not another set of tools. It is an AI-powered operating system that runs pre-built "Playbooks" for service businesses.
It's built on a unified "Business Graph" (our database) that eliminates context-loss, and it's run by an AI "Brain" (our "Observe → Act" loop).
Users build their business visually in the "Studio" and run it from the "Cockpit"—a central dashboard that provides a conversational Flow Feed and a real-time visual graph of all business activity.
Our mission is to create a digital nervous system where every module, client, and action flows together in real time.

2. The Five Pillars of KeyFlow's Architecture
Our philosophy is built on core principles that translate directly into an architectural mandate.

Pillar 1: Market Readiness (The "Wedge")
* Core Principle: Software should arrive pre-opinionated. KeyFlow provides the playbooks for a modern business, which the user can then edit as needed.
 * Analysis: The "Tool Maze" is our target's primary pain point. They are practitioners (clinicians, designers) forced to be administrators. Our most critical wedge is to not be another "build-it-yourself" platform. We must sell a solved problem, not a better box of bricks.
 * Architectural Mandate: We must weaponize "pre-opinionated" flows. The system must deliver tangible value within the first 60 seconds of onboarding.
 * Action Plan:
   * Zero-Friction Onboarding: The initial user experience must solve one fragmented loop.
     * Flow: Sign Up → Connect Google Calendar → Connect WhatsApp → Receive a public booking link.
     * Result: The user can immediately paste this link into their Instagram bio and get immediate, tangible value (a professional, automated booking experience).
   * The "Playbook Library": We do not offer "templates"; we offer "Playbooks." A user doesn't install a template; they activate a "Flow."
     * Example Playbook: "Activate the 5-Star Review Flow"
       * Observes: Booking status: COMPLETED
       * Waits: 2 hours
       * Acts: Sends a WhatsApp message: "Hi [Client Name], how was your session? Rate it 1-5."
       * Learns: If 4-5 stars, reply with "Thank you! Would you mind leaving us a Google Review? [link]". If 1-3 stars, notify the business owner to follow up.

Pillar 2: Cutting-Edge Vision (The "Moat")
 * Core Principle: AI is not a feature, it’s the brain. The AI is the operational partner that observes business activity, plans what to do next, creates the artifacts (posts, emails), and acts on the user's behalf.
 * Analysis: The market is flooded with "AI features" (e.g., "generate a blog post"). Our vision is AI Operation. The "Observe → Plan → Create → Act → Learn" loop implies the AI is an agent that operates the business, not a tool the user operates. This is our strategic moat.
 * Architectural Mandate: The AI Brain must be the central, event-driven service. It consumes data from all modules (CRM, Commerce, Bookings) to execute the Playbooks (from Pillar 1).
 * Action Plan:
   * Position as "Autopilot for Service Businesses": The user's job is to be the practitioner. The AI's job is to be the administrator.
   * The "Cockpit" (The Flow Hub): The main dashboard is not a static page of charts. It is a living Flow Hub that contains two primary views:
    * a) The "Flow Graph" (Visual): A real-time, visual representation of the entire business. It shows nodes (e.g., Leads, Bookings, Quotes Sent, Paid Invoices) and the flow of customers between them, allowing the user to instantly spot bottlenecks (e.g., "Many quotes sent, but few paid") or successes.
     * b) The "Flow Feed" (Conversational): Our "KeyFlow: Command" concept. A feed showing what just happened and what to do next. (e.g., "✅ Sarah Smith just paid Invoice #004.", "🔔 You haven't followed up with 'New Lead: John' in 3 days. [Draft a WhatsApp follow-up].")
       This turns data (an invoice paid) into an intelligent, automated action (a review request), making the AI our "digital nervous system."










Pillar 3: Adaptability (The "Platform")
 * Core Principle: Businesses are flows, not islands. A lead should move from discovery to conversation, to proposal, to invoice, to booking, and to follow-up without human re-entry of data.
 * Analysis: This principle is the key to adaptability. We must evolve our architecture from "modular" (siloed) to "composable" (re-wireable).
 * Architectural Mandate: The "Playbooks" (from Pillar 1) must be built on a composable event-action framework. The system is "pre-opinionated," but the user must be able to edit those opinions.
 * Action Plan:
   * Internal Event Bus: All modules (Commerce, Bookings, Social) must emit events (e.g., booking.created, invoice.paid) to a central bus.
   * Visual Flow Builder: We must build a simple, "Zapier-like" UI (using React Flow) that allows users to edit or create their own Playbooks.
   * Future-Proofing (The "Flow Marketplace"): This architecture creates our platform strategy. In Phase 2, we allow power-users (e.g., a top marketing agency) to publish their "Ultimate Client Onboarding Flow" for other users to install, scaling our Playbook library.

Pillar 4: Ease of Use (The "Interface")
 * Analysis: The core problem is complexity. The user is overwhelmed by the "tool maze." Our solution must be radically simple. The AI Brain and Playbooks are the keys to this simplicity, as the system tells the user what to do next.
 * Architectural Mandate: We must support a dual-interface architecture that separates building from running.
 * Action Plan:
   * The "Studio" (Build): A visual, modular UI where a user configures their business. They set up services, edit Playbooks, and connect accounts. This is where they "think like an architect."
   * The "Cockpit" (Run): This is the day-to-day interface, the Flow Hub. It is AI-first and delivers radical simplicity through two views:
    * Visual: The "Flow Graph" (from Pillar 2) gives an immediate, high-level understanding of business health.
     * Conversational: The "Flow Feed" (from Pillar 2) and Cmd+K command bar allow for instant action, bypassing the "tool maze" entirely.
       * Instead of: "Click Bookings → Click Calendar → Find 3:00 PM → Click to create..."
       * The User does: Cmd+K → "Book [Client Name] for 3pm today."

Pillar 5: Virality (The "Loop")
 * Analysis: Virality is an architectural feature, not a marketing one. Our "flows" are our viral loops. Every time a business flow touches the outside world, it is a marketing opportunity.
 * Architectural Mandate: The public-facing assets (booking links, invoices) generated by KeyFlow must be so clean, professional, and seamless that they act as an implicit, high-status advertisement for the platform.
 * Action Plan:
   * Client-Side Viral Loop (Implicit):
     * A client receives a KeyFlow booking link. The page is beautiful, fast, and simple.
     * They pay a KeyFlow invoice. The payment page is clean and professional.
     * At the bottom of each asset: a subtle, elegant "Powered by KeyFlow."
     * The client (often an entrepreneur themselves) sees this and thinks, "This is so much better than the 5 tools I use. I need this."
   * Creator-Side Viral Loop (Explicit):
     * The "Flow Marketplace" (from Pillar 3). When a power-user shares a valuable Playbook, they are creating a new user acquisition channel for us.
→ Result: Enables seamless business flow from first-contact to automated follow-up, creating a defensible, high-value, and viral business ecosystem.
.

This plan is optimized for flawless execution by an AI co-builder, with explicit, unambiguous directives for all critical, error-prone setup tasks. It solves all previously identified risks, including data integrity, module coupling, and UI complexity, enabling the most efficient path to a "fresh, interactive, and gamified" product.

________________________________________

2. Core Architecture & Tech Stack
This architecture is the "flow" made manifest. It is a modern, scalable, and efficient system designed to be built and tested one module at a time. It is free to start and infinitely scalable.

2.1. Project Structure: The Monorepo
We will use a pnpm monorepo. This is the most efficient structure for sharing code and types, ensuring perfect consistency between the frontend, backend, and database.
•	KEYFLOWOS/
o	apps/web/: The UI (Next.js 14+ App Router). This is the single, unified frontend for the entire user journey. It serves:
	Public Pages: The marketing Homepage/Landing Page, the public-facing "Social Links" page (our /@username feature), and all client-facing pages (e.g., /book/[slug], /pay/[invoiceId]).
	App Pages: The entire authenticated application, including the central "Cockpit" (Dashboard) and all module break-out pages (Commerce, Bookings, Settings, etc.).
o	apps/server/: The Engine (NestJS). The API "brain" for all modules. Its code structure (CommerceModule, BookingsModule) will perfectly mirror our isolated build plan.
o	packages/db/: The Blueprint (Prisma). The "Business Graph." Our single, type-safe source of truth, enhanced with data-safety middleware.
o	packages/ui/: (CRITICAL) The UI Kit (Storybook). This is your design sandbox. This is where you will build, test, and "refine the UI to your liking before moving on." All components, from shadcn/ui recipes to custom animated elements, will be perfected here in isolation.
o	packages/api/: (CRITICAL) The API Contract (tRPC). This package defines the type-safe contract between the server and the web client. This is the key to a fast, error-free API, eliminating all API-mismatch bugs.







2.2. Core Technology Stack: The "Free, Fast, & Fresh" Stack
This stack is 100% "free-tier" friendly and optimized for a cutting-edge feel.
•	Frontend: Next.js (App Router).
•	Backend: NestJS.
•	API Contract: tRPC. This is our explicit choice. It allows our Next.js frontend to call our NestJS backend with full end-to-end type safety, eliminating all API-mismatch bugs.
•	Database: Supabase (PostgreSQL).
•	Authentication: Supabase Auth.
•	File Storage: Supabase Storage.
•	ORM: Prisma.
•	Background Jobs: Trigger.dev.
•	Internal Event Bus: NestJS EventEmitterModule. This is the architectural core of "Flow." Modules must not call each other directly. CommerceModule emits an invoice.paid event. A separate FlowModule listens for this and calls the BookingsModule.
•	AI Orchestration: LangChain.js + Vercel AI SDK.
•	AI Memory: Supabase pgvector.

2.3. UI/UX Accelerator Stack: The "Refinement" Stack
This stack is 100% focused on UI control and refinement. We are removing complex, high-risk accelerators to give you maximum control and speed.
•	Core UI System: shadcn/ui. This is key. It is not a component library; it is a set of copy-paste recipes. You run a command (npx shadcn-ui@latest add button), and it adds the Button.tsx file directly into your packages/ui project. You are 100% free to edit the file and perfect its styles in Storybook.
•	Styling: Tailwind CSS.
•	Icons: lucide-react. The clean, modern icon pack that integrates perfectly with shadcn/ui.
•	Animation (for "Fresh" & "Gamified" UI): Framer Motion. The industry standard for React animation.
•	Command Bar (Cockpit): cmdk. The free, fast, and beautiful Cmd+K component that will power our "KeyFlow: Command" AI interface.
•	Calendars (Modules 4 & 5): FullCalendar. The most robust, free solution for complex multi-staff availability views.
•	Dashboard Charts (Module 8): Tremor. A free, modern, copy-paste React library for beautiful dashboards that is built on Tailwind.
•	Flow Graph (Cockpit): React Flow. (Used only for visualization, not building).
•	DE-SCOPED (Post-MVP):
o	Grape.js (Site Builder): Removed.
o	React Flow (as an Automation Builder): Removed.
o	MVP Solution: The "Social Links" page (Module 7) and "Automation Builder" (Module 6) will be built with simple, clean shadcn/ui forms. This delivers 100% of the core value in a testable, customizable, and 10x faster way.

2.4. Core Architectural Principles (AI Execution Directives)
1.	Principle: Isolate with Events. Modules must not have knowledge of each other. All cross-module communication must go through the EventEmitterModule.
2.	Principle: Preserve Data with Soft Deletes. We will not use hard deletes or onDelete: Cascade for any business-critical data.
3.	Principle: Automate Data Safety. We will use Prisma Middleware to automatically enforce soft deletes and multi-tenancy. This is non-negotiable.
4.	
________________________________________

3. The Business Graph: Master Prisma Schema
This is the definitive, production-ready schema. It is optimized for Data Integrity (soft deletes), Performance (indexes), UI Gamification (metaData), and Caribbean Localization (TTD).
•	Location: packages/db/prisma/schema.prisma
Code snippet
// This is your datasource, pointing to your Supabase Postgres DB
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

generator client {
  provider        = "prisma-client-js"
  // Output to a shared, generated location within packages/db
  output          = "../src/generated/client" 
  previewFeatures = ["prismaMiddleware"] // Enable middleware for soft deletes
}

// ---
// MODULE 1: IDENTITY & ACCOUNTS
// ---
model User {
  id    String @id @default(cuid()) // Corresponds to Supabase auth.users.id
  email String @unique
  name  String?

  businesses Membership[]
  sessions   Session[]

  @@map("users")
}

model Business {
  id      String @id @default(cuid())
  name    String
  ownerId String @map("owner_id")

  // Module Relationships
  members      Membership[]
  contacts     Contact[]
  invoices     Invoice[]
  quotes       Quote[]
  products     Product[]
  bookings     Booking[]
  services     Service[]
  staff        StaffMember[]
  socialPosts  SocialPost[]
  socialConns  SocialConnection[]
  automations  Automation[]
  projects     Project[]
  projectTasks ProjectTask[]
  sites        Site[]
  
  // Field for UI/UX: Gamification, Onboarding, etc.
  metaData     Json?     @default("{}") @map("meta_data") // e.g., { "onboardingStep": 2, "firstSaleMade": true }

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at") // Soft delete for the entire business

  @@map("businesses")
}

model Membership {
  id   String @id @default(cuid())
  role String // "OWNER", "ADMIN", "STAFF"

  userId     String   @map("user_id")
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade) // Safe to cascade
  businessId String   @map("business_id")
  business   Business @relation(fields: [businessId], references: [id], onDelete: Cascade) // Safe to cascade

  @@unique([userId, businessId])
  @@index([userId])
  @@index([businessId])
  @@map("memberships")
}

model Session {
  id        String   @id @default(cuid())
  expiresAt DateTime @map("expires_at")
  userId    String   @map("user_id")
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("sessions")
}

// ---
// MODULE 2: CRM (RELATIONSHIP INTELLIGENCE)
// ---
model Contact {
  id        String   @id @default(cuid())
  firstName String?  @map("first_name")
  lastName  String?  @map("last_name")
  email     String?  @unique
  phone     String?
  
  businessId String   @map("business_id")
  business   Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  
  // Relationships
  quotes     Quote[]
  invoices   Invoice[]
  bookings   Booking[]

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at") // Soft delete

  @@index([businessId])
  @@map("contacts")
}

// ---
// MODULE 3: COMMERCE (QUOTES, INVOICES, PAYMENTS)
// ---
model Product {
  id          String   @id @default(cuid())
  name        String
  description String?
  price       Float
  currency    String   @default("TTD") // Caribbean localization

  businessId String   @map("business_id")
  business   Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  
  // Relationships
  quoteItems   QuoteItem[]
  invoiceItems InvoiceItem[]
  projectTemplate ProjectTemplate? // Link to a project template

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at") // Soft delete

  @@index([businessId])
  @@map("products")
}

model Quote {
  id          String   @id @default(cuid())
  quoteNumber String   @map("quote_number")
  status      String   @default("DRAFT") // DRAFT, SENT, ACCEPTED, REJECTED
  total       Float
  currency    String   @default("TTD")
  issueDate   DateTime @default(now()) @map("issue_date")
  expiryDate  DateTime? @map("expiry_date")

  businessId String  @map("business_id")
  business   Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  contactId  String  @map("contact_id")
  contact    Contact @relation(fields: [contactId], references: [id], onDelete: NoAction) // DATA INTEGRITY: Do not delete quote if contact is deleted
  
  items       QuoteItem[]
  invoiceId   String?  @unique @map("invoice_id")
  invoice     Invoice?

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at") // Soft delete

  @@unique([businessId, quoteNumber])
  @@index([businessId, contactId])
  @@map("quotes")
}

model QuoteItem {
  id          String  @id @default(cuid())
  description String
  quantity    Int
  unitPrice   Float   @map("unit_price")
  total       Float

  quoteId   String   @map("quote_id")
  quote     Quote    @relation(fields: [quoteId], references: [id], onDelete: Cascade) // Safe to cascade
  productId String?  @map("product_id")
  product   Product? @relation(fields: [productId], references: [id], onDelete: NoAction) // DATA INTEGRITY: Keep item history

  @@index([quoteId])
  @@index([productId])
  @@map("quote_items")
}

model Invoice {
  id            String   @id @default(cuid())
  invoiceNumber String   @map("invoice_number")
  status        String   @default("DRAFT") // DRAFT, SENT, PAID, VOID, OVERDUE
  total         Float
  currency      String   @default("TTD")
  issueDate     DateTime @default(now()) @map("issue_date")
  dueDate       DateTime? @map("due_date")
  paidAt        DateTime? @map("paid_at")

  businessId    String   @map("business_id")
  business      Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  contactId     String   @map("contact_id")
  contact       Contact  @relation(fields: [contactId], references: [id], onDelete: NoAction) // DATA INTEGRITY
  
  items         InvoiceItem[]
  payments      Payment[]
  booking       Booking?
  quote         Quote?   @relation(fields: [quoteId], references: [id], onUpdate: NoAction, onDelete: NoAction) // DATA INTEGRITY
  quoteId       String?  @unique @map("quote_id")

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at") // Soft delete

  @@unique([businessId, invoiceNumber])
  @@index([businessId, contactId])
  @@map("invoices")
}

model InvoiceItem {
  id          String  @id @default(cuid())
  description String
  quantity    Int
  unitPrice   Float   @map("unit_price")
  total       Float

  invoiceId String   @map("invoice_id")
  invoice   Invoice  @relation(fields: [invoiceId], references: [id], onDelete: Cascade) // Safe to cascade
  productId String?  @map("product_id")
  product   Product? @relation(fields: [productId], references: [id], onDelete: NoAction) // DATA INTEGRITY

  @@index([invoiceId])
  @@index([productId])
  @@map("invoice_items")
}

model Payment {
  id                String   @id @default(cuid())
  amount            Float
  currency          String
  status            String   // PENDING, SUCCESSFUL, FAILED
  provider          String   // "stripe", "wipay"
  providerPaymentId String   @unique @map("provider_payment_id")
  createdAt         DateTime @default(now()) @map("created_at")

  businessId String  @map("business_id") // For easier indexing
  invoiceId  String  @map("invoice_id")
  invoice    Invoice @relation(fields: [invoiceId], references: [id], onDelete: NoAction) // DATA INTEGRITY

  @@index([businessId, invoiceId])
  @@map("payments")
}

// ---
// MODULE 4: BOOKINGS (SCHEDULING & TIME)
// ---
model StaffMember {
  id   String @id @default(cuid())
  name String

  businessId String   @map("business_id")
  business   Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  
  services       Service[]
  bookings       Booking[]
  availabilities Availability[]

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at") // Soft delete

  @@index([businessId])
  @@map("staff_members")
}

model Service {
  id          String   @id @default(cuid())
  name        String
  description String?
  duration    Int      // Duration in minutes
  price       Float    // Price for this service

  businessId String   @map("business_id")
  business   Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  
  bookings Booking[]
  staff    StaffMember[] // Staff who can perform this service

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at") // Soft delete

  @@index([businessId])
  @@map("services")
}

model Availability {
  id        String @id @default(cuid())
  dayOfWeek Int    @map("day_of_week") // 0 = Sunday, 1 = Monday, etc.
  startTime String @map("start_time") // "HH:MM"
  endTime   String @map("end_time") // "HH:MM"

  staffId String      @map("staff_id")
  staff   StaffMember @relation(fields: [staffId], references: [id], onDelete: Cascade) // Safe to cascade

  @@index([staffId])
  @@map("availabilities")
}

model Booking {
  id        String   @id @default(cuid())
  startTime DateTime @map("start_time")
  endTime   DateTime @map("end_time")
  status    String   @default("PENDING") // PENDING, CONFIRMED, CANCELLED, COMPLETED

  businessId String      @map("business_id")
  business   Business    @relation(fields: [businessId], references: [id], onDelete: Cascade)
  contactId  String      @map("contact_id")
  contact    Contact     @relation(fields: [contactId], references: [id], onDelete: NoAction) // DATA INTEGRITY
  serviceId  String      @map("service_id")
  service    Service     @relation(fields: [serviceId], references: [id], onDelete: NoAction) // DATA INTEGRITY
  staffId    String      @map("staff_id")
  staff      StaffMember @relation(fields: [staffId], references: [id], onDelete: NoAction) // DATA INTEGRITY
  
  invoiceId  String?  @unique @map("invoice_id")
  invoice    Invoice? @relation(fields: [invoiceId], references: [id], onUpdate: NoAction, onDelete: NoAction) // DATA INTEGRITY

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at") // Soft delete

  @@index([businessId, staffId, startTime, endTime])
  @@index([businessId, contactId])
  @@map("bookings")
}


// ---
// MODULE 5: SOCIAL INTELLIGENCE
// ---
model SocialConnection {
  id         String   @id @default(cuid())
  platform   String   // "FACEBOOK", "INSTAGRAM", "WHATSAPP"
  platformId String?  @map("platform_id")
  token      String   // Encrypted access token

  businessId String   @map("business_id")
  business   Business @relation(fields: [businessId], references: [id], onDelete: Cascade)

  @@index([businessId])
  @@map("social_connections")
}

model SocialPost {
  id          String   @id @default(cuid())
  content     String
  mediaUrls   String[] @map("media_urls")
  status      String   @default("DRAFT") // DRAFT, SCHEDULED, POSTED, FAILED
  scheduledAt DateTime? @map("scheduled_at")
  postedAt    DateTime? @map("posted_at")

  businessId String   @map("business_id")
  business   Business @relation(fields: [businessId], references: [id], onDelete: Cascade)

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at") // Soft delete

  @@index([businessId, status, scheduledAt])
  @@map("social_posts")
}

// ---
// MODULE 6: MARKETING AUTOMATION & PROJECTS
// ---
model Automation {
  id      String @id @default(cuid())
  name    String
  trigger String // "invoice.paid", "booking.created"

  businessId String   @map("business_id")
  business   Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  
  // MVP: Simple JSON for form-based actions
  // e.g., { "actionType": "SEND_WHATSAPP", "templateId": "abc", "contactField": "booking.contact" }
  actionData Json? @map("action_data")

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at") // Soft delete

  @@index([businessId, trigger])
  @@map("automations")
}

model Project {
  id     String @id @default(cuid())
  name   String
  status String @default("ACTIVE") // ACTIVE, COMPLETED, ARCHIVED

  businessId String @map("business_id")
  business   Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  
  tasks ProjectTask[]

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at") // Soft delete

  @@index([businessId])
  @@map("projects")
}

model ProjectTask {
  id          String   @id @default(cuid())
  title       String
  isCompleted Boolean  @default(false) @map("is_completed")
  dueDate     DateTime? @map("due_date")

  projectId String  @map("project_id")
  project   Project @relation(fields: [projectId], references: [id], onDelete: Cascade) // Safe to cascade
  
  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at") // Soft delete

  @@index([projectId])
  @@map("project_tasks")
}

model ProjectTemplate {
  id   String @id @default(cuid())
  name String
  
  taskTitles Json @map("task_titles") // Store the list of tasks to create as JSON

  businessId String   @map("business_id")
  business   Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  
  productId String?  @unique @map("product_id") // Link template to a *single* product
  product   Product? @relation(fields: [productId], references: [id], onDelete: SetNull) // DATA INTEGRITY

  @@index([businessId])
  @@map("project_templates")
}


// ---
// MODULE 7: WEBSITE & DIGITAL PRESENCE (MVP: Social Links Page)
// ---
model Site {
  id        String @id @default(cuid())
  subdomain String @unique // e.g., "keyflow.app/@myclinic"
  
  // MVP: Simple JSON for "Social Links" page
  // e.g., { "title": "My Clinic", "links": [{"name": "Website", "url": "..."}] }
  siteData Json? @map("site_data")

  businessId String   @unique @map("business_id")
  business   Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  
  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at") // Soft delete

  @@map("sites")
}
________________________________________

4. Debugged & Testable File/Folder Structure
This is the complete monorepo structure, designed for action.
KEYFLOWOS/
├── .gitignore
├── package.json             # Root package.json (for pnpm, scripts, and root devDependencies)
├── pnpm-workspace.yaml      # Defines the monorepo workspaces ("apps/*", "packages/*")
├── tsconfig.json            # Root TypeScript config
└── tsconfig.base.json       # Shared TypeScript settings (paths, aliases)
    
├── apps/
│   ├── server/              # --- The NestJS Backend Engine ---
│   │   ├── src/
│   │   │   ├── main.ts            # App entry point (registers global middleware, starts server)
│   │   │   ├── app.module.ts      # Root module (imports all feature modules and core modules)
│   │   │   ├── app.controller.ts  # Simple health-check endpoint
│   │   │   ├── app.service.ts
│   │   │   │
│   │   │   ├── core/              # Core services shared across all modules
│   │   │   │   ├── auth/            # Authentication & Authorization
│   │   │   │   │   ├── auth.module.ts
│   │   │   │   │   ├── jwt.strategy.ts  # Validates Supabase JWT
│   │   │   │   │   └── guards/
│   │   │   │   │       ├── jwt-auth.guard.ts # Protects routes
│   │   │   │   │       └── roles.guard.ts  # Checks "OWNER" vs "STAFF"
│   │   │   │   │
│   │   │   │   ├── event-bus/       # Our internal event emitter
│   │   │   │   │   ├── event-bus.module.ts
│   │   │   │   │   └── event-bus.service.ts
│   │   │   │   │
│   │   │   │   └── prisma/            # Connects to packages/db
│   │   │   │       ├── prisma.module.ts
│   │   │   │       └── prisma.service.ts  # Imports and *exports* the soft-delete client
│   │   │   │
│   │   │   ├── modules/           # --- ISOLATED FEATURE MODULES ---
│   │   │   │   │
│   │   │   │   ├── 1-identity/      # Module 1: Business & Team Management
│   │   │   │   │   ├── identity.module.ts
│   │   │   │   │   ├── identity.controller.ts # (e.g., POST /business, POST /team/invite)
│   │   │   │   │   ├── identity.service.ts
│   │   │   │   │   └── dto/
│   │   │   │   │       ├── create-business.dto.ts
│   │   │   │   │       └── invite-member.dto.ts
│   │   │   │   │
│   │   │   │   ├── 2-crm/           # Module 2: Contact Management
│   │   │   │   │   ├── crm.module.ts
│   │   │   │   │   ├── crm.controller.ts # (e.g., GET /contacts, POST /contacts)
│   │   │   │   │   ├── crm.service.ts
│   │   │   │   │   └── dto/
│   │   │   │   │       └── create-contact.dto.ts
│   │   │   │   │
│   │   │   │   ├── 3-commerce/      # Module 3: Invoices, Products, Payments
│   │   │   │   │   ├── commerce.module.ts
│   │   │   │   │   ├── commerce.controller.ts # (e.g., POST /invoices, GET /products)
│   │   │   │   │   ├── commerce.service.ts    # Emits 'invoice.paid' event
│   │   │   │   │   ├── webhooks.controller.ts # (e.g., POST /webhooks/stripe, POST /webhooks/wipay)
│   │   │   │   │   └── dto/
│   │   │   │   │       ├── create-invoice.dto.ts
│   │   │   │   │       └── create-product.dto.ts
│   │   │   │   │
│   │   │   │   ├── 4-bookings/      # Module 4: Services, Staff, Availability
│   │   │   │   │   ├── bookings.module.ts
│   │   │   │   │   ├── bookings.controller.ts # (e.g., GET /services, POST /bookings)
│   │   │   │   │   ├── availability.service.ts # Core logic for finding slots
│   │   │   │   │   ├── bookings.service.ts     # Emits 'booking.created' event
│   │   │   │   │   └── dto/
│   │   │   │   │       ├── create-booking.dto.ts
│   │   │   │   │       └── set-availability.dto.ts
│   │   │   │   │
│   │   │   │   ├── 5-social/        # (And so on for all modules...)
│   │   │   │   │
│   │   │   │   ├── 10-ai/           # The AI Brain (KeyFlow: Command)
│   │   │   │   │   ├── ai.module.ts
│   │   │   │   │   ├── ai.controller.ts     # (e.g., POST /ai/command)
│   │   │   │   │   ├── ai.service.ts        # Orchestrates LangChain.js
│   │   │   │   │   └── agents/
│   │   │   │   │       └── crm.agent.ts     # AI agent that can talk to CrmService
│   │   │   │   │
│   │   │   │   ├── flow/            # --- The Integration "Flow" Layer ---
│   │   │   │   │   ├── flow.module.ts
│   │   │   │   │   └── flow.listener.ts   # Listens for events (e.g., 'invoice.paid')
│   │   │   │   │                        # Calls other services (e.g., BookingsService.confirmBooking)
│   │   │   │   │
│   │   │   │   └── gamification/    # --- The Gamification Layer ---
│   │   │   │       ├── gamification.module.ts
│   │   │   │       └── gamification.listener.ts # Listens for events (e.g., 'invoice.paid')
│   │   │   │                                  # Updates Business.metaData (e.g., { "firstSaleMade": true })
│   │   │
│   │   ├── test/                  # End-to-End (e2e) tests
│   │   │   ├── app.e2e-spec.ts
│   │   │   └── commerce.e2e-spec.ts # Test file for *only* the commerce module
│   │   │
│   │   ├── .env.example
│   │   ├── nest-cli.json
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                     # --- The Next.js Frontend ---
│       ├── src/
│       │   ├── app/                 # --- Next.js 14 App Router ---
│       │   │   ├── (public)/          # Public marketing pages
│       │   │   │   ├── layout.tsx
│       │   │   │   ├── page.tsx         # The Homepage/Landing Page
│       │   │   │   ├── (auth)/          # Auth pages (login, signup)
│       │   │   │   │   ├── login/page.tsx
│       │   │   │   │   └── signup/page.tsx
│       │   │   │   │
│       │   │   │   ├── [username]/      # The "Social Links" page (e.g., /@keyflow)
│       │   │   │   │   └── page.tsx
│       │   │   │   │
│       │   │   │   ├── book/[slug]/   # Public booking page
│       │   │   │   │   └── page.tsx
│       │   │   │   │
│       │   │   │   └── pay/[invoiceId]/ # Public payment page
│       │   │   │       └── page.tsx
│       │   │   │
│       │   │   ├── (app)/             # Authenticated application
│       │   │   │   ├── layout.tsx       # Main app layout (Sidebar, Topbar, Cmd+K)
│       │   │   │   ├── page.tsx         # The "Cockpit" (Main Dashboard)
│       │   │   │   │
│       │   │   │   ├── crm/             # CRM break-out page
│       │   │   │   │   └── page.tsx
│       │   │   │   │
│       │   │   │   ├── commerce/        # Commerce break-out pages
│       │   │   │   │   ├── layout.tsx     # (e.g., Commerce-specific sub-nav)
│       │   │   │   │   ├── page.tsx       # Commerce overview
│       │   │   │   │   ├── invoices/page.tsx
│       │   │   │   │   └── products/page.tsx
│       │   │   │   │
│       │   │   │   ├── bookings/        # Bookings break-out page
│       │   │   │   │   └── page.tsx       # The (FullCalendar) view
│       │   │   │   │
│       │   │   │   ├── social/          # Social break-out page
│       │   │   │   │   └── page.tsx       # The content calendar
│       │   │   │   │
│       │   │   │   └── settings/        # The "Studio" configuration
│       │   │   │       ├── layout.tsx
│       │   │   │       ├── page.tsx         # Main settings hub
│       │   │   │       ├── profile/page.tsx
│       │   │   │       ├── business/page.tsx
│       │   │   │       ├── team/page.tsx
│       │   │   │       ├── connections/page.tsx # Connect Stripe, Socials
│       │   │   │       └── presence/page.tsx    # Configure the "/@username" links page
│       │   │   │
│       │   │   ├── api/                 # API Routes
│       │   │   │   ├── auth/callback/route.ts # Supabase Auth callback
│       │   │   │   └── trpc/[trpc]/route.ts   # tRPC handler
│       │   │   │
│       │   │   ├── globals.css        # Main Tailwind styles
│       │   │   ├── layout.tsx         # Root layout (ThemeProvider, Toaster)
│       │   │   └── page.tsx           # Should redirect to (public) or (app)
│       │   │
│       │   ├── components/            # Shared, simple components for this app
│       │   │   ├── providers.tsx        # ThemeProvider, QueryProvider, etc.
│       │   │   ├── command-palette.tsx  # The 'cmdk' component
│       │   │   ├── main-nav.tsx
│       │   │   └── user-nav.tsx
│       │   │
│       │   ├── lib/                   # Utility functions
│       │   │   ├── api.ts             # Type-safe tRPC client
│       │   │   ├── auth.ts            # Supabase-auth helper functions
│       │   │   └── utils.ts           # (e.g., cn() from shadcn)
│       │   │
│       │   └── types/                 # App-specific types
│       │       └── index.ts
│       │
│       ├── .env.example
│       ├── next.config.mjs
│       ├── package.json
│       ├── postcss.config.js
│       ├── tailwind.config.ts
│       └── tsconfig.json
│
└── packages/
    ├── api/                   # --- (NEW) tRPC API Contract ---
    │   ├── src/
    │   │   ├── index.ts         # Exports the root AppRouter
    │   │   ├── root.ts          # Merges all modular routers
    │   │   ├── trpc.ts          # Initializes tRPC, context, and middleware
    │   │   ├── routers/         # Routers for each module
    │   │   │   ├── crm.ts         # (e.g., crmRouter = trpc.router({ ... }))
    │   │   │   ├── commerce.ts
    │   │   │   └── bookings.ts
    │   │   │
    │   │   └── context.ts       # Defines the 'createContext' function
    │   │
    │   ├── package.json
    │   └── tsconfig.json
    │
    ├── db/                    # --- The Database Package ---
    │   ├── prisma/
    │   │   └── schema.prisma    # The Master Schema (from section 3)
    │   ├── src/
    │   │   ├── index.ts         # Exports the custom prisma client and generated types
    │   │   ├── client.ts        # Instantiates and exports the client *with middleware*
    │   │   ├── generated/client/  # Auto-generated by `pnpm db:generate`
    │   │   └── middleware/
    │   │       └── soft-delete.ts # The automated soft-delete middleware
    │   │
    │   ├── package.json
    │   └── tsconfig.json
    │
    └── ui/                    # --- The UI Refinement Package ---
        ├── .storybook/            # Storybook configuration
        │   ├── main.ts
        │   └── preview.ts
        ├── src/
        │   ├── components/
        │   │   ├── (app)/           # Components for the main app
        │   │   │   ├── dashboard/
        │   │   │   │   ├── stat-card.tsx
        │   │   │   │   └── stat-card.stories.tsx
        │   │   │   ├── commerce/
        │   │   │   │   ├── invoice-datatable.tsx
        │   │   │   │   └── invoice-datatable.stories.tsx
        │   │   │   └── shared/
        │   │   │       ├── command-palette.tsx
        │   │   │       └── command-palette.stories.tsx
        │   │   │
        │   │   ├── (public)/        # Components for the landing page
        │   │   │   ├── hero-section.tsx
        │   │   │   └── hero-section.stories.tsx
        │   │   │
        │   │   └── (base)/          # The "recipes" from shadcn/ui
        │   │       ├── button.tsx
        │   │       ├── button.stories.tsx
        │   │       ├── card.tsx
        │   │       └── card.stories.tsx
        │   │
        │   ├── lib/
        │   │   └── utils.ts       # (e.g., cn() function)
        │   │
        │   └── index.ts           # Barrel file (export * from './components/...')
        │
        ├── package.json
        └── tsconfig.json

________________________________________

5. AI Execution Directives (Zero-Error Implementation)
To ensure flawless, one-shot execution by an AI, these are the explicit, copy-pasteable instructions for the most complex parts of the setup.

5.1. Root package.json Scripts
Directive: Use these scripts in the root package.json to manage the monorepo. This provides a single source of truth for all common commands.
•	Location: /package.json
JSON
{
  "name": "KEYFLOWOS-monorepo",
  "private": true,
  "scripts": {
    "build": "pnpm -r build",
    "dev": "pnpm --parallel --stream -r dev",
    "lint": "pnpm -r lint",
    "db:generate": "pnpm --filter db prisma generate",
    "db:push": "pnpm --filter db prisma db push",
    "db:studio": "pnpm --filter db prisma studio",
    "ui:dev": "pnpm --filter ui storybook"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "prettier": "^3.0.0",
    "eslint": "^8.0.0",
    "turbo": "latest" 
  }
}

5.2. packages/ui Initial Setup
Directive: To ensure the UI is built to your standards, initialize shadcn/ui with these exact settings.
1.	Run this command from the root directory:
pnpm --filter ui exec npx shadcn-ui@latest init
2.	When prompted, provide these exact values:
o	Would you like to use TypeScript? Yes
o	Which style? Default
o	Which color? Slate
o	Where is your global.css? ../../apps/web/src/app/globals.css (This is crucial)
o	Where is your tailwind.config.js? ../../apps/web/tailwind.config.ts (This is crucial)
o	Configure tailwind.config.js? Yes
o	Import alias for components? @/components
o	Import alias for utils? @/lib
o	Are you using React Server Components? No (This package is a client-side library)





5.3. packages/db Soft Delete Middleware
Directive: To ensure data safety from the first line of code, create these two files inside the packages/db package. This is the implementation of our "Automate Data Safety" principle.
•	Location: packages/db/src/middleware/soft-delete.ts
TypeScript
import { Prisma } from '../generated/client';

// Define the models that have the 'deletedAt' field
const modelsWithSoftDelete: Prisma.ModelName[] = [
  'Business', 'Contact', 'Product', 'Quote', 'Invoice', 'StaffMember',
  'Service', 'Booking', 'SocialPost', 'Automation', 'Project', 'ProjectTask', 'Site'
];

export function softDeleteMiddleware(): Prisma.Middleware {
  return async (params, next) => {
    if (modelsWithSoftDelete.includes(params.model as Prisma.ModelName)) {
      // --- Intercept 'delete' actions ---
      if (params.action === 'delete') {
        // Change the action to an 'update'
        return next({
          ...params,
          action: 'update',
          args: {
            ...params.args,
            data: { deletedAt: new Date() },
          },
        });
      }

      // --- Intercept 'deleteMany' actions ---
      if (params.action === 'deleteMany') {
        // Change the action to an 'updateMany'
        return next({
          ...params,
          action: 'updateMany',
          args: {
            ...params.args,
            data: { deletedAt: new Date() },
          },
        });
      }

      // --- Intercept 'find' queries to exclude deleted items ---
      // This applies to: findUnique, findFirst, findMany
      if (params.action.startsWith('find')) {
        // Add a 'where' clause to filter out deleted items
        return next({
          ...params,
          args: {
            ...params.args,
            where: {
              ...params.args.where,
              deletedAt: null,
            },
          },
        });
      }
    }
    return next(params);
  };
}
•	Location: packages/db/src/client.ts (This file wires the middleware)
TypeScript
import { PrismaClient } from './generated/client';
import { softDeleteMiddleware } from './middleware/soft-delete';

// This is the client that will be imported by your NestJS server
const prisma = new PrismaClient();

// Apply the middleware
prisma.$use(softDeleteMiddleware());

export const db = prisma;
export * from './generated/client';



•	Location: packages/db/src/index.ts (This is the package's main export)
TypeScript
export * from './generated/client';
export { db } from './client';


5.4. apps/server NestJS + tRPC Setup
Directive: To ensure a fully type-safe, decoupled API, the NestJS server must be configured to host the tRPC router defined in packages/api.

•	Location: packages/api/src/trpc.ts (This file initializes tRPC)
TypeScript
import { initTRPC } from '@trpc/server';
import { CreateNestContext } from 'nestjs-trpc';
import { db, PrismaClient } from '@keyflow/db';

// This context is created by NestJS and passed to your resolvers
export type AppContext = CreateNestContext & {
  db: PrismaClient;
  // Auth context (populated by guards)
  user?: { id: string; email: string };
  business?: { id: string; role: string };
};

const t = initTRPC.context<AppContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;

•	Location: apps/server/src/modules/trpc/trpc.module.ts (This creates the NestJS module that serves the tRPC API)
TypeScript
import { Module } from '@nestjs/common';
import { TrpcService } from './trpc.service';
import { TrpcRouterModule } from 'nestjs-trpc';
import { appRouter } from '@keyflow/api'; // Import the root router
import { db } from '@keyflow/db';

@Module({
  imports: [
    TrpcRouterModule.forRoot({
      path: '/trpc', // The API path (e.g., /api/trpc)
      router: appRouter,
      createContext: (opts) => {
        // 'opts.req' is the raw Express request
        // This is where we connect our auth guards to the tRPC context
        const { user, business } = (opts.req as any); 
        
        return {
          db,
          user: user,       // From JwtAuthGuard
          business: business, // From BusinessContextMiddleware
        };
      },
    }),
  ],
  providers: [TrpcService],
  exports: [TrpcService],
})
export class TrpcModule {}




















•	Location: apps/server/src/app.module.ts (Ensure the TrpcModule is imported in the root server module)
TypeScript
// ... other imports
import { TrpcModule } from './modules/trpc/trpc.module';
import { IdentityModule } from './modules/1-identity/identity.module';
import { CrmModule } from './modules/2-crm/crm.module';
// ... import all other feature modules
@Module({
  imports: [
    // Core Modules
    PrismaModule,
    EventBusModule,
    TrpcModule, // <-- IMPORT THE TRPC MODULE
    
    // Feature Modules
    IdentityModule,
    CrmModule,
    // ... all other modules
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

________________________________________
4. The Build Plan: Modular-Isolationist Checklist
This is your master checklist. You must complete each module as a self-contained, individually testable "mini-app" before moving to the next. Do not build the "Integration Phase" (Phase X) until all modules (0-5) are 100% complete and pass their isolated tests. This is the core principle for a fast, debuggable, and powerful build.
Phase 0: The Foundation (Setup)
Goal: Create the "scaffolding" for the entire system. This phase builds no features but is essential for all future modules.
•	[ ] Initialize Monorepo:
o	Create the root KEYFLOWOS/ directory and initialize pnpm (pnpm init).
o	Create the pnpm-workspace.yaml file and define the workspaces: apps/* and packages/*.
o	Create the folder structure: apps/web, apps/server, packages/db, packages/ui, packages/api.
•	[ ] Setup packages/db (The Blueprint):
o	Initialize packages/db as a new project (cd packages/db && pnpm init).
o	Add prisma as a dev dependency (pnpm add -D prisma).
o	Initialize Prisma (pnpm prisma init).
o	Crucial: Copy the complete, refined schema.prisma (from Section 3) into packages/db/prisma/.
o	Crucial: Create the automated Soft Delete Middleware file at packages/db/src/middleware/soft-delete.ts.
o	Crucial: Create the packages/db/src/client.ts file to instantiate and export the Prisma client with the soft-delete middleware applied.
o	Crucial: Create packages/db/src/index.ts to export the client and all generated types.
o	Add a script to packages/db/package.json: "db:generate": "prisma generate --schema=./prisma/schema.prisma".
o	Run pnpm db:generate to create the first version of your type-safe client.
•	[ ] Setup Supabase (The Database):
o	Create your Supabase project.
o	In the Supabase dashboard, navigate to Database -> Extensions and enable vector (for pgvector).
o	Get your database connection string (the "pooled" one).
o	Create a .env file in the monorepo root and add your DATABASE_URL from Supabase.
o	Run the database push command from the root: pnpm db:push. Your entire Supabase schema is now live.
•	[ ] Initialize Applications:
o	Backend (apps/server): Set up as a new NestJS project. Install @nestjs/common, @nestjs/core, nestjs-trpc, @keyflow/db (our local package), and @keyflow/api (our local package).
o	Frontend (apps/web): Set up as a new Next.js (App Router) project. Install react, react-dom, next.
o	API Contract (packages/api): Initialize as a new TypeScript project. Install @trpc/server, zod, and @keyflow/db.
o	UI Kit (packages/ui): Initialize as a new React/TypeScript project. Install react, react-dom, tailwindcss, storybook, and framer-motion.
•	[ ] Configure Core Systems:
o	Backend (apps/server):
	Create the PrismaModule and PrismaService (as shown in the apps/server/src/core/prisma folder). This service must import the db client from @keyflow/db (packages/db).
	Create the EventBusModule (as shown in apps/server/src/core/event-bus) using EventEmitterModule.
	Create the TrpcModule (as shown in apps/server/src/modules/trpc) to host the API.
o	UI (packages/ui):
	Crucial: Run pnpm --filter ui exec npx shadcn-ui@latest init.
	Use these exact settings when prompted:
	global.css: ../../apps/web/src/app/globals.css
	tailwind.config.js: ../../apps/web/tailwind.config.ts
	RSC: No (this is a client-side package)
o	Frontend (apps/web):
	Install @keyflow/ui (our local package) and @keyflow/api (our local package).
	Configure tailwind.config.ts to "content-watch" both apps/web and packages/ui: content: ["./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"].
•	✅ Isolated Testable Outcome:
o	You can run pnpm dev from the root. All applications (web, server, and ui in storybook mode) start successfully without errors.
o	The apps/server successfully connects to the Supabase database.
o	The apps/web frontend successfully loads a test page that imports and renders a Button from packages/ui.
________________________________________
Module 1: Identity & Accounts (The "Spine")
Purpose: To manage users (User), their organizations (Business), and their permissions (Membership). This is the most critical module in the entire system. It establishes our multi-tenant security and data-partitioning model. If this module is flawed, the entire application is insecure. We will build it to be secure by default.
This build plan uses our tRPC + NestJS architecture. The core logic is that every API request will be automatically protected and scoped to the correct user and business without the developer having to remember to do it.
________________________________________
1. [ ] Backend: API Contract (packages/api)
Goal: Define the types and procedures for our API. This is the contract between the frontend and backend.
1.	File: packages/api/src/trpc.ts
o	Action: Initialize tRPC and define our reusable procedures. This is the core of our security model.
o	zod: We will use zod for all input validation.
o	Procedures:
	publicProcedure: For public-facing API calls (e.g., login, signup).
	protectedProcedure: For API calls that require a logged-in user. It checks for ctx.user.
	businessProcedure: For API calls that require both a user and an active business context. It checks for ctx.user AND ctx.business. This will be 90% of our API.
	ownerProcedure: A special procedure for actions only a business "OWNER" can perform (like inviting new team members).
2.	File: packages/api/src/routers/identity.router.ts
o	Action: Define the router for this module using the procedures from trpc.ts.
o	authRouter (sub-router):
	getSupabaseSession: protectedProcedure. Returns the server-side user session.
o	businessRouter (sub-router):
	create: protectedProcedure
	Input: z.object({ name: z.string().min(2) })
	Output: The new Business object.
	list: protectedProcedure.
	Output: Membership[] (all businesses the user belongs to).
o	teamRouter (sub-router):
	invite: ownerProcedure (ensures only the owner can invite)
	Input: z.object({ email: z.string().email(), role: z.enum(['ADMIN', 'STAFF']) })
	list: businessProcedure (ensures any team member can see the team)
	Output: Membership[] (with user details populated).
	deleteMembership: ownerProcedure
	Input: z.object({ membershipId: z.string() })
3.	File: packages/api/src/root.ts
o	Action: Combine the sub-routers into a single identityRouter and export it to be merged into the main appRouter.
________________________________________
2. [ ] Backend: Server Logic (apps/server)
Goal: Implement the logic and security guards defined in the API contract.
1.	File: apps/server/src/core/auth/jwt.strategy.ts
o	Action: Implement the NestJS Passport strategy to validate Supabase JWTs. This guard finds the user in our database (User model) based on the ID in the Supabase token.
o	Logic: It will use passport-jwt's ExtractJwt.fromAuthHeaderAsBearerToken() and jwks-rsa to fetch Supabase's public keys (.well-known/jwks.json) to validate the token signature. On success, it attaches the User object to request.user.
2.	File: apps/server/src/core/auth/guards/jwt-auth.guard.ts
o	Action: Create the JwtAuthGuard that simply extends AuthGuard('jwt'). This will be applied globally.
3.	File: apps/server/src/core/middleware/business-context.middleware.ts
o	Action: This is the core of our multi-tenancy. Create a NestJS MiddlewareConsumer.
o	Logic:
1.	It checks if request.user exists (it runs after JwtAuthGuard).
2.	It reads the x-business-id header from the request.
3.	If x-business-id exists, it queries the Membership table: db.membership.findFirstOrThrow({ where: { userId: request.user.id, businessId: request.headers['x-business-id'] } }).
4.	If found, it attaches the business context: request.business = { id: membership.businessId, role: membership.role }.
5.	If not found, it throws a ForbiddenException.
o	File: apps/server/src/app.module.ts
	Action: Apply this middleware to all routes that require it (e.g., /trpc/*).
4.	File: apps/server/src/modules/trpc/trpc.module.ts
o	Action: Configure the TrpcRouterModule's createContext function.
o	Logic: This function reads the request object (which now has request.user and request.business attached by our guards/middleware) and passes them into the tRPC ctx object.
	return { db, user: request.user, business: request.business };
5.	File: apps/server/src/modules/1-identity/identity.service.ts
o	Action: Implement the business logic for the tRPC routers.
o	Logic:
	createBusiness(userId, name): Must use prisma.$transaction to create the Business and the Membership (role: OWNER) in a single, atomic operation.
	listBusinesses(userId): Simple db.membership.findMany({ where: { userId } }).
	inviteToTeam(inviterId, businessId, email, role):
1.	Find the User with that email.
2.	If no user, create them both in Supabase Auth (using supabase.auth.admin.inviteUserByEmail) and in our local User table.
3.	Create the Membership record linking the new/found user to the businessId with the specified role.
	listTeam(businessId): Simple db.membership.findMany({ where: { businessId }, include: { user: true } }).
________________________________________
3. [ ] Frontend: UI Components (packages/ui)
Goal: Build and refine all UI components in Storybook for 100% isolation.
1.	File: packages/ui/src/components/(app)/LoginForm.tsx
o	Action: Create a 'use client' component.
o	Tech: Use shadcn/ui Form (with zod for validation), Input (type email and password), and Button.
o	Props: onSubmit(data: z.infer<typeof formSchema>), isLoading: boolean.
2.	File: packages/ui/src/components/(app)/BusinessSwitcher.tsx
o	Action: Create a 'use client' component.
o	Tech: Use shadcn/ui Popover, Command, and Chevrons icon.
o	Props: businesses: Membership[], activeBusinessId: string, onSelectBusiness: (businessId: string) => void.
3.	File: packages/ui/src/components/(app)/InviteMemberDialog.tsx
o	Action: Create a 'use client' component.
o	Tech: Use shadcn/ui Dialog, Form, Input (type email), Select (for "Role": ADMIN, STAFF), and Button.
o	Props: onSubmit(data: ... ), isLoading: boolean.
________________________________________
4. [ ] Frontend: Application (apps/web)
Goal: Wire the UI components to the live tRPC API and manage auth state.
1.	File: apps/web/src/lib/api.ts
o	Action: Create the tRPC client. This is the most critical frontend file for API communication.
o	Logic:
	Use @trpc/react-query to create the client.
	Configure the httpBatchLink.
	Inside the links array, configure the httpBatchLink with a headers() function.
	This function must:
1.	Get the Supabase session: (await supabase.auth.getSession()).data.session.
2.	Get the active business ID from a cookie: Cookies.get('activeBusinessId').
3.	Return the headers:
Authorization: \Bearer ${session?.access_token ?? ''}` x-business-id: `${activeBusinessId ?? ''}``
	This automates our security context for every API call.
2.	File: apps/web/src/app/(public)/(auth)/login/page.tsx
o	Action: Build the login page.
o	Logic: Import LoginForm. In the onSubmit handler, call supabase.auth.signInWithPassword(...). On success, call router.push('/dashboard').
3.	File: apps/web/src/app/(app)/layout.tsx
o	Action: This is the main authenticated layout. It must be a Server Component.
o	Logic:
1.	awaits the server-side api.auth.getSupabaseSession(). If no session, redirect('/login').
2.	awaits api.business.list().
3.	Renders a new client component, <AppLayoutClient>, and passes the businesses array as a prop.
4.	File: apps/web/src/app/(app)/AppLayoutClient.tsx
o	Action: Create this 'use client' component to manage client-side state.
o	Logic:
1.	It holds the state for the active business. It reads the initial value from Cookies.get('activeBusinessId').
2.	It renders the BusinessSwitcher component from packages/ui.
3.	It provides the onSelectBusiness handler, which sets the cookie (Cookies.set('activeBusinessId', id)) and then refreshes the router (router.refresh()) to re-fetch all server-side data for the new business context.
5.	File: apps/web/src/app/(app)/settings/team/page.tsx
o	Action: A Server Component that calls api.team.list() and passes the data to a client component TeamDataTable.
o	Logic: This page also renders the InviteMemberDialog (client component), which uses the api.team.invite.useMutation() tRPC hook to invite new members.
________________________________________
✅ Isolated Testable Outcome (Genius Level)
1.	A new user ("Owner") signs up and logs in.
2.	The (app)/layout.tsx fetches business.list(), finds it's empty, and triggers a "Create your first business" modal (a "gamified" onboarding step).
3.	User creates "Business A". The page refreshes, and the BusinessSwitcher now shows "Business A" as active.
4.	User goes to /settings and creates "Business B". The switcher now shows both.
5.	User (with "Business A" active) goes to /settings/team and invites staff@example.com as "STAFF".
6.	Owner logs out. staff@example.com logs in.
7.	Test 1 (Security): The (app)/layout.tsx calls business.list(). The BusinessSwitcher for the staff member only shows "Business A". They have no knowledge of "Business B".
8.	Test 2 (Permissions): The staff member goes to /settings/team. They can see the team list (because team.list is a businessProcedure), but the "Invite" button is hidden (because it's protected by ownerProcedure).
9.	Test 3 (Multi-Tenancy): The Owner logs back in, switches to "Business B", and goes to /settings/team. The list is empty (as it should be). They switch back to "Business A", and the list correctly shows them and the staff member.
This completes the module. The security model is now proven, and we have a robust, type-safe, and multi-tenant foundation for all future modules.


________________________________________
Module 2: CRM (The "Memory")
Purpose: To establish the central, isolated, and multi-tenant database for all business contacts. This module is the "memory" of the Business Graph, linking people to all future actions (invoices, bookings, projects). It must be built to be 100% secure, testable, and type-safe from end-to-end.
This module will be the first to test our automated multi-tenancy and soft-delete architecture.
________________________________________
1. [ ] Backend: API Contract (packages/api)
Goal: Define the explicit, zod-validated contract for all CRM operations. All procedures must use the businessProcedure to ensure they are automatically protected by user authentication and scoped to the active business.
1.	File: packages/api/src/schemas/contact.schema.ts
o	Action: Define the reusable zod validation schemas.
o	ContactCreateInput:
z.object({
firstName: z.string().min(1, "First name is required"),
lastName: z.string().optional(),
email: z.string().email("Invalid email address").optional().or(z.literal('')),
phone: z.string().optional(),
})
o	ContactUpdateInput:
ContactCreateInput.extend({ id: z.string().cuid() })
2.	File: packages/api/src/routers/crm.router.ts
o	Action: Define the tRPC router using our pre-defined procedures from Module 1.
o	contactRouter (sub-router):
	create: businessProcedure
	Input: ContactCreateInput
	Output: The full Contact object.
	list: businessProcedure
	Output: Contact[] (full contact objects).
	get: businessProcedure
	Input: z.object({ id: z.string().cuid() })
	Output: A single Contact object.
	update: businessProcedure
	Input: ContactUpdateInput
	Output: The updated Contact object.
	delete: businessProcedure
	Input: z.object({ id: z.string().cuid() })
	Output: { success: true, id: string }
3.	File: packages/api/src/root.ts
o	Action: Import contactRouter and merge it into the main appRouter.
o	export const appRouter = router({
identity: identityRouter,
contact: contactRouter, // <-- Add this line
});
________________________________________
2. [ ] Backend: Server Logic (apps/server)
Goal: Implement the CrmService logic. This service will not contain any businessId or deletedAt logic; it will rely entirely on the automated middleware from Phase 0 and Module 1 for security and data integrity.
1.	File: apps/server/src/modules/2-crm/crm.service.ts
o	Action: Create the CrmService class, marked as @Injectable().
o	Dependencies: Inject the PrismaService (db) from core/prisma.
o	Logic (create):
	async create(input: ContactCreateInput, businessId: string)
	Note: The businessId will be passed from the tRPC context.
	return this.db.contact.create({ data: { ...input, businessId } });
o	Logic (list):
	async list()
	return this.db.contact.findMany({ orderBy: { createdAt: 'desc' } });
	AI Directive: This query is intentionally simple. The BusinessContextMiddleware and softDeleteMiddleware will automatically add where: { businessId: '...', deletedAt: null }.
o	Logic (get):
	async get(id: string)
	return this.db.contact.findFirstOrThrow({ where: { id } });
	AI Directive: The middleware will automatically add where: { id: '...', businessId: '...', deletedAt: null }.
o	Logic (update):
	async update(input: ContactUpdateInput)
	const { id, ...data } = input;
	return this.db.contact.update({ where: { id }, data });
	AI Directive: The middleware will automatically scope this update to the correct business.
o	Logic (delete):
	async delete(id: string)
	await this.db.contact.delete({ where: { id } });
	AI Directive: The softDeleteMiddleware will intercept this .delete() command and automatically convert it to update({ where: { id: '...', businessId: '...' }, data: { deletedAt: new Date() } }).
	return { success: true, id };
2.	File: apps/server/src/modules/2-crm/crm.module.ts
o	Action: Define the NestJS module.
o	Imports: PrismaModule
o	Providers: CrmService
o	Exports: CrmService (so other modules can use it only if explicitly imported, which our FlowModule will do in Phase X).
3.	File: apps/server/src/app.module.ts
o	Action: Import CrmModule into the root AppModule's imports array.
________________________________________
3. [ ] Frontend: UI Components (packages/ui)
Goal: Build and refine all CRM UI components in Storybook for 100% isolation and pixel-perfect design.
1.	File: packages/ui/src/components/(app)/crm/ContactForm.tsx
o	Action: Create a 'use client' component.
o	Tech:
	Use react-hook-form and zodResolver from @hookform/resolvers/zod.
	Import ContactCreateInput schema from @keyflow/api.
	Use shadcn/ui: Form, FormField, FormItem, FormLabel, FormControl, FormMessage, Input, Button, Sheet (or Dialog).
o	Props: onSubmit: (data: z.infer<typeof ContactCreateInput>) => Promise<void>, isLoading: boolean, defaultValues?: Partial<Contact>.
o	Storybook: Create ContactForm.stories.tsx to test the form in both "create" (empty) and "edit" (defaultValues provided) states.
2.	File: packages/ui/src/components/(app)/crm/ContactDataTable.tsx
o	Action: Create a 'use client' component.
o	Tech:
	Use @tanstack/react-table and shadcn/ui DataTable components.
	Import the Contact type from @keyflow/db.
o	Props: data: Contact[].
o	Columns Definition (columns.tsx):
	name: Accessor (row) => \${row.firstName} ${row.lastName}``.
	email: Accessor row.email.
	phone: Accessor row.phone.
	createdAt: Formatted with toLocaleDateString().
	actions: A cell that renders a DropdownMenu with "Edit" and "Delete" items.
o	Internal Logic:
	The component will manage its own state for the "Edit" dialog ([isEditDialogOpen, setEditDialogOpen]).
	The "Edit" button in the row's dropdown will set the active contact and open the Dialog.
	The "Delete" button will trigger an alert (e.g., "Are you sure?") and then call its onDelete prop.
________________________________________
4. [ ] Frontend: Application (apps/web)
Goal: Wire the UI components to the live tRPC API, perfecting the "Server Component" data-fetching pattern.
1.	File: apps/web/src/lib/api.ts
o	Action: Ensure the api client (from Module 1) is configured to send the x-business-id header. This is the key to making the "magic" multi-tenancy work.
2.	File: apps/web/src/app/(app)/crm/page.tsx
o	Action: This must be a React Server Component (RSC) (i.e., no 'use client' at the top).
o	Logic:
	import { api } from '@/lib/api';
	import { ContactDataTable } from '@keyflow/ui';
	import { ClientPageHeader } from './ClientPageHeader';
	export default async function CrmPage() {
	// 1. Data is fetched on the server, secured by middleware
	const contacts = await api.contact.list();
	return (
	<>
	<ClientPageHeader />
	<ContactDataTable data={contacts} />
	</>
	);
	}
3.	File: apps/web/src/app/(app)/crm/ClientPageHeader.tsx
o	Action: Create a new 'use client' component for all interactivity.
o	Logic:
	import { api } from '@/lib/api';
	import { ContactForm } from '@keyflow/ui';
	import { Button, Dialog, DialogTrigger, DialogContent } from '@keyflow/ui';
	import { useRouter } from 'next/navigation';
	This component will render the "CRM" title and the "Add New Contact" Button.
	The Button will be wrapped in a Dialog (or Sheet) component.
	It will use the tRPC hook: const createContact = api.contact.create.useMutation();
	The ContactForm's onSubmit handler will call createContact.mutate(data).
	Crucial Data Flow: Add an onSuccess callback to useMutation:
onSuccess: () => {
router.refresh(); // This re-fetches the server component
// Close the dialog
// Show a "Contact Created" toast
}
•	✅ Isolated Testable Outcome (Genius Level):
1.	User (logged into "Business A") lands on /crm. The page loads instantly (RSC) showing an empty table.
2.	User clicks "Add New Contact". The ClientPageHeader's Dialog opens.
3.	User submits the ContactForm. The contact.create.useMutation() hook fires.
4.	On onSuccess, router.refresh() is called. The /crm/page.tsx Server Component re-fetches the api.contact.list() (which now includes "Contact 1"). The new data is passed to ContactDataTable, and the table updates without a full page reload.
5.	User switches to "Business B" (which sends a new x-business-id header). The /crm/page.tsx Server Component re-fetches, but the api.contact.list() procedure is now automatically scoped to "Business B" and returns an empty array. The table is empty. "Contact 1" is not visible.
6.	User switches back to "Business A". "Contact 1" is visible again.
7.	User clicks "Delete" on "Contact 1". The contact.delete.useMutation() hook fires. On onSuccess, router.refresh() is called, and the contact is removed from the UI.
8.	Final Verification: Go to Supabase (pnpm db:studio). The contacts table row for "Contact 1" must have a deletedAt timestamp. Manually add an Invoice row linked to "Contact 1". The invoices table must be 100% intact, proving our data integrity (no cascade) is working. This module is complete.
________________________________________

Module 3: Commerce (The "Money")
Purpose: To build the complete, isolated financial core of KeyFlow OS. This module manages products/services, quotes, and invoices, and handles the entire payment-processing loop. It must be 100% self-contained and emit a single, clean event (invoice.paid) upon success, without any knowledge of other modules.
This build plan is critical as it introduces third-party webhooks (Stripe/WiPay) and client-side payment UIs, requiring a perfect blend of backend and frontend logic.
________________________________________
1. [ ] Backend: API Contract (packages/api)
Goal: Define the explicit, zod-validated contract for all commerce operations. This ensures 100% type-safety from the database to the frontend form.
1.	File: packages/api/src/schemas/commerce.schema.ts
o	Action: Define all reusable zod schemas for this module.
o	ProductInput:
z.object({
name: z.string().min(2),
description: z.string().optional(),
price: z.number().positive(),
currency: z.string().default('TTD'),
})
o	LineItemInput:
z.object({
description: z.string().min(2),
quantity: z.number().min(1),
unitPrice: z.number().positive(),
total: z.number().positive()
})
o	InvoiceCreateInput:
z.object({
contactId: z.string().cuid(),
issueDate: z.date(),
dueDate: z.date().optional().nullable(),
status: z.enum(['DRAFT', 'SENT', 'PAID', 'VOID']),
lineItems: z.array(LineItemInput), // Nested line items
})
o	InvoiceUpdateInput:
InvoiceCreateInput.extend({ id: z.string().cuid() })
o	(AI Directive: Create similar QuoteCreateInput and QuoteUpdateInput schemas)
2.	File: packages/api/src/routers/commerce.router.ts
o	Action: Define the tRPC router using our pre-defined procedures.
o	productRouter (sub-router):
	create: businessProcedure.input(ProductInput).
	list: businessProcedure. Output: Product[].
	update: businessProcedure.input(ProductInput.extend({ id: z.string() })).
	delete: businessProcedure.input(z.object({ id: z.string() })).
o	quoteRouter (sub-router):
	create: businessProcedure.input(QuoteCreateInput).
	list: businessProcedure. Output: Quote[] (with contact relation).
	get: businessProcedure.input(z.object({ id: z.string() })). Output: Quote (with contact and items relations).
	update: businessProcedure.input(QuoteUpdateInput).
	delete: businessProcedure.input(z.object({ id: z.string() })).
o	invoiceRouter (sub-router):
	create: businessProcedure.input(InvoiceCreateInput).
	list: businessProcedure. Output: Invoice[] (with contact relation).
	get: businessProcedure.input(z.object({ id: z.string() })). Output: Invoice (with contact and items relations).
	update: businessProcedure.input(InvoiceUpdateInput).
	delete: businessProcedure.input(z.object({ id: z.string() })).
	createPaymentIntent: publicProcedure (Must be public for the payment page)
	Input: z.object({ invoiceId: z.string().cuid(), businessId: z.string().cuid() })
	Output: { clientSecret: string }
o	connectionsRouter (sub-router):
	getStripeOnboardingLink: ownerProcedure. Output: { url: string }.
	getStripeAccountStatus: ownerProcedure. Output: { detailsSubmitted: boolean }.
3.	File: packages/api/src/root.ts
o	Action: Import and merge the new commerceRouter.
o	export const appRouter = router({
identity: identityRouter,
contact: contactRouter,
commerce: commerceRouter, // <-- Add this line
});
________________________________________
2. [ ] Backend: Server Logic (apps/server)
Goal: Implement the robust logic for Commerce and, critically, the isolated, non-tRPC webhook handler.
1.	File: apps/server/src/modules/3-commerce/commerce.service.ts
o	Action: Create the CommerceService (@Injectable()).
o	Dependencies: PrismaService (db), ConfigService (for Stripe keys), Stripe (Stripe SDK).
o	Logic (createInvoice):
	Must use prisma.$transaction to create the Invoice and its lineItems atomically.
	const { lineItems, ...invoiceData } = input;
	return this.db.invoice.create({ data: { ...invoiceData, businessId, items: { create: lineItems } } });
o	Logic (updateInvoice):
	Must use prisma.$transaction. This is complex.
	
1.	Delete all existing LineItems for this invoice.
	
2.	Update the Invoice with the new data.
	
3.	Create all the new lineItems.
o	Logic (createPaymentIntent):
	
1.	await db.invoice.findFirstOrThrow({ where: { id: invoiceId, businessId } }).
	
2.	await db.business.findFirstOrThrow({ where: { id: businessId } }) to get the stripeAccountId.
	
3.	Call Stripe: this.stripe.paymentIntents.create({ amount: invoice.total * 100, currency: invoice.currency, ... }, { stripeAccount: stripeAccountId }).
	
4.	Return { clientSecret: paymentIntent.client_secret }.
o	Logic (getStripeOnboardingLink):
	
1.	Get/Create a Stripe Account: this.stripe.accounts.create({ type: 'standard' }).
	
2.	Save the stripeAccountId on the Business model.
	
3.	Create an AccountLink: this.stripe.accountLinks.create({ account: stripeAccountId, ... }).
	
4.	Return the url.
2.	File: apps/server/src/modules/webhooks/webhooks.module.ts
o	Action: Create a new, standalone module WebhooksModule.
o	Imports: PrismaModule, EventBusModule.
3.	File: apps/server/src/modules/webhooks/webhooks.controller.ts
o	Action: Create a standard NestJS @Controller('webhooks'). This is NOT a tRPC router.
o	Logic (Stripe):
	
1.	Define POST /stripe endpoint.
	
2.	Crucial: Get the raw request body. NestJS's default JSON parsing breaks Stripe's signature validation. In main.ts, you must enable rawBody: true in the NestFactory.create options.
	
3.	Get the stripe-signature from headers.
	
4.	Get the Stripe Webhook Secret from ConfigService.
	
5.	Construct the event: event = this.stripe.webhooks.constructEvent(rawBody, sig, secret).
	
6.	Use a switch (event.type) statement.
	
7.	Case 'checkout.session.completed' (or payment_intent.succeeded):
	const session = event.data.object;
	const invoiceId = session.metadata.invoiceId;
	const businessId = session.metadata.businessId;
	// Update our database
	const updatedInvoice = await this.db.invoice.update({ where: { id: invoiceId, businessId }, data: { status: 'PAID', paidAt: new Date() } });
	// EMIT THE INTERNAL EVENT
	this.eventBus.emit('invoice.paid', { invoice: updatedInvoice });
	// Return 200 to Stripe
	response.status(200).send();
	
8.	(AI Directive: Implement similar logic for WiPay webhooks here).
________________________________________
3. [ ] Frontend: UI Components (packages/ui)
Goal: Build and refine all Commerce UI components in Storybook.
1.	File: packages/ui/src/components/(app)/commerce/ProductForm.tsx
o	Action: Create a shadcn/ui Form for ProductInput.
2.	File: packages/ui/src/components/(app)/commerce/InvoiceForm.tsx
o	Action: Create a 'use client' component. This is the most complex form.
o	Tech: react-hook-form.
o	Logic:
	Main form uses useForm with InvoiceCreateInput schema.
	Renders shadcn/ui Select for Contact (fetched from api.contact.list()).
	Renders shadcn/ui DatePicker for issueDate and dueDate.
	Crucial: Uses useFieldArray from react-hook-form to manage lineItems.
	The useFieldArray will render a list of sub-forms, each with "Description", "Qty", "Price" fields.
	A "Total" field at the bottom must be a watched value, auto-calculating from the lineItems array.
3.	File: packages/ui/src/components/(app)/commerce/InvoiceDataTable.tsx
o	Action: Create a shadcn/ui DataTable for Invoice[].
o	Columns: Invoice #, Contact, Status (use shadcn/ui Badge), Total, Due Date, Actions.
4.	File: packages/ui/src/components/(app)/settings/StripeOnboardingButton.tsx
o	Action: Create a 'use client' component.
o	Logic:
	Uses api.commerce.connections.getStripeAccountStatus.useQuery().
	Uses api.commerce.connections.getStripeOnboardingLink.useMutation().
	If status.data.detailsSubmitted is true: Renders a disabled "✓ Connected" Button.
	If false: Renders an "Onboard with Stripe" Button. onClick calls the mutation and then window.location.href = data.url.
5.	File: packages/ui/src/components/(public)/CheckoutForm.tsx
o	Action: Create a 'use client' component.
o	Tech: Use @stripe/react-stripe-js hooks: useStripe, useElements, PaymentElement.
o	Props: clientSecret: string.
o	Logic:
	The parent page (/pay/[invoiceId]) will wrap this in an <Elements> provider from Stripe.
	This component renders the PaymentElement and a "Pay Now" button.
	onSubmit, it calls stripe.confirmPayment(...) and shows loading/error states.
________________________________________
4. [ ] Frontend: Application (apps/web)
Goal: Wire the components to the API, creating the internal and public-facing payment flows.
1.	File: apps/web/src/app/(app)/settings/connections/page.tsx
o	Action: A Server Component that renders the StripeOnboardingButton (which is a client component).
2.	File: apps/web/src/app/(app)/commerce/invoices/page.tsx
o	Action: A Server Component.
o	Logic: awaits api.commerce.invoice.list() and passes the invoices data to the InvoiceDataTable client component. It also renders a ClientPageHeader (like in Module 2) that contains the Dialog and the InvoiceForm for creating new invoices.
3.	File: apps/web/src/app/(public)/pay/[invoiceId]/page.tsx
o	Action: A Server Component. This is the public payment page.
o	Logic:
1.	const { invoiceId } = params;
2.	await api.commerce.invoice.get({ id: invoiceId }) (using a public procedure, or a new public.getInvoiceDetails procedure). This is to get the businessId and total.
3.	await api.commerce.invoice.createPaymentIntent({ invoiceId, businessId }).
4.	This component will render a new 'use client' component, PaymentPageClient, passing it the clientSecret and invoice details.
4.	File: apps/web/src/app/(public)/pay/[invoiceId]/PaymentPageClient.tsx
o	Action: Create this 'use client' component.
o	Logic:
1.	It receives the clientSecret as a prop.
2.	It initializes loadStripe with the Stripe public key.
3.	It renders the <Elements> provider, passing it the stripe instance and the clientSecret.
4.	Inside <Elements>, it renders the CheckoutForm component from packages/ui.
•	✅ Isolated Testable Outcome (Genius Level):
1.	User ("Owner") logs in, goes to /settings/connections, clicks "Onboard with Stripe", completes the Stripe flow, and is redirected back. The button now shows "✓ Connected".
2.	User goes to /commerce/products, creates "Product 1" ($100).
3.	User goes to /crm, creates "Contact 1".
4.	User goes to /commerce/invoices, clicks "New Invoice". The InvoiceForm dialog opens.
5.	User selects "Contact 1", adds "Product 1" as a line item. The form useFieldArray and watch logic works, showing a total of $100. User saves.
6.	The /invoices page (RSC) refreshes, and the new DRAFT invoice appears in the InvoiceDataTable.
7.	User clicks the "Share" action on the invoice, copies the public link: .../pay/inv_....
8.	User opens an incognito window and pastes the link.
9.	The (public)/pay/[invoiceId]/page.tsx server component fetches the invoice data, creates the PaymentIntent (getting a clientSecret), and passes it to PaymentPageClient.
10.	The CheckoutForm (from packages/ui) renders the Stripe PaymentElement.
11.	The "client" pays with Stripe's "4242..." test card.
12.	The POST /api/webhooks/stripe endpoint on apps/server receives the event, validates the signature, finds the invoice, and updates its status to PAID.
13.	The apps/server console logs "Event 'invoice.paid' emitted".
14.	The "Owner" (in their original browser) refreshes the /commerce/invoices dashboard. The invoice status badge is now PAID (in green).
15.	Crucially, nothing else happens. No booking is confirmed, no project is created. This module is 100% isolated and has flawlessly executed its single responsibility.

________________________________________
Module 4: Bookings (The "Time")
Purpose: To build the complete, isolated system for managing and selling time-based services. This module must handle staff availability, service durations, and public booking requests independently. Its sole output is a PENDING booking and an internal booking.created event.
________________________________________
1. [ ] Backend: Database Model (Prisma)
Goal: Ensure our schema can support complex availability logic.
•	File: packages/db/prisma/schema.prisma
•	Action: We must add two critical fields to the Business model that were not in the original schema. This is non-negotiable for this module to function.
•	Directive: Add these fields to the Business model:
Code snippet
model Business {
  // ... other fields
  
  // NEW: Used for public booking pages (e.g., /book/my-clinic)
  slug     String?   @unique @map("slug")
  
  // NEW: Critical for timezone-aware availability calculation
  timezone String    @default("America/Port_of_Spain") @map("timezone") 
}
After adding these, run pnpm db:push to sync the database.
________________________________________
2. [ ] Backend: API Contract (packages/api)
Goal: Define the explicit, zod-validated contract for all booking operations. We will separate internal (business-scoped) procedures from public (client-facing) procedures.
1.	File: packages/api/src/schemas/booking.schema.ts
o	Action: Define all reusable zod schemas for this module.
o	AvailabilityRuleInput:
z.object({
dayOfWeek: z.number().min(0).max(6), // 0 = Sunday
startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Must be HH:MM format"),
endTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Must be HH:MM format"),
})
o	ServiceInput:
z.object({
name: z.string().min(2),
description: z.string().optional(),
duration: z.number().int().positive("Duration must be in minutes"),
price: z.number().min(0),
staffIds: z.array(z.string().cuid()), // IDs of StaffMember[] to connect
})
o	StaffUpdateAvailabilityInput:
z.object({
staffId: z.string().cuid(),
availability: z.array(AvailabilityRuleInput),
})
o	PublicCreateBookingInput:
z.object({
businessId: z.string().cuid(),
serviceId: z.string().cuid(),
staffId: z.string().cuid(),
startTime: z.string().datetime(), // ISO 8601 string (in UTC)
contactInfo: z.object({
firstName: z.string().min(1),
lastName: z.string().min(1),
email: z.string().email(),
phone: z.string().optional(),
})
})
2.	File: packages/api/src/routers/booking.router.ts
o	Action: Define the tRPC router using our pre-defined procedures.
o	serviceRouter (sub-router):
	create: businessProcedure.input(ServiceInput).
	list: businessProcedure. Output: Service[] (with staff relation).
	update: businessProcedure.input(ServiceInput.extend({ id: z.string() })).
	delete: businessProcedure.input(z.object({ id: z.string() })).
o	staffRouter (sub-router):
	create: businessProcedure.input(z.object({ name: z.string() })).
	list: businessProcedure. Output: StaffMember[] (with availability relation).
	updateAvailability: businessProcedure.input(StaffUpdateAvailabilityInput).
o	bookingRouter (sub-router):
	list: businessProcedure
	Input: z.object({ startDate: z.date(), endDate: z.date() })
	Output: Booking[] (with contact, service, staff relations).
o	publicBookingRouter (sub-router):
	getBusinessBySlug: publicProcedure
	Input: z.object({ slug: z.string() })
	Output: Business (safe subset, e.g., id, name, slug, timezone).
	getBookingSettings: publicProcedure
	Input: z.object({ businessId: z.string() })
	Output: { services: Service[], staff: StaffMember[] }.
	getAvailabilitySlots: publicProcedure
	Input: z.object({ businessId: z.string(), serviceId: z.string(), staffId: z.string(), date: z.string() }) // date is "YYYY-MM-DD"
	Output: { slots: string[] } (list of ISO 8601 strings in UTC).
	createBooking: publicProcedure.input(PublicCreateBookingInput).
	Output: { success: true, bookingId: string }.
3.	File: packages/api/src/root.ts
o	Action: Import and merge the new bookingRouter.
o	export const appRouter = router({
identity: identityRouter,
contact: contactRouter,
commerce: commerceRouter,
booking: bookingRouter, // <-- Add this line
});
________________________________________
3. [ ] Backend: Server Logic (apps/server)
Goal: Implement the complex availability logic and concurrent-safe booking creation.
1.	File: apps/server/src/modules/4-bookings/availability.service.ts
o	Action: Create the AvailabilityService (@Injectable()). This is the genius-level core.
o	Logic (getAvailableSlots):
	Dependencies: PrismaService (db).
	async getAvailableSlots(businessId, serviceId, staffId, date):
1.	// 1. Fetch all required data in parallel
const [service, staffMember, business] = await Promise.all([
this.db.service.findFirstOrThrow({ where: { id: serviceId, businessId } }),
this.db.staffMember.findFirstOrThrow({ where: { id: staffId, businessId }, include: { availability: true } }),
this.db.business.findFirstOrThrow({ where: { id: businessId } }),
]);
2.	// 2. Setup Timezone & Date boundaries (using 'date-fns-tz')
const businessTimezone = business.timezone;
const serviceDuration = service.duration;
const clientDate = zonedTimeToUtc(date, businessTimezone); // "2025-11-10" becomes UTC midnight in that timezone
const dayOfWeek = clientDate.getDay(); // 0-6
const startOfDay = startOfDay(clientDate);
const endOfDay = endOfDay(clientDate);
3.	// 3. Find the matching availability rule
const rule = staffMember.availability.find(r => r.dayOfWeek === dayOfWeek);
if (!rule) return { slots: [] }; // Staff doesn't work this day
4.	// 4. Fetch all existing bookings for this day
const existingBookings = await this.db.booking.findMany({
where: { staffId, businessId, startTime: { gte: startOfDay, lte: endOfDay } }
});
5.	// 5. Generate all possible slots for the day
const slots = [];
let [startHour, startMinute] = rule.startTime.split(':').map(Number);
let [endHour, endMinute] = rule.endTime.split(':').map(Number);
let currentSlot = set(startOfDay, { hours: startHour, minutes: startMinute });
const businessDayEnd = set(startOfDay, { hours: endHour, minutes: endMinute });
6.	// 6. Loop and check for conflicts
while (currentSlot < businessDayEnd) {
const slotEndTime = addMinutes(currentSlot, serviceDuration);
if (slotEndTime > businessDayEnd) break; // Slot doesn't fit
// 7. Check for conflicts with existing bookings
const conflict = existingBookings.some(booking => {
// (slotStart < bookingEnd) && (slotEnd > bookingStart)
return (currentSlot < booking.endTime) && (slotEndTime > booking.startTime);
});
// 8. Check if slot is in the past (add 5 min buffer)
const isPast = currentSlot < addMinutes(new Date(), 5);
if (!conflict && !isPast) {
slots.push(currentSlot.toISOString()); // Add as UTC string
}
currentSlot = addMinutes(currentSlot, 15); // Check every 15 mins (or configurable step)
}
7.	return { slots };
2.	File: apps/server/src/modules/4-bookings/bookings.service.ts
o	Action: Create the BookingsService (@Injectable()).
o	Dependencies: PrismaService (db), EventBusService (eventBus), CrmService (from Module 2).
o	Logic (publicCreateBooking):
	
1.	// 1. Find or Create Contact (this is an "upsert")
let contact = await this.db.contact.findFirst({ where: { email: input.contactInfo.email, businessId } });
if (!contact) { contact = await this.crmService.create({ ...input.contactInfo, businessId }); }
	
2.	// 2. CRITICAL: Use a transaction to prevent double-booking
const newBooking = await this.db.$transaction(async (tx) => {
// 3. Check for conflict *inside* the transaction (a read lock)
const slotEndTime = addMinutes(new Date(input.startTime), serviceDuration);
const conflict = await tx.booking.findFirst({
where: { staffId: input.staffId, businessId, deletedAt: null,
startTime: { lt: slotEndTime }, endTime: { gt: new Date(input.startTime) } }
});
if (conflict) { throw new TRPCError({ code: 'CONFLICT', message: 'This slot is no longer available.' }); }
// 4. Create the booking
return tx.booking.create({
data: {
businessId: input.businessId,
contactId: contact.id,
serviceId: input.serviceId,
staffId: input.staffId,
startTime: new Date(input.startTime),
endTime: slotEndTime,
status: 'PENDING',
}
});
});
	
3.	// 5. Emit event *after* transaction succeeds
this.eventBus.emit('booking.created', { bookingId: newBooking.id, businessId: newBooking.businessId });
return { success: true, bookingId: newBooking.id };
________________________________________
4. [ ] Frontend: UI Components (packages/ui)
Goal: Build and refine all Booking UI components in Storybook.
1.	File: packages/ui/src/components/(app)/bookings/ServiceForm.tsx
o	Action: Create a shadcn/ui Form for ServiceInput.
o	Tech: Will require a multi-select combobox for staffIds. Use shadcn/ui Popover, Command, and Badge components to build this custom selector.
2.	File: packages/ui/src/components/(app)/bookings/StaffAvailabilityForm.tsx
o	Action: Create a 'use client' component.
o	Tech: react-hook-form useFieldArray to manage a dynamic list of rules.
o	Logic: Renders rows, each with: shadcn/ui Select (for Day of Week), Input type="time" (for Start Time), Input type="time" (for End Time), and a "Remove" Button. An "Add Rule" Button appends a new empty rule to the field array.
3.	File: packages/ui/src/components/(app)/bookings/Calendar.tsx
o	Action: Create a 'use client' wrapper for FullCalendar.
o	Tech: @fullcalendar/react, @fullcalendar/daygrid, @fullcalendar/timegrid.
o	Props: events: Booking[] (or any FullCalendar event object).
4.	File: packages/ui/src/components/(public)/PublicBookingWidget.tsx
o	Action: Create the multi-step, 'use client' booking form.
o	Tech: Use Framer Motion for animated transitions between steps.
o	Props: business: { id: string, name: string, timezone: string }.
o	Internal State: step: number, selectedServiceId: string, selectedStaffId: string, selectedDate: Date, selectedSlot: string.
o	Step 1 (Services): const { data: settings } = api.public.getBookingSettings.useQuery({ businessId: props.business.id }); Render settings.services as selectable cards.
o	Step 2 (Staff - optional): If selectedService.staff.length > 1, show staff selector.
o	Step 3 (Date/Time):
	Render shadcn/ui Calendar.
	const { data: slots, isPending } = api.public.getAvailabilitySlots.useQuery({ ...allIds, date: selectedDate.toISOString().split('T')[0] }, { enabled: !!selectedDate });
	Render slots.data.slots as a list of Buttons. Slots are UTC strings, so format them for the client's local time: new Date(slot).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).
o	Step 4 (Details): Render a shadcn/ui Form for contactInfo.
o	Step 5 (Submit): const createBooking = api.public.createBooking.useMutation(); Call createBooking.mutate({ ...allData, startTime: selectedSlot }). On onSuccess, show a "Booking Pending!" message.
________________________________________
5. [ ] Frontend: Application (apps/web)
Goal: Wire the UI components to the API, using the RSC-first pattern.
1.	File: apps/web/src/app/(app)/bookings/page.tsx
o	Action: A Server Component.
o	Logic: awaits api.booking.list({ ... }) and passes the formatted events to the <Calendar /> client component.
2.	File: apps/web/src/app/(app)/bookings/services/page.tsx
o	Action: A Server Component.
o	Logic: awaits api.service.list() and api.staff.list() and passes both to a client-side page component that handles the Dialog with the ServiceForm (which needs the staff list for the multi-select).
3.	File: apps/web/src/app/(public)/book/[businessSlug]/page.tsx
o	Action: A Server Component.
o	Logic:
1.	const { businessSlug } = params;
2.	const business = await api.public.getBusinessBySlug({ slug: businessSlug });
3.	if (!business) { notFound(); }
4.	Render the <PublicBookingWidget business={business} /> client component, passing the fetched business object as a prop.
•	✅ Isolated Testable Outcome (Genius Level):
1.	User creates a "1-hour Service" (duration: 60) and links "Staff A".
2.	User goes to /settings/staff and sets "Staff A" availability for Monday to "09:00" - "11:00".
3.	Client (in "America/New_York") visits /book/my-business.
4.	They select "1-hour Service" and "Staff A".
5.	They click Monday, Nov 10th on the calendar.
6.	The getAvailabilitySlots procedure runs on the server. It calculates slots based on the business's "America/Port_of_Spain" timezone (which is 1 hour ahead of NY).
7.	It generates slots: 09:00, 10:00.
8.	It checks for existing bookings (finds none).
9.	It checks if slots are in the past (they are not).
10.	It returns ['2025-11-10T13:00:00.000Z', '2025-11-10T14:00:00.000Z'] (which are 9am and 10am in Port_of_Spain).
11.	The client's UI formats these UTC strings to their local "America/New_York" timezone, and correctly displays buttons for "8:00 AM" and "9:00 AM".
12.	Client selects "8:00 AM" and books. The mutation sends the UTC startTime (2025-11-10T13:00:00.000Z).
13.	The server transaction runs, creates the PENDING booking, and emits the booking.created event (verified in server logs).
14.	A second client visits. They see only the "9:00 AM" (New York time) slot available.
15.	Crucially, no invoice is created. The module is 100% isolated and has flawlessly handled complex timezone arithmetic and concurrency.

________________________________________
Module 5: Social Intelligence (The "Attention")
Purpose: To build the complete, isolated system for connecting social accounts, composing, scheduling, and publishing content. This module must function 100% on its own, with its only outputs being a SocialPost row updated to POSTED and an internal post.published event.
________________________________________
1. [ ] Backend: API Contract (packages/api)
Goal: Define the explicit, zod-validated contract for all social operations. We will use the businessProcedure for all user-facing actions and a new internalProcedure for our secure, server-to-server job processing.
1.	File: packages/api/src/schemas/social.schema.ts
o	Action: Define all reusable zod schemas for this module.
o	PostCreateInput:
TypeScript
z.object({
  content: z.string().min(1, "Post content cannot be empty."),
  mediaUrls: z.array(z.string().url("Invalid media URL")).optional(),
  platformIds: z.array(z.string().cuid("Invalid platform ID.")).min(1, "Select at least one platform."),
  scheduledAt: z.date(),
})
o	SignedUploadUrlInput:
TypeScript
z.object({
  fileName: z.string(),
  fileType: z.string(),
})
2.	File: packages/api/src/routers/social.router.ts
o	Action: Define the tRPC router using our pre-defined procedures.
o	connectionsRouter (sub-router):
	getNangoLink: ownerProcedure
	Input: z.object({ integrationId: z.string() }) // e.g., 'meta-keyflow'
	Output: { url: string }
	list: businessProcedure. Output: SocialConnection[].
	delete: ownerProcedure.input(z.object({ id: z.string() })).
o	postRouter (sub-router):
	create: businessProcedure.input(PostCreateInput).
	list: businessProcedure
	Input: z.object({ startDate: z.date(), endDate: z.date() })
	Output: SocialPost[].
	getSignedUploadUrl: businessProcedure.input(SignedUploadUrlInput)
	Output: { url: string, path: string } (The signed URL to POST to, and the final path to save).
o	internalRouter (sub-router, new):
	publishPost: internalProcedure (Secured by a shared secret, not JWT)
	Input: z.object({ postId: z.string().cuid() })
	Output: { success: true, postId: string }
3.	File: packages/api/src/root.ts
o	Action: Import and merge the new routers.
o	export const appRouter = router({
identity: identityRouter,
contact: contactRouter,
commerce: commerceRouter,
booking: bookingRouter,
social: socialRouter, // <-- Add this line
internal: internalRouter, // <-- Add this line
});
________________________________________
2. [ ] Backend: Server Logic (apps/server)
Goal: Implement the logic for social connections, post creation, and the secure, delegated publishing job.
1.	File: apps/server/src/modules/webhooks/webhooks.controller.ts
o	Action: Add a new, non-tRPC endpoint to the existing WebhooksController (from Module 3) to receive the Nango callback.
o	Logic (Nango Callback):
	
1.	Define GET /api/webhooks/nango/callback endpoint (Nango uses GET).
	
2.	This endpoint receives query params: code, state, error.
	
3.	Call Nango SDK: const tokenData = await nango.auth.getToken(integrationId, code);
	
4.	Crucial Security: Encrypt the tokenData.access_token and refresh_token using pgsodium or a simple crypto library with a secret from ConfigService.
	
5.	Save to DB: await this.db.socialConnection.create({ data: { businessId: tokenData.connectionId, platform: ..., encryptedToken: ... } });
	
6.	Return a simple HTML page: <script>window.close();</script> to close the popup.
2.	File: apps/server/src/modules/5-social/social.service.ts
o	Action: Create the SocialService (@Injectable()).
o	Dependencies: PrismaService (db), ConfigService (for Nango/Supabase keys), EventBusService (eventBus), Nango (Nango SDK).
o	Logic (getNangoLink):
	return nango.getConnection(integrationId, businessId, true); // businessId is passed as the connectionId
o	Logic (getSignedUploadUrl):
	
1.	const path = \${businessId}/${fileName}`;`
	
2.	const { data, error } = await this.supabase.storage.from('media').createSignedUploadUrl(path, 60); // 60-second expiry
	
3.	if (error) { throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not create upload URL.' }); }
	
4.	return { url: data.signedUrl, path: data.path };
o	Logic (createPost):
	
1.	const { platformIds, ...postData } = input;
	
2.	return this.db.socialPost.create({ data: { ...postData, businessId, platform: 'INSTAGRAM' // Logic to map IDs to enums } });
o	Logic (publishPost - The Core Job):
	async publishPost(postId: string):
	
1.	Fetch the post and its connection in a transaction: const post = await this.db.socialPost.findFirstOrThrow({ where: { id: postId, status: 'SCHEDULED' }, include: { business: { include: { socialConns: true } } } });
	
2.	Find the correct SocialConnection from post.business.socialConns.
	
3.	Security: Decrypt the encryptedToken from the SocialConnection.
	
4.	Action: Construct the API call to the Meta Graph API.
	e.g., POST graph.facebook.com/v19.0/{ig-user-id}/media?image_url={post.mediaUrls[0]}&caption={post.content}&access_token={decryptedToken}.
	This is a 2-step process for Meta (create container, then publish).
	
5.	On Success: await this.db.socialPost.update({ where: { id: postId }, data: { status: 'POSTED', postedAt: new Date() } });
	
6.	Emit Event: this.eventBus.emit('post.published', { postId: post.id, businessId: post.businessId });
	
7.	On Failure: await this.db.socialPost.update({ where: { id: postId }, data: { status: 'FAILED' } });
3.	File: apps/server/src/modules/5-social/social.module.ts
o	Action: Define the NestJS module.
o	Imports: PrismaModule, EventBusModule.
o	Providers: SocialService.
o	Exports: SocialService.
________________________________________
3. [ ] Scheduler: Background Job (apps/scheduler)
Goal: Create a reliable, "dumb" job in Trigger.dev that delegates the actual work back to our secure apps/server.
1.	File: apps/scheduler/src/index.ts
o	Action: Initialize the TriggerClient.
o	export const client = new TriggerClient({ id: 'keyflow-scheduler', apiKey: process.env.TRIGGER_API_KEY });
2.	File: apps/scheduler/src/jobs/social-post.job.ts
o	Action: Define the cron job.
o	Logic:
	
1.	import { db } from '@keyflow/db';
	
2.	import { internalApi } from '@/lib/internal-api-client'; (A simple tRPC client for our internal router).
	
3.	client.defineJob({ id: 'publish-scheduled-posts', ... })
	
4.	run: async (payload, io, ctx) => {
	
5.	const postsToPublish = await io.runTask('find-posts', async () => {
	
6.	return db.socialPost.findMany({
	
7.	where: { status: 'SCHEDULED', scheduledAt: { lte: new Date() }, deletedAt: null }
	
8.	});
	
9.	});
	
10.	if (postsToPublish.length === 0) { return { success: true, count: 0 }; }
	
11.	// Run all publish tasks in parallel
	
12.	await Promise.all(postsToPublish.map(post =>
	
13.	io.runTask(\publish-${post.id}`, async () => {`
	
14.	// Delegate back to the secure, isolated server
	
15.	await internalApi.social.publishPost.mutate({ postId: post.id });
	
16.	})
	
17.	));
	
18.	return { success: true, count: postsToPublish.length };
	
19.	}
3.	File: apps/scheduler/src/lib/internal-api-client.ts
o	Action: Create a simple tRPC client.
o	Logic: This client points to process.env.INTERNAL_API_URL (our apps/server) and sends the process.env.INTERNAL_API_SECRET as an auth header, which the internalProcedure on the server will validate.
________________________________________
4. [ ] Frontend: UI Components (packages/ui)
Goal: Build and refine all Social UI components in Storybook.
1.	File: packages/ui/src/components/(app)/social/ContentCalendar.tsx
o	Action: Create a 'use client' wrapper for FullCalendar.
o	Tech: @fullcalendar/react, @fullcalendar/daygrid, @fullcalendar/timegrid, @fullcalendar/list.
o	Props: events: SocialPost[].
o	Logic:
	Maps SocialPost[] to FullCalendar's event format.
	Crucial: Use the eventDataTransformer to add className based on post.status:
	SCHEDULED: bg-blue-500
	POSTED: bg-green-500
	FAILED: bg-red-500
	This provides the "fresh" visual feedback.
2.	File: packages/ui/src/components/(app)/social/SocialComposer.tsx
o	Action: Create a 'use client' component.
o	Tech: react-hook-form, zodResolver (with PostCreateInput), react-dropzone, shadcn/ui Textarea, DateTimePicker, MultiSelect (for platforms).
o	Props: connections: SocialConnection[], onSubmit: (data: ...) => Promise<void>, isLoading: boolean.
o	File Upload Logic (useFileUploader hook):
	const [uploadedMedia, setUploadedMedia] = useState<string[]>([]);
	const getSignedUrl = api.post.getSignedUploadUrl.useMutation();
	const onDrop = async (files) => {
	const file = files[0];
	const { url, path } = await getSignedUrl.mutateAsync({ fileName: file.name, fileType: file.type });
	await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
	const publicUrl = \${process.env.NEXT\_PUBLIC\_SUPABASE\_URL}/storage/v1/object/public/media/${path}`;`
	setUploadedMedia([publicUrl]);
	}
o	Form Logic:
	The form's onSubmit handler will combine the form data (content, scheduledAt, platformIds) with the uploadedMedia state and pass it to the onSubmit prop.
________________________________________
5. [ ] Frontend: Application (apps/web)
Goal: Wire the components to the API, creating the internal and connection flows.
1.	File: apps/web/src/app/(app)/settings/connections/page.tsx
o	Action: A Server Component that renders a client component, ConnectionManager.
2.	File: apps/web/src/app/(app)/settings/connections/ConnectionManager.tsx
o	Action: A 'use client' component.
o	Logic:
	const { data: connections } = api.social.connections.list.useQuery();
	const getLink = api.social.connections.getNangoLink.useMutation();
	Renders a "Connect Instagram" button.
	onClick: getLink.mutate({ integrationId: 'meta-keyflow' }, { onSuccess: (data) => window.open(data.url, 'nango', 'width=600,height=600') });
	Renders the connections list, showing what's already connected.
3.	File: apps/web/src/app/(app)/social/page.tsx
o	Action: A Server Component.
o	Logic:
1.	const posts = await api.social.post.list({ ...dateRange });
2.	Renders <ContentCalendar events={posts} />.
3.	Renders a client-side <SocialPageHeader />.
4.	File: apps/web/src/app/(app)/social/SocialPageHeader.tsx
o	Action: A 'use client' component.
o	Logic:
1.	Renders the "Create Post" Button.
2.	const { data: connections } = api.social.connections.list.useQuery();
3.	const createPost = api.social.post.create.useMutation({ onSuccess: () => router.refresh() });
4.	The button opens a Dialog (or Sheet).
5.	Inside, it renders <SocialComposer connections={connections} onSubmit={createPost.mutateAsync} isLoading={createPost.isPending} />`.
•	✅ Isolated Testable Outcome (Genius Level):
1.	User goes to /settings/connections, clicks "Connect Instagram". The Nango popup opens. User authenticates. The popup closes. The POST /api/webhooks/nango/callback endpoint is hit. The SocialConnection table in Supabase now contains a new row with an encrypted token. The /settings/connections page list refreshes, showing "Instagram" as connected.
2.	User goes to /social, clicks "Create Post".
3.	User drops image.png. The getSignedUploadUrl procedure is called. The fetch/PUT request is made to Supabase Storage. The image preview appears in the composer. (Verification: Check Supabase Storage bucket media/{businessId}/image.png).
4.	User writes "Hello world", selects "Instagram", and sets scheduledAt for 5 minutes in the future.
5.	User clicks "Schedule". The post.create mutation fires. The SocialPost table has a new row with status: 'SCHEDULED'.
6.	The calendar UI refreshes (router.refresh()) and shows a blue "Scheduled" event.
7.	Wait 5 minutes. The Trigger.dev job runs. The Trigger.dev dashboard logs "Found 1 post to publish."
8.	The job logs "Invoking internal API for post post_123."
9.	The apps/server console logs "Received request to publish post_123." -> "Calling Meta API..." -> "Successfully published post." -> "Event 'post.published' emitted."
10.	The post appears on the user's actual Instagram profile.
11.	The user refreshes the /social page. The event on the calendar is now green "Published".
12.	Crucially, no invoice or booking was touched. The module is 100% isolated and has flawlessly handled auth, file uploads, and background scheduling.

________________________________________
Phase X: The Great Integration (The "Flow")
Goal: To connect all stable, tested, and isolated modules (Modules 1-5+) into a single, cohesive "flow." This is achieved by activating the central nervous system (the EventBus) and building the "brain" (the listener modules) that reacts to stimuli.
Core Principle: Modules do not call each other directly. They emit events. Listener modules (like FlowModule, GamificationModule) subscribe to these events and orchestrate cross-module actions. This is the decoupled architecture that ensures testability and scalability.
________________________________________
1. [ ] Prerequisite: Defining the "Nervous System"
Goal: Create a single, type-safe definition for every event that can "flow" through the system.
1.	File: apps/server/src/core/event-bus/events.types.ts
o	Action: Create a new file to define all event payloads. This ensures all emitters and listeners use the exact same data structure, eliminating type-related bugs.
TypeScript
// This file defines the "language" of our application.
import { Booking, Contact, Invoice, Project, SocialPost } from '@keyflow/db';

// --- Payload for when a new user signs up ---
export class UserCreatedPayload {
  userId: string;
  email: string;
}

// --- Payload for when a new contact is created ---
export class ContactCreatedPayload {
  contact: Contact;
  businessId: string;
}

// --- Payload for when a new booking is made ---
// This is fired *after* the booking and invoice (if any) are created.
export class BookingCreatedPayload {
  booking: Booking;
  contact: Contact;
  businessId: string;
}

// --- Payload for when an invoice is successfully paid ---
// This is the most important event in the system.
export class InvoicePaidPayload {
  invoice: Invoice & { items: InvoiceItem[], contact: Contact };
  businessId: string;
}

// --- Payload for when a social post is published ---
export class PostPublishedPayload {
  post: SocialPost;
  businessId: string;
}

// --- Payload for when a project is completed ---
export class ProjectCompletedPayload {
  project: Project;
  businessId: string;
}

// --- Master Event Map ---
// This allows NestJS to type-check our events.
export interface KeyFlowEventMap {
  'user.created': UserCreatedPayload;
  'contact.created': ContactCreatedPayload;
  'booking.created': BookingCreatedPayload;
  'invoice.paid': InvoicePaidPayload;
  'post.published': PostPublishedPayload;
  'project.completed': ProjectCompletedPayload;
}
________________________________________
2. [ ] Step 1: Implement the EventBus
Goal: Ensure the EventBusModule is correctly configured and globally available.
1.	File: apps/server/src/core/event-bus/event-bus.module.ts
o	Action: Ensure this module is configured to be global.
o	Logic:
TypeScript
import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [
    EventEmitterModule.forRoot({
      wildcard: true, // Allows for wildcard listeners (e.g., 'invoice.*')
      delimiter: '.',   // Use dots for event names
    }),
  ],
})
export class EventBusModule {}
2.	File: apps/server/src/app.module.ts
o	Action: Import the EventBusModule into the root AppModule's imports array. This makes it available for injection in all modules.
________________________________________
3. [ ] Step 2: Critical Re-architecture of Flow 1 (Booking → Invoice)
Goal: Fix the user flow flaw in the original plan. The client must be redirected to payment immediately after booking. We cannot wait for an async event.
1.	File: apps/server/src/modules/4-bookings/bookings.service.ts
o	Action: Modify the publicCreateBooking function from Module 4.
o	Directive: It must now inject the CommerceService and CrmService (from Module 3 & 2) and synchronously create the invoice.
o	New Logic for publicCreateBooking:
TypeScript
// ... (dependencies injected in constructor)
// constructor(
//   private readonly db: PrismaService,
//   private readonly eventBus: EventEmitter2,
//   private readonly crmService: CrmService, // <-- Inject Module 2
//   private readonly commerceService: CommerceService, // <-- Inject Module 3
// ) {}

async publicCreateBooking(input: PublicCreateBookingInput) {
  const { businessId, serviceId, staffId, startTime, contactInfo } = input;

  // 1. Get Service details
  const service = await this.db.service.findFirstOrThrow({ where: { id: serviceId } });
  const serviceDuration = service.duration;

  // 2. Find or Create Contact
  const contact = await this.crmService.findOrCreateContact(businessId, contactInfo);

  // 3. Create Invoice *before* booking (if service is not free)
  let newInvoice: Invoice | null = null;
  if (service.price > 0) {
    newInvoice = await this.commerceService.createInvoiceForService(
      businessId,
      contact.id,
      service,
    );
  }

  // 4. CRITICAL: Use a transaction to prevent double-booking
  const newBooking = await this.db.$transaction(async (tx) => {
    const slotEndTime = addMinutes(new Date(startTime), serviceDuration);

    // 5. Check for conflict *inside* the transaction (a read lock)
    const conflict = await tx.booking.findFirst({
      where: { 
        staffId, businessId, deletedAt: null,
        startTime: { lt: slotEndTime }, 
        endTime: { gt: new Date(startTime) } 
      }
    });
    if (conflict) {
      throw new TRPCError({ code: 'CONFLICT', message: 'This slot is no longer available.' });
    }

    // 6. Create the booking, linking the new invoice
    return tx.booking.create({
      data: {
        businessId,
        contactId: contact.id,
        serviceId,
        staffId,
        startTime: new Date(startTime),
        endTime: slotEndTime,
        status: 'PENDING',
        invoiceId: newInvoice?.id, // Link the invoice
      }
    });
  });

  // 7. Emit event *after* transaction succeeds
  this.eventBus.emit('booking.created', {
    booking: newBooking,
    contact: contact,
    businessId: businessId
  } as BookingCreatedPayload);

  // 8. Return all data the frontend needs for the redirect
  return {
    success: true,
    bookingId: newBooking.id,
    invoiceId: newInvoice?.id,
  };
}
2.	File: apps/server/src/modules/3-commerce/commerce.service.ts
o	Action: Create the new helper function createInvoiceForService.
o	Logic:
TypeScript
async createInvoiceForService(businessId: string, contactId: string, service: Service) {
  const total = service.price;

  return this.db.invoice.create({
    data: {
      businessId,
      contactId,
      status: 'DRAFT',
      issueDate: new Date(),
      total,
      currency: 'TTD', // Or from business settings
      items: {
        create: [{
          description: service.name,
          quantity: 1,
          unitPrice: service.price,
          total,
        }]
      }
    },
    include: { items: true, contact: true } // Return full payload
  });
}
________________________________________
4. [ ] Step 3: Upgrade Emitters
Goal: Inject the EventEmitter2 service into our existing modules and fire the events at the end of their operations.
1.	File: apps/server/src/modules/webhooks/webhooks.controller.ts
o	Action: Inject EventEmitter2 into the constructor.
o	Logic (inside POST /stripe webhook, checkout.session.completed case):
	After const updatedInvoice = await this.db.invoice.update(...)...
	Add this line:
this.eventBus.emit('invoice.paid', {
invoice: updatedInvoice,
businessId: updatedInvoice.businessId
} as InvoicePaidPayload);
2.	File: apps/server/src/modules/5-social/social.service.ts
o	Action: Inject EventEmitter2 into the SocialService constructor.
o	Logic (inside publishPost function):
	After await this.db.socialPost.update({ where: { id: postId }, data: { status: 'POSTED', ... } });...
	Add this line:
this.eventBus.emit('post.published', {
post: updatedPost,
businessId: updatedPost.businessId
} as PostPublishedPayload);
________________________________________
5. [ ] Step 4: Build the "Listener" Services
Goal: Create new, dedicated modules that only listen for events and perform cross-module logic.
1.	Create FlowModule (The Orchestrator):
o	File: apps/server/src/modules/flow/flow.module.ts
o	Action: Create the module to house our core business-logic flows.
o	Directive: This module must import the modules it needs to control: BookingsModule, CommerceModule, ProjectsModule (once built).
o	File: apps/server/src/modules/flow/flow.listener.ts
o	Action: Create the listener service.
TypeScript
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BookingsService } from '../4-bookings/bookings.service';
import { ProjectService } from '../6-projects/project.service';
import { InvoicePaidPayload } from '@/core/event-bus/events.types';
import { PrismaService } from '@/core/prisma/prisma.service';

@Injectable()
export class FlowListener {
  constructor(
    private readonly db: PrismaService,
    private readonly bookingsService: BookingsService,
    private readonly projectService: ProjectService,
  ) {}

  /**
   * Flow 2: Payment -> Booking Confirmation
   * Flow 3: Payment -> Project Creation
   */
  @OnEvent('invoice.paid')
  async handleInvoicePaid(payload: InvoicePaidPayload) {
    const { invoice } = payload;

    // --- Flow 2: Confirm the Booking ---
    if (invoice.bookingId) {
      await this.bookingsService.confirmBooking(invoice.bookingId);
    }

    // --- Flow 3: Create Project from Template ---
    for (const item of invoice.items) {
      if (item.productId) {
        const template = await this.db.projectTemplate.findFirst({
          where: { productId: item.productId }
        });

        if (template) {
          await this.projectService.createProjectFromTemplate(
            invoice.businessId,
            invoice.contactId,
            template,
          );
        }
      }
    }
  }
}
2.	Create GamificationModule (The "Fun" Layer):
o	File: apps/server/src/modules/gamification/gamification.listener.ts
o	Action: Create a listener to make the UI "fresh".
TypeScript
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InvoicePaidPayload } from '@/core/event-bus/events.types';
import { PrismaService } from '@/core/prisma/prisma.service';

@Injectable()
export class GamificationListener {
  constructor(private readonly db: PrismaService) {}

  @OnEvent('invoice.paid')
  async handleFirstSale(payload: InvoicePaidPayload) {
    const business = await this.db.business.findUnique({
      where: { id: payload.businessId },
    });

    const metaData = (business.metaData || {}) as any;

    if (!metaData.firstSaleMade) {
      await this.db.business.update({
        where: { id: payload.businessId },
        data: {
          metaData: { ...metaData, firstSaleMade: true }
        }
      });
    }
  }
  // (AI Directive: Add @OnEvent('booking.created') for 'firstBooking', etc.)
}
3.	Create AIModule (The "Observer"):
o	File: apps/server/src/modules/10-ai/ai.listener.ts
o	Action: Create the "Observe" part of the AI brain.
TypeScript
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@/core/prisma/prisma.service';
import { OpenAIEmbeddings } from '@langchain/openai';
import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase';

@Injectable()
export class AiListener {
  private vectorStore: SupabaseVectorStore;

  constructor(
    private readonly db: PrismaService,
    private readonly embeddings: OpenAIEmbeddings,
  ) {
    // Initialize vector store
    this.vectorStore = new SupabaseVectorStore(embeddings, {
      client: db, // Use our existing Prisma client!
      tableName: 'documents', // Assumes a 'documents' table with pgvector
    });
  }

  @OnEvent('*') // <-- Wildcard listener
  async observe(eventPayload: any) {
    // This captures *every* event
    const eventName = (eventPayload as any).eventName; // Get event name
    const textToStore = this.createTextSummary(eventName, eventPayload);

    await this.vectorStore.addDocuments([{
      pageContent: textToStore,
      metadata: {
        event: eventName,
        businessId: eventPayload.businessId,
        timestamp: new Date().toISOString(),
      },
    }]);
  }

  private createTextSummary(eventName: string, payload: any): string {
    // Logic to convert event payloads into natural language
    if (eventName === 'invoice.paid') {
      return `An invoice of ${payload.invoice.total} ${payload.invoice.currency} was paid by contact ${payload.invoice.contact.firstName}.`;
    }
    if (eventName === 'booking.created') {
      return `A new booking was created for contact ${payload.contact.firstName}.`;
    }
    return `An event happened: ${eventName}`;
  }
}
________________________________________
✅ Final Integration Testable Outcome (Genius Level)
1.	Setup:
o	Create a Product ("$500 Consult", price: 500, no template linked).
o	Create a second Product ("Onboarding Package", price: 1000).
o	Create a ProjectTemplate ("Onboarding") and link it to the "Onboarding Package" product.
2.	Test 1 (Booking-to-Invoice Flow):
o	A new client visits /book/my-business.
o	They select the "$500 Consult".
o	They fill in their details and book a time.
o	The public.createBooking tRPC call runs.
o	It synchronously creates "Contact 1", "Invoice #001" (for $500), and "Booking 1" (linked to "Invoice #001").
o	The tRPC call returns { success: true, bookingId: '...', invoiceId: 'inv_123' }.
o	The frontend immediately redirects the client to /pay/inv_123.
o	The booking.created event is fired asynchronously in the background (server logs "Event 'booking.created' emitted").
3.	Test 2 (Payment-to-Confirmation Flow):
o	The client (on /pay/inv_123) pays the $500.
o	The Stripe webhook hits POST /api/webhooks/stripe.
o	The WebhooksController validates the payment, updates "Invoice #001" to PAID, and fires the invoice.paid event. (Server logs "Event 'invoice.paid' emitted").
o	The FlowListener catches this event.
	handleInvoicePaid runs.
	It checks invoice.bookingId. It finds "Booking 1".
	It calls this.bookingsService.confirmBooking('booking_1').
	It checks invoice.items[0].productId. It finds no linked ProjectTemplate. Flow 3 is skipped.
o	The GamificationListener catches the same event.
	It sees this is the first sale for "Business A".
	It updates Business.metaData.firstSaleMade to true.
o	The AiListener catches the same event.
	It logs "An invoice of 500 TTD was paid..." to the pgvector store.
o	Result: The business owner logs in. The (app)/bookings calendar shows "Booking 1" as CONFIRMED (in green). A "Congrats on your first sale!" modal appears.
4.	Test 3 (Payment-to-Project Flow):
o	The Owner creates "Invoice #002" manually for the "Onboarding Package" ($1000).
o	The client pays for "Invoice #002".
o	The invoice.paid event fires again.
o	The FlowListener catches this event.
	handleInvoicePaid runs.
	It checks invoice.bookingId (it's null). Flow 2 is skipped.
	It checks invoice.items[0].productId. It finds a linked ProjectTemplate ("Onboarding").
	It calls this.projectService.createProjectFromTemplate(...).
o	Result: The business owner checks their /projects page. A new project, "Onboarding for Contact 1," has been automatically created.
This architecture has successfully built a fully decoupled, event-driven system that is testable, secure, and achieves all our "flow" objectives.



Here is a proposed addendum that addresses the potential issues of rigidity, unforeseen errors, and the apparent contradiction in development philosophy identified in the analysis.
This addendum, Section 6, is designed to be appended to your existing "KEYFLOW v3.docx" blueprint to provide guiding protocols for me, the AI, during execution.
________________________________________
6. Execution Addendum: Risk Mitigation & Flexibility Protocols
This addendum provides explicit, "genius-level" directives to the AI co-builder for handling unforeseen challenges during execution. The primary goal of the Master Blueprint is a flawless final product; these protocols ensure that rigidity, "on-paper" oversights, and philosophical dogma do not impede that goal.
6.1 Protocol for Technical Rigidity (Library & Stack Contingency)
The Master Blueprint 1111 is "opinionated" by design to ensure speed and consistency. However, a chosen library (e.g., FullCalendar, Nango, Trigger.dev) may reveal a critical bug, a breaking change, or a fundamental limitation not foreseen during planning.
Directive: In such a scenario, the AI will execute the following contingency protocol:
1.	Identify & Halt: The AI will identify the specific, blocking limitation (e.g., "Mandate: FullCalendar must support feature X. Finding: FullCalendar does not support feature X."). Work on the directly affected component will be halted.
2.	Research & Analyze: The AI will conduct a time-boxed (e.g., 1-hour) research spike to identify the top 1-2 viable, open-source, and free-tier-friendly alternatives.
3.	Propose Change: The AI will present a concise "Change Proposal" to the user.
o	Example Proposal: "Blocking Issue: FullCalendar does not support multi-staff timezone-aware availability views as required.
o	Proposal: Replace FullCalendar with react-big-calendar.
o	Reason: It is actively maintained and natively supports the required resource views.
o	Impact: Low. The events data structure is nearly identical. This will not affect the BookingsService logic, only the front-end rendering."
4.	Execute: Upon user approval, the AI will surgically replace the problematic library and continue execution. This protocol prevents project stagnation due to tool-stack rigidity.
________________________________________
6.2 Protocol for On-Paper Errors (Dynamic Patching)
The blueprint is a high-fidelity plan, but it is not infallible. The document itself contains a self-correction (adding slug and timezone to the Business model in Module 4 2). It is probable that other, more subtle logical or schematic gaps will be discovered during implementation (e.g., "The Booking model needs a productId to fulfill a 'book-a-product' flow").
Directive: The AI is mandated to identify and patch these gaps, not to build flawed code.
•	For Schema Gaps: If a logical requirement necessitates a new field or relation, the AI will pause, state the logical gap (e.g., "Cannot create a Project from an Invoice line item without a relation 3. The ProjectTemplate model must be linked to the Product model."), and propose the exact Prisma schema patch. Upon approval, it will apply the patch and run pnpm db:push.
•	For Logic Gaps: If a service's logic is flawed (e.g., "The AvailabilityService logic 4 does not account for company holidays"), the AI will state the flaw and the proposed logical patch before writing the code.
This protocol formalizes the "live document" nature of the blueprint into a controlled, non-destructive "patching" process.
________________________________________
6.3 Philosophy on Isolation vs. Integration (Pragmatism Mandate)
The blueprint's "Modular-Isolationist" philosophy 5555 is critical for build-time stability and isolated testing. However, Phase X introduces a "Critical Re-architecture" 6that couples the Booking and Commerce modules synchronously 7. This is an apparent contradiction, but it is a deliberate, pragmatic choice.
Directive: The AI must adhere to the following core philosophy:
Isolation is the build strategy. Seamless integration is the user-facing outcome.
The primary goal of isolation is to produce stable, independently verifiable components. The primary goal of the product is a seamless user flow.
Where a critical user experience (like "book-to-pay") must be synchronous, synchronous coupling is authorized and not a violation of the plan. The "Critical Re-architecture" in Phase X is the prime example: the user must be redirected to payment immediately, which an asynchronous event cannot guarantee 8.
This protocol mandates pragmatism over dogma. The AI will build all modules in 100% isolation first (Phases 0-5), and only then apply the necessary, minimal synchronous couplings during Phase X to perfect the user experience.





