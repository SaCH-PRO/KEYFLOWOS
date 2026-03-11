import { z } from "zod";
import { API_BASE, apiPost, apiPatch, apiDelete, apiGet as apiGetSimple, getAuthHeaders } from "./api";

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
  totalRevenue: z.number().optional(),
  invoiceCount: z.number().optional(),
  bookingCount: z.number().optional(),
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
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
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
  source: z.string().nullable().optional(),
  createdAt: z.string(),
  contact: contactSchema.optional(),
});

const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  price: z.coerce.number(),
  currency: z.string().default("TTD"),
  category: z.string().default("SERVICE"),
  duration: z.coerce.number().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  sku: z.string().nullable().optional(),
  isActive: z.preprocess((v) => v === undefined ? true : v, z.boolean().default(true)),
}).passthrough();

const bookingSchema = z.object({
  id: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  status: z.string(),
  contactId: z.string().nullable().optional(),
  serviceId: z.string().nullable().optional(),
  staffId: z.string().nullable().optional(),
  calendarEventId: z.string().nullable().optional(),
  contact: z.object({
    id: z.string(),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
  }).nullable().optional(),
  service: z.object({
    id: z.string(),
    name: z.string(),
    duration: z.number(),
    price: z.number(),
  }).nullable().optional(),
  staff: z.object({
    id: z.string(),
    name: z.string(),
  }).nullable().optional(),
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
const contactImportSchema = z.object({
  id: z.string(),
  businessId: z.string(),
  sourceType: z.enum(["csv", "xlsx", "pdf", "image", "link", "vcf"]),
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
export type InvoiceItem = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  productId?: string | null;
};

export type PaymentRecord = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  provider: string;
  providerPaymentId: string;
  createdAt: string;
  businessId: string;
  invoiceId: string;
};

export type Invoice = {
  id: string;
  invoiceNumber?: string | null;
  status: string;
  subtotal?: number;
  taxRate?: number | null;
  taxAmount?: number | null;
  discountType?: "PERCENT" | "FIXED" | null;
  discountValue?: number | null;
  discountAmount?: number | null;
  total: number | string;
  currency: string;
  notes?: string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  paidAt?: string | null;
  contactId?: string | null;
  contact?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
  items?: InvoiceItem[];
  payments?: PaymentRecord[];
};

type ApiResult<T> = { data: T | null; error: string | null };

const fallbackContacts: Contact[] = [];

const fallbackBookings: Booking[] = [
  { id: "bk_1", startTime: new Date().toISOString(), endTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(), status: "CONFIRMED" },
  { id: "bk_2", startTime: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), endTime: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(), status: "PENDING" },
];

const fallbackProducts: Product[] = [
  { id: "pd_1", name: "Consultation", price: 850, currency: "TTD", category: "SERVICE", isActive: true },
  { id: "pd_2", name: "Follow-up Session", price: 600, currency: "TTD", category: "SERVICE", isActive: true },
  { id: "pd_3", name: "Wellness Package", price: 1200, currency: "TTD", category: "PACKAGE", isActive: true },
];

const fallbackInvoices: Invoice[] = [
  { id: "inv_1", invoiceNumber: "INV-001", status: "PAID", total: 850, currency: "TTD", contact: { firstName: "Sarah", email: "sarah@example.com" } },
  { id: "inv_2", invoiceNumber: "INV-002", status: "SENT", total: 600, currency: "TTD", contact: { firstName: "John", email: "john@example.com" } },
];

async function apiGet<T>(path: string, schema?: z.ZodSchema<T>, fallback?: T, opts?: { signal?: AbortSignal }): Promise<ApiResult<T>> {
  try {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${API_BASE}${path}${sep}_t=${Date.now()}`;
    const res = await fetch(url, { headers: getAuthHeaders(), cache: "no-store", signal: opts?.signal });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) {
      let message: string = res.statusText;
      if (typeof json === "object" && json && "message" in json && typeof (json as Record<string, unknown>).message === "string") {
        message = (json as Record<string, string>).message;
      }
      console.warn(`[apiGet] ${path} failed:`, message);
      return { data: fallback ?? null, error: message };
    }
    if (!schema) {
      return { data: json as T, error: null };
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      console.error(`[apiGet] ${path} schema validation failed:`, parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', '));
      return { data: (json as T) ?? fallback ?? null, error: null };
    }
    return { data: parsed.data, error: null };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Network error";
    console.warn(`[apiGet] ${path} error:`, message);
    return { data: fallback ?? null, error: message };
  }
}

const contactListResponseSchema = z.object({
  contacts: z.array(contactSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export type ContactListResponse = z.infer<typeof contactListResponseSchema>;

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
    cursor?: string;
    includeStats?: boolean;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    signal?: AbortSignal;
  },
): Promise<{ data: ContactListResponse | null; error: string | null }> {
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
  if (opts?.cursor) params.set("cursor", opts.cursor);
  if (opts?.includeStats) params.set("includeStats", "true");
  if (opts?.sortBy) params.set("sortBy", opts.sortBy);
  if (opts?.sortOrder) params.set("sortOrder", opts.sortOrder);
  const result = await apiGet(
    `/crm/businesses/${encodeURIComponent(businessId)}/contacts${params.toString() ? `?${params.toString()}` : ""}`,
    contactListResponseSchema,
    { contacts: [], nextCursor: null, hasMore: false },
    { signal: opts?.signal },
  );
  if (result.data && Array.isArray(result.data)) {
    const arr = result.data as unknown as Contact[];
    return { data: { contacts: arr, nextCursor: null, hasMore: false }, error: result.error };
  }
  return result;
}

const contactsPollSchema = z.object({
  lastUpdatedAt: z.string().nullable(),
  totalCount: z.number(),
});

export async function fetchContactsPoll(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(
    `/crm/businesses/${encodeURIComponent(businessId)}/contacts/poll`,
    contactsPollSchema,
    null,
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

const aiNextActionSchema = z.object({
  type: z.enum(["follow_up", "send_quote", "payment_reminder", "add_note"]),
  contactId: z.string(),
  contactName: z.string(),
  reason: z.string(),
  priority: z.enum(["high", "medium", "low"]),
});

export type AiNextAction = z.infer<typeof aiNextActionSchema>;

const flowHighlightsSchema = z.object({
  highlights: z.object({
    highPotential: z.array(highlightContactSchema),
    overdueReminders: z.array(highlightContactSchema),
    serviceAffinity: z.array(serviceAffinitySchema),
  }),
  segments: z.array(segmentInsightSchema),
  timeline: z.array(timelineEntrySchema),
  nextActions: z.array(nextActionSchema),
  aiNextActions: z.array(aiNextActionSchema),
});

export type FlowHighlights = z.infer<typeof flowHighlightsSchema>;

export async function fetchContactDetail(contactId: string, businessId: string = DEFAULT_BUSINESS_ID, opts?: { signal?: AbortSignal }) {
  return apiGet(
    `/crm/businesses/${encodeURIComponent(businessId)}/contacts/${encodeURIComponent(contactId)}`,
    contactDetailSchema,
    null,
    { signal: opts?.signal },
  );
}

export async function fetchBookings(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(
    `/bookings/businesses/${encodeURIComponent(businessId)}`,
    z.array(bookingSchema),
    fallbackBookings,
  );
}

export async function fetchProducts(businessId: string = DEFAULT_BUSINESS_ID) {
  const envelopeSchema = z.object({
    data: z.array(productSchema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    totalPages: z.number(),
  });
  const res = await apiGet(
    `/commerce/businesses/${encodeURIComponent(businessId)}/products`,
    envelopeSchema,
  );
  return { data: res.data?.data ?? null, error: res.error };
}

export async function fetchInvoices(businessId: string = DEFAULT_BUSINESS_ID) {
  const invoiceItemSchema = z.object({
    id: z.string(),
    description: z.string(),
    quantity: z.number(),
    unitPrice: z.number(),
    total: z.number(),
    productId: z.string().nullable().optional(),
  });
  const invoiceSchema = z.object({
    id: z.string(),
    invoiceNumber: z.string().nullable().optional(),
    status: z.string(),
    total: z.union([z.number(), z.string()]),
    currency: z.string(),
    issueDate: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    paidAt: z.string().nullable().optional(),
    contact: z
      .object({
        firstName: z.string().nullable().optional(),
        lastName: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
    items: z.array(invoiceItemSchema).optional(),
  });
  const envelopeSchema = z.object({
    data: z.array(invoiceSchema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    totalPages: z.number(),
  });
  const res = await apiGet(
    `/commerce/businesses/${encodeURIComponent(businessId)}/invoices`,
    envelopeSchema,
  );
  return { data: res.data?.data ?? fallbackInvoices, error: res.error };
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
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  department?: string;
  industry?: string;
  secondaryEmail?: string;
  secondaryPhone?: string;
  whatsappNumber?: string;
  language?: string;
  timezone?: string;
  marketingOptIn?: boolean;
  doNotContact?: boolean;
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
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    country: input.country,
    department: input.department,
    industry: input.industry,
    secondaryEmail: input.secondaryEmail,
    secondaryPhone: input.secondaryPhone,
    whatsappNumber: input.whatsappNumber,
    language: input.language,
    timezone: input.timezone,
    marketingOptIn: input.marketingOptIn,
    doNotContact: input.doNotContact,
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

export async function logContactEvent(
  contactId: string,
  event: { type: string; description?: string; data?: Record<string, unknown> },
  businessId: string = DEFAULT_BUSINESS_ID,
) {
  return apiPost<ContactEvent>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/contacts/${encodeURIComponent(contactId)}/events`,
    body: event,
  });
}

export async function logCommunication(
  contactId: string,
  input: {
    channelType: string;
    outcome: string;
    duration?: number;
    notes?: string;
  },
  businessId: string = DEFAULT_BUSINESS_ID,
) {
  return apiPost<{ event: ContactEvent; note: ContactNote | null }>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/contacts/${encodeURIComponent(contactId)}/log-communication`,
    body: input,
  });
}

export async function addContactNote(contactId: string, body: string, businessId: string = DEFAULT_BUSINESS_ID, source?: string) {
  return apiPost<ContactNote>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/contacts/${encodeURIComponent(contactId)}/notes`,
    body: { body, ...(source ? { source } : {}) },
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

export async function updateContactNote(noteId: string, data: { body?: string; source?: string }, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiPatch({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/notes/${encodeURIComponent(noteId)}`,
    body: data,
  });
}

export async function deleteContactNote(noteId: string, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiDelete(`/crm/businesses/${encodeURIComponent(businessId)}/notes/${encodeURIComponent(noteId)}`);
}

export async function updateContactTask(taskId: string, data: { title?: string; dueDate?: string; priority?: string; remindAt?: string }, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiPatch({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/tasks/${encodeURIComponent(taskId)}`,
    body: data,
  });
}

export async function deleteContactTask(taskId: string, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiDelete(`/crm/businesses/${encodeURIComponent(businessId)}/tasks/${encodeURIComponent(taskId)}`);
}

export async function toggleFavorite(contactId: string, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiPost<{ isFavorite: boolean; contact: Contact }>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/contacts/${encodeURIComponent(contactId)}/favorite`,
    body: {},
  });
}

export async function fetchFavorites(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(
    `/crm/businesses/${encodeURIComponent(businessId)}/contacts/favorites`,
    z.array(contactSchema),
    [],
  );
}

export async function approveAutopilotAction(actionId: string, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiPost({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/autopilot-actions/${encodeURIComponent(actionId)}/approve`,
    body: {},
  });
}

export async function denyAutopilotAction(actionId: string, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiPost({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/autopilot-actions/${encodeURIComponent(actionId)}/deny`,
    body: {},
  });
}

const contactStatsSchema = z.object({
  totalCount: z.number(),
  countByStatus: z.record(z.string(), z.number()),
  countBySource: z.array(z.object({ source: z.string(), count: z.number() })),
  recentGrowth: z.array(z.object({ week: z.string(), count: z.number() })),
  topTags: z.array(z.object({ tag: z.string(), count: z.number() })),
});
export type ContactStats = z.infer<typeof contactStatsSchema>;

export async function fetchContactStats(businessId: string = DEFAULT_BUSINESS_ID, opts?: { signal?: AbortSignal }) {
  return apiGet(
    `/crm/businesses/${encodeURIComponent(businessId)}/contact-stats`,
    contactStatsSchema,
    { totalCount: 0, countByStatus: {}, countBySource: [], recentGrowth: [], topTags: [] },
    { signal: opts?.signal },
  );
}

export async function fetchSegmentSummary(businessId: string = DEFAULT_BUSINESS_ID, opts?: { signal?: AbortSignal }) {
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
    { signal: opts?.signal },
  );
}

export async function fetchDuplicateContacts(businessId: string = DEFAULT_BUSINESS_ID) {
  const duplicateGroupSchema = z.object({
    field: z.enum(["email", "phone", "name"]),
    value: z.string(),
    contacts: z.array(contactSchema),
  });
  const duplicatesSchema = z.object({
    groups: z.array(duplicateGroupSchema),
  });
  return apiGet(
    `/crm/businesses/${encodeURIComponent(businessId)}/duplicates`,
    duplicatesSchema,
    { groups: [] },
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

export async function bulkUpdateContacts(input: {
  businessId?: string;
  contactIds: string[];
  status?: string;
  addTags?: string[];
}) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPatch<{ updated: number }>(
    `/crm/businesses/${encodeURIComponent(businessId)}/contacts/bulk`,
    { contactIds: input.contactIds, status: input.status, addTags: input.addTags },
  );
}

export async function bulkDeleteContacts(input: {
  businessId?: string;
  contactIds: string[];
}) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiDelete<{ deleted: number }>(
    `/crm/businesses/${encodeURIComponent(businessId)}/contacts/bulk`,
    { contactIds: input.contactIds },
  );
}

export async function checkImportDuplicates(
  businessId: string = DEFAULT_BUSINESS_ID,
  contacts: Array<{ email?: string; phone?: string; firstName?: string; lastName?: string }>,
) {
  return apiPost<{
    total: number;
    newCount: number;
    duplicateCount: number;
    duplicates: Array<{
      importIndex: number;
      importContact: { email?: string; phone?: string; firstName?: string; lastName?: string };
      existingContact: { id: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null };
      matchField: 'email' | 'phone';
    }>;
  }>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/contacts/check-duplicates`,
    body: { contacts },
  });
}

export async function fetchImportJobs(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(`/crm/businesses/${encodeURIComponent(businessId)}/imports`, z.array(contactImportSchema), []);
}

export async function importContactsFromFile(input: {
  businessId?: string;
  type: 'csv' | 'xlsx' | 'pdf' | 'image' | 'vcf';
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

export async function getGoogleContactsAuthUrl(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(`/crm/businesses/${encodeURIComponent(businessId)}/google/auth-url`, z.object({ url: z.string() }));
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

export async function scanContactImage(imageFile: File, businessId: string = DEFAULT_BUSINESS_ID) {
  const url = `${API_BASE}/crm/businesses/${encodeURIComponent(businessId)}/import/scan`;
  const formData = new FormData();
  formData.append('image', imageFile);
  const headers = getAuthHeaders();
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: formData,
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok || !payload) {
    const message = payload?.message || res.statusText || 'Scan failed';
    throw new Error(message);
  }
  return payload;
}

export async function completeContactTask(taskId: string, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiPost<ContactTask>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/tasks/${encodeURIComponent(taskId)}/complete`,
    body: {},
  });
}

export async function reopenContactTask(taskId: string, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiPost<ContactTask>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/tasks/${encodeURIComponent(taskId)}/reopen`,
    body: {},
  });
}

