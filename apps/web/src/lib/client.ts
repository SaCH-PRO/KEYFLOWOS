import { z } from "zod";
import { API_BASE, apiPost, apiPostSimple, apiPatch, apiPut, apiDelete, apiGet as apiGetSimple, getAuthHeaders, emitUnauthorizedEvent, type PlanLimitError } from "./api";

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
  ageGroup: z.string().nullable().optional(),
  relationshipType: z.string().nullable().optional(),
  pipelineStage: z.string().nullable().optional(),
  relationshipHealth: z.string().nullable().optional(),
  lastContactedAt: z.string().nullable().optional(),
  nextActionAt: z.string().nullable().optional(),
  nextActionType: z.string().nullable().optional(),
  priority: z.string().nullable().optional(),
  favorite: z.boolean().nullable().optional(),
  archivedAt: z.string().nullable().optional(),
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
  notes: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  locationPlaceId: z.string().nullable().optional(),
  locationLatLng: z.object({ lat: z.number(), lng: z.number() }).nullable().optional(),
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
    bufferMins: z.number().nullable().optional(),
    leadTimeMins: z.number().nullable().optional(),
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

type ApiResult<T> = { data: T | null; error: string | null; planLimitReached?: PlanLimitError | null };


const fallbackBookings: Booking[] = [
  { id: "bk_1", startTime: new Date().toISOString(), endTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(), status: "CONFIRMED" },
  { id: "bk_2", startTime: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), endTime: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(), status: "PENDING" },
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
      if (res.status === 401) emitUnauthorizedEvent(path);
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
    ageGroups?: string[];
    relationshipTypes?: string[];
    priorities?: string[];
    relationshipHealth?: string[];
    pipelineStages?: string[];
    favorite?: boolean;
    includeArchived?: boolean;
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
  if (opts?.ageGroups?.length) opts.ageGroups.forEach((g) => params.append("ageGroups", g));
  if (opts?.relationshipTypes?.length) opts.relationshipTypes.forEach((g) => params.append("relationshipTypes", g));
  if (opts?.priorities?.length) opts.priorities.forEach((g) => params.append("priorities", g));
  if (opts?.relationshipHealth?.length) opts.relationshipHealth.forEach((g) => params.append("relationshipHealth", g));
  if (opts?.pipelineStages?.length) opts.pipelineStages.forEach((g) => params.append("pipelineStages", g));
  if (opts?.favorite !== undefined) params.set("favorite", String(opts.favorite));
  if (opts?.includeArchived) params.set("includeArchived", "true");
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
  type: z.enum(["follow_up", "send_quote", "payment_reminder", "add_note", "review_request", "referral_request", "thank_you", "re_engage"]),
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
    payments: z.array(z.object({
      id: z.string(),
      amount: z.number(),
      currency: z.string(),
      status: z.string(),
      provider: z.string(),
      providerPaymentId: z.string(),
      createdAt: z.string(),
      businessId: z.string(),
      invoiceId: z.string(),
    })).optional(),
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
  ageGroup?: string | null;
  relationshipType?: string | null;
  pipelineStage?: string | null;
  relationshipHealth?: string | null;
  nextActionAt?: string | null;
  nextActionType?: string | null;
  priority?: string | null;
  favorite?: boolean;
  archivedAt?: string | null;
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
    ageGroup: input.ageGroup,
    relationshipType: input.relationshipType,
    pipelineStage: input.pipelineStage,
    relationshipHealth: input.relationshipHealth,
    nextActionAt: input.nextActionAt,
    nextActionType: input.nextActionType,
    priority: input.priority,
    favorite: input.favorite,
    archivedAt: input.archivedAt,
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
  return apiPatch(
    `/crm/businesses/${encodeURIComponent(businessId)}/notes/${encodeURIComponent(noteId)}`,
    data,
  );
}

export async function deleteContactNote(noteId: string, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiDelete(`/crm/businesses/${encodeURIComponent(businessId)}/notes/${encodeURIComponent(noteId)}`);
}

export async function updateContactTask(taskId: string, data: { title?: string; dueDate?: string; priority?: string; remindAt?: string }, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiPatch(
    `/crm/businesses/${encodeURIComponent(businessId)}/tasks/${encodeURIComponent(taskId)}`,
    data,
  );
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

export async function fetchDuplicateContacts(
  businessId: string = DEFAULT_BUSINESS_ID,
  opts?: { importId?: string; minConfidence?: number; limit?: number; offset?: number },
) {
  const duplicateGroupSchema = z.object({
    field: z.enum(["email", "phone", "name"]),
    value: z.string(),
    contacts: z.array(contactSchema),
  });
  const candidateSchema = z.object({
    id: z.string(),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
    displayName: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    companyName: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    createdAt: z.string().or(z.date()).optional(),
  });
  const pairSchema = z.object({
    primaryId: z.string(),
    duplicateId: z.string(),
    rule: z.string(),
    confidence: z.number(),
    reason: z.string(),
    primary: candidateSchema,
    duplicate: candidateSchema,
  });
  const duplicatesSchema = z.object({
    pairs: z.array(pairSchema).optional().default([]),
    groups: z.array(duplicateGroupSchema).optional().default([]),
    total: z.number().optional().default(0),
    offset: z.number().optional().default(0),
    limit: z.number().optional().default(0),
  });
  const params = new URLSearchParams();
  if (opts?.importId) params.set("importId", opts.importId);
  if (opts?.minConfidence !== undefined) params.set("minConfidence", String(opts.minConfidence));
  if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts?.offset !== undefined) params.set("offset", String(opts.offset));
  const qs = params.toString();
  return apiGet(
    `/crm/businesses/${encodeURIComponent(businessId)}/duplicates${qs ? `?${qs}` : ""}`,
    duplicatesSchema,
    { pairs: [], groups: [], total: 0, offset: 0, limit: 0 },
  );
}

export async function fetchMergePreview(input: { businessId?: string; primaryId: string; duplicateId: string }) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  const path = `/crm/businesses/${encodeURIComponent(businessId)}/duplicates/preview/${encodeURIComponent(input.primaryId)}/${encodeURIComponent(input.duplicateId)}`;
  return apiGetSimple<{
    primary: Record<string, unknown>;
    duplicate: Record<string, unknown>;
    fields: Array<{ key: string; label: string; primaryValue: unknown; duplicateValue: unknown; conflict: boolean; recommended: 'primary' | 'duplicate' }>;
    customFields: Array<{ key: string; label: string; primaryValue: unknown; duplicateValue: unknown; conflict: boolean; recommended: 'primary' | 'duplicate' }>;
    mergedTags: string[];
    mergedCustom: Record<string, unknown>;
    relatedRecords: Record<string, number>;
  }>(path);
}

export async function revertMerge(input: { businessId?: string; mergeId: string }) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<{ mergeId: string; primaryId: string; duplicateId: string; revertedAt: string }>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/duplicates/merges/${encodeURIComponent(input.mergeId)}/revert`,
    body: {},
  });
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

const nextActionItemSchema = z.object({
  id: z.string(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  displayName: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  priority: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  nextActionAt: z.string().nullable(),
  nextActionType: z.string().nullable().optional(),
  overdue: z.boolean(),
});

export type NextActionItem = z.infer<typeof nextActionItemSchema>;

const nextActionsResponseSchema = z.object({
  windowDays: z.number(),
  now: z.string(),
  items: z.array(nextActionItemSchema),
});

export async function fetchContactNextActions(
  businessId: string = DEFAULT_BUSINESS_ID,
  windowDays = 7,
  limit = 25,
  opts?: { signal?: AbortSignal },
) {
  const params = new URLSearchParams({
    windowDays: String(windowDays),
    limit: String(limit),
  });
  return apiGet(
    `/crm/businesses/${encodeURIComponent(businessId)}/contact-next-actions?${params.toString()}`,
    nextActionsResponseSchema,
    { windowDays, now: new Date().toISOString(), items: [] },
    { signal: opts?.signal },
  );
}

export async function completeContactNextAction(
  contactId: string,
  businessId: string = DEFAULT_BUSINESS_ID,
) {
  return apiPost<Contact>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/contacts/${encodeURIComponent(contactId)}/next-action/complete`,
    body: {},
  });
}

export async function snoozeContactNextAction(
  contactId: string,
  input: { days?: number; snoozeUntil?: string },
  businessId: string = DEFAULT_BUSINESS_ID,
) {
  return apiPost<Contact>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/contacts/${encodeURIComponent(contactId)}/next-action/snooze`,
    body: input,
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

export async function bulkUpdateContacts(input: {
  businessId?: string;
  contactIds: string[];
  status?: string;
  addTags?: string[];
  relationshipType?: string | null;
  priority?: string | null;
  favorite?: boolean;
  archived?: boolean;
}) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPatch<{ updated: number }>(
    `/crm/businesses/${encodeURIComponent(businessId)}/contacts/bulk`,
    {
      contactIds: input.contactIds,
      status: input.status,
      addTags: input.addTags,
      relationshipType: input.relationshipType,
      priority: input.priority,
      favorite: input.favorite,
      archived: input.archived,
    },
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
  return apiPost<Contact & { mergeId?: string; revertableUntil?: string }>({
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
  ageGroup?: string | null;
  relationshipType?: string | null;
  pipelineStage?: string | null;
  relationshipHealth?: string | null;
  nextActionAt?: string | null;
  nextActionType?: string | null;
  priority?: string | null;
  favorite?: boolean;
  archivedAt?: string | null;
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
  notes?: string;
  location?: string;
  locationPlaceId?: string;
  locationLatLng?: { lat: number; lng: number };
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
      notes: input.notes ?? undefined,
      location: input.location ?? undefined,
      locationPlaceId: input.locationPlaceId ?? undefined,
      locationLatLng: input.locationLatLng ?? undefined,
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

export async function rescheduleBooking(bookingId: string, startTime: string, businessId?: string) {
  const bId = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<Booking>({
    path: `/bookings/businesses/${encodeURIComponent(bId)}/bookings/${encodeURIComponent(bookingId)}/reschedule`,
    body: { startTime },
  });
}

export async function updateBookingNotes(bookingId: string, notes: string, businessId?: string) {
  const bId = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<Booking>({
    path: `/bookings/businesses/${encodeURIComponent(bId)}/bookings/${encodeURIComponent(bookingId)}/notes`,
    body: { notes },
  });
}

export async function updateBookingLocation(
  bookingId: string,
  input: {
    location?: string | null;
    locationPlaceId?: string | null;
    locationLatLng?: { lat: number; lng: number } | null;
  },
  businessId?: string,
) {
  const bId = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPatch<Booking>(
    `/bookings/businesses/${encodeURIComponent(bId)}/bookings/${encodeURIComponent(bookingId)}`,
    {
      location: input.location ?? null,
      locationPlaceId: input.locationPlaceId ?? null,
      locationLatLng: input.locationLatLng ?? null,
    },
  );
}

export async function fetchReminderSettings(businessId?: string) {
  const bId = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet<{ bookingReminderMins: number }>(
    `/bookings/businesses/${encodeURIComponent(bId)}/reminder-settings`
  );
}

export async function updateReminderSettings(bookingReminderMins: number, businessId?: string) {
  const bId = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPatch<{ bookingReminderMins: number }>(
    `/bookings/businesses/${encodeURIComponent(bId)}/reminder-settings`,
    { bookingReminderMins },
  );
}

export async function fetchStaffAvailability(businessId: string, staffId: string) {
  return apiGet<{ id: string; dayOfWeek: number; startTime: string; endTime: string }[]>(
    `/bookings/businesses/${encodeURIComponent(businessId)}/staff/${encodeURIComponent(staffId)}/availability`
  );
}

export async function setStaffAvailability(businessId: string, staffId: string, slots: { dayOfWeek: number; startTime: string; endTime: string }[]) {
  return apiPost<{ id: string; dayOfWeek: number; startTime: string; endTime: string }[]>({
    path: `/bookings/businesses/${encodeURIComponent(businessId)}/staff/${encodeURIComponent(staffId)}/availability`,
    body: { slots },
  });
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

export async function bulkUpdateInvoices(businessId: string, ids: string[], action: "send" | "void" | "delete") {
  return apiPatch<{ updated: number; action: string }>(
    `/commerce/businesses/${encodeURIComponent(businessId)}/invoices/bulk`,
    { ids, action },
  );
}

export async function bulkUpdateQuotes(businessId: string, ids: string[], action: "send" | "reject" | "delete") {
  return apiPatch<{ updated: number; action: string }>(
    `/commerce/businesses/${encodeURIComponent(businessId)}/quotes/bulk`,
    { ids, action },
  );
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

export type BootstrapIdentityErrorCode = "account_email_conflict";

export type BootstrapIdentityResult = {
  data: BootstrapIdentityResponse | null;
  error: string | null;
  errorCode?: BootstrapIdentityErrorCode | null;
  status?: number;
};

/**
 * Bootstraps the local User + Business + Membership for the freshly-authed
 * Supabase user. Uses a direct fetch (rather than the shared `apiPost`)
 * because the OAuth callback page needs to switch on the structured error
 * body — specifically the 409 `account_email_conflict` path added in task
 * #309 — to render a friendly "this email already exists" screen instead
 * of a generic error string.
 */
export async function bootstrapIdentity(input: {
  username?: string;
  email?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  avatarUrl?: string;
  company?: string;
}): Promise<BootstrapIdentityResult> {
  try {
    const res = await fetch(`${API_BASE}/identity/bootstrap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      },
      body: JSON.stringify(input),
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const parsed = (typeof json === "object" && json !== null ? (json as Record<string, unknown>) : null);
      const nestedMessage = parsed && typeof parsed.message === "object" && parsed.message !== null
        ? (parsed.message as Record<string, unknown>)
        : null;
      const code =
        (nestedMessage && typeof nestedMessage.code === "string" ? (nestedMessage.code as string) : null) ??
        (parsed && typeof parsed.code === "string" ? (parsed.code as string) : null);
      const message =
        (nestedMessage && typeof nestedMessage.message === "string" ? (nestedMessage.message as string) : null) ??
        (parsed && typeof parsed.message === "string" ? (parsed.message as string) : null) ??
        res.statusText ??
        "Request failed";
      if (res.status === 401) emitUnauthorizedEvent("/identity/bootstrap");
      return {
        data: null,
        error: message,
        errorCode: code === "account_email_conflict" ? "account_email_conflict" : null,
        status: res.status,
      };
    }
    return { data: json as BootstrapIdentityResponse, error: null, status: res.status };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Network error";
    return { data: null, error: message };
  }
}

export type SignupResponse =
  | {
      status: "authenticated";
      userId: string;
      email: string;
      accessToken: string;
      refreshToken: string;
      verificationRequired: false;
    }
  | {
      status: "verification_sent";
      userId: string;
      email: string;
      verificationRequired: true;
    };

export type SignupErrorCode =
  | "email_taken"
  | "weak_password"
  | "invalid_email"
  | "email_send_failed"
  | "server_misconfigured"
  | "signup_failed"
  | "signin_failed"
  | "signin_unavailable";

export type SignupRawError = {
  code?: SignupErrorCode | string;
  message?: string;
  statusCode?: number;
};

export async function identitySignup(input: {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  company?: string;
  phone?: string;
}) {
  return apiPost<SignupResponse>({
    path: `/identity/signup`,
    body: input,
  });
}

/**
 * Server-driven sign-in. Sends credentials to `POST /identity/login` so
 * the backend can rate-limit, audit, and proxy to Supabase. The legacy
 * direct-to-Supabase fetch in `auth/login/page.tsx` is no longer used —
 * this path is the single source of truth for password sign-in.
 *
 * Returns `{ status: 'authenticated', accessToken, refreshToken, email }`
 * on success. On failure surfaces a `{ code, message }` BadRequest body
 * via the standard `ApiResponse.error` channel; recognised codes include
 * `invalid_credentials`, `email_not_confirmed`, `rate_limited`.
 */
export type IdentityLoginError = { code: string | null; message: string };
export type IdentityLoginResult = {
  data:
    | { status: "authenticated"; email: string; accessToken: string; refreshToken: string }
    | null;
  error: IdentityLoginError | null;
};

