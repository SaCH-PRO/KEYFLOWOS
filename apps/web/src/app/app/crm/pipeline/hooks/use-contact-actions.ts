"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ContactFormData } from "@/components/contacts/contact-form";
import type { QuickActionType } from "@/components/contacts";
import type { Contact, ContactDetail as ContactDetailAPI } from "@/lib/client";
import {
  addContactNote,
  addContactTask,
  completeContactTask,
  reopenContactTask,
  createContact,
  deleteContact,
  updateContact,
  importContactsFromFile,
  importContactsFromLink,
  logContactEvent,
  bulkUpdateContacts,
  bulkDeleteContacts,
  deleteContactNote,
  deleteContactTask,
  updateContactNote,
  updateContactTask,
  addContactsToList,
} from "@/lib/client";
import { moduleEvents } from "@/lib/module-events";

interface UseContactActionsParams {
  businessId: string | null;
  contacts: Contact[];
  setContacts: React.Dispatch<React.SetStateAction<Contact[]>>;
  selectedContactId: string | null;
  setSelectedContactId: (id: string | null) => void;
  contactDetail: ContactDetailAPI | null;
  setContactDetail: (d: ContactDetailAPI | null) => void;
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setSelectMode: React.Dispatch<React.SetStateAction<boolean>>;
  setShowMobileDetail: (v: boolean) => void;
  loadContacts: (opts?: { append?: boolean }) => Promise<void>;
  loadDetail: (contactId: string) => Promise<void>;
  loadFlowData: () => Promise<void>;
}