export async function mergeContacts(input: { businessId?: string; contactId: string; duplicateId: string; fieldOverrides?: Record<string, unknown> }) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<Contact>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/contacts/${encodeURIComponent(input.contactId)}/merge/${encodeURIComponent(input.duplicateId)}`,
    body: { fieldOverrides: input.fieldOverrides },
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
  preferredChannel?: string;
  lifecycleStage?: string;
  segment?: string;
  notesInternal?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  department?: string;
  industry?: string;
  secondaryEmail?: string;
  secondaryPhone?: string;
  whatsappNumber?: string;
  language?: string;
  timezone?: string;
  marketingOptIn?: boolean;
  doNotContact?: boolean;
}) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPatch<Contact>(
    `/crm/businesses/${encodeURIComponent(businessId)}/contacts/${encodeURIComponent(input.contactId)}`,
    input,
  );
}

export async function deleteContact(contactId: string, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiDelete<Contact>(
    `/crm/businesses/${encodeURIComponent(businessId)}/contacts/${encodeURIComponent(contactId)}`,
  );
}

export async function createProduct(input: { 
  businessId?: string; 
  name: string; 
  price: number; 
  currency?: string; 
  description?: string;
  category?: string;
  duration?: number | null;
  imageUrl?: string | null;
  sku?: string | null;
  isActive?: boolean;
}) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  const body: Record<string, unknown> = { 
    name: input.name, 
    price: input.price, 
    currency: input.currency ?? "TTD", 
    description: input.description,
    category: input.category ?? "SERVICE",
    duration: input.duration,
    isActive: input.isActive ?? true,
  };
  if (input.imageUrl) body.imageUrl = input.imageUrl;
  if (input.sku) body.sku = input.sku;

  const res = await apiPost<Product>({
    path: `/commerce/businesses/${encodeURIComponent(businessId)}/products`,
    body,
  });

  if (res.data) return res;

  const synthesized: Product = {
    id: `pd_${Date.now()}`,
    name: input.name,
    description: input.description ?? null,
    price: input.price,
    currency: input.currency ?? "TTD",
    category: input.category ?? "SERVICE",
    duration: input.duration ?? null,
    imageUrl: input.imageUrl ?? null,
    sku: input.sku ?? null,
    isActive: input.isActive ?? true,
  };
  return { data: synthesized, error: res.error };
}

export async function updateProduct(input: { 
  businessId?: string; 
  productId: string; 
  name?: string; 
  price?: number; 
  currency?: string; 
  description?: string | null;
  category?: string;
  duration?: number | null;
  imageUrl?: string | null;
  sku?: string | null;
  isActive?: boolean;
}) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) body.name = input.name;
  if (input.price !== undefined) body.price = input.price;
  if (input.currency !== undefined) body.currency = input.currency;
  if (input.description !== undefined) body.description = input.description;
  if (input.category !== undefined) body.category = input.category;
  if (input.duration !== undefined) body.duration = input.duration;
  if (input.imageUrl !== undefined) body.imageUrl = input.imageUrl;
  if (input.sku !== undefined) body.sku = input.sku;
  if (input.isActive !== undefined) body.isActive = input.isActive;

  return apiPatch<Product>(
    `/commerce/businesses/${encodeURIComponent(businessId)}/products/${encodeURIComponent(input.productId)}`,
    body,
  );
}

export async function deleteProduct(productId: string, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiDelete(`/commerce/businesses/${encodeURIComponent(businessId)}/products/${encodeURIComponent(productId)}`);
}

export async function bulkUpdateProducts(businessId: string, ids: string[], action: 'activate' | 'deactivate' | 'delete') {
  return apiPatch<{ updated: number; action: string }>(
    `/commerce/businesses/${encodeURIComponent(businessId)}/products/bulk`,
    { ids, action },
  );
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

export async function recordInvoicePayment(businessId: string, invoiceId: string, input: {
  amount: number;
  method: string;
  reference?: string;
  notes?: string;
}): Promise<ApiResult<{ payment: PaymentRecord; invoice: Invoice; paidAmount: number; remaining: number }>> {
  return apiPost({
    path: `/commerce/businesses/${encodeURIComponent(businessId)}/invoices/${encodeURIComponent(invoiceId)}/payments`,
    body: input,
  });
}

export async function listInvoicePayments(businessId: string, invoiceId: string): Promise<ApiResult<{ payments: PaymentRecord[]; paidAmount: number; remaining: number; invoiceTotal: number }>> {
  return apiGet(`/commerce/businesses/${encodeURIComponent(businessId)}/invoices/${encodeURIComponent(invoiceId)}/payments`);
}

export async function createInvoice(input: {
  businessId?: string;
  contactId?: string;
  items: { description: string; quantity: number; unitPrice: number }[];
  currency?: string;
  dueDate?: string;
  taxRate?: number;
  discountType?: "PERCENT" | "FIXED";
  discountValue?: number;
  notes?: string;
}) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<Invoice>({
    path: `/commerce/businesses/${encodeURIComponent(businessId)}/invoices`,
    body: {
      contactId: input.contactId,
      items: input.items,
      currency: input.currency ?? "TTD",
      dueDate: input.dueDate,
      taxRate: input.taxRate,
      discountType: input.discountType,
      discountValue: input.discountValue,
      notes: input.notes,
    },
  });
}

export async function updateInvoiceStatus(invoiceId: string, status: "SENT" | "OVERDUE" | "VOID", options?: { dueDate?: string }) {
  return apiPost<Invoice>({
    path: `/commerce/invoices/${encodeURIComponent(invoiceId)}/status/${status.toLowerCase()}`,
    body: options ?? {},
  });
}

export async function deleteInvoice(businessId: string, invoiceId: string) {
  return apiDelete(`/commerce/businesses/${encodeURIComponent(businessId)}/invoices/${encodeURIComponent(invoiceId)}`);
}

export async function updateInvoice(input: {
  businessId?: string;
  invoiceId: string;
  contactId?: string;
  items?: { description: string; quantity: number; unitPrice: number; productId?: string }[];
  currency?: string;
  dueDate?: string | null;
  taxRate?: number;
  discountType?: "PERCENT" | "FIXED" | null;
  discountValue?: number | null;
  notes?: string | null;
}) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPatch<Invoice>(
    `/commerce/businesses/${encodeURIComponent(businessId)}/invoices/${encodeURIComponent(input.invoiceId)}`,
    {
      contactId: input.contactId,
      items: input.items,
      currency: input.currency,
      dueDate: input.dueDate,
      taxRate: input.taxRate,
      discountType: input.discountType,
      discountValue: input.discountValue,
      notes: input.notes,
    }
  );
}

// ========== QUOTES ==========

export type QuoteItem = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  productId?: string | null;
};

export type Quote = {
  id: string;
  quoteNumber: string;
  status: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED";
  subtotal?: number;
  taxRate?: number | null;
  taxAmount?: number | null;
  discountType?: "PERCENT" | "FIXED" | null;
  discountValue?: number | null;
  discountAmount?: number | null;
  total: number;
  currency: string;
  notes?: string | null;
  issueDate: string;
  expiryDate?: string | null;
  businessId: string;
  contactId: string;
  contact?: Contact | null;
  items: QuoteItem[];
  invoiceId?: string | null;
  invoice?: Invoice | null;
  createdAt: string;
};

export async function listQuotes(businessId?: string) {
  const bId = businessId ?? DEFAULT_BUSINESS_ID;
  const res = await apiGetSimple<{ data: Quote[]; total: number; page: number; pageSize: number; totalPages: number }>(`/commerce/businesses/${encodeURIComponent(bId)}/quotes`);
  return { data: res.data?.data ?? [], error: res.error };
}

export async function getQuote(quoteId: string) {
  return apiGetSimple<Quote>(`/commerce/quotes/${encodeURIComponent(quoteId)}`);
}

export async function createQuote(input: {
  businessId?: string;
  contactId: string;
  items: { description: string; quantity: number; unitPrice: number; productId?: string }[];
  currency?: string;
  expiryDate?: string;
  taxRate?: number;
  discountType?: "PERCENT" | "FIXED";
  discountValue?: number;
  notes?: string;
}) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<Quote>({
    path: `/commerce/businesses/${encodeURIComponent(businessId)}/quotes`,
    body: {
      contactId: input.contactId,
      items: input.items,
      currency: input.currency ?? "TTD",
      expiryDate: input.expiryDate,
      taxRate: input.taxRate,
      discountType: input.discountType,
      discountValue: input.discountValue,
      notes: input.notes,
    },
  });
}

export async function updateQuote(input: {
  businessId?: string;
  quoteId: string;
  contactId?: string;
  items?: { description: string; quantity: number; unitPrice: number; productId?: string }[];
  currency?: string;
  expiryDate?: string | null;
  taxRate?: number;
  discountType?: "PERCENT" | "FIXED";
  discountValue?: number;
  notes?: string;
}) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPatch<Quote>(
    `/commerce/businesses/${encodeURIComponent(businessId)}/quotes/${encodeURIComponent(input.quoteId)}`,
    {
      contactId: input.contactId,
      items: input.items,
      currency: input.currency,
      expiryDate: input.expiryDate,
      taxRate: input.taxRate,
      discountType: input.discountType,
      discountValue: input.discountValue,
      notes: input.notes,
    }
  );
}

export async function updateQuoteStatus(quoteId: string, status: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED") {
  return apiPatch<Quote>(
    `/commerce/quotes/${encodeURIComponent(quoteId)}/status/${status.toLowerCase()}`,
    {},
  );
}

export async function deleteQuote(businessId: string, quoteId: string) {
  return apiDelete(`/commerce/businesses/${encodeURIComponent(businessId)}/quotes/${encodeURIComponent(quoteId)}`);
}

export async function convertQuoteToInvoice(input: {
  businessId?: string;
  quoteId: string;
  taxRate?: number;
  discountType?: "PERCENT" | "FIXED";
  discountValue?: number;
  notes?: string;
  dueDate?: string;
}) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<Invoice>({
    path: `/commerce/businesses/${encodeURIComponent(businessId)}/quotes/${encodeURIComponent(input.quoteId)}/convert`,
    body: {
      taxRate: input.taxRate,
      discountType: input.discountType,
      discountValue: input.discountValue,
      notes: input.notes,
      dueDate: input.dueDate,
    },
  });
}

export async function getGmailAuthUrl(businessId?: string) {
  const biz = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGetSimple<{ url: string }>(`/commerce/businesses/${encodeURIComponent(biz)}/gmail/auth-url`);
}

export async function getGmailStatus(businessId?: string) {
  const biz = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGetSimple<{ connected: boolean; email: string | null }>(`/commerce/businesses/${encodeURIComponent(biz)}/gmail/status`);
}

export async function disconnectGmail(businessId?: string) {
  const biz = businessId ?? DEFAULT_BUSINESS_ID;
  return apiDelete(`/commerce/businesses/${encodeURIComponent(biz)}/gmail`);
}

export async function sendQuoteEmail(input: {
  businessId?: string;
  quoteId: string;
  recipientEmail: string;
  message?: string;
}) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<{ success: boolean }>({
    path: `/commerce/businesses/${encodeURIComponent(businessId)}/quotes/${encodeURIComponent(input.quoteId)}/send-email`,
    body: {
      recipientEmail: input.recipientEmail,
      message: input.message,
    },
  });
}

export type BootstrapIdentityResponse = {
  user: { id: string; email: string; name?: string | null; firstName?: string | null; lastName?: string | null; phone?: string | null; avatarUrl?: string | null; role: string };
  business: { id: string; name: string; onboardingComplete?: boolean };
};

export async function bootstrapIdentity(input: {
  username?: string;
  email?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  avatarUrl?: string;
  company?: string;
}) {
  return apiPost<BootstrapIdentityResponse>({
    path: `/identity/bootstrap`,
    body: input,
  });
}

export async function fetchMe() {
  return apiGetSimple<{ id: string; email: string; name?: string | null; firstName?: string | null; lastName?: string | null; phone?: string | null; avatarUrl?: string | null; role: string }>(`/identity/me`);
}

export type Business = {
  id: string;
  name: string;
  slug?: string | null;
  timezone?: string;
  currency?: string;
  logoUrl?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  complianceStatus?: string | null;
  complianceData?: Record<string, boolean> | null;
  lastHealthCheck?: string | null;
  onboardingComplete?: boolean;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  tagline?: string | null;
  description?: string | null;
  city?: string | null;
  country?: string | null;
};

export async function getBusinessById(businessId: string) {
  const businessSchema = z.object({
    id: z.string(),
    name: z.string().optional(),
    slug: z.string().nullable().optional(),
    logoUrl: z.string().nullable().optional(),
    tagline: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    website: z.string().nullable().optional(),
    primaryColor: z.string().nullable().optional(),
    secondaryColor: z.string().nullable().optional(),
    complianceStatus: z.string().nullable().optional(),
    complianceData: z.record(z.boolean()).nullable().optional(),
    lastHealthCheck: z.string().nullable().optional(),
  });
  return apiGet(
    `/identity/businesses/${encodeURIComponent(businessId)}`,
    businessSchema,
  );
}

export async function updateBusiness(input: { businessId: string; metaData?: Record<string, unknown>; [key: string]: unknown }) {
  const { businessId, ...data } = input;
  return apiPatch<{ id: string }>(
    `/identity/businesses/${encodeURIComponent(businessId)}`,
    data,
  );
}

export type Service = {
  id: string;
  name: string;
  durationMins?: number;
  duration?: number;
  price: number;
  currency?: string;
  description?: string | null;
};

export type StaffMember = {
  id: string;
  name: string;
  email?: string | null;
};

export type SocialPost = {
  id: string;
  content: string;
  status: string;
  scheduledAt?: string | null;
  postedAt?: string | null;
  scheduledFor?: string | null;
  publishedAt?: string | null;
  channelIds?: string[];
  mediaUrls?: string[];
  publishResults?: Record<string, unknown>[] | null;
  createdAt: string;
};

export type SocialConnection = {
  id: string;
  platform: string;
  platformId?: string | null;
  accountName?: string | null;
  profilePicture?: string | null;
  status: string;
  scopes?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Playbook = {
  id: string;
  name: string;
  triggerEvent: string;
  actions?: unknown;
  enabled: boolean;
  createdAt: string;
};

export async function fetchServices(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(
    `/bookings/businesses/${encodeURIComponent(businessId)}/services`,
    z.array(z.object({
      id: z.string(),
      name: z.string(),
      durationMins: z.number().optional(),
      duration: z.number().optional(),
      price: z.number(),
      currency: z.string().optional(),
      description: z.string().nullable().optional(),
    })),
    [],
  );
}

export async function createService(input: { businessId?: string; name: string; durationMins: number; price: number; description?: string; currency?: string }) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<Service>({
    path: `/bookings/businesses/${encodeURIComponent(businessId)}/services`,
    body: { name: input.name, duration: input.durationMins, price: input.price, description: input.description, currency: input.currency ?? "TTD" },
  });
}

export async function updateService(serviceId: string, data: { name?: string; duration?: number; price?: number; description?: string }, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiPatch<Service>(
    `/bookings/businesses/${encodeURIComponent(businessId)}/services/${encodeURIComponent(serviceId)}`,
    data,
  );
}

export async function deleteService(serviceId: string, businessId: string = DEFAULT_BUSINESS_ID) {
  try {
    const res = await fetch(`${API_BASE}/bookings/businesses/${encodeURIComponent(businessId)}/services/${encodeURIComponent(serviceId)}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
    if (!res.ok) return { error: res.statusText };
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Network error" };
  }
}

export async function fetchStaff(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(
    `/bookings/businesses/${encodeURIComponent(businessId)}/staff`,
    z.array(z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().nullable().optional(),
    })),
    [],
  );
}