// Intentionally bypasses the shared `apiPost` helper: the login page
// needs the backend's structured `{ code, message }` error body so it
// can switch on the stable code (invalid_credentials, rate_limited,
// email_not_confirmed, …). The shared helper coerces errors to a
// flat string, which would force fragile substring matching.
export async function identityLogin(input: {
  email: string;
  password: string;
}): Promise<IdentityLoginResult> {
  try {
    const res = await fetch(`${API_BASE}/identity/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const obj = (typeof json === "object" && json !== null ? (json as Record<string, unknown>) : null);
      return {
        data: null,
        error: {
          code: obj && typeof obj.code === "string" ? obj.code : null,
          message:
            obj && typeof obj.message === "string"
              ? obj.message
              : res.statusText || "Sign-in failed",
        },
      };
    }
    return { data: json as IdentityLoginResult["data"], error: null };
  } catch (err: unknown) {
    return {
      data: null,
      error: { code: null, message: err instanceof Error ? err.message : "Network error" },
    };
  }
}

export async function identityResendVerification(email: string) {
  return apiPost<{
    status: "ok";
    verificationRequired: boolean;
    cooldownRemainingMs?: number;
  }>({
    path: `/identity/resend-verification`,
    body: { email },
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
    businessHours: z.record(z.object({ open: z.string(), close: z.string(), closed: z.boolean().optional() })).nullable().optional(),
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
  failedAt?: string | null;
  scheduledFor?: string | null;
  publishedAt?: string | null;
  channelIds?: string[];
  mediaUrls?: string[];
  externalUrl?: string | null;
  externalPostId?: string | null;
  lastError?: string | null;
  publishResults?: Record<string, unknown>[] | null;
  createdAt: string;
};

export type RecentExternalPost = {
  platform: string;
  platformPostId: string;
  content?: string;
  externalUrl?: string;
  publishedAt?: string;
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
  condition?: string | null;
  actions?: unknown;
  enabled: boolean;
  lastRunAt?: string | null;
  runCount?: number;
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
      bufferMins: z.number().nullable().optional(),
      leadTimeMins: z.number().nullable().optional(),
    })),
    [],
  );
}

export async function createService(input: { businessId?: string; name: string; durationMins: number; price: number; description?: string; currency?: string; sourceProductId?: string }) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<Service>({
    path: `/bookings/businesses/${encodeURIComponent(businessId)}/services`,
    body: { name: input.name, duration: input.durationMins, price: input.price, description: input.description, currency: input.currency ?? "TTD", sourceProductId: input.sourceProductId },
  });
}

export async function updateService(serviceId: string, data: { name?: string; duration?: number; price?: number; description?: string; bufferMins?: number | null; leadTimeMins?: number | null }, businessId: string = DEFAULT_BUSINESS_ID) {
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

export async function fetchPosts(businessId: string = DEFAULT_BUSINESS_ID, opts?: { status?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (opts?.status) params.set("status", opts.status);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return apiGet(
    `/social/businesses/${encodeURIComponent(businessId)}/posts${qs ? `?${qs}` : ""}`,
    z.array(z.object({
      id: z.string(),
      content: z.string(),
      status: z.string(),
      scheduledAt: z.string().nullable().optional(),
      postedAt: z.string().nullable().optional(),
      failedAt: z.string().nullable().optional(),
      scheduledFor: z.string().nullable().optional(),
      publishedAt: z.string().nullable().optional(),
      channelIds: z.array(z.string()).optional(),
      mediaUrls: z.array(z.string()).optional(),
      externalUrl: z.string().nullable().optional(),
      externalPostId: z.string().nullable().optional(),
      lastError: z.string().nullable().optional(),
      publishResults: z.array(z.record(z.unknown())).nullable().optional(),
      createdAt: z.string(),
    })),
    [],
  );
}

export async function postNow(input: { businessId?: string; content: string; mediaUrls?: string[]; channelIds?: string[] }) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<{ post: SocialPost; results: Array<Record<string, unknown>> }>({
    path: `/social/businesses/${encodeURIComponent(businessId)}/posts/now`,
    body: { content: input.content, mediaUrls: input.mediaUrls, channelIds: input.channelIds },
  });
}

export async function schedulePost(input: { businessId?: string; content: string; mediaUrls?: string[]; channelIds?: string[]; scheduleAt: string }) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<SocialPost>({
    path: `/social/businesses/${encodeURIComponent(businessId)}/posts/schedule`,
    body: { content: input.content, mediaUrls: input.mediaUrls, channelIds: input.channelIds, scheduleAt: input.scheduleAt },
  });
}

export async function fetchRecentExternalPosts(businessId: string = DEFAULT_BUSINESS_ID, platform?: string) {
  const qs = platform ? `?platform=${encodeURIComponent(platform)}` : "";
  return apiGet(
    `/social/businesses/${encodeURIComponent(businessId)}/recent-posts${qs}`,
    z.array(z.object({
      platform: z.string(),
      platformPostId: z.string(),
      content: z.string().optional(),
      externalUrl: z.string().optional(),
      publishedAt: z.string().optional(),
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
      condition: z.string().nullable().optional(),
      actions: z.unknown().optional(),
      enabled: z.boolean(),
      lastRunAt: z.string().nullable().optional(),
      runCount: z.number().optional(),
      createdAt: z.string(),
    })),
    [],
  );
}

export async function createPlaybook(input: { businessId?: string; name: string; triggerEvent: string; actions: unknown; condition?: string }) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<Playbook>({
    path: `/automation/businesses/${encodeURIComponent(businessId)}/playbooks`,
    body: { name: input.name, triggerEvent: input.triggerEvent, actions: input.actions, condition: input.condition || null },
  });
}

export async function updatePlaybook(input: { businessId?: string; playbookId: string; name?: string; triggerEvent?: string; condition?: string | null; actions?: unknown; enabled?: boolean }) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  try {
    const res = await fetch(`${API_BASE}/automation/businesses/${encodeURIComponent(businessId)}/playbooks/${encodeURIComponent(input.playbookId)}`, {
      method: "PATCH",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: input.name, triggerEvent: input.triggerEvent, condition: input.condition, actions: input.actions, enabled: input.enabled }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) return { data: null, error: res.statusText };
    return { data: json as Playbook, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : "Network error" };
  }
}

export async function testRunPlaybook(input: { businessId?: string; playbookId: string }): Promise<ApiResult<{ success: boolean; message?: string; error?: string }>> {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<{ success: boolean; message?: string; error?: string }>({
    path: `/automation/businesses/${encodeURIComponent(businessId)}/playbooks/${encodeURIComponent(input.playbookId)}/test-run`,
    body: {},
  });
}

export async function aiGenerateFlow(input: { businessId?: string; prompt: string }): Promise<ApiResult<{ success: boolean; flow?: { name: string; triggerEvent: string; actions: { type: string; config?: Record<string, string> }[]; conditions: string[]; reasoning: string }; error?: string }>> {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<{ success: boolean; flow?: { name: string; triggerEvent: string; actions: { type: string; config?: Record<string, string> }[]; conditions: string[]; reasoning: string }; error?: string }>({
    path: `/automation/businesses/${encodeURIComponent(businessId)}/ai/generate-flow`,
    body: { prompt: input.prompt },
  });
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

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: string;
  end: string;
  allDay: boolean;
  htmlLink?: string;
  location?: string;
  organizer?: string;
}

export async function fetchGoogleCalendarEvents(
  businessId: string,
  timeMin: string,
  timeMax: string,
) {
  return apiGet(
    `/bookings/businesses/${encodeURIComponent(businessId)}/calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`,
    z.array(
      z.object({
        id: z.string(),
        summary: z.string(),
        description: z.string().optional(),
        start: z.string(),
        end: z.string(),
        allDay: z.boolean(),
        htmlLink: z.string().optional(),
        location: z.string().optional(),
        organizer: z.string().optional(),
      }),
    ),
  );
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

export interface ScheduleHealth {
  utilizationRate: number;
  noShowRate: number;
  noShowTrend: number;
  avgRevenuePerSlot: number;
  peakDay: string;
  slowestDay: string;
  weeklyUtilization: {
    date: string;
    dayOfWeek: string;
    totalSlots: number;
    bookedSlots: number;
    utilizationRate: number;
    emptySlots: number;
  }[];
  promotionSuggestions: {
    date: string;
    dayOfWeek: string;
    emptySlots: number;
    suggestion: string;
    targetClientCount: number;
  }[];
  noShowRisks: {
    bookingId: string;
    contactId: string;
    contactName: string;
    riskScore: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    factors: string[];
  }[];
  rebookingSuggestions: {
    contactId: string;
    contactName: string;
    lastServiceName: string;
    averageIntervalDays: number;
    suggestedDate: string;
    reason: string;
  }[];
  recommendations: string[];
}

const scheduleHealthSchema = z.object({
  utilizationRate: z.number(),
  noShowRate: z.number(),
  noShowTrend: z.number(),
  avgRevenuePerSlot: z.number(),
  peakDay: z.string(),
  slowestDay: z.string(),
  weeklyUtilization: z.array(z.object({
    date: z.string(),
    dayOfWeek: z.string(),
    totalSlots: z.number(),
    bookedSlots: z.number(),
    utilizationRate: z.number(),
    emptySlots: z.number(),
  })),
  promotionSuggestions: z.array(z.object({
    date: z.string(),
    dayOfWeek: z.string(),
    emptySlots: z.number(),
    suggestion: z.string(),
    targetClientCount: z.number(),
  })),
  noShowRisks: z.array(z.object({
    bookingId: z.string(),
    contactId: z.string(),
    contactName: z.string(),
    riskScore: z.number(),
    riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    factors: z.array(z.string()),
  })),
  rebookingSuggestions: z.array(z.object({
    contactId: z.string(),
    contactName: z.string(),
    lastServiceName: z.string(),
    averageIntervalDays: z.number(),
    suggestedDate: z.string(),
    reason: z.string(),
  })),
  recommendations: z.array(z.string()),
});

export async function fetchScheduleHealth(businessId?: string) {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/bookings/businesses/${encodeURIComponent(bid)}/optimizer/schedule-health`,
    scheduleHealthSchema,
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

const _autopilotDraftSchema = z.object({
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

const momentumContactSchema = z.object({
  id: z.string(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  companyName: z.string().nullable().optional(),
});

const momentumRecommendationSchema = z.object({
  id: z.string(),
  businessId: z.string(),
  contactId: z.string(),
  type: z.string(),
  title: z.string(),
  description: z.string(),
  priority: z.string(),
  status: z.string(),
  draftMessage: z.string().nullable().optional(),
  draftSubject: z.string().nullable().optional(),
  suggestedChannel: z.string().nullable().optional(),
  triggerReason: z.string().nullable().optional(),
  momentumScore: z.number().nullable().optional(),
  snoozedUntil: z.string().nullable().optional(),
  actionedAt: z.string().nullable().optional(),
  dismissedAt: z.string().nullable().optional(),
  autoExecuted: z.boolean().optional(),
  scheduledFor: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  contact: momentumContactSchema.optional(),
});

export type MomentumRecommendation = z.infer<typeof momentumRecommendationSchema>;

const momentumScoreSchema = z.object({
  score: z.number(),
  previousScore: z.number().nullable().optional(),
  trend: z.string(),
  recencyScore: z.number(),
  frequencyScore: z.number(),
  monetaryScore: z.number(),
  engagementScore: z.number(),
  tenureScore: z.number(),
  calculatedAt: z.string().optional(),
  contactId: z.string().optional(),
});

export type MomentumScore = z.infer<typeof momentumScoreSchema>;

const momentumSummarySchema = z.object({
  total: z.number(),
  averageScore: z.number(),
  rising: z.number(),
  falling: z.number(),
  stable: z.number(),
  atRisk: z.number(),
  hotLeads: z.number(),
});

export type MomentumSummary = z.infer<typeof momentumSummarySchema>;

const momentumHistorySchema = z.array(z.object({
  score: z.number(),
  trend: z.string(),
  calculatedAt: z.string(),
  recencyScore: z.number(),
  frequencyScore: z.number(),
  monetaryScore: z.number(),
  engagementScore: z.number(),
  tenureScore: z.number(),
}));

export type MomentumHistory = z.infer<typeof momentumHistorySchema>;

const _momentumDraftSchema = z.object({
  subject: z.string(),
  message: z.string(),
  tone: z.string(),
  suggestedChannel: z.enum(['whatsapp', 'email']),
});

export type MomentumDraft = z.infer<typeof _momentumDraftSchema>;

export async function fetchMomentumRecommendations(businessId?: string, limit?: number): Promise<ApiResult<MomentumRecommendation[]>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  const query = limit ? `?limit=${limit}` : '';
  return apiGet(
    `/momentum/businesses/${encodeURIComponent(bid)}/recommendations${query}`,
    z.array(momentumRecommendationSchema),
    [],
  );
}

export async function actionMomentumRecommendation(id: string, businessId?: string) {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<MomentumRecommendation>({
    path: `/momentum/businesses/${encodeURIComponent(bid)}/recommendations/${encodeURIComponent(id)}/action`,
    body: {},
  });
}

export async function snoozeMomentumRecommendation(id: string, days?: number, businessId?: string) {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<MomentumRecommendation>({
    path: `/momentum/businesses/${encodeURIComponent(bid)}/recommendations/${encodeURIComponent(id)}/snooze`,
    body: { days: days ?? 7 },
  });
}

export async function dismissMomentumRecommendation(id: string, businessId?: string) {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<MomentumRecommendation>({
    path: `/momentum/businesses/${encodeURIComponent(bid)}/recommendations/${encodeURIComponent(id)}/dismiss`,
    body: {},
  });
}

export async function generateMomentumDraft(
  id: string,
  body: { contactId: string; contactName: string; type: string; description: string; momentumScore?: number },
  businessId?: string,
): Promise<ApiResult<MomentumDraft>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<MomentumDraft>({
    path: `/momentum/businesses/${encodeURIComponent(bid)}/recommendations/${encodeURIComponent(id)}/draft`,
    body,
  });
}

export async function fetchContactMomentum(contactId: string, businessId?: string): Promise<ApiResult<MomentumScore>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/momentum/businesses/${encodeURIComponent(bid)}/contacts/${encodeURIComponent(contactId)}`,
    momentumScoreSchema,
  );
}

export async function fetchContactMomentumHistory(contactId: string, days?: number, businessId?: string): Promise<ApiResult<MomentumHistory>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  const query = days ? `?days=${days}` : '';
  return apiGet(
    `/momentum/businesses/${encodeURIComponent(bid)}/contacts/${encodeURIComponent(contactId)}/history${query}`,
    momentumHistorySchema,
    [],
  );
}

export async function fetchMomentumSummary(businessId?: string): Promise<ApiResult<MomentumSummary>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/momentum/businesses/${encodeURIComponent(bid)}/summary`,
    momentumSummarySchema,
  );
}

export async function triggerMomentumSweep(businessId?: string) {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<{ contactsProcessed: number; recommendationsGenerated: number }>({
    path: `/momentum/businesses/${encodeURIComponent(bid)}/sweep`,
    body: {},
  });
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
  type: z.enum(["follow_up", "birthday", "payment_reminder", "check_in", "offer", "review_request", "referral_request", "thank_you", "re_engage"]),
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

const _aiInsightSchema = z.object({
  summary: z.string(),
  nextBestAction: z.string(),
  reasoning: z.string().optional(),
  confidence: z.number(),
  suggestedMessage: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type AiInsight = z.infer<typeof _aiInsightSchema>;

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

export async function fetchContactDossier(contactId: string, businessId?: string, opts?: { signal?: AbortSignal }): Promise<ApiResult<unknown>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/crm/businesses/${encodeURIComponent(bid)}/contacts/${encodeURIComponent(contactId)}/dossier`,
    undefined,
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

const crossJourneyItemSchema = z.object({
  id: z.string(),
  module: z.enum(["crm", "bookings", "commerce", "marketing"]),
  type: z.string(),
  title: z.string(),
  description: z.string().optional(),
  timestamp: z.string(),
  value: z.number().optional(),
  currency: z.string().optional(),
  status: z.string().optional(),
  entityId: z.string().optional(),
  ctaLabel: z.string().optional(),
  ctaModule: z.string().optional(),
});

const crossJourneySummarySchema = z.object({
  bookingsCount: z.number(),
  totalRevenue: z.number(),
  lastInteractionAt: z.string().nullable(),
  momentum: z.number(),
  engagementLevel: z.enum(["high", "medium", "low"]),
  moduleCounts: z.object({
    crm: z.number(),
    bookings: z.number(),
    commerce: z.number(),
    marketing: z.number(),
  }),
});

const crossJourneyResponseSchema = z.object({
  timeline: z.array(crossJourneyItemSchema),
  summary: crossJourneySummarySchema,
});

export type CrossJourneyItem = z.infer<typeof crossJourneyItemSchema>;
export type CrossJourneySummary = z.infer<typeof crossJourneySummarySchema>;
export type CrossJourneyResponse = z.infer<typeof crossJourneyResponseSchema>;

export async function fetchContactCrossJourney(contactId: string, businessId?: string, opts?: { signal?: AbortSignal }): Promise<ApiResult<CrossJourneyResponse>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/crm/businesses/${encodeURIComponent(bid)}/contacts/${encodeURIComponent(contactId)}/cross-journey`,
    crossJourneyResponseSchema,
    undefined,
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

export interface ProjectTemplate {
  id: string;
  name: string;
  taskTitles: string[];
  productId?: string | null;
  product?: { id: string; name: string } | null;
}

export async function fetchProjectTemplates(businessId: string): Promise<ApiResult<ProjectTemplate[]>> {
  return apiGetSimple<ProjectTemplate[]>(`/projects/businesses/${encodeURIComponent(businessId)}/templates`);
}

export async function createProjectTemplate(
  businessId: string,
  data: { name: string; taskTitles: string[]; productId?: string },
): Promise<ApiResult<ProjectTemplate>> {
  return apiPost<ProjectTemplate>({
    path: `/projects/businesses/${encodeURIComponent(businessId)}/templates`,
    body: data,
  });
}

export async function deleteProjectTemplate(businessId: string, templateId: string): Promise<ApiResult<unknown>> {
  return apiDelete<unknown>(
    `/projects/businesses/${encodeURIComponent(businessId)}/templates/${encodeURIComponent(templateId)}`,
  );
}

export async function createProjectFromTemplate(
  businessId: string,
  templateId: string,
  data?: { name?: string; contactId?: string; invoiceId?: string; bookingId?: string },
): Promise<ApiResult<Project>> {
  return apiPost<Project>({
    path: `/projects/businesses/${encodeURIComponent(businessId)}/from-template/${encodeURIComponent(templateId)}`,
    body: data ?? {},
  });
}

export type StorefrontSectionType = 'hero' | 'trust' | 'featured' | 'categories' | 'catalog' | 'testimonials' | 'faq' | 'policies' | 'contact';

export type StorefrontSectionKey = StorefrontSectionType;

export interface StorefrontSection {
  key: StorefrontSectionKey;
  visible: boolean;
  type?: StorefrontSectionType;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

export interface FaqEntry {
  id: string;
  question: string;
  answer: string;
  order?: number;
}

export interface PolicyPage {
  key: 'refund' | 'privacy' | 'delivery' | 'terms';
  title: string;
  content: string;
  enabled: boolean;
}

export interface PolicyConfig {
  enabled: boolean;
  content: string;
}

export interface StorefrontPolicies {
  refund?: PolicyConfig;
  privacy?: PolicyConfig;
  delivery?: PolicyConfig;
  terms?: PolicyConfig;
}

export type DeliveryMethod = 'shipping' | 'pickup' | 'digital';

export type StoreStatus = 'active' | 'paused' | 'coming_soon';

export type BadgeType = 'popular' | 'new' | 'best_seller' | 'limited' | 'sale' | 'best_value' | 'fast_delivery' | 'book_today' | 'verified' | 'digital_delivery' | 'staff_pick';

export type CatalogVisibilityRule = 'visible' | 'hidden' | 'preorder' | 'low_stock' | 'consultation_first' | 'service_only' | 'digital_only';

export type TrustRailItem = 'secure_checkout' | 'fast_delivery' | 'verified_business' | 'instant_booking' | 'custom_support' | 'digital_delivery';

export interface CatalogItemOverride {
  label?: string;
  shortDescription?: string;
  badge?: BadgeType | 'none';
  visibilityRule?: CatalogVisibilityRule;
  hidePrice?: boolean;
  section?: string;
  featured?: boolean;
  categoryEmphasis?: 'high' | 'medium' | 'low' | 'default';
}

export interface FontPairing {
  id: string;
  name: string;
  heading: string;
  body: string;
}

export interface StorefrontHeroProofChip {
  label: string;
  icon?: string;
}

export interface StorefrontConfig {
  hero: {
    headline?: string;
    subheadline?: string;
    ctaLabel?: string;
    coverImageUrl?: string;
    coverVideoUrl?: string;
    showHours?: boolean;
    showWhatsApp?: boolean;
    secondaryCtaLabel?: string;
    promotionalRibbon?: string;
    promotionalRibbonColor?: string;
    proofChips?: StorefrontHeroProofChip[];
  };
  appearance: {
    theme?: 'default' | 'minimal' | 'bold' | 'elegant' | 'luxe' | 'fresh' | 'conversion_first' | 'premium_services' | 'luxury_editorial' | 'booking_optimized' | 'catalog_heavy' | 'authority_brand' | 'creator_expert' | 'hybrid_storefront';
    cardStyle?: 'grid' | 'list';
    showPrices?: boolean;
    showDuration?: boolean;
    accentColor?: string;
    primaryColor?: string;
    secondaryColor?: string;
    density?: 'comfortable' | 'compact';
    fontFamily?: 'system' | 'sans' | 'serif';
    fontPairing?: string;
  };
  merchandising: {
    featuredItemIds?: string[];
    collections?: { id: string; name: string; itemIds: string[]; railType?: 'featured' | 'seasonal' | 'landing' }[];
    badges?: Record<string, BadgeType>;
    trustRails?: TrustRailItem[];
    spotlights?: { id: string; itemId: string; itemType: 'service' | 'product' | 'package'; spotlightType: 'service' | 'package' | 'hybrid'; headline?: string; subheadline?: string }[];
    highlightHighMargin?: boolean;
    showBestsellers?: boolean;
    showNewArrivals?: boolean;
    showLimitedTimeOffers?: boolean;
  };
  promotions: {
    bannerEnabled?: boolean;
    bannerText?: string;
    bannerColor?: string;
    bannerLink?: string;
    bannerExpiry?: string;
    bannerStartDate?: string;
    bannerCta?: string;
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
    ogImage?: string;
  };
  catalog?: {
    productOrder?: string[];
    itemOverrides?: Record<string, CatalogItemOverride>;
    categoryEmphasis?: Record<string, 'high' | 'medium' | 'low' | 'default'>;
    sections?: { id: string; name: string; itemIds: string[]; railType?: 'featured' | 'seasonal' | 'landing' }[];
  };
  sections?: StorefrontSection[];
  sectionStyles?: {
    trust?: { style?: 'badges' | 'strip' | 'minimal'; showPaymentBadge?: boolean };
    catalog?: { showSectionHeader?: boolean; sectionHeaderLabel?: string; sectionHeaderEmphasis?: boolean };
    faq?: { style?: 'accordion' | 'grid'; showIcon?: boolean };
    hero?: { showScrollCta?: boolean };
  };
  faqEntries?: FaqEntry[];
  faq?: {
    heading?: string;
    entries?: FaqEntry[];
  };
  policies?: {
    pages?: PolicyPage[];
  } & Partial<StorefrontPolicies>;
  storeSettings?: {
    deliveryOptions?: DeliveryMethod[];
    minimumOrderValue?: number;
    storeStatus?: StoreStatus;
    currencyDisplay?: string;
    taxRate?: number;
  };
  contactOptions?: {
    whatsappNumber?: string;
    email?: string;
    phone?: string;
    showContactForm?: boolean;
  };
  contact?: {
    heading?: string;
    showWhatsApp?: boolean;
    showEmail?: boolean;
    showPhone?: boolean;
    showAddress?: boolean;
    customMessage?: string;
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

export interface StoreGraphMapping {
  productId: string;
  productName: string;
  serviceId: string | null;
  serviceName: string | null;
  isLive: boolean;
  priceDrift: boolean;
  durationDrift: boolean;
  commercePrice: number;
  servicePrice: number | null;
  commerceDuration: number | null;
  serviceDuration: number | null;
  category: string;
  imageUrl: string | null;
  isActive: boolean;
}

export interface StoreGraph {
  mappings: StoreGraphMapping[];
  liveCount: number;
  draftCount: number;
  driftCount: number;
  totalProducts: number;
  totalServices: number;
  serviceNameIndex: Record<string, string>;
}

export type ReadinessCategory = 'launch' | 'conversion' | 'merchandising' | 'promotion';
export type ReadinessSeverity = 'blocker' | 'warning' | 'tip';

export interface ReadinessItem {
  id: string;
  category: ReadinessCategory;
  severity: ReadinessSeverity;
  title: string;
  detail: string;
  actionLabel: string;
  actionTab: string;
  resolved: boolean;
}

export interface ReadinessScores {
  overall: number;
  launch: number;
  conversion: number;
  merchandising: number;
  promotion: number;
}

export interface RevenueSnapshot {
  totalRevenue30d: number;
  totalOrders30d: number;
  avgOrderValue: number;
  topProductRevenue: { productId: string; productName: string; revenue: number; orders: number }[];
  bottomProductRevenue: { productId: string; productName: string; revenue: number; orders: number }[];
  conversionRate: number | null;
  revenueByChannel: { channel: string; revenue: number; orders: number }[];
  revenueTrend: { period: string; revenue: number; orders: number }[];
  promotionROI: { campaignsSent: number; totalCampaignRevenue: number; roi: number | null } | null;
}

export interface StoreReadinessResult {
  scores: ReadinessScores;
  items: ReadinessItem[];
  revenue: RevenueSnapshot;
  graph: StoreGraph;
}

export async function backfillStoreLinks(businessId: string): Promise<void> {
  fetch(`${API_BASE}/commerce/businesses/${encodeURIComponent(businessId)}/store/backfill-links`, {
    method: 'POST',
    headers: getAuthHeaders(),
  }).catch(() => {});
}

export async function fetchStoreGraph(businessId: string): Promise<ApiResult<StoreGraph>> {
  return apiGetSimple<StoreGraph>(`/commerce/businesses/${encodeURIComponent(businessId)}/store/graph`);
}

export async function fetchStoreReadiness(businessId: string): Promise<ApiResult<StoreReadinessResult>> {
  return apiGetSimple<StoreReadinessResult>(`/commerce/businesses/${encodeURIComponent(businessId)}/store/readiness`);
}

export async function trackStoreEvent(businessId: string, type: string, itemId?: string): Promise<void> {
  fetch(`${API_BASE}/site/businesses/${encodeURIComponent(businessId)}/analytics/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, itemId }),
  }).catch(() => {});
}

export interface ConversionFunnelStage {
  stage: string;
  count: number;
  dropOff: number;
  conversionRate: number;
}

export interface ConversionFunnel {
  thisWeek: {
    funnel: ConversionFunnelStage[];
    totalVisitors: number;
    totalCompleted: number;
    overallConversionRate: number;
  };
  lastWeek: {
    funnel: ConversionFunnelStage[];
    totalVisitors: number;
    totalCompleted: number;
    overallConversionRate: number;
  };
  weekOverWeekChange: number;
  perProduct: { itemId: string; views: number; cartAdds: number; conversionRate: number }[];
  summary: string;
}

export interface ProductHealthAudit {
  score: number;
  totalItems: number;
  issues: {
    type: string;
    severity: string;
    itemId?: string;
    itemName?: string;
    message: string;
    fix?: { action: string; target: string };
  }[];
  issueCount?: { critical: number; high: number; medium: number; low: number };
  summary: string;
}

export interface SeoHealthReport {
  score: number;
  grade: string;
  checks: {
    category: string;
    status: string;
    message: string;
    fix?: { action: string; target: string };
  }[];
  passCount: number;
  warnCount: number;
  failCount: number;
  summary: string;
}

export interface ConversionSuggestion {
  id: string;
  priority: string;
  category: string;
  title: string;
  message: string;
  fix?: { action: string; target: string };
  impact: string;
}

export interface ConversionSuggestionsResponse {
  suggestions: ConversionSuggestion[];
  metrics: {
    conversionRate: number;
    weekOverWeekChange: number;
    healthScore: number;
    seoScore: number;
    totalVisitors: number;
    totalCompletions: number;
  };
}

export interface AiConversionAdvice {
  recommendations: { title: string; description: string; priority: string; category: string }[];
  dataSnapshot: { conversionRate: number; healthScore: number; seoScore: number };
  usage?: { creditsUsed: number };
  error?: string;
}

export async function fetchConversionFunnel(businessId: string): Promise<ApiResult<ConversionFunnel>> {
  return apiGetSimple<ConversionFunnel>(`/site/businesses/${encodeURIComponent(businessId)}/conversion-funnel`);
}

export async function fetchProductHealth(businessId: string): Promise<ApiResult<ProductHealthAudit>> {
  return apiGetSimple<ProductHealthAudit>(`/site/businesses/${encodeURIComponent(businessId)}/product-health`);
}

export async function fetchSeoHealth(businessId: string): Promise<ApiResult<SeoHealthReport>> {
  return apiGetSimple<SeoHealthReport>(`/site/businesses/${encodeURIComponent(businessId)}/seo-health`);
}

export async function fetchConversionSuggestions(businessId: string): Promise<ApiResult<ConversionSuggestionsResponse>> {
  return apiGetSimple<ConversionSuggestionsResponse>(`/site/businesses/${encodeURIComponent(businessId)}/conversion-suggestions`);
}

export async function fetchAiConversionAdvice(businessId: string): Promise<ApiResult<AiConversionAdvice>> {
  const res = await fetch(`${API_BASE}/site/businesses/${encodeURIComponent(businessId)}/conversion-advice`, {
    method: 'POST',
    headers: { ...await getAuthHeaders(), 'Content-Type': 'application/json' },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return { data: null, error: data?.message || 'Failed to get AI advice' };
  return { data, error: null };
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
  categoryId?: string | null;
  category?: ExpenseCategory;
  projectId?: string | null;
  contactId?: string | null;
  serviceId?: string | null;
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
  uncategorizedCount?: number;
  missingReceiptCount?: number;
  recurringCount?: number;
  largestExpense: { id: string; description: string; amount: number; date: string; vendor?: string } | null;
  comparison: { prevTotal: number; prevCount: number; changePercent: number; direction: 'up' | 'down' | 'flat' };
  byCategory: { categoryId: string; name: string; color: string | null; total: number; count: number; prevTotal: number; percent: number }[];
  byPaymentMethod: { method: string; total: number; count: number }[];
  monthlyTrend: { month: string; total: number }[];
  dailyTrend: { date: string; total: number }[];
  tags: string[];
  byProject?: { projectId: string; name: string; total: number; count: number }[];
  byContact?: { contactId: string; total: number; count: number }[];
  byService?: { serviceId: string; total: number; count: number }[];
}
export interface MarginAnalysis {
  totalRevenue: number;
  paidRevenue: number;
  totalExpenses: number;
  grossProfit: number;
  grossMargin: number;
  expenseToRevenueRatio: number;
  byProject: { projectId: string; name: string; expenses: number; count: number; revenue: number; profit: number; margin: number }[];
  byClient: { contactId: string; name: string; expenses: number; revenue: number; profit: number; margin: number }[];
  byService: { serviceId: string; name: string; expenses: number; count: number; revenue: number; profit: number; margin: number }[];
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
export async function fetchMarginAnalysis(businessId: string, period = '30d', startDate?: string, endDate?: string): Promise<ApiResult<MarginAnalysis>> {
  const q = new URLSearchParams({ period });
  if (startDate) q.set('startDate', startDate);
  if (endDate) q.set('endDate', endDate);
  return apiGetSimple<MarginAnalysis>(`/expenses/businesses/${encodeURIComponent(businessId)}/expenses/margin-analysis?${q}`);
}
export async function fetchExpensesByProject(businessId: string, projectId: string): Promise<ApiResult<{ expenses: Expense[]; total: number; count: number }>> {
  return apiGetSimple<{ expenses: Expense[]; total: number; count: number }>(`/expenses/businesses/${encodeURIComponent(businessId)}/expenses/by-project/${encodeURIComponent(projectId)}`);
}
export async function fetchExpensesByService(businessId: string, serviceId: string): Promise<ApiResult<{ expenses: Expense[]; total: number; count: number }>> {
  return apiGetSimple<{ expenses: Expense[]; total: number; count: number }>(`/expenses/businesses/${encodeURIComponent(businessId)}/expenses/by-service/${encodeURIComponent(serviceId)}`);
}
export interface RecurringCandidate {
  vendor: string;
  amount: number;
  description: string;
  occurrences: number;
  avgDaysBetween: number;
  frequency: string;
  expenseIds: string[];
}
export async function fetchRecurringCandidates(businessId: string): Promise<ApiResult<{ candidates: RecurringCandidate[] }>> {
  return apiGetSimple<{ candidates: RecurringCandidate[] }>(`/expenses/businesses/${encodeURIComponent(businessId)}/expenses/recurring-candidates`);
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
// FLOW AI BOT
// ---
export interface FlowToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface FlowToolResult {
  toolCallId: string;
  name: string;
  result: unknown;
  changedEntities: string[];
  followOnSuggestions: string[];
  family: string;
  riskTier: number;
  success: boolean;
  error?: string;
}

export interface FlowPendingConfirmation {
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface FlowChatResponse {
  reply: string;
  toolCalls?: FlowToolCall[];
  toolResults?: FlowToolResult[];
  pendingConfirmations?: FlowPendingConfirmation[];
  requiresConfirmation?: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    creditsUsed: number;
  };
}

export async function sendFlowChat(
  businessId: string,
  message: string,
  history?: unknown[],
  pendingConfirmation?: {
    toolCallId: string;
    confirmed: boolean;
    toolName?: string;
    toolArgs?: Record<string, unknown>;
  },
  pageContext?: Record<string, unknown>,
): Promise<ApiResult<FlowChatResponse>> {
  return apiPost<FlowChatResponse>({
    path: `/ai/businesses/${encodeURIComponent(businessId)}/flow/chat`,
    body: { message, history, pendingConfirmation, pageContext },
  });
}

export async function confirmFlowAction(
  businessId: string,
  toolCallId: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
  confirmed: boolean,
): Promise<ApiResult<FlowChatResponse>> {
  return apiPost<FlowChatResponse>({
    path: `/ai/businesses/${encodeURIComponent(businessId)}/flow/confirm`,
    body: { toolCallId, toolName, toolArgs, confirmed },
  });
}

export async function fetchFlowSessions(businessId: string): Promise<ApiResult<unknown[]>> {
  return apiGetSimple<unknown[]>(`/ai/businesses/${encodeURIComponent(businessId)}/flow/sessions`);
}

export async function clearFlowSession(businessId: string, sessionId: string): Promise<ApiResult<{ success: boolean }>> {
  return apiPost<{ success: boolean }>({
    path: `/ai/businesses/${encodeURIComponent(businessId)}/flow/sessions/${encodeURIComponent(sessionId)}/clear`,
    body: {},
  });
}

// ---
// AI BUSINESS OFFICE — Copilot, Governance, Approvals, Execution Logs
// ---

export interface AiBusinessGraph {
  businessName: string;
  contactsCount: number;
  recentContacts: Array<{ id: string; name: string }>;
  activeInvoiceCount: number;
  revenueThisMonth: number;
  upcomingBookings: number;
  activeCampaigns: number;
  activeProjects: number;
  recentExpenses: number;
  activePlaybooks: number;
  [key: string]: unknown;
}

export interface AiParsedIntent {
  objective: string;
  rawInput: string;
  urgency: string;
  scope: string[];
  modules: string[];

  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
  clarificationNeeded: boolean;
  clarificationMessage?: string;
}

export interface AiPlanStep {
  id: string;
  order: number;
  status: string;
  toolName: string | null;
  module: string | null;
  action: string;
  description: string | null;
  riskTier: number;
  requiresApproval: boolean;
  dependsOn: string[];

  inputPayload: Record<string, unknown> | null;

  outputResult: Record<string, unknown> | null;
  expectedBenefit: string | null;
  errorMessage: string | null;
  durationMs: number | null;
}

export interface AiPlan {
  id: string;
  businessId: string;
  userId: string | null;
  status: string;
  objective: string;
  rawInput: string | null;
  urgency: string;
  scope: string[];
  modules: string[];
  maxRiskTier: number;
  steps: AiPlanStep[];
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AiApprovalItem {
  id: string;
  businessId: string;
  toolName: string;
  title: string;
  description: string | null;
  rationale: string | null;
  riskTier: number;
  status: string;

  inputPayload: Record<string, unknown> | null;
  resolvedByUserId: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  planId: string | null;
  planStepId: string | null;
  createdAt: string;
}

export interface AiExecutionLogEntry {
  id: string;
  businessId: string;
  userId: string | null;
  action: string;
  toolName: string | null;
  module: string | null;
  riskTier: number;
  mode: string;
  actor: string;
  rationale: string | null;
  inputSummary: unknown;
  outputSummary: unknown;
  success: boolean;
  errorMessage: string | null;
  durationMs: number | null;
  planId: string | null;
  planStepId: string | null;
  createdAt: string;
}

export interface AiExecutionStats {
  period: { days: number; since: string };
  totalActions: number;
  successRate: number;
  byModule: Array<{ module: string; count: number }>;
  byMode: Array<{ mode: string; count: number }>;
}

export interface AiAutonomySettings {
  mode: 'advisory' | 'assisted' | 'pro_auto' | 'restricted';
  maxAutoTier: number;
  blockedTools: string[];
  blockedModules: string[];
}

export async function fetchAiGraph(businessId: string): Promise<ApiResult<AiBusinessGraph>> {
  return apiGetSimple<AiBusinessGraph>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/graph`);
}

export async function parseAiIntent(businessId: string, input: string): Promise<ApiResult<AiParsedIntent>> {
  return apiPost<AiParsedIntent>({
    path: `/ai/businesses/${encodeURIComponent(businessId)}/ai/intent`,
    body: { input },
  });
}

export async function createAiPlan(businessId: string, input: string): Promise<ApiResult<{ intent: AiParsedIntent; plan: AiPlan | null; clarificationNeeded: boolean }>> {
  return apiPost<{ intent: AiParsedIntent; plan: AiPlan | null; clarificationNeeded: boolean }>({
    path: `/ai/businesses/${encodeURIComponent(businessId)}/ai/plan`,
    body: { input },
  });
}

export async function fetchAiPlans(businessId: string): Promise<ApiResult<AiPlan[]>> {
  return apiGetSimple<AiPlan[]>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/plans`);
}

export async function fetchAiPlan(businessId: string, planId: string): Promise<ApiResult<AiPlan>> {
  return apiGetSimple<AiPlan>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/plans/${encodeURIComponent(planId)}`);
}

export async function approveAiPlan(businessId: string, planId: string): Promise<ApiResult<AiPlan>> {
  return apiPost<AiPlan>({
    path: `/ai/businesses/${encodeURIComponent(businessId)}/ai/plans/${encodeURIComponent(planId)}/approve`,
    body: {},
  });
}

export async function executeAiPlan(businessId: string, planId: string): Promise<ApiResult<{ planId: string; status: string; stepsExecuted: number; stepsFailed: number; stepsSkipped: number }>> {
  return apiPost<{ planId: string; status: string; stepsExecuted: number; stepsFailed: number; stepsSkipped: number }>({
    path: `/flow/businesses/${encodeURIComponent(businessId)}/flow/execute-plan/${encodeURIComponent(planId)}`,
    body: {},
  });
}

export interface GraphEntityLink {
  fromType: string;
  fromId: string;
  toType: string;
  toId: string;
  relation: string;

  meta?: Record<string, unknown>;
}

export interface GraphContactSummary {
  id: string;
  name: string;
  email: string | null;
  status: string;
  revenue: number;
  invoiceIds: string[];
  bookingIds: string[];
  projectIds: string[];
}

export interface GraphInvoiceSummary {
  id: string;
  number: string | null;
  status: string;
  total: number;
  dueDate: string | null;
  contactId: string | null;
  contactName: string | null;
}

export interface GraphProductSummary {
  id: string;
  name: string;
  price: number;
  category: string;
  isActive: boolean;
  serviceId: string | null;
  storefrontListed: boolean;
}

export interface BusinessGraphSnapshot {
  businessId: string;
  timestamp: string;
  business: {
    name: string;
    industry: string | null;
    archetype: string | null;
    revenueModel: string | null;
    currency: string;
    stage: string | null;
    teamSize: string | null;
  };
  contacts: {
    total: number;
    byStatus: Record<string, number>;
    recentCount: number;
    staleLeadCount: number;
    topClients: Array<{ id: string; name: string; revenue: number }>;
  };
  revenue: {
    totalCollected: number;
    outstandingAmount: number;
    outstandingCount: number;
    overdueCount: number;
    overdueAmount: number;
    monthlyRevenue: number;
    averageInvoiceValue: number;
  };
  bookings: {
    upcomingCount: number;
    completedThisMonth: number;
    cancelledThisMonth: number;
    utilizationRate: number;
  };
  expenses: {
    totalThisMonth: number;
    topCategories: Array<{ name: string; amount: number }>;
    budgetUtilization: number;
  };
  projects: {
    activeCount: number;
    overdueTaskCount: number;
    completionRate: number;
  };
  content: {
    draftPostCount: number;
    scheduledPostCount: number;
    draftCampaignCount: number;
  };
  automations: {
    activeCount: number;
    disabledCount: number;
    totalRuns: number;
  };
  storefront: {
    activeProductCount: number;
    averagePrice: number;
  };
  momentumScore: number;
  healthIndicators: Array<{ area: string; status: 'good' | 'warning' | 'critical'; detail: string }>;
  links: GraphEntityLink[];
  entities: {
    topContacts: GraphContactSummary[];
    overdueInvoices: GraphInvoiceSummary[];
    catalogProducts: GraphProductSummary[];
  };
}

export interface GraphResponse {
  snapshot: BusinessGraphSnapshot;
  generatedAt: string;
  linkCount: number;
  entityCounts: {
    topContacts: number;
    overdueInvoices: number;
    catalogProducts: number;
  };
}

export interface ActionPlanResponse {
  intent: AiParsedIntent;
  plan: AiPlan | null;
  clarificationNeeded: boolean;
  riskAssessment?: {
    maxTier: number;
    requiresApproval: boolean;
    affectedModules: string[];
    estimatedImpact: string;
  };
}

export interface ActionExecuteResponse {
  success: boolean;
  blocked?: boolean;
  requiresApproval?: boolean;
  approvalId?: string;
  result?: unknown;
  changedEntities?: string[];
  followOnSuggestions?: string[];
  tier: number;
  reason?: string;
  error?: string;
}

export interface ActionQueueItem {
  id: string;
  type: 'pending_approval' | 'executed' | 'scheduled';
  toolName: string;
  title: string;
  description: string | null;
  riskTier: number;
  module: string | null;
  status: 'pending' | 'scheduled' | 'active' | 'completed' | 'failed';
  createdAt: string;
  affectedEntities: string[];
}

export interface ActionQueueResponse {
  items: ActionQueueItem[];
  counts: {
    pending: number;
    scheduled: number;
    active: number;
    completed: number;
    failed: number;
  };
  plans: unknown;
}

export interface AutopilotCoverageModule {
  module: string;
  coveragePct: number;
  automatedCount: number;
  totalProcesses: number;
}

export interface AutopilotCoverageResponse {
  overallCoverage: number;
  modules: AutopilotCoverageModule[];
  gaps: Array<{ module: string; gap: string; severity: 'high' | 'medium' | 'low' }>;
  governance: {
    mode: string;
    maxAutoTier: number;
    blockedToolCount: number;
    blockedModuleCount: number;
  };
  activity: {
    executionsLast7Days: number;
    pendingApprovals: number;
    activeFlows: number;
    disabledFlows: number;
  };
}

export async function fetchBusinessGraph(businessId: string, refresh?: boolean): Promise<ApiResult<GraphResponse>> {
  const qs = refresh ? '?refresh=true' : '';
  return apiGetSimple<GraphResponse>(`/graph/business/${encodeURIComponent(businessId)}${qs}`);
}

export async function planAction(businessId: string, input: string): Promise<ApiResult<ActionPlanResponse>> {
  return apiPost<ActionPlanResponse>({
    path: `/actions/businesses/${encodeURIComponent(businessId)}/plan`,
    body: { input },
  });
}

export async function executeAction(
  businessId: string,
  toolName: string,

  args: Record<string, unknown>,
  planId?: string,
  planStepId?: string,
): Promise<ApiResult<ActionExecuteResponse>> {
  return apiPost<ActionExecuteResponse>({
    path: `/actions/businesses/${encodeURIComponent(businessId)}/execute`,
    body: { toolName, args, planId, planStepId },
  });
}

export async function fetchActionQueue(businessId: string, status?: string, limit?: number): Promise<ApiResult<ActionQueueResponse>> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  return apiGetSimple<ActionQueueResponse>(`/actions/businesses/${encodeURIComponent(businessId)}/queue${qs ? `?${qs}` : ''}`);
}

export async function fetchAutopilotCoverage(businessId: string): Promise<ApiResult<AutopilotCoverageResponse>> {
  return apiGetSimple<AutopilotCoverageResponse>(`/autopilot/businesses/${encodeURIComponent(businessId)}/coverage`);
}

export async function fetchAiExecutionLogs(
  businessId: string,
  filters?: { module?: string; toolName?: string; limit?: number; offset?: number },
): Promise<ApiResult<AiExecutionLogEntry[]>> {
  const params = new URLSearchParams();
  if (filters?.module) params.set('module', filters.module);
  if (filters?.toolName) params.set('toolName', filters.toolName);
  if (filters?.limit) params.set('limit', String(filters.limit));
  if (filters?.offset) params.set('offset', String(filters.offset));
  const qs = params.toString();
  const res = await apiGetSimple<{ logs: AiExecutionLogEntry[]; total: number; limit: number; offset: number }>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/execution-logs${qs ? `?${qs}` : ''}`);
  if (res.data) return { data: res.data.logs, error: null };
  return { data: null, error: res.error };
}

export async function fetchAiExecutionStats(businessId: string, days?: number): Promise<ApiResult<AiExecutionStats>> {
  const qs = days ? `?days=${days}` : '';
  return apiGetSimple<AiExecutionStats>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/execution-stats${qs}`);
}

export async function fetchAiPendingApprovals(businessId: string): Promise<ApiResult<AiApprovalItem[]>> {
  return apiGetSimple<AiApprovalItem[]>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/approvals`);
}

export async function fetchAiApprovalHistory(businessId: string, limit?: number): Promise<ApiResult<AiApprovalItem[]>> {
  const qs = limit ? `?limit=${limit}` : '';
  return apiGetSimple<AiApprovalItem[]>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/approvals/history${qs}`);
}

export async function resolveAiApproval(
  businessId: string,
  approvalId: string,
  resolution: 'approved' | 'rejected' | 'deferred',
): Promise<ApiResult<AiApprovalItem>> {
  return apiPost<AiApprovalItem>({
    path: `/ai/businesses/${encodeURIComponent(businessId)}/ai/approvals/${encodeURIComponent(approvalId)}/resolve`,
    body: { resolution },
  });
}

export interface ProAutoInsight {
  id: string;
  category: string;
  severity: 'critical' | 'warning' | 'info' | 'opportunity';
  title: string;
  description: string;
  metric?: string;
  suggestedAction?: string;
  suggestedTool?: string;
  riskTier: number;
  module: string;
  timestamp: string;
  escalated?: boolean;
}

export async function fetchProAutoInsights(businessId: string): Promise<ApiResult<{ insights: ProAutoInsight[] }>> {
  return apiGetSimple<{ insights: ProAutoInsight[] }>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/monitoring/insights`);
}

export interface WorkspaceRecommendation {
  id: string;
  type: 'action' | 'insight' | 'risk' | 'opportunity';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  explanation?: string;
  sourceModule: string;
  targetModule: string;
  actionLabel?: string;
  actionRoute?: string;
  severity: number;
}

export async function fetchWorkspaceRecommendations(businessId: string, module: string): Promise<ApiResult<WorkspaceRecommendation[]>> {
  return apiGetSimple<WorkspaceRecommendation[]>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/workspace-recommendations?module=${encodeURIComponent(module)}`);
}

export interface AutomationCoverage {
  overallPct: number;
  modules: Array<{ module: string; coveragePct: number; automatedCount: number; totalProcesses: number }>;
}

export async function fetchAutomationCoverage(businessId: string): Promise<ApiResult<AutomationCoverage>> {
  return apiGetSimple<AutomationCoverage>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/automation-coverage`);
}

export interface CrossModuleLinks {
  invoices: Array<{ id: string; number: string; status: string; amount: number }>;
  bookings: Array<{ id: string; date: string; service: string; status: string }>;
  projects: Array<{ id: string; name: string; status: string }>;
}

export async function fetchCrossModuleLinks(businessId: string, entityType: string, entityId: string): Promise<ApiResult<CrossModuleLinks>> {
  return apiGetSimple<CrossModuleLinks>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/cross-module-links?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`);
}

export interface ProfileInterviewMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProfileExtraction {
  value: string;
  category: string;
  key: string;
  confidence: number;
  confirmed: boolean;
}

export interface ProfileInterviewState {
  messages: ProfileInterviewMessage[];
  extractedFields: Record<string, ProfileExtraction>;
  pendingConfirmations: ProfileExtraction[];
  completedTopics: string[];
  nextTopic: string | null;
}

export interface ProfileStatus {
  completedTopics: string[];
  remainingTopics: string[];
  totalTopics: number;
  completionPercent: number;
  memories: Array<{ category: string; key: string; value: string; confidence: number }>;
}

export interface ProfileChatResponse {
  reply: string;
  state: ProfileInterviewState;
  pendingExtractions: ProfileExtraction[];
  currentTopicUnlocks: string | null;
}

export async function sendProfileChat(businessId: string, message: string): Promise<ApiResult<ProfileChatResponse>> {
  return apiPostSimple<ProfileChatResponse>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/profile/chat`, { message });
}

export async function confirmProfileExtractions(businessId: string, confirmedKeys?: string[]): Promise<ApiResult<{ saved: number; skipped: number }>> {
  return apiPostSimple<{ saved: number; skipped: number }>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/profile/confirm`, { confirmedKeys });
}

export async function fetchProfileStatus(businessId: string): Promise<ApiResult<ProfileStatus>> {
  return apiGetSimple<ProfileStatus>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/profile/status`);
}

export async function fetchAiGovernance(businessId: string): Promise<ApiResult<AiAutonomySettings>> {
  return apiGetSimple<AiAutonomySettings>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/governance`);
}

