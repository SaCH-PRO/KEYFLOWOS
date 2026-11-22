"use client";

import { useEffect, useId, useRef, useMemo, useState } from "react";
import {
  Building2,
  Clock,
  Users,
  FileText,
  AlertCircle,
  Sparkles as SparklesIcon,
  Wand2,
  RefreshCw,
  CheckCircle2,
  ArrowRight,
  LayoutGrid,
} from "lucide-react";
import { Button, Input } from "@keyflow/ui";
import { apiPatch, apiPost } from "@/lib/api";
import { answerFromThrown, refusalMessage, useRefusal, type ApiAnswer } from "@/lib/failure-kit";
import { AccordionSection, AccordionGroup } from "../../store/components/accordion-section";
import { AiFieldBadge } from "./ai-field-badge";
import { useProfileSection } from "@/hooks/use-profile-section";
import {
  BUSINESS_SELLS,
  saveAdvancedSettings,
  saveBusinessSells,
  useBusinessSettings,
  type BusinessSells,
} from "@/lib/business-settings";

/**
 * The team sizes the form offers. Each value is one the profile PATCH takes: it validates teamSize with
 * @IsEnum(TeamSize) (apps/server identity/dto/update-business.dto.ts: solo, small, medium, large, 1, 2-5, 6-10,
 * 11-50, 50+). SWP-PROFILE-TEAMSIZE (sweep BUG-006): the form offered SOLO, SMALL_TEAM, GROWING, MEDIUM and LARGE,
 * so every save answered 400 and nothing was written. Pinned by
 * __tests__/my-business-teamsize.test.tsx and apps/server/test/business-profile-save.integration.test.ts (which
 * reads this list from this file).
 */
const TEAM_SIZE_OPTIONS = [
  { value: "solo", label: "Solo / Just me" },
  { value: "2-5", label: "Small team (2-5)" },
  { value: "6-10", label: "Growing (6-10)" },
  { value: "11-50", label: "Medium (11-50)" },
  { value: "50+", label: "Large (50+)" },
];

/**
 * A stored team size the options do not name, read as the option it means: the old form's values (its "Growing"
 * was 6-15, read as 6-10) and the server's other spellings of the same sizes. A business the old form saved shows
 * its size and saves it as an enum value; a stored value not listed here is shown as none and left as it is (the
 * form sends no teamSize for it).
 */
const STORED_TEAM_SIZE: Record<string, string> = {
  SOLO: "solo",
  "1": "solo",
  SMALL_TEAM: "2-5",
  small: "2-5",
  GROWING: "6-10",
  MEDIUM: "11-50",
  medium: "11-50",
  LARGE: "50+",
  large: "50+",
};

/** The option a stored team size is shown as, or "" when there is none or the form cannot name it. */
function teamSizeOption(stored: string | null | undefined): string {
  const value = stored?.trim() ?? "";
  if (TEAM_SIZE_OPTIONS.some((o) => o.value === value)) return value;
  for (const spelling of [value, value.toUpperCase(), value.toLowerCase()]) {
    if (Object.prototype.hasOwnProperty.call(STORED_TEAM_SIZE, spelling)) return STORED_TEAM_SIZE[spelling];
  }
  return "";
}

const DAY_LABELS = [
  { key: "monday", label: "Mon" },
  { key: "tuesday", label: "Tue" },
  { key: "wednesday", label: "Wed" },
  { key: "thursday", label: "Thu" },
  { key: "friday", label: "Fri" },
  { key: "saturday", label: "Sat" },
  { key: "sunday", label: "Sun" },
];

type DaySchedule = { open: string; close: string; closed: boolean };
type BusinessHours = Record<string, DaySchedule>;

const DEFAULT_HOURS: BusinessHours = Object.fromEntries(
  DAY_LABELS.map(({ key }) => [
    key,
    { open: "09:00", close: "17:00", closed: key === "sunday" || key === "saturday" },
  ])
);

interface BizInfo {
  name: string;
  tagline: string;
  description: string;
  teamSize: string;
  businessHours: BusinessHours;
}


const EMPTY_BIZ_INFO: BizInfo = {
  name: "",
  tagline: "",
  description: "",
  teamSize: "",
  businessHours: DEFAULT_HOURS,
};