export function useContactActions({
  businessId, contacts, setContacts,
  selectedContactId, setSelectedContactId,
  contactDetail, setContactDetail,
  selectedIds, setSelectedIds, setSelectMode,
  setShowMobileDetail,
  loadContacts, loadDetail, loadFlowData,
}: UseContactActionsParams) {
  const router = useRouter();

  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const selectedContactIdRef = useRef(selectedContactId);
  selectedContactIdRef.current = selectedContactId;
  const contactDetailRef = useRef(contactDetail);
  contactDetailRef.current = contactDetail;

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingContact, setEditingContact] = useState<ContactFormData | null>(null);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [confirmState, setConfirmState] = useState<{ open: boolean; action: () => void }>({ open: false, action: () => {} });

  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const editingContactIdRef = useRef(editingContactId);
  editingContactIdRef.current = editingContactId;

  const handleSubmitContact = useCallback(async (formData: ContactFormData) => {
    if (!businessId) return;
    const tagsArray = formData.tags.split(",").map((t) => t.trim()).filter(Boolean);

    const customData: Record<string, unknown> = {};
    if (formData.linkedinUrl) customData.linkedinUrl = formData.linkedinUrl;
    if (formData.instagramUrl) customData.instagramUrl = formData.instagramUrl;
    if (formData.twitterUrl) customData.twitterUrl = formData.twitterUrl;
    if (formData.referredBy) customData.referredBy = formData.referredBy;
    if (formData.nextScheduledInteraction) customData.nextScheduledInteraction = formData.nextScheduledInteraction;
    if (formData.customFields && formData.customFields.length > 0) {
      for (const cf of formData.customFields) {
        if (cf.key.trim() && cf.value.trim()) {
          customData[cf.key.trim()] = cf.value.trim();
        }
      }
    }
    const shared = {
      firstName: formData.firstName, lastName: formData.lastName,
      email: formData.email || undefined, phone: formData.phone || undefined,
      status: formData.status, source: formData.source || undefined,
      companyName: formData.companyName || undefined, jobTitle: formData.jobTitle || undefined,
      preferredChannel: formData.preferredChannel || undefined,
      lifecycleStage: formData.lifecycleStage || undefined, tags: tagsArray,
      addressLine1: formData.addressLine1 || undefined, city: formData.city || undefined,
      country: formData.country || undefined,
      department: formData.department || undefined, industry: formData.industry || undefined,
      segment: formData.segment || undefined, secondaryEmail: formData.secondaryEmail || undefined,
      secondaryPhone: formData.secondaryPhone || undefined, whatsappNumber: formData.whatsappNumber || undefined,
      displayName: formData.displayName || undefined, language: formData.language || undefined,
      addressLine2: formData.addressLine2 || undefined, state: formData.state || undefined,
      postalCode: formData.postalCode || undefined, timezone: formData.timezone || undefined,
      marketingOptIn: formData.marketingOptIn, doNotContact: formData.doNotContact,
      notesInternal: formData.notesInternal || undefined,
      custom: Object.keys(customData).length > 0 ? customData : undefined,
    };
    try {
      const cid = editingContactIdRef.current;
      if (cid) {
        await updateContact({ businessId, contactId: cid, ...shared });
        setShowAddForm(false);
        setEditingContact(null);
        setEditingContactId(null);
        void loadContacts();
        void loadDetail(cid);
        toast.success("Contact updated");
      } else {
        const { data } = await createContact({
          businessId, ...shared,
          source: formData.source || "manual",
        });
        if (data) {
          if (formData.initialNote.trim()) await addContactNote(data.id, formData.initialNote.trim(), businessId);
          setShowAddForm(false);
          void loadContacts();
          void loadFlowData();
          toast.success("Contact created");
        }
      }
    } catch {
      toast.error("Failed to save contact");
    }
  }, [businessId, loadContacts, loadDetail, loadFlowData]);

  const handleAddNote = useCallback(async (body: string, source?: string) => {
    const cid = selectedContactIdRef.current;
    const cd = contactDetailRef.current;
    if (!cid || !businessId) return;
    const tempId = `temp-${Date.now()}`;
    const optimisticNote = { id: tempId, body, source: source || "general", contactId: cid, createdAt: new Date().toISOString() };
    if (cd) {
      setContactDetail({ ...cd, notes: [optimisticNote, ...(cd.notes ?? [])] });
    }
    try {
      await addContactNote(cid, body, businessId, source);
      void loadDetail(cid);
    } catch {
      const cdNow = contactDetailRef.current;
      if (cdNow) {
        setContactDetail({ ...cdNow, notes: (cdNow.notes ?? []).filter((n) => n.id !== tempId) });
      }
      toast.error("Failed to add note");
    }
  }, [businessId, setContactDetail, loadDetail]);

  const handleAddTask = useCallback(async (title: string, options?: { dueDate?: string; priority?: string; remindAt?: string }) => {
    const cid = selectedContactIdRef.current;
    const cd = contactDetailRef.current;
    if (!cid || !businessId) return;
    const tempId = `temp-${Date.now()}`;
    const optimisticTask = {
      id: tempId, title, status: "OPEN", priority: options?.priority || "NORMAL",
      dueDate: options?.dueDate || null, remindAt: options?.remindAt || null,
      completedAt: null, source: null, contactId: cid, createdAt: new Date().toISOString(),
    };
    if (cd) {
      setContactDetail({ ...cd, tasks: [optimisticTask, ...(cd.tasks ?? [])] });
    }
    try {
      await addContactTask(cid, title, {
        dueDate: options?.dueDate,
        priority: options?.priority as "NORMAL" | "HIGH" | "LOW" | undefined,
        remindAt: options?.remindAt,
      }, businessId);
      void loadDetail(cid);
    } catch {
      const cdNow = contactDetailRef.current;
      if (cdNow) {
        setContactDetail({ ...cdNow, tasks: (cdNow.tasks ?? []).filter((t) => t.id !== tempId) });
      }
      toast.error("Failed to add task");
    }
  }, [businessId, setContactDetail, loadDetail]);

  const handleCompleteTask = useCallback(async (taskId: string, currentStatus?: string) => {
    if (!businessId) return;
    try {
      if (currentStatus === "DONE") await reopenContactTask(taskId, businessId);
      else await completeContactTask(taskId, businessId);
      const cid = selectedContactIdRef.current;
      if (cid) void loadDetail(cid);
    } catch {
      toast.error("Failed to update task status");
    }
  }, [businessId, loadDetail]);

  const handleDeleteNote = useCallback(async (noteId: string) => {
    if (!businessId) return;
    const cd = contactDetailRef.current;
    const backup = cd ? [...(cd.notes ?? [])] : null;
    if (cd) {
      setContactDetail({ ...cd, notes: (cd.notes ?? []).filter((n) => n.id !== noteId) });
    }
    try {
      await deleteContactNote(noteId, businessId);
      const cid = selectedContactIdRef.current;
      if (cid) void loadDetail(cid);
      toast.success("Note deleted");
    } catch {
      const cdNow = contactDetailRef.current;
      if (cdNow && backup) setContactDetail({ ...cdNow, notes: backup });
      toast.error("Failed to delete note");
    }
  }, [businessId, setContactDetail, loadDetail]);

  const handleDeleteTask = useCallback(async (taskId: string) => {
    if (!businessId) return;
    const cd = contactDetailRef.current;
    const backup = cd ? [...(cd.tasks ?? [])] : null;
    if (cd) {
      setContactDetail({ ...cd, tasks: (cd.tasks ?? []).filter((t) => t.id !== taskId) });
    }
    try {
      await deleteContactTask(taskId, businessId);
      const cid = selectedContactIdRef.current;
      if (cid) void loadDetail(cid);
      toast.success("Task deleted");
    } catch {
      const cdNow = contactDetailRef.current;
      if (cdNow && backup) setContactDetail({ ...cdNow, tasks: backup });
      toast.error("Failed to delete task");
    }
  }, [businessId, setContactDetail, loadDetail]);

  const handleUpdateStatus = useCallback(async (status: string) => {
    const cid = selectedContactIdRef.current;
    const cd = contactDetailRef.current;
    if (!cid || !businessId) return;
    try {
      await updateContact({ businessId, contactId: cid, status });
      setContacts((prev) => prev.map((c) => (c.id === cid ? { ...c, status } : c)));
      if (cd) {
        setContactDetail({
          ...cd,
          contact: cd.contact ? { ...cd.contact, status } : null,
        });
      }
      void loadFlowData();
      toast.success("Status updated");
    } catch { toast.error("Failed to update status"); }
  }, [businessId, setContacts, setContactDetail, loadFlowData]);

  const handleLogEvent = useCallback(async (type: string, description?: string) => {
    const cid = selectedContactIdRef.current;
    if (!cid || !businessId) return;
    try {
      await logContactEvent(cid, { type, description }, businessId);
      void loadDetail(cid);
    } catch (err) {
      console.error("Failed to log event:", err);
    }
  }, [businessId, loadDetail]);

  const handleEditContact = useCallback(() => {
    const c = contactDetailRef.current?.contact;
    if (!c) return;
    setEditingContactId(c.id);
    setSelectedContactId(c.id);

    const customObj = (c.custom && typeof c.custom === "object" && !Array.isArray(c.custom)) ? c.custom as Record<string, unknown> : {};
    const reservedKeys = new Set(["linkedinUrl", "instagramUrl", "twitterUrl", "referredBy", "nextScheduledInteraction"]);
    const customFields = Object.entries(customObj)
      .filter(([k]) => !reservedKeys.has(k))
      .map(([key, value]) => ({ key, value: String(value ?? "") }));
    setEditingContact({
      firstName: c.firstName || "", lastName: c.lastName || "",
      email: c.email || "", phone: c.phone || "",
      companyName: c.companyName || "", jobTitle: c.jobTitle || "",
      status: c.status || "LEAD", source: c.source || "",
      preferredChannel: c.preferredChannel || "WhatsApp",
      lifecycleStage: c.lifecycleStage || "",
      tags: Array.isArray(c.tags) ? c.tags.join(", ") : "",
      initialNote: "",
      addressLine1: c.addressLine1 || "", city: c.city || "",
      country: c.country || "Trinidad",
      department: c.department || "", industry: c.industry || "",
      segment: c.segment || "", secondaryEmail: c.secondaryEmail || "",
      secondaryPhone: c.secondaryPhone || "", whatsappNumber: c.whatsappNumber || "",
      displayName: c.displayName || "", language: c.language || "",
      addressLine2: c.addressLine2 || "", state: c.state || "",
      postalCode: c.postalCode || "", timezone: c.timezone || "",
      marketingOptIn: c.marketingOptIn ?? false,
      doNotContact: c.doNotContact ?? false,
      notesInternal: c.notesInternal || "",
      linkedinUrl: String(customObj.linkedinUrl ?? ""),
      instagramUrl: String(customObj.instagramUrl ?? ""),
      twitterUrl: String(customObj.twitterUrl ?? ""),
      referredBy: String(customObj.referredBy ?? ""),
      nextScheduledInteraction: String(customObj.nextScheduledInteraction ?? ""),
      customFields,
    });
    setShowMobileDetail(false);
    setShowAddForm(true);
  }, [setSelectedContactId, setShowMobileDetail]);

  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    };
  }, []);

  const handleDeleteContact = useCallback(async (contact?: { id: string }) => {
    const currentSelectedId = selectedContactIdRef.current;
    const id = contact?.id || currentSelectedId;
    if (!id || !businessId) return;
    const backup = contactsRef.current.find((c) => c.id === id);
    if (!backup) return;

    const wasSelected = currentSelectedId === id;
    setContacts((prev) => prev.filter((c) => c.id !== id));
    if (wasSelected) { setSelectedContactId(null); setContactDetail(null); }
    setShowMobileDetail(false);

    let undone = false;
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);

    const restore = () => {
      setContacts((prev) => [backup, ...prev]);
      if (wasSelected) { setSelectedContactId(id); }
    };

    toast("Contact deleted", {
      action: {
        label: "Undo",
        onClick: () => {
          undone = true;
          if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
          restore();
          toast.success("Contact restored");
        },
      },
      duration: 5000,
    });

    deleteTimerRef.current = setTimeout(async () => {
      if (undone) return;
      try {
        await deleteContact(id, businessId);
        void loadFlowData();
      } catch {
        restore();
        toast.error("Failed to delete contact — restored");
      }
    }, 5500);
  }, [businessId, loadFlowData, setContacts, setSelectedContactId, setContactDetail, setShowMobileDetail]);

  const handleImportFile = useCallback(async (type: "csv" | "xlsx" | "vcf" | "image", file: File) => {
    if (!businessId) return;
    try {
      await importContactsFromFile({ businessId, type, file });
      void loadContacts();
      void loadFlowData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import failed";
      toast.error(msg);
      throw err;
    }
  }, [businessId, loadContacts, loadFlowData]);

  const handleImportLink = useCallback(async (url: string) => {
    if (!businessId) return;
    try {
      await importContactsFromLink(url, businessId);
      void loadContacts();
      void loadFlowData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import from URL failed";
      toast.error(msg);
      throw err;
    }
  }, [businessId, loadContacts, loadFlowData]);

  const handleDeviceImport = useCallback(async (deviceContacts: { firstName?: string; lastName?: string; email?: string; phone?: string }[]) => {
    if (!businessId || deviceContacts.length === 0) return;
    let created = 0;
    for (const dc of deviceContacts) {
      try {
        await createContact({
          businessId,
          firstName: dc.firstName,
          lastName: dc.lastName,
          email: dc.email,
          phone: dc.phone,
          source: "device_contacts",
          status: "LEAD",
        });
        created++;
      } catch {
        // continue with remaining contacts
      }
    }
    if (created > 0) {
      void loadContacts();
      void loadFlowData();
    }
    if (created < deviceContacts.length) {
      const skipped = deviceContacts.length - created;
      toast.info(`${skipped} contact${skipped !== 1 ? "s" : ""} skipped (duplicates or errors)`);
    }
  }, [businessId, loadContacts, loadFlowData]);

  const handleUpdateNote = useCallback(async (noteId: string, data: { body?: string; source?: string }) => {
    if (!businessId) return;
    try {
      await updateContactNote(noteId, data, businessId);
      const cid = selectedContactIdRef.current;
      if (cid) void loadDetail(cid);
      toast.success("Note updated");
    } catch {
      toast.error("Failed to update note");
    }
  }, [businessId, loadDetail]);

  const handleUpdateTask = useCallback(async (taskId: string, data: { title?: string; dueDate?: string; priority?: string; remindAt?: string }) => {
    if (!businessId) return;
    try {
      await updateContactTask(taskId, data, businessId);
      const cid = selectedContactIdRef.current;
      if (cid) void loadDetail(cid);
      toast.success("Task updated");
    } catch {
      toast.error("Failed to update task");
    }
  }, [businessId, loadDetail]);

  const handleQuickAction = useCallback((contactId: string, action: QuickActionType) => {
    switch (action) {
      case "create-invoice":
        moduleEvents.emit("commerce:create_invoice_for_contact", "crm", { contactId });
        router.push(`/app/commerce?tab=billing&segment=invoices&contactId=${contactId}`);
        break;
      case "book-appointment": router.push(`/app/bookings?contactId=${contactId}`); break;
      case "send-quote":
        moduleEvents.emit("commerce:create_quote_for_contact", "crm", { contactId });
        router.push(`/app/commerce?tab=billing&segment=quotes&contactId=${contactId}`);
        break;
    }
  }, [router]);

  const handleViewExpiringQuotes = useCallback(() => {
    router.push("/app/commerce?tab=quotes&filter=expiring");
  }, [router]);

  const handleViewOverdueInvoices = useCallback(() => {
    router.push("/app/commerce?tab=invoices&filter=overdue");
  }, [router]);

  const [bulkLoading, setBulkLoading] = useState(false);

  const handleBulkStatusChange = useCallback(async (newStatus: string) => {
    const ids = selectedIdsRef.current;
    if (!businessId || ids.size === 0) return;
    setBulkLoading(true);
    try {
      await bulkUpdateContacts({ businessId, contactIds: Array.from(ids), status: newStatus });
      setContacts((prev) => prev.map((c) => ids.has(c.id) ? { ...c, status: newStatus } : c));
      setSelectedIds(new Set());
      setSelectMode(false);
      toast.success(`Updated ${ids.size} contact${ids.size !== 1 ? "s" : ""}`);
    } catch {
      toast.error("Failed to update contacts");
    } finally {
      setBulkLoading(false);
    }
  }, [businessId, setContacts, setSelectedIds, setSelectMode]);

  const handleBulkTag = useCallback(async (tag: string) => {
    const ids = selectedIdsRef.current;
    if (!businessId || ids.size === 0 || !tag.trim()) return;
    setBulkLoading(true);
    try {
      await bulkUpdateContacts({ businessId, contactIds: Array.from(ids), addTags: [tag.trim()] });
      setContacts((prev) => prev.map((c) => {
        if (!ids.has(c.id)) return c;
        const tags = c.tags ?? [];
        return tags.includes(tag.trim()) ? c : { ...c, tags: [...tags, tag.trim()] };
      }));
      toast.success(`Tagged ${ids.size} contact${ids.size !== 1 ? "s" : ""}`);
    } catch {
      toast.error("Failed to tag contacts");
    } finally {
      setBulkLoading(false);
    }
  }, [businessId, setContacts]);

  const handleBulkDelete = useCallback(async () => {
    const ids = selectedIdsRef.current;
    if (!businessId || ids.size === 0) return;
    setConfirmState({
      open: true,
      action: async () => {
        const currentIds = selectedIdsRef.current;
        const currentSelectedId = selectedContactIdRef.current;
        setBulkLoading(true);
        try {
          await bulkDeleteContacts({ businessId, contactIds: Array.from(currentIds) });
          setContacts((prev) => prev.filter((c) => !currentIds.has(c.id)));
          if (currentSelectedId && currentIds.has(currentSelectedId)) { setSelectedContactId(null); setContactDetail(null); }
          setSelectedIds(new Set());
          setSelectMode(false);
          void loadFlowData();
          toast.success(`Deleted ${currentIds.size} contact${currentIds.size !== 1 ? "s" : ""}`);
        } catch {
          toast.error("Failed to delete contacts");
        } finally {
          setBulkLoading(false);
        }
      },
    });
  }, [businessId, loadFlowData, setContacts, setSelectedIds, setSelectMode, setSelectedContactId, setContactDetail]);

  const handleBulkAddToList = useCallback(async (listId: string) => {
    const ids = selectedIdsRef.current;
    if (!businessId || ids.size === 0 || !listId) return;
    setBulkLoading(true);
    try {
      await addContactsToList(businessId, listId, Array.from(ids));
      toast.success(`Added ${ids.size} contact${ids.size !== 1 ? "s" : ""} to list`);
    } catch {
      toast.error("Failed to add contacts to list");
    } finally {
      setBulkLoading(false);
    }
  }, [businessId]);

  return {
    showAddForm, setShowAddForm,
    editingContact,
    setEditingContact: useCallback((v: ContactFormData | null) => {
      setEditingContact(v);
      if (!v) setEditingContactId(null);
    }, []),
    showBroadcast, setShowBroadcast,
    showGuide, setShowGuide,
    confirmState, setConfirmState,
    handleSubmitContact, handleAddNote, handleAddTask, handleCompleteTask,
    handleDeleteNote, handleDeleteTask, handleUpdateStatus, handleLogEvent,
    handleEditContact, handleDeleteContact,
    handleImportFile, handleImportLink, handleDeviceImport,
    handleUpdateNote, handleUpdateTask,
    handleQuickAction, handleViewExpiringQuotes, handleViewOverdueInvoices,
    handleBulkStatusChange, handleBulkTag, handleBulkDelete, handleBulkAddToList,
    bulkLoading,
  };
}
