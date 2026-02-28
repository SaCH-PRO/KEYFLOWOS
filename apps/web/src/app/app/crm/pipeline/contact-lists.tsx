"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  List,
  Plus,
  X,
  MoreHorizontal,
  Users,
  Zap,
  Trash2,
  Edit2,
  ChevronRight,
  Filter,
} from "lucide-react";
import { toast } from "sonner";
import {
  fetchContactLists,
  createContactList,
  updateContactList,
  deleteContactList,
  addContactsToList,
  fetchContactListContacts,
} from "@/lib/client";
import { ContactSelect } from "@/components/contacts";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface SmartListFilters {
  status?: string[];
  tags?: string[];
  source?: string;
}

interface ContactListData {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  type: string;
  filters?: SmartListFilters;
  contactIds: string[];
  createdAt: string;
}

interface ContactListPayload {
  name: string;
  description?: string;
  color: string;
  type: "MANUAL" | "SMART";
  filters?: SmartListFilters;
}

interface ContactListsProps {
  businessId: string;
  onSelectList: (listId: string | null, contactIds?: string[]) => void;
  activeListId: string | null;
  onListsLoaded?: (count: number) => void;
}

const LIST_COLORS = [
  "#F97316", "#3B82F6", "#10B981", "#8B5CF6",
  "#EC4899", "#F59E0B", "#06B6D4", "#EF4444",
];

const STATUSES_OPTIONS = ["LEAD", "PROSPECT", "CLIENT", "LOST"];

