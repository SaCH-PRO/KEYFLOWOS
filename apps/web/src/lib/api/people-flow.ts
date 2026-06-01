import { apiGet } from "../api";

export interface RelationshipHealth {
  contactId: string;
  contactName: string;
  overallScore: number;
  grade: string;
  label: string;
  factors: {
    recency: number;
    payment: number;
    engagement: number;
    responsiveness: number;
  };
  signals: string[];
  lifetimeValue: number;
  outstandingBalance: number;
  currency: string;
  lastInteractionDays: number;
  openInvoiceCount: number;
  totalBookingCount: number;
  totalInvoiceCount: number;
}

export interface PeopleSegment {
  id: string;
  name: string;
  criteria: string;
  count: number;
  contacts: Array<{ id: string; name: string; email: string | null; healthScore: number }>;
}

export async function fetchContactHealth(businessId: string, contactId: string) {
  return apiGet<RelationshipHealth>(`/people-flow/businesses/${businessId}/contacts/${contactId}/health`);
}

export async function fetchPeopleSegments(businessId: string) {
  return apiGet<PeopleSegment[]>(`/people-flow/businesses/${businessId}/segments`);
}
