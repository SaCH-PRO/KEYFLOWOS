import { z } from "zod";
import { API_BASE, apiPost, getAuthHeaders } from "./api";

const DEFAULT_BUSINESS_ID = process.env.NEXT_PUBLIC_DEMO_BUSINESS_ID ?? "biz_demo";

const contactMetaSchema = z.object({
  outstandingBalance: z.number().optional(),
  unpaidInvoices: z.number().optional(),
  paidInvoices: z.number().optional(),
  oldestUnpaidInvoiceDueAt: z.string().nullable().optional(),
  lastInteractionAt: z.string().optional(),
  nextDueTaskAt: z.string().nullable().optional(),
  overdueTasks: z.number().optional(),
  overdueBookings: z.number().optional(),
  bookingsRecent: z.number().optional(),
  leadScore: z.number().optional(),
  predictedNextBookingAt: z.string().nullable().optional(),
});

const contactSchema = z.object({
  id: z.string(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  emailNormalized: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  phoneNormalized: z.string().nullable().optional(),
  status: z.string().optional(),
  source: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  custom: z.record(z.unknown()).nullable().optional(),
  displayName: z.string().nullable().optional(),
  secondaryEmail: z.string().nullable().optional(),
  secondaryPhone: z.string().nullable().optional(),
  whatsappNumber: z.string().nullable().optional(),
  preferredChannel: z.string().nullable().optional(),
  addressLine1: z.string().nullable().optional(),
  addressLine2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  companyName: z.string().nullable().optional(),
  jobTitle: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
  lifecycleStage: z.string().nullable().optional(),
  sourceDetail: z.string().nullable().optional(),
  segment: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  marketingOptIn: z.boolean().nullable().optional(),
  doNotContact: z.boolean().nullable().optional(),
  notesInternal: z.string().nullable().optional(),
  meta: contactMetaSchema.optional(),
});

const eventSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  type: z.string(),
  data: z.unknown(),
  actorType: z.string().nullable().optional(),
  actorId: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  createdAt: z.string(),
});

const noteSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  body: z.string(),
  createdAt: z.string(),
  source: z.string().nullable().optional(),
});

const taskSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  title: z.string(),
  status: z.string().optional(),
  priority: z.string().optional(),
  assigneeId: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  remindAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  contact: contactSchema.optional(),
});

const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.number(),
  currency: z.string().default("TTD"),
});

const contactSummarySchema = z.object({
  id: z.string().optional(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
});

const serviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  duration: z.number(),
  price: z.number(),
  currency: z.string().nullable().optional(),
});

const staffSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const availabilitySchema = z.object({
  id: z.string(),
  staffId: z.string(),
  dayOfWeek: z.number(),
  startTime: z.string(),
  endTime: z.string(),
});

const lineItemSchema = z.object({
  id: z.string().optional(),
  description: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
  total: z.number(),
  productId: z.string().nullable().optional(),
});

const quoteSchema = z.object({
  id: z.string(),
  quoteNumber: z.string().nullable().optional(),
  status: z.string(),
  total: z.number(),
  currency: z.string(),
  issueDate: z.string().optional(),
  expiryDate: z.string().nullable().optional(),
  contact: contactSummarySchema.nullable().optional(),
  items: z.array(lineItemSchema).optional(),
});

const bookingSchema = z.object({
  id: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  status: z.string(),
  contact: contactSummarySchema.optional(),
  service: serviceSchema.optional(),
  staff: staffSchema.optional(),
});

const invoiceSummarySchema = z.object({
  id: z.string(),
  status: z.string(),
  total: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  issueDate: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  paidAt: z.string().nullable().optional(),
});