export async function updateAiGovernance(
  businessId: string,
  updates: Partial<AiAutonomySettings>,
): Promise<ApiResult<AiAutonomySettings>> {
  return apiPut<AiAutonomySettings>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/governance`, updates);
}

// ---
// AI MEMORY & PREFERENCES
// ---

export type AiMemoryCategory =
  | 'goals'
  | 'tone'
  | 'riskTolerance'
  | 'outreachStyle'
  | 'reportingCadence'
  | 'priorities'
  | 'bottlenecks'
  | 'corrections'
  | 'patterns'
  | 'preferences';

export interface AiMemoryEntry {
  id: string;
  category: string;
  key: string;
  value: string;
  confidence: number;
  source: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiMemoryContextBlock {
  goals: string[];
  tone: string | null;
  riskTolerance: string | null;
  outreachStyle: string | null;
  reportingCadence: string | null;
  priorities: string[];
  bottlenecks: string[];
  corrections: string[];
  patterns: string[];
}

export async function fetchAiMemory(businessId: string, category?: string): Promise<ApiResult<{ memories: AiMemoryEntry[] }>> {
  const qs = category ? `?category=${encodeURIComponent(category)}` : '';
  return apiGetSimple<{ memories: AiMemoryEntry[] }>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/memory${qs}`);
}

export async function upsertAiMemory(
  businessId: string,
  entry: { category: AiMemoryCategory; key: string; value: string; confidence?: number },
): Promise<ApiResult<{ memory: AiMemoryEntry }>> {
  return apiPut<{ memory: AiMemoryEntry }>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/memory`, entry);
}

export async function upsertAiMemoryBulk(
  businessId: string,
  entries: Array<{ category: AiMemoryCategory; key: string; value: string; confidence?: number }>,
): Promise<ApiResult<{ memories: AiMemoryEntry[] }>> {
  return apiPut<{ memories: AiMemoryEntry[] }>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/memory/bulk`, { entries });
}