export async function createStaff(input: { businessId?: string; name: string; email?: string }) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<StaffMember>({
    path: `/bookings/businesses/${encodeURIComponent(businessId)}/staff`,
    body: { name: input.name, email: input.email },
  });
}

export async function deleteStaff(staffId: string, businessId: string = DEFAULT_BUSINESS_ID) {
  try {
    const res = await fetch(`${API_BASE}/bookings/businesses/${encodeURIComponent(businessId)}/staff/${encodeURIComponent(staffId)}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
    if (!res.ok) return { error: res.statusText };
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Network error" };
  }
}

export async function fetchPosts(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(
    `/social/businesses/${encodeURIComponent(businessId)}/posts`,
    z.array(z.object({
      id: z.string(),
      content: z.string(),
      status: z.string(),
      scheduledAt: z.string().nullable().optional(),
      postedAt: z.string().nullable().optional(),
      scheduledFor: z.string().nullable().optional(),
      publishedAt: z.string().nullable().optional(),
      channelIds: z.array(z.string()).optional(),
      publishResults: z.array(z.record(z.unknown())).nullable().optional(),
      createdAt: z.string(),
    })),
    [],
  );
}

export async function createPost(input: { businessId?: string; content: string; mediaUrls?: string[]; scheduledFor?: string; channelIds?: string[] }) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<SocialPost>({
    path: `/social/businesses/${encodeURIComponent(businessId)}/posts`,
    body: { content: input.content, mediaUrls: input.mediaUrls, scheduledFor: input.scheduledFor, channelIds: input.channelIds },
  });
}

export async function updatePost(postId: string, data: { content?: string; scheduledAt?: string | null; channelIds?: string[]; mediaUrls?: string[] }, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiPatch<SocialPost>(
    `/social/businesses/${encodeURIComponent(businessId)}/posts/${encodeURIComponent(postId)}`,
    data,
  );
}

export async function deletePost(postId: string, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiDelete<SocialPost>(
    `/social/businesses/${encodeURIComponent(businessId)}/posts/${encodeURIComponent(postId)}`,
  );
}

export async function publishPost(postId: string, channelIds?: string[], businessId: string = DEFAULT_BUSINESS_ID) {
  return apiPost<SocialPost>({
    path: `/social/businesses/${encodeURIComponent(businessId)}/posts/${encodeURIComponent(postId)}/publish`,
    body: { channelIds },
  });
}

export async function fetchSocialConnections(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(
    `/social/businesses/${encodeURIComponent(businessId)}/connections`,
    z.array(z.object({
      id: z.string(),
      platform: z.string(),
      platformId: z.string().nullable().optional(),
      accountName: z.string().nullable().optional(),
      profilePicture: z.string().nullable().optional(),
      status: z.string(),
      scopes: z.string().nullable().optional(),
      expiresAt: z.string().nullable().optional(),
      createdAt: z.string(),
      updatedAt: z.string(),
    })),
    [],
  );
}

export async function startSocialOAuth(platform: string, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiPost<{ authUrl: string; redirectUri: string; state?: string }>({
    path: `/social/businesses/${encodeURIComponent(businessId)}/connections/${encodeURIComponent(platform)}/oauth/start`,
    body: {},
  });
}

export async function completeSocialOAuth(platform: string, code: string, state?: string, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiPost<{ success: boolean; error?: string; connection?: SocialConnection }>({
    path: `/social/businesses/${encodeURIComponent(businessId)}/connections/${encodeURIComponent(platform)}/oauth/callback`,
    body: { code, state },
  });
}

export async function fetchOAuthAvailability(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGetSimple<Record<string, boolean>>(
    `/social/businesses/${encodeURIComponent(businessId)}/connections/oauth-availability`,
  );
}

export async function connectSocialManual(platform: string, data: { token: string; platformId?: string; accountName?: string }, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiPost<SocialConnection>({
    path: `/social/businesses/${encodeURIComponent(businessId)}/connections/${encodeURIComponent(platform)}/manual`,
    body: data,
  });
}

export async function disconnectSocial(platform: string, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiDelete<{ success: boolean }>(
    `/social/businesses/${encodeURIComponent(businessId)}/connections/${encodeURIComponent(platform)}`,
  );
}

export async function testSocialConnection(platform: string, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiPost<{ success: boolean; error?: string; status?: string; account?: { id: string; name: string } }>({
    path: `/social/businesses/${encodeURIComponent(businessId)}/connections/${encodeURIComponent(platform)}/test`,
    body: {},
  });
}

export type SocialAnalytics = {
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalReach: number;
  totalImpressions: number;
  platformBreakdown: {
    platform: string;
    likes: number;
    comments: number;
    shares: number;
    reach: number;
    impressions: number;
    saves?: number;
    views?: number;
    followers?: number;
    engagementRate?: number;
  }[];
  postEngagements: {
    postId: string;
    platformPostId: string;
    platform: string;
    likes: number;
    comments: number;
    shares: number;
    reach: number;
    impressions: number;
    saves?: number;
    views?: number;
    fetchedAt: string;
  }[];
  connectedPlatforms: string[];
  lastUpdated: string;
};

export async function fetchSocialAnalytics(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet<SocialAnalytics>(
    `/social/businesses/${encodeURIComponent(businessId)}/analytics`,
    z.object({
      totalLikes: z.number(),
      totalComments: z.number(),
      totalShares: z.number(),
      totalReach: z.number(),
      totalImpressions: z.number(),
      platformBreakdown: z.array(z.object({
        platform: z.string(),
        likes: z.number(),
        comments: z.number(),
        shares: z.number(),
        reach: z.number(),
        impressions: z.number(),
        saves: z.number().optional(),
        views: z.number().optional(),
        followers: z.number().optional(),
        engagementRate: z.number().optional(),
      })),
      postEngagements: z.array(z.object({
        postId: z.string(),
        platformPostId: z.string(),
        platform: z.string(),
        likes: z.number(),
        comments: z.number(),
        shares: z.number(),
        reach: z.number(),
        impressions: z.number(),
        saves: z.number().optional(),
        views: z.number().optional(),
        fetchedAt: z.string(),
      })),
      connectedPlatforms: z.array(z.string()),
      lastUpdated: z.string(),
    }),
  );
}

export async function fetchAccountMetrics(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet<{ platform: string; likes: number; comments: number; shares: number; reach: number; impressions: number; followers?: number }[]>(
    `/social/businesses/${encodeURIComponent(businessId)}/account-metrics`,
    z.array(z.object({
      platform: z.string(),
      likes: z.number(),
      comments: z.number(),
      shares: z.number(),
      reach: z.number(),
      impressions: z.number(),
      followers: z.number().optional(),
    })),
    [],
  );
}

export async function fetchPlaybooks(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(
    `/automation/businesses/${encodeURIComponent(businessId)}/playbooks`,
    z.array(z.object({
      id: z.string(),
      name: z.string(),
      triggerEvent: z.string(),
      actions: z.unknown().optional(),
      enabled: z.boolean(),
      createdAt: z.string(),
    })),
    [],
  );
}

export async function createPlaybook(input: { businessId?: string; name: string; triggerEvent: string; actions: unknown }) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<Playbook>({
    path: `/automation/businesses/${encodeURIComponent(businessId)}/playbooks`,
    body: { name: input.name, triggerEvent: input.triggerEvent, actions: input.actions },
  });
}

export async function updatePlaybook(input: { businessId?: string; playbookId: string; name?: string; triggerEvent?: string; actions?: unknown; enabled?: boolean }) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  try {
    const res = await fetch(`${API_BASE}/automation/businesses/${encodeURIComponent(businessId)}/playbooks/${encodeURIComponent(input.playbookId)}`, {
      method: "PATCH",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: input.name, triggerEvent: input.triggerEvent, actions: input.actions, enabled: input.enabled }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) return { data: null, error: res.statusText };
    return { data: json as Playbook, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : "Network error" };
  }
}

export async function getCalendarAuthUrl(businessId?: string) {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/bookings/businesses/${encodeURIComponent(bid)}/calendar/auth-url`,
    z.object({ url: z.string() }),
  );
}

export async function getCalendarStatus(businessId?: string) {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/bookings/businesses/${encodeURIComponent(bid)}/calendar/status`,
    z.object({ connected: z.boolean(), email: z.string().optional() }),
  );
}

export async function disconnectCalendar(businessId?: string) {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<{ success: boolean }>({
    path: `/bookings/businesses/${encodeURIComponent(bid)}/calendar/disconnect`,
    body: {},
  });
}

export async function syncBookingToCalendar(bookingId: string, businessId?: string) {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<{ success: boolean; eventId?: string }>({
    path: `/bookings/businesses/${encodeURIComponent(bid)}/bookings/${encodeURIComponent(bookingId)}/sync-calendar`,
    body: {},
  });
}

export async function updateBookingStatus(bookingId: string, status: string, businessId?: string) {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<Booking>({
    path: `/bookings/businesses/${encodeURIComponent(bid)}/bookings/${encodeURIComponent(bookingId)}/status`,
    body: { status },
  });
}

export type BookingStats = {
  todayCount: number;
  weekCount: number;
  pendingCount: number;
  totalBookings: number;
};

export async function fetchBookingStats(businessId?: string) {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/bookings/businesses/${encodeURIComponent(bid)}/stats`,
    z.object({
      todayCount: z.number(),
      weekCount: z.number(),
      pendingCount: z.number(),
      totalBookings: z.number(),
    }),
  );
}

export interface FlowPhase {
  name: string;
  count: number;
  value: number;
  trend: 'up' | 'down' | 'stable';
}

export interface FeedItem {
  id: string;
  icon: string;
  text: string;
  timestamp: string;
  tone?: 'success' | 'info' | 'warning' | 'error';
  actionType?: string;
  actionId?: string;
}

export interface QuickAction {
  id: string;
  label: string;
  description: string;
  icon: string;
  href: string;
  priority: number;
}

export interface PriorityItem {
  id: string;
  type: 'overdue_invoice' | 'unconfirmed_booking' | 'stale_lead' | 'draft_post' | 'follow_up' | 'unpaid_invoice';
  title: string;
  description: string;
  urgency: 'critical' | 'high' | 'medium' | 'low';
  actionLabel: string;
  actionHref: string;
  amount?: number;
  currency?: string;
  contactName?: string;
  daysSince?: number;
  whatsappLink?: string;
}

export interface RevenueInsights {
  avgClientSpend: number;
  topService: { name: string; revenue: number; count: number } | null;
  leadConversionRate: number;
  clientRetentionRate: number;
  revenueGrowth: number;
  totalClients: number;
  repeatClients: number;
  avgInvoiceValue: number;
  collectionRate: number;
  monthlyTarget: number;
  monthlyProgress: number;
}

export interface CockpitSummary {
  momentum: number;
  streaks: string[];
  phases: FlowPhase[];
  bottleneck: { phase: string; suggestion: string } | null;
  feed: FeedItem[];
  quickActions: QuickAction[];
  priorities: PriorityItem[];
  revenueInsights: RevenueInsights;
  stats: {
    totalContacts: number;
    activeLeads: number;
    pendingInvoices: number;
    overdueInvoices: number;
    upcomingBookings: number;
    monthlyRevenue: number;
    weeklyBookings: number;
    todayRevenue: number;
    todayBookings: number;
    completedBookingsToday: number;
    draftPosts: number;
    scheduledPosts: number;
  };
  highlights: {
    highPotential: { contactId: string; name: string; score: number }[];
    overdueReminders: { contactId: string; name: string; daysSince: number }[];
  };
}

const cockpitSummarySchema = z.object({
  momentum: z.number(),
  streaks: z.array(z.string()),
  phases: z.array(z.object({
    name: z.string(),
    count: z.number(),
    value: z.number(),
    trend: z.enum(['up', 'down', 'stable']),
  })),
  bottleneck: z.object({ phase: z.string(), suggestion: z.string() }).nullable(),
  feed: z.array(z.object({
    id: z.string(),
    icon: z.string(),
    text: z.string(),
    timestamp: z.string(),
    tone: z.enum(['success', 'info', 'warning', 'error']).optional(),
    actionType: z.string().optional(),
    actionId: z.string().optional(),
  })),
  quickActions: z.array(z.object({
    id: z.string(),
    label: z.string(),
    description: z.string(),
    icon: z.string(),
    href: z.string(),
    priority: z.number(),
  })),
  priorities: z.array(z.object({
    id: z.string(),
    type: z.string(),
    title: z.string(),
    description: z.string(),
    urgency: z.enum(['critical', 'high', 'medium', 'low']),
    actionLabel: z.string(),
    actionHref: z.string(),
    amount: z.number().optional(),
    currency: z.string().optional(),
    contactName: z.string().optional(),
    daysSince: z.number().optional(),
    whatsappLink: z.string().optional(),
  })).optional().default([]),
  revenueInsights: z.object({
    avgClientSpend: z.number(),
    topService: z.object({ name: z.string(), revenue: z.number(), count: z.number() }).nullable(),
    leadConversionRate: z.number(),
    clientRetentionRate: z.number(),
    revenueGrowth: z.number(),
    totalClients: z.number(),
    repeatClients: z.number(),
    avgInvoiceValue: z.number(),
    collectionRate: z.number(),
    monthlyTarget: z.number(),
    monthlyProgress: z.number(),
  }).optional().default({ avgClientSpend: 0, topService: null, leadConversionRate: 0, clientRetentionRate: 0, revenueGrowth: 0, totalClients: 0, repeatClients: 0, avgInvoiceValue: 0, collectionRate: 0, monthlyTarget: 0, monthlyProgress: 0 }),
  stats: z.object({
    totalContacts: z.number(),
    activeLeads: z.number(),
    pendingInvoices: z.number(),
    overdueInvoices: z.number(),
    upcomingBookings: z.number(),
    monthlyRevenue: z.number(),
    weeklyBookings: z.number(),
    todayRevenue: z.number(),
    todayBookings: z.number(),
    completedBookingsToday: z.number().optional().default(0),
    draftPosts: z.number().optional().default(0),
    scheduledPosts: z.number().optional().default(0),
  }),
  highlights: z.object({
    highPotential: z.array(z.object({ contactId: z.string(), name: z.string(), score: z.number() })),
    overdueReminders: z.array(z.object({ contactId: z.string(), name: z.string(), daysSince: z.number() })),
  }),
});

export async function fetchCockpitSummary(businessId?: string) {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/flow/businesses/${encodeURIComponent(bid)}/cockpit`,
    cockpitSummarySchema,
  );
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  achieved: boolean;
  achievedAt?: string;
  category: 'setup' | 'sales' | 'growth' | 'engagement' | 'mastery';
  xpReward: number;
}

export interface Challenge {
  id: string;
  title: string;
  description: string;
  icon: string;
  progress: number;
  target: number;
  expiresAt?: string;
  xpReward: number;
  type: 'daily' | 'weekly' | 'monthly';
}

export interface GamificationStats {
  level: number;
  currentXp: number;
  xpToNextLevel: number;
  totalXp: number;
  streakDays: number;
  dailyTasksCompleted?: number;
  achievements: Achievement[];
  challenges: Challenge[];
  recentXpGains: { action: string; xp: number; timestamp: string }[];
}

const gamificationStatsSchema = z.object({
  level: z.number(),
  currentXp: z.number(),
  xpToNextLevel: z.number(),
  totalXp: z.number(),
  streakDays: z.number(),
  achievements: z.array(z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    icon: z.string(),
    achieved: z.boolean(),
    achievedAt: z.string().optional(),
    category: z.enum(['setup', 'sales', 'growth', 'engagement', 'mastery']),
    xpReward: z.number(),
  })),
  challenges: z.array(z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    icon: z.string(),
    progress: z.number(),
    target: z.number(),
    expiresAt: z.string().optional(),
    xpReward: z.number(),
    type: z.enum(['daily', 'weekly', 'monthly']),
  })),
  recentXpGains: z.array(z.object({
    action: z.string(),
    xp: z.number(),
    timestamp: z.string(),
  })),
});

export async function fetchGamificationStats(businessId?: string) {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/gamification/businesses/${encodeURIComponent(bid)}/stats`,
    gamificationStatsSchema,
  );
}