export type Contact = z.infer<typeof contactSchema> & { tags?: string[] };
export type Service = z.infer<typeof serviceSchema>;
export type StaffMember = z.infer<typeof staffSchema>;
export type Availability = z.infer<typeof availabilitySchema>;
export type LineItem = z.infer<typeof lineItemSchema>;
export type Quote = z.infer<typeof quoteSchema>;
const contactImportSchema = z.object({
  id: z.string(),
  businessId: z.string(),
  sourceType: z.enum(["csv", "xlsx", "pdf", "image", "link"]),
  sourceUrl: z.string().nullable().optional(),
  originalName: z.string().nullable().optional(),
  status: z.string(),
  totalRows: z.number().nullable().optional(),
  processedRows: z.number().nullable().optional(),
  error: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable().optional(),
});
export type ContactImportJob = z.infer<typeof contactImportSchema>;
const contactPlaybookSchema = z.object({
  id: z.string(),
  businessId: z.string(),
  contactId: z.string(),
  type: z.string(),
  schemaVersion: z.string(),
  data: z.record(z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastUsedAt: z.string().nullable().optional(),
});
export type ContactPlaybook = z.infer<typeof contactPlaybookSchema>;
export type ContactMedia = {
  id: string;
  businessId: string;
  contactId?: string | null;
  type: string;
  url: string;
  ocrText?: string | null;
  createdAt: string;
};
export type ContactImportOcrResponse = {
  contact: Contact;
  media: ContactMedia;
};
export type ContactEvent = z.infer<typeof eventSchema>;
export type ContactNote = z.infer<typeof noteSchema>;
export type ContactTask = Omit<z.infer<typeof taskSchema>, "contact"> & { contact?: Contact | null };
export type Product = z.infer<typeof productSchema>;
export type Booking = z.infer<typeof bookingSchema>;
export type SocialPost = z.infer<typeof socialPostSchema>;
export type SocialConnection = z.infer<typeof socialConnectionSchema>;
export type Automation = z.infer<typeof automationSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProjectTask = z.infer<typeof projectTaskSchema>;
export type ProjectTemplate = z.infer<typeof projectTemplateSchema>;
export type Site = z.infer<typeof siteSchema>;
export type ReportSummary = z.infer<typeof reportSummarySchema>;
export type Membership = z.infer<typeof membershipSchema>;
export type Invoice = {
  id: string;
  invoiceNumber?: string | null;
  status: string;
  total: number | string;
  currency: string;
  contact?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
};

type ApiResult<T> = { data: T | null; error: string | null };

const fallbackContacts: Contact[] = [];

const fallbackBookings: Booking[] = [
  { id: "bk_1", startTime: new Date().toISOString(), endTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(), status: "CONFIRMED" },
  { id: "bk_2", startTime: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), endTime: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(), status: "PENDING" },
];

const fallbackProducts: Product[] = [
  { id: "pd_1", name: "Consultation", price: 850, currency: "TTD" },
  { id: "pd_2", name: "Follow-up Session", price: 600, currency: "TTD" },
  { id: "pd_3", name: "Wellness Package", price: 1200, currency: "TTD" },
];

const fallbackInvoices: Invoice[] = [
  { id: "inv_1", invoiceNumber: "INV-001", status: "PAID", total: 850, currency: "TTD", contact: { firstName: "Sarah", email: "sarah@example.com" } },
  { id: "inv_2", invoiceNumber: "INV-002", status: "SENT", total: 600, currency: "TTD", contact: { firstName: "John", email: "john@example.com" } },
];

async function apiGet<T>(path: string, schema: z.ZodSchema<T>, fallback?: T): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: getAuthHeaders() });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) {
      let message: string = res.statusText;
      if (typeof json === "object" && json && "message" in json && typeof (json as Record<string, unknown>).message === "string") {
        message = (json as Record<string, string>).message;
      }
      return { data: fallback ?? null, error: message };
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return { data: fallback ?? null, error: "Failed to parse response" };
    }
    return { data: parsed.data, error: null };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Network error";
    return { data: fallback ?? null, error: message };
  }
}

export async function fetchContacts(
  businessId: string = DEFAULT_BUSINESS_ID,
  opts?: {
    status?: string;
    search?: string;
    hasUnpaidInvoices?: boolean;
    hasUpcomingBookings?: boolean;
    staleDays?: number;
    newThisWeek?: boolean;
    tags?: string[];
    skip?: number;
    take?: number;
    includeStats?: boolean;
  },
) {
  const params = new URLSearchParams();
  if (opts?.status) params.set("status", opts.status);
  if (opts?.search) params.set("search", opts.search);
  if (opts?.hasUnpaidInvoices) params.set("hasUnpaidInvoices", "true");
  if (opts?.hasUpcomingBookings) params.set("hasUpcomingBookings", "true");
  if (opts?.staleDays) params.set("staleDays", String(opts.staleDays));
  if (opts?.newThisWeek) params.set("newThisWeek", "true");
  if (opts?.tags?.length) opts.tags.forEach((t) => params.append("tags", t));
  if (opts?.skip !== undefined) params.set("skip", String(opts.skip));
  if (opts?.take !== undefined) params.set("take", String(opts.take));
  if (opts?.includeStats) params.set("includeStats", "true");
  return apiGet(
    `/crm/businesses/${encodeURIComponent(businessId)}/contacts${params.toString() ? `?${params.toString()}` : ""}`,
    z.array(contactSchema),
    fallbackContacts,
  );
}

const contactDetailSchema = z.object({
  contact: contactSchema.nullable(),
  events: z.array(eventSchema),
  notes: z.array(noteSchema),
  tasks: z.array(taskSchema),
  invoices: z.array(invoiceSummarySchema).optional(),
  bookings: z.array(bookingSchema).optional(),
  meta: contactMetaSchema.nullable().optional(),
});
export type ContactDetail = z.infer<typeof contactDetailSchema>;

