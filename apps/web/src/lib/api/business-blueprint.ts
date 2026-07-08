import { apiPatch } from "@/lib/api";

export type BlueprintPatch = Record<string, Record<string, unknown>>;

export function updateBusinessBlueprint(businessId: string, patch: BlueprintPatch) {
  return apiPatch<{ completeness: number }>(
    `/blueprint/businesses/${businessId}`,
    patch,
  );
}