/**
 * What Save sends as teamSize when the owner clears a team size the business has stored ("Select team size" picked
 * over a stored size): the PATCH clears team_size with null, while "" is refused and a body without teamSize keeps
 * the stored size. PTS-COR-1 (review): the clear was left out of the body, so the size stayed while the form said
 * "Business info updated". Read from this file by apps/server/test/business-profile-save.integration.test.ts
 * (V63M-C05), which saves it through the real PATCH.
 */
const CLEARED_TEAM_SIZE = null;

/**
 * What Save sends. teamSize goes when one of the options is chosen; when the owner cleared the size the form loaded
 * or last saved (`stored`), it goes as CLEARED_TEAM_SIZE; otherwise it is left out: "" is not a team size (the PATCH
 * refuses it), and leaving it out keeps whatever the business has stored (none, or a value the form cannot name).
 */
function businessInfoBody(form: BizInfo, stored: BizInfo): Record<string, unknown> {
  const teamSize = teamSizeOption(form.teamSize);
  const cleared = !teamSize && teamSizeOption(stored.teamSize) !== "";
  return {
    name: form.name,
    tagline: form.tagline,
    description: form.description,
    ...(teamSize ? { teamSize } : cleared ? { teamSize: CLEARED_TEAM_SIZE } : {}),
    businessHours: form.businessHours,
  };
}

/**
 * What a save wrote, for the page (onSaved): the form's fields the body carried. A body without teamSize left the
 * stored team size as it was, so none is reported; a clear is reported as "" (no team size).
 */
function savedFields(form: BizInfo, body: Record<string, unknown>): Partial<BizInfo> {
  const { teamSize, ...rest } = form;
  return "teamSize" in body ? { ...rest, teamSize } : rest;
}

/** What Save does, in the words a refusal is said with. */
const SAVE_WHAT = "save your business info";

function isBizInfoDirty(current: BizInfo, initial: BizInfo): boolean {
  return (
    current.name !== initial.name ||
    current.tagline !== initial.tagline ||
    current.description !== initial.description ||
    current.teamSize !== initial.teamSize ||
    JSON.stringify(current.businessHours) !== JSON.stringify(initial.businessHours)
  );
}

function SectionCompletion({ completed, total, impact }: { completed: number; total: number; impact: string }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const isComplete = completed === total;
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-lg mb-2"
      style={{
        background: isComplete ? "hsl(var(--kf-success) / 0.06)" : "hsl(var(--kf-muted) / 0.06)",
        border: `1px solid ${isComplete ? "hsl(var(--kf-success) / 0.12)" : "hsl(var(--kf-border) / 0.1)"}`,
      }}
    >
      {isComplete ? (
        <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(var(--kf-success))" }} />
      ) : (
        <div className="w-3.5 h-3.5 rounded-full border-2 flex-shrink-0" style={{ borderColor: "hsl(var(--kf-muted-foreground) / 0.3)" }} />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold" style={{ color: isComplete ? "hsl(var(--kf-success))" : "hsl(var(--kf-foreground))" }}>
            {completed}/{total} complete
          </span>
          <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "hsl(var(--kf-muted) / 0.2)", maxWidth: "60px" }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: isComplete ? "hsl(var(--kf-success))" : "hsl(var(--kf-accent1))" }} />
          </div>
        </div>
        <p className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{impact}</p>
      </div>
    </div>
  );
}

function FieldImpact({ text }: { text: string }) {
  return (
    <p className="text-[10px] mt-1 flex items-center gap-1" style={{ color: "hsl(var(--kf-accent2) / 0.8)" }}>
      <ArrowRight className="w-2.5 h-2.5 flex-shrink-0" />
      {text}
    </p>
  );
}

const SELLS_LABELS: Record<BusinessSells, string> = {
  services: "Services",
  products: "Products",
  both: "Both",
};

/** What each control does, in the words a refusal is said with. */
const CHANGE_SELLS_WHAT = "change what you sell";
const CHANGE_CRM_WHAT = "change the Advanced CRM switch";

/**
 * BIZ-SETTINGS-WEB (owner rulings D-150 'hubs', D-218 'sellsowner', D-11): what the business sells and the Advanced
 * CRM switch, as the business holds them (lib/business-settings.ts; the nav and the hubs read the same values).
 *
 * Each control saves on its own, through its own door, and is not part of "Save Business Info":
 *   - what you sell: the owner-only profile PATCH (sells and nothing else);
 *   - the Advanced CRM switch: the owner-or-admin door (BIZ-SETTINGS-ADMIN-DOOR).
 * The server decides who may change which; the browser does not guess. A control shows what the business holds and
 * moves only when the server has answered that it changed, so a refusal (one toast, the same words beside the
 * control) leaves it as it was and nothing is reported as saved. Settings that could not be loaded are said so, and
 * the defaults are not drawn in their place.
 */