const highlightContactSchema = z.object({
  contactId: z.string(),
  name: z.string(),
  status: z.string(),
  leadScore: z.number().optional(),
  outstandingBalance: z.number().optional(),
  unpaidInvoices: z.number().optional(),
  lastInteractionAt: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

const serviceAffinitySchema = z.object({
  serviceId: z.string(),
  serviceName: z.string(),
  bookings: z.number(),
  revenue: z.number(),
  topContact: z
    .object({
      id: z.string(),
      name: z.string(),
      bookings: z.number(),
    })
    .optional(),
});

const segmentInsightSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  count: z.number(),
  contacts: z.array(contactSchema),
});

const timelineEntrySchema = z.object({
  id: z.string(),
  type: z.string(),
  contactId: z.string(),
  contactName: z.string().optional(),
  contactEmail: z.string().nullable().optional(),
  title: z.string(),
  description: z.string().optional(),
  timestamp: z.string(),
  meta: z.record(z.unknown()).optional(),
});

const nextActionSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  contactName: z.string().optional(),
  title: z.string(),
  detail: z.string(),
  severity: z.enum(["high", "medium", "info"]),
  trigger: z.string(),
});

const aiStubSchema = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string(),
});

const flowHighlightsSchema = z.object({
  highlights: z.object({
    highPotential: z.array(highlightContactSchema),
    overdueReminders: z.array(highlightContactSchema),
    serviceAffinity: z.array(serviceAffinitySchema),
  }),
  segments: z.array(segmentInsightSchema),
  timeline: z.array(timelineEntrySchema),
  nextActions: z.array(nextActionSchema),
  aiNextActions: z.array(aiStubSchema),
});

export type FlowHighlights = z.infer<typeof flowHighlightsSchema>;

const socialPostSchema = z.object({
  id: z.string(),
  content: z.string(),
  status: z.string(),
  scheduledAt: z.string().nullable().optional(),
  postedAt: z.string().nullable().optional(),
  mediaUrls: z.array(z.string()).optional(),
});

const socialConnectionSchema = z.object({
  id: z.string(),
  platform: z.string(),
  platformId: z.string().nullable().optional(),
  token: z.string().optional(),
});

const automationSchema = z.object({
  id: z.string(),
  name: z.string(),
  trigger: z.string(),
  actionData: z.record(z.unknown()).optional(),
});

const projectTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  isCompleted: z.boolean().optional(),
  dueDate: z.string().nullable().optional(),
});

const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  tasks: z.array(projectTaskSchema).optional(),
});

const projectTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  taskTitles: z.array(z.string()).optional(),
});

const siteSchema = z.object({
  id: z.string(),
  subdomain: z.string(),
  siteData: z.record(z.unknown()).optional(),
  businessId: z.string().optional(),
});

const reportSummarySchema = z.object({
  totalContacts: z.number(),
  totalBookings: z.number(),
  totalInvoices: z.number(),
  totalRevenue: z.number(),
  outstandingBalance: z.number(),
  overdueTasks: z.number(),
  upcomingBookings: z.number(),
});

const membershipSchema = z.object({
  id: z.string(),
  role: z.string(),
  business: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .optional(),
  user: z
    .object({
      id: z.string(),
      email: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
    })
    .optional(),
});

export async function fetchContactDetail(contactId: string, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(
    `/crm/businesses/${encodeURIComponent(businessId)}/contacts/${encodeURIComponent(contactId)}`,
    contactDetailSchema,
    null,
  );
}

export async function fetchBookings(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(
    `/bookings/businesses/${encodeURIComponent(businessId)}`,
    z.array(bookingSchema),
    fallbackBookings,
  );
}

export async function updateBookingStatus(input: { bookingId: string; status: string }) {
  return apiPost<Booking>({
    path: `/bookings/bookings/${encodeURIComponent(input.bookingId)}/status`,
    body: { status: input.status },
  });
}

export async function fetchServices(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(`/bookings/businesses/${encodeURIComponent(businessId)}/services`, z.array(serviceSchema), []);
}

export async function fetchPublicServices(businessId: string) {
  return apiGet(`/bookings/public/businesses/${encodeURIComponent(businessId)}/services`, z.array(serviceSchema), []);
}

export async function createService(input: {
  businessId?: string;
  name: string;
  description?: string;
  duration: number;
  price: number;
  currency?: string;
}) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<Service>({
    path: `/bookings/businesses/${encodeURIComponent(businessId)}/services`,
    body: {
      name: input.name,
      description: input.description,
      duration: input.duration,
      price: input.price,
      currency: input.currency,
    },
  });
}

