"use client";

import { useCallback, useMemo } from "react";
import {
  AddressAutocomplete,
  type AddressAutocompleteProps,
  type AddressPlaceDetails,
  type AddressPrediction,
} from "@keyflow/ui";
import { apiGet } from "@/lib/api";

interface MapsAutocompleteResponse {
  status?: string;
  predictions?: Array<{
    place_id: string;
    description: string;
    structured_formatting?: { main_text?: string; secondary_text?: string };
  }>;
}

interface MapsPlaceDetailsResponse {
  status?: string;
  result?: {
    place_id: string;
    name?: string;
    formatted_address?: string;
    formatted_phone_number?: string;
    website?: string;
    geometry?: { location?: { lat: number; lng: number } };
    address_components?: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }>;
  };
}

interface Props
  extends Omit<AddressAutocompleteProps, "search" | "fetchPlaceDetails"> {
  businessId: string | null;
  /** Restrict to one or more country codes (e.g. "tt"). */
  countries?: string;
  /** Override types — defaults to "address". */
  types?: string;
  /** Used to keep autocomplete + details requests on the same Google session. */
  sessionToken?: string;
}

function newSessionToken() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function componentsMap(
  comps?: MapsPlaceDetailsResponse["result"] extends infer T
    ? T extends { address_components?: infer C }
      ? C
      : never
    : never,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!comps || !Array.isArray(comps)) return out;
  for (const c of comps) {
    for (const t of c.types) out[t] = c.long_name;
  }
  return out;
}

export function BusinessAddressAutocomplete({
  businessId,
  countries,
  types = "address",
  sessionToken,
  disabled,
  ...rest
}: Props) {
  const session = useMemo(() => sessionToken ?? newSessionToken(), [sessionToken]);

  const search = useCallback(
    async (input: string): Promise<AddressPrediction[]> => {
      if (!businessId) return [];
      const params = new URLSearchParams({ input });
      params.set("sessiontoken", session);
      if (types) params.set("types", types);
      if (countries) {
        const codes = countries
          .split(",")
          .map((c) => `country:${c.trim().toLowerCase()}`)
          .join("|");
        params.set("components", codes);
      }
      const res = await apiGet<MapsAutocompleteResponse>(
        `/connect/businesses/${businessId}/maps/autocomplete?${params.toString()}`,
      );
      if (res.error) {
        throw new Error(res.error);
      }
      const preds = res.data?.predictions ?? [];
      return preds.map((p) => ({
        placeId: p.place_id,
        description: p.description,
        mainText: p.structured_formatting?.main_text,
        secondaryText: p.structured_formatting?.secondary_text,
      }));
    },
    [businessId, session, types, countries],
  );

  const fetchPlaceDetails = useCallback(
    async (placeId: string): Promise<AddressPlaceDetails | null> => {
      if (!businessId) return null;
      const params = new URLSearchParams({ sessiontoken: session });
      const res = await apiGet<MapsPlaceDetailsResponse>(
        `/connect/businesses/${businessId}/maps/place/${encodeURIComponent(placeId)}?${params.toString()}`,
      );
      if (res.error || !res.data?.result) return null;
      const r = res.data.result;
      return {
        placeId: r.place_id,
        name: r.name,
        formattedAddress: r.formatted_address ?? "",
        lat: r.geometry?.location?.lat,
        lng: r.geometry?.location?.lng,
        components: componentsMap(r.address_components),
        phone: r.formatted_phone_number,
        website: r.website,
        raw: r,
      };
    },
    [businessId, session],
  );

  const isDisabled = disabled || !businessId;

  return (
    <AddressAutocomplete
      {...rest}
      disabled={isDisabled}
      disabledReason={
        !businessId
          ? "Connect a business to enable address suggestions."
          : rest.disabledReason
      }
      search={search}
      fetchPlaceDetails={fetchPlaceDetails}
    />
  );
}