export async function deleteAiMemory(
  businessId: string,
  category: string,
  key: string,
): Promise<ApiResult<{ deleted: boolean }>> {
  return apiDelete<{ deleted: boolean }>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/memory/${encodeURIComponent(category)}/${encodeURIComponent(key)}`);
}

export async function fetchAiMemoryContext(businessId: string): Promise<ApiResult<AiMemoryContextBlock>> {
  return apiGetSimple<AiMemoryContextBlock>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/memory/context`);
}

export async function summarizeAiPatterns(businessId: string): Promise<ApiResult<{ patterns: string[] }>> {
  return apiPostSimple<{ patterns: string[] }>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/memory/summarize-patterns`, {});
}

// ---
// STRATEGIC INTELLIGENCE & FORECASTING
// ---

export interface StrategicDashboard {
  momentumScore: number;
  monthlyRevenue: number;
  outstandingRevenue: number;
  overdueInvoices: number;
  overdueAmount: number;
  activeProjects: number;
  overdueTaskCount: number;
  upcomingBookings: number;
  staleLeads: number;
  pendingQuotes: number;
  pendingQuoteValue: number;
  expensesThisMonth: number;
  utilizationRate: number;
}

export interface RevenueForecastPeriod {
  label: string;
  projected: number;
  low: number;
  high: number;
  confidence: number;
}

export interface RevenueForecast {
  summary: string;
  currentMonthlyRun: number;
  projectedMonthlyAvg: number;
  periods: RevenueForecastPeriod[];
  confidenceLevel: string;
  trend: string;
  assumptions: string[];
  risks: string[];
  recurringRevenue: number;
  recommendations: string[];
  dataQuality?: string;
}

export interface ProfitabilityAnalysis {
  summary: string;
  grossMarginPct: number;
  grossProfit: number;
  totalRevenue: number;
  totalExpenses: number;
  netMarginEstimate: number;
  clientBreakdown: Array<{ name: string; revenue: number; marginEstimate: string; recommendation: string }>;
  serviceBreakdown: Array<{ name: string; effectiveHourlyRate: number; profitability: string; recommendation: string }>;
  expenseInsights: string[];
  recommendations: string[];
  concentrationRisk: string;
  concentrationDetail: string;
  dataQuality?: string;
}

export interface PricingAdvisorResult {
  summary: string;
  overallStrategy: string;
  serviceRecommendations: Array<{ name: string; currentPrice: number; suggestedPrice: number; reasoning: string; impact: string }>;
  productRecommendations: Array<{ name: string; currentPrice: number; suggestedPrice: number; reasoning: string; impact: string }>;
  quickWins: string[];
  bundleOpportunities: string[];
  pricingPrinciples: string[];
  dataQuality?: string;
}

export interface SeasonalPatterns {
  summary: string;
  peakMonths: Array<{ month: string; reason: string; avgRevenueIndex: number }>;
  slowMonths: Array<{ month: string; reason: string; avgRevenueIndex: number }>;
  patterns: Array<{ pattern: string; confidence: string; actionable: boolean }>;
  recommendations: Array<{ timing: string; action: string; expectedImpact: string }>;
  dataQuality: string;
  localFactors: string[];
}

export interface OpportunityScan {
  summary: string;
  priority: string;
  totalPotentialValue: number;
  opportunities: Array<{ type: string; title: string; description: string; estimatedValue: number; effort: string; priority: string }>;
  quickWins: Array<{ action: string; expectedValue: number; timeframe: string }>;
  neglectedLeads: number;
  pendingQuoteValue: number;
  reactivationTargets: string[];
  recommendations: string[];
  dataQuality?: string;
}

export interface RiskScan {
  summary: string;
  riskLevel: string;
  riskScore: number;
  risks: Array<{ category: string; title: string; severity: string; description: string; impact: string; mitigation: string }>;
  urgentActions: Array<{ action: string; deadline: string; impact: string }>;
  mitigations: string[];
  overdueTotal: number;
  overdueCount: number;
  cashFlowHealth: string;
  dataQuality?: string;
}

export interface WeeklyPlan {
  summary: string;
  weekOf: string;
  topPriorities: Array<{ priority: string; reason: string; deadline: string }>;
  dailyFocus: Array<{ day: string; theme: string; tasks: string[] }>;
  revenueActions: Array<{ action: string; expectedValue: number; urgency: string }>;
  clientActions: Array<{ action: string; client: string; type: string }>;
  contentPlan: Array<{ action: string; channel: string; day: string }>;
  projectMilestones: Array<{ project: string; milestone: string; dueDate: string }>;
  expenseReview: { monthToDate: number; action: string };
  operationalTasks: string[];
  weeklyGoal: string;
  dataQuality?: string;
}

export async function fetchStrategicDashboard(businessId: string): Promise<ApiResult<StrategicDashboard>> {
  return apiGetSimple<StrategicDashboard>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/strategic/dashboard`);
}

export async function fetchRevenueForecast(businessId: string, days?: number): Promise<ApiResult<RevenueForecast>> {
  const qs = days ? `?days=${days}` : '';
  return apiGetSimple<RevenueForecast>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/strategic/revenue-forecast${qs}`);
}

export async function fetchProfitabilityAnalysis(businessId: string): Promise<ApiResult<ProfitabilityAnalysis>> {
  return apiGetSimple<ProfitabilityAnalysis>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/strategic/profitability`);
}

export async function fetchPricingAdvisor(businessId: string): Promise<ApiResult<PricingAdvisorResult>> {
  return apiGetSimple<PricingAdvisorResult>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/strategic/pricing-advisor`);
}

export async function fetchSeasonalPatterns(businessId: string): Promise<ApiResult<SeasonalPatterns>> {
  return apiGetSimple<SeasonalPatterns>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/strategic/seasonal-patterns`);
}

export async function fetchOpportunityScan(businessId: string): Promise<ApiResult<OpportunityScan>> {
  return apiGetSimple<OpportunityScan>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/strategic/opportunities`);
}

export async function fetchRiskScan(businessId: string): Promise<ApiResult<RiskScan>> {
  return apiGetSimple<RiskScan>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/strategic/risks`);
}

export async function fetchWeeklyPlan(businessId: string): Promise<ApiResult<WeeklyPlan>> {
  return apiGetSimple<WeeklyPlan>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/strategic/weekly-plan`);
}

export interface StrategicAction {
  type: string;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  category: 'revenue' | 'risk' | 'opportunity' | 'operational';
  estimatedValue?: number;
}

export interface ControlTowerPriority {
  id: string;
  type: 'risk' | 'approval' | 'action' | 'opportunity';
  severity: 'critical' | 'warning' | 'info' | 'opportunity';
  title: string;
  description: string;
  module: string;
  urgency: number;
  actionLabel?: string;
  actionRoute?: string;
}

export interface ControlTowerModules {
  contacts: { total: number; byStatus: Record<string, number>; recentCount: number; staleLeadCount: number };
  revenue: { totalCollected: number; outstandingAmount: number; outstandingCount: number; overdueCount: number; overdueAmount: number; monthlyRevenue: number; averageInvoiceValue: number };
  bookings: { upcomingCount: number; completedThisMonth: number; cancelledThisMonth: number; utilizationRate: number };
  expenses: { totalThisMonth: number; topCategories: Array<{ name: string; amount: number }>; budgetUtilization: number };
  projects: { activeCount: number; overdueTaskCount: number; completionRate: number };
  content: { draftPostCount: number; scheduledPostCount: number; draftCampaignCount: number };
  automations: { activeCount: number; disabledCount: number; totalRuns: number };
  storefront: { activeProductCount: number; averagePrice: number };
}

export interface ControlTowerRiskAlert {
  id: string;
  domain: 'cash_flow' | 'churn' | 'overdue' | 'capacity' | 'storefront' | 'delivery';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  module: string;
  actionLabel?: string;
  actionRoute?: string;
}

export interface ControlTowerData {
  snapshot: {
    business: { name: string; industry: string | null; archetype: string | null; currency: string };
    momentumScore: number;
    healthIndicators: Array<{ area: string; status: 'good' | 'warning' | 'critical'; detail: string }>;
  };
  dashboard: StrategicDashboard;
  priorities: ControlTowerPriority[];
  risks: ControlTowerRiskAlert[];
  pendingApprovals: number;
  modules: ControlTowerModules;
}

export async function fetchControlTower(businessId: string): Promise<ApiResult<ControlTowerData>> {
  return apiGetSimple<ControlTowerData>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/control-tower`);
}

