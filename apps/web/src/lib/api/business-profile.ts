import { apiPatch } from "@/lib/api";

export interface BusinessProfilePatch {
  name?: string;
  phone?: string;
  email?: string;
  logoUrl?: string;
  country?: string;
  currency?: string;
  industry?: string;
  businessIntent?: string;
  slug?: string;
  storeEnabled?: boolean;
  metaData?: Record<string, unknown>;
}

export function updateBusinessProfile(businessId: string, patch: BusinessProfilePatch) {
  return apiPatch<{ id: string }>(
    `/identity/businesses/${businessId}`,
    patch,
  );
}
