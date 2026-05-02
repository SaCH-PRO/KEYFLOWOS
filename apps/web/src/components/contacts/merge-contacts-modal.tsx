"use client";

import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Merge,
  ArrowLeft,
  ArrowRight,
  Loader2,
  Mail,
  Phone,
  Building2,
  Briefcase,
  MapPin,
  Globe,
  Tag,
  User,
  Calendar,
  Hash,
  AlertTriangle,
} from "lucide-react";

interface MergeContact {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  displayName?: string | null;
  secondaryEmail?: string | null;
  secondaryPhone?: string | null;
  whatsappNumber?: string | null;
  preferredChannel?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  industry?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  timezone?: string | null;
  segment?: string | null;
  lifecycleStage?: string | null;
  language?: string | null;
  notesInternal?: string | null;
  sourceDetail?: string | null;
  status?: string;
  source?: string | null;
  tags?: string[];
  createdAt?: string | null;

  custom?: Record<string, unknown> | null;
}

interface MergeContactsModalProps {
  open: boolean;
  left: MergeContact;
  right: MergeContact;
  onClose: () => void;

  onMerge: (keepId: string, mergeId: string, fieldOverrides: Record<string, unknown>) => Promise<void>;
}

type FieldDef = {
  key: string;
  label: string;
  icon: typeof Mail;
};

const FIELDS: FieldDef[] = [
  { key: "firstName", label: "First Name", icon: User },
  { key: "lastName", label: "Last Name", icon: User },
  { key: "email", label: "Email", icon: Mail },
  { key: "phone", label: "Phone", icon: Phone },
  { key: "displayName", label: "Display Name", icon: User },
  { key: "companyName", label: "Company", icon: Building2 },
  { key: "jobTitle", label: "Job Title", icon: Briefcase },
  { key: "department", label: "Department", icon: Building2 },
  { key: "industry", label: "Industry", icon: Globe },
  { key: "city", label: "City", icon: MapPin },
  { key: "state", label: "State", icon: MapPin },
  { key: "country", label: "Country", icon: MapPin },
  { key: "timezone", label: "Timezone", icon: Globe },
  { key: "segment", label: "Segment", icon: Hash },
  { key: "lifecycleStage", label: "Lifecycle Stage", icon: Calendar },
  { key: "language", label: "Language", icon: Globe },
  { key: "preferredChannel", label: "Preferred Channel", icon: Mail },
  { key: "whatsappNumber", label: "WhatsApp", icon: Phone },
  { key: "secondaryEmail", label: "Secondary Email", icon: Mail },
  { key: "secondaryPhone", label: "Secondary Phone", icon: Phone },
  { key: "sourceDetail", label: "Source Detail", icon: Tag },
  { key: "notesInternal", label: "Internal Notes", icon: Tag },
];

const STATUS_COLORS: Record<string, string> = {
  LEAD: "bg-[hsl(var(--kf-warning))]/20 text-[hsl(var(--kf-warning))]",
  PROSPECT: "bg-[hsl(var(--kf-info))]/20 text-[hsl(var(--kf-info))]",
  CLIENT: "bg-[hsl(var(--kf-success))]/20 text-[hsl(var(--kf-success))]",
  LOST: "bg-[hsl(var(--kf-error))]/20 text-[hsl(var(--kf-error))]",
};

function formatName(c: MergeContact) {
  const name = `${c.firstName || ""} ${c.lastName || ""}`.trim();
  return name || c.displayName || c.email || "Unknown";
}

function getVal(contact: MergeContact, key: string): string | null | undefined {

  return (contact as unknown as Record<string, unknown>)[key] as string | null | undefined;
}