export async function fetchStrategicActions(businessId: string): Promise<ApiResult<{ actions: StrategicAction[] }>> {
  return apiGetSimple<{ actions: StrategicAction[] }>(`/ai/businesses/${encodeURIComponent(businessId)}/ai/strategic/actions`);
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
export interface ReportComparison {
  period: { start: string; end: string };
  revenue: { total: number; invoiceCount: number; changePct: number };
  expenses: { total: number; count: number; changePct: number };
  profitability: { netProfit: number; profitMargin: number; changePct: number };
  bookings: { total: number; changePct: number };
  clients: { totalContacts: number; newContacts: number; changePct: number };
}
export interface BookingTimeSeriesPoint {
  date: string;
  completed: number;
  missed: number;
  total: number;
}
export interface ReportModuleData {
  totalBookings?: number;
  completedBookings?: number;
  cancelledBookings?: number;
  noShowRate?: number;
  avgBookingValue?: number;
  utilizationRate?: number;
  bookingTimeSeries?: BookingTimeSeriesPoint[];
  prevBookingTimeSeries?: BookingTimeSeriesPoint[];
  topServices?: Array<{ name: string; count: number; revenue: number }>;
  topStaff?: Array<{ name: string; bookings: number; completionRate: number }>;
  campaignsSent?: number;
  avgOpenRate?: number;
  totalClicks?: number;
  formSubmissions?: number;
  topCampaigns?: Array<{ name: string; openRate: number; clickRate: number; sent: number }>;
  leadSources?: Array<{ name: string; count: number; conversionRate: number }>;
  [key: string]: unknown;
}
export interface GeneratedReport {
  type: string;
  generatedAt: string;
  metrics: ReportMetrics;
  aiNarrative: string;
  comparison?: ReportComparison | null;
  data?: ReportModuleData;
  narrative?: string;
}
export async function fetchReport(businessId: string, type = 'executive', startDate?: string, endDate?: string, compare?: boolean): Promise<ApiResult<GeneratedReport>> {
  const params = new URLSearchParams({ type });
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);
  if (compare) params.set('compare', 'true');
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

export interface CampaignRecipient {
  id: string;
  contactId: string;
  email: string;
  status: string;
  sentAt?: string | null;
  openedAt?: string | null;
  clickedAt?: string | null;
  bouncedAt?: string | null;
}
export interface CampaignRecipientsResponse {
  recipients: CampaignRecipient[];
  summary: { total: number; sent: number; opened: number; clicked: number; bounced: number };
}
export async function fetchCampaignRecipients(
  businessId: string,
  campaignId: string,
): Promise<ApiResult<CampaignRecipientsResponse>> {
  return apiGetSimple<CampaignRecipientsResponse>(
    `/businesses/${encodeURIComponent(businessId)}/campaigns/${encodeURIComponent(campaignId)}/recipients`,
  );
}

export interface MarketingStats {
  totalCampaigns: number;
  sentCount: number;
  avgOpenRate: number;
  avgClickRate: number;
  totalLeads: number;
  formConversionRate: number;
  activeFormsCount: number;
}
export async function fetchMarketingStats(businessId: string): Promise<ApiResult<MarketingStats>> {
  return apiGetSimple<MarketingStats>(`/businesses/${encodeURIComponent(businessId)}/marketing/stats`);
}

// ---
// CAMPAIGN INTELLIGENCE
// ---
export interface CampaignBriefing {
  id: string;
  businessId: string;
  campaignId: string;
  deliveryRate: number | null;
  openRate: number | null;
  clickRate: number | null;
  bounceRate: number | null;
  historicalAvgOpenRate: number | null;
  historicalAvgClickRate: number | null;
  performanceVsAvg: string | null;
  insights: string[] | null;
  recommendations: string[] | null;

  audienceHealth: Record<string, unknown> | null;

  sendTimeAnalysis: Record<string, unknown> | null;
  aiBriefing: string | null;
  createdAt: string;
  campaign?: {
    id: string;
    name: string;
    subject: string;
    sentAt: string | null;
    status: string;
    totalRecipients: number;
  };
}

export interface PreSendWarning {
  severity: 'error' | 'warning' | 'info';
  category: string;
  message: string;
  detail?: string;
  count?: number;
}

export interface PreSendValidationResult {
  valid: boolean;
  warnings: PreSendWarning[];
  audienceSummary: {
    totalTargeted: number;
    withEmail: number;
    withoutEmail: number;
    suppressed: number;
    inactive: number;
    healthy: number;
  };
}

export interface ContactHealthScore {
  contactId: string;
  contactName: string;
  email: string | null;
  category: 'healthy' | 'at-risk' | 'disengaged';
  campaignsSent: number;
  lastSentAt: string | null;
  engagementScore: number;
  recommendedAction: string;
}

export interface AudienceHealthSummary {
  totalContacts: number;
  healthy: number;
  atRisk: number;
  disengaged: number;
  healthPercentage: number;
  recommendations: string[];
  contacts: ContactHealthScore[];
}

export interface SendTimeRecommendation {
  dayOfWeek: string;
  dayIndex: number;
  timeSlot: string;
  score: number;
  campaignCount: number;
  avgOpenRate: number;
  recommendation: string;
  segment?: string;
}

export interface SegmentSendTimeResult {
  overall: SendTimeRecommendation[];
  bySegment: Record<string, SendTimeRecommendation[]>;
}

export async function fetchCampaignBriefings(businessId: string): Promise<ApiResult<CampaignBriefing[]>> {
  return apiGetSimple<CampaignBriefing[]>(`/businesses/${encodeURIComponent(businessId)}/campaign-intelligence/briefings`);
}
export async function fetchCampaignBriefing(businessId: string, campaignId: string): Promise<ApiResult<CampaignBriefing>> {
  return apiGetSimple<CampaignBriefing>(`/businesses/${encodeURIComponent(businessId)}/campaign-intelligence/briefing/${encodeURIComponent(campaignId)}`);
}
export async function runPreSendValidation(businessId: string, campaignId: string): Promise<ApiResult<PreSendValidationResult>> {
  return apiPost<PreSendValidationResult>({ path: `/businesses/${encodeURIComponent(businessId)}/campaign-intelligence/pre-send-validation/${encodeURIComponent(campaignId)}`, body: {} });
}
export async function fetchAudienceHealth(businessId: string): Promise<ApiResult<AudienceHealthSummary>> {
  return apiGetSimple<AudienceHealthSummary>(`/businesses/${encodeURIComponent(businessId)}/campaign-intelligence/audience-health`);
}
export async function fetchSendTimeRecommendations(businessId: string): Promise<ApiResult<SegmentSendTimeResult>> {
  return apiGetSimple<SegmentSendTimeResult>(`/businesses/${encodeURIComponent(businessId)}/campaign-intelligence/send-time-recommendations`);
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
export interface MatchedProviderEntry {
  businessId: string;
  name: string;
  logoUrl?: string | null;
  headline?: string | null;
  score: number;
  explanation: string;
}
export interface MatchedProvidersSnapshot {
  status?: "pending" | "complete";
  startedAt?: string;
  computedAt?: string;
  providers: MatchedProviderEntry[];
}
export interface CommunityPost {
  id: string;
  title?: string;
  content: string;
  type: string;
  tags: string[];
  likes: number;
  isPinned: boolean;
  businessId: string;
  business?: { id: string; name: string; logoUrl?: string; headline?: string; bio?: string; industry?: string };
  _count?: { comments: number };
  matchedProviders?: MatchedProvidersSnapshot | null;
  createdAt: string;
}
export interface CommunityComment {
  id: string;
  content: string;
  postId: string;
  businessId: string;
  business?: { id: string; name: string; logoUrl?: string; headline?: string };
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
export interface TrustSignals {
  reputationScore: number;
  badges: { id: string; label: string; icon: string }[];
  endorsementCount: number;
  topEndorsedSkills: { skill: string; count: number }[];
  isVerified?: boolean;
  verifiedAt?: string;
  averageRating?: number;
  totalReviews?: number;
  totalCompleted?: number;
  completedQuotes?: number;
  completedCollabs?: number;
  completedReferrals?: number;
  onTimeRate?: number;
  responseTimeHours?: number;
  repeatClientRate?: number;
  referralsReceived?: number;
  referralsAccepted?: number;
  referralsConverted?: number;
  referralConversionRate?: number;
}
export interface EndorsementData {
  id: string;
  skill: string;
  message?: string;
  createdAt: string;
  fromBusiness: { id: string; name: string; logoUrl?: string; headline?: string };
}
export interface CommunityProfile {
  id: string;
  name: string;
  slug?: string;
  logoUrl?: string;
  headline?: string;
  bio?: string;
  industry?: string;
  skills: string[];
  businessStage?: string;
  city?: string;
  country?: string;
  interests: string[];
  profileCompleteness: number;
  tagline?: string;
  acceptingWork: boolean;
  currentCapacity?: string;
  leadTime?: string;
  preferredProjectTypes: string[];
  budgetFit?: string;
  positioningStatement?: string;
  products?: { id: string; name: string; price: number; currency: string; category: string; imageUrl?: string; description?: string }[];
  services?: { id: string; name: string; price: number; currency: string; durationMins?: number; description?: string }[];
  createdAt: string;
  _count?: { communityPosts: number; cohortMembers: number; networkConnectionsTo: number; endorsementsReceived?: number };
}
export interface DirectoryBusiness {
  id: string;
  name: string;
  slug?: string;
  logoUrl?: string;
  headline?: string;
  bio?: string;
  industry?: string;
  skills: string[];
  businessStage?: string;
  city?: string;
  country?: string;
  tagline?: string;
  acceptingWork: boolean;
  currentCapacity?: string;
  leadTime?: string;
  preferredProjectTypes: string[];
  budgetFit?: string;
  positioningStatement?: string;
  profileCompleteness: number;
  products?: { id: string; name: string; price: number; currency: string; category: string }[];
  services?: { id: string; name: string; price: number; currency: string }[];
  _count?: { communityPosts: number; cohortMembers: number; networkConnectionsTo: number; endorsementsReceived?: number };
  reputationScore?: number;
  badges?: { id: string; label: string; icon: string }[];
  averageRating?: number;
  totalReviews?: number;
  totalCompleted?: number;
  isVerified?: boolean;
  onTimeRate?: number;
  createdAt?: string;
}
export interface NetworkConnectionStatus {
  following: boolean;
  saved: boolean;
}
export interface DocumentRecommendation {
  category: 'Legal' | 'Financial' | 'Creative' | 'Constitutional';
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
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
export async function fetchCommunityProfile(businessId: string): Promise<ApiResult<CommunityProfile>> {
  return apiGetSimple<CommunityProfile>(`/identity/businesses/community-profile/${encodeURIComponent(businessId)}`);
}
export async function searchDirectory(params?: Record<string, string>): Promise<ApiResult<{ data: DirectoryBusiness[]; total: number; page: number; limit: number }>> {
  const q = params ? '?' + new URLSearchParams(params).toString() : '';
  return apiGetSimple<{ data: DirectoryBusiness[]; total: number; page: number; limit: number }>(`/community/directory${q}`);
}
export async function createNetworkConnection(businessId: string, toBusinessId: string, type: string = 'FOLLOW'): Promise<ApiResult<void>> {
  return apiPost<void>({ path: `/businesses/${encodeURIComponent(businessId)}/community/connections`, body: { toBusinessId, type } });
}
export async function removeNetworkConnection(businessId: string, toBusinessId: string, type: string = 'FOLLOW'): Promise<ApiResult<void>> {
  return apiDelete<void>(`/businesses/${encodeURIComponent(businessId)}/community/connections`, { toBusinessId, type });
}
export async function getConnectionStatus(businessId: string, targetId: string): Promise<ApiResult<NetworkConnectionStatus>> {
  return apiGetSimple<NetworkConnectionStatus>(`/businesses/${encodeURIComponent(businessId)}/community/connection-status/${encodeURIComponent(targetId)}`);
}
export interface BusinessRecommendation {
  businessId: string;
  score: number;
  reasons: string[];
  explanation: string;
  matchType: 'complementary_skills' | 'same_industry' | 'referral_partner' | 'collaboration' | 'general';
  business: DirectoryBusiness;
}
export async function fetchBusinessRecommendations(businessId: string, refresh = false): Promise<ApiResult<BusinessRecommendation[]>> {
  const q = refresh ? '?refresh=true' : '';
  return apiGetSimple<BusinessRecommendation[]>(`/businesses/${encodeURIComponent(businessId)}/community/recommendations${q}`);
}

export interface AiIntroDraft {
  draft: string;
  tone: string;
  suggestedFollowUp?: string;
}
export async function draftAiIntroMessage(
  businessId: string,
  toBusinessId: string,
  options?: { context?: string; goal?: 'introduce' | 'collaborate' | 'quote' | 'referral'; source?: string },
): Promise<ApiResult<AiIntroDraft>> {
  return apiPost<AiIntroDraft>({
    path: `/businesses/${encodeURIComponent(businessId)}/community/intro-draft`,
    body: { toBusinessId, ...(options || {}) },
  });
}

export interface NeedMatchProvider extends BusinessRecommendation {
  relevanceReason: string;
}
export async function fetchProvidersForNeed(
  businessId: string,
  need: { title?: string; description: string; budgetMin?: number; budgetMax?: number; timeline?: string; projectType?: string; categoryHint?: string; limit?: number },
): Promise<ApiResult<NeedMatchProvider[]>> {
  return apiPost<NeedMatchProvider[]>({
    path: `/businesses/${encodeURIComponent(businessId)}/community/need-matches`,
    body: need,
  });
}

export interface RelationshipInsightItem {
  businessId: string;
  name: string;
  logoUrl?: string | null;
  headline?: string | null;
  industry?: string | null;
  lastInteractionAt?: string | null;
  reason: string;
  suggestedAction: 'reconnect' | 'collaborate' | 'review' | 'follow_up';
}
export interface RelationshipInsights {
  underutilized: RelationshipInsightItem[];
  suggestions: string[];
}
export async function fetchRelationshipInsights(businessId: string): Promise<ApiResult<RelationshipInsights>> {
  return apiGetSimple<RelationshipInsights>(`/businesses/${encodeURIComponent(businessId)}/community/relationship-insights`);
}
export interface RelationshipInsightDismissalResult {
  businessId: string;
  targetBusinessId: string;
  dismissedAt: string;
  snoozedUntil: string | null;
}
export async function dismissRelationshipInsight(
  businessId: string,
  targetBusinessId: string,
  snoozeDays?: number,
): Promise<ApiResult<RelationshipInsightDismissalResult>> {
  return apiPost<RelationshipInsightDismissalResult>({
    path: `/businesses/${encodeURIComponent(businessId)}/community/relationship-insights/dismiss`,
    body: { targetBusinessId, snoozeDays },
  });
}
export async function restoreRelationshipInsight(
  businessId: string,
  targetBusinessId: string,
): Promise<ApiResult<{ removed: boolean }>> {
  return apiDelete<{ removed: boolean }>(`/businesses/${encodeURIComponent(businessId)}/community/relationship-insights/dismiss/${encodeURIComponent(targetBusinessId)}`);
}
export async function fetchTrustSignals(businessId: string): Promise<ApiResult<TrustSignals>> {
  return apiGetSimple<TrustSignals>(`/community/trust-signals/${encodeURIComponent(businessId)}`);
}
export async function fetchEndorsements(businessId: string): Promise<ApiResult<{ endorsements: EndorsementData[]; topSkills: { skill: string; count: number }[]; total: number }>> {
  return apiGetSimple<{ endorsements: EndorsementData[]; topSkills: { skill: string; count: number }[]; total: number }>(`/community/endorsements/${encodeURIComponent(businessId)}`);
}
export async function fetchMyEndorsementsGiven(businessId: string, targetId: string): Promise<ApiResult<{ skill: string; message?: string }[]>> {
  return apiGetSimple<{ skill: string }[]>(`/businesses/${encodeURIComponent(businessId)}/community/endorsements-given/${encodeURIComponent(targetId)}`);
}
export async function createEndorsement(businessId: string, toBusinessId: string, skill: string, message?: string): Promise<ApiResult<EndorsementData>> {
  return apiPost<EndorsementData>({ path: `/businesses/${encodeURIComponent(businessId)}/community/endorsements`, body: { toBusinessId, skill, message } });
}
export async function updateEndorsement(businessId: string, toBusinessId: string, skill: string, message: string): Promise<ApiResult<EndorsementData>> {
  return apiPatch<EndorsementData>(`/businesses/${encodeURIComponent(businessId)}/community/endorsements`, { toBusinessId, skill, message });
}
export async function removeEndorsement(businessId: string, toBusinessId: string, skill: string): Promise<ApiResult<void>> {
  return apiDelete<void>(`/businesses/${encodeURIComponent(businessId)}/community/endorsements`, { toBusinessId, skill });
}

export interface ConversationSummary {
  id: string;
  otherBusiness: { id: string; name: string; logoUrl?: string; headline?: string; industry?: string };
  lastMessage: { id: string; content: string; senderName: string; isMine: boolean; createdAt: string; readAt?: string | null } | null;
  lastMessageAt: string | null;
  createdAt: string;
}
export interface DirectMessageItem {
  id: string;
  conversationId: string;
  senderBusinessId: string;
  senderBusiness: { id: string; name: string; logoUrl?: string; headline?: string; industry?: string };
  content: string;
  readAt?: string | null;
  createdAt: string;
}
export interface ConversationDetail {
  messages: DirectMessageItem[];
  total: number;
  page: number;
  limit: number;
  otherBusiness: { id: string; name: string; logoUrl?: string; headline?: string; industry?: string };
  conversationId: string;
}
export interface CollabRequest {
  id: string;
  fromBusinessId: string;
  toBusinessId: string;
  fromBusiness: { id: string; name: string; logoUrl?: string; headline?: string; industry?: string };
  toBusiness: { id: string; name: string; logoUrl?: string; headline?: string; industry?: string };
  type: string;
  title: string;
  message?: string | null;
  status: string;
  respondedAt?: string | null;
  createdAt: string;
}
export interface CommunityNotificationItem {
  id: string;
  businessId: string;
  type: string;
  title: string;
  body?: string | null;
  referenceId?: string | null;
  referenceType?: string | null;
  data?: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
}

export async function sendDirectMessage(
  businessId: string,
  toBusinessId: string,
  content: string,
  options?: { aiDraftUsed?: boolean; aiSuggestionSource?: string },
): Promise<ApiResult<DirectMessageItem>> {
  return apiPost<DirectMessageItem>({
    path: `/businesses/${encodeURIComponent(businessId)}/community/messages`,
    body: { toBusinessId, content, ...(options || {}) },
  });
}
export async function fetchConversations(businessId: string): Promise<ApiResult<ConversationSummary[]>> {
  return apiGetSimple<ConversationSummary[]>(`/businesses/${encodeURIComponent(businessId)}/community/conversations`);
}
export async function fetchConversationMessages(businessId: string, conversationId: string, page?: number): Promise<ApiResult<ConversationDetail>> {
  const q = page ? `?page=${page}` : '';
  return apiGetSimple<ConversationDetail>(`/businesses/${encodeURIComponent(businessId)}/community/conversations/${encodeURIComponent(conversationId)}${q}`);
}
export async function fetchUnreadMessageCount(businessId: string): Promise<ApiResult<{ count: number }>> {
  return apiGetSimple<{ count: number }>(`/businesses/${encodeURIComponent(businessId)}/community/messages/unread-count`);
}
export async function createCollabRequest(businessId: string, data: { toBusinessId: string; type?: string; title: string; message?: string }): Promise<ApiResult<CollabRequest>> {
  return apiPost<CollabRequest>({ path: `/businesses/${encodeURIComponent(businessId)}/community/collab-requests`, body: data });
}
export async function respondToCollabRequest(businessId: string, requestId: string, status: 'ACCEPTED' | 'DECLINED'): Promise<ApiResult<CollabRequest>> {
  return apiPatch<CollabRequest>(`/businesses/${encodeURIComponent(businessId)}/community/collab-requests/${encodeURIComponent(requestId)}`, { status });
}
export async function fetchCollabRequests(businessId: string, direction: 'incoming' | 'outgoing' = 'incoming', status?: string): Promise<ApiResult<CollabRequest[]>> {
  const params = new URLSearchParams({ direction });
  if (status) params.set('status', status);
  return apiGetSimple<CollabRequest[]>(`/businesses/${encodeURIComponent(businessId)}/community/collab-requests?${params.toString()}`);
}
export async function fetchCommunityNotifications(businessId: string, page?: number): Promise<ApiResult<{ data: CommunityNotificationItem[]; total: number; unreadCount: number }>> {
  const q = page ? `?page=${page}` : '';
  return apiGetSimple<{ data: CommunityNotificationItem[]; total: number; unreadCount: number }>(`/businesses/${encodeURIComponent(businessId)}/community/notifications${q}`);
}
export async function markNotificationRead(businessId: string, notificationId: string): Promise<ApiResult<CommunityNotificationItem>> {
  return apiPatch<CommunityNotificationItem>(`/businesses/${encodeURIComponent(businessId)}/community/notifications/${encodeURIComponent(notificationId)}/read`, {});
}
export async function markAllNotificationsRead(businessId: string): Promise<ApiResult<void>> {
  return apiPost<void>({ path: `/businesses/${encodeURIComponent(businessId)}/community/notifications/read-all`, body: {} });
}
export async function fetchUnreadNotificationCount(businessId: string): Promise<ApiResult<{ count: number }>> {
  return apiGetSimple<{ count: number }>(`/businesses/${encodeURIComponent(businessId)}/community/notifications/unread-count`);
}

export interface MatchFeedbackPayload {
  targetBusinessId: string;
  feedback: 'HELPFUL' | 'DISMISSED';
  matchScore?: number;
  matchType?: string;
}
export async function submitMatchFeedback(businessId: string, payload: MatchFeedbackPayload): Promise<ApiResult<{ id: string }>> {
  return apiPost<{ id: string }>({ path: `/businesses/${encodeURIComponent(businessId)}/community/match-feedback`, body: payload });
}
export interface MatchAnalytics {
  total: number;
  helpful: number;
  dismissed: number;
  helpfulRate: number;
  avgScoreHelpful: number | null;
  avgScoreDismissed: number | null;
  byType: Record<string, { helpful: number; dismissed: number; total: number }>;
}
export async function fetchMatchAnalytics(businessId: string): Promise<ApiResult<MatchAnalytics>> {
  return apiGetSimple<MatchAnalytics>(`/businesses/${encodeURIComponent(businessId)}/community/match-analytics`);
}

export type AiSuggestionEventType =
  | 'SUGGESTION_CLICKED'
  | 'INTRO_DRAFT_GENERATED'
  | 'INTRO_DRAFT_USED'
  | 'MESSAGE_SENT'
  | 'CONNECTION_MADE'
  | 'QUOTE_REQUESTED'
  | 'COLLAB_CREATED'
  | 'DEAL_WON';

export type AiSuggestionSource =
  | 'recommendations'
  | 'relationship_insights'
  | 'need_match'
  | 'quote_request_modal'
  | 'message_modal'
  | 'send_message_modal'
  | string;

export interface AiSuggestionEventInput {
  eventType: AiSuggestionEventType;
  source: AiSuggestionSource;
  targetBusinessId?: string;
  score?: number;
  matchType?: string;

  metadata?: Record<string, unknown>;
}

export async function logAiSuggestionEvent(
  businessId: string,
  input: AiSuggestionEventInput,
): Promise<ApiResult<{ id: string } | null>> {
  return apiPost<{ id: string } | null>({
    path: `/businesses/${encodeURIComponent(businessId)}/community/ai-suggestion-events`,
    body: input,
  });
}

export interface AiSuggestionFunnel {
  totals: {
    clicked: number;
    introDraftsGenerated: number;
    introDraftsUsed: number;
    messagesSent: number;
    connectionsMade: number;
    quotesRequested: number;
    collabsCreated: number;
    dealsWon: number;
  };
  bySource: Record<string, { clicked: number; messagesSent: number; quotesRequested: number; connectionsMade: number; dealsWon: number }>;
  conversionRates: {
    clickToMessage: number;
    clickToQuote: number;
    clickToConnection: number;
    clickToDeal: number;
    draftUsageRate: number;
  };
  convertedSuggestions: Array<{
    targetBusinessId: string;
    targetBusinessName: string;
    source: string;
    score: number | null;
    clickedAt: string;
    outcomeType: string;
    outcomeAt: string;
  }>;
  recent: Array<{
    id: string;
    eventType: string;
    source: string;
    score: number | null;
    matchType: string | null;
    targetBusinessId: string | null;
    targetBusinessName: string | null;
    createdAt: string;
  }>;
}

export async function fetchAiSuggestionFunnel(businessId: string): Promise<ApiResult<AiSuggestionFunnel>> {
  return apiGetSimple<AiSuggestionFunnel>(
    `/businesses/${encodeURIComponent(businessId)}/community/ai-suggestion-funnel`,
  );
}
export async function generateAiProfile(businessId: string, data: { name?: string; industry?: string; skills?: string[]; businessStage?: string; description?: string }): Promise<ApiResult<{ headline: string; bio: string }>> {
  return apiPost<{ headline: string; bio: string }>({ path: `/identity/businesses/${encodeURIComponent(businessId)}/generate-profile`, body: data });
}
export async function fetchDocumentGuidance(businessId: string): Promise<ApiResult<{ recommendations: DocumentRecommendation[] }>> {
  return apiGetSimple<{ recommendations: DocumentRecommendation[] }>(`/identity/businesses/${encodeURIComponent(businessId)}/document-guidance`);
}

// ---
// COMMUNITY RELATIONSHIPS & TRANSACTIONS
// ---
export interface CommunityQuoteRequest {
  id: string;
  fromBusinessId: string;
  toBusinessId: string;
  fromBusiness?: { id: string; name: string; logoUrl?: string; headline?: string; industry?: string };
  toBusiness?: { id: string; name: string; logoUrl?: string; headline?: string; industry?: string };
  title: string;
  description: string;
  budgetMin?: number;
  budgetMax?: number;
  currency: string;
  timeline?: string;
  attachments: string[];
  status: string;
  responseNote?: string;
  respondedAt?: string;
  createdAt: string;
}
export interface CommunityReferral {
  id: string;
  fromBusinessId: string;
  toBusinessId: string;
  fromBusiness?: { id: string; name: string; logoUrl?: string; headline?: string; industry?: string };
  toBusiness?: { id: string; name: string; logoUrl?: string; headline?: string; industry?: string };
  referredToName: string;
  referredToEmail?: string;
  referredToPhone?: string;
  opportunity: string;
  context?: string;
  status: string;
  statusNote?: string;
  createdAt: string;
}
export interface CommunityCollaboration {
  id: string;
  fromBusinessId: string;
  toBusinessId: string;
  fromBusiness?: { id: string; name: string; logoUrl?: string; headline?: string; industry?: string };
  toBusiness?: { id: string; name: string; logoUrl?: string; headline?: string; industry?: string };
  type: string;
  title: string;
  scope: string;
  proposedTerms?: string;
  timeline?: string;
  status: string;
  responseNote?: string;
  projectId?: string;
  respondedAt?: string;
  createdAt: string;
}
export interface BusinessMessageItem {
  id: string;
  fromBusinessId: string;
  toBusinessId: string;
  fromBusiness?: { id: string; name: string; logoUrl?: string; headline?: string; industry?: string };
  toBusiness?: { id: string; name: string; logoUrl?: string; headline?: string; industry?: string };
  threadId?: string;
  content: string;
  read: boolean;
  readAt?: string;
  createdAt: string;
}
export interface MessageThread {
  threadId: string;
  otherBusiness: { id: string; name: string; logoUrl?: string; headline?: string; industry?: string };
  lastMessage: BusinessMessageItem;
  unreadCount: number;
}
export interface SavedBusinessItem {
  id: string;
  businessId: string;
  savedBusinessId: string;
  savedBusiness: { id: string; name: string; logoUrl?: string; headline?: string; industry?: string; bio?: string; city?: string; country?: string; skills?: string[] };
  note?: string;
  createdAt: string;
}
export interface InteractionHistory {
  quoteRequests: CommunityQuoteRequest[];
  referrals: CommunityReferral[];
  collaborations: CommunityCollaboration[];
  recentMessages: BusinessMessageItem[];
}
export interface CommunityReview {
  id: string;
  reviewerBusinessId: string;
  revieweeBusinessId: string;
  reviewerBusiness?: { id: string; name: string; logoUrl?: string; headline?: string; industry?: string };
  revieweeBusiness?: { id: string; name: string; logoUrl?: string; headline?: string; industry?: string };
  transactionType: 'QUOTE_REQUEST' | 'COLLABORATION' | 'REFERRAL';
  transactionId: string;
  rating: number;
  qualityRating?: number;
  communicationRating?: number;
  timelinessRating?: number;
  title?: string;
  body?: string;
  isPublic: boolean;
  isHidden: boolean;
  createdAt: string;
}
export interface BusinessReputation {
  businessId: string;
  averageRating: number;
  totalReviews: number;
  averageQuality: number;
  averageCommunication: number;
  averageTimeliness: number;
  totalQuotesReceived: number;
  totalQuotesResponded: number;
  totalQuotesAccepted: number;
  totalCollaborations: number;
  totalCollaborationsCompleted: number;
  totalReferralsReceived: number;
  totalReferralsAccepted: number;
  totalReferralsConverted: number;
  totalCompleted: number;
  responseTimeHours: number;
  onTimeRate: number;
  repeatClientRate: number;
  referralConversionRate: number;
  reputationScore: number;
  isVerified: boolean;
  verifiedAt?: string;
  lastCalculatedAt: string;
}
export interface ReviewableTransaction {
  type: 'QUOTE_REQUEST' | 'COLLABORATION' | 'REFERRAL';
  id: string;
  title: string;
  status: string;
  createdAt: string;
  alreadyReviewed?: boolean;
}

export async function createCommunityQuoteRequest(
  businessId: string,
  data: {
    toBusinessId: string;
    title: string;
    description: string;
    budgetMin?: number;
    budgetMax?: number;
    currency?: string;
    timeline?: string;
    aiSuggestionSource?: string;
    aiSuggestionScore?: number;
  },
): Promise<ApiResult<CommunityQuoteRequest>> {
  return apiPost<CommunityQuoteRequest>({ path: `/businesses/${encodeURIComponent(businessId)}/community/quote-requests`, body: data });
}
export async function fetchCommunityQuoteRequests(businessId: string, direction: 'sent' | 'received' = 'received'): Promise<ApiResult<CommunityQuoteRequest[]>> {
  return apiGetSimple<CommunityQuoteRequest[]>(`/businesses/${encodeURIComponent(businessId)}/community/quote-requests?direction=${direction}`);
}
export async function respondToCommunityQuoteRequest(businessId: string, requestId: string, data: { status: string; responseNote?: string }): Promise<ApiResult<CommunityQuoteRequest>> {
  return apiPatch<CommunityQuoteRequest>(`/businesses/${encodeURIComponent(businessId)}/community/quote-requests/${requestId}/respond`, data);
}
export async function createCommunityReferral(businessId: string, data: { toBusinessId: string; referredToName: string; referredToEmail?: string; referredToPhone?: string; opportunity: string; context?: string }): Promise<ApiResult<CommunityReferral>> {
  return apiPost<CommunityReferral>({ path: `/businesses/${encodeURIComponent(businessId)}/community/referrals`, body: data });
}
export async function fetchCommunityReferrals(businessId: string, direction: 'sent' | 'received' = 'received'): Promise<ApiResult<CommunityReferral[]>> {
  return apiGetSimple<CommunityReferral[]>(`/businesses/${encodeURIComponent(businessId)}/community/referrals?direction=${direction}`);
}
export async function updateCommunityReferralStatus(businessId: string, referralId: string, data: { status: string; statusNote?: string }): Promise<ApiResult<CommunityReferral>> {
  return apiPatch<CommunityReferral>(`/businesses/${encodeURIComponent(businessId)}/community/referrals/${referralId}/status`, data);
}
export async function createCommunityCollaboration(businessId: string, data: { toBusinessId: string; type?: string; title: string; scope: string; proposedTerms?: string; timeline?: string }): Promise<ApiResult<CommunityCollaboration>> {
  return apiPost<CommunityCollaboration>({ path: `/businesses/${encodeURIComponent(businessId)}/community/collaborations`, body: data });
}
export async function fetchCommunityCollaborations(businessId: string, direction: 'sent' | 'received' = 'received'): Promise<ApiResult<CommunityCollaboration[]>> {
  return apiGetSimple<CommunityCollaboration[]>(`/businesses/${encodeURIComponent(businessId)}/community/collaborations?direction=${direction}`);
}
export async function respondToCommunityCollaboration(businessId: string, collabId: string, data: { status: string; responseNote?: string }): Promise<ApiResult<CommunityCollaboration>> {
  return apiPatch<CommunityCollaboration>(`/businesses/${encodeURIComponent(businessId)}/community/collaborations/${collabId}/respond`, data);
}
export async function sendBusinessMessage(
  businessId: string,
  data: { toBusinessId: string; content: string; aiDraftUsed?: boolean; aiSuggestionSource?: string },
): Promise<ApiResult<BusinessMessageItem>> {
  return apiPost<BusinessMessageItem>({ path: `/businesses/${encodeURIComponent(businessId)}/community/messages`, body: data });
}
export async function fetchMessageThreads(businessId: string): Promise<ApiResult<MessageThread[]>> {
  return apiGetSimple<MessageThread[]>(`/businesses/${encodeURIComponent(businessId)}/community/messages/threads`);
}
export async function fetchMessageThread(businessId: string, otherBusinessId: string): Promise<ApiResult<{ messages: BusinessMessageItem[]; otherBusiness: unknown }>> {
  return apiGetSimple<{ messages: BusinessMessageItem[]; otherBusiness: unknown }>(`/businesses/${encodeURIComponent(businessId)}/community/messages/thread/${encodeURIComponent(otherBusinessId)}`);
}
export async function saveBusinessToShortlist(businessId: string, savedBusinessId: string, note?: string): Promise<ApiResult<SavedBusinessItem>> {
  return apiPost<SavedBusinessItem>({ path: `/businesses/${encodeURIComponent(businessId)}/community/saved`, body: { savedBusinessId, note } });
}
export async function unsaveBusinessFromShortlist(businessId: string, savedBusinessId: string): Promise<ApiResult<void>> {
  return apiDelete<void>(`/businesses/${encodeURIComponent(businessId)}/community/saved/${encodeURIComponent(savedBusinessId)}`);
}
export async function fetchSavedBusinesses(businessId: string): Promise<ApiResult<SavedBusinessItem[]>> {
  return apiGetSimple<SavedBusinessItem[]>(`/businesses/${encodeURIComponent(businessId)}/community/saved`);
}
export async function checkBusinessSaved(businessId: string, targetBusinessId: string): Promise<ApiResult<{ saved: boolean }>> {
  return apiGetSimple<{ saved: boolean }>(`/businesses/${encodeURIComponent(businessId)}/community/saved/check/${encodeURIComponent(targetBusinessId)}`);
}
export async function fetchInteractionHistory(businessId: string, otherBusinessId: string): Promise<ApiResult<InteractionHistory>> {
  return apiGetSimple<InteractionHistory>(`/businesses/${encodeURIComponent(businessId)}/community/history/${encodeURIComponent(otherBusinessId)}`);
}
export async function fetchBusinessReputation(businessId: string): Promise<ApiResult<BusinessReputation>> {
  return apiGetSimple<BusinessReputation>(`/community/reputation/${encodeURIComponent(businessId)}`);
}
export async function fetchBusinessReviews(businessId: string, limit?: number): Promise<ApiResult<{ reviews: CommunityReview[]; total: number }>> {
  const q = limit ? `?limit=${limit}` : '';
  return apiGetSimple<{ reviews: CommunityReview[]; total: number }>(`/community/reviews/${encodeURIComponent(businessId)}${q}`);
}
export async function fetchReviewsGivenByBusiness(businessId: string, limit?: number): Promise<ApiResult<{ reviews: CommunityReview[]; total: number }>> {
  const q = limit ? `?limit=${limit}` : '';
  return apiGetSimple<{ reviews: CommunityReview[]; total: number }>(`/businesses/${encodeURIComponent(businessId)}/community/reviews/given${q}`);
}
export async function fetchReviewableTransactions(businessId: string, otherBusinessId: string): Promise<ApiResult<ReviewableTransaction[]>> {
  return apiGetSimple<ReviewableTransaction[]>(`/businesses/${encodeURIComponent(businessId)}/community/reviewable/${encodeURIComponent(otherBusinessId)}`);
}
export async function createCommunityReview(businessId: string, data: { revieweeBusinessId: string; transactionType: 'QUOTE_REQUEST' | 'COLLABORATION' | 'REFERRAL'; transactionId: string; rating: number; title?: string; body?: string; qualityRating?: number; communicationRating?: number; timelinessRating?: number; isPublic?: boolean }): Promise<ApiResult<CommunityReview>> {
  return apiPost<CommunityReview>({ path: `/businesses/${encodeURIComponent(businessId)}/community/reviews`, body: data });
}
export async function deleteCommunityReview(businessId: string, reviewId: string): Promise<ApiResult<void>> {
  return apiDelete<void>(`/businesses/${encodeURIComponent(businessId)}/community/reviews/${encodeURIComponent(reviewId)}`);
}
export async function markReferralOutcome(businessId: string, referralId: string, outcome: 'CONVERTED' | 'NOT_CONVERTED', note?: string): Promise<ApiResult<CommunityReferral>> {
  return apiPatch<CommunityReferral>(`/businesses/${encodeURIComponent(businessId)}/community/referrals/${encodeURIComponent(referralId)}/outcome`, { outcome, note });
}
export async function fetchCommunityDirectory(params?: { search?: string; industry?: string; stage?: string; skill?: string; page?: number; limit?: number }): Promise<ApiResult<{ data: DirectoryBusiness[]; total: number }>> {
  const sp = new URLSearchParams();
  if (params?.search) sp.set('search', params.search);
  if (params?.industry) sp.set('industry', params.industry);
  if (params?.stage) sp.set('stage', params.stage);
  if (params?.skill) sp.set('skill', params.skill);
  if (params?.page) sp.set('page', String(params.page));
  if (params?.limit) sp.set('limit', String(params.limit));
  const q = sp.toString() ? `?${sp.toString()}` : '';
  return apiGetSimple<{ data: DirectoryBusiness[]; total: number }>(`/community/directory${q}`);
}


// ---
// BUSINESS SIMULATION
// ---
export interface SimulationResult {
  simulation: string;
}
export async function runSimulation(businessId: string, scenario: string, variables?: Record<string, unknown>): Promise<ApiResult<SimulationResult>> {
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
export interface WebhookDeliveryLog {
  id: string;
  webhookId: string;
  businessId: string;
  event: string;
  url: string;
  status: 'success' | 'failed';
  statusCode: number | null;
  attempts: number;
  duration: number;
  error: string | null;
  timestamp: string;
}
export async function testWebhook(businessId: string, webhookId: string): Promise<ApiResult<WebhookDeliveryLog>> {
  return apiPost<WebhookDeliveryLog>({ path: `/businesses/${encodeURIComponent(businessId)}/webhooks/${webhookId}/test`, body: {} });
}
export async function fetchWebhookDeliveries(businessId: string, webhookId: string, limit = 20): Promise<ApiResult<WebhookDeliveryLog[]>> {
  return apiGetSimple<WebhookDeliveryLog[]>(`/businesses/${encodeURIComponent(businessId)}/webhooks/${webhookId}/deliveries?limit=${limit}`);
}
export async function toggleWebhook(businessId: string, webhookId: string, isActive: boolean): Promise<ApiResult<{ success: boolean; isActive: boolean }>> {
  return apiPost<{ success: boolean; isActive: boolean }>({ path: `/businesses/${encodeURIComponent(businessId)}/webhooks/${webhookId}/toggle`, body: { isActive } });
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
  filters?: unknown;
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
  data: { name: string; description?: string; color?: string; type?: string; filters?: unknown; rules?: unknown; contactIds?: string[] },
): Promise<ApiResult<ContactList>> {
  return apiPost<ContactList>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/lists`,
    body: data,
  });
}

export async function updateContactList(
  businessId: string,
  listId: string,
  data: { name?: string; description?: string; color?: string; type?: string; filters?: unknown; rules?: unknown; contactIds?: string[] },
): Promise<ApiResult<ContactList>> {
  const url = `${API_BASE}/crm/businesses/${encodeURIComponent(businessId)}/lists/${encodeURIComponent(listId)}`;
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) return { data: null, error: (json as { message?: string } | null)?.message ?? res.statusText };
    return { data: json as ContactList, error: null };
  } catch (e: unknown) {
    return { data: null, error: e instanceof Error ? e.message : 'Network error' };
  }
}

export async function deleteContactList(businessId: string, listId: string): Promise<ApiResult<void>> {
  return apiDelete<void>(`/crm/businesses/${encodeURIComponent(businessId)}/lists/${encodeURIComponent(listId)}`);
}

// ---- Contact saved views (per-user) -----------------------------------

export type ContactSavedViewSort = { sortBy?: string; sortOrder?: "asc" | "desc" };

export interface ContactSavedView {
  id: string;
  businessId: string;
  userId: string;
  name: string;
  filterState: Record<string, unknown>;
  sort: ContactSavedViewSort | null;
  visibleColumns: string[];
  createdAt: string;
  updatedAt: string;
}

const contactSavedViewSchema = z.object({
  id: z.string(),
  businessId: z.string(),
  userId: z.string(),
  name: z.string(),
  filterState: z.record(z.unknown()),
  sort: z.object({ sortBy: z.string().optional(), sortOrder: z.enum(["asc", "desc"]).optional() }).nullable().optional(),
  visibleColumns: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
}) as unknown as z.ZodSchema<ContactSavedView>;

export async function fetchSavedViews(
  businessId: string = DEFAULT_BUSINESS_ID,
): Promise<ApiResult<ContactSavedView[]>> {
  return apiGet(
    `/crm/businesses/${encodeURIComponent(businessId)}/saved-views`,
    z.array(contactSavedViewSchema),
    [],
  );
}

export async function createSavedView(
  businessId: string,
  data: { name: string; filterState: Record<string, unknown>; sort?: ContactSavedViewSort | null; visibleColumns?: string[] | null },
): Promise<ApiResult<ContactSavedView>> {
  return apiPost<ContactSavedView>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/saved-views`,
    body: data,
  });
}

export async function updateSavedView(
  businessId: string,
  viewId: string,
  data: { name?: string; filterState?: Record<string, unknown>; sort?: ContactSavedViewSort | null; visibleColumns?: string[] | null },
): Promise<ApiResult<ContactSavedView>> {
  return apiPatch<ContactSavedView>(
    `/crm/businesses/${encodeURIComponent(businessId)}/saved-views/${encodeURIComponent(viewId)}`,
    data,
  );
}

export async function deleteSavedView(
  businessId: string,
  viewId: string,
): Promise<ApiResult<void>> {
  return apiDelete<void>(
    `/crm/businesses/${encodeURIComponent(businessId)}/saved-views/${encodeURIComponent(viewId)}`,
  );
}

export interface ContactListContactsResult {
  contacts: Contact[];
  total: number;
  truncated: boolean;
  limit: number;
}

const contactListContactsSchema = z.object({
  contacts: z.array(contactSchema),
  total: z.number(),
  truncated: z.boolean(),
  limit: z.number(),
}) as unknown as z.ZodSchema<ContactListContactsResult>;

export async function fetchContactListContacts(
  businessId: string,
  listId: string,
  options?: { limit?: number; offset?: number },
): Promise<ApiResult<ContactListContactsResult>> {
  const qs = new URLSearchParams();
  if (options?.limit !== undefined) qs.set('limit', String(options.limit));
  if (options?.offset !== undefined) qs.set('offset', String(options.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiGet(
    `/crm/businesses/${encodeURIComponent(businessId)}/lists/${encodeURIComponent(listId)}/contacts${suffix}`,
    contactListContactsSchema,
    { contacts: [], total: 0, truncated: false, limit: 1000 },
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
  return apiGet<{ guidelines: string[]; generatedAt: string | null }>(
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
  return apiGet<AiDataQualityResult>(
    `/crm/businesses/${encodeURIComponent(bid)}/ai-data-quality`,
  );
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
  return apiGet<AiDuplicatesResult>(
    `/crm/businesses/${encodeURIComponent(bid)}/ai-duplicates`,
  );
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
  return apiGet<AiReengagementResult>(
    `/crm/businesses/${encodeURIComponent(bid)}/ai-reengagement`,
  );
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
  return apiGet<AiRevenueOpportunitiesResult>(
    `/crm/businesses/${encodeURIComponent(bid)}/ai-revenue-opportunities`,
  );
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
  params: Record<string, unknown>;
  confirmation: string;
  confidence: number;
};

export type CommerceExecuteResult = {
  success: boolean;
  message?: string;
  error?: string;
  action?: string;
  params?: Record<string, unknown>;
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

export async function commerceAiInvoiceReminder(invoiceId: string, businessId?: string, tone?: string): Promise<ApiResult<CommerceInvoiceReminder>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<CommerceInvoiceReminder>({
    path: `/commerce/businesses/${encodeURIComponent(bid)}/invoices/${encodeURIComponent(invoiceId)}/ai-reminder`,
    body: tone ? { tone } : {},
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

export async function commerceAiExecute(action: string, params: Record<string, unknown> = {}, businessId?: string): Promise<ApiResult<CommerceExecuteResult>> {
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
      const message = (json as { message?: string } | null)?.message ?? res.statusText;
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
      const message = (json as { message?: string } | null)?.message ?? res.statusText;
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
  results: Array<Record<string, unknown>>;
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

export type CommerceCollectionsScore = {
  scores: Array<{
    invoiceId: string;
    invoiceNumber: string;
    contactName: string;
    amount: number;
    daysOverdue: number;
    recoveryScore: number;
    recoveryLabel: string;
    optimalFollowUpDate?: string;
    recommendedChannel: string;
    recommendedTone: string;
    reasoning: string;
    nextAction: string;
  }>;
  summary: { totalOverdue: number; estimatedRecovery: number; highPriorityCount: number; averageRecoveryScore: number };
  strategy: string;
};

export type CommercePaymentPlan = {
  plans: Array<{
    name: string;
    installments: number;
    frequency: string;
    amounts: number[];
    totalAmount: number;
    startDate?: string;
    reasoning: string;
    riskLevel: string;
  }>;
  recommendation: string;
  customerProfile: { paymentReliability: string; averagePaymentDelay: number; totalRelationshipValue: number };
};

export type CommerceQuoteFollowUp = {
  quoteId: string;
  quoteNumber: string;
  closeProbability: number;
  closeProbabilityLabel: string;
  bestFollowUpTime?: string;
  followUpWindow: string;
  messagingApproach: {
    tone: string;
    keyPoints: string[];
    openingLine: string;
    closingLine: string;
  };
  competitiveFactors?: string[];
  objectionHandling?: Array<{ objection: string; response: string }>;
  dealAccelerators?: string[];
  reasoning: string;
};

export type CommerceChurnRisk = {
  alerts: Array<{
    contactId: string;
    contactName: string;
    riskLevel: string;
    riskScore: number;
    signals: string[];
    lastPaymentDate: string | null;
    monthlyRevenue: number;
    recommendedAction: string;
    urgency: string;
  }>;
  summary: { totalAtRisk: number; revenueAtRisk: number; criticalCount: number; highCount: number };
  retentionStrategies: string[];
};

export type CommerceRevenueJourney = {
  funnel: {
    totalContacts: number;
    contactsWithQuotes: number;
    quotesToInvoices: number;
    invoicesToPayments: number;
    contactToQuoteRate: number;
    quoteToInvoiceRate: number;
    invoiceToPaymentRate: number;
    overallConversionRate: number;
  };
  dropOffPoints: Array<{ stage: string; dropOffRate: number; estimatedLostRevenue: number; reason: string; improvement: string }>;
  topPaths: Array<{ path: string; count: number; avgValue: number; avgDuration: string }>;
  insights: string[];
  recommendations: Array<{ title: string; description: string; priority: string; estimatedImpact: string }>;
};

export async function commerceAiCollectionsScore(businessId?: string): Promise<ApiResult<CommerceCollectionsScore>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<CommerceCollectionsScore>({
    path: `/commerce/businesses/${encodeURIComponent(bid)}/ai-collections-score`,
    body: {},
  });
}

export async function commerceAiPaymentPlan(invoiceId: string, businessId?: string): Promise<ApiResult<CommercePaymentPlan>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<CommercePaymentPlan>({
    path: `/commerce/businesses/${encodeURIComponent(bid)}/invoices/${encodeURIComponent(invoiceId)}/ai-payment-plan`,
    body: {},
  });
}

export async function commerceAiQuoteFollowUp(quoteId: string, businessId?: string): Promise<ApiResult<CommerceQuoteFollowUp>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<CommerceQuoteFollowUp>({
    path: `/commerce/businesses/${encodeURIComponent(bid)}/quotes/${encodeURIComponent(quoteId)}/ai-follow-up`,
    body: {},
  });
}

export async function commerceAiChurnRisk(businessId?: string): Promise<ApiResult<CommerceChurnRisk>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<CommerceChurnRisk>({
    path: `/commerce/businesses/${encodeURIComponent(bid)}/ai-churn-risk`,
    body: {},
  });
}

export async function commerceAiRevenueJourney(businessId?: string): Promise<ApiResult<CommerceRevenueJourney>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<CommerceRevenueJourney>({
    path: `/commerce/businesses/${encodeURIComponent(bid)}/ai-revenue-journey`,
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

export type CrossModuleWorkflow = {
  key: string;
  name: string;
  description: string;
  category: string;
  triggerEvent: string;
  enabled: boolean;
  config: Record<string, string | number | boolean | null>;
  configSchema: { key: string; label: string; type: string; default: string | number | boolean | null }[];
  lastRunAt: string | null;
  runCount: number;
};

export async function fetchCrossModuleWorkflows(businessId?: string): Promise<ApiResult<CrossModuleWorkflow[]>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/flow/businesses/${encodeURIComponent(bid)}/cross-module-workflows`,
    z.array(z.object({
      key: z.string(),
      name: z.string(),
      description: z.string(),
      category: z.string(),
      triggerEvent: z.string(),
      enabled: z.boolean(),
      config: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
      configSchema: z.array(z.object({ key: z.string(), label: z.string(), type: z.string(), default: z.union([z.string(), z.number(), z.boolean(), z.null()]) })),
      lastRunAt: z.string().nullable(),
      runCount: z.number(),
    })),
    [],
  );
}

export async function updateCrossModuleWorkflow(input: {
  businessId?: string;
  workflowKey: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
}): Promise<ApiResult<unknown>> {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  try {
    const res = await fetch(`${API_BASE}/flow/businesses/${encodeURIComponent(businessId)}/cross-module-workflows/${encodeURIComponent(input.workflowKey)}`, {
      method: "PATCH",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: input.enabled, config: input.config }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) return { data: null, error: res.statusText };
    return { data: json, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : "Network error" };
  }
}

export interface ConciergeSetupStatus {
  products: boolean;
  businessHours: boolean;
  payments: boolean;
  storefront: boolean;
  contacts: boolean;
  profile: boolean;
  completedCount: number;
  totalSteps: number;
  percentage: number;
}

export interface ConciergeAction {
  id: string;
  label: string;
  type: 'confirm' | 'customize' | 'skip' | 'navigate';
  href?: string;

  data?: Record<string, unknown>;
}

export interface ConciergeMessage {
  role: 'assistant' | 'user';
  content: string;
  quickReplies?: string[];
  actions?: ConciergeAction[];
  setupStatus?: ConciergeSetupStatus;
}

export interface ConciergeState {
  setupStatus: ConciergeSetupStatus;
  dismissed: boolean;
  templateId?: string;
  onboardingComplete: boolean;
}

export interface IndustryTemplatePreview {
  id: string;
  label: string;
  products: Array<{
    name: string;
    price: number;
    currency: string;
    category: string;
    duration?: number;
    description?: string;
  }>;
  businessHours: Record<string, { open: string; close: string; closed: boolean }>;
  paymentRecommendations: string[];
  emailTemplate: { subject: string; body: string };
}

export interface NudgeItem {
  id: string;
  type: string;
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  snoozable: boolean;
}

export async function fetchConciergeState(businessId: string): Promise<ApiResult<ConciergeState>> {
  return apiGet<ConciergeState>(`/onboarding-concierge/businesses/${encodeURIComponent(businessId)}/state`);
}

export async function fetchConciergeWelcome(businessId: string): Promise<ApiResult<ConciergeMessage>> {
  return apiGet<ConciergeMessage>(`/onboarding-concierge/businesses/${encodeURIComponent(businessId)}/welcome`);
}

export async function fetchConciergeSetupStatus(businessId: string): Promise<ApiResult<ConciergeSetupStatus>> {
  return apiGet<ConciergeSetupStatus>(`/onboarding-concierge/businesses/${encodeURIComponent(businessId)}/status`);
}

export async function fetchConciergeTemplates(businessId: string): Promise<ApiResult<Array<{ id: string; label: string; keywords: string[] }>>> {
  return apiGet<Array<{ id: string; label: string; keywords: string[] }>>(`/onboarding-concierge/businesses/${encodeURIComponent(businessId)}/templates`);
}

export async function fetchConciergeTemplatePreview(businessId: string, templateId: string): Promise<ApiResult<IndustryTemplatePreview>> {
  return apiGet<IndustryTemplatePreview>(`/onboarding-concierge/businesses/${encodeURIComponent(businessId)}/templates/${encodeURIComponent(templateId)}`);
}

export async function sendConciergeChat(
  businessId: string,
  message: string,
  history?: Array<{ role: string; content: string }>,
): Promise<ApiResult<ConciergeMessage>> {
  return apiPost<ConciergeMessage>({
    path: `/onboarding-concierge/businesses/${encodeURIComponent(businessId)}/chat`,
    body: { message, history },
  });
}

export interface AutoConfigureResult {
  templateId: string;
  templateLabel: string;
  productsCreated?: number;
  productsSkipped?: boolean;
  businessHoursSet?: boolean;
  paymentMethodsSet?: boolean;
  storefrontEnabled?: boolean;
}

export interface DetectTypeResult {
  template: { id: string; label: string };
  confidence: string;
}

export interface SnoozeResult {
  snoozed: boolean;
  until: string;
}

export interface DismissResult {
  dismissed: boolean;
}

export interface ResumeResult {
  resumed: boolean;
}

export interface CompleteResult {
  complete: boolean;
}

export async function conciergeAutoConfigure(
  businessId: string,
  templateId: string,
  options?: {
    createProducts?: boolean;
    setBusinessHours?: boolean;
    setPaymentMethods?: boolean;
    configureStorefront?: boolean;
  },
): Promise<ApiResult<AutoConfigureResult>> {
  return apiPost<AutoConfigureResult>({
    path: `/onboarding-concierge/businesses/${encodeURIComponent(businessId)}/auto-configure`,
    body: { templateId, ...options },
  });
}

export async function conciergeDetectType(
  businessId: string,
  description: string,
): Promise<ApiResult<DetectTypeResult>> {
  return apiPost<DetectTypeResult>({
    path: `/onboarding-concierge/businesses/${encodeURIComponent(businessId)}/detect-type`,
    body: { description },
  });
}

export async function fetchConciergeNudges(businessId: string): Promise<ApiResult<NudgeItem[]>> {
  return apiGet<NudgeItem[]>(`/onboarding-concierge/businesses/${encodeURIComponent(businessId)}/nudges`);
}

export async function snoozeConciergeNudge(businessId: string, nudgeId: string, days?: number): Promise<ApiResult<SnoozeResult>> {
  return apiPost<SnoozeResult>({
    path: `/onboarding-concierge/businesses/${encodeURIComponent(businessId)}/nudges/${encodeURIComponent(nudgeId)}/snooze`,
    body: { days },
  });
}

export async function dismissConcierge(businessId: string): Promise<ApiResult<DismissResult>> {
  return apiPost<DismissResult>({
    path: `/onboarding-concierge/businesses/${encodeURIComponent(businessId)}/dismiss`,
    body: {},
  });
}

export async function resumeConcierge(businessId: string): Promise<ApiResult<ResumeResult>> {
  return apiPost<ResumeResult>({
    path: `/onboarding-concierge/businesses/${encodeURIComponent(businessId)}/resume`,
    body: {},
  });
}

export async function markConciergeComplete(businessId: string): Promise<ApiResult<CompleteResult>> {
  return apiPost<CompleteResult>({
    path: `/onboarding-concierge/businesses/${encodeURIComponent(businessId)}/complete`,
    body: {},
  });
}

export interface FinancialAlert {
  id: string;
  type: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  title: string;
  message: string;
  amount?: number;
  percentChange?: number;
  action?: string;
  createdAt: string;
}

export interface FinancialPulse {
  cashPosition: number;
  weeklyRevenue: number;
  lastWeekRevenue: number;
  weeklyRevenueChange: number;
  monthlyRevenue: number;
  monthlyExpenses: number;
  netIncome: number;
  outstandingReceivables: number;
  overdueReceivables: number;
  overdueCount: number;
  alerts: FinancialAlert[];
  topUnpaidInvoices: Array<{
    id: string;
    invoiceNumber: string;
    total: number;
    daysOverdue: number;
    contactName: string;
    priority: 'high' | 'medium' | 'low';
  }>;
  cashFlowForecast: Array<{
    period: string;
    projected: number;
    label: string;
  }>;
}

export interface DetailedCashFlowForecast {
  currentBalance: number;
  projections: Array<{ days: number; label: string; projected: number; confidence: string }>;
  recurringRevenue: number;
  recurringExpenses: number;
  outstandingReceivables: number;
  avgPaymentDays: number;
  risks: string[];
  opportunities: string[];
  collectionPriority: Array<{ invoiceNumber: string; total: number; daysOverdue: number; contactName: string }>;
}

export interface WeeklyBriefingResponse {
  summary: string;
  lastWeekRevenue: number;
  lastWeekExpenses: number;
  lastWeekNet: number;
  outstandingReceivables: number;
  cashPosition: number;
  highlights: string[];
  concerns: string[];
  recommendation: string;
  outlook: string;
}

export async function fetchFinancialPulse(businessId?: string): Promise<ApiResult<FinancialPulse>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGetSimple<FinancialPulse>(`/commerce/businesses/${encodeURIComponent(bid)}/financial-pulse`);
}

export async function fetchFinancialAlerts(businessId?: string): Promise<ApiResult<{ alerts: FinancialAlert[] }>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGetSimple<{ alerts: FinancialAlert[] }>(`/commerce/businesses/${encodeURIComponent(bid)}/financial-alerts`);
}

export async function fetchDetailedCashFlowForecast(businessId?: string): Promise<ApiResult<DetailedCashFlowForecast>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGetSimple<DetailedCashFlowForecast>(`/commerce/businesses/${encodeURIComponent(bid)}/cash-flow-forecast`);
}

export async function generateWeeklyBriefing(businessId?: string): Promise<ApiResult<WeeklyBriefingResponse>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<WeeklyBriefingResponse>({ path: `/commerce/businesses/${encodeURIComponent(bid)}/weekly-briefing`, body: {} });
}

export async function submitPublicIntake(slug: string, input: {
  name: string;
  email: string;
  phone?: string;
  category: string;
  description: string;
  budget?: string;
  urgency?: string;
}): Promise<ApiResult<{ id: string; message: string }>> {
  try {
    const res = await fetch(`${API_BASE}/site/storefront/public/${encodeURIComponent(slug)}/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { data: null, error: data?.message || 'Failed to submit' };
    return { data, error: null };
  } catch {
    return { data: null, error: 'Network error' };
  }
}

export type ChannelConnection = {
  id: string;
  businessId: string;
  provider: string;
  label: string | null;
  accountEmail: string | null;
  expiresAt: string | null;
  scopes: string | null;

  providerMeta: Record<string, unknown> | null;
  healthState: string;
  healthMessage: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
  destinations?: ChannelDestination[];
  platform?: string;
  providerType?: string;
  displayName?: string;
  isActive?: boolean;
  healthStatus?: string;
  capabilities?: string[];
};

export type ChannelDestination = {
  id: string;
  connectionId: string;
  platform: string;
  platformId: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  capabilities: string[];
  isActive: boolean;

  destinationMeta: Record<string, unknown> | null;
  businessId: string;
  createdAt: string;
  updatedAt: string;
  connection?: ChannelConnection;
  destinationType?: string;
  externalId?: string;

  metadata?: Record<string, unknown>;
};

export type OutboundContent = {
  id: string;
  businessId: string;
  contentType: string;
  subject?: string;
  body: string;
  mediaUrls?: string[];
  objective?: string;
  audience?: string;
  tone?: string;
  tags?: string[];
  status: string;
  scheduledAt?: string;
  timezone?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
  variants?: OutboundVariant[];
  deliveries?: OutboundDelivery[];
};

export type OutboundVariant = {
  id: string;
  contentId: string;
  destinationId: string;
  platform: string;
  body: string;
  subject?: string;
  mediaUrls?: string[];

  metadata?: Record<string, unknown>;
};

export type OutboundDelivery = {
  id: string;
  contentId: string;
  variantId?: string;
  destinationId: string;
  status: string;
  scheduledAt?: string;
  publishedAt?: string;
  failReason?: string;
  retryCount: number;
};

export type DeliverySummaryDelivery = {
  id: string;
  destinationId: string;
  platform?: string;
  displayName?: string | null;
  status: string;
  sentAt?: string | null;
  externalPostId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  retryCount?: number;
};

export type DeliverySummary = {
  contentId: string;
  contentStatus?: string;
  timezone?: string | null;
  totalDestinations: number;
  published: number;
  failed: number;
  pending: number;
  cancelled: number;
  lastAttemptAt?: string | null;
  deliveries: DeliverySummaryDelivery[];
};

export async function listChannelConnections(businessId?: string): Promise<ApiResult<ChannelConnection[]>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGetSimple<ChannelConnection[]>(`/communications/businesses/${encodeURIComponent(bid)}/connections`);
}


export async function createChannelConnection(data: { provider: string; label?: string; accountEmail?: string; token?: string; refreshToken?: string; scopes?: string; providerMeta?: Record<string, unknown> }, businessId?: string): Promise<ApiResult<ChannelConnection>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<ChannelConnection>({ path: `/communications/businesses/${encodeURIComponent(bid)}/connections`, body: data });
}

export async function listChannelDestinations(businessId?: string, opts?: { platform?: string; activeOnly?: boolean }): Promise<ApiResult<ChannelDestination[]>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  const params = new URLSearchParams();
  if (opts?.platform) params.set("platform", opts.platform);
  if (opts?.activeOnly) params.set("activeOnly", "true");
  const qs = params.toString();
  return apiGetSimple<ChannelDestination[]>(`/communications/businesses/${encodeURIComponent(bid)}/destinations${qs ? `?${qs}` : ""}`);
}


export async function createOutboundContent(data: { contentType: string; subject?: string; body: string; mediaUrls?: string[]; objective?: string; audience?: string; tone?: string; tags?: string[]; segmentTags?: string[]; contentMeta?: Record<string, unknown> }, businessId?: string): Promise<ApiResult<OutboundContent>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;

  const payload: Record<string, unknown> = { ...data };
  if (data.segmentTags && data.segmentTags.length > 0) {
    payload.contentMeta = { ...(data.contentMeta ?? {}), segmentTags: data.segmentTags };
  }
  return apiPost<OutboundContent>({ path: `/communications/businesses/${encodeURIComponent(bid)}/content`, body: payload });
}

export async function updateOutboundContent(contentId: string, data: Partial<{ subject: string; body: string; mediaUrls: string[]; objective: string; audience: string; tone: string; tags: string[]; segmentTags: string[] }>, businessId?: string): Promise<ApiResult<OutboundContent>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPatch<OutboundContent>(`/communications/businesses/${encodeURIComponent(bid)}/content/${encodeURIComponent(contentId)}`, data);
}

export async function listOutboundContent(businessId?: string, opts?: { contentType?: string; status?: string; limit?: number }): Promise<ApiResult<OutboundContent[]>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  const params = new URLSearchParams();
  if (opts?.contentType) params.set("contentType", opts.contentType);
  if (opts?.status) params.set("status", opts.status);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return apiGetSimple<OutboundContent[]>(`/communications/businesses/${encodeURIComponent(bid)}/content${qs ? `?${qs}` : ""}`);
}

export async function getOutboundContent(contentId: string, businessId?: string): Promise<ApiResult<OutboundContent>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGetSimple<OutboundContent>(`/communications/businesses/${encodeURIComponent(bid)}/content/${encodeURIComponent(contentId)}`);
}