export async function updateService(input: {
  serviceId: string;
  name?: string;
  description?: string;
  duration?: number;
  price?: number;
  currency?: string;
}) {
  return apiPost<Service>({
    path: `/bookings/services/${encodeURIComponent(input.serviceId)}`,
    body: input,
    init: { method: "PATCH" },
  });
}

export async function deleteService(serviceId: string) {
  return apiPost<{ success: boolean; id: string }>({
    path: `/bookings/services/${encodeURIComponent(serviceId)}`,
    body: {},
    init: { method: "DELETE" },
  });
}

export async function fetchStaff(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(`/bookings/businesses/${encodeURIComponent(businessId)}/staff`, z.array(staffSchema), []);
}

export async function fetchPublicStaff(businessId: string) {
  return apiGet(`/bookings/public/businesses/${encodeURIComponent(businessId)}/staff`, z.array(staffSchema), []);
}

export async function createStaff(input: { businessId?: string; name: string }) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<StaffMember>({
    path: `/bookings/businesses/${encodeURIComponent(businessId)}/staff`,
    body: { name: input.name },
  });
}

export async function updateStaff(input: { staffId: string; name?: string }) {
  return apiPost<StaffMember>({
    path: `/bookings/staff/${encodeURIComponent(input.staffId)}`,
    body: { name: input.name },
    init: { method: "PATCH" },
  });
}

export async function deleteStaff(staffId: string) {
  return apiPost<{ success: boolean; id: string }>({
    path: `/bookings/staff/${encodeURIComponent(staffId)}`,
    body: {},
    init: { method: "DELETE" },
  });
}

export async function fetchAvailability(staffId: string) {
  return apiGet(`/bookings/staff/${encodeURIComponent(staffId)}/availability`, z.array(availabilitySchema), []);
}

export async function createAvailability(input: {
  staffId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}) {
  return apiPost<Availability>({
    path: `/bookings/staff/${encodeURIComponent(input.staffId)}/availability`,
    body: {
      dayOfWeek: input.dayOfWeek,
      startTime: input.startTime,
      endTime: input.endTime,
    },
  });
}

export async function deleteAvailability(availabilityId: string) {
  return apiPost<{ success: boolean; id: string }>({
    path: `/bookings/availability/${encodeURIComponent(availabilityId)}`,
    body: {},
    init: { method: "DELETE" },
  });
}

export async function fetchProducts(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(
    `/commerce/businesses/${encodeURIComponent(businessId)}/products`,
    z.array(productSchema),
    fallbackProducts,
  );
}

export async function fetchInvoices(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(
    `/commerce/businesses/${encodeURIComponent(businessId)}/invoices`,
    z.array(
      z.object({
        id: z.string(),
        invoiceNumber: z.string().nullable().optional(),
        status: z.string(),
        total: z.number(),
        currency: z.string(),
        contact: z
          .object({
            firstName: z.string().nullable().optional(),
            lastName: z.string().nullable().optional(),
            email: z.string().nullable().optional(),
          })
          .nullable()
          .optional(),
      }),
    ),
    fallbackInvoices,
  );
}

export async function fetchInvoice(invoiceId: string) {
  return apiGet(`/commerce/invoices/${encodeURIComponent(invoiceId)}`, z.any(), null);
}

export async function fetchInvoicePublic(invoiceId: string) {
  return apiGet(`/commerce/public/invoices/${encodeURIComponent(invoiceId)}`, z.any(), null);
}

export async function createInvoice(input: {
  businessId?: string;
  contactId: string;
  issueDate?: string;
  dueDate?: string | null;
  status?: string;
  currency?: string;
  items: Array<{ description: string; quantity: number; unitPrice: number; total?: number; productId?: string | null }>;
}) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<unknown>({
    path: `/commerce/businesses/${encodeURIComponent(businessId)}/invoices`,
    body: input,
  });
}

export async function updateInvoice(input: {
  invoiceId: string;
  contactId?: string;
  issueDate?: string;
  dueDate?: string | null;
  status?: string;
  currency?: string;
  items?: Array<{ description: string; quantity: number; unitPrice: number; total?: number; productId?: string | null }>;
}) {
  return apiPost<unknown>({
    path: `/commerce/invoices/${encodeURIComponent(input.invoiceId)}`,
    body: input,
    init: { method: "PATCH" },
  });
}

export async function deleteInvoice(invoiceId: string) {
  return apiPost<{ success: boolean; id: string }>({
    path: `/commerce/invoices/${encodeURIComponent(invoiceId)}`,
    body: {},
    init: { method: "DELETE" },
  });
}

export async function fetchQuotes(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(`/commerce/businesses/${encodeURIComponent(businessId)}/quotes`, z.array(quoteSchema), []);
}