export function MergeContactsModal({ open, left, right, onClose, onMerge }: MergeContactsModalProps) {
  const [primarySide, setPrimarySide] = useState<"left" | "right">("left");
  const [fieldChoices, setFieldChoices] = useState<Record<string, "left" | "right">>({});
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  const primary = primarySide === "left" ? left : right;
  const duplicate = primarySide === "left" ? right : left;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open && !merging) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, merging, onClose]);

  const conflictFields = useMemo(() => {
    return FIELDS.filter((f) => {
      const lv = getVal(left, f.key);
      const rv = getVal(right, f.key);
      return lv && rv && lv !== rv;
    });
  }, [left, right]);

  const mergedTags = useMemo(() => {
    return Array.from(new Set([...(left.tags ?? []), ...(right.tags ?? [])]));
  }, [left, right]);

  const handleMerge = async () => {
    setMerging(true);
    setMergeError(null);
    try {

      const fieldOverrides: Record<string, unknown> = {};
      for (const [key, side] of Object.entries(fieldChoices)) {
        const chosen = side === "left" ? left : right;
        const val = getVal(chosen, key);
        if (val !== undefined) {
          fieldOverrides[key] = val;
        }
      }
      await onMerge(primary.id, duplicate.id, fieldOverrides);
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : "Merge failed. Please try again.");
    } finally {
      setMerging(false);
    }
  };

  const getResolvedValue = (key: string): { value: string | null | undefined; side: "left" | "right" } => {
    if (fieldChoices[key]) {
      return { value: getVal(fieldChoices[key] === "left" ? left : right, key), side: fieldChoices[key] };
    }
    const pv = getVal(primary, key);
    if (pv) return { value: pv, side: primarySide };
    const dv = getVal(duplicate, key);
    if (dv) return { value: dv, side: primarySide === "left" ? "right" : "left" };
    return { value: null, side: primarySide };
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="merge-title">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-background/60 backdrop-blur-sm"
          onClick={merging ? undefined : onClose}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="relative w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl border border-border/50 bg-background shadow-2xl flex flex-col"
        >
          <div className="flex items-center justify-between p-4 border-b border-border/30">
            <div className="flex items-center gap-2">
              <Merge className="w-5 h-5 text-[hsl(var(--kf-accent2))]" />
              <h2 className="text-lg font-semibold" id="merge-title">Merge Contacts</h2>
            </div>
            <button
              onClick={onClose}
              disabled={merging}
              className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-muted/50 transition-colors disabled:opacity-50"
              aria-label="Close merge dialog"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {([left, right] as const).map((contact, idx) => {
                const side = idx === 0 ? "left" : "right";
                const isPrimary = primarySide === side;
                return (
                  <button
                    key={contact.id}
                    onClick={() => setPrimarySide(side as "left" | "right")}
                    disabled={merging}
                    className={`p-4 rounded-xl border-2 transition-all text-left min-h-[44px] disabled:opacity-70 ${
                      isPrimary
                        ? "border-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1))]/5"
                        : "border-border/40 hover:border-border/60"
                    }`}
                    aria-pressed={isPrimary}
                    aria-label={`${isPrimary ? "Keep" : "Merge"} ${formatName(contact)}`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-full bg-[hsl(var(--kf-accent1))]/20 flex items-center justify-center text-sm font-bold text-[hsl(var(--kf-accent1))]">
                        {(contact.firstName?.[0] || "?").toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{formatName(contact)}</div>
                        <div className="text-xs text-muted-foreground truncate">{contact.email || "No email"}</div>
                      </div>
                      {isPrimary && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[hsl(var(--kf-accent1))]/20 font-medium text-[hsl(var(--kf-accent1))]">
                          Keep
                        </span>
                      )}
                      {!isPrimary && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[hsl(var(--kf-error))]/20 text-[hsl(var(--kf-error))] font-medium">
                          Merge
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className={`px-1.5 py-0.5 rounded-full ${STATUS_COLORS[contact.status || "LEAD"] || STATUS_COLORS.LEAD}`}>
                        {contact.status || "LEAD"}
                      </span>
                      {contact.phone && <span>{contact.phone}</span>}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="text-xs text-muted-foreground text-center flex items-center gap-2 justify-center">
              <ArrowLeft className="w-3 h-3" />
              Click a contact card to choose which one to keep
              <ArrowRight className="w-3 h-3" />
            </div>

            {conflictFields.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">Conflicting Fields — Choose which value to keep</h3>
                <div className="space-y-1">
                  {conflictFields.map((field) => {
                    const leftVal = getVal(left, field.key);
                    const rightVal = getVal(right, field.key);
                    const resolved = getResolvedValue(field.key);
                    const Icon = field.icon;

                    return (
                      <div key={field.key} className="grid grid-cols-[120px_1fr_1fr] gap-2 items-center">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Icon className="w-3 h-3" />
                          <span className="truncate">{field.label}</span>
                        </div>
                        <button
                          onClick={() => setFieldChoices((p) => ({ ...p, [field.key]: "left" }))}
                          disabled={merging}
                          className={`text-left text-xs p-2 min-h-[44px] rounded-lg border transition-all truncate disabled:opacity-70 ${
                            resolved.side === "left"
                              ? "border-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1))]/10"
                              : "border-border/30 hover:border-border/60"
                          }`}
                          aria-pressed={resolved.side === "left"}
                        >
                          {leftVal || "—"}
                        </button>
                        <button
                          onClick={() => setFieldChoices((p) => ({ ...p, [field.key]: "right" }))}
                          disabled={merging}
                          className={`text-left text-xs p-2 min-h-[44px] rounded-lg border transition-all truncate disabled:opacity-70 ${
                            resolved.side === "right"
                              ? "border-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1))]/10"
                              : "border-border/30 hover:border-border/60"
                          }`}
                          aria-pressed={resolved.side === "right"}
                        >
                          {rightVal || "—"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {mergedTags.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="text-sm font-medium text-muted-foreground">Merged Tags (union)</h3>
                <div className="flex flex-wrap gap-1.5">
                  {mergedTags.map((tag) => (
                    <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-[hsl(var(--kf-accent2))]/15 font-medium text-[hsl(var(--kf-accent2))]">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl bg-muted/20 p-3 space-y-1.5">
              <h3 className="text-sm font-medium">What happens during merge</h3>
              <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                <li>All notes, tasks, events, and sequence enrollments transfer to the kept contact</li>
                <li>All invoices, quotes, and bookings transfer to the kept contact</li>
                <li>Tags are combined from both contacts</li>
                <li>The higher lead score is preserved</li>
                <li>Empty fields on the kept contact are filled from the merged contact</li>
                <li>The merged contact is soft-deleted</li>
              </ul>
            </div>

            {mergeError && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-[hsl(var(--kf-error))]/10 border border-[hsl(var(--kf-error))]/30">
                <AlertTriangle className="w-4 h-4 text-[hsl(var(--kf-error))] flex-shrink-0" />
                <span className="text-sm text-[hsl(var(--kf-error))]">{mergeError}</span>
              </div>
            )}
          </div>

          <div className="p-4 border-t border-border/30 flex items-center justify-between">
            <button
              onClick={onClose}
              disabled={merging}
              className="px-4 min-h-[44px] text-sm rounded-lg hover:bg-muted/50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleMerge}
              disabled={merging}
              className="px-4 min-h-[44px] text-sm rounded-lg bg-[hsl(var(--kf-accent2))] text-foreground hover:opacity-90 transition-opacity flex items-center gap-2 disabled:opacity-50"
            >
              {merging ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Merging...
                </>
              ) : (
                <>
                  <Merge className="w-4 h-4" />
                  Merge into {formatName(primary)}
                </>
              )}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
