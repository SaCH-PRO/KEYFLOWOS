import { z } from "zod";
import { API_BASE, apiPost, getAuthHeaders } from "./api";

const DEFAULT_BUSINESS_ID = process.env.NEXT_PUBLIC_DEMO_BUSINESS_ID ?? "biz_demo";

const contactMetaSchema = z.object({
  outstandingBalance: z.number().optional(),
  unpaidInvoices: z.number().optional(),
  paidInvoices: z.number().optional(),
  lastInteractionAt: z.string().optional(),
  nextDueTaskAt: z.string().nullable().optional(),
  overdueTasks: z.number().optional(),
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

const bookingSchema = z.object({
  id: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  status: z.string(),
});

export type Contact = z.infer<typeof contactSchema> & { tags?: string[] };
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
  meta: contactMetaSchema.nullable().optional(),
});
export type ContactDetail = z.infer<typeof contactDetailSchema>;

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

export { DEFAULT_BUSINESS_ID };
