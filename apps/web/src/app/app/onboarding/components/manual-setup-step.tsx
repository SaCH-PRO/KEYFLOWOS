"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import {
  fetchBusinessMinimalProfile,
  markOnboardingComplete,
  saveBusinessMinimalProfile,
  type MinimalBusinessProfile,
  type MinimalProfileField,
} from "@/lib/api/onboarding-concierge";
import { getStoredBusinessId } from "@/lib/workspace";

/**
 * Manual (non-AI) onboarding — owner ruling D-03 (2026-10-31).
 *
 * A business name, a currency and a timezone complete onboarding; chatting
 * with KEY is optional enrichment. The profile is saved through PATCH
 * /identity/businesses/:id and completion is asked of POST
 * /onboarding-concierge/businesses/:id/complete, which accepts it with no
 * model call (R0-32). Nothing here touches /ai/*, so it works with every AI
 * provider down.
 */

const GENOME_EDITOR_HREF = "/app/profile?tab=business-genome";

const FIELD_HELP: Record<MinimalProfileField, string> = {
  name: "Business name is required.",
  currency: "Currency must be a three-letter code, such as TTD or USD.",
  timezone: "Timezone must be a region/city zone, such as America/Port_of_Spain.",
};

const PILLAR_LABELS: Record<string, string> = {
  founder: "Founder DNA",
  business: "Business DNA",
  market: "Market DNA",
};

const COMMON_CURRENCIES = ["TTD", "USD", "JMD", "BBD", "XCD", "GYD", "EUR", "GBP", "CAD"];

const FIELD_ORDER: MinimalProfileField[] = ["name", "currency", "timezone"];

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

function supportedTimezones(): string[] {
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    return intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

function isIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The same rule the server applies on POST .../complete (R0-32). */
function missingProfileFields(profile: MinimalBusinessProfile): MinimalProfileField[] {
  const missing: MinimalProfileField[] = [];
  if (!profile.name) missing.push("name");
  if (!/^[A-Za-z]{3}$/.test(profile.currency)) missing.push("currency");
  if (!profile.timezone || !isIanaTimezone(profile.timezone)) missing.push("timezone");
  return missing;
}

function normalise(profile: MinimalBusinessProfile): MinimalBusinessProfile {
  return {
    name: profile.name.trim(),
    currency: profile.currency.trim().toUpperCase(),
    timezone: profile.timezone.trim(),
  };
}

type Failure =
  | { kind: "fields"; fields: MinimalProfileField[] }
  | { kind: "pillars"; pillars: string[]; message: string }
  | { kind: "message"; message: string };

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((v) => typeof v === "string") ? (value as string[]) : null;
}

/** Reads a refused completion: the server's structured 403s, else its message. */
function completionFailure(error: string | null, rawError: Record<string, unknown> | null | undefined): Failure {
  const details = (rawError?.details ?? {}) as Record<string, unknown>;
  if (rawError?.code === "ONBOARDING_PROFILE_INCOMPLETE") {
    const fields = (stringList(details.missingFields) ?? stringList(rawError.missingFields) ?? []).filter(
      (f): f is MinimalProfileField => (FIELD_ORDER as string[]).includes(f),
    );
    if (fields.length > 0) return { kind: "fields", fields };
  }
  if (rawError?.code === "GENOME_GATE_BLOCKED") {
    const pillars = stringList(details.missingPillars) ?? stringList(rawError.missingPillars) ?? [];
    return { kind: "pillars", pillars, message: error ?? "Complete the missing Business Genome pillars first." };
  }
  return { kind: "message", message: error ?? "Could not finish onboarding. Please try again." };
}