export async function updateStreak(businessId?: string) {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<{ streakDays: number }>({
    path: `/gamification/businesses/${encodeURIComponent(bid)}/streak`,
    body: {},
  });
}

export type AutopilotTask = {
  id: string;
  title: string;
  description?: string | null;
  category: string;
  priority: string;
  status: string;
  autoExecutable: boolean;
  requiresApproval: boolean;
  approvalData?: Record<string, unknown> | null;
  scheduledFor?: string | null;
  dueDate?: string | null;
  relatedType?: string | null;
  relatedId?: string | null;
  createdAt: string;
};

export type AutopilotAlert = {
  type: string;
  severity: string;
  message: string;
  action?: string;
};

export type AutopilotStats = {
  pending: number;
  completed: number;
  autoExecuted: number;
  total: number;
  automationRate: number;
};

const autopilotTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  category: z.string(),
  priority: z.string(),
  status: z.string(),
  autoExecutable: z.boolean(),
  requiresApproval: z.boolean(),
  approvalData: z.unknown().nullable().optional(),
  scheduledFor: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  relatedType: z.string().nullable().optional(),
  relatedId: z.string().nullable().optional(),
  createdAt: z.string(),
});

const autopilotAlertSchema = z.object({
  type: z.string(),
  severity: z.string(),
  message: z.string(),
  action: z.string().optional(),
});

const autopilotStatsSchema = z.object({
  pending: z.number(),
  completed: z.number(),
  autoExecuted: z.number(),
  total: z.number(),
  automationRate: z.number(),
});

export async function fetchTodaysTasks(businessId?: string, limit?: number) {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  const query = limit ? `?limit=${limit}` : '';
  return apiGet(
    `/autopilot/businesses/${encodeURIComponent(bid)}/tasks/today${query}`,
    z.array(autopilotTaskSchema),
    [],
  );
}

export async function fetchAllAutopilotTasks(businessId?: string, status?: string) {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  const query = status ? `?status=${status}` : '';
  return apiGet(
    `/autopilot/businesses/${encodeURIComponent(bid)}/tasks${query}`,
    z.array(autopilotTaskSchema),
    [],
  );
}

export async function updateAutopilotTaskStatus(taskId: string, status: string, businessId?: string) {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPatch<AutopilotTask>(
    `/autopilot/businesses/${encodeURIComponent(bid)}/tasks/${encodeURIComponent(taskId)}/status`,
    { status },
  );
}

export async function approveAutopilotTask(taskId: string, approvedBy: string, businessId?: string) {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<AutopilotTask>({
    path: `/autopilot/businesses/${encodeURIComponent(bid)}/tasks/${encodeURIComponent(taskId)}/approve`,
    body: { approvedBy },
  });
}

export async function denyAutopilotTask(taskId: string, businessId?: string) {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<AutopilotTask>({
    path: `/autopilot/businesses/${encodeURIComponent(bid)}/tasks/${encodeURIComponent(taskId)}/deny`,
    body: {},
  });
}

export async function generateSetupTasks(businessId?: string) {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<AutopilotTask[]>({
    path: `/autopilot/businesses/${encodeURIComponent(bid)}/tasks/generate-setup`,
    body: {},
  });
}

export async function fetchAutopilotStats(businessId?: string) {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/autopilot/businesses/${encodeURIComponent(bid)}/stats`,
    autopilotStatsSchema,
  );
}

export async function fetchCriticalAlerts(businessId?: string) {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/autopilot/businesses/${encodeURIComponent(bid)}/alerts`,
    z.array(autopilotAlertSchema),
    [],
  );
}

export type AutopilotDraft = {
  subject: string;
  message: string;
  tone: string;
  suggestedChannel: 'whatsapp' | 'email';
};

export type AutopilotSettings = {
  enabled: boolean;
  pausedUntil: string | null;
  triggers: {
    follow_up: boolean;
    birthday: boolean;
    payment_reminder: boolean;
    check_in: boolean;
    offer: boolean;
  };
  autoApproveTypes: string[];
  quietHoursStart: string;
  quietHoursEnd: string;
};

const autopilotDraftSchema = z.object({
  subject: z.string(),
  message: z.string(),
  tone: z.string(),
  suggestedChannel: z.enum(['whatsapp', 'email']),
});

const autopilotSettingsSchema = z.object({
  enabled: z.boolean(),
  pausedUntil: z.string().nullable(),
  triggers: z.object({
    follow_up: z.boolean(),
    birthday: z.boolean(),
    payment_reminder: z.boolean(),
    check_in: z.boolean(),
    offer: z.boolean(),
  }),
  autoApproveTypes: z.array(z.string()),
  quietHoursStart: z.string(),
  quietHoursEnd: z.string(),
});

export async function generateAutopilotDraft(
  actionId: string,
  body: { type: string; contactId: string; contactName: string; description: string },
  businessId?: string,
): Promise<ApiResult<AutopilotDraft>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<AutopilotDraft>({
    path: `/autopilot/businesses/${encodeURIComponent(bid)}/actions/${encodeURIComponent(actionId)}/draft`,
    body,
  });
}

export async function executeAutopilotAction(
  actionId: string,
  body: { contactId: string; channel: string; message: string },
  businessId?: string,
): Promise<ApiResult<{ success: boolean; eventLogged: boolean }>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<{ success: boolean; eventLogged: boolean }>({
    path: `/autopilot/businesses/${encodeURIComponent(bid)}/actions/${encodeURIComponent(actionId)}/execute`,
    body,
  });
}

export async function fetchAutopilotSettings(businessId?: string): Promise<ApiResult<AutopilotSettings>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/autopilot/businesses/${encodeURIComponent(bid)}/settings`,
    autopilotSettingsSchema,
  );
}

export async function updateAutopilotSettings(
  settings: Partial<AutopilotSettings>,
  businessId?: string,
): Promise<ApiResult<AutopilotSettings>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPatch<AutopilotSettings>(
    `/autopilot/businesses/${encodeURIComponent(bid)}/settings`,
    settings,
  );
}

const flowIntelligenceSchema = z.object({
  totalContacts: z.number(),
  leads: z.number(),
  prospects: z.number(),
  clients: z.number(),
  lost: z.number(),
  newThisWeek: z.number(),
  conversionsThisWeek: z.number(),
  contactsGoingCold: z.number(),
  contactsReadyToAdvance: z.number(),
  weeklyChange: z.number(),
});

export type FlowIntelligenceData = z.infer<typeof flowIntelligenceSchema>;

const crmNextActionSchema = z.object({
  id: z.string(),
  type: z.enum(["follow_up", "send_quote", "call", "email", "payment_reminder", "task"]),
  contactId: z.string(),
  contactName: z.string(),
  description: z.string(),
  aiDraft: z.string().optional(),
  estimatedTime: z.number(),
  priority: z.enum(["urgent", "high", "medium", "low"]),
  dueDate: z.string().optional(),
  value: z.number().optional(),
});

export type CrmNextAction = z.infer<typeof crmNextActionSchema>;

const autopilotActionSchema = z.object({
  id: z.string(),
  type: z.enum(["follow_up", "birthday", "payment_reminder", "check_in", "offer"]),
  status: z.enum(["completed", "pending", "needs_approval"]),
  contactName: z.string(),
  contactId: z.string(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().optional(),
  description: z.string(),
  scheduledAt: z.string().optional(),
  completedAt: z.string().optional(),
});

export type AutopilotActionData = z.infer<typeof autopilotActionSchema>;

const healthMetricsSchema = z.object({
  engagement: z.number(),
  payment: z.number(),
  responsiveness: z.number(),
  relationship: z.number(),
});

export type HealthMetrics = z.infer<typeof healthMetricsSchema>;

const journeyMilestoneSchema = z.object({
  id: z.string(),
  type: z.enum(["first_contact", "call", "quote_sent", "quote_accepted", "payment", "booking", "completed", "milestone", "note"]),
  title: z.string(),
  description: z.string().optional(),
  date: z.string(),
  value: z.number().optional(),
  isNext: z.boolean().optional(),
});

export type JourneyMilestone = z.infer<typeof journeyMilestoneSchema>;

const revenueDataSchema = z.object({
  fromActivePipeline: z.number(),
  fromRecurringClients: z.number(),
  fromColdLeads: z.number(),
  expiringQuotes: z.object({ count: z.number(), value: z.number() }),
  overdueInvoices: z.object({ count: z.number(), value: z.number() }),
});

export type RevenueData = z.infer<typeof revenueDataSchema>;

const conversationContextSchema = z.object({
  lastDiscussed: z.string().optional(),
  concerns: z.array(z.string()).optional(),
  preferences: z.array(z.string()).optional(),
  decisionMaker: z.string().optional(),
  budgetRange: z.object({ min: z.number(), max: z.number() }).optional(),
  suggestedOpening: z.string().optional(),
  sentiment: z.enum(["positive", "neutral", "negative"]).optional(),
  engagementLevel: z.enum(["high", "medium", "low"]).optional(),
});

export type ConversationContextData = z.infer<typeof conversationContextSchema>;

const aiInsightSchema = z.object({
  summary: z.string(),
  nextBestAction: z.string(),
  reasoning: z.string().optional(),
  confidence: z.number(),
  suggestedMessage: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type AiInsight = z.infer<typeof aiInsightSchema>;

export async function fetchFlowIntelligence(businessId?: string, opts?: { signal?: AbortSignal }): Promise<ApiResult<FlowIntelligenceData>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/crm/businesses/${encodeURIComponent(bid)}/flow-intelligence`,
    flowIntelligenceSchema,
    undefined,
    { signal: opts?.signal },
  );
}

export async function fetchAiNextActions(businessId?: string, opts?: { signal?: AbortSignal }): Promise<ApiResult<AiNextAction[]>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/crm/businesses/${encodeURIComponent(bid)}/ai-next-actions`,
    z.array(aiNextActionSchema),
    [],
    { signal: opts?.signal },
  );
}

export async function fetchNextActions(businessId?: string, opts?: { signal?: AbortSignal }): Promise<ApiResult<CrmNextAction[]>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/crm/businesses/${encodeURIComponent(bid)}/next-actions`,
    z.array(crmNextActionSchema),
    [],
    { signal: opts?.signal },
  );
}

export async function completeNextAction(actionId: string, businessId?: string) {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost({
    path: `/crm/businesses/${encodeURIComponent(bid)}/next-actions/${encodeURIComponent(actionId)}/complete`,
    body: {},
  });
}

export async function fetchAutopilotActionsForCrm(businessId?: string, opts?: { signal?: AbortSignal }): Promise<ApiResult<AutopilotActionData[]>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/crm/businesses/${encodeURIComponent(bid)}/autopilot-actions`,
    z.array(autopilotActionSchema),
    [],
    { signal: opts?.signal },
  );
}

export async function fetchContactHealthMetrics(contactId: string, businessId?: string, opts?: { signal?: AbortSignal }): Promise<ApiResult<HealthMetrics>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/crm/businesses/${encodeURIComponent(bid)}/contacts/${encodeURIComponent(contactId)}/health-metrics`,
    healthMetricsSchema,
    undefined,
    { signal: opts?.signal },
  );
}

export async function fetchContactJourney(contactId: string, businessId?: string, opts?: { signal?: AbortSignal }): Promise<ApiResult<JourneyMilestone[]>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/crm/businesses/${encodeURIComponent(bid)}/contacts/${encodeURIComponent(contactId)}/journey`,
    z.array(journeyMilestoneSchema),
    [],
    { signal: opts?.signal },
  );
}

export async function fetchPredictiveRevenue(businessId?: string, opts?: { signal?: AbortSignal }): Promise<ApiResult<RevenueData>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/crm/businesses/${encodeURIComponent(bid)}/predictive-revenue`,
    revenueDataSchema,
    undefined,
    { signal: opts?.signal },
  );
}

export interface FinancialGrowthData {
  monthlyRevenue: { month: string; collected: number; invoiced: number }[];
  totalCollected: number;
  totalInvoiced: number;
  collectionRate: number;
  avgClientValue: number;
  clientCount: number;
  revenueGrowthPct: number;
  avgDaysToPayment: number;
  topServices: { name: string; revenue: number; bookings: number }[];
  revenueAtRisk: number;
}

const financialGrowthSchema = z.object({
  monthlyRevenue: z.array(z.object({ month: z.string(), collected: z.number(), invoiced: z.number() })),
  totalCollected: z.number(),
  totalInvoiced: z.number(),
  collectionRate: z.number(),
  avgClientValue: z.number(),
  clientCount: z.number(),
  revenueGrowthPct: z.number(),
  avgDaysToPayment: z.number(),
  topServices: z.array(z.object({ name: z.string(), revenue: z.number(), bookings: z.number() })),
  revenueAtRisk: z.number(),
});

export async function fetchFinancialGrowth(businessId?: string, opts?: { signal?: AbortSignal }): Promise<ApiResult<FinancialGrowthData>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/crm/businesses/${encodeURIComponent(bid)}/financial-growth`,
    financialGrowthSchema,
    undefined,
    { signal: opts?.signal },
  );
}

export async function fetchConversationContext(contactId: string, businessId?: string, opts?: { signal?: AbortSignal }): Promise<ApiResult<ConversationContextData>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/crm/businesses/${encodeURIComponent(bid)}/contacts/${encodeURIComponent(contactId)}/conversation-context`,
    conversationContextSchema,
    undefined,
    { signal: opts?.signal },
  );
}

export async function generateAiInsight(contactId: string, businessId?: string, opts?: { signal?: AbortSignal }): Promise<ApiResult<AiInsight>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<AiInsight>({
    path: `/crm/businesses/${encodeURIComponent(bid)}/contacts/${encodeURIComponent(contactId)}/ai-insight`,
    body: {},
    init: opts?.signal ? { signal: opts.signal } : undefined,
  });
}

export type ActivityItem = {
  id: string;
  module: string;
  action: string;
  entityType: string;
  entityId?: string;
  title: string;
  detail?: string;
  icon?: string;
  tone?: string;
  data?: Record<string, unknown>;
  contactId?: string;
  createdAt: string;
};

export async function fetchActivityFeed(
  businessId: string,
  opts?: { module?: string; limit?: number; cursor?: string },
): Promise<ApiResult<ActivityItem[]>> {
  const params = new URLSearchParams();
  if (opts?.module) params.set("module", opts.module);
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.cursor) params.set("cursor", opts.cursor);
  const qs = params.toString();
  const path = `/flow/businesses/${encodeURIComponent(businessId)}/activity${qs ? `?${qs}` : ""}`;
  return apiGetSimple<ActivityItem[]>(path);
}

export type UniversalSearchResult = {
  contacts: Array<{ id: string; firstName?: string; lastName?: string; displayName?: string; email?: string; status?: string }>;
  invoices: Array<{ id: string; invoiceNumber?: string; total?: number; currency?: string; status?: string }>;
  bookings: Array<{ id: string; startTime: string; status: string; service?: { name: string }; contact?: { firstName?: string; lastName?: string } }>;
  products: Array<{ id: string; name: string; price?: number; currency?: string }>;
  projects: Array<{ id: string; name: string; status?: string; priority?: string }>;
};