export async function deleteOutboundContent(contentId: string, businessId?: string): Promise<ApiResult<{ deleted: boolean }>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiDelete<{ deleted: boolean }>(`/communications/businesses/${encodeURIComponent(bid)}/content/${encodeURIComponent(contentId)}`);
}


export async function upsertOutboundVariant(contentId: string, data: { platform: string; textBody?: string; htmlBody?: string; mediaUrls?: string[]; variantMeta?: Record<string, unknown>; destinationId?: string }, businessId?: string): Promise<ApiResult<OutboundVariant>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<OutboundVariant>({ path: `/communications/businesses/${encodeURIComponent(bid)}/content/${encodeURIComponent(contentId)}/variants`, body: data });
}

export async function publishContentNow(contentId: string, destinationIds: string[], businessId?: string): Promise<ApiResult<{ deliveries: OutboundDelivery[] }>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<{ deliveries: OutboundDelivery[] }>({ path: `/communications/businesses/${encodeURIComponent(bid)}/content/${encodeURIComponent(contentId)}/publish`, body: { destinationIds } });
}

export async function scheduleContent(contentId: string, data: { destinationIds: string[]; scheduledAt: string; timezone?: string }, businessId?: string): Promise<ApiResult<{ deliveries: OutboundDelivery[] }>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<{ deliveries: OutboundDelivery[] }>({ path: `/communications/businesses/${encodeURIComponent(bid)}/content/${encodeURIComponent(contentId)}/schedule`, body: data });
}