export function ContactLists({ businessId, onSelectList, activeListId, onListsLoaded }: ContactListsProps) {
  const [lists, setLists] = useState<ContactListData[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editList, setEditList] = useState<ContactListData | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; listId: string | null }>({ open: false, listId: null });
  const [addContactToListId, setAddContactToListId] = useState<string | null>(null);
  const [smartListCounts, setSmartListCounts] = useState<Record<string, number>>({});

  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formColor, setFormColor] = useState(LIST_COLORS[0]);
  const [formType, setFormType] = useState<"MANUAL" | "SMART">("MANUAL");
  const [formFilterStatus, setFormFilterStatus] = useState<string[]>([]);
  const [formFilterTags, setFormFilterTags] = useState("");
  const [formFilterSource, setFormFilterSource] = useState("");
  const [saving, setSaving] = useState(false);

  const loadLists = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await fetchContactLists(businessId);
      if (data) {
        const typed = data as ContactListData[];
        setLists(typed);
        onListsLoaded?.(typed.length);
        const smartLists = typed.filter((l) => l.type === "SMART");
        if (smartLists.length > 0) {
          const counts: Record<string, number> = {};
          await Promise.all(smartLists.map(async (sl) => {
            try {
              const res = await fetchContactListContacts(businessId, sl.id);
              counts[sl.id] = Array.isArray(res.data) ? res.data.length : 0;
            } catch { counts[sl.id] = 0; }
          }));
          setSmartListCounts(counts);
        }
      }
    } catch {
      toast.error("Failed to load contact lists");
    }
    setLoading(false);
  }, [businessId, onListsLoaded]);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  const resetForm = useCallback(() => {
    setFormName("");
    setFormDescription("");
    setFormColor(LIST_COLORS[0]);
    setFormType("MANUAL");
    setFormFilterStatus([]);
    setFormFilterTags("");
    setFormFilterSource("");
  }, []);

  const openEdit = useCallback((list: ContactListData) => {
    setEditList(list);
    setFormName(list.name);
    setFormDescription(list.description || "");
    setFormColor(list.color || LIST_COLORS[0]);
    setFormType(list.type as "MANUAL" | "SMART");
    if (list.filters) {
      setFormFilterStatus(list.filters.status || []);
      setFormFilterTags((list.filters.tags || []).join(", "));
      setFormFilterSource(list.filters.source || "");
    }
    setShowCreate(true);
    setMenuOpenId(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!formName.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const payload: ContactListPayload = {
        name: formName.trim(),
        description: formDescription.trim() || undefined,
        color: formColor,
        type: formType,
      };
      if (formType === "SMART") {
        payload.filters = {
          status: formFilterStatus.length > 0 ? formFilterStatus : undefined,
          tags: formFilterTags.trim() ? formFilterTags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
          source: formFilterSource.trim() || undefined,
        };
      }

      if (editList) {
        await updateContactList(businessId, editList.id, payload);
        toast.success("List updated");
      } else {
        await createContactList(businessId, payload);
        toast.success("List created");
      }
      setShowCreate(false);
      setEditList(null);
      resetForm();
      await loadLists();
    } catch {
      toast.error("Failed to save list");
    }
    setSaving(false);
  }, [businessId, editList, formName, formDescription, formColor, formType, formFilterStatus, formFilterTags, formFilterSource, loadLists, resetForm]);

  const handleDelete = useCallback(async (listId: string) => {
    try {
      await deleteContactList(businessId, listId);
      toast.success("List deleted");
      if (activeListId === listId) onSelectList(null);
      await loadLists();
    } catch {
      toast.error("Failed to delete list");
    }
  }, [businessId, activeListId, onSelectList, loadLists]);

  const handleAddContact = useCallback(async (listId: string, contactId: string) => {
    try {
      await addContactsToList(businessId, listId, [contactId]);
      toast.success("Contact added to list");
      setAddContactToListId(null);
      await loadLists();
    } catch {
      toast.error("Failed to add contact");
    }
  }, [businessId, loadLists]);

  const handleListClick = useCallback(async (list: ContactListData) => {
    if (activeListId === list.id) {
      onSelectList(null);
      return;
    }
    if (list.type === "SMART") {
      try {
        const res = await fetchContactListContacts(businessId, list.id);
        const ids = Array.isArray(res.data) ? (res.data as { id: string }[]).map((c) => c.id) : [];
        onSelectList(list.id, ids);
      } catch {
        onSelectList(list.id, []);
      }
    } else {
      onSelectList(list.id, list.contactIds);
    }
  }, [businessId, activeListId, onSelectList]);

  const handleNewList = useCallback(() => {
    resetForm();
    setEditList(null);
    setShowCreate(true);
  }, [resetForm]);

  const handleCancelForm = useCallback(() => {
    setShowCreate(false);
    setEditList(null);
    resetForm();
  }, [resetForm]);

  const handleConfirmDelete = useCallback(() => {
    if (confirmDelete.listId) handleDelete(confirmDelete.listId);
    setConfirmDelete({ open: false, listId: null });
  }, [confirmDelete.listId, handleDelete]);

  const handleCancelDelete = useCallback(() => {
    setConfirmDelete({ open: false, listId: null });
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <List className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          Contact Lists
        </h3>
        <button
          onClick={handleNewList}
          className="kf-btn-primary text-xs px-3 py-1.5 inline-flex items-center gap-1.5"
        >
          <Plus className="w-3 h-3" />
          New List
        </button>
      </div>

      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="kf-card-accent p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">{editList ? "Edit List" : "New List"}</h4>
              <button onClick={handleCancelForm} className="p-1 rounded hover:bg-muted/50" aria-label="Close form">
                <X className="w-4 h-4" />
              </button>
            </div>

            <input
              type="text"
              placeholder="List name..."
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="kf-input w-full text-sm"
              autoFocus
              aria-label="List name"
            />
            <input
              type="text"
              placeholder="Description (optional)"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              className="kf-input w-full text-sm"
              aria-label="List description"
            />

            <div className="flex items-center gap-2" role="group" aria-label="List color">
              <span className="text-xs text-muted-foreground">Color:</span>
              {LIST_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setFormColor(c)}
                  className={`w-5 h-5 rounded-full transition-all ${formColor === c ? "ring-2 ring-offset-2 ring-offset-background" : ""}`}
                  style={{ backgroundColor: c, ringColor: c }}
                  aria-label={`Color ${c}`}
                  aria-pressed={formColor === c}
                />
              ))}
            </div>

            <div className="flex gap-2" role="group" aria-label="List type">
              <button
                onClick={() => setFormType("MANUAL")}
                className={`flex-1 text-xs py-2 rounded-lg border transition-all ${formType === "MANUAL" ? "border-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1))]/10 text-foreground" : "border-border text-muted-foreground"}`}
                aria-pressed={formType === "MANUAL"}
              >
                <Users className="w-3.5 h-3.5 mx-auto mb-1" />
                Manual
              </button>
              <button
                onClick={() => setFormType("SMART")}
                className={`flex-1 text-xs py-2 rounded-lg border transition-all ${formType === "SMART" ? "border-[hsl(var(--kf-accent2))] bg-[hsl(var(--kf-accent2))]/10 text-foreground" : "border-border text-muted-foreground"}`}
                aria-pressed={formType === "SMART"}
              >
                <Zap className="w-3.5 h-3.5 mx-auto mb-1" />
                Smart
              </button>
            </div>

            {formType === "SMART" && (
              <div className="space-y-2 border-t border-border/40 pt-3">
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Filter className="w-3 h-3" />
                  Smart Filters
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Status</label>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status filters">
                    {STATUSES_OPTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => setFormFilterStatus((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s])}
                        className={`px-2 py-1 text-xs rounded-md border transition-all ${formFilterStatus.includes(s) ? "border-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1))]/10" : "border-border"}`}
                        aria-pressed={formFilterStatus.includes(s)}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="text"
                  placeholder="Tags (comma-separated)"
                  value={formFilterTags}
                  onChange={(e) => setFormFilterTags(e.target.value)}
                  className="kf-input w-full text-xs"
                  aria-label="Filter by tags"
                />
                <input
                  type="text"
                  placeholder="Source filter (e.g., google, manual, form)"
                  value={formFilterSource}
                  onChange={(e) => setFormFilterSource(e.target.value)}
                  className="kf-input w-full text-xs"
                  aria-label="Filter by source"
                />
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button onClick={handleCancelForm} className="kf-btn-secondary text-xs">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving || !formName.trim()} className="kf-btn-primary text-xs disabled:opacity-50">
                {saving ? "Saving..." : editList ? "Update" : "Create"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="kf-card p-3 animate-pulse">
              <div className="h-4 bg-muted/30 rounded w-1/3 mb-2" />
              <div className="h-3 bg-muted/20 rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : lists.length === 0 ? (
        <div className="kf-card p-6 text-center">
          <List className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">No lists yet</p>
          <p className="text-xs text-muted-foreground mt-1">Create lists to organize and segment your contacts</p>
        </div>
      ) : (
        <div className="space-y-2" role="list" aria-label="Contact lists">
          {lists.map((list) => (
            <div
              key={list.id}
              className={`kf-card p-3 transition-all hover:border-[hsl(var(--kf-accent1))]/30 ${activeListId === list.id ? "border-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1))]/5" : ""}`}
              role="listitem"
            >
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer"
                  onClick={() => handleListClick(list)}
                  aria-expanded={activeListId === list.id}
                >
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: list.color || "#888" }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{list.name}</span>
                      {list.type === "SMART" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[hsl(var(--kf-accent2))]/10" style={{ color: "hsl(var(--kf-accent2))" }}>
                          <Zap className="w-2.5 h-2.5 inline -mt-0.5" /> Smart
                        </span>
                      )}
                    </div>
                    {list.description && <p className="text-xs text-muted-foreground truncate">{list.description}</p>}
                  </div>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {list.type === "SMART" ? (smartListCounts[list.id] ?? "…") : list.contactIds.length}
                  </span>
                </button>
                <div className="relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); setMenuOpenId((prev) => prev === list.id ? null : list.id); }}
                    className="p-1 rounded hover:bg-muted/50"
                    aria-label={`Actions for ${list.name}`}
                    aria-haspopup="menu"
                    aria-expanded={menuOpenId === list.id}
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                  {menuOpenId === list.id && (
                    <div className="absolute top-full right-0 mt-1 z-50 kf-card-glass border border-border shadow-xl rounded-xl py-1 w-40" role="menu">
                      {list.type === "MANUAL" && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setMenuOpenId(null); setAddContactToListId(list.id); }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 flex items-center gap-2"
                          role="menuitem"
                        >
                          <Plus className="w-3.5 h-3.5" /> Add Contact
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); openEdit(list); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 flex items-center gap-2"
                        role="menuitem"
                      >
                        <Edit2 className="w-3.5 h-3.5" /> Edit
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuOpenId(null); setConfirmDelete({ open: true, listId: list.id }); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 flex items-center gap-2 text-red-400"
                        role="menuitem"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                    </div>
                  )}
                </div>
                <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${activeListId === list.id ? "rotate-90" : ""}`} />
              </div>

              {addContactToListId === list.id && (
                <div className="mt-3 pt-3 border-t border-border/40">
                  <ContactSelect
                    value=""
                    onChange={(id) => { if (id) handleAddContact(list.id, id); }}
                    label="Add a contact to this list"
                    placeholder="Search contacts..."
                  />
                  <button onClick={() => setAddContactToListId(null)} className="text-xs text-muted-foreground mt-2 hover:text-foreground">
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete.open}
        title="Delete List"
        message="Are you sure you want to delete this list? Contacts won't be affected."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </div>
  );
}
