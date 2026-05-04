"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Loader2, User, Mail, Phone, Building2, ArrowLeft, X } from "lucide-react";
import { Button, Badge } from "@keyflow/ui";
import { fetchContacts, type Contact } from "@/lib/client";
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
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setBusinessId(getStoredBusinessId());
  }, []);

  useEffect(() => {
    if (!selectedContactId) {
      inputRef.current?.focus();
    }
  }, [selectedContactId]);

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

        <div className="relative">
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

        {!showResults && (
          <div className="mt-10 text-center text-xs text-muted-foreground">
            Tip: use ↑ ↓ to move through results and press Enter to open.
          </div>
        )}
      </div>
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
