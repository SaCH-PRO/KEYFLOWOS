"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type KeyboardEvent,
} from "react";
import { Search, Plus, Loader2, ChevronDown } from "lucide-react";
import { useContactSearch } from "@/hooks/use-contact-search";
import { createContact } from "@/lib/client";
import { apiGet } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { moduleEvents } from "@/lib/module-events";
import { useRefusal, answerFromThrown } from "@/lib/failure-kit";
import { ContactChip } from "./contact-chip";
import { ContactAvatar } from "./contact-avatar";

const STATUS_DOT: Record<string, string> = {
  CLIENT: "bg-emerald-500",
  PROSPECT: "bg-blue-500",
  LEAD: "bg-amber-500",
  LOST: "bg-red-500",
};

export interface ContactSelectItem {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  status?: string;
  tags?: string[];
}

interface ContactSelectProps {
  value: string;
  onChange: (contactId: string, contact?: ContactSelectItem) => void;
  contacts?: ContactSelectItem[];
  placeholder?: string;
  label?: string;
  required?: boolean;
  allowQuickAdd?: boolean;
  disabled?: boolean;
  className?: string;
  /** SWP-QUOTE-COMPOSER-CONTACT (BUG-095): a field error from the form (e.g. "Choose a client"), said under the field. */
  error?: string | null;
  /**
   * The parent's contact list is still loading: a value it may yet hold is not read by id until it has arrived
   * (WEDGE-WA-INBOUND-CAPTURE review NEW-2).
   */
  contactsLoading?: boolean;
  /**
   * The value was loaded from a saved record (editing a quote, invoice or schedule): it is never cleared, whatever a
   * read by id answers (review security NEW-1: a member with revenue write and no crm read is refused that read).
   */
  savedRecord?: boolean;
}

/** What the read by id of a value in no loaded list came to, when it did not show the customer. */
type UnresolvedRead = { id: string; kind: "unavailable" | "no-access" | "not-found" };

