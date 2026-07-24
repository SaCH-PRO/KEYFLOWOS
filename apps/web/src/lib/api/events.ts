import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";

export const EVENT_STATUSES = ["DRAFT", "PUBLISHED", "CANCELLED", "COMPLETED"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const ATTENDEE_STATUSES = ["REGISTERED", "CANCELLED", "CHECKED_IN", "REFUNDED"] as const;
export type AttendeeStatus = (typeof ATTENDEE_STATUSES)[number];

export interface EventCounts {
  ticketTypes: number;
  attendees: number;
  checkIns: number;
}

export interface Event {
  id: string;
  businessId: string;
  name: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  timezone: string;
  location: string | null;
  isPublished: boolean;
  coverImageUrl: string | null;
  status: EventStatus;
  createdAt: string;
  updatedAt: string;
}

export interface EventListItem extends Event {
  _count: EventCounts;
}

export interface EventDetail extends Event {
  ticketTypes: EventTicketType[];
  _count: Pick<EventCounts, "attendees" | "checkIns">;
}

export interface EventTicketType {
  id: string;
  eventId: string;
  name: string;
  description: string | null;
  price: string;
  currency: string;
  quantity: number | null;
  quantitySold: number;
  salesStartAt: string | null;
  salesEndAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TicketTypeWithCount extends EventTicketType {
  _count: { attendees: number };
}

export interface EventAttendee {
  id: string;
  eventId: string;
  ticketTypeId: string | null;
  businessId: string;
  email: string;
  name: string | null;
  phone: string | null;
  status: AttendeeStatus;
  paymentId: string | null;
  checkedInAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AttendeeWithTicketType extends EventAttendee {
  ticketType: EventTicketType | null;
}

export interface EventCheckIn {
  id: string;
  eventId: string;
  attendeeId: string;
  checkedInAt: string;
  checkedInBy: string | null;
  notes: string | null;
}

export interface EventListResponse {
  items: EventListItem[];
  total: number;
  skip: number;
  take: number;
}

export interface CreateEventBody {
  name: string;
  description?: string;
  startsAt: string;
  endsAt?: string | null;
  timezone?: string;
  location?: string;
  isPublished?: boolean;
  coverImageUrl?: string;
  status?: EventStatus;
}

export type UpdateEventBody = Partial<CreateEventBody>;

export interface CreateTicketTypeBody {
  name: string;
  description?: string;
  price: number;
  currency?: string;
  quantity?: number;
  salesStartAt?: string | null;
  salesEndAt?: string | null;
  isActive?: boolean;
}

export type UpdateTicketTypeBody = Partial<CreateTicketTypeBody>;

export interface CreateAttendeeBody {
  ticketTypeId?: string | null;
  email: string;
  name?: string;
  phone?: string;
  status?: AttendeeStatus;
  paymentId?: string;
  checkedInAt?: string | null;
}

export type UpdateAttendeeBody = Partial<CreateAttendeeBody>;

export interface CheckInBody {
  checkedInBy?: string;
  notes?: string;
}

export interface DeleteResult {
  deleted: true;
}

export interface UndoCheckInResult {
  undone: true;
}

export interface EventListQuery {
  status?: EventStatus;
  search?: string;
  skip?: number;
  take?: number;
}

function buildEventListQuery(query: EventListQuery): string {
  const qs = new URLSearchParams();
  if (query.status) qs.set("status", query.status);
  if (query.search) qs.set("search", query.search);
  if (query.skip != null) qs.set("skip", String(query.skip));
  if (query.take != null) qs.set("take", String(query.take));
  const out = qs.toString();
  return out ? `?${out}` : "";
}

// Events
export function listEvents(businessId: string, query: EventListQuery = {}) {
  return apiGet<EventListResponse>(`/businesses/${businessId}/events${buildEventListQuery(query)}`);
}

export function getEvent(businessId: string, eventId: string) {
  return apiGet<EventDetail>(`/businesses/${businessId}/events/${eventId}`);
}

export function createEvent(businessId: string, body: CreateEventBody) {
  return apiPost<EventDetail>({ path: `/businesses/${businessId}/events`, body });
}

export function updateEvent(businessId: string, eventId: string, body: UpdateEventBody) {
  return apiPatch<EventDetail>(`/businesses/${businessId}/events/${eventId}`, body);
}

export function deleteEvent(businessId: string, eventId: string) {
  return apiDelete<DeleteResult>(`/businesses/${businessId}/events/${eventId}`);
}

// Ticket types
export function listTicketTypes(businessId: string, eventId: string) {
  return apiGet<TicketTypeWithCount[]>(`/businesses/${businessId}/events/${eventId}/ticket-types`);
}

export function createTicketType(businessId: string, eventId: string, body: CreateTicketTypeBody) {
  return apiPost<EventTicketType>({
    path: `/businesses/${businessId}/events/${eventId}/ticket-types`,
    body,
  });
}

export function updateTicketType(
  businessId: string,
  eventId: string,
  ticketTypeId: string,
  body: UpdateTicketTypeBody,
) {
  return apiPatch<EventTicketType>(
    `/businesses/${businessId}/events/${eventId}/ticket-types/${ticketTypeId}`,
    body,
  );
}

export function deleteTicketType(businessId: string, eventId: string, ticketTypeId: string) {
  return apiDelete<DeleteResult>(
    `/businesses/${businessId}/events/${eventId}/ticket-types/${ticketTypeId}`,
  );
}

// Attendees
export function listAttendees(businessId: string, eventId: string) {
  return apiGet<AttendeeWithTicketType[]>(`/businesses/${businessId}/events/${eventId}/attendees`);
}

export function createAttendee(businessId: string, eventId: string, body: CreateAttendeeBody) {
  return apiPost<AttendeeWithTicketType>({
    path: `/businesses/${businessId}/events/${eventId}/attendees`,
    body,
  });
}

export function updateAttendee(
  businessId: string,
  eventId: string,
  attendeeId: string,
  body: UpdateAttendeeBody,
) {
  return apiPatch<AttendeeWithTicketType>(
    `/businesses/${businessId}/events/${eventId}/attendees/${attendeeId}`,
    body,
  );
}

export function deleteAttendee(businessId: string, eventId: string, attendeeId: string) {
  return apiDelete<DeleteResult>(
    `/businesses/${businessId}/events/${eventId}/attendees/${attendeeId}`,
  );
}

// Check-ins
export function checkInAttendee(
  businessId: string,
  eventId: string,
  attendeeId: string,
  body: CheckInBody = {},
) {
  return apiPost<EventCheckIn>({
    path: `/businesses/${businessId}/events/${eventId}/attendees/${attendeeId}/check-in`,
    body,
  });
}

export function undoCheckIn(businessId: string, eventId: string, attendeeId: string) {
  return apiDelete<UndoCheckInResult>(
    `/businesses/${businessId}/events/${eventId}/attendees/${attendeeId}/check-in`,
  );
}
