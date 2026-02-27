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
  X,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { fetchDuplicateContacts, mergeContacts } from "@/lib/client";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface DuplicateContact {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  status?: string;
  createdAt?: string;
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
  const [expanded, setExpanded] = useState(false);
  const [expandedGroupIdx, setExpandedGroupIdx] = useState<number | null>(null);
  const [merging, setMerging] = useState(false);
  const [confirmMerge, setConfirmMerge] = useState<{ open: boolean; primaryId: string; duplicateId: string; primaryName: string; dupName: string }>({
    open: false, primaryId: "", duplicateId: "", primaryName: "", dupName: "",
  });

  const loadDuplicates = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await fetchDuplicateContacts(businessId);
      if (data?.groups) setGroups(data.groups);
    } catch {}
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    loadDuplicates();
  }, [loadDuplicates]);

  const handleMerge = async (primaryId: string, duplicateId: string) => {
    setMerging(true);
    try {
      await mergeContacts({ businessId, contactId: primaryId, duplicateId });
      toast.success("Contacts merged successfully");
      await loadDuplicates();
      onMergeComplete();
    } catch {
      toast.error("Failed to merge contacts");
    }
    setMerging(false);
  };

  const formatName = (c: DuplicateContact) => {
    const name = `${c.firstName || ""} ${c.lastName || ""}`.trim();
    return name || c.email || "Unknown";
  };

  if (loading) return null;
  if (groups.length === 0) return null;

  const totalDuplicates = groups.reduce((sum, g) => sum + g.contacts.length - 1, 0);

  return (
    <div className="kf-card border-amber-500/30 bg-amber-500/5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center gap-3 text-left"
      >
        <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
          <Copy className="w-4 h-4 text-amber-400" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium flex items-center gap-2">
            <span>{totalDuplicates} potential duplicate{totalDuplicates !== 1 ? "s" : ""} found</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
              {groups.length} group{groups.length !== 1 ? "s" : ""}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">Review and merge duplicate contacts to keep your CRM clean</p>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
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
                      className="w-full p-3 flex items-center gap-3 hover:bg-muted/30 transition-colors text-left"
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
                              <div key={contact.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/20">
                                <div className="w-8 h-8 rounded-full bg-[hsl(var(--kf-accent1))]/20 flex items-center justify-center text-xs font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>
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
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${contact.status === "CLIENT" ? "bg-emerald-500/20 text-emerald-400" : contact.status === "PROSPECT" ? "bg-blue-500/20 text-blue-400" : "bg-amber-500/20 text-amber-400"}`}>
                                  {contact.status || "LEAD"}
                                </span>
                                {cIdx > 0 && (
                                  <button
                                    onClick={() => setConfirmMerge({
                                      open: true,
                                      primaryId: group.contacts[0].id,
                                      duplicateId: contact.id,
                                      primaryName: formatName(group.contacts[0]),
                                      dupName: formatName(contact),
                                    })}
                                    disabled={merging}
                                    className="text-xs px-2 py-1 rounded-lg bg-[hsl(var(--kf-accent2))]/10 hover:bg-[hsl(var(--kf-accent2))]/20 transition-colors flex items-center gap-1 disabled:opacity-50"
                                    style={{ color: "hsl(var(--kf-accent2))" }}
                                  >
                                    <Merge className="w-3 h-3" />
                                    Merge
                                  </button>
                                )}
                              </div>
                            ))}
                            <div className="text-[10px] text-muted-foreground/60 text-center pt-1">
                              First contact is kept as primary during merge
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

      <ConfirmDialog
        open={confirmMerge.open}
        title="Merge Contacts"
        message={`Merge "${confirmMerge.dupName}" into "${confirmMerge.primaryName}"? All notes, tasks, invoices, and bookings will be transferred to the primary contact. This cannot be undone.`}
        confirmLabel={merging ? "Merging..." : "Merge"}
        variant="danger"
        onConfirm={() => { handleMerge(confirmMerge.primaryId, confirmMerge.duplicateId); setConfirmMerge((s) => ({ ...s, open: false })); }}
        onCancel={() => setConfirmMerge((s) => ({ ...s, open: false }))}
      />
    </div>
  );
}