export async function fetchQuote(quoteId: string) {
  return apiGet(`/commerce/quotes/${encodeURIComponent(quoteId)}`, quoteSchema, null);
}

export async function createQuote(input: {
  businessId?: string;
  contactId: string;
  issueDate?: string;
  expiryDate?: string | null;
  status?: string;
  currency?: string;
  items: Array<{ description: string; quantity: number; unitPrice: number; total?: number; productId?: string | null }>;
}) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<unknown>({
    path: `/commerce/businesses/${encodeURIComponent(businessId)}/quotes`,
    body: input,
  });
}

export async function updateQuote(input: {
  quoteId: string;
  contactId?: string;
  issueDate?: string;
  expiryDate?: string | null;
  status?: string;
  currency?: string;
  items?: Array<{ description: string; quantity: number; unitPrice: number; total?: number; productId?: string | null }>;
}) {
  return apiPost<unknown>({
    path: `/commerce/quotes/${encodeURIComponent(input.quoteId)}`,
    body: input,
    init: { method: "PATCH" },
  });
}

export async function deleteQuote(quoteId: string) {
  return apiPost<{ success: boolean; id: string }>({
    path: `/commerce/quotes/${encodeURIComponent(quoteId)}`,
    body: {},
    init: { method: "DELETE" },
  });
}

export async function createContact(input: {
  businessId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  status?: string;
  source?: string;
  tags?: string[];
  custom?: Record<string, unknown>;
  displayName?: string;
  companyName?: string;
  jobTitle?: string;
  lifecycleStage?: string;
  segment?: string;
  notesInternal?: string;
  preferredChannel?: string;
}) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  const body = {
    firstName: input.firstName ?? "Guest",
    lastName: input.lastName ?? "User",
    email: input.email ?? "",
    phone: input.phone ?? "",
    status: input.status ?? "LEAD",
    source: input.source ?? "",
    tags: input.tags ?? [],
    custom: input.custom ?? {},
    displayName: input.displayName,
    companyName: input.companyName,
    jobTitle: input.jobTitle,
    lifecycleStage: input.lifecycleStage,
    segment: input.segment,
    notesInternal: input.notesInternal,
    preferredChannel: input.preferredChannel,
  };

  const res = await apiPost<Contact>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/contacts`,
    body,
  });

  if (res.data) return res;

  // Fallback: synthesize a contact so UI keeps flowing
  const synthesized: Contact = {
    id: `ct_${Date.now()}`,
    firstName: body.firstName,
    lastName: body.lastName,
    email: body.email,
    phone: body.phone,
    tags: body.tags ?? [],
  };

  return { data: synthesized, error: res.error };
}

export async function fetchContactEvents(
  contactId: string,
  businessId: string = DEFAULT_BUSINESS_ID,
): Promise<ApiResult<ContactEvent[]>> {
  return apiGet(
    `/crm/businesses/${encodeURIComponent(businessId)}/contacts/${encodeURIComponent(contactId)}/events`,
    z.array(eventSchema),
    [],
  );
}

export async function fetchContactNotes(
  contactId: string,
  businessId: string = DEFAULT_BUSINESS_ID,
): Promise<ApiResult<ContactNote[]>> {
  return apiGet(
    `/crm/businesses/${encodeURIComponent(businessId)}/contacts/${encodeURIComponent(contactId)}/notes`,
    z.array(noteSchema),
    [],
  );
}

export async function fetchContactTasks(params: {
  businessId?: string;
  contactId?: string;
  status?: string;
  dueBefore?: string;
}): Promise<ApiResult<ContactTask[]>> {
  const businessId = params.businessId ?? DEFAULT_BUSINESS_ID;
  const query = new URLSearchParams();
  if (params.contactId) query.set('contactId', params.contactId);
  if (params.status) query.set('status', params.status);
  if (params.dueBefore) query.set('dueBefore', params.dueBefore);
  const path = `/crm/businesses/${encodeURIComponent(businessId)}/tasks${query.toString() ? `?${query.toString()}` : ''}`;
  return apiGet(
    path,
    z.array(taskSchema),
    [],
  );
}

export async function fetchContactPlaybook(contactId: string, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(
    `/crm/businesses/${encodeURIComponent(businessId)}/contacts/${encodeURIComponent(contactId)}/playbook`,
    contactPlaybookSchema,
    null,
  );
}

export async function updateContactPlaybook(params: {
  contactId: string;
  data: Record<string, unknown>;
  type?: string;
  businessId?: string;
}) {
  const businessId = params.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<ContactPlaybook>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/contacts/${encodeURIComponent(params.contactId)}/playbook`,
    body: { data: params.data, type: params.type },
  });
}