export async function rescheduleDelivery(deliveryId: string, data: { scheduledAt: string; timezone?: string }, businessId?: string): Promise<ApiResult<OutboundDelivery>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPatch<OutboundDelivery>(`/communications/businesses/${encodeURIComponent(bid)}/deliveries/${encodeURIComponent(deliveryId)}/reschedule`, data);
}

export async function cancelDelivery(deliveryId: string, businessId?: string): Promise<ApiResult<OutboundDelivery>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<OutboundDelivery>({ path: `/communications/businesses/${encodeURIComponent(bid)}/deliveries/${encodeURIComponent(deliveryId)}/cancel`, body: {} });
}

export async function retryDelivery(deliveryId: string, businessId?: string): Promise<ApiResult<OutboundDelivery>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<OutboundDelivery>({ path: `/communications/businesses/${encodeURIComponent(bid)}/deliveries/${encodeURIComponent(deliveryId)}/retry`, body: {} });
}

export async function getDeliverySummary(contentId: string, businessId?: string): Promise<ApiResult<DeliverySummary>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGetSimple<DeliverySummary>(`/communications/businesses/${encodeURIComponent(bid)}/content/${encodeURIComponent(contentId)}/delivery-summary`);
}

export type HealthSummary = {
  total: number;
  healthy: number;
  needsAttention: number;
  expired: number;
  totalDestinations: number;
  activeDestinations: number;
  connections: {
    id: string;
    provider: string;
    label: string | null;
    healthState: string;
    healthMessage: string | null;
    lastCheckedAt: string | null;
    destinationCount: number;
    activeDestinationCount: number;
  }[];
};

export type HealthCheckResult = {
  id: string;
  healthState: string;
  healthMessage: string | null;
  lastCheckedAt: string;
  destinations: ChannelDestination[];
};

export async function getChannelHealthSummary(businessId?: string): Promise<ApiResult<HealthSummary>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGetSimple<HealthSummary>(`/communications/businesses/${encodeURIComponent(bid)}/connections/health-summary`);
}

export async function runChannelHealthCheck(connectionId: string, businessId?: string): Promise<ApiResult<HealthCheckResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<HealthCheckResult>({ path: `/communications/businesses/${encodeURIComponent(bid)}/connections/${encodeURIComponent(connectionId)}/health-check`, body: {} });
}

export async function toggleChannelDestination(destId: string, isActive: boolean, businessId?: string): Promise<ApiResult<ChannelDestination>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPatch<ChannelDestination>(`/communications/businesses/${encodeURIComponent(bid)}/destinations/${encodeURIComponent(destId)}/toggle`, { isActive });
}


export async function updateChannelConnection(connectionId: string, data: Record<string, unknown>, businessId?: string): Promise<ApiResult<ChannelConnection>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPatch<ChannelConnection>(`/communications/businesses/${encodeURIComponent(bid)}/connections/${encodeURIComponent(connectionId)}`, data);
}

export async function deleteChannelConnection(connectionId: string, businessId?: string): Promise<ApiResult<{ deleted: boolean }>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiDelete<{ deleted: boolean }>(`/communications/businesses/${encodeURIComponent(bid)}/connections/${encodeURIComponent(connectionId)}`);
}

export async function syncChannelConnectionsFromSocial(businessId?: string): Promise<ApiResult<{ synced: number; results: { provider: string; connectionId: string; destinations: number }[] }>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<{ synced: number; results: { provider: string; connectionId: string; destinations: number }[] }>({
    path: `/communications/businesses/${encodeURIComponent(bid)}/connections/sync-from-social`,
    body: {},
  });
}

export interface EmailValidationResult {
  valid: boolean;
  warnings: { field: string; message: string; severity: 'error' | 'warning' }[];
  audienceSummary: { totalMatching: number; suppressed: number; eligible: number };
  senderConfigured: boolean;
}

export interface AudienceExpandResult {
  contacts: { id: string; email: string; firstName: string | null; lastName: string | null; tags: string[]; ageGroup?: string | null }[];
  total: number;
  suppressed: number;
  availableTags: string[];
}

export interface AudienceHealthResult {
  totalContacts: number;
  withEmail: number;
  suppressed: number;
  optedIn: number;
  emailCoverage: number;
  deliverabilityRate: number;
  segments: { tag: string; count: number }[];
  ageGroups?: { ageGroup: string; count: number }[];
}

export async function validateEmailSend(data: { subject?: string; destinationIds?: string[]; segmentTags?: string[]; ageGroups?: string[] }, businessId?: string): Promise<ApiResult<EmailValidationResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<EmailValidationResult>({
    path: `/communications/businesses/${encodeURIComponent(bid)}/email/validate-send`,
    body: data,
  });
}

export async function expandAudience(data: { segmentTags?: string[]; ageGroups?: string[]; limit?: number; channel?: string }, businessId?: string): Promise<ApiResult<AudienceExpandResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<AudienceExpandResult>({
    path: `/communications/businesses/${encodeURIComponent(bid)}/audience/expand`,
    body: data,
  });
}

export async function getAudienceHealth(businessId?: string): Promise<ApiResult<AudienceHealthResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet<AudienceHealthResult>(`/communications/businesses/${encodeURIComponent(bid)}/audience/health`);
}

// --- Content AI ---

export interface AiDraftResult {
  body: string;
  subject: string | null;
  hashtags: string[];
  cta: string;
}

export interface AiRewriteResult {
  body: string;
  subject: string | null;
  hashtags: string[];
}

export interface AiSubjectsResult {
  subjects: string[];
}

export interface AiCtaResult {
  ctas: { text: string; style: string }[];
}

export interface AiHashtagsResult {
  hashtags: string[];
  groups: Record<string, string[]>;
}

export interface AiShortenExpandResult {
  body: string;
}

export interface AiChannelsResult {
  recommended: { channel: string; reason: string; priority: string }[];
}

export interface AiSendTimeResult {
  suggestions: { day: string; time: string; reason: string; score: number }[];
  bestWindow: string;
}

export interface AiPreviewTextResult {
  previews: { text: string; approach: string; charCount: number }[];
}

export interface AiAudienceSegmentsResult {
  segments: { name: string; description: string; reason: string; expectedImpact: string; estimatedReach: string }[];
  primarySegment: string;
}

export interface AiContentIdeasResult {
  ideas: { title: string; brief: string; contentType: string; category: string; effort: string; dataSource?: string }[];
}

export async function aiGenerateDraft(data: { contentType: string; objective?: string; tone?: string; audience?: string; topic?: string; existingBody?: string }, businessId?: string): Promise<ApiResult<AiDraftResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<AiDraftResult>({ path: `/communications/businesses/${encodeURIComponent(bid)}/content-ai/generate-draft`, body: data });
}

export async function aiRewriteContent(data: { body: string; targetChannel: string; tone?: string; objective?: string }, businessId?: string): Promise<ApiResult<AiRewriteResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<AiRewriteResult>({ path: `/communications/businesses/${encodeURIComponent(bid)}/content-ai/rewrite`, body: data });
}

export async function aiSuggestSubjects(data: { body: string; objective?: string; tone?: string; audience?: string }, businessId?: string): Promise<ApiResult<AiSubjectsResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<AiSubjectsResult>({ path: `/communications/businesses/${encodeURIComponent(bid)}/content-ai/suggest-subjects`, body: data });
}

export async function aiSuggestCta(data: { body: string; objective?: string; contentType?: string }, businessId?: string): Promise<ApiResult<AiCtaResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<AiCtaResult>({ path: `/communications/businesses/${encodeURIComponent(bid)}/content-ai/suggest-cta`, body: data });
}

export async function aiSuggestHashtags(data: { body: string; industry?: string }, businessId?: string): Promise<ApiResult<AiHashtagsResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<AiHashtagsResult>({ path: `/communications/businesses/${encodeURIComponent(bid)}/content-ai/suggest-hashtags`, body: data });
}

export async function aiShortenExpand(data: { body: string; action: "shorten" | "expand"; targetChannel?: string }, businessId?: string): Promise<ApiResult<AiShortenExpandResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<AiShortenExpandResult>({ path: `/communications/businesses/${encodeURIComponent(bid)}/content-ai/shorten-expand`, body: data });
}

export async function aiSuggestChannels(data: { body: string; objective?: string; audience?: string; availableChannels: string[] }, businessId?: string): Promise<ApiResult<AiChannelsResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<AiChannelsResult>({ path: `/communications/businesses/${encodeURIComponent(bid)}/content-ai/suggest-channels`, body: data });
}

export async function aiSuggestSendTime(data: { contentType: string; audience?: string; timezone?: string }, businessId?: string): Promise<ApiResult<AiSendTimeResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<AiSendTimeResult>({ path: `/communications/businesses/${encodeURIComponent(bid)}/content-ai/suggest-time`, body: data });
}

export async function aiSuggestPreviewText(data: { subject: string; body: string; objective?: string }, businessId?: string): Promise<ApiResult<AiPreviewTextResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<AiPreviewTextResult>({ path: `/communications/businesses/${encodeURIComponent(bid)}/content-ai/suggest-preview-text`, body: data });
}

export async function aiSuggestAudienceSegments(data: { body: string; contentType?: string; objective?: string; existingSegments?: string[] }, businessId?: string): Promise<ApiResult<AiAudienceSegmentsResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<AiAudienceSegmentsResult>({ path: `/communications/businesses/${encodeURIComponent(bid)}/content-ai/suggest-audience-segments`, body: data });
}

export async function aiSuggestContentIdeas(data: { objective?: string; audience?: string; recentTopics?: string[]; contentType?: string }, businessId?: string): Promise<ApiResult<AiContentIdeasResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<AiContentIdeasResult>({ path: `/communications/businesses/${encodeURIComponent(bid)}/content-ai/suggest-content-ideas`, body: data });
}

// --- Delivery Log ---

export interface DeliveryListItem {
  id: string;
  contentId: string;
  destinationId: string;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  externalPostId: string | null;
  externalUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryCount: number;
  recipientEmail: string | null;
  recipientPhone: string | null;
  contactId: string | null;
  createdAt: string;
  updatedAt: string;
  destination: { platform: string; displayName: string | null; label: string | null } | null;
  content: { id: string; subject: string | null; contentType: string; status: string } | null;
}

export interface DeliveryListResult {
  deliveries: DeliveryListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface DeliveryEventItem {
  id: string;
  deliveryId: string;
  eventType: string;
  statusBefore: string;
  statusAfter: string;
  attemptNumber: number | null;
  errorCode: string | null;
  errorMessage: string | null;

  resultData: Record<string, unknown> | null;
  createdAt: string;
}

export async function listDeliveries(businessId?: string, opts?: { status?: string; channel?: string; contentId?: string; contentType?: string; dateFrom?: string; dateTo?: string; limit?: number; offset?: number }): Promise<ApiResult<DeliveryListResult>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  const params = new URLSearchParams();
  if (opts?.status) params.set("status", opts.status);
  if (opts?.channel) params.set("channel", opts.channel);
  if (opts?.contentId) params.set("contentId", opts.contentId);
  if (opts?.contentType) params.set("contentType", opts.contentType);
  if (opts?.dateFrom) params.set("dateFrom", opts.dateFrom);
  if (opts?.dateTo) params.set("dateTo", opts.dateTo);
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));
  const qs = params.toString();
  return apiGetSimple<DeliveryListResult>(`/communications/businesses/${encodeURIComponent(bid)}/deliveries${qs ? `?${qs}` : ""}`);
}

export async function getDeliveryEvents(deliveryId: string, businessId?: string): Promise<ApiResult<DeliveryEventItem[]>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGetSimple<DeliveryEventItem[]>(`/communications/businesses/${encodeURIComponent(bid)}/deliveries/${encodeURIComponent(deliveryId)}/events`);
}

export async function retryAllFailedDeliveries(contentId: string, businessId?: string): Promise<ApiResult<{ retried: number }>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<{ retried: number }>({ path: `/communications/businesses/${encodeURIComponent(bid)}/content/${encodeURIComponent(contentId)}/retry-all`, body: {} });
}

export interface QualificationFlowConfig {
  enabled: boolean;
  title?: string;
  subtitle?: string;
  showBudgetQuestion?: boolean;
  showUrgencyQuestion?: boolean;
  showExecutionPreference?: boolean;
  questions?: QualificationQuestion[];
  packageMappings?: { productId: string; answerWeights: Record<string, Record<string, number>> }[];
  intakeChecklist?: { id: string; label: string; type: 'text' | 'file' | 'color' | 'textarea'; required?: boolean }[];
}

export interface QualificationQuestion {
  id: string;
  label: string;
  type: 'single' | 'multi';
  options: { value: string; label: string; tags?: string[] }[];
}

export interface QualificationRecommendation {
  productId: string;
  productName: string;
  score: number;
  executionModel?: string;
  price: number;
  currency: string;
  matchReasons: string[];
}

export interface QualificationJourneyAnalytics {
  total: number;
  statusCounts: Record<string, number>;
  conversionFunnel: {
    started: number;
    recommended: number;
    packageSelected: number;
    intakeCompleted: number;
    converted: number;
  };
  completionRate: number;
  recentJourneys: {
    id: string;
    status: string;
    customerName?: string;
    customerEmail?: string;
    selectedProductId?: string;
    executionModelChosen?: string;
    intakeCompleted: boolean;
    source: string;
    createdAt: string;
    recommendedProductIds: string[];
  }[];
}

export async function fetchQualificationConfig(businessId: string): Promise<ApiResult<QualificationFlowConfig | null>> {
  return apiGetSimple<QualificationFlowConfig | null>(`/site/businesses/${encodeURIComponent(businessId)}/qualification-config`);
}