export async function universalSearch(businessId: string, query: string): Promise<ApiResult<UniversalSearchResult>> {
  return apiGetSimple<UniversalSearchResult>(
    `/flow/businesses/${encodeURIComponent(businessId)}/search?q=${encodeURIComponent(query)}`,
  );
}

export type Project = {
  id: string;
  name: string;
  description?: string;
  status: string;
  priority: string;
  color?: string;
  contactId?: string;
  invoiceId?: string;
  bookingId?: string;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
  tasks: ProjectTask[];
};

export type ProjectTask = {
  id: string;
  title: string;
  description?: string;
  isCompleted: boolean;
  priority: string;
  sortOrder: number;
  dueDate?: string;
  assigneeId?: string;
};

export async function fetchProjects(businessId: string): Promise<ApiResult<Project[]>> {
  return apiGetSimple<Project[]>(`/projects/businesses/${encodeURIComponent(businessId)}`);
}

export async function createProject(
  businessId: string,
  data: { name: string; description?: string; status?: string; priority?: string; color?: string; contactId?: string; dueDate?: string },
): Promise<ApiResult<Project>> {
  return apiPost<Project>({
    path: `/projects/businesses/${encodeURIComponent(businessId)}`,
    body: data,
  });
}

export async function updateProject(
  businessId: string,
  projectId: string,
  data: Partial<{ name: string; description: string; status: string; priority: string; color: string; dueDate: string | null }>,
): Promise<ApiResult<Project>> {
  return apiPatch<Project>(
    `/projects/businesses/${encodeURIComponent(businessId)}/projects/${encodeURIComponent(projectId)}`,
    data,
  );
}

export async function deleteProject(businessId: string, projectId: string): Promise<ApiResult<unknown>> {
  return apiDelete<unknown>(
    `/projects/businesses/${encodeURIComponent(businessId)}/projects/${encodeURIComponent(projectId)}`,
  );
}

export async function createProjectTask(
  businessId: string,
  projectId: string,
  data: { title: string; description?: string; priority?: string; dueDate?: string },
): Promise<ApiResult<ProjectTask>> {
  return apiPost<ProjectTask>({
    path: `/projects/businesses/${encodeURIComponent(businessId)}/projects/${encodeURIComponent(projectId)}/tasks`,
    body: data,
  });
}

export async function updateProjectTask(
  businessId: string,
  taskId: string,
  data: Partial<{ title: string; isCompleted: boolean; priority: string; sortOrder: number; dueDate: string | null }>,
): Promise<ApiResult<ProjectTask>> {
  return apiPatch<ProjectTask>(
    `/projects/businesses/${encodeURIComponent(businessId)}/tasks/${encodeURIComponent(taskId)}`,
    data,
  );
}

export async function deleteProjectTask(businessId: string, taskId: string): Promise<ApiResult<unknown>> {
  return apiDelete<unknown>(
    `/projects/businesses/${encodeURIComponent(businessId)}/tasks/${encodeURIComponent(taskId)}`,
  );
}

export interface StorefrontConfig {
  hero: {
    headline?: string;
    subheadline?: string;
    ctaLabel?: string;
    coverImageUrl?: string;
    showHours?: boolean;
    showWhatsApp?: boolean;
  };
  appearance: {
    theme?: 'default' | 'minimal' | 'bold' | 'elegant';
    cardStyle?: 'grid' | 'list';
    showPrices?: boolean;
    showDuration?: boolean;
    accentColor?: string;
  };
  merchandising: {
    featuredItemIds?: string[];
    collections?: { id: string; name: string; itemIds: string[] }[];
    badges?: Record<string, 'popular' | 'new' | 'best_seller' | 'limited'>;
  };
  promotions: {
    bannerEnabled?: boolean;
    bannerText?: string;
    bannerColor?: string;
    bannerLink?: string;
    bannerExpiry?: string;
  };
  socialProof: {
    testimonials?: { id: string; name: string; text: string; rating: number; date: string }[];
    showBookingCount?: boolean;
    showRating?: boolean;
    guaranteeText?: string;
  };
  seo: {
    metaTitle?: string;
    metaDescription?: string;
    socialImage?: string;
  };
}

export interface StoreAnalytics {
  period: { days: number; since: string };
  bookings: { total: number; inPeriod: number; last7Days: number };
  invoices: { total: number; inPeriod: number };
  revenue: { inPeriod: number };
  catalog: { products: number; services: number };
  storefrontEvents: Record<string, number>;
}

export async function fetchStorefrontConfig(businessId: string): Promise<ApiResult<StorefrontConfig>> {
  return apiGetSimple<StorefrontConfig>(`/site/businesses/${encodeURIComponent(businessId)}/storefront`);
}