function BusinessSetupSettings({
  businessId,
  onStatus,
}: {
  businessId: string;
  onStatus: (status: { type: "success" | "error"; message: string } | null) => void;
}) {
  const settings = useBusinessSettings(businessId);
  const { refused, message: refusal, clear: clearRefusal } = useRefusal();
  const [saving, setSaving] = useState<"sells" | "advancedCrm" | null>(null);
  // Set synchronously, so two quick presses cannot send two writes.
  const savingRef = useRef(false);
  // Per instance: two sections on one page keep their own labels and radio group (review COR-5).
  const uid = useId();
  const sellsLabelId = `${uid}-sells-label`;
  const crmLabelId = `${uid}-advanced-crm-label`;

  // A press made while another change is being saved is not sent; the member is told so (review COR2-2).
  const [notTaken, setNotTaken] = useState(false);
  // The failed view's "Try again" stays mounted, and says it is busy, while the settings are read again (COR2-1).
  const [retrying, setRetrying] = useState(false);

  // Set synchronously, so a double press reads once.
  const retryingRef = useRef(false);
  const sellsGroupRef = useRef<HTMLDivElement>(null);

  const retry = async () => {
    if (retryingRef.current) return;
    retryingRef.current = true;
    setRetrying(true);
    await settings.reload();
    retryingRef.current = false;
    setRetrying(false);
    // If "Try again" worked, its button is gone and took the keyboard's focus with it: put it on the controls
    // that took its place (review COR3-2). Only then: focus the member has since put anywhere else is theirs, and
    // nothing stays armed for a later recovery (review COR4-1).
    setTimeout(() => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      const group = sellsGroupRef.current;
      (group?.querySelector<HTMLInputElement>("input:checked") ?? group?.querySelector<HTMLInputElement>("input"))?.focus();
    }, 0);
  };

  const write = async (which: "sells" | "advancedCrm", what: string, done: string, send: () => Promise<ApiAnswer>) => {
    if (settings.status !== "ready") return;
    if (savingRef.current) {
      setNotTaken(true);
      return;
    }
    savingRef.current = true;
    setSaving(which);
    onStatus(null);
    clearRefusal();
    let res: ApiAnswer;
    try {
      res = await send();
    } catch (err) {
      res = answerFromThrown(err);
    }
    savingRef.current = false;
    setSaving(null);
    setNotTaken(false);
    if (refused(res, { what })) {
      onStatus({ type: "error", message: refusalMessage(res, { what }) ?? `Couldn't ${what}.` });
      return;
    }
    onStatus({ type: "success", message: done });
  };

  const chooseSells = (value: BusinessSells) => {
    if (value === settings.sells) return;
    void write("sells", CHANGE_SELLS_WHAT, "What you sell updated", () => saveBusinessSells(businessId, value));
  };

  const toggleCrm = () => {
    const next = !settings.advancedCrm;
    void write("advancedCrm", CHANGE_CRM_WHAT, next ? "Advanced CRM turned on" : "Advanced CRM turned off", () =>
      saveAdvancedSettings(businessId, { advancedCrm: next }),
    );
  };

  const failed = settings.status === "failed";
  const loading = settings.status !== "ready";
  // While a change is being saved the controls are marked busy, not disabled: the one just pressed keeps the
  // keyboard's focus (review COR-5), and `write` ignores a press until the answer is in.
  const busy = saving !== null;

  // One live region, on the page from the first render and empty until there is a failure to say: a region that
  // arrives already filled is not reliably announced (review COR4-3).
  const loadStatus = (
    <p
      role="status"
      data-testid="business-settings-load-status"
      className={failed ? "flex items-start gap-1.5 text-xs" : "sr-only"}
      style={failed ? { color: "hsl(var(--kf-muted-foreground))" } : undefined}
    >
      {failed && (
        <>
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span>
            Couldn&apos;t load what you sell and the Advanced CRM switch{settings.error ? `: ${settings.error}` : "."}
          </span>
        </>
      )}
    </p>
  );

  if (failed) {
    return (
      <div className="space-y-4 p-1">
        {loadStatus}
        <Button variant="outline" onClick={() => void retry()} aria-busy={retrying || undefined} className="min-h-[44px]">
          {retrying ? "Trying again..." : "Try again"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-1" aria-busy={loading}>
      {loadStatus}
      <div className="text-xs text-muted-foreground">
        <div id={sellsLabelId} className="flex items-center gap-1.5 mb-1.5 font-medium">
          <LayoutGrid className="h-3 w-3" aria-hidden="true" />
          What you sell
        </div>
        <div ref={sellsGroupRef} role="radiogroup" aria-labelledby={sellsLabelId} aria-busy={busy || undefined} className="flex flex-wrap gap-x-5 gap-y-1">
          {BUSINESS_SELLS.map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm text-foreground cursor-pointer min-h-[44px]">
              <input
                type="radio"
                name={`${uid}-sells`}
                value={value}
                checked={!loading && settings.sells === value}
                disabled={loading}
                aria-disabled={busy || undefined}
                onChange={() => chooseSells(value)}
                className="w-4 h-4 accent-[hsl(var(--kf-accent2))]"
              />
              {SELLS_LABELS[value]}
            </label>
          ))}
        </div>
        <FieldImpact text="Sets the hubs in your menu and the bar at the bottom of your phone. Only the business owner can change it." />
      </div>

      <div className="text-xs text-muted-foreground">
        <div className="flex items-center justify-between gap-3">
          <div id={crmLabelId} className="flex items-center gap-1.5 font-medium">
            <Users className="h-3 w-3" aria-hidden="true" />
            Advanced CRM
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!loading && settings.advancedCrm}
            aria-labelledby={crmLabelId}
            disabled={loading}
            aria-disabled={busy || undefined}
            aria-busy={saving === "advancedCrm" || undefined}
            onClick={toggleCrm}
            className="relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 aria-disabled:opacity-70 before:absolute before:-inset-y-2.5 before:inset-x-0 before:content-['']"
            style={{ background: !loading && settings.advancedCrm ? "hsl(var(--kf-accent2))" : "hsl(var(--kf-muted) / 0.5)" }}
          >
            <span
              aria-hidden="true"
              className="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform"
              style={{ transform: !loading && settings.advancedCrm ? "translateX(22px)" : "translateX(2px)" }}
            />
          </button>
        </div>
        <FieldImpact text="Adds Deals and Companies to Customers. The owner or an admin can change it." />
      </div>

      {loading && <p className="text-[10px] text-muted-foreground">Loading these settings...</p>}

      {notTaken && (
        <p role="status" className="text-xs" style={{ color: "hsl(var(--kf-warning))" }}>
          Still saving your last change. Press again in a moment.
        </p>
      )}

      {refusal && (
        <p
          role="alert"
          className="flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs"
          style={{
            color: "hsl(var(--kf-error))",
            background: "hsl(var(--kf-error) / 0.08)",
            border: "1px solid hsl(var(--kf-error) / 0.3)",
          }}
        >
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span>{refusal}</span>
        </p>
      )}
    </div>
  );
}