export function ManualSetupStep() {
  const router = useRouter();
  const businessId = getStoredBusinessId();
  const [profile, setProfile] = useState<MinimalBusinessProfile>(() => ({
    name: "",
    currency: "",
    timezone: browserTimezone(),
  }));
  const [timezones] = useState<string[]>(supportedTimezones);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Set synchronously on submit so a double click cannot post twice, and left
  // set after success while the navigation is in flight.
  const submittingRef = useRef(false);
  // Once the owner types, a late prefill must not overwrite their input.
  const editedRef = useRef(false);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    void fetchBusinessMinimalProfile(businessId).then(({ data }) => {
      if (cancelled || !data || editedRef.current) return;
      setProfile((current) => ({
        name: data.name ?? current.name,
        currency: data.currency ?? current.currency,
        timezone: data.timezone || current.timezone,
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const update = (field: MinimalProfileField) => (value: string) => {
    editedRef.current = true;
    setProfile((current) => ({ ...current, [field]: value }));
  };

  const finish = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;
    if (!businessId) {
      setFailure({ kind: "message", message: "No business is selected. Sign in again to choose one." });
      return;
    }
    const clean = normalise(profile);
    const missing = missingProfileFields(clean);
    if (missing.length > 0) {
      setFailure({ kind: "fields", fields: missing });
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setFailure(null);

    const saved = await saveBusinessMinimalProfile(businessId, clean);
    if (saved.error) {
      setFailure({ kind: "message", message: saved.error });
      submittingRef.current = false;
      setSubmitting(false);
      return;
    }

    const { data, error, rawError } = await markOnboardingComplete(businessId);
    if (error || !data?.complete) {
      setFailure(completionFailure(error, rawError));
      submittingRef.current = false;
      setSubmitting(false);
      return;
    }

    router.replace("/app/command-center");
  };

  const inputClass =
    "w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/40";

  return (
    <section
      aria-labelledby="manual-setup-heading"
      className="rounded-2xl border border-border/60 bg-card/60 p-5 shadow-sm backdrop-blur-xl"
    >
      <div className="space-y-1">
        <h2 id="manual-setup-heading" className="text-base font-semibold">
          Set up manually
        </h2>
        <p className="text-xs text-muted-foreground">
          No AI needed: your business name, currency and timezone are enough to open your workspace.
          Chatting with KEY below is optional and can enrich your Business Genome later.
        </p>
      </div>

      <form onSubmit={finish} noValidate className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="space-y-1 sm:col-span-3">
          <label htmlFor="manual-setup-name" className="text-xs font-medium">
            Business name
          </label>
          <input
            id="manual-setup-name"
            className={inputClass}
            value={profile.name}
            onChange={(e) => update("name")(e.target.value)}
            autoComplete="organization"
            placeholder="Your business"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="manual-setup-currency" className="text-xs font-medium">
            Currency
          </label>
          <input
            id="manual-setup-currency"
            className={`${inputClass} uppercase`}
            value={profile.currency}
            onChange={(e) => update("currency")(e.target.value)}
            list="manual-setup-currencies"
            maxLength={3}
            placeholder="TTD"
          />
          <datalist id="manual-setup-currencies">
            {COMMON_CURRENCIES.map((code) => (
              <option key={code} value={code} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <label htmlFor="manual-setup-timezone" className="text-xs font-medium">
            Timezone
          </label>
          <input
            id="manual-setup-timezone"
            className={inputClass}
            value={profile.timezone}
            onChange={(e) => update("timezone")(e.target.value)}
            list="manual-setup-timezones"
            placeholder="America/Port_of_Spain"
          />
          <datalist id="manual-setup-timezones">
            {timezones.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </div>

        {failure && (
          <div
            role="alert"
            className="sm:col-span-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-left"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="space-y-1 text-xs">
              {failure.kind === "fields" && (
                <>
                  <p className="font-medium text-destructive">Still needed before you can finish:</p>
                  <ul className="space-y-0.5 text-muted-foreground">
                    {failure.fields.map((field) => (
                      <li key={field}>{FIELD_HELP[field]}</li>
                    ))}
                  </ul>
                </>
              )}
              {failure.kind === "pillars" && (
                <>
                  <p className="font-medium text-destructive">{failure.message}</p>
                  {failure.pillars.length > 0 && (
                    <ul className="space-y-0.5 text-muted-foreground">
                      {failure.pillars.map((pillar) => (
                        <li key={pillar}>{PILLAR_LABELS[pillar] ?? pillar}</li>
                      ))}
                    </ul>
                  )}
                  <Link href={GENOME_EDITOR_HREF} className="font-medium underline">
                    Open the Business Genome editor
                  </Link>
                </>
              )}
              {failure.kind === "message" && <p className="font-medium text-destructive">{failure.message}</p>}
            </div>
          </div>
        )}

        <div className="sm:col-span-3 flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-2 rounded-xl bg-[hsl(var(--kf-accent1))] px-5 py-2.5 text-sm font-semibold text-[hsl(var(--kf-accent1-foreground))] transition-all hover:brightness-110 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Finish setup
            {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
          </button>
        </div>
      </form>
    </section>
  );
}