export async function updateStorefrontConfig(businessId: string, config: Partial<StorefrontConfig>): Promise<ApiResult<StorefrontConfig>> {
  const res = await fetch(`${API_BASE}/site/businesses/${encodeURIComponent(businessId)}/storefront`, {
    method: 'PUT',
    headers: { ...await getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return { data: null, error: data?.message || 'Failed to update' };
  return { data, error: null };
}

export async function fetchStoreAnalytics(businessId: string, days = 30): Promise<ApiResult<StoreAnalytics>> {
  return apiGetSimple<StoreAnalytics>(`/site/businesses/${encodeURIComponent(businessId)}/analytics?days=${days}`);
}

export async function trackStoreEvent(businessId: string, type: string, itemId?: string): Promise<void> {
  fetch(`${API_BASE}/site/businesses/${encodeURIComponent(businessId)}/analytics/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, itemId }),
  }).catch(() => {});
}

// ---
// EXPENSE TRACKING
// ---
export interface ExpenseCategory {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  _count?: { expenses: number };
}
export interface Expense {
  id: string;
  description: string;
  amount: number;
  currency: string;
  date: string;
  vendor?: string;
  receiptUrl?: string;
  notes?: string;
  paymentMethod?: string;
  tags?: string[];
  isRecurring: boolean;
  recurringFrequency?: string;
  categoryId?: string;
  category?: ExpenseCategory;
  createdAt: string;
  updatedAt: string;
}
export interface ExpenseSummary {
  period: string;
  startDate: string;
  endDate: string;
  total: number;
  count: number;
  averageExpense: number;
  largestExpense: { id: string; description: string; amount: number; date: string; vendor?: string } | null;
  comparison: { prevTotal: number; prevCount: number; changePercent: number; direction: 'up' | 'down' | 'flat' };
  byCategory: { categoryId: string; name: string; color: string | null; total: number; count: number; prevTotal: number; percent: number }[];
  byPaymentMethod: { method: string; total: number; count: number }[];
  monthlyTrend: { month: string; total: number }[];
  dailyTrend: { date: string; total: number }[];
  tags: string[];
}
export interface VendorAnalytics {
  name: string;
  total: number;
  count: number;
  average: number;
  lastDate: string;
  frequency: number;
}
export interface ExpenseBudget {
  id: string;
  amount: number;
  month: number;
  year: number;
  alertAt: number;
  rollover: boolean;
  categoryId?: string;
  category?: ExpenseCategory;
  spent: number;
  remaining: number;
  percentUsed: number;
  isOverBudget: boolean;
  isNearAlert: boolean;
}
export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'mobile_money', label: 'Mobile Money' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'linx', label: 'Linx' },
  { value: 'other', label: 'Other' },
];
export async function fetchExpenses(businessId: string, params?: { startDate?: string; endDate?: string; period?: string; categoryId?: string; search?: string; paymentMethod?: string; tag?: string; page?: number; limit?: number }): Promise<ApiResult<{ data: Expense[]; total: number; page: number; limit: number }>> {
  const q = new URLSearchParams();
  if (params?.startDate) q.set('startDate', params.startDate);
  if (params?.endDate) q.set('endDate', params.endDate);
  if (params?.period) q.set('period', params.period);
  if (params?.categoryId) q.set('categoryId', params.categoryId);
  if (params?.search) q.set('search', params.search);
  if (params?.paymentMethod) q.set('paymentMethod', params.paymentMethod);
  if (params?.tag) q.set('tag', params.tag);
  if (params?.page) q.set('page', String(params.page));
  if (params?.limit) q.set('limit', String(params.limit));
  return apiGetSimple<{ data: Expense[]; total: number; page: number; limit: number }>(`/expenses/businesses/${encodeURIComponent(businessId)}/expenses?${q}`);
}
export async function createExpense(businessId: string, data: Partial<Expense>): Promise<ApiResult<Expense>> {
  return apiPost<Expense>({ path: `/expenses/businesses/${encodeURIComponent(businessId)}/expenses`, body: data });
}
export async function updateExpense(businessId: string, expenseId: string, data: Partial<Expense>): Promise<ApiResult<Expense>> {
  return apiPatch<Expense>(`/expenses/businesses/${encodeURIComponent(businessId)}/expenses/${expenseId}`, data);
}
export async function deleteExpense(businessId: string, expenseId: string): Promise<ApiResult<void>> {
  return apiDelete<void>(`/expenses/businesses/${encodeURIComponent(businessId)}/expenses/${expenseId}`);
}
export async function fetchExpenseCategories(businessId: string): Promise<ApiResult<ExpenseCategory[]>> {
  return apiGetSimple<ExpenseCategory[]>(`/expenses/businesses/${encodeURIComponent(businessId)}/expense-categories`);
}
export async function createExpenseCategory(businessId: string, data: { name: string; icon?: string; color?: string }): Promise<ApiResult<ExpenseCategory>> {
  return apiPost<ExpenseCategory>({ path: `/expenses/businesses/${encodeURIComponent(businessId)}/expense-categories`, body: data });
}
export async function deleteExpenseCategory(businessId: string, categoryId: string): Promise<ApiResult<void>> {
  return apiDelete<void>(`/expenses/businesses/${encodeURIComponent(businessId)}/expense-categories/${categoryId}`);
}
export async function fetchExpenseSummary(businessId: string, period = '30d', startDate?: string, endDate?: string): Promise<ApiResult<ExpenseSummary>> {
  const q = new URLSearchParams({ period });
  if (startDate) q.set('startDate', startDate);
  if (endDate) q.set('endDate', endDate);
  return apiGetSimple<ExpenseSummary>(`/expenses/businesses/${encodeURIComponent(businessId)}/expenses/summary?${q}`);
}
export async function fetchVendorAnalytics(businessId: string, period = '30d', startDate?: string, endDate?: string): Promise<ApiResult<VendorAnalytics[]>> {
  const q = new URLSearchParams({ period });
  if (startDate) q.set('startDate', startDate);
  if (endDate) q.set('endDate', endDate);
  return apiGetSimple<VendorAnalytics[]>(`/expenses/businesses/${encodeURIComponent(businessId)}/expenses/vendors?${q}`);
}
export async function fetchExpenseBudgets(businessId: string, month?: number, year?: number): Promise<ApiResult<ExpenseBudget[]>> {
  const q = new URLSearchParams();
  if (month) q.set('month', String(month));
  if (year) q.set('year', String(year));
  return apiGetSimple<ExpenseBudget[]>(`/expenses/businesses/${encodeURIComponent(businessId)}/expense-budgets?${q}`);
}
export async function upsertExpenseBudget(businessId: string, data: { categoryId?: string; amount: number; month: number; year: number; alertAt?: number; rollover?: boolean }): Promise<ApiResult<ExpenseBudget>> {
  return apiPost<ExpenseBudget>({ path: `/expenses/businesses/${encodeURIComponent(businessId)}/expense-budgets`, body: data });
}
export async function deleteExpenseBudget(businessId: string, budgetId: string): Promise<ApiResult<void>> {
  return apiDelete<void>(`/expenses/businesses/${encodeURIComponent(businessId)}/expense-budgets/${budgetId}`);
}
export function getExpenseExportUrl(businessId: string, params?: { startDate?: string; endDate?: string; categoryId?: string }): string {
  const q = new URLSearchParams();
  if (params?.startDate) q.set('startDate', params.startDate);
  if (params?.endDate) q.set('endDate', params.endDate);
  if (params?.categoryId) q.set('categoryId', params.categoryId);
  return `${API_BASE}/expenses/businesses/${encodeURIComponent(businessId)}/expenses/export?${q}`;
}

// ---
// RECURRING INVOICES
// ---
export interface RecurringInvoice {
  id: string;
  name: string;
  frequency: string;
  nextRunDate: string;
  lastRunDate?: string;
  endDate?: string;
  isActive: boolean;
  runCount: number;
  contactId: string;
  contact?: { id: string; firstName?: string; lastName?: string; email?: string };
  lineItems: { description: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: number;
  taxRate?: number;
  discountType?: string;
  discountValue?: number;
  total: number;
  currency: string;
  notes?: string;
  createdAt: string;
}
export async function fetchRecurringInvoices(businessId: string): Promise<ApiResult<RecurringInvoice[]>> {
  return apiGetSimple<RecurringInvoice[]>(`/commerce/businesses/${encodeURIComponent(businessId)}/recurring-invoices`);
}
export async function createRecurringInvoice(businessId: string, data: Partial<RecurringInvoice>): Promise<ApiResult<RecurringInvoice>> {
  return apiPost<RecurringInvoice>({ path: `/commerce/businesses/${encodeURIComponent(businessId)}/recurring-invoices`, body: data });
}
export async function updateRecurringInvoice(businessId: string, id: string, data: Partial<RecurringInvoice>): Promise<ApiResult<RecurringInvoice>> {
  return apiPatch<RecurringInvoice>(`/commerce/businesses/${encodeURIComponent(businessId)}/recurring-invoices/${id}`, data);
}
export async function deleteRecurringInvoice(businessId: string, id: string): Promise<ApiResult<void>> {
  return apiDelete<void>(`/commerce/businesses/${encodeURIComponent(businessId)}/recurring-invoices/${id}`);
}
export async function toggleRecurringInvoice(businessId: string, id: string): Promise<ApiResult<RecurringInvoice>> {
  return apiPost<RecurringInvoice>({ path: `/commerce/businesses/${encodeURIComponent(businessId)}/recurring-invoices/${id}/toggle`, body: {} });
}

// ---
// AI ADVISOR
// ---
export interface AiChatResponse { reply: string }
export interface AiBriefing { summary: string; highlights: string[]; priorities: string[]; cashFlow: { revenue: number; expenses: number; net: number }; suggestion: string }
export interface CashFlowForecast { currentBalance: number; projectedBalance: number; daysUntilNegative: number | null; trend: string; alerts: string[]; dailyRevenueRate: number; dailyExpenseRate: number }
export async function sendAiChat(businessId: string, message: string, history?: { role: string; content: string }[]): Promise<ApiResult<AiChatResponse>> {
  return apiPost<AiChatResponse>({ path: `/ai/businesses/${encodeURIComponent(businessId)}/ai/chat`, body: { message, history } });
}
export async function fetchAiBriefing(businessId: string): Promise<ApiResult<AiBriefing>> {
  return apiGetSimple<AiBriefing>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/briefing`);
}
export async function fetchCashFlowForecast(businessId: string, days = 30): Promise<ApiResult<CashFlowForecast>> {
  return apiGetSimple<CashFlowForecast>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/cash-flow-forecast?days=${days}`);
}

// ---
// AI USAGE & BILLING
// ---
export interface AiUsageSummary {
  currentPlan: string;
  creditsUsed: number;
  creditsLimit: number;
  creditsRemaining: number;
  isUnlimited: boolean;
  overageCredits: number;
  overageCost: number;
  overageCurrency: string;
  totalEstimatedCost: number;
  periodStart: string;
  periodEnd: string;
  byFeature: Array<{ feature: string; credits: number; calls: number; cost: number }>;
}
export interface AiCreditsInfo {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  isUnlimited: boolean;
}
export interface AiBillingSummary {
  subscription: { plan: string; status: string; monthlyCost: number; currency: string; periodEnd: string | null };
  aiUsage: { creditsUsed: number; creditsLimit: number; isUnlimited: boolean; overageCredits: number; overageCost: number; estimatedApiCost: number };
  totalMonthlyCost: number;
  currency: string;
  breakdown: Array<{ item: string; amount: number }>;
}
export interface AiUsageHistoryResponse {
  logs: Array<{ id: string; feature: string; model: string; promptTokens: number; completionTokens: number; totalTokens: number; estimatedCost: number; creditsUsed: number; createdAt: string }>;
  total: number;
  limit: number;
  offset: number;
}
export async function fetchAiUsageSummary(businessId: string): Promise<ApiResult<AiUsageSummary>> {
  return apiGetSimple<AiUsageSummary>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/usage`);
}
export async function fetchAiCredits(businessId: string): Promise<ApiResult<AiCreditsInfo>> {
  return apiGetSimple<AiCreditsInfo>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/credits`);
}
export async function fetchAiBilling(businessId: string): Promise<ApiResult<AiBillingSummary>> {
  return apiGetSimple<AiBillingSummary>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/billing`);
}
export async function fetchAiUsageHistory(businessId: string, limit = 50, offset = 0): Promise<ApiResult<AiUsageHistoryResponse>> {
  return apiGetSimple<AiUsageHistoryResponse>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/usage/history?limit=${limit}&offset=${offset}`);
}

// ---
// REPORTS
// ---
export interface ReportMetrics {
  period: { start: string; end: string };
  currency: string;
  revenue: {
    total: number;
    invoiceCount: number;
    averageInvoice: number;
    byStatus: Record<string, { count: number; total: number }>;
    outstanding: number;
    outstandingCount: number;
    overdueCount: number;
    topClients: Array<{ name: string; total: number }>;
  };
  expenses: {
    total: number;
    count: number;
    averageExpense: number;
    byCategory: Array<{ category: string; total: number; count: number }>;
    topVendors: Array<{ vendor: string; total: number }>;
  };
  profitability: {
    netProfit: number;
    profitMargin: number;
    revenueToExpenseRatio: number | null;
  };
  clients: {
    totalContacts: number;
    byStatus: Array<{ status: string; count: number }>;
  };
  bookings: {
    total: number;
    confirmed: number;
    completed: number;
    cancelled: number;
    pending: number;
    completionRate: number;
  };
  products: { total: number };
  business: { name: string; industry: string | null; archetype: string | null; revenueModel: string | null };
}
export interface GeneratedReport {
  type: string;
  generatedAt: string;
  metrics: ReportMetrics;
  aiNarrative: string;
}
export async function fetchReport(businessId: string, type = 'executive', startDate?: string, endDate?: string): Promise<ApiResult<GeneratedReport>> {
  const params = new URLSearchParams({ type });
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);
  return apiGetSimple<GeneratedReport>(`/businesses/${encodeURIComponent(businessId)}/reports/generate?${params.toString()}`);
}

// ---
// EMAIL MARKETING
// ---
export interface EmailCampaign {
  id: string;
  name: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt?: string;
  sentAt?: string;
  totalRecipients: number;
  sentCount: number;
  openCount: number;
  clickCount: number;
  segmentFilter?: { tags?: string[]; status?: string };
  createdAt: string;
}
export async function fetchCampaigns(businessId: string): Promise<ApiResult<EmailCampaign[]>> {
  return apiGetSimple<EmailCampaign[]>(`/businesses/${encodeURIComponent(businessId)}/campaigns`);
}
export async function createCampaign(businessId: string, data: Partial<EmailCampaign>): Promise<ApiResult<EmailCampaign>> {
  return apiPost<EmailCampaign>({ path: `/businesses/${encodeURIComponent(businessId)}/campaigns`, body: data });
}
export async function updateCampaign(businessId: string, id: string, data: Partial<EmailCampaign>): Promise<ApiResult<EmailCampaign>> {
  return apiPatch<EmailCampaign>(`/businesses/${encodeURIComponent(businessId)}/campaigns/${id}`, data);
}
export async function deleteCampaign(businessId: string, id: string): Promise<ApiResult<void>> {
  return apiDelete<void>(`/businesses/${encodeURIComponent(businessId)}/campaigns/${id}`);
}
export interface SendCampaignResult {
  sent: number;
  suppressed: number;
}
export async function sendCampaign(businessId: string, id: string): Promise<ApiResult<SendCampaignResult>> {
  return apiPost<SendCampaignResult>({ path: `/businesses/${encodeURIComponent(businessId)}/campaigns/${id}/send`, body: {} });
}
export async function scheduleCampaign(businessId: string, id: string, scheduledAt: string): Promise<ApiResult<EmailCampaign>> {
  return apiPost<EmailCampaign>({ path: `/businesses/${encodeURIComponent(businessId)}/campaigns/${id}/schedule`, body: { scheduledAt } });
}
export async function cancelScheduleCampaign(businessId: string, id: string): Promise<ApiResult<EmailCampaign>> {
  return apiPost<EmailCampaign>({ path: `/businesses/${encodeURIComponent(businessId)}/campaigns/${id}/cancel-schedule`, body: {} });
}
export async function fetchSuppressionCount(businessId: string): Promise<ApiResult<number>> {
  return apiGetSimple<number>(`/businesses/${encodeURIComponent(businessId)}/suppression-count`);
}

// ---
// LEAD FORMS
// ---
export interface LeadForm {
  id: string;
  name: string;
  description?: string;
  fields: { name: string; type: string; label: string; required: boolean }[];
  settings?: { thankYouMessage?: string; redirectUrl?: string };
  isActive: boolean;
  _count?: { submissions: number };
  createdAt: string;
}
export interface LeadFormSubmission {
  id: string;
  formId: string;
  data: Record<string, string>;
  contactId?: string;
  source?: string;
  createdAt: string;
}
export async function fetchLeadForms(businessId: string): Promise<ApiResult<LeadForm[]>> {
  return apiGetSimple<LeadForm[]>(`/businesses/${encodeURIComponent(businessId)}/lead-forms`);
}
export async function createLeadForm(businessId: string, data: Partial<LeadForm>): Promise<ApiResult<LeadForm>> {
  return apiPost<LeadForm>({ path: `/businesses/${encodeURIComponent(businessId)}/lead-forms`, body: data });
}
export async function updateLeadForm(businessId: string, id: string, data: Partial<LeadForm>): Promise<ApiResult<LeadForm>> {
  return apiPatch<LeadForm>(`/businesses/${encodeURIComponent(businessId)}/lead-forms/${id}`, data);
}
export async function deleteLeadForm(businessId: string, id: string): Promise<ApiResult<void>> {
  return apiDelete<void>(`/businesses/${encodeURIComponent(businessId)}/lead-forms/${id}`);
}
export async function fetchLeadFormSubmissions(businessId: string, formId: string): Promise<ApiResult<LeadFormSubmission[]>> {
  return apiGetSimple<LeadFormSubmission[]>(`/businesses/${encodeURIComponent(businessId)}/lead-forms/${formId}/submissions`);
}

export interface MarketingAiSearchResult {
  type: string;
  interpretation: string;
  confidence: number;
  filters: Record<string, unknown>;
  results: Record<string, unknown>[];
}
export interface MarketingAiContentResult {
  subjectLines: { text: string; predictedOpenRate?: number }[];
  bodyContent: string;
  ctas: { text: string; style: string }[];
  summary: string;
}
export interface MarketingAiPerformanceResult {
  summary: string;
  openRate: number;
  clickRate: number;
  trends: { label: string; direction: string; detail: string }[];
  recommendations: { title: string; description: string; priority: string; expectedImpact?: string }[];
}
export interface MarketingAiAudienceResult {
  summary: string;
  segments: { name: string; description: string; size: number; predictedEngagement: number }[];
  recommendations: { title: string; description: string; priority: string }[];
}
export interface MarketingAiSubjectLineResult {
  original?: string;
  variations: { text: string; predictedOpenRate: number; style: string }[];
  bestPick: string;
  tips: string[];
}
export interface MarketingAiFormOptimizerResult {
  summary: string;
  conversionRate: number;
  fieldAnalysis: { field: string; issue?: string; suggestion: string; impact: string }[];
  recommendations: { title: string; description: string; priority: string; expectedImpact?: string }[];
}

export async function marketingAiSearch(query: string, businessId: string): Promise<ApiResult<MarketingAiSearchResult>> {
  return apiPost<MarketingAiSearchResult>({
    path: `/marketing/businesses/${encodeURIComponent(businessId)}/marketing/ai-search`,
    body: { query },
  });
}
export async function marketingAiCampaignContent(query: string, businessId: string): Promise<ApiResult<MarketingAiContentResult>> {
  return apiPost<MarketingAiContentResult>({
    path: `/marketing/businesses/${encodeURIComponent(businessId)}/marketing/ai-campaign-content`,
    body: { query },
  });
}
export async function marketingAiPerformance(query: string, businessId: string): Promise<ApiResult<MarketingAiPerformanceResult>> {
  return apiPost<MarketingAiPerformanceResult>({
    path: `/marketing/businesses/${encodeURIComponent(businessId)}/marketing/ai-performance`,
    body: { query },
  });
}
export async function marketingAiAudience(query: string, businessId: string): Promise<ApiResult<MarketingAiAudienceResult>> {
  return apiPost<MarketingAiAudienceResult>({
    path: `/marketing/businesses/${encodeURIComponent(businessId)}/marketing/ai-audience`,
    body: { query },
  });
}
export async function marketingAiSubjectLines(query: string, businessId: string): Promise<ApiResult<MarketingAiSubjectLineResult>> {
  return apiPost<MarketingAiSubjectLineResult>({
    path: `/marketing/businesses/${encodeURIComponent(businessId)}/marketing/ai-subject-lines`,
    body: { query },
  });
}
export async function marketingAiFormOptimizer(query: string, businessId: string): Promise<ApiResult<MarketingAiFormOptimizerResult>> {
  return apiPost<MarketingAiFormOptimizerResult>({
    path: `/marketing/businesses/${encodeURIComponent(businessId)}/marketing/ai-form-optimizer`,
    body: { query },
  });
}

export async function generateMarketingStrategy(businessId: string, metrics: Record<string, unknown>): Promise<ApiResult<Record<string, unknown>>> {
  return apiPost<Record<string, unknown>>({
    path: `/marketing/businesses/${encodeURIComponent(businessId)}/marketing/ai-strategy`,
    body: metrics,
  });
}

export async function fetchBusinessSnapshot(businessId: string): Promise<ApiResult<Record<string, unknown>>> {
  return apiGet<Record<string, unknown>>(`/marketing/businesses/${encodeURIComponent(businessId)}/marketing/business-snapshot`);
}

export async function submitMarketingBrief(businessId: string, brief: Record<string, unknown>): Promise<ApiResult<Record<string, unknown>>> {
  return apiPost<Record<string, unknown>>({
    path: `/marketing/businesses/${encodeURIComponent(businessId)}/marketing/submit-brief`,
    body: brief,
  });
}

// ---
// BUSINESS TEMPLATES
// ---
export interface BusinessTemplate {
  id: string;
  name: string;
  displayName: string;
  description: string;
  icon?: string;
  industry: string;
  archetype: string;
  config: Record<string, unknown>;
}
export async function fetchTemplates(): Promise<ApiResult<BusinessTemplate[]>> {
  return apiGetSimple<BusinessTemplate[]>(`/templates`);
}
export async function applyTemplate(businessId: string, templateId: string): Promise<ApiResult<{ message: string }>> {
  return apiPost<{ message: string }>({ path: `/businesses/${encodeURIComponent(businessId)}/templates/${templateId}/apply`, body: {} });
}

// ---
// EDUCATION / MASTERCLASS
// ---
export interface Course {
  id: string;
  title: string;
  description?: string;
  thumbnail?: string;
  category: string;
  difficulty: string;
  duration?: number;
  lessons: { id: string; title: string; content: string; order: number }[];
  isPublished: boolean;
  isFree: boolean;
  price?: number;
  _count?: { enrollments: number };
}
export interface CourseEnrollment {
  id: string;
  courseId: string;
  course?: Course;
  progress?: Record<string, boolean>;
  completedAt?: string;
  certificateId?: string;
}
export async function fetchCourses(): Promise<ApiResult<Course[]>> {
  return apiGetSimple<Course[]>(`/education/courses`);
}
export async function fetchCourse(id: string): Promise<ApiResult<Course>> {
  return apiGetSimple<Course>(`/education/courses/${id}`);
}
export async function enrollInCourse(businessId: string, courseId: string): Promise<ApiResult<CourseEnrollment>> {
  return apiPost<CourseEnrollment>({ path: `/businesses/${encodeURIComponent(businessId)}/education/enroll/${courseId}`, body: {} });
}
export async function updateCourseProgress(businessId: string, courseId: string, lessonId: string, completed: boolean): Promise<ApiResult<CourseEnrollment>> {
  return apiPatch<CourseEnrollment>(`/businesses/${encodeURIComponent(businessId)}/education/progress/${courseId}`, { lessonId, completed });
}
export async function fetchMyEnrollments(businessId: string): Promise<ApiResult<CourseEnrollment[]>> {
  return apiGetSimple<CourseEnrollment[]>(`/businesses/${encodeURIComponent(businessId)}/education/enrollments`);
}

// ---
// COMMUNITY
// ---
export interface CommunityPost {
  id: string;
  title?: string;
  content: string;
  type: string;
  tags: string[];
  likes: number;
  isPinned: boolean;
  businessId: string;
  business?: { name: string; logoUrl?: string };
  _count?: { comments: number };
  createdAt: string;
}
export interface CommunityComment {
  id: string;
  content: string;
  postId: string;
  businessId: string;
  business?: { name: string };
  likes: number;
  createdAt: string;
}
export interface Cohort {
  id: string;
  name: string;
  description?: string;
  maxMembers: number;
  industry?: string;
  isActive: boolean;
  _count?: { members: number };
}
export async function fetchCommunityPosts(params?: { type?: string }): Promise<ApiResult<CommunityPost[]>> {
  const q = params?.type ? `?type=${params.type}` : '';
  return apiGetSimple<CommunityPost[]>(`/community/posts${q}`);
}
export async function createCommunityPost(businessId: string, data: { title?: string; content: string; type?: string; tags?: string[] }): Promise<ApiResult<CommunityPost>> {
  return apiPost<CommunityPost>({ path: `/businesses/${encodeURIComponent(businessId)}/community/posts`, body: data });
}
export async function likeCommunityPost(postId: string): Promise<ApiResult<CommunityPost>> {
  return apiPost<CommunityPost>({ path: `/community/posts/${postId}/like`, body: {} });
}
export async function fetchCommunityPost(postId: string): Promise<ApiResult<CommunityPost & { comments: CommunityComment[] }>> {
  return apiGetSimple<CommunityPost & { comments: CommunityComment[] }>(`/community/posts/${postId}`);
}
export async function addCommunityComment(businessId: string, postId: string, content: string): Promise<ApiResult<CommunityComment>> {
  return apiPost<CommunityComment>({ path: `/businesses/${encodeURIComponent(businessId)}/community/posts/${postId}/comments`, body: { content } });
}
export async function fetchCohorts(): Promise<ApiResult<Cohort[]>> {
  return apiGetSimple<Cohort[]>(`/community/cohorts`);
}
export async function joinCohort(businessId: string, cohortId: string): Promise<ApiResult<void>> {
  return apiPost<void>({ path: `/businesses/${encodeURIComponent(businessId)}/community/cohorts/${cohortId}/join`, body: {} });
}
export async function leaveCohort(businessId: string, cohortId: string): Promise<ApiResult<void>> {
  return apiDelete<void>(`/businesses/${encodeURIComponent(businessId)}/community/cohorts/${cohortId}/leave`);
}
export async function fetchMyCohorts(businessId: string): Promise<ApiResult<Cohort[]>> {
  return apiGetSimple<Cohort[]>(`/businesses/${encodeURIComponent(businessId)}/community/my-cohorts`);
}


// ---
// BUSINESS SIMULATION
// ---
export interface SimulationResult {
  simulation: string;
}
export async function runSimulation(businessId: string, scenario: string, variables?: Record<string, any>): Promise<ApiResult<SimulationResult>> {
  return apiPost<SimulationResult>({ path: `/businesses/${encodeURIComponent(businessId)}/ai/simulate`, body: { scenario, variables } });
}

// ---
// SEO SCORING
// ---
export interface SeoScore {
  score: number;
  grade: string;
  issues: string[];
  suggestions: string[];
}
export async function scoreSEO(businessId: string, data: { title?: string; description?: string; content?: string; url?: string }): Promise<ApiResult<SeoScore>> {
  return apiPost<SeoScore>({ path: `/businesses/${encodeURIComponent(businessId)}/ai/seo-score`, body: data });
}

// ---
// WEBHOOKS / INTEGRATIONS
// ---
export interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  events: string[];
  secret: string;
  isActive: boolean;
  createdAt: string;
}
export async function fetchWebhooks(businessId: string): Promise<ApiResult<WebhookConfig[]>> {
  return apiGetSimple<WebhookConfig[]>(`/businesses/${encodeURIComponent(businessId)}/webhooks`);
}
export async function createWebhook(businessId: string, data: { url: string; events: string[]; name?: string }): Promise<ApiResult<WebhookConfig>> {
  return apiPost<WebhookConfig>({ path: `/businesses/${encodeURIComponent(businessId)}/webhooks`, body: data });
}
export async function deleteWebhook(businessId: string, webhookId: string): Promise<ApiResult<void>> {
  return apiDelete<void>(`/businesses/${encodeURIComponent(businessId)}/webhooks/${webhookId}`);
}

// ---
// CONTACT LISTS
// ---
export interface ContactList {
  id: string;
  businessId: string;
  name: string;
  description?: string | null;
  color?: string | null;
  type: string;
  filters?: any;
  contactIds: string[];
  createdAt: string;
  updatedAt: string;
}

const contactListSchema = z.object({
  id: z.string(),
  businessId: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  type: z.string(),
  filters: z.unknown().nullable().optional(),
  contactIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export async function fetchContactLists(businessId: string = DEFAULT_BUSINESS_ID): Promise<ApiResult<ContactList[]>> {
  return apiGet(
    `/crm/businesses/${encodeURIComponent(businessId)}/lists`,
    z.array(contactListSchema),
    [],
  );
}

export async function createContactList(
  businessId: string,
  data: { name: string; description?: string; color?: string; type?: string; filters?: any; contactIds?: string[] },
): Promise<ApiResult<ContactList>> {
  return apiPost<ContactList>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/lists`,
    body: data,
  });
}

