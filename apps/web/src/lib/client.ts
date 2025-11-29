import { z } from "zod";
import { API_BASE } from "./api";

const contactSchema = z.object({
  id: z.string(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
});

const invoiceSchema = z.object({
  id: z.string(),
  status: z.string(),
  total: z.number().or(z.string()),
  contactId: z.string().nullable().optional(),
});

const bookingSchema = z.object({
  id: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  status: z.string(),
});

export type Contact = z.infer<typeof contactSchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
export type Booking = z.infer<typeof bookingSchema>;

async function apiGet<T>(path: string, schema: z.ZodSchema<T>): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(`${API_BASE}${path}`);
    const json = await res.json();
    if (!res.ok) return { data: null, error: json?.message ?? res.statusText };
    const parsed = schema.parse(json);
    return { data: parsed, error: null };
  } catch (err: any) {
    return { data: null, error: err?.message ?? "Network error" };
  }
}

export async function fetchContacts(businessId: string) {
  return apiGet(`/crm/businesses/${encodeURIComponent(businessId)}/contacts`, z.array(contactSchema));
}

export async function fetchBookings(businessId: string) {
  return apiGet(`/bookings/businesses/${encodeURIComponent(businessId)}`, z.array(bookingSchema));
}

export async function fetchInvoices(businessId: string) {
  return apiGet(`/commerce/businesses/${encodeURIComponent(businessId)}/products`, z.array(invoiceSchema)); // placeholder; adjust to invoices endpoint when available
}