export function ContactSelect({
  value,
  onChange,
  contacts: externalContacts,
  placeholder = "Search contacts…",
  label,
  required = false,
  allowQuickAdd = true,
  disabled = false,
  className = "",
  error = null,
  contactsLoading = false,
  savedRecord = false,
}: ContactSelectProps) {
  const businessId = getStoredBusinessId();
  const { results, search, setSearch, loading } = useContactSearch({
    businessId,
    initialContacts: externalContacts,
  });

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddForm, setQuickAddForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
  });
  const [quickAddLoading, setQuickAddLoading] = useState(false);
  // BUG-097: a refused quick add (a duplicate phone's 409, a missing scope) is said, and the form keeps what was typed.
  const { refused, message: quickAddError, clear: clearQuickAddError } = useRefusal();
  // BUG-096: the contact last chosen here, so a quick-added one (in neither the parent's list nor the search
  // results) still shows as chosen.
  const [picked, setPicked] = useState<ContactSelectItem | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // WEDGE-WA-INBOUND-CAPTURE review repairs COR-2 / SEC-WAW-2, and round 2 (NEW-1, NEW-2, security NEW-1): a value in
  // no loaded list (a customer chosen by a door such as + New > From WhatsApp's ?contactId=, older than the page the
  // screen loaded) is read by id (GET /crm/businesses/:b/contacts/:id, the member's own visibility applies; lib/api's
  // apiGet, which keeps the status) and shown. The rule:
  //   - only the server's word that this member cannot have this customer clears the value: a 403 or 404, or a reply
  //     naming another id; and never a value loaded from a saved record (savedRecord), which is kept and said;
  //   - any other failure (network, 429, 5xx, an unreadable reply) keeps the value and says the customer could not
  //     be loaded, with a retry;
  //   - nothing is read while the parent's list is loading; a list that holds the value shows it from the list.
  const [resolved, setResolved] = useState<ContactSelectItem | null>(null);
  const [unresolved, setUnresolved] = useState<UnresolvedRead | null>(null);
  const [readAttempt, setReadAttempt] = useState(0);

  const listed = useMemo<ContactSelectItem | null>(() => {
    if (!value) return null;
    const all = (externalContacts ?? results) as ContactSelectItem[];
    return all.find((c) => c.id === value) ?? (picked?.id === value ? picked : null);
  }, [value, externalContacts, results, picked]);

  const selectedContact = listed ?? (resolved?.id === value ? resolved : null);
  const unresolvedNow = !listed && unresolved?.id === value ? unresolved : null;
  const needsRead = Boolean(value) && !contactsLoading && !listed && resolved?.id !== value && !unresolvedNow;

  useEffect(() => {
    if (!needsRead || !businessId) return;
    let cancelled = false;
    const id = value;
    const keep = (kind: UnresolvedRead["kind"]) => {
      if (!cancelled) setUnresolved({ id, kind });
    };
    const clearOrKeep = (kind: UnresolvedRead["kind"]) => {
      if (cancelled) return;
      if (savedRecord) keep(kind);
      else onChange("", undefined);
    };
    apiGet<{ contact?: Partial<ContactSelectItem> & { id?: unknown } }>(
      `/crm/businesses/${encodeURIComponent(businessId)}/contacts/${encodeURIComponent(id)}`,
    )
      .then((res) => {
        if (cancelled) return;
        if (res.error !== null && res.error !== undefined) {
          if (res.status === 404) return clearOrKeep("not-found");
          if (res.status === 403) return clearOrKeep("no-access");
          return keep("unavailable");
        }
        const contact = res.data?.contact;
        if (!contact || typeof contact.id !== "string") return keep("unavailable");
        if (contact.id !== id) return clearOrKeep("not-found");
        setResolved({
          id: contact.id,
          firstName: contact.firstName ?? null,
          lastName: contact.lastName ?? null,
          email: contact.email ?? null,
          phone: contact.phone ?? null,
          status: contact.status,
          tags: contact.tags,
        });
      })
      .catch(() => keep("unavailable"));
    return () => {
      cancelled = true;
    };
    // onChange is the parent's setter; reading again for a new callback identity would repeat the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsRead, value, businessId, savedRecord, readAttempt]);

  const retryRead = useCallback(() => {
    setUnresolved(null);
    setReadAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowQuickAdd(false);
        clearQuickAddError();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [clearQuickAddError]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [search, results]);

  const handleSelect = useCallback(
    (contact: ContactSelectItem) => {
      setPicked(contact);
      onChange(contact.id, contact);
      setOpen(false);
      setSearch("");
      setShowQuickAdd(false);
      clearQuickAddError();
    },
    [onChange, setSearch, clearQuickAddError],
  );

  const handleClear = useCallback(() => {
    onChange("", undefined);
    setSearch("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [onChange, setSearch]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        setOpen(false);
        setShowQuickAdd(false);
        clearQuickAddError();
        return;
      }
      if (!open) {
        if (e.key === "ArrowDown" || e.key === "Enter") {
          setOpen(true);
          e.preventDefault();
        }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < results.length) {
          handleSelect(results[activeIndex]);
        }
      }
    },
    [open, results, activeIndex, handleSelect, clearQuickAddError],
  );

  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const item = listRef.current.children[activeIndex] as HTMLElement;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  const handleQuickAdd = async () => {
    if (!quickAddForm.firstName.trim()) return;
    setQuickAddLoading(true);
    clearQuickAddError();
    try {
      const res = await createContact({
        businessId: businessId ?? undefined,
        firstName: quickAddForm.firstName.trim(),
        lastName: quickAddForm.lastName.trim() || undefined,
        email: quickAddForm.email.trim() || undefined,
        phone: quickAddForm.phone.trim() || undefined,
      });
      if (refused(res, { what: "add this customer" })) return;
      if (res.data) {
        handleSelect(res.data as ContactSelectItem);
        setQuickAddForm({ firstName: "", lastName: "", email: "", phone: "" });
        moduleEvents.emit("contact:quick_created", "contact-select", {
          id: res.data.id,
          firstName: res.data.firstName,
          lastName: res.data.lastName,
          email: res.data.email,
        });
      }
    } catch (err) {
      refused(answerFromThrown(err), { what: "add this customer" });
    } finally {
      setQuickAddLoading(false);
    }
  };

  const dropdownId = "contact-select-listbox";

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {label && (
        <label className="block text-xs font-medium text-muted-foreground mb-1">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}

      {selectedContact && !open ? (
        <div className="flex items-center gap-2">
          <ContactChip
            contact={selectedContact}
            size="md"
            showStatus
            removable
            onRemove={handleClear}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setOpen(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Change
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={open}
            aria-controls={dropdownId}
            aria-activedescendant={
              activeIndex >= 0 ? `contact-option-${activeIndex}` : undefined
            }
            aria-autocomplete="list"
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (!open) setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            className="kf-input w-full pl-9 pr-8 text-sm"
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setOpen(!open)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      )}

      {unresolvedNow && (
        <p role="status" className="mt-1 text-xs text-muted-foreground">
          {unresolvedNow.kind === "unavailable"
            ? "A customer is chosen, but we couldn't load this customer's name. "
            : unresolvedNow.kind === "no-access"
              ? "This record's customer stays chosen, but you can't see this customer's details. "
              : "This record's customer stays chosen, but they could not be found. "}
          {unresolvedNow.kind === "unavailable" && (
            <button type="button" onClick={retryRead} className="underline hover:text-foreground">
              Retry
            </button>
          )}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-1 text-xs text-red-500">{error}</p>
      )}

      {open && (
        <div className="absolute z-50 mt-1 w-full kf-card-glass border border-border rounded-xl shadow-lg overflow-hidden">
          {loading && (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          )}

          {!loading && results.length === 0 && !showQuickAdd && (
            <div className="py-4 text-center text-xs text-muted-foreground">
              No contacts found
            </div>
          )}

          {!loading && results.length > 0 && (
            <ul
              ref={listRef}
              id={dropdownId}
              role="listbox"
              className="max-h-48 overflow-y-auto py-1"
            >
              {(results as ContactSelectItem[]).map((contact, idx) => {
                const name =
                  [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
                  contact.email ||
                  "Unknown";
                const isActive = idx === activeIndex;
                const isSelected = contact.id === value;
                return (
                  <li
                    key={contact.id}
                    id={`contact-option-${idx}`}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(contact)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
                      isActive ? "bg-muted" : "hover:bg-muted/50"
                    } ${isSelected ? "bg-muted/70" : ""}`}
                  >
                    <ContactAvatar contact={contact} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{name}</p>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        {contact.email && <span className="truncate">{contact.email}</span>}
                        {contact.phone && <span className="truncate">{contact.phone}</span>}
                      </div>
                    </div>
                    {contact.status && (
                      <span
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          STATUS_DOT[contact.status] ?? "bg-gray-400"
                        }`}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {allowQuickAdd && !showQuickAdd && (
            <button
              type="button"
              onClick={() => setShowQuickAdd(true)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium border-t border-border transition-colors hover:bg-muted/50"
              style={{ color: "hsl(var(--kf-accent1))" }}
            >
              <Plus className="w-3.5 h-3.5" />
              Quick Add Contact
            </button>
          )}

          {showQuickAdd && (
            <div className="border-t border-border p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">New Contact</p>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="First name *"
                  value={quickAddForm.firstName}
                  onChange={(e) =>
                    setQuickAddForm((f) => ({ ...f, firstName: e.target.value }))
                  }
                  className="kf-input text-xs"
                  autoFocus
                />
                <input
                  type="text"
                  placeholder="Last name"
                  value={quickAddForm.lastName}
                  onChange={(e) =>
                    setQuickAddForm((f) => ({ ...f, lastName: e.target.value }))
                  }
                  className="kf-input text-xs"
                />
              </div>
              <input
                type="email"
                placeholder="Email"
                value={quickAddForm.email}
                onChange={(e) =>
                  setQuickAddForm((f) => ({ ...f, email: e.target.value }))
                }
                className="kf-input text-xs w-full"
              />
              <input
                type="tel"
                placeholder="Phone"
                value={quickAddForm.phone}
                onChange={(e) =>
                  setQuickAddForm((f) => ({ ...f, phone: e.target.value }))
                }
                className="kf-input text-xs w-full"
              />
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowQuickAdd(false);
                    setQuickAddForm({ firstName: "", lastName: "", email: "", phone: "" });
                    clearQuickAddError();
                  }}
                  className="flex-1 text-xs py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleQuickAdd}
                  disabled={!quickAddForm.firstName.trim() || quickAddLoading}
                  className="flex-1 text-xs py-1.5 rounded-lg text-white transition-colors disabled:opacity-50"
                  style={{ background: "hsl(var(--kf-accent1))" }}
                >
                  {quickAddLoading ? (
                    <Loader2 className="w-3 h-3 animate-spin mx-auto" />
                  ) : (
                    "Add & Select"
                  )}
                </button>
              </div>
              {quickAddError && (
                <p role="alert" className="text-xs text-red-500">{quickAddError}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