export async function updateContactList(
  businessId: string,
  listId: string,
  data: { name?: string; description?: string; color?: string; type?: string; filters?: any; contactIds?: string[] },
): Promise<ApiResult<ContactList>> {
  const url = `${API_BASE}/crm/businesses/${encodeURIComponent(businessId)}/lists/${encodeURIComponent(listId)}`;
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) return { data: null, error: (json as any)?.message ?? res.statusText };
    return { data: json as ContactList, error: null };
  } catch (e: any) {
    return { data: null, error: e.message ?? 'Network error' };
  }
}

export async function deleteContactList(businessId: string, listId: string): Promise<ApiResult<void>> {
  return apiDelete<void>(`/crm/businesses/${encodeURIComponent(businessId)}/lists/${encodeURIComponent(listId)}`);
}

export async function fetchContactListContacts(businessId: string, listId: string): Promise<ApiResult<Contact[]>> {
  return apiGet(
    `/crm/businesses/${encodeURIComponent(businessId)}/lists/${encodeURIComponent(listId)}/contacts`,
    z.array(contactSchema),
    [],
  );
}

export async function addContactsToList(
  businessId: string,
  listId: string,
  contactIds: string[],
): Promise<ApiResult<ContactList>> {
  return apiPost<ContactList>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/lists/${encodeURIComponent(listId)}/contacts`,
    body: { contactIds },
  });
}

export async function removeContactFromList(
  businessId: string,
  listId: string,
  contactId: string,
): Promise<ApiResult<void>> {
  return apiDelete<void>(
    `/crm/businesses/${encodeURIComponent(businessId)}/lists/${encodeURIComponent(listId)}/contacts/${encodeURIComponent(contactId)}`,
  );
}

export type AiSuggestedAction = {
  type: string;
  contactId?: string;
  contactName?: string;
  title: string;
  description: string;
  priority: "urgent" | "high" | "medium" | "low";
};

export type AiAutomatedTask = {
  contactId: string;
  contactName?: string;
  title: string;
  dueDate: string;
  priority: "HIGH" | "NORMAL" | "LOW";
};

export type AiAnalysisResult = {
  analysis: string;
  suggestedActions: AiSuggestedAction[];
  guidelines: string[];
  automatedTasks: AiAutomatedTask[];
};

export async function aiAnalyzeContacts(
  businessId: string,
  prompt: string,
  contactIds?: string[],
): Promise<ApiResult<AiAnalysisResult>> {
  return apiPost<AiAnalysisResult>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/ai-analyze`,
    body: { prompt, contactIds },
  });
}

export async function aiExecuteTasks(
  businessId: string,
  tasks: AiAutomatedTask[],
): Promise<ApiResult<{ created: number; failed: number }>> {
  return apiPost<{ created: number; failed: number }>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/ai-analyze/execute`,
    body: { tasks },
  });
}

export async function fetchAiGuidelines(
  businessId: string,
): Promise<ApiResult<{ guidelines: string[]; generatedAt: string | null }>> {
  const fallback = { guidelines: [] as string[], generatedAt: null as string | null };
  return apiGetSimple(
    `/crm/businesses/${encodeURIComponent(businessId)}/ai-guidelines`,
    z.object({ guidelines: z.array(z.string()), generatedAt: z.string().nullable() }),
    fallback,
  );
}

export async function saveAiGuidelines(
  businessId: string,
  guidelines: string[],
): Promise<ApiResult<void>> {
  return apiPost<void>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/ai-guidelines`,
    body: { guidelines },
  });
}

export type CrmSequenceStep = {
  stepNumber: number;
  type: 'email' | 'whatsapp' | 'call' | 'wait';
  delayDays: number;
  subject?: string;
  template?: string;
  notes?: string;
};

export type CrmSequence = {
  id: string;
  businessId: string;
  name: string;
  description: string | null;
  steps: CrmSequenceStep[];
  status: string;
  createdAt: string;
  updatedAt: string;
  enrollmentCount?: number;
};

export type CrmSequenceEnrollment = {
  id: string;
  contactId: string;
  contactName: string;
  contactEmail: string | null;
  contactStatus: string;
  currentStep: number;
  status: string;
  nextStepAt: string | null;
  startedAt: string;
  completedAt: string | null;
};

export type CrmSequenceDetail = CrmSequence & {
  enrollments: CrmSequenceEnrollment[];
};

export async function fetchSequences(businessId: string = DEFAULT_BUSINESS_ID): Promise<ApiResult<CrmSequence[]>> {
  return apiGetSimple<CrmSequence[]>(`/crm/businesses/${encodeURIComponent(businessId)}/sequences`);
}

export async function createSequence(
  businessId: string = DEFAULT_BUSINESS_ID,
  data: { name: string; description?: string; steps: CrmSequenceStep[] },
): Promise<ApiResult<CrmSequence>> {
  return apiPost<CrmSequence>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/sequences`,
    body: data,
  });
}

export async function fetchSequenceDetail(
  businessId: string,
  sequenceId: string,
): Promise<ApiResult<CrmSequenceDetail>> {
  return apiGetSimple<CrmSequenceDetail>(
    `/crm/businesses/${encodeURIComponent(businessId)}/sequences/${encodeURIComponent(sequenceId)}`,
  );
}

export async function updateSequence(
  businessId: string,
  sequenceId: string,
  data: { name?: string; description?: string; steps?: CrmSequenceStep[]; status?: string },
): Promise<ApiResult<CrmSequence>> {
  return apiPatch<CrmSequence>(
    `/crm/businesses/${encodeURIComponent(businessId)}/sequences/${encodeURIComponent(sequenceId)}`,
    data,
  );
}

export async function deleteSequence(
  businessId: string,
  sequenceId: string,
): Promise<ApiResult<{ success: boolean }>> {
  return apiDelete<{ success: boolean }>(
    `/crm/businesses/${encodeURIComponent(businessId)}/sequences/${encodeURIComponent(sequenceId)}`,
  );
}

export async function duplicateSequence(
  businessId: string,
  sequenceId: string,
): Promise<ApiResult<CrmSequence>> {
  return apiPost<CrmSequence>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/sequences/${encodeURIComponent(sequenceId)}/duplicate`,
    body: {},
  });
}

export async function enrollContactsInSequence(
  businessId: string,
  sequenceId: string,
  contactIds: string[],
): Promise<ApiResult<{ enrolled: number; skipped: number }>> {
  return apiPost<{ enrolled: number; skipped: number }>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/sequences/${encodeURIComponent(sequenceId)}/enroll`,
    body: { contactIds },
  });
}

export async function advanceSequenceEnrollment(
  businessId: string,
  sequenceId: string,
  enrollmentId: string,
): Promise<ApiResult<{ status: string; currentStep: number; nextStepAt?: string }>> {
  return apiPost<{ status: string; currentStep: number; nextStepAt?: string }>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/sequences/${encodeURIComponent(sequenceId)}/enrollments/${encodeURIComponent(enrollmentId)}/advance`,
    body: {},
  });
}