export async function updateQualificationConfig(businessId: string, config: QualificationFlowConfig): Promise<ApiResult<QualificationFlowConfig>> {
  const res = await fetch(`${API_BASE}/site/businesses/${encodeURIComponent(businessId)}/qualification-config`, {
    method: 'PUT',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return { data: null, error: data?.message || 'Failed to update' };
  return { data, error: null };
}

export async function fetchQualificationAnalytics(businessId: string): Promise<ApiResult<QualificationJourneyAnalytics>> {
  return apiGetSimple<QualificationJourneyAnalytics>(`/site/businesses/${encodeURIComponent(businessId)}/qualification-analytics`);
}

export async function quoteFromConversation(businessId: string, conversationText: string): Promise<ApiResult<unknown>> {
  return apiPost<unknown>({ path: `/commerce/businesses/${encodeURIComponent(businessId)}/ai-quote-from-conversation`, body: { conversationText } });
}

export { DEFAULT_BUSINESS_ID };

// ================================================================
// KEYFLOW COMMAND
// ================================================================

export type KeyflowEventKind =
  | 'booking'
  | 'contact_task'
  | 'project_task'
  | 'autopilot_task'
  | 'project_deadline'
  | 'google_event';

export interface KeyflowEvent {
  id: string;
  kind: KeyflowEventKind;
  title: string;
  description?: string;
  start: string;
  end: string;
  allDay: boolean;
  status?: string;
  priority?: string;
  href?: string;
  refType?: string;
  refId?: string;
  meta?: Record<string, unknown>;
  color?: string;
  source?: string;
}

export interface KeyflowNote {
  id: string;
  businessId: string;
  targetType: string;
  targetId: string;
  targetLabel?: string | null;
  body: string;
  aiBrief?: string | null;
  authorId?: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function fetchKeyflowEvents(
  businessId: string,
  opts?: { timeMin?: string; timeMax?: string; signal?: AbortSignal },
): Promise<ApiResult<{ events: KeyflowEvent[]; range: { timeMin: string; timeMax: string } }>> {
  const params = new URLSearchParams();
  if (opts?.timeMin) params.set('timeMin', opts.timeMin);
  if (opts?.timeMax) params.set('timeMax', opts.timeMax);
  const qs = params.toString();
  const path = `/keyflow/businesses/${encodeURIComponent(businessId)}/events${qs ? `?${qs}` : ''}`;
  const url = `${API_BASE}${path}`;
  try {
    const res = await fetch(url, { headers: getAuthHeaders(), cache: 'no-store', signal: opts?.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { data: null, error: data?.message || 'Failed to load events' };
    return { data, error: null };
  } catch (err) {
    return { data: null, error: (err as Error).message };
  }
}

export async function fetchKeyflowNotes(
  businessId: string,
  targetType?: string,
  targetId?: string,
): Promise<ApiResult<{ items: KeyflowNote[] }>> {
  const params = new URLSearchParams();
  if (targetType) params.set('targetType', targetType);
  if (targetId) params.set('targetId', targetId);
  const qs = params.toString();
  return apiGetSimple<{ items: KeyflowNote[] }>(
    `/keyflow/businesses/${encodeURIComponent(businessId)}/notes${qs ? `?${qs}` : ''}`,
  );
}

export async function createKeyflowNote(
  businessId: string,
  payload: { targetType: string; targetId: string; targetLabel?: string | null; body?: string; pinned?: boolean },
): Promise<ApiResult<KeyflowNote>> {
  return apiPost<KeyflowNote>({
    path: `/keyflow/businesses/${encodeURIComponent(businessId)}/notes`,
    body: payload,
  });
}

export async function updateKeyflowNote(
  businessId: string,
  noteId: string,
  patch: { body?: string; pinned?: boolean; targetLabel?: string | null },
): Promise<ApiResult<KeyflowNote>> {
  return apiPut<KeyflowNote>(
    `/keyflow/businesses/${encodeURIComponent(businessId)}/notes/${encodeURIComponent(noteId)}`,
    patch,
  );
}

export async function deleteKeyflowNote(
  businessId: string,
  noteId: string,
): Promise<ApiResult<{ success: boolean }>> {
  return apiDelete<{ success: boolean }>(
    `/keyflow/businesses/${encodeURIComponent(businessId)}/notes/${encodeURIComponent(noteId)}`,
  );
}

export async function generateKeyflowNoteBrief(
  businessId: string,
  noteId: string,
): Promise<ApiResult<KeyflowNote>> {
  return apiPostSimple<KeyflowNote>(
    `/keyflow/businesses/${encodeURIComponent(businessId)}/notes/${encodeURIComponent(noteId)}/brief`,
    {},
  );
}

export async function synthesizeKeyflowSpeech(
  businessId: string,
  text: string,
  voice: string = 'alloy',
): Promise<{ blob: Blob | null; error: string | null }> {
  try {
    const res = await fetch(
      `${API_BASE}/keyflow/businesses/${encodeURIComponent(businessId)}/voice/tts`,
      {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice, format: 'mp3' }),
      },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      return { blob: null, error: err?.message || 'TTS failed' };
    }
    const blob = await res.blob();
    return { blob, error: null };
  } catch (err) {
    return { blob: null, error: (err as Error).message };
  }
}

export async function transcribeKeyflowSpeech(
  businessId: string,
  audio: Blob,
  filename: string = 'utterance.webm',
): Promise<ApiResult<{ text: string }>> {
  try {
    const fd = new FormData();
    fd.append('audio', audio, filename);
    const res = await fetch(
      `${API_BASE}/keyflow/businesses/${encodeURIComponent(businessId)}/voice/transcribe`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: fd,
      },
    );
    const data = await res.json().catch(() => null);
    if (!res.ok) return { data: null, error: data?.message || 'STT failed' };
    return { data, error: null };
  } catch (err) {
    return { data: null, error: (err as Error).message };
  }
}

// ============================================
// COMMUNITY PHASE 5: NETWORK ACTIVITY & GROWTH
// ============================================

export type OpportunityType = 'JOB' | 'PROJECT' | 'COLLABORATION' | 'CONTRACT' | 'GIG';
export type OpportunityStatus = 'OPEN' | 'CLOSED' | 'AWARDED' | 'ARCHIVED';

export type Opportunity = {
  id: string;
  posterBusinessId: string;
  type: OpportunityType;
  title: string;
  description: string;
  category?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  currency: string;
  timeline?: string | null;
  location?: string | null;
  remoteOk: boolean;
  skillsRequired: string[];
  attachments: string[];
  status: OpportunityStatus;
  awardedToBusinessId?: string | null;
  closedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
  poster?: { id: string; name: string; logoUrl?: string | null; headline?: string | null; industry?: string | null; slug?: string | null };
  _count?: { applications: number };
};

export type OpportunityApplicationStatus = 'SUBMITTED' | 'SHORTLISTED' | 'AWARDED' | 'DECLINED' | 'WITHDRAWN';

export type OpportunityApplication = {
  id: string;
  opportunityId: string;
  applicantBusinessId: string;
  message: string;
  proposedBudget?: number | null;
  proposedTimeline?: string | null;
  attachments: string[];
  status: OpportunityApplicationStatus;
  responseNote?: string | null;
  respondedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  applicant?: { id: string; name: string; logoUrl?: string | null; headline?: string | null; industry?: string | null; slug?: string | null };
  opportunity?: Opportunity;
};

export async function listOpportunities(params: { type?: string; status?: string; category?: string; search?: string; page?: number; limit?: number } = {}) {
  const q = new URLSearchParams();
  if (params.type) q.set('type', params.type);
  if (params.status) q.set('status', params.status);
  if (params.category) q.set('category', params.category);
  if (params.search) q.set('search', params.search);
  if (params.page) q.set('page', String(params.page));
  if (params.limit) q.set('limit', String(params.limit));
  const qs = q.toString();
  return apiGetSimple<{ data: Opportunity[]; total: number; page: number; limit: number }>(`/community/opportunities${qs ? `?${qs}` : ''}`);
}
export async function getOpportunity(id: string) {
  return apiGetSimple<Opportunity & { applications: OpportunityApplication[] }>(`/community/opportunities/${encodeURIComponent(id)}`);
}
export async function createOpportunity(businessId: string, body: Partial<Opportunity>) {
  return apiPost<Opportunity>({ path: `/businesses/${encodeURIComponent(businessId)}/community/opportunities`, body });
}
export async function listMyOpportunities(businessId: string) {
  return apiGetSimple<Opportunity[]>(`/businesses/${encodeURIComponent(businessId)}/community/opportunities/mine`);
}
export async function updateOpportunity(businessId: string, id: string, body: Partial<Opportunity>) {
  return apiPatch<Opportunity>(`/businesses/${encodeURIComponent(businessId)}/community/opportunities/${encodeURIComponent(id)}`, body);
}
export async function closeOpportunity(businessId: string, id: string) {
  return apiPost<Opportunity>({ path: `/businesses/${encodeURIComponent(businessId)}/community/opportunities/${encodeURIComponent(id)}/close`, body: {} });
}
export async function deleteOpportunity(businessId: string, id: string) {
  return apiDelete<void>(`/businesses/${encodeURIComponent(businessId)}/community/opportunities/${encodeURIComponent(id)}`);
}
export async function applyToOpportunity(
  businessId: string,
  id: string,
  body: { message: string; proposedBudget?: number; proposedTimeline?: string; attachments?: string[] },
) {
  return apiPost<OpportunityApplication>({ path: `/businesses/${encodeURIComponent(businessId)}/community/opportunities/${encodeURIComponent(id)}/apply`, body });
}
export async function listMyOpportunityApplications(businessId: string) {
  return apiGetSimple<OpportunityApplication[]>(`/businesses/${encodeURIComponent(businessId)}/community/opportunity-applications/mine`);
}
export async function respondToOpportunityApplication(
  businessId: string,
  applicationId: string,
  body: { status: 'SHORTLISTED' | 'AWARDED' | 'DECLINED'; responseNote?: string },
) {
  return apiPatch<OpportunityApplication>(`/businesses/${encodeURIComponent(businessId)}/community/opportunity-applications/${encodeURIComponent(applicationId)}/respond`, body);
}
export async function withdrawOpportunityApplication(businessId: string, applicationId: string) {
  return apiPost<OpportunityApplication>({ path: `/businesses/${encodeURIComponent(businessId)}/community/opportunity-applications/${encodeURIComponent(applicationId)}/withdraw`, body: {} });
}

// ----- Partner Programs -----
export type PartnerProgramType = 'REFERRAL' | 'RESELLER' | 'AFFILIATE' | 'JOINT_VENTURE' | 'STRATEGIC' | 'INTEGRATION';
export type PartnerProgramStatus = 'PROPOSED' | 'ACTIVE' | 'PAUSED' | 'ENDED' | 'DECLINED';
export type PartnerProgramVisibility = 'PUBLIC' | 'PRIVATE';

export type PartnerProgram = {
  id: string;
  initiatorBusinessId: string;
  partnerBusinessId: string;
  programType: PartnerProgramType;
  name: string;
  description: string;
  commissionRate?: number | null;
  terms?: unknown;
  startDate?: string | null;
  endDate?: string | null;
  status: PartnerProgramStatus;
  visibility: PartnerProgramVisibility;
  responseNote?: string | null;
  acceptedAt?: string | null;
  endedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  initiator?: { id: string; name: string; logoUrl?: string | null; headline?: string | null; slug?: string | null };
  partner?: { id: string; name: string; logoUrl?: string | null; headline?: string | null; slug?: string | null };
};

export async function proposePartnerProgram(businessId: string, body: Partial<PartnerProgram> & { partnerBusinessId: string }) {
  return apiPost<PartnerProgram>({ path: `/businesses/${encodeURIComponent(businessId)}/community/partner-programs`, body });
}
export async function listPartnerPrograms(businessId: string, status?: string) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiGetSimple<PartnerProgram[]>(`/businesses/${encodeURIComponent(businessId)}/community/partner-programs${qs}`);
}
export async function listPublicPartnerProgramsForProfile(businessId: string) {
  return apiGetSimple<PartnerProgram[]>(`/community/partner-programs/profile/${encodeURIComponent(businessId)}`);
}
export async function getPartnerProgram(id: string) {
  return apiGetSimple<PartnerProgram>(`/community/partner-programs/${encodeURIComponent(id)}`);
}
export async function respondToPartnerProgram(
  businessId: string,
  id: string,
  body: { status: 'ACTIVE' | 'DECLINED'; responseNote?: string },
) {
  return apiPatch<PartnerProgram>(`/businesses/${encodeURIComponent(businessId)}/community/partner-programs/${encodeURIComponent(id)}/respond`, body);
}
export async function terminatePartnerProgram(businessId: string, id: string, note?: string) {
  return apiPost<PartnerProgram>({ path: `/businesses/${encodeURIComponent(businessId)}/community/partner-programs/${encodeURIComponent(id)}/terminate`, body: { note } });
}

// ----- Resource Marketplace -----
export type ResourceType = 'TEMPLATE' | 'PROMPT_LIBRARY' | 'PROCESS_DOC' | 'EDU_CONTENT' | 'CANVA_KIT' | 'OTHER';

export type ResourceListing = {
  id: string;
  businessId: string;
  name: string;
  description?: string | null;
  price: number;
  currency: string;
  imageUrl?: string | null;
  resourceType: ResourceType;
  downloadUrl: string;
  previewUrl?: string | null;
  licenseTerms?: string | null;
  isFree: boolean;
  fileSize?: number | null;
  isActive: boolean;
  createdAt: string;
  business?: { id: string; name: string; logoUrl?: string | null; headline?: string | null; slug?: string | null };
  _count?: { resourceDownloads: number };
};

export async function listResources(params: { resourceType?: string; search?: string; isFree?: boolean; businessId?: string; page?: number; limit?: number } = {}) {
  const q = new URLSearchParams();
  if (params.resourceType) q.set('resourceType', params.resourceType);
  if (params.search) q.set('search', params.search);
  if (typeof params.isFree === 'boolean') q.set('isFree', String(params.isFree));
  if (params.businessId) q.set('businessId', params.businessId);
  if (params.page) q.set('page', String(params.page));
  if (params.limit) q.set('limit', String(params.limit));
  const qs = q.toString();
  return apiGetSimple<{ data: ResourceListing[]; total: number; page: number; limit: number }>(`/community/resources${qs ? `?${qs}` : ''}`);
}
export async function getResource(id: string) {
  return apiGetSimple<ResourceListing>(`/community/resources/${encodeURIComponent(id)}`);
}
export async function publishResource(businessId: string, body: Partial<ResourceListing> & { name: string; price: number; resourceType: ResourceType; downloadUrl: string }) {
  return apiPost<ResourceListing>({ path: `/businesses/${encodeURIComponent(businessId)}/community/resources`, body });
}
export async function listMyResources(businessId: string) {
  return apiGetSimple<ResourceListing[]>(`/businesses/${encodeURIComponent(businessId)}/community/resources/mine`);
}
export async function recordResourceDownload(businessId: string, id: string, source?: string) {
  return apiPost<{ download: unknown; downloadUrl: string; licenseTerms?: string | null }>({
    path: `/businesses/${encodeURIComponent(businessId)}/community/resources/${encodeURIComponent(id)}/download`,
    body: { source },
  });
}
export async function listMyResourceDownloads(businessId: string) {
  return apiGetSimple<Array<{ id: string; productId: string; pricePaid: number; currency: string; createdAt: string; product: ResourceListing }>>(`/businesses/${encodeURIComponent(businessId)}/community/resource-downloads/mine`);
}

// ----- Network Activity Feed -----
export type NetworkActivityType =
  | 'OPPORTUNITY_POSTED' | 'OPPORTUNITY_AWARDED'
  | 'PARTNERSHIP_FORMED' | 'PARTNERSHIP_TERMINATED'
  | 'RESOURCE_PUBLISHED' | 'COHORT_JOINED' | 'REVIEW_RECEIVED'
  | 'COLLAB_COMPLETED' | 'CERTIFICATION_EARNED' | 'MILESTONE_REACHED';

export type NetworkActivityItem = {
  id: string;
  actorBusinessId: string;
  type: NetworkActivityType;
  refType?: string | null;
  refId?: string | null;
  title: string;
  body?: string | null;
  metadata?: Record<string, unknown> | null;
  isPublic: boolean;
  createdAt: string;
  actor?: { id: string; name: string; logoUrl?: string | null; headline?: string | null; industry?: string | null; slug?: string | null };
};

export async function listNetworkActivity(params: { types?: string[]; actorBusinessId?: string; page?: number; limit?: number } = {}) {
  const q = new URLSearchParams();
  if (params.types?.length) q.set('types', params.types.join(','));
  if (params.actorBusinessId) q.set('actorBusinessId', params.actorBusinessId);
  if (params.page) q.set('page', String(params.page));
  if (params.limit) q.set('limit', String(params.limit));
  const qs = q.toString();
  return apiGetSimple<{ data: NetworkActivityItem[]; total: number; page: number; limit: number }>(`/community/activity${qs ? `?${qs}` : ''}`);
}
export async function listFollowingActivity(businessId: string, params: { page?: number; limit?: number } = {}) {
  const q = new URLSearchParams();
  if (params.page) q.set('page', String(params.page));
  if (params.limit) q.set('limit', String(params.limit));
  const qs = q.toString();
  return apiGetSimple<{ data: NetworkActivityItem[]; total: number; page: number; limit: number }>(`/businesses/${encodeURIComponent(businessId)}/community/activity/following${qs ? `?${qs}` : ''}`);
}
export async function listActivityForBusiness(businessId: string) {
  return apiGetSimple<NetworkActivityItem[]>(`/community/activity/business/${encodeURIComponent(businessId)}`);
}

// ----- Network Analytics -----
export type AnalyticsDashboard = {
  windowDays: number;
  profileViews: {
    total: number;
    window: number;
    previous: number;
    deltaPct: number;
    uniqueViewers: number;
    trend: { date: string; views: number }[];
    topViewers: { business: { id: string; name: string; logoUrl?: string | null; headline?: string | null; slug?: string | null } | null; viewCount: number }[];
  };
  quoteRequests: { sent: number; received: number };
  referrals: { sent: number; received: number };
  partnerships: { active: number };
  network: { followers: number; following: number };
  opportunities: { posted: number; applicationsSent: number };
  resources: { downloadsReceived: number; downloadsMade: number };
  reviews: { receivedInWindow: number };
  activity: { eventsInWindow: number };
  reputation: {
    score: number;
    averageRating: number;
    totalReviews: number;
    totalCompleted: number;
    rank: number | null;
    totalRanked: number | null;
    percentile: number | null;
  } | null;
};

export async function recordProfileView(viewedBusinessId: string, body: { viewerBusinessId?: string | null; source?: string } = {}) {
  return apiPost<{ id: string } | null>({ path: `/community/profile-views/${encodeURIComponent(viewedBusinessId)}`, body });
}
export async function getNetworkAnalyticsDashboard(businessId: string, days = 30) {
  return apiGetSimple<AnalyticsDashboard>(`/businesses/${encodeURIComponent(businessId)}/community/analytics/dashboard?days=${days}`);
}
export async function listRecentProfileViewers(businessId: string, limit = 20) {
  return apiGetSimple<Array<{ id: string; createdAt: string; source?: string | null; viewer: { id: string; name: string; logoUrl?: string | null; headline?: string | null; slug?: string | null } }>>(`/businesses/${encodeURIComponent(businessId)}/community/analytics/recent-viewers?limit=${limit}`);
}

// ---------------------------------------------------------------------------
// Accounting + email-marketing operability surfaces (Task 348)
// ---------------------------------------------------------------------------

export type AccountingProvider = 'quickbooks' | 'xero';
export type AccountingSummary = {
  connected: boolean;
  provider: AccountingProvider | null;
  connectedAccount: string | null;
  lastSyncAt: string | null;
  invoicesTotal: number;
  invoicesSynced: number;
  invoicesUnsynced: number;
  customersTotal: number;
  customersSynced: number;
  customersUnsynced: number;
};

export type UnsyncedInvoiceRow = {
  id: string;
  invoiceNumber: string;
  status: string;
  total: number;
  currency: string;
  issueDate: string;
  dueDate: string | null;
  externalAccountingSource: string | null;
  externalAccountingId: string | null;
  contact: { id: string; firstName: string | null; lastName: string | null; displayName: string | null; companyName: string | null; email: string | null } | null;
};

export type ChartOfAccountsAccount = { id: string; name: string; type: string; subType?: string; classification?: string };
export type AccountingPushResult = {
  provider: AccountingProvider;
  total: number;
  succeeded: number;
  failed: number;
  results: Array<{ invoiceId?: string; contactId?: string; success: boolean; externalId?: string; error?: string }>;
};

export async function fetchAccountingSummary(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGetSimple<AccountingSummary>(`/accounting/businesses/${encodeURIComponent(businessId)}/summary`);
}

export async function fetchUnsyncedInvoices(businessId: string = DEFAULT_BUSINESS_ID, limit = 100) {
  return apiGetSimple<{ invoices: UnsyncedInvoiceRow[] }>(`/accounting/businesses/${encodeURIComponent(businessId)}/invoices/unsynced?limit=${limit}`);
}

export async function pushInvoicesToAccounting(invoiceIds: string[], businessId: string = DEFAULT_BUSINESS_ID) {
  return apiPostSimple<AccountingPushResult>(`/accounting/businesses/${encodeURIComponent(businessId)}/invoices/push`, { invoiceIds });
}

export async function pushCustomersToAccounting(businessId: string = DEFAULT_BUSINESS_ID, contactIds?: string[]) {
  return apiPostSimple<AccountingPushResult>(`/accounting/businesses/${encodeURIComponent(businessId)}/customers/push`, { contactIds });
}

export async function fetchChartOfAccounts(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGetSimple<{ provider: AccountingProvider; accounts: ChartOfAccountsAccount[] }>(`/accounting/businesses/${encodeURIComponent(businessId)}/chart-of-accounts`);
}

export type MarketingProvider = 'mailchimp' | 'klaviyo';
export type MarketingList = { id: string; name: string; memberCount: number; provider: MarketingProvider };
export type MarketingListsResponse = {
  connected: boolean;
  providers: MarketingProvider[];
  lists: MarketingList[];
  errors?: Array<{ provider: MarketingProvider; error: string }>;
};

export type MarketingCampaign = { id: string; name: string; status: string; emailsSent?: number };

export async function fetchMarketingLists(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGetSimple<MarketingListsResponse>(`/marketing/businesses/${encodeURIComponent(businessId)}/lists`);
}

export async function pushContactsToMarketingList(
  params: { provider: MarketingProvider; listId: string; contactIds?: string[]; segment?: { tag?: string; status?: string; marketingOptIn?: boolean } },
  businessId: string = DEFAULT_BUSINESS_ID,
) {
  return apiPostSimple<{ provider: MarketingProvider; listId: string; total: number; created: number; updated: number; failed: number; errors: string[] }>(
    `/marketing/businesses/${encodeURIComponent(businessId)}/lists/push-contacts`,
    params,
  );
}

export async function fetchMarketingCampaigns(provider: MarketingProvider, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGetSimple<{ provider: MarketingProvider; campaigns: MarketingCampaign[] }>(
    `/marketing/businesses/${encodeURIComponent(businessId)}/lists/campaigns/${encodeURIComponent(provider)}`,
  );
}

export async function triggerMarketingCampaign(provider: MarketingProvider, campaignId: string, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiPostSimple<{ success: boolean }>(
    `/marketing/businesses/${encodeURIComponent(businessId)}/lists/campaigns/${encodeURIComponent(provider)}/${encodeURIComponent(campaignId)}/trigger`,
    {},
  );
}

// ========== PAYMENTS OPERATIONS ==========
export type PaymentsGatewayId = "stripe" | "paypal" | "wipay";

export type PaymentsGatewayStatus = {
  id: PaymentsGatewayId;
  name: string;
  connected: boolean;
  supports: { transactions: boolean; paymentLinks: boolean; refunds: boolean };
};

export type PaymentsTransaction = {
  id: string;
  provider: PaymentsGatewayId;
  type: "charge" | "refund";
  status: string;
  amount: number;
  amountTtd: number | null;
  currency: string;
  customerName: string | null;
  customerEmail: string | null;
  description: string | null;
  invoiceId: string | null;
  externalUrl: string | null;
  createdAt: string;
};

export type PaymentsLink = {
  id: string;
  url: string;
  provider: PaymentsGatewayId;
  amount: number;
  currency: string;
  description: string;
  active: boolean;
  createdAt: string;
};

export type PaymentsRefund = {
  id: string;
  chargeId: string;
  amount: number;
  currency: string;
  status: string;
  provider: PaymentsGatewayId;
  createdAt: string;
};

export async function fetchPaymentsGateways(businessId: string) {
  return apiGetSimple<PaymentsGatewayStatus[]>(`/payments/businesses/${encodeURIComponent(businessId)}/gateways`);
}

export async function fetchPaymentsTransactions(businessId: string, opts: { limit?: number; q?: string } = {}) {
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.q) params.set("q", opts.q);
  const qs = params.toString();
  return apiGetSimple<PaymentsTransaction[]>(
    `/payments/businesses/${encodeURIComponent(businessId)}/transactions${qs ? `?${qs}` : ""}`,
  );
}

export async function fetchPaymentsLinks(businessId: string) {
  return apiGetSimple<PaymentsLink[]>(`/payments/businesses/${encodeURIComponent(businessId)}/links`);
}

export async function createPaymentsLink(
  businessId: string,
  body: { gateway: PaymentsGatewayId; amount: number; currency: string; description: string; customerEmail?: string },
) {
  return apiPostSimple<PaymentsLink>(`/payments/businesses/${encodeURIComponent(businessId)}/links`, body);
}

export async function revokePaymentsLink(businessId: string, gateway: PaymentsGatewayId, linkId: string) {
  return apiDelete<{ ok: true }>(
    `/payments/businesses/${encodeURIComponent(businessId)}/links/${gateway}/${encodeURIComponent(linkId)}`,
  );
}

export async function refundPaymentsCharge(
  businessId: string,
  body: { gateway: PaymentsGatewayId; chargeId: string; amount?: number; reason?: string },
) {
  return apiPostSimple<PaymentsRefund>(`/payments/businesses/${encodeURIComponent(businessId)}/refunds`, body);
}

export async function fetchTransactionLink(businessId: string, transactionId: string) {
  return apiGetSimple<{ invoiceId: string | null; provider: string | null; externalUrl: string | null }>(
    `/payments/businesses/${encodeURIComponent(businessId)}/transactions/${encodeURIComponent(transactionId)}/link`,
  );
}
