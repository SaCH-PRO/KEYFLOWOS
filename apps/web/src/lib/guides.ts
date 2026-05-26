import type { GuideStep } from "@/contexts/guide-context";

export interface GuideDefinition {
  id: string;
  title: string;
  description: string;
  module: string;
  triggerPhrases: string[];
  steps: GuideStep[];
}

export const guideDefinitions: GuideDefinition[] = [
  // ── Revenue / Commerce ──
  {
    id: "create-invoice",
    title: "Create an Invoice",
    description: "Walk through creating and sending an invoice to a client",
    module: "revenue",
    triggerPhrases: [
      "how do i create an invoice",
      "create an invoice",
      "send an invoice",
      "new invoice",
      "how to bill a client",
    ],
    steps: [
      {
        id: "ci-1",
        title: "Navigate to Revenue",
        content: "You're in the Revenue workspace. Click the 'New Invoice' button to start.",
        target: "[data-guide='new-invoice-btn']",
        action: "highlight",
        position: "bottom",
      },
      {
        id: "ci-2",
        title: "Select a Client",
        content: "Choose the client you want to bill. You can search by name or email.",
        target: "[data-guide='client-select']",
        action: "highlight",
        position: "bottom",
      },
      {
        id: "ci-3",
        title: "Add Line Items",
        content: "Add products or services. Set quantities, prices, and any discounts.",
        target: "[data-guide='line-items']",
        action: "highlight",
        position: "top",
      },
      {
        id: "ci-4",
        title: "Review & Send",
        content: "Preview the invoice, then click Send. The client will receive it via email.",
        target: "[data-guide='send-btn']",
        action: "highlight",
        position: "top",
      },
    ],
  },
  {
    id: "send-quote",
    title: "Send a Quote",
    description: "Create and send a price quote to a prospect",
    module: "revenue",
    triggerPhrases: [
      "how do i send a quote",
      "create a quote",
      "new quote",
      "how to quote a client",
    ],
    steps: [
      {
        id: "sq-1",
        title: "Start a New Quote",
        content: "Click 'New Quote' to begin creating a price estimate.",
        target: "[data-guide='new-quote-btn']",
        action: "highlight",
        position: "bottom",
      },
      {
        id: "sq-2",
        title: "Add Items & Pricing",
        content: "Add services or products with descriptions and pricing.",
        target: "[data-guide='quote-items']",
        action: "highlight",
        position: "top",
      },
      {
        id: "sq-3",
        title: "Set Expiry",
        content: "Choose when the quote expires. This creates urgency for the client.",
        target: "[data-guide='expiry-field']",
        action: "highlight",
        position: "top",
      },
      {
        id: "sq-4",
        title: "Send the Quote",
        content: "Review and click Send. You'll be notified when the client accepts or declines.",
        target: "[data-guide='send-quote-btn']",
        action: "highlight",
        position: "top",
      },
    ],
  },

  // ── CRM / People ──
  {
    id: "add-contact",
    title: "Add a New Contact",
    description: "Add a client or lead to your contacts",
    module: "crm",
    triggerPhrases: [
      "how do i add a contact",
      "add a new client",
      "create a contact",
      "new contact",
      "add a lead",
    ],
    steps: [
      {
        id: "ac-1",
        title: "Add Contact",
        content: "Click the '+ Contact' button to add someone new.",
        target: "[data-guide='add-contact-btn']",
        action: "highlight",
        position: "bottom",
      },
      {
        id: "ac-2",
        title: "Enter Details",
        content: "Fill in name, email, phone, and company. The more info, the better KEY can help you.",
        target: "[data-guide='contact-form']",
        action: "highlight",
        position: "top",
      },
      {
        id: "ac-3",
        title: "Set Pipeline Stage",
        content: "Choose where this contact sits in your pipeline: Lead, Prospect, or Client.",
        target: "[data-guide='pipeline-stage']",
        action: "highlight",
        position: "top",
      },
      {
        id: "ac-4",
        title: "Save",
        content: "Click Save. KEY will start tracking interactions and opportunities for this contact.",
        target: "[data-guide='save-contact-btn']",
        action: "highlight",
        position: "top",
      },
    ],
  },

  // ── Projects / Work ──
  {
    id: "create-project",
    title: "Create a Project",
    description: "Set up a new project with tasks and milestones",
    module: "projects",
    triggerPhrases: [
      "how do i create a project",
      "start a project",
      "new project",
      "set up a project",
    ],
    steps: [
      {
        id: "cp-1",
        title: "New Project",
        content: "Click 'New Project' to get started.",
        target: "[data-guide='new-project-btn']",
        action: "highlight",
        position: "bottom",
      },
      {
        id: "cp-2",
        title: "Name & Client",
        content: "Give your project a name and link it to a client.",
        target: "[data-guide='project-name']",
        action: "highlight",
        position: "top",
      },
      {
        id: "cp-3",
        title: "Add Tasks",
        content: "Break the project into tasks. Assign owners and set due dates.",
        target: "[data-guide='task-list']",
        action: "highlight",
        position: "top",
      },
      {
        id: "cp-4",
        title: "Set Timeline",
        content: "Set start and end dates. KEY will track progress and flag delays.",
        target: "[data-guide='timeline-picker']",
        action: "highlight",
        position: "top",
      },
    ],
  },

  // ── Calendar / Schedule ──
  {
    id: "book-appointment",
    title: "Book an Appointment",
    description: "Schedule a meeting or service appointment",
    module: "calendar",
    triggerPhrases: [
      "how do i book an appointment",
      "schedule a meeting",
      "new booking",
      "book a client",
    ],
    steps: [
      {
        id: "ba-1",
        title: "New Booking",
        content: "Click on an open slot or the 'New Booking' button.",
        target: "[data-guide='new-booking-btn']",
        action: "highlight",
        position: "bottom",
      },
      {
        id: "ba-2",
        title: "Select Client & Service",
        content: "Choose who it's for and what service you're providing.",
        target: "[data-guide='booking-form']",
        action: "highlight",
        position: "top",
      },
      {
        id: "ba-3",
        title: "Confirm Time",
        content: "Double-check the time. The client will get a calendar invite.",
        target: "[data-guide='time-confirm']",
        action: "highlight",
        position: "top",
      },
      {
        id: "ba-4",
        title: "Send Confirmation",
        content: "Click Book. Both you and the client will be notified.",
        target: "[data-guide='book-btn']",
        action: "highlight",
        position: "top",
      },
    ],
  },

  // ── Expenses ──
  {
    id: "log-expense",
    title: "Log an Expense",
    description: "Record a business expense with receipt",
    module: "expenses",
    triggerPhrases: [
      "how do i log an expense",
      "add an expense",
      "new expense",
      "record a receipt",
    ],
    steps: [
      {
        id: "le-1",
        title: "New Expense",
        content: "Click 'New Expense' to record a business cost.",
        target: "[data-guide='new-expense-btn']",
        action: "highlight",
        position: "bottom",
      },
      {
        id: "le-2",
        title: "Amount & Category",
        content: "Enter the amount and choose a category like Travel, Software, or Office.",
        target: "[data-guide='expense-amount']",
        action: "highlight",
        position: "top",
      },
      {
        id: "le-3",
        title: "Attach Receipt",
        content: "Upload a photo or PDF of the receipt for your records.",
        target: "[data-guide='receipt-upload']",
        action: "highlight",
        position: "top",
      },
      {
        id: "le-4",
        title: "Save",
        content: "Click Save. KEY will track this against your budget.",
        target: "[data-guide='save-expense-btn']",
        action: "highlight",
        position: "top",
      },
    ],
  },
];

/**
 * Find a guide whose trigger phrases match the user's message.
 */
export function findGuideByIntent(message: string): GuideDefinition | undefined {
  const lower = message.toLowerCase();
  return guideDefinitions.find((guide) =>
    guide.triggerPhrases.some((phrase) => lower.includes(phrase.toLowerCase()))
  );
}

/**
 * Get all guides for a specific module.
 */
export function getGuidesForModule(module: string): GuideDefinition[] {
  return guideDefinitions.filter((g) => g.module === module);
}
