import { z } from "zod";
import { API_BASE, apiPost, getAuthHeaders } from "./api";

const DEFAULT_BUSINESS_ID = process.env.NEXT_PUBLIC_DEMO_BUSINESS_ID ?? "biz_demo";

const contactSchema = z.object({
  id: z.string(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  status: z.string().optional(),
  source: z.string().nullable().optional(),
  tags: z.array(z.string()).optional().default([]),
  custom: z.record(z.any()).nullable().optional(),
});

const eventSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  type: z.string(),
  data: z.any(),
  createdAt: z.string(),
});

const noteSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  body: z.string(),
  createdAt: z.string(),
});

const taskSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  title: z.string(),
  status: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  createdAt: z.string(),
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

export type Contact = z.infer<typeof contactSchema>;
export type ContactEvent = z.infer<typeof eventSchema>;
export type ContactNote = z.infer<typeof noteSchema>;
export type ContactTask = z.infer<typeof taskSchema>;
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

const fallbackContacts: Contact[] = [
  { id: "ct_1", firstName: "Sarah", lastName: "Smith", email: "sarah@example.com", phone: "868-555-1212" },
  { id: "ct_2", firstName: "John", lastName: "Doe", email: "john@example.com", phone: "868-555-2020" },
  { id: "ct_3", firstName: "Amira", lastName: "Khan", email: "amira@example.com", phone: "868-555-3333" },
];

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
    const res = await fetch(`${API_BASE}${path}`, { headers: { ...(getAuthHeaders() as any) } });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) {
      return { data: fallback ?? null, error: json?.message ?? res.statusText };
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return { data: fallback ?? null, error: "Failed to parse response" };
    }
    return { data: parsed.data, error: null };
  } catch (err: any) {
    return { data: fallback ?? null, error: err?.message ?? "Network error" };
  }
}

export async function fetchContacts(businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(
    `/crm/businesses/${encodeURIComponent(businessId)}/contacts`,
    z.array(contactSchema),
    fallbackContacts,
  );
}

export async function fetchContactDetail(contactId: string, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiGet(
    `/crm/businesses/${encodeURIComponent(businessId)}/contacts/${encodeURIComponent(contactId)}`,
    z.object({
      contact: contactSchema.nullable(),
      events: z.array(eventSchema),
      notes: z.array(noteSchema),
      tasks: z.array(taskSchema),
    }),
    { contact: null, events: [], notes: [], tasks: [] },
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

export async function createContact(input: { businessId?: string; firstName?: string; lastName?: string; email?: string; phone?: string }) {
  const businessId = input.businessId ?? DEFAULT_BUSINESS_ID;
  const body = {
    firstName: input.firstName ?? "Guest",
    lastName: input.lastName ?? "User",
    email: input.email ?? "",
    phone: input.phone ?? "",
    status: "LEAD",
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
  };

  return { data: synthesized, error: res.error };
}

export async function addContactNote(contactId: string, body: string, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiPost<ContactNote>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/contacts/${encodeURIComponent(contactId)}/notes`,
    body: { body },
  });
}

export async function addContactTask(contactId: string, title: string, dueDate?: string, businessId: string = DEFAULT_BUSINESS_ID) {
  return apiPost<ContactTask>({
    path: `/crm/businesses/${encodeURIComponent(businessId)}/contacts/${encodeURIComponent(contactId)}/tasks`,
    body: { title, dueDate },
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
