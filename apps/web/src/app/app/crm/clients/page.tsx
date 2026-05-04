"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  Loader2,
  User,
  Mail,
  Phone,
  Building2,
  ArrowLeft,
  X,
  UserPlus,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button, Badge } from "@keyflow/ui";
import { fetchContacts, createContact, type Contact } from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";

type SearchState = {
  query: string;
  loading: boolean;
  results: Contact[];
  error: string | null;
};

function displayNameOf(c: Contact): string {
  const full = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return c.displayName?.trim() || full || c.email?.trim() || c.phone?.trim() || "Unnamed contact";
}

function initialsOf(c: Contact): string {
  const name = displayNameOf(c);
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function ClientsSearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [businessId, setBusinessId] = useState<string | null>(null);

  const initialContactId = searchParams.get("contactId");
  const [selectedContactId, setSelectedContactId] = useState<string | null>(initialContactId);

  const [search, setSearch] = useState<SearchState>({
    query: "",
    loading: false,
    results: [],
    error: null,
  });
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setBusinessId(getStoredBusinessId());
  }, []);

  useEffect(() => {
    if (!selectedContactId && !addOpen) {
      inputRef.current?.focus();
    }
  }, [selectedContactId, addOpen]);

  const runSearch = useCallback(
    async (query: string) => {
      if (!businessId) return;
      if (abortRef.current) abortRef.current.abort();
      const trimmed = query.trim();
      if (trimmed.length === 0) {
        setSearch({ query: "", loading: false, results: [], error: null });
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setSearch((prev) => ({ ...prev, query, loading: true, error: null }));
      const { data, error } = await fetchContacts(businessId, {
        search: trimmed,
        take: 5,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setSearch({
        query,
        loading: false,
        results: data?.contacts ?? [],
        error,
      });
      setHighlightIdx(0);
    },
    [businessId],
  );

  const onChangeQuery = (value: string) => {
    setSearch((prev) => ({ ...prev, query: value, loading: value.trim().length > 0 }));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runSearch(value);
    }, 180);
  };

  const openContact = useCallback(
    (id: string) => {
      setSelectedContactId(id);
      const params = new URLSearchParams(searchParams.toString());
      params.set("contactId", id);
      router.replace(`/app/crm/clients?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const closeContact = useCallback(() => {
    setSelectedContactId(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("contactId");
    const qs = params.toString();
    router.replace(qs ? `/app/crm/clients?${qs}` : `/app/crm/clients`, { scroll: false });
  }, [router, searchParams]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (search.results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(search.results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = search.results[highlightIdx];
      if (c) openContact(c.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setSearch({ query: "", loading: false, results: [], error: null });
    }
  };

  const showResults = useMemo(() => search.query.trim().length > 0, [search.query]);

  if (selectedContactId) {
    return <ContactFullScreen contactId={selectedContactId} onBack={closeContact} />;
  }

  return (
    <div className="min-h-[calc(100vh-120px)] flex flex-col items-center px-4 pt-16 sm:pt-24">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-foreground">
            Find a client
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Search by name, email, phone, or company.
          </p>
        </div>

        <div className="relative flex items-stretch gap-2">
          <div className="relative flex-1">
            <div className="relative flex items-center">
              <Search className="absolute left-4 size-5 text-muted-foreground pointer-events-none" />
              <input
                ref={inputRef}
                type="text"
                autoFocus
                value={search.query}
                onChange={(e) => onChangeQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search clients…"
                className="w-full h-14 pl-12 pr-12 rounded-2xl bg-card border border-border text-base text-foreground placeholder:text-muted-foreground/60 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
              />
              {search.query && (
                <button
                  type="button"
                  onClick={() => onChangeQuery("")}
                  className="absolute right-4 size-6 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center transition"
                  aria-label="Clear search"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            {showResults && (
              <div className="absolute left-0 right-0 mt-2 rounded-2xl bg-card border border-border shadow-lg overflow-hidden z-10">
                {search.loading && search.results.length === 0 && (
                  <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Searching…
                  </div>
                )}
                {!search.loading && search.error && (
                  <div className="px-4 py-6 text-sm text-destructive text-center">
                    {search.error}
                  </div>
                )}
                {!search.loading && !search.error && search.results.length === 0 && (
                  <div className="px-4 py-6 text-sm text-muted-foreground text-center">
                    No clients match &ldquo;{search.query}&rdquo;
                  </div>
                )}
                {search.results.length > 0 && (
                  <ul className="divide-y divide-border">
                    {search.results.map((c, idx) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => openContact(c.id)}
                          onMouseEnter={() => setHighlightIdx(idx)}
                          className={`w-full flex items-center gap-3 px-4 py-3 text-left transition ${
                            idx === highlightIdx ? "bg-muted/60" : "hover:bg-muted/40"
                          }`}
                        >
                          <div className="size-10 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold flex-shrink-0">
                            {initialsOf(c)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-foreground truncate">
                                {displayNameOf(c)}
                              </span>
                              {c.status && (
                                <Badge tone="default" className="text-[10px] uppercase tracking-wide">
                                  {c.status}
                                </Badge>
                              )}
                            </div>
                            <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground truncate">
                              {c.email && (
                                <span className="flex items-center gap-1 truncate">
                                  <Mail className="size-3" />
                                  {c.email}
                                </span>
                              )}
                              {c.phone && (
                                <span className="flex items-center gap-1 truncate">
                                  <Phone className="size-3" />
                                  {c.phone}
                                </span>
                              )}
                              {c.companyName && (
                                <span className="flex items-center gap-1 truncate">
                                  <Building2 className="size-3" />
                                  {c.companyName}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="h-14 px-5 rounded-2xl bg-primary text-primary-foreground font-medium shadow-sm hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/40 transition flex items-center gap-2 flex-shrink-0"
            aria-label="Add new client"
          >
            <UserPlus className="size-5" />
            <span className="hidden sm:inline">Add client</span>
          </button>
        </div>

        {!showResults && (
          <div className="mt-10 text-center text-xs text-muted-foreground">
            Tip: use ↑ ↓ to move through results and press Enter to open.
          </div>
        )}
      </div>

      {addOpen && businessId && (
        <AddClientModal
          businessId={businessId}
          onClose={() => setAddOpen(false)}
          onCreated={(id) => {
            setAddOpen(false);
            openContact(id);
          }}
        />
      )}
    </div>
  );
}

function ContactFullScreen({ contactId, onBack }: { contactId: string; onBack: () => void }) {
  return (
    <div className="flex flex-col h-[calc(100vh-72px)]">
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-border bg-card">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4 mr-1" />
          Back to search
        </Button>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <User className="size-3" />
          Client detail
        </div>
      </div>
      <iframe
        key={contactId}
        src={`/app/crm/contacts/${encodeURIComponent(contactId)}`}
        className="flex-1 w-full border-0 bg-background"
        title="Client detail"
      />
    </div>
  );
}

type AddForm = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  companyName: string;
  jobTitle: string;
  status: string;
  source: string;
  segment: string;
  lifecycleStage: string;
  preferredChannel: string;
  whatsappNumber: string;
  secondaryEmail: string;
  secondaryPhone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  industry: string;
  department: string;
  language: string;
  timezone: string;
  notesInternal: string;
  tags: string;
  marketingOptIn: boolean;
  doNotContact: boolean;
};

const emptyForm: AddForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  companyName: "",
  jobTitle: "",
  status: "",
  source: "",
  segment: "",
  lifecycleStage: "",
  preferredChannel: "",
  whatsappNumber: "",
  secondaryEmail: "",
  secondaryPhone: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "",
  industry: "",
  department: "",
  language: "",
  timezone: "",
  notesInternal: "",
  tags: "",
  marketingOptIn: false,
  doNotContact: false,
};

function AddClientModal({
  businessId,
  onClose,
  onCreated,
}: {
  businessId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [form, setForm] = useState<AddForm>(emptyForm);
  const [expanded, setExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = <K extends keyof AddForm>(k: K, v: AddForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const canSubmit =
    form.firstName.trim().length > 0 ||
    form.lastName.trim().length > 0 ||
    form.email.trim().length > 0 ||
    form.phone.trim().length > 0;

  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    const tags = form.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const payload = {
      businessId,
      firstName: form.firstName.trim() || undefined,
      lastName: form.lastName.trim() || undefined,
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      companyName: form.companyName.trim() || undefined,
      jobTitle: form.jobTitle.trim() || undefined,
      status: form.status.trim() || undefined,
      source: form.source.trim() || undefined,
      segment: form.segment.trim() || undefined,
      lifecycleStage: form.lifecycleStage.trim() || undefined,
      preferredChannel: form.preferredChannel.trim() || undefined,
      whatsappNumber: form.whatsappNumber.trim() || undefined,
      secondaryEmail: form.secondaryEmail.trim() || undefined,
      secondaryPhone: form.secondaryPhone.trim() || undefined,
      addressLine1: form.addressLine1.trim() || undefined,
      addressLine2: form.addressLine2.trim() || undefined,
      city: form.city.trim() || undefined,
      state: form.state.trim() || undefined,
      postalCode: form.postalCode.trim() || undefined,
      country: form.country.trim() || undefined,
      industry: form.industry.trim() || undefined,
      department: form.department.trim() || undefined,
      language: form.language.trim() || undefined,
      timezone: form.timezone.trim() || undefined,
      notesInternal: form.notesInternal.trim() || undefined,
      tags: tags.length > 0 ? tags : undefined,
      marketingOptIn: form.marketingOptIn || undefined,
      doNotContact: form.doNotContact || undefined,
    };
    const { data, error: apiError } = await createContact(payload);
    setSubmitting(false);
    if (apiError || !data) {
      setError(apiError || "Could not create client. Please try again.");
      return;
    }
    onCreated(data.id);
  };

  const onFormKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-background/70 backdrop-blur-sm overflow-y-auto p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-card border border-border shadow-2xl my-auto"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onFormKeyDown}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <UserPlus className="size-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">
                {expanded ? "Add client — full details" : "Quick add client"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {expanded
                  ? "Fill any fields you have. You can edit later."
                  : "Just the basics. Switch to full details for more fields."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center transition"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4 max-h-[calc(100vh-220px)] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="First name">
              <input
                ref={firstRef}
                value={form.firstName}
                onChange={(e) => set("firstName", e.target.value)}
                placeholder="Jane"
                className={inputCls}
              />
            </Field>
            <Field label="Last name">
              <input
                value={form.lastName}
                onChange={(e) => set("lastName", e.target.value)}
                placeholder="Doe"
                className={inputCls}
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="jane@example.com"
                className={inputCls}
              />
            </Field>
            <Field label="Phone">
              <input
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="+1 868 555 1234"
                className={inputCls}
              />
            </Field>
          </div>

          {expanded && (
            <>
              <div className="pt-2 border-t border-border" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Company">
                  <input
                    value={form.companyName}
                    onChange={(e) => set("companyName", e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Job title">
                  <input
                    value={form.jobTitle}
                    onChange={(e) => set("jobTitle", e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Industry">
                  <input
                    value={form.industry}
                    onChange={(e) => set("industry", e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Department">
                  <input
                    value={form.department}
                    onChange={(e) => set("department", e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Status">
                  <input
                    value={form.status}
                    onChange={(e) => set("status", e.target.value)}
                    placeholder="lead, active, churned…"
                    className={inputCls}
                  />
                </Field>
                <Field label="Lifecycle stage">
                  <input
                    value={form.lifecycleStage}
                    onChange={(e) => set("lifecycleStage", e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Source">
                  <input
                    value={form.source}
                    onChange={(e) => set("source", e.target.value)}
                    placeholder="referral, website…"
                    className={inputCls}
                  />
                </Field>
                <Field label="Segment">
                  <input
                    value={form.segment}
                    onChange={(e) => set("segment", e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Preferred channel">
                  <input
                    value={form.preferredChannel}
                    onChange={(e) => set("preferredChannel", e.target.value)}
                    placeholder="email, sms, whatsapp…"
                    className={inputCls}
                  />
                </Field>
                <Field label="WhatsApp number">
                  <input
                    value={form.whatsappNumber}
                    onChange={(e) => set("whatsappNumber", e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Secondary email">
                  <input
                    type="email"
                    value={form.secondaryEmail}
                    onChange={(e) => set("secondaryEmail", e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Secondary phone">
                  <input
                    value={form.secondaryPhone}
                    onChange={(e) => set("secondaryPhone", e.target.value)}
                    className={inputCls}
                  />
                </Field>
              </div>

              <div className="pt-2 border-t border-border" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Address line 1">
                  <input
                    value={form.addressLine1}
                    onChange={(e) => set("addressLine1", e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Address line 2">
                  <input
                    value={form.addressLine2}
                    onChange={(e) => set("addressLine2", e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="City">
                  <input
                    value={form.city}
                    onChange={(e) => set("city", e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="State / region">
                  <input
                    value={form.state}
                    onChange={(e) => set("state", e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Postal code">
                  <input
                    value={form.postalCode}
                    onChange={(e) => set("postalCode", e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Country">
                  <input
                    value={form.country}
                    onChange={(e) => set("country", e.target.value)}
                    placeholder="Trinidad and Tobago"
                    className={inputCls}
                  />
                </Field>
                <Field label="Language">
                  <input
                    value={form.language}
                    onChange={(e) => set("language", e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Timezone">
                  <input
                    value={form.timezone}
                    onChange={(e) => set("timezone", e.target.value)}
                    placeholder="America/Port_of_Spain"
                    className={inputCls}
                  />
                </Field>
              </div>

              <Field label="Tags (comma separated)">
                <input
                  value={form.tags}
                  onChange={(e) => set("tags", e.target.value)}
                  placeholder="vip, retainer, q4-pipeline"
                  className={inputCls}
                />
              </Field>

              <Field label="Internal notes">
                <textarea
                  value={form.notesInternal}
                  onChange={(e) => set("notesInternal", e.target.value)}
                  rows={3}
                  className={`${inputCls} resize-y min-h-[72px]`}
                />
              </Field>

              <div className="flex flex-wrap gap-4 pt-1">
                <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.marketingOptIn}
                    onChange={(e) => set("marketingOptIn", e.target.checked)}
                    className="size-4 rounded border-border accent-primary"
                  />
                  Marketing opt-in
                </label>
                <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.doNotContact}
                    onChange={(e) => set("doNotContact", e.target.checked)}
                    className="size-4 rounded border-border accent-primary"
                  />
                  Do not contact
                </label>
              </div>
            </>
          )}

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border bg-muted/20 rounded-b-2xl">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 transition"
          >
            {expanded ? (
              <>
                <ChevronUp className="size-4" />
                Switch to quick add
              </>
            ) : (
              <>
                <ChevronDown className="size-4" />
                More fields
              </>
            )}
          </button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmit || submitting}
              className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <UserPlus className="size-4" />
                  {expanded ? "Create client" : "Quick add"}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full h-10 px-3 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-muted-foreground mb-1">{label}</span>
      {children}
    </label>
  );
}
