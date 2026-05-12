export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  logs?: string[];
}

export type ToolFn = (businessId: string, input: Record<string, unknown>) => Promise<ToolResult>;

export const keyToolRegistry: Record<string, Record<string, ToolFn>> = {
  contacts: {
    searchContacts: async (businessId, input) => ({ success: true, data: { businessId, query: input.query } }),
    summarizeContact: async (businessId, input) => ({ success: true, data: { businessId, contactId: input.contactId } }),
    recommendFollowUps: async (businessId) => ({ success: true, data: { businessId } }),
    createContactTask: async (businessId, input) => ({ success: true, data: { businessId, task: input.task } }),
  },
  commerce: {
    summarizeRevenue: async (businessId) => ({ success: true, data: { businessId } }),
    draftQuote: async (businessId, input) => ({ success: true, data: { businessId, contactId: input.contactId } }),
    draftInvoice: async (businessId, input) => ({ success: true, data: { businessId, contactId: input.contactId } }),
    recommendPricing: async (businessId) => ({ success: true, data: { businessId } }),
    analyzeCatalog: async (businessId) => ({ success: true, data: { businessId } }),
  },
  bookings: {
    findAvailability: async (businessId, input) => ({ success: true, data: { businessId, date: input.date } }),
    createBookingDraft: async (businessId, input) => ({ success: true, data: { businessId, contactId: input.contactId } }),
    summarizeSchedule: async (businessId) => ({ success: true, data: { businessId } }),
  },
  timeline: {
    summarizePeriod: async (businessId, input) => ({ success: true, data: { businessId, from: input.from, to: input.to } }),
    createReminder: async (businessId, input) => ({ success: true, data: { businessId, title: input.title } }),
    createScheduledAction: async (businessId, input) => ({ success: true, data: { businessId, action: input.action } }),
  },
  storefront: {
    auditStorefront: async (businessId) => ({ success: true, data: { businessId } }),
    recommendLayout: async (businessId) => ({ success: true, data: { businessId } }),
    draftCopy: async (businessId, input) => ({ success: true, data: { businessId, section: input.section } }),
  },
  blueprint: {
    analyzeBlueprint: async (businessId) => ({ success: true, data: { businessId } }),
    recommendSetupSteps: async (businessId) => ({ success: true, data: { businessId } }),
    inferFromData: async (businessId) => ({ success: true, data: { businessId } }),
  },
  procurement: {
    generateBrief: async (businessId, input) => ({ success: true, data: { businessId, requestId: input.requestId } }),
    recommendPackage: async (businessId, input) => ({ success: true, data: { businessId, requestId: input.requestId } }),
    notifyOwner: async (businessId, input) => ({ success: true, data: { businessId, message: input.message } }),
  },
};
