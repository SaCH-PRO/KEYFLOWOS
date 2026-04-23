"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence, type PanInfo } from "framer-motion";
import {
  X,
  Search,
  Users,
  Tag,
  Filter,
  CheckSquare,
  Square,
  Send,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { fetchContacts } from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import { getContactPhone } from "@/lib/whatsapp";
import type { ContactCardData } from "./contact-card";
import { BroadcastDrawer } from "./broadcast-drawer";

const STATUSES = ["ALL", "LEAD", "PROSPECT", "CLIENT", "LOST"] as const;

interface ContactPickerDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ContactPickerDrawer({ isOpen, onClose }: ContactPickerDrawerProps) {
  const [contacts, setContacts] = useState<ContactCardData[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showTagFilter, setShowTagFilter] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBroadcast, setShowBroadcast] = useState(false);

  const businessId = getStoredBusinessId();

  const loadContacts = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetchContacts(businessId, {
        status: statusFilter === "ALL" ? undefined : statusFilter,
        search: search.trim() || undefined,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
        take: 200,
      });
      if (res.data?.contacts) {
        setContacts(res.data.contacts as ContactCardData[]);
        const tags = new Set<string>();
        res.data.contacts.forEach((c: any) => c.tags?.forEach((t: string) => tags.add(t)));
        setAvailableTags((prev) => {
          const merged = new Set([...prev, ...tags]);
          return Array.from(merged).sort();
        });
      }
    } catch {}
    setLoading(false);
  }, [businessId, statusFilter, search, selectedTags]);

  useEffect(() => {
    if (isOpen) {
      loadContacts();
    }
  }, [isOpen, loadContacts]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedIds(new Set());
      setSearch("");
      setStatusFilter("ALL");
      setSelectedTags([]);
      setShowTagFilter(false);
    }
  }, [isOpen]);

  const toggleContact = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === contacts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(contacts.map((c) => c.id)));
    }
  };

  const toggleTagFilter = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const selectedContacts = contacts.filter((c) => selectedIds.has(c.id));

  const handleOpenBroadcast = () => {
    if (selectedContacts.length === 0) return;
    setShowBroadcast(true);
  };

  if (!isOpen) return null;

  if (showBroadcast) {
    return (
      <BroadcastDrawer
        isOpen={true}
        selectedContacts={selectedContacts}
        onClose={() => {
          setShowBroadcast(false);
          onClose();
        }}
        onDeselectAll={() => {
          setSelectedIds(new Set());
          setShowBroadcast(false);
          onClose();
        }}
      />
    );
  }

  const contactsWithPhone = contacts.filter((c) => getContactPhone(c));
  const contactsWithEmail = contacts.filter((c) => c.email);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end md:items-center justify-center"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 25 }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.6 }}
          onDragEnd={(_: any, info: PanInfo) => {
            if (info.offset.y > 100 || info.velocity.y > 500) onClose();
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-full md:max-w-2xl md:mx-4 max-h-[90vh] flex flex-col rounded-t-2xl md:rounded-2xl kf-card border-t md:border border-border"
        >
          <button
            onClick={onClose}
            className="w-full flex items-center justify-center py-2 cursor-pointer active:bg-muted/30 transition-colors md:hidden flex-shrink-0"
            aria-label="Close drawer"
          >
            <div className="w-12 h-1 bg-muted-foreground/40 rounded-full" />
          </button>
          <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0" style={{ background: "hsl(var(--kf-sidebar-bg))" }}>
            <div className="flex items-center gap-3">
              <div
                className="h-10 w-10 rounded-xl flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
              >
                <Users className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-semibold">Select Contacts</h3>
                <p className="text-xs text-muted-foreground">
                  {selectedIds.size > 0
                    ? `${selectedIds.size} selected`
                    : `${contacts.length} contacts`}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-colors">
              <X className="w-5 h-5 text-muted-foreground" />
            </button>
          </div>

          <div className="p-3 space-y-2 border-b border-border flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search contacts..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="kf-input w-full pl-9 text-sm"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                    statusFilter === s
                      ? "text-white"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                  style={statusFilter === s ? { background: "hsl(var(--kf-accent1))" } : {}}
                >
                  {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
                </button>
              ))}

              <button
                onClick={() => setShowTagFilter(!showTagFilter)}
                className={`text-xs px-2.5 py-1 rounded-full flex items-center gap-1 transition-colors ${
                  selectedTags.length > 0
                    ? "text-white"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
                style={selectedTags.length > 0 ? { background: "hsl(var(--kf-accent2))" } : {}}
              >
                <Tag className="w-3 h-3" />
                Tags {selectedTags.length > 0 && `(${selectedTags.length})`}
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>

            <AnimatePresence>
              {showTagFilter && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {availableTags.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-1">No tags found. Tag your contacts in the CRM to filter by tags.</p>
                    ) : (
                      availableTags.map((tag) => (
                        <button
                          key={tag}
                          onClick={() => toggleTagFilter(tag)}
                          className={`text-xs px-2 py-1 rounded-lg transition-colors ${
                            selectedTags.includes(tag)
                              ? "text-white"
                              : "bg-muted/50 text-muted-foreground hover:text-foreground"
                          }`}
                          style={selectedTags.includes(tag) ? { background: "hsl(var(--kf-accent2))" } : {}}
                        >
                          {tag}
                        </button>
                      ))
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 flex-shrink-0">
            <button
              onClick={selectAll}
              className="text-xs flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              {selectedIds.size === contacts.length && contacts.length > 0 ? (
                <CheckSquare className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
              ) : (
                <Square className="w-3.5 h-3.5" />
              )}
              {selectedIds.size === contacts.length && contacts.length > 0
                ? "Deselect all"
                : "Select all"}
            </button>
            <div className="text-xs text-muted-foreground">
              {contacts.length} contact{contacts.length !== 1 ? "s" : ""}
              {contactsWithPhone.length > 0 && ` · ${contactsWithPhone.length} with phone`}
              {contactsWithEmail.length > 0 && ` · ${contactsWithEmail.length} with email`}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : contacts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                <Users className="w-8 h-8 text-muted-foreground mb-2" />
                <p className="text-sm font-medium">No contacts found</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {search || selectedTags.length > 0 || statusFilter !== "ALL"
                    ? "Try adjusting your filters"
                    : "Add contacts in the CRM to get started"}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border/30">
                {contacts.map((contact) => {
                  const isSelected = selectedIds.has(contact.id);
                  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email || "Unknown";
                  const hasPhone = !!getContactPhone(contact);
                  const hasEmail = !!contact.email;

                  return (
                    <button
                      key={contact.id}
                      onClick={() => toggleContact(contact.id)}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5 ${
                        isSelected ? "bg-white/5" : ""
                      }`}
                    >
                      <div className="flex-shrink-0">
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                        ) : (
                          <Square className="w-4 h-4 text-muted-foreground" />
                        )}
                      </div>

                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                        style={{
                          background: `hsl(var(--kf-accent${(contact.id.charCodeAt(0) % 2) + 1}) / 0.15)`,
                          color: `hsl(var(--kf-accent${(contact.id.charCodeAt(0) % 2) + 1}))`,
                        }}
                      >
                        {(contact.firstName?.[0] || contact.email?.[0] || "?").toUpperCase()}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{name}</p>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          {contact.email && <span className="truncate">{contact.email}</span>}
                          {contact.status && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] uppercase bg-muted">
                              {contact.status}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {contact.tags?.map((tag) => (
                          <span
                            key={tag}
                            className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/50 text-muted-foreground"
                          >
                            {tag}
                          </span>
                        ))}
                        <div className="flex gap-1 ml-1">
                          {hasPhone && (
                            <span className="w-4 h-4 rounded-full bg-emerald-500/15 flex items-center justify-center" title="Has phone">
                              <span className="text-[8px] text-emerald-400">W</span>
                            </span>
                          )}
                          {hasEmail && (
                            <span className="w-4 h-4 rounded-full bg-blue-500/15 flex items-center justify-center" title="Has email">
                              <span className="text-[8px] text-blue-400">E</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {selectedIds.size > 0 && (
            <div className="flex-shrink-0 p-4 border-t border-border" style={{ background: "hsl(var(--kf-sidebar-bg))" }}>
              <button
                onClick={handleOpenBroadcast}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all text-white"
                style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
              >
                <Send className="w-4 h-4" />
                Broadcast to {selectedIds.size} contact{selectedIds.size !== 1 ? "s" : ""}
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