export async function addContactNote(contactId: string, body: string, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiPost<ContactNote>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/contacts/${encodeURIComponent(contactId)}/notes`,
    body: { body },
  });
}

export async function addContactTask(
  contactId: string,
  title: string,
  options?: { dueDate?: string; priority?: "NORMAL" | "HIGH" | "LOW"; assigneeId?: string; remindAt?: string },
  businessId: string = DEFAULT_BUSINESS_ID,
) {
  return apiPost<ContactTask>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/contacts/${encodeURIComponent(contactId)}/tasks`,
    body: {
      title,
      dueDate: options?.dueDate,
      priority: options?.priority,
      assigneeId: options?.assigneeId,
      remindAt: options?.remindAt,
    },
  });
}

export async function fetchSegmentSummary(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(
    `/crm/businesses/${encodeURIComponent(businessId)}/segments`,
    z.object({
      lead: z.number(),
      prospect: z.number(),
      client: z.number(),
      lost: z.number(),
      unpaid: z.number(),
      stale: z.number(),
      newThisWeek: z.number(),
    }),
    { lead: 0, prospect: 0, client: 0, lost: 0, unpaid: 0, stale: 0, newThisWeek: 0 },
  );
}

export async function fetchCrmHighlights(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(
    `/crm/businesses/${encodeURIComponent(businessId)}/highlights`,
    flowHighlightsSchema,
    {
      highlights: { highPotential: [], overdueReminders: [], serviceAffinity: [] },
      segments: [],
      timeline: [],
      nextActions: [],
      aiNextActions: [],
    },
  );
}

export async function fetchAutomations(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(`/automation/businesses/${encodeURIComponent(businessId)}`, z.array(automationSchema), []);
}

export async function createAutomation(input: {
  businessId?: string;
  name: string;
  trigger: string;
  actionData?: Record<string, unknown>;
}) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<Automation>({
    path: `/automation/businesses/${encodeURIComponent(businessId)}`,
    body: {
      name: input.name,
      trigger: input.trigger,
      actionData: input.actionData ?? {},
    },
  });
}

export async function updateAutomation(input: {
  businessId?: string;
  automationId: string;
  name?: string;
  trigger?: string;
  actionData?: Record<string, unknown>;
}) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<Automation>({
    path: `/automation/businesses/${encodeURIComponent(businessId)}/${encodeURIComponent(input.automationId)}`,
    body: {
      name: input.name,
      trigger: input.trigger,
      actionData: input.actionData,
    },
    init: { method: "PATCH" },
  });
}

export async function deleteAutomation(input: { businessId?: string; automationId: string }) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<{ success: boolean; id: string }>({
    path: `/automation/businesses/${encodeURIComponent(businessId)}/${encodeURIComponent(input.automationId)}`,
    body: {},
    init: { method: "DELETE" },
  });
}

export async function fetchSocialPosts(businessId: string = DEFAULT_BUSINESS_ID, status?: string) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiGet(`/social/businesses/${encodeURIComponent(businessId)}/posts${query}`, z.array(socialPostSchema), []);
}

export async function createSocialPost(input: {
  businessId?: string;
  content: string;
  mediaUrls?: string[];
}) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<SocialPost>({
    path: `/social/businesses/${encodeURIComponent(businessId)}/posts`,
    body: {
      content: input.content,
      mediaUrls: input.mediaUrls ?? [],
    },
  });
}

export async function updateSocialPost(input: {
  businessId?: string;
  postId: string;
  content?: string;
  mediaUrls?: string[];
  status?: string;
  scheduledAt?: string;
}) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<SocialPost>({
    path: `/social/businesses/${encodeURIComponent(businessId)}/posts/${encodeURIComponent(input.postId)}`,
    body: {
      content: input.content,
      mediaUrls: input.mediaUrls,
      status: input.status,
      scheduledAt: input.scheduledAt,
    },
    init: { method: "PATCH" },
  });
}

export async function deleteSocialPost(input: { businessId?: string; postId: string }) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<{ success: boolean; id: string }>({
    path: `/social/businesses/${encodeURIComponent(businessId)}/posts/${encodeURIComponent(input.postId)}`,
    body: {},
    init: { method: "DELETE" },
  });
}

export async function fetchSocialConnections(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(
    `/social/businesses/${encodeURIComponent(businessId)}/connections`,
    z.array(socialConnectionSchema),
    [],
  );
}

export async function createSocialConnection(input: {
  businessId?: string;
  platform: string;
  platformId?: string;
  token: string;
}) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<SocialConnection>({
    path: `/social/businesses/${encodeURIComponent(businessId)}/connections`,
    body: {
      platform: input.platform,
      platformId: input.platformId,
      token: input.token,
    },
  });
}

export async function deleteSocialConnection(input: { businessId?: string; connectionId: string }) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<{ success: boolean; id: string }>({
    path: `/social/businesses/${encodeURIComponent(businessId)}/connections/${encodeURIComponent(input.connectionId)}`,
    body: {},
    init: { method: "DELETE" },
  });
}

