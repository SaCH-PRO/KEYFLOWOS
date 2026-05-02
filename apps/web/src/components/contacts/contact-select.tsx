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
import { getStoredBusinessId } from "@/lib/workspace";
import { moduleEvents } from "@/lib/module-events";
import { ContactChip } from "./contact-chip";

const STATUS_DOT: Record<string, string> = {
  CLIENT: "bg-emerald-500",
  PROSPECT: "bg-blue-500",
  LEAD: "bg-amber-500",
  LOST: "bg-red-500",
};

export interface ContactOption {
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
  onChange: (contactId: string, contact?: ContactOption) => void;
  contacts?: ContactOption[];
  placeholder?: string;
  label?: string;
  required?: boolean;
  allowQuickAdd?: boolean;
  disabled?: boolean;
  className?: string;
}

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

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selectedContact = useMemo(() => {
    if (!value) return null;
    const all = externalContacts ?? results;
    return all.find((c) => c.id === value) ?? null;
  }, [value, externalContacts, results]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowQuickAdd(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    setActiveIndex(-1);
  }, [search, results]);

  const handleSelect = useCallback(
    (contact: ContactOption) => {
      onChange(contact.id, contact);
      setOpen(false);
      setSearch("");
      setShowQuickAdd(false);
    },
    [onChange, setSearch],
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
    [open, results, activeIndex, handleSelect],
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
    try {
      const res = await createContact({
        businessId: businessId ?? undefined,
        firstName: quickAddForm.firstName.trim(),
        lastName: quickAddForm.lastName.trim() || undefined,
        email: quickAddForm.email.trim() || undefined,
        phone: quickAddForm.phone.trim() || undefined,
      });
      if (res.data) {
        handleSelect(res.data);
        setQuickAddForm({ firstName: "", lastName: "", email: "", phone: "" });
        moduleEvents.emit("contact:quick_created", "contact-select", {
          id: res.data.id,
          firstName: res.data.firstName,
          lastName: res.data.lastName,
          email: res.data.email,
        });
      }
    } catch {
      /* silent */
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
              {results.map((contact, idx) => {
                const name =
                  [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
                  contact.email ||
                  "Unknown";
                const initials =
                  ((contact.firstName?.[0] ?? "") + (contact.lastName?.[0] ?? "")).toUpperCase() ||
                  (contact.email?.[0]?.toUpperCase() ?? "?");
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
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                      style={{
                        background: "hsl(var(--kf-accent1) / 0.15)",
                        color: "hsl(var(--kf-accent1))",
                      }}
                    >
                      {initials}
                    </div>
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}