export async function unenrollFromSequence(
  businessId: string,
  sequenceId: string,
  enrollmentId: string,
): Promise<ApiResult<{ success: boolean }>> {
  return apiPost<{ success: boolean }>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/sequences/${encodeURIComponent(sequenceId)}/enrollments/${encodeURIComponent(enrollmentId)}/unenroll`,
    body: {},
  });
}

export type AiContactSummary = {
  summary: string;
  sentiment: 'positive' | 'neutral' | 'negative' | 'at_risk';
  keyInsights: string[];
  recommendedAction: string;
  relationshipHealth: 'strong' | 'good' | 'neutral' | 'weak' | 'critical';
  revenueImpact: 'high' | 'medium' | 'low';
  creditsUsed: number;
};

export type AiLeadScore = {
  score: number;
  label: 'Hot' | 'Warm' | 'Neutral' | 'Cool' | 'Cold';
  reasoning: string;
  factors: Array<{ name: string; impact: 'positive' | 'neutral' | 'negative'; detail: string }>;
  recommendation: string;
  creditsUsed: number;
};

export type AiNoteAnalysis = {
  sentiment: 'positive' | 'neutral' | 'negative' | 'urgent';
  sentimentConfidence: number;
  actionItems: Array<{ title: string; priority: string; dueInDays: number }>;
  suggestedTags: string[];
  riskFlags: string[];
  keyEntities: string[];
  summary: string;
  creditsUsed: number;
};

export type AiChurnRisk = {
  atRisk: Array<{
    contactId: string;
    contactName: string;
    churnProbability: number;
    riskLevel: 'critical' | 'high' | 'medium';
    reasons: string[];
    recommendedAction: string;
    estimatedRevenueLoss: number;
  }>;
  summary: string;
  creditsUsed: number;
};

export type AiSearchResult = {
  contacts: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    status: string;
    companyName: string | null;
    leadScore: number | null;
    tags: string[];
    lastInteractionAt: string | null;
    createdAt: string;
  }>;
  filters: Record<string, unknown>;
  interpretation: string;
  confidence: number;
  totalResults: number;
  creditsUsed: number;
};

export async function aiContactSummary(contactId: string, businessId?: string): Promise<ApiResult<AiContactSummary>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<AiContactSummary>({
    path: `/crm/businesses/${encodeURIComponent(bid)}/contacts/${encodeURIComponent(contactId)}/ai-summary`,
    body: {},
  });
}

export async function aiLeadScore(contactId: string, businessId?: string): Promise<ApiResult<AiLeadScore>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<AiLeadScore>({
    path: `/crm/businesses/${encodeURIComponent(bid)}/contacts/${encodeURIComponent(contactId)}/ai-score`,
    body: {},
  });
}

export type AiTagSuggestion = {
  tag: string;
  confidence: number;
  reasoning: string;
};

export type AiTagSuggestionsResult = {
  suggestedTags: AiTagSuggestion[];
  currentTags: string[];
  creditsUsed: number;
};

export async function aiSuggestTags(contactId: string, businessId?: string): Promise<ApiResult<AiTagSuggestionsResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<AiTagSuggestionsResult>({
    path: `/crm/businesses/${encodeURIComponent(bid)}/contacts/${encodeURIComponent(contactId)}/ai-tags`,
    body: {},
  });
}

export async function aiNoteAnalysis(contactId: string, noteBody: string, noteId?: string, businessId?: string): Promise<ApiResult<AiNoteAnalysis>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<AiNoteAnalysis>({
    path: `/crm/businesses/${encodeURIComponent(bid)}/contacts/${encodeURIComponent(contactId)}/ai-note-analysis`,
    body: { noteBody, noteId },
  });
}

export async function aiChurnDetection(businessId?: string): Promise<ApiResult<AiChurnRisk>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet<AiChurnRisk>(
    `/crm/businesses/${encodeURIComponent(bid)}/ai-churn-risk`,
    z.any(),
  );
}

export async function aiNaturalLanguageSearch(query: string, businessId?: string): Promise<ApiResult<AiSearchResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<AiSearchResult>({
    path: `/crm/businesses/${encodeURIComponent(bid)}/ai-search`,
    body: { query },
  });
}

export type AiPrepBrief = {
  keyInfo: {
    summary: string;
    relationshipHealth: string;
    sentiment: string;
    lastContactSummary: string;
  };
  openItems: Array<{
    type: string;
    title: string;
    urgency: string;
    detail: string;
  }>;
  suggestedTopics: Array<{
    topic: string;
    reason: string;
    approach: string;
  }>;
  relationshipSignals: {
    positive: string[];
    concerns: string[];
    opportunities: string[];
  };
  icebreakers: string[];
  thingsToAvoid: string[];
  talkingPoints: string[];
  creditsUsed: number;
};

export async function aiPrepBrief(contactId: string, businessId?: string): Promise<ApiResult<AiPrepBrief>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<AiPrepBrief>({
    path: `/crm/businesses/${encodeURIComponent(bid)}/contacts/${encodeURIComponent(contactId)}/ai-prep-brief`,
    body: {},
  });
}

export type AiCommandResult = {
  isAction: boolean;
  action: string;
  contactId: string | null;
  contactName: string | null;
  params: Record<string, unknown>;
  confirmation: string;
  confidence: number;
  creditsUsed: number;
};

export async function aiInterpretCommand(command: string, businessId?: string): Promise<ApiResult<AiCommandResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<AiCommandResult>({
    path: `/crm/businesses/${encodeURIComponent(bid)}/ai-command`,
    body: { command },
  });
}

export type AiExecuteResult = {
  success: boolean;
  message: string;
  data: Record<string, unknown> | null;
};

export async function aiExecuteCommand(
  action: string,
  params?: Record<string, unknown>,
  contactId?: string,
  businessId?: string,
): Promise<ApiResult<AiExecuteResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<AiExecuteResult>({
    path: `/crm/businesses/${encodeURIComponent(bid)}/ai-execute`,
    body: { action, contactId, params },
  });
}

export type AiDataQualityResult = {
  totalContacts: number;
  contactsWithIssues: number;
  averageCompleteness: number;
  topIssues: Array<{ contactId: string; contactName: string; missingFields: string[]; completeness: number }>;
  fieldBreakdown: Array<{ field: string; missing: number; percentage: number }>;
};

export async function aiDataQualityScan(businessId?: string): Promise<ApiResult<AiDataQualityResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet<AiDataQualityResult>({
    path: `/crm/businesses/${encodeURIComponent(bid)}/ai-data-quality`,
  });
}

export type AiDuplicatesResult = {
  totalContacts: number;
  duplicateClusters: Array<{
    contacts: Array<{ id: string; name: string; email: string | null; phone: string | null }>;
    reason: string;
    confidence: number;
  }>;
  estimatedDuplicates: number;
};

export async function aiFindDuplicates(businessId?: string): Promise<ApiResult<AiDuplicatesResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet<AiDuplicatesResult>({
    path: `/crm/businesses/${encodeURIComponent(bid)}/ai-duplicates`,
  });
}

export type AiReengagementResult = {
  totalStale: number;
  suggestions: Array<{
    contactId: string;
    contactName: string;
    email: string | null;
    status: string;
    daysSinceLastInteraction: number | null;
    leadScore: number | null;
    recommendedAction: string;
    urgency: 'high' | 'medium' | 'low';
    suggestedSequence: string | null;
  }>;
  availableSequences: Array<{ id: string; name: string }>;
};

export async function aiReengagementSuggestions(businessId?: string): Promise<ApiResult<AiReengagementResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet<AiReengagementResult>({
    path: `/crm/businesses/${encodeURIComponent(bid)}/ai-reengagement`,
  });
}

export type AiRevenueOpportunitiesResult = {
  opportunities: Array<{
    contactId: string;
    contactName: string;
    company: string | null;
    status: string;
    totalRevenue: number;
    opportunityType: string;
    estimatedValue: number;
    leadScore: number | null;
  }>;
  totalEstimatedRevenue: number;
  contactsAnalyzed: number;
};

export async function aiRevenueOpportunities(businessId?: string): Promise<ApiResult<AiRevenueOpportunitiesResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet<AiRevenueOpportunitiesResult>({
    path: `/crm/businesses/${encodeURIComponent(bid)}/ai-revenue-opportunities`,
  });
}

export type AiFollowUpDraftResult = {
  messages: Array<{
    tone: string;
    subject: string;
    body: string;
    channel: string;
  }>;
  context: string;
  bestTime: string;
  contactName: string;
  creditsUsed: number;
};

export async function aiFollowUpDraft(contactId: string, businessId?: string): Promise<ApiResult<AiFollowUpDraftResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<AiFollowUpDraftResult>({
    path: `/crm/businesses/${encodeURIComponent(bid)}/contacts/${encodeURIComponent(contactId)}/ai-follow-up-draft`,
    body: {},
  });
}

export type CommerceStats = {
  totalRevenue: number;
  outstandingAmount: number;
  overdueAmount: number;
  monthlyPaid: number;
  invoiceCount: number;
  quoteCount: number;
  productCount: number;
  activeProductCount: number;
  averageInvoiceValue: number;
  quoteConversionRate: number;
  invoiceStatusBreakdown: Record<string, { count: number; total: number }>;
  quoteStatusBreakdown: Record<string, number>;
  topProducts: { name: string; revenue: number; count: number }[];
  revenueByMonth: { month: string; revenue: number; invoiceCount: number }[];
};

export type CommerceHealthResponse = {
  status: string;
  db: boolean;
  cache: { hits: number; misses: number; hitRate: number; size: number };
  uptime: number;
  responseMs: number;
};

export type CommerceRevenueAnalysis = {
  summary: string;
  trends: { label: string; direction: string; detail: string; impact: string }[];
  topClients: { name: string; revenue: number; invoiceCount: number; trend: string }[];
  recommendations: { title: string; description: string; priority: string; estimatedImpact: string }[];
  healthScore: number;
  healthLabel: string;
};

export type CommerceCashFlowForecast = {
  summary: string;
  forecast: {
    thirtyDay?: { expected: number; optimistic: number; conservative: number };
    sixtyDay?: { expected: number; optimistic: number; conservative: number };
    ninetyDay?: { expected: number; optimistic: number; conservative: number };
  };
  risks: { description: string; severity: string; mitigation: string }[];
  opportunities: { description: string; estimatedValue: number; timeframe: string }[];
  collectionPriority: { invoiceRef: string; amount: number; daysPastDue: number; contactName: string; suggestedAction: string }[];
};

export type CommerceInvoiceReminder = {
  subject: string;
  message: string;
  tone: string;
  suggestedFollowUpDate?: string;
  alternativeMessages: { tone: string; message: string }[];
};

export type CommercePricingSuggestion = {
  currentPrice: number;
  suggestedPrice: number;
  priceRange?: { min: number; max: number };
  reasoning: string;
  factors: { factor: string; impact: string; detail: string }[];
  strategies: { name: string; description: string; expectedImpact: string }[];
  competitivePosition?: string;
};

export type CommerceCommandResult = {
  isAction: boolean;
  action: string | null;
  params: Record<string, any>;
  confirmation: string;
  confidence: number;
};

export type CommerceExecuteResult = {
  success: boolean;
  message?: string;
  error?: string;
  action?: string;
  params?: Record<string, any>;
  invoiceId?: string;
  productId?: string;
};

export async function fetchCommerceStats(businessId?: string): Promise<ApiResult<CommerceStats>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet<CommerceStats>(`/commerce/businesses/${encodeURIComponent(bid)}/stats`);
}

export async function fetchCommerceHealth(): Promise<ApiResult<CommerceHealthResponse>> {
  return apiGet<CommerceHealthResponse>('/commerce/health');
}

export async function commerceAiAnalyze(businessId?: string): Promise<ApiResult<CommerceRevenueAnalysis>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<CommerceRevenueAnalysis>({
    path: `/commerce/businesses/${encodeURIComponent(bid)}/ai-analyze`,
    body: {},
  });
}

export async function commerceAiInvoiceReminder(invoiceId: string, businessId?: string): Promise<ApiResult<CommerceInvoiceReminder>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<CommerceInvoiceReminder>({
    path: `/commerce/businesses/${encodeURIComponent(bid)}/invoices/${encodeURIComponent(invoiceId)}/ai-reminder`,
    body: {},
  });
}

export async function commerceAiPricing(productId: string, businessId?: string): Promise<ApiResult<CommercePricingSuggestion>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<CommercePricingSuggestion>({
    path: `/commerce/businesses/${encodeURIComponent(bid)}/products/${encodeURIComponent(productId)}/ai-pricing`,
    body: {},
  });
}

export async function commerceAiCashFlow(businessId?: string): Promise<ApiResult<CommerceCashFlowForecast>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet<CommerceCashFlowForecast>(`/commerce/businesses/${encodeURIComponent(bid)}/ai-cashflow`);
}

export async function commerceAiCommand(command: string, businessId?: string): Promise<ApiResult<CommerceCommandResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<CommerceCommandResult>({
    path: `/commerce/businesses/${encodeURIComponent(bid)}/ai-command`,
    body: { command },
  });
}

export async function commerceAiExecute(action: string, params: Record<string, any> = {}, businessId?: string): Promise<ApiResult<CommerceExecuteResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<CommerceExecuteResult>({
    path: `/commerce/businesses/${encodeURIComponent(bid)}/ai-execute`,
    body: { action, params },
  });
}

export type ExtractedProduct = {
  name?: string;
  description?: string;
  price?: number;
  currency?: string;
  category?: 'SERVICE' | 'PRODUCT' | 'PACKAGE';
  duration?: number;
  sku?: string;
};

export async function scanProductImage(imageFile: File, businessId?: string, currency?: string): Promise<ApiResult<{ extracted: ExtractedProduct[]; count: number }>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  const formData = new FormData();
  formData.append('image', imageFile);
  if (currency) formData.append('currency', currency);
  try {
    const headers = getAuthHeaders();
    const res = await fetch(`${API_BASE}/commerce/businesses/${encodeURIComponent(bid)}/products/import/scan`, {
      method: 'POST',
      headers,
      body: formData,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) {
      const message = (json as any)?.message ?? res.statusText;
      return { data: null, error: message };
    }
    return { data: json, error: null };
  } catch (error: unknown) {
    return { data: null, error: error instanceof Error ? error.message : 'Network error' };
  }
}

export async function importProductsFile(file: File, businessId?: string): Promise<ApiResult<{ extracted: ExtractedProduct[]; count: number }>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  const formData = new FormData();
  formData.append('file', file);
  try {
    const headers = getAuthHeaders();
    const res = await fetch(`${API_BASE}/commerce/businesses/${encodeURIComponent(bid)}/products/import/file`, {
      method: 'POST',
      headers,
      body: formData,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) {
      const message = (json as any)?.message ?? res.statusText;
      return { data: null, error: message };
    }
    return { data: json, error: null };
  } catch (error: unknown) {
    return { data: null, error: error instanceof Error ? error.message : 'Network error' };
  }
}

export async function confirmProductImport(products: Partial<ExtractedProduct>[], businessId?: string): Promise<ApiResult<{ created: Product[]; count: number }>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<{ created: Product[]; count: number }>({
    path: `/commerce/businesses/${encodeURIComponent(bid)}/products/import/confirm`,
    body: { products },
  });
}

export type CommerceNlSearchResult = {
  type: string;
  filters: Record<string, unknown>;
  interpretation: string;
  confidence: number;
  results: Array<Record<string, any>>;
};

export type CommerceProductHealthResult = {
  healthScore: number;
  healthLabel: string;
  summary: { totalProducts: number; activeProducts: number; inactiveProducts: number; productsWithSales: number; productsWithoutSales: number };
  issues: Array<{
    productId: string;
    productName: string;
    severity: string;
    issue: string;
    suggestion: string;
  }>;
  issueCount: { high: number; medium: number; low: number };
};

export type CommerceClientIntelligenceResult = {
  contactId: string;
  contactName: string;
  reliabilityScore: number;
  reliabilityLabel: string;
  lifetimeValue: number;
  outstandingBalance: number;
  avgPaymentDelay: number;
  paymentDelayLabel: string;
  invoiceSummary: { total: number; paid: number; overdue: number; outstanding: number; void: number };
  quoteSummary: { total: number; accepted: number; conversionRate: number };
  avgMonthlyRevenue: number;
  monthsActive: number;
  recentInvoices: Array<{
    id: string;
    invoiceNumber: string;
    status: string;
    total: number;
    currency: string;
    createdAt: string;
    dueDate: string;
    paidAt: string | null;
  }>;
  totalPayments: number;
};

export type CommerceQuoteAnalysisResult = {
  conversionRate: number;
  rejectionRate: number;
  summary: { total: number; accepted: number; rejected: number; sent: number; draft: number; expired: number; converted: number };
  values: { avgAcceptedValue: number; avgRejectedValue: number; pipelineValue: number; totalWonValue: number; totalLostValue: number };
  suggestions: string[];
  recentQuotes: Array<{
    id: string;
    quoteNumber: string;
    status: string;
    total: number;
    currency: string;
    contactName: string;
    createdAt: string;
    expiryDate: string | null;
    converted: boolean;
  }>;
};

export async function commerceAiSearch(query: string, businessId?: string): Promise<ApiResult<CommerceNlSearchResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<CommerceNlSearchResult>({
    path: `/commerce/businesses/${encodeURIComponent(bid)}/ai-search`,
    body: { query },
  });
}

export async function commerceAiProductHealth(businessId?: string): Promise<ApiResult<CommerceProductHealthResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<CommerceProductHealthResult>({
    path: `/commerce/businesses/${encodeURIComponent(bid)}/ai-product-health`,
    body: {},
  });
}

export async function commerceAiClientIntelligence(contactId: string, businessId?: string): Promise<ApiResult<CommerceClientIntelligenceResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<CommerceClientIntelligenceResult>({
    path: `/commerce/businesses/${encodeURIComponent(bid)}/ai-client-intelligence`,
    body: { contactId },
  });
}

export async function commerceAiQuoteAnalysis(businessId?: string): Promise<ApiResult<CommerceQuoteAnalysisResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<CommerceQuoteAnalysisResult>({
    path: `/commerce/businesses/${encodeURIComponent(bid)}/ai-quote-analysis`,
    body: {},
  });
}

export type BookingsAiSearchResult = {
  type: string;
  filters: Record<string, unknown>;
  interpretation: string;
  confidence: number;
  results: unknown[];
};

export type BookingsScheduleOptimizerResult = {
  summary: string;
  peakHours: { hour: number; bookings: number; label: string }[];
  peakDays: { day: string; bookings: number }[];
  gaps: { description: string; suggestion: string }[];
  recommendations: { title: string; description: string; impact: string; category: string }[];
  utilizationScore: number;
  utilizationLabel: string;
};

export type BookingsNoShowResult = {
  summary: string;
  overallCancellationRate: number;
  atRiskBookings: {
    bookingId: string;
    clientName: string;
    serviceName: string;
    scheduledTime: string;
    riskScore: number;
    riskLevel: string;
    reasons: string[];
    suggestedAction: string;
  }[];
  patterns: { pattern: string; impact: string }[];
  recommendations: { title: string; description: string; expectedImpact: string }[];
};

export type BookingsRevenueInsightsResult = {
  summary: string;
  totalRevenue: number;
  revenueGrowth: number;
  averageBookingValue: number;
  topServices: { name: string; revenue: number; bookings: number; revenuePerHour: number }[];
  topStaff: { name: string; revenue: number; bookings: number }[];
  peakHours: { hour: string; revenue: number }[];
  trends: { trend: string; direction: string; impact: string }[];
  recommendations: { title: string; description: string; expectedImpact: string; priority: string }[];
  revenueHealthScore: number;
  revenueHealthLabel: string;
};

export async function bookingsAiSearch(query: string, businessId?: string): Promise<ApiResult<BookingsAiSearchResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<BookingsAiSearchResult>({
    path: `/bookings/businesses/${encodeURIComponent(bid)}/ai-search`,
    body: { query },
  });
}

export async function bookingsAiScheduleOptimizer(businessId?: string): Promise<ApiResult<BookingsScheduleOptimizerResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<BookingsScheduleOptimizerResult>({
    path: `/bookings/businesses/${encodeURIComponent(bid)}/ai-schedule-optimizer`,
    body: {},
  });
}

export async function bookingsAiNoShowPredictor(businessId?: string): Promise<ApiResult<BookingsNoShowResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<BookingsNoShowResult>({
    path: `/bookings/businesses/${encodeURIComponent(bid)}/ai-no-show-predictor`,
    body: {},
  });
}

export async function bookingsAiRevenueInsights(businessId?: string): Promise<ApiResult<BookingsRevenueInsightsResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<BookingsRevenueInsightsResult>({
    path: `/bookings/businesses/${encodeURIComponent(bid)}/ai-revenue-insights`,
    body: {},
  });
}

export { DEFAULT_BUSINESS_ID };