export async function fetchProjects(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(`/projects/businesses/${encodeURIComponent(businessId)}`, z.array(projectSchema), []);
}

export async function createProject(input: { businessId?: string; name: string }) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<Project>({
    path: `/projects/businesses/${encodeURIComponent(businessId)}`,
    body: { name: input.name },
  });
}

export async function updateProject(input: { projectId: string; name?: string; status?: string }) {
  return apiPost<Project>({
    path: `/projects/${encodeURIComponent(input.projectId)}`,
    body: { name: input.name, status: input.status },
    init: { method: "PATCH" },
  });
}

export async function deleteProject(projectId: string) {
  return apiPost<{ success: boolean; id: string }>({
    path: `/projects/${encodeURIComponent(projectId)}`,
    body: {},
    init: { method: "DELETE" },
  });
}

export async function createProjectTask(input: {
  projectId: string;
  title: string;
  dueDate?: string;
}) {
  return apiPost<ProjectTask>({
    path: `/projects/${encodeURIComponent(input.projectId)}/tasks`,
    body: { title: input.title, dueDate: input.dueDate },
  });
}

export async function updateProjectTask(input: {
  taskId: string;
  title?: string;
  dueDate?: string;
  isCompleted?: boolean;
}) {
  return apiPost<ProjectTask>({
    path: `/projects/tasks/${encodeURIComponent(input.taskId)}`,
    body: {
      title: input.title,
      dueDate: input.dueDate,
      isCompleted: input.isCompleted,
    },
    init: { method: "PATCH" },
  });
}

export async function deleteProjectTask(taskId: string) {
  return apiPost<{ success: boolean; id: string }>({
    path: `/projects/tasks/${encodeURIComponent(taskId)}`,
    body: {},
    init: { method: "DELETE" },
  });
}

export async function fetchProjectTemplates(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(
    `/projects/businesses/${encodeURIComponent(businessId)}/templates`,
    z.array(projectTemplateSchema),
    [],
  );
}

export async function createProjectTemplate(input: { businessId?: string; name: string; taskTitles: string[] }) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<ProjectTemplate>({
    path: `/projects/businesses/${encodeURIComponent(businessId)}/templates`,
    body: { name: input.name, taskTitles: input.taskTitles },
  });
}

export async function createProjectFromTemplate(input: {
  businessId?: string;
  templateId: string;
  name?: string;
}) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<Project>({
    path: `/projects/businesses/${encodeURIComponent(businessId)}/templates/${encodeURIComponent(input.templateId)}/instantiate`,
    body: { name: input.name },
  });
}

export async function fetchReportSummary(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(
    `/reports/businesses/${encodeURIComponent(businessId)}/summary`,
    reportSummarySchema,
    {
      totalContacts: 0,
      totalBookings: 0,
      totalInvoices: 0,
      totalRevenue: 0,
      outstandingBalance: 0,
      overdueTasks: 0,
      upcomingBookings: 0,
    },
  );
}

export async function fetchSite(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(`/site/businesses/${encodeURIComponent(businessId)}`, siteSchema, null);
}

export async function upsertSite(input: { businessId?: string; subdomain: string; siteData?: Record<string, unknown> }) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<Site>({
    path: `/site/businesses/${encodeURIComponent(businessId)}`,
    body: { subdomain: input.subdomain, siteData: input.siteData ?? {} },
  });
}

export async function fetchSiteBySubdomain(subdomain: string) {
  return apiGet(`/site/subdomain/${encodeURIComponent(subdomain)}`, siteSchema, null);
}

export async function fetchBusinesses() {
  return apiGet(`/identity/businesses`, z.array(membershipSchema), []);
}

export async function createBusiness(input: { name: string }) {
  return apiPost<{ id: string; name: string }>({
    path: `/identity/businesses`,
    body: { name: input.name },
  });
}

export async function fetchTeam(businessId: string) {
  return apiGet(`/identity/businesses/${encodeURIComponent(businessId)}/team`, z.array(membershipSchema), []);
}

export async function inviteTeamMember(input: { businessId: string; email: string; role: string }) {
  return apiPost<Membership>({
    path: `/identity/businesses/${encodeURIComponent(input.businessId)}/team/invite`,
    body: { email: input.email, role: input.role },
  });
}

export async function deleteTeamMember(input: { businessId: string; membershipId: string }) {
  return apiPost<{ success: boolean; id: string }>({
    path: `/identity/businesses/${encodeURIComponent(input.businessId)}/team/${encodeURIComponent(input.membershipId)}`,
    body: {},
    init: { method: "DELETE" },
  });
}