interface MyBusinessSectionProps {
  businessId: string | null;
  businessData?: {
    name?: string;
    tagline?: string | null;
    description?: string | null;
    teamSize?: string | null;
    businessHours?: BusinessHours | null;
  } | null;
  businessLoading?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onStatus: (status: { type: "success" | "error"; message: string } | null) => void;
  onSaved?: (saved: Partial<BizInfo>) => void;
}

export default function MyBusinessSection({
  businessId,
  businessData,
  businessLoading,
  onDirtyChange,
  onStatus,
  onSaved,
}: MyBusinessSectionProps) {
  const { form, setForm, initialForm, setInitialForm, isDirty, saving, setSaving } = useProfileSection<BizInfo>({
    initialState: EMPTY_BIZ_INFO,
    isDirtyFn: isBizInfoDirty,
    onDirtyChange,
  });

  const [generatingTagline, setGeneratingTagline] = useState(false);
  const [generatingDesc, setGeneratingDesc] = useState(false);
  const initializedRef = useRef(false);
  // A refused save is said in one toast and beside the Save button, scrolled into view (the page's banner sits far
  // above this form, out of sight); the form keeps every edit (FAILURE-KIT).
  const { refused, message: refusal, clear: clearRefusal } = useRefusal();
  const refusalRef = useRef<HTMLParagraphElement>(null);
  const [refusalSeq, setRefusalSeq] = useState(0);

  useEffect(() => {
    if (refusalSeq > 0) refusalRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [refusalSeq]);

  const identityCompletion = useMemo(() => {
    const fields = [form.name, form.tagline, form.description];
    return { completed: fields.filter(Boolean).length, total: fields.length };
  }, [form.name, form.tagline, form.description]);

  const teamCompletion = useMemo(() => {
    const fields = [form.teamSize];
    return { completed: fields.filter(Boolean).length, total: fields.length };
  }, [form.teamSize]);

  const hoursCompletion = useMemo(() => {
    const hasCustomHours = Object.values(form.businessHours).some(
      (d) => d.open !== "09:00" || d.close !== "17:00" || d.closed
    );
    return { completed: hasCustomHours ? 1 : 0, total: 1 };
  }, [form.businessHours]);

  useEffect(() => {
    if (!businessId || businessLoading || !businessData) return;
    if (initializedRef.current) return;
    initializedRef.current = true;
    const f: BizInfo = {
      name: businessData.name || "",
      tagline: businessData.tagline || "",
      description: businessData.description || "",
      // A size the old form stored (SMALL_TEAM, ...) is shown, and saved, as the option it means.
      teamSize: teamSizeOption(businessData.teamSize),
      businessHours: businessData.businessHours || DEFAULT_HOURS,
    };
    setForm(f);
    setInitialForm(f);
  }, [businessId, businessLoading, businessData, setForm, setInitialForm]);

  const handleSave = async () => {
    if (!businessId) return;
    const saved = { ...form };
    // Against what the form loaded or last saved, so that clearing a stored team size is sent as a clear.
    const body = businessInfoBody(saved, initialForm);
    setSaving(true);
    onStatus(null);
    clearRefusal();
    let res: ApiAnswer;
    try {
      res = await apiPatch<BizInfo>(`/identity/businesses/${businessId}`, body);
    } catch (err) {
      res = answerFromThrown(err);
    }
    setSaving(false);
    if (refused(res, { what: SAVE_WHAT })) {
      // The edits stay in the form, unsaved, so Save can be pressed again.
      onStatus({ type: "error", message: refusalMessage(res, { what: SAVE_WHAT }) ?? `Couldn't ${SAVE_WHAT}.` });
      setRefusalSeq((n) => n + 1);
      return;
    }
    onStatus({ type: "success", message: "Business info updated" });
    setInitialForm(saved);
    onSaved?.(savedFields(saved, body));
  };

  const handleAiGenerateField = async (field: "tagline" | "description") => {
    if (!businessId) return;
    const setLoading = field === "tagline" ? setGeneratingTagline : setGeneratingDesc;
    setLoading(true);
    onStatus(null);
    try {
      const res = await apiPost<{ tagline?: string; description?: string }>({
        path: `/identity/businesses/${businessId}/ai-generate-field`,
        body: {
          field,
          context: {
            name: form.name,
            tagline: form.tagline,
            description: form.description,
            teamSize: form.teamSize,
          },
        },
      });
      if (res.error) {
        onStatus({ type: "error", message: res.error || "AI generation failed" });
      } else if (res.data) {
        const val = field === "tagline" ? res.data.tagline : res.data.description;
        if (val) {
          setForm((f) => ({ ...f, [field]: val }));
          onStatus({ type: "success", message: `AI generated ${field} using your business intelligence! Review and save.` });
        }
      }
    } catch (err) {
      onStatus({ type: "error", message: err instanceof Error ? err.message : "AI generation failed" });
    }
    setLoading(false);
  };

  const updateHours = (day: string, updates: Partial<DaySchedule>) => {
    setForm((f) => ({
      ...f,
      businessHours: {
        ...f.businessHours,
        [day]: { ...f.businessHours[day], ...updates },
      },
    }));
  };

  if (businessLoading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground" aria-busy="true" aria-label="Loading business info">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" aria-hidden="true" />
        Loading business info...
      </div>
    );
  }

  return (
    // pb-24 below md: on a phone the page can be scrolled until Save Business Info clears the bottom bar. The app
    // shell's scroll root pads its bottom (pb-28), but its page wrapper (PageTransition) is h-full, so a long page
    // overflows that wrapper and the padding ends up above the overflow: without this, Save stayed under the bottom
    // bar however far the page was scrolled (e2e/sweep-profile-save.spec.ts, phone).
    <div className="space-y-4 pb-24 md:pb-0">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Building2 className="h-4 w-4" style={{ color: "hsl(var(--kf-accent2))" }} aria-hidden="true" />
        My Business
      </div>

      <AccordionGroup title="Business Details">
        <AccordionSection
          title="Business Identity"
          subtitle={`${identityCompletion.completed}/${identityCompletion.total} fields complete`}
          icon={Building2}
          accentColor="hsl(var(--kf-accent2))"
          defaultOpen
        >
          <div className="space-y-4 p-1">
            <SectionCompletion
              completed={identityCompletion.completed}
              total={identityCompletion.total}
              impact="Powers invoices, storefront, AI documents, and public pages"
            />

            <label className="block text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 mb-1.5 font-medium">
                <Building2 className="h-3 w-3" aria-hidden="true" />
                Business Name
                {!form.name && (
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-warning) / 0.1)", color: "hsl(var(--kf-warning))" }}>Required</span>
                )}
              </div>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Your Business Name"
                style={!form.name ? { borderColor: "hsl(var(--kf-warning) / 0.3)" } : undefined}
              />
              <FieldImpact text="Appears on invoices, quotes, storefront, and all customer-facing pages" />
            </label>

            <div className="block text-xs text-muted-foreground">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5 font-medium">
                  <SparklesIcon className="h-3 w-3" aria-hidden="true" />
                  Tagline
                  <AiFieldBadge />
                  {!form.tagline && (
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-warning) / 0.1)", color: "hsl(var(--kf-warning))" }}>Empty</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleAiGenerateField("tagline")}
                  disabled={generatingTagline || !form.name}
                  aria-label="Generate tagline with AI"
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all min-h-[44px]"
                  style={{
                    background: "hsl(var(--kf-accent1) / 0.1)",
                    color: "hsl(var(--kf-accent1))",
                  }}
                >
                  {generatingTagline ? <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Wand2 className="h-3 w-3" aria-hidden="true" />}
                  {generatingTagline ? "..." : "Generate"}
                </button>
              </div>
              <Input
                value={form.tagline}
                onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))}
                placeholder="A short tagline for your business"
                maxLength={100}
                style={!form.tagline ? { borderColor: "hsl(var(--kf-warning) / 0.3)" } : undefined}
              />
              <div className="flex justify-between mt-1">
                <FieldImpact text="Shown on storefront hero and marketing materials" />
                <p className="text-[10px] flex-shrink-0 ml-2" aria-label={`${form.tagline.length} of 100 characters`}>{form.tagline.length}/100</p>
              </div>
            </div>

            <div className="block text-xs text-muted-foreground">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5 font-medium">
                  <FileText className="h-3 w-3" aria-hidden="true" />
                  Business Description
                  <AiFieldBadge />
                  {!form.description && (
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-warning) / 0.1)", color: "hsl(var(--kf-warning))" }}>Empty</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleAiGenerateField("description")}
                  disabled={generatingDesc || !form.name}
                  aria-label="Generate business description with AI"
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all min-h-[44px]"
                  style={{
                    background: "hsl(var(--kf-accent1) / 0.1)",
                    color: "hsl(var(--kf-accent1))",
                  }}
                >
                  {generatingDesc ? <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Wand2 className="h-3 w-3" aria-hidden="true" />}
                  {generatingDesc ? "..." : "Generate"}
                </button>
              </div>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Describe what your business does, who you serve, and what makes you unique..."
                maxLength={500}
                rows={3}
                aria-label="Business description"
                className="w-full bg-transparent border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent2))]/30 resize-none"
                style={!form.description ? { borderColor: "hsl(var(--kf-warning) / 0.3)" } : undefined}
              />
              <div className="flex justify-between mt-1">
                <FieldImpact text="Improves AI documents, storefront copy, and intelligence package quality" />
                <p className="text-[10px] flex-shrink-0 ml-2" aria-label={`${form.description.length} of 500 characters`}>{form.description.length}/500</p>
              </div>
            </div>
          </div>
        </AccordionSection>

        {businessId && (
          <AccordionSection
            title="What you sell & Advanced CRM"
            subtitle="Sets your hubs; saved as soon as you change it"
            icon={LayoutGrid}
            accentColor="hsl(var(--kf-accent2))"
            defaultOpen
          >
            <BusinessSetupSettings businessId={businessId} onStatus={onStatus} />
          </AccordionSection>
        )}

        <AccordionSection
          title="Team & Scale"
          subtitle={`${teamCompletion.completed}/${teamCompletion.total} fields complete`}
          icon={Users}
          accentColor="hsl(var(--kf-accent1))"
        >
          <div className="p-1">
            <SectionCompletion
              completed={teamCompletion.completed}
              total={teamCompletion.total}
              impact="Powers staffing, automation, and operations recommendations"
            />
            <label className="block text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 mb-1.5 font-medium">
                <Users className="h-3 w-3" aria-hidden="true" />
                Team Size
                {!form.teamSize && (
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-warning) / 0.1)", color: "hsl(var(--kf-warning))" }}>Required</span>
                )}
              </div>
              <select
                value={form.teamSize}
                onChange={(e) => setForm((f) => ({ ...f, teamSize: e.target.value }))}
                aria-label="Team size"
                className="w-full bg-transparent border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30 min-h-[44px]"
                style={!form.teamSize ? { borderColor: "hsl(var(--kf-warning) / 0.3)" } : undefined}
              >
                <option value="">Select team size</option>
                {TEAM_SIZE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <FieldImpact text="Tailors automation complexity, staffing guidance in Calendar, and Flows recommendations" />
            </label>
          </div>
        </AccordionSection>

        <AccordionSection
          title="Operating Hours"
          subtitle={hoursCompletion.completed > 0 ? "Configured" : "Not configured"}
          icon={Clock}
          accentColor="hsl(var(--kf-accent2))"
        >
          <div className="space-y-2 p-1">
            <SectionCompletion
              completed={hoursCompletion.completed}
              total={hoursCompletion.total}
              impact="Controls booking availability and storefront display hours"
            />
            {DAY_LABELS.map(({ key, label }) => {
              const day = form.businessHours[key] || { open: "09:00", close: "17:00", closed: false };
              return (
                <div key={key} className="flex items-center gap-3">
                  <label className="flex items-center gap-2 w-20 text-xs font-medium cursor-pointer min-h-[44px]">
                    <input
                      type="checkbox"
                      checked={!day.closed}
                      onChange={(e) => updateHours(key, { closed: !e.target.checked })}
                      aria-label={`${label} open`}
                      className="w-4 h-4 rounded accent-[hsl(var(--kf-accent2))]"
                    />
                    {label}
                  </label>
                  {!day.closed ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="time"
                        value={day.open}
                        onChange={(e) => updateHours(key, { open: e.target.value })}
                        aria-label={`${label} opening time`}
                        className="bg-transparent border border-border rounded-lg px-2 py-1.5 text-xs text-foreground min-h-[36px]"
                      />
                      <span className="text-xs text-muted-foreground" aria-hidden="true">to</span>
                      <input
                        type="time"
                        value={day.close}
                        onChange={(e) => updateHours(key, { close: e.target.value })}
                        aria-label={`${label} closing time`}
                        className="bg-transparent border border-border rounded-lg px-2 py-1.5 text-xs text-foreground min-h-[36px]"
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">Closed</span>
                  )}
                </div>
              );
            })}
            <FieldImpact text="Syncs with Calendar bookings, storefront hours display, and scheduling AI" />
          </div>
        </AccordionSection>
      </AccordionGroup>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/30">
        {refusal && (
          <p
            ref={refusalRef}
            role="alert"
            className="w-full flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs"
            style={{
              color: "hsl(var(--kf-error))",
              background: "hsl(var(--kf-error) / 0.08)",
              border: "1px solid hsl(var(--kf-error) / 0.3)",
            }}
          >
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <span>{refusal}</span>
          </p>
        )}
        {isDirty && (
          <p className="text-xs flex items-center gap-1" style={{ color: "hsl(var(--kf-warning))" }} role="status">
            <AlertCircle className="h-3 w-3" aria-hidden="true" />
            You have unsaved changes
          </p>
        )}
        <div className="ml-auto">
          <Button onClick={handleSave} disabled={saving || !isDirty} className="min-h-[44px]">
            {saving ? "Saving..." : "Save Business Info"}
          </Button>
        </div>
      </div>
    </div>
  );
}
