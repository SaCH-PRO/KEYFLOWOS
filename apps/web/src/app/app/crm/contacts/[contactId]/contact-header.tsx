"use client";

import { useState, useRef, useEffect } from "react";
import { useParams } from "next/navigation";
import { updateContact } from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import { Mail, Phone, MapPin, Star, ChevronDown, Check, ShieldOff, SearchX, AlertTriangle } from "lucide-react";
import { CONTACT_STATUSES } from "@/lib/crm-constants";
import { toast } from "sonner";
import { useContactDetailContext } from "./contact-detail-context";
import { ContactAvatar } from "@/components/contacts/contact-avatar";
import { classifyContactsLoadError } from "@/app/app/crm/pipeline/hooks/use-contacts-data";

const STATUS_OPTIONS = CONTACT_STATUSES;

/**
 * CONTACTS-v1 section 5: when the record cannot be shown, say why. A refusal
 * (403, or a 401 the token refresh could not rescue) is a denial, a 404 is
 * "not found", anything else is a failed load; none of them is an empty
 * record. Rendered by the header because the layout mounts it on every tab.
 */
function ContactUnavailableState({ error }: { error: string | null }) {
  // No error but no contact means the server answered with no record.
  const failure = classifyContactsLoadError(error) ?? "not_found";

  if (failure === "denied") {
    return (
      <div role="alert" data-testid="contact-unavailable" data-state="denied" className="rounded-xl border border-border/50 bg-card/50 p-6 mb-4 text-center">
        <ShieldOff className="mx-auto mb-2 h-5 w-5 text-amber-500" />
        <h1 className="text-base font-semibold">You do not have access to this contact</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your account is not permitted to view this record in this workspace. Ask the workspace owner for access.
        </p>
      </div>
    );
  }

  if (failure === "not_found") {
    return (
      <div role="status" data-testid="contact-unavailable" data-state="not_found" className="rounded-xl border border-border/50 bg-card/50 p-6 mb-4 text-center">
        <SearchX className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
        <h1 className="text-base font-semibold">Contact not found</h1>
        <p className="mt-1 text-sm text-muted-foreground">It may have been deleted, or the link may be wrong.</p>
      </div>
    );
  }

  return (
    <div role="alert" data-testid="contact-unavailable" data-state="failed" className="rounded-xl border border-border/50 bg-card/50 p-6 mb-4 text-center">
      <AlertTriangle className="mx-auto mb-2 h-5 w-5 text-red-400" />
      <h1 className="text-base font-semibold">Could not load this contact</h1>
      <p className="mt-1 text-sm text-muted-foreground">{error}</p>
    </div>
  );
}

export default function ContactHeader() {
  const { contactId } = useParams();
  const { contact, detail, loading, error } = useContactDetailContext();
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setStatusMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const handleStatusChange = async (newStatus: string) => {
    if (!contact || newStatus === contact.status) {
      setStatusMenuOpen(false);
      return;
    }
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    setUpdatingStatus(true);
    try {
      const res = await updateContact({ businessId, contactId: contactId as string, status: newStatus });
      if (res.error) throw new Error(res.error);
      toast.success(`Status updated to ${newStatus}`);
    } catch {
      toast.error("Failed to update status");
    } finally {
      setUpdatingStatus(false);
      setStatusMenuOpen(false);
    }
  };

  if (loading) return <div className="h-16 border-b animate-pulse bg-muted/30" />;
  if (!contact) return <ContactUnavailableState error={error} />;

  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Unnamed Contact";
  const score = detail?.meta?.leadScore ?? 0;
  const scoreColor = score >= 80 ? "bg-green-100 text-green-800" : score >= 60 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800";

  return (
    <div className="rounded-xl border border-border/50 bg-card/50 p-4 mb-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <ContactAvatar contact={contact} size="md" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">{name}</h1>
              {contact.favorite && <Star className="h-4 w-4 fill-amber-400 text-amber-400" />}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {contact.status && (
                <div className="relative" ref={menuRef}>
                  <button
                    onClick={() => setStatusMenuOpen((p) => !p)}
                    disabled={updatingStatus}
                    className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                  >
                    {updatingStatus ? "Saving…" : contact.status}
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  {statusMenuOpen && (
                    <div className="absolute left-0 top-full z-50 mt-1 min-w-[140px] rounded-lg border border-border/50 bg-card shadow-xl overflow-hidden">
                      {STATUS_OPTIONS.map((s) => (
                        <button
                          key={s}
                          onClick={() => handleStatusChange(s)}
                          className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-muted/50 transition-colors ${s === contact.status ? "bg-primary/5 font-medium text-primary" : ""}`}
                        >
                          {s}
                          {s === contact.status && <Check className="h-3 w-3 text-primary" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {contact.email && (
                <span className="flex items-center gap-1">
                  <Mail className="h-3 w-3" />
                  {contact.email}
                </span>
              )}
              {contact.phone && (
                <span className="flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  {contact.phone}
                </span>
              )}
              {(contact.city || contact.country) && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {[contact.city, contact.country].filter(Boolean).join(", ")}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {detail?.meta?.leadScore != null && (
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${scoreColor}`}>
              Score: {score}
            </span>
          )}
          {contact.tags && contact.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {contact.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