export async function fetchDueTasks(
  businessId: string = DEFAULT_BUSINESS_ID,
  windowDays = 7,
): Promise<ApiResult<ContactTask[]>> {
  const params = new URLSearchParams({ windowDays: String(windowDays) });
  return apiGet(
    `/crm/businesses/${encodeURIComponent(businessId)}/tasks/due?${params.toString()}`,
    z.array(taskSchema),
    [],
  );
}

export async function fetchImportJobs(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(`/crm/businesses/${encodeURIComponent(businessId)}/imports`, z.array(contactImportSchema), []);
}

export async function importContactsFromFile(input: {
  businessId?: string;
  type: 'csv' | 'xlsx' | 'pdf' | 'image';
  file: File;
}) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  const params = new URLSearchParams({ type: input.type });
  const url = `${API_BASE}/crm/businesses/${encodeURIComponent(businessId)}/import/file?${params.toString()}`;
  const formData = new FormData();
  formData.append('file', input.file);
  const headers = getAuthHeaders();
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: formData,
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok || !payload || typeof payload !== 'object') {
    const message =
      (payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
        ? payload.message
        : res.statusText) || 'Import failed';
    throw new Error(message);
  }
  return contactImportSchema.parse(payload);
}

export async function importContactsFromLink(url: string, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiPost<ContactImportJob>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/import/link`,
    body: { url },
  });
}

export async function createContactFromOcr(params: {
  businessId?: string;
  ocrText: string;
  url?: string;
  type?: string;
}) {
  const businessId = params.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<ContactImportOcrResponse>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/import/image/ocr`,
    body: {
      ocrText: params.ocrText,
      url: params.url,
      type: params.type,
    },
  });
}

export async function completeContactTask(taskId: string, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiPost<ContactTask>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/tasks/${encodeURIComponent(taskId)}/complete`,
    body: {},
  });
}

export async function mergeContacts(input: { businessId?: string; contactId: string; duplicateId: string }) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<Contact>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/contacts/${encodeURIComponent(input.contactId)}/merge/${encodeURIComponent(input.duplicateId)}`,
    body: {},
  });
}

export async function updateContact(input: {
  businessId?: string;
  contactId: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  status?: string;
  source?: string;
  tags?: string[];
  custom?: Record<string, unknown>;
  displayName?: string;
  companyName?: string;
  jobTitle?: string;
  lifecycleStage?: string;
  segment?: string;
  notesInternal?: string;
}) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<Contact>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/contacts/${encodeURIComponent(input.contactId)}`,
    body: input,
  });
}

export async function deleteContact(contactId: string, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiPost<Contact>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/contacts/${encodeURIComponent(contactId)}/delete`,
    body: {},
  });
}

export async function createProduct(input: { businessId?: string; name: string; price: number; currency?: string }) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  const body = { name: input.name, price: input.price, currency: input.currency ?? "TTD" };

  const res = await apiPost<Product>({
    path: `/commerce/businesses/${encodeURIComponent(businessId)}/products`,
    body,
  });

  if (res.data) return res;

  const synthesized: Product = {
    id: `pd_${Date.now()}`,
    name: input.name,
    price: input.price,
    currency: input.currency ?? "TTD",
  };
  return { data: synthesized, error: res.error };
}

export async function createBooking(input: {
  businessId?: string;
  contactId?: string;
  serviceId: string;
  staffId: string;
  startTime: string;
  endTime: string;
}) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  const res = await apiPost<Booking>({
    path: `/bookings/businesses/${encodeURIComponent(businessId)}`,
    body: {
      contactId: input.contactId ?? undefined,
      serviceId: input.serviceId,
      staffId: input.staffId,
      startTime: input.startTime,
      endTime: input.endTime,
    },
  });

  if (res.data) return res;

  const synthesized: Booking = {
    id: `bk_${Date.now()}`,
    startTime: input.startTime,
    endTime: input.endTime,
    status: "PENDING",
  };
  return { data: synthesized, error: res.error };
}

export async function markInvoicePaid(invoiceId: string) {
  return apiPost<Invoice>({
    path: `/commerce/invoices/${encodeURIComponent(invoiceId)}/paid`,
    body: {},
  });
}

export async function markInvoicePaidPublic(invoiceId: string) {
  return apiPost<Invoice>({
    path: `/commerce/public/invoices/${encodeURIComponent(invoiceId)}/paid`,
    body: {},
  });
}

export type BootstrapIdentityResponse = {
  user: { id: string; email: string; name?: string | null; role: string };
  business: { id: string; name: string };
};

export async function bootstrapIdentity(input: { username?: string; email?: string; name?: string }) {
  return apiPost<BootstrapIdentityResponse>({
    path: `/identity/bootstrap`,
    body: input,
  });
}

export { DEFAULT_BUSINESS_ID };
