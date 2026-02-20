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
  description: z.string().nullable().optional(),
  price: z.number(),
  currency: z.string().default("TTD"),
  category: z.string().default("SERVICE"),
  duration: z.number().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
});

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
        items: z.array(
          z.object({
            id: z.string(),
            description: z.string(),
            quantity: z.number(),
            unitPrice: z.number(),
            total: z.number(),
            productId: z.string().nullable().optional(),
          })
        ).optional(),
      }),
    ),
    fallbackInvoices,
  );
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

export async function createProduct(input: { 
  businessId?: string; 
  name: string; 
  price: number; 
  currency?: string; 
  description?: string;
  category?: string;
  duration?: number | null;
  isActive?: boolean;
}) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  const body = { 
    name: input.name, 
    price: input.price, 
    currency: input.currency ?? "TTD", 
    description: input.description,
    category: input.category ?? "SERVICE",
    duration: input.duration,
    isActive: input.isActive ?? true,
  };

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
  if (input.isActive !== undefined) body.isActive = input.isActive;

  return apiPatch<Product>(
    `/commerce/businesses/${encodeURIComponent(businessId)}/products/${encodeURIComponent(input.productId)}`,
    body,
  );
}

export async function deleteProduct(productId: string, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiDelete(`/commerce/businesses/${encodeURIComponent(businessId)}/products/${encodeURIComponent(productId)}`);
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
  return apiGetSimple<Quote[]>(`/commerce/businesses/${encodeURIComponent(bId)}/quotes`);
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

export async function updatePost(postId: string, data: { content?: string; scheduledAt?: string | null; channelIds?: string[] }, businessId: string = DEFAULT_BUSINESS_ID) {
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

export interface CockpitSummary {
  momentum: number;
  streaks: string[];
  phases: FlowPhase[];
  bottleneck: { phase: string; suggestion: string } | null;
  feed: FeedItem[];
  quickActions: QuickAction[];
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

export async function fetchFlowIntelligence(businessId?: string): Promise<ApiResult<FlowIntelligenceData>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/crm/businesses/${encodeURIComponent(bid)}/flow-intelligence`,
    flowIntelligenceSchema,
  );
}

export async function fetchNextActions(businessId?: string): Promise<ApiResult<CrmNextAction[]>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/crm/businesses/${encodeURIComponent(bid)}/next-actions`,
    z.array(crmNextActionSchema),
    [],
  );
}

export async function completeNextAction(actionId: string, businessId?: string) {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost({
    path: `/crm/businesses/${encodeURIComponent(bid)}/next-actions/${encodeURIComponent(actionId)}/complete`,
    body: {},
  });
}

export async function fetchAutopilotActionsForCrm(businessId?: string): Promise<ApiResult<AutopilotActionData[]>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/crm/businesses/${encodeURIComponent(bid)}/autopilot-actions`,
    z.array(autopilotActionSchema),
    [],
  );
}

export async function fetchContactHealthMetrics(contactId: string, businessId?: string): Promise<ApiResult<HealthMetrics>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/crm/businesses/${encodeURIComponent(bid)}/contacts/${encodeURIComponent(contactId)}/health`,
    healthMetricsSchema,
  );
}

export async function fetchContactJourney(contactId: string, businessId?: string): Promise<ApiResult<JourneyMilestone[]>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/crm/businesses/${encodeURIComponent(bid)}/contacts/${encodeURIComponent(contactId)}/journey`,
    z.array(journeyMilestoneSchema),
    [],
  );
}

export async function fetchPredictiveRevenue(businessId?: string): Promise<ApiResult<RevenueData>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/crm/businesses/${encodeURIComponent(bid)}/predictive-revenue`,
    revenueDataSchema,
  );
}

export async function fetchConversationContext(contactId: string, businessId?: string): Promise<ApiResult<ConversationContextData>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGet(
    `/crm/businesses/${encodeURIComponent(bid)}/contacts/${encodeURIComponent(contactId)}/context`,
    conversationContextSchema,
  );
}

export async function generateAiInsight(contactId: string, businessId?: string): Promise<ApiResult<AiInsight>> {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<AiInsight>({
    path: `/crm/businesses/${encodeURIComponent(bid)}/contacts/${encodeURIComponent(contactId)}/ai-insight`,
    body: {},
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

export { DEFAULT_BUSINESS_ID };
