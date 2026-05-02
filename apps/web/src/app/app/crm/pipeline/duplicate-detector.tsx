"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  Copy,
  Merge,
  ChevronDown,
  ChevronUp,
  Mail,
  Phone,
  User,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { fetchDuplicateContacts, mergeContacts } from "@/lib/client";
import { MergeContactsModal } from "@/components/contacts/merge-contacts-modal";

interface DuplicateContact {
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

interface DuplicateGroup {
  field: string;
  value: string;
  contacts: DuplicateContact[];
}

interface DuplicateDetectorProps {
  businessId: string;
  onMergeComplete: () => void;
}

const FIELD_ICONS: Record<string, typeof Mail> = {
  email: Mail,
  phone: Phone,
  name: User,
};

const FIELD_LABELS: Record<string, string> = {
  email: "Same email",
  phone: "Same phone",
  name: "Similar name",
};

export function DuplicateDetector({ businessId, onMergeComplete }: DuplicateDetectorProps) {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [expandedGroupIdx, setExpandedGroupIdx] = useState<number | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeModal, setMergeModal] = useState<{ open: boolean; left: DuplicateContact | null; right: DuplicateContact | null }>({
    open: false, left: null, right: null,
  });

  const loadDuplicates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await fetchDuplicateContacts(businessId);
      if (data?.groups) setGroups(data.groups);
      else setGroups([]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load duplicates";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    loadDuplicates();
  }, [loadDuplicates]);

  const handleMerge = async (keepId: string, mergeId: string, fieldOverrides: Record<string, unknown>) => {
    setMerging(true);
    try {
      await mergeContacts({ businessId, contactId: keepId, duplicateId: mergeId, fieldOverrides });
      toast.success("Contacts merged successfully");
      setMergeModal({ open: false, left: null, right: null });
      await loadDuplicates();
      onMergeComplete();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to merge contacts";
      toast.error(message);
    } finally {
      setMerging(false);
    }
  };

  const formatName = (c: DuplicateContact) => {
    const name = `${c.firstName || ""} ${c.lastName || ""}`.trim();
    return name || c.email || "Unknown";
  };

  if (loading && groups.length === 0) return null;
  if (error) {
    return (
      <div className="kf-card border-[hsl(var(--kf-error))]/30 bg-[hsl(var(--kf-error))]/5 p-4 flex items-center gap-3">
        <AlertTriangle className="w-4 h-4 text-[hsl(var(--kf-error))]" />
        <span className="text-sm text-muted-foreground flex-1">Could not check for duplicates</span>
        <button onClick={loadDuplicates} className="kf-btn-secondary text-xs min-h-[44px] px-3 flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      </div>
    );
  }
  if (groups.length === 0) return null;

  const totalDuplicates = groups.reduce((sum, g) => sum + g.contacts.length - 1, 0);

  return (
    <div className="kf-card border-[hsl(var(--kf-warning))]/30 bg-[hsl(var(--kf-warning))]/5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center gap-3 text-left min-h-[44px]"
        aria-expanded={expanded}
        aria-label={`${totalDuplicates} potential duplicates found. Click to ${expanded ? "collapse" : "expand"}`}
      >
        <div className="w-8 h-8 rounded-lg bg-[hsl(var(--kf-warning))]/20 flex items-center justify-center flex-shrink-0">
          <Copy className="w-4 h-4 text-[hsl(var(--kf-warning))]" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium flex items-center gap-2">
            <span>{totalDuplicates} potential duplicate{totalDuplicates !== 1 ? "s" : ""} found</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[hsl(var(--kf-warning))]/20 text-[hsl(var(--kf-warning))]">
              {groups.length} group{groups.length !== 1 ? "s" : ""}
            </span>
            {loading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
          </div>
          <p className="text-xs text-muted-foreground">Review and merge duplicate contacts to keep your CRM clean</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); loadDuplicates(); }}
            className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-muted/50 transition-colors text-muted-foreground"
            aria-label="Refresh duplicates"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3">
              {groups.map((group, idx) => {
                const FieldIcon = FIELD_ICONS[group.field] || AlertTriangle;
                const fieldLabel = FIELD_LABELS[group.field] || group.field;
                const isExpanded = expandedGroupIdx === idx;

                return (
                  <div key={idx} className="border border-border/40 rounded-xl overflow-hidden">
                    <button
                      onClick={() => setExpandedGroupIdx(isExpanded ? null : idx)}
                      className="w-full p-3 flex items-center gap-3 hover:bg-muted/30 transition-colors text-left min-h-[44px]"
                      aria-expanded={isExpanded}
                      aria-label={`${fieldLabel}: ${group.value} — ${group.contacts.length} contacts`}
                    >
                      <FieldIcon className="w-4 h-4 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <span className="text-xs text-muted-foreground">{fieldLabel}: </span>
                        <span className="text-sm font-medium truncate">{group.value}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{group.contacts.length} contacts</span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0 }}
                          animate={{ height: "auto" }}
                          exit={{ height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="px-3 pb-3 space-y-2">
                            {group.contacts.map((contact, cIdx) => (
                              <div key={contact.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/20 min-h-[44px]">
                                <div className="w-8 h-8 rounded-full bg-[hsl(var(--kf-accent1))]/20 flex items-center justify-center text-xs font-semibold text-[hsl(var(--kf-accent1))]">
                                  {(contact.firstName?.[0] || "?").toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium truncate">{formatName(contact)}</div>
                                  <div className="text-xs text-muted-foreground truncate">
                                    {contact.email && <span>{contact.email}</span>}
                                    {contact.email && contact.phone && <span> · </span>}
                                    {contact.phone && <span>{contact.phone}</span>}
                                  </div>
                                </div>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${contact.status === "CLIENT" ? "bg-[hsl(var(--kf-success))]/20 text-[hsl(var(--kf-success))]" : contact.status === "PROSPECT" ? "bg-[hsl(var(--kf-info))]/20 text-[hsl(var(--kf-info))]" : "bg-[hsl(var(--kf-warning))]/20 text-[hsl(var(--kf-warning))]"}`}>
                                  {contact.status || "LEAD"}
                                </span>
                                {cIdx > 0 && (
                                  <button
                                    onClick={() => setMergeModal({
                                      open: true,
                                      left: group.contacts[0],
                                      right: contact,
                                    })}
                                    disabled={merging}
                                    className="text-xs px-3 min-h-[44px] rounded-lg bg-[hsl(var(--kf-accent2))]/10 hover:bg-[hsl(var(--kf-accent2))]/20 transition-colors flex items-center gap-1.5 disabled:opacity-50 text-[hsl(var(--kf-accent2))]"
                                  >
                                    {merging ? <Loader2 className="w-3 h-3 animate-spin" /> : <Merge className="w-3 h-3" />}
                                    Merge
                                  </button>
                                )}
                              </div>
                            ))}
                            <div className="text-[10px] text-muted-foreground/60 text-center pt-1">
                              Click Merge to review fields side-by-side before merging
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {mergeModal.open && mergeModal.left && mergeModal.right && (
        <MergeContactsModal
          open={mergeModal.open}
          left={mergeModal.left}
          right={mergeModal.right}
          onClose={() => setMergeModal({ open: false, left: null, right: null })}
          onMerge={handleMerge}
        />
      )}
    </div>
  );
}
