"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ContactFormData } from "@/components/contacts/contact-form";
import type { ContactCardData } from "@/components/contacts/contact-card";
import type { ContactDetailData } from "@/components/contacts/contact-detail";
import type { QuickActionType } from "@/components/contacts";
import type { Contact, ContactDetail as ContactDetailAPI } from "@/lib/client";
import {
  addContactNote, addContactTask, completeContactTask, reopenContactTask,
  createContact, deleteContact, updateContact,
  importContactsFromFile, importContactsFromLink,
  logContactEvent, bulkUpdateContacts, bulkDeleteContacts,
  deleteContactNote, deleteContactTask,
  updateContactNote, updateContactTask,
} from "@/lib/client";

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

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingContact, setEditingContact] = useState<ContactFormData | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [confirmState, setConfirmState] = useState<{ open: boolean; action: () => void }>({ open: false, action: () => {} });

  const handleSubmitContact = async (formData: ContactFormData) => {
    if (!businessId) return;
    const tagsArray = formData.tags.split(",").map((t) => t.trim()).filter(Boolean);
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
    };
    try {
      if (editingContact && selectedContactId) {
        await updateContact({ businessId, contactId: selectedContactId, ...shared });
        setShowAddForm(false);
        setEditingContact(null);
        void loadContacts();
        void loadDetail(selectedContactId);
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
  };

  const handleAddNote = async (body: string, source?: string) => {
    if (!selectedContactId || !businessId) return;
    try {
      await addContactNote(selectedContactId, body, businessId, source);
      void loadDetail(selectedContactId);
    } catch {
      toast.error("Failed to add note");
    }
  };

  const handleAddTask = async (title: string, options?: { dueDate?: string; priority?: string; remindAt?: string }) => {
    if (!selectedContactId || !businessId) return;
    try {
      await addContactTask(selectedContactId, title, {
        dueDate: options?.dueDate,
        priority: options?.priority as "NORMAL" | "HIGH" | "LOW" | undefined,
        remindAt: options?.remindAt,
      }, businessId);
      void loadDetail(selectedContactId);
    } catch {
      toast.error("Failed to add task");
    }
  };

  const handleCompleteTask = async (taskId: string, currentStatus?: string) => {
    if (!businessId) return;
    try {
      if (currentStatus === "DONE") await reopenContactTask(taskId, businessId);
      else await completeContactTask(taskId, businessId);
      if (selectedContactId) void loadDetail(selectedContactId);
    } catch {
      toast.error("Failed to update task status");
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!businessId) return;
    try {
      await deleteContactNote(noteId, businessId);
      if (selectedContactId) void loadDetail(selectedContactId);
      toast.success("Note deleted");
    } catch { toast.error("Failed to delete note"); }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!businessId) return;
    try {
      await deleteContactTask(taskId, businessId);
      if (selectedContactId) void loadDetail(selectedContactId);
      toast.success("Task deleted");
    } catch { toast.error("Failed to delete task"); }
  };

  const handleUpdateStatus = async (status: string) => {
    if (!selectedContactId || !businessId) return;
    try {
      await updateContact({ businessId, contactId: selectedContactId, status });
      setContacts((prev) => prev.map((c) => (c.id === selectedContactId ? { ...c, status } : c)));
      if (contactDetail) {
        setContactDetail({
          ...contactDetail,
          contact: contactDetail.contact ? { ...contactDetail.contact, status } : null,
        });
      }
      void loadFlowData();
      toast.success("Status updated");
    } catch { toast.error("Failed to update status"); }
  };

  const handleLogEvent = async (type: string, description?: string) => {
    if (!selectedContactId || !businessId) return;
    try {
      await logContactEvent(selectedContactId, { type, description }, businessId);
      void loadDetail(selectedContactId);
    } catch (err) {
      console.error("Failed to log event:", err);
    }
  };

  const handleEditContact = useCallback(() => {
    const c = contactDetail?.contact;
    if (!c) return;
    setSelectedContactId(c.id);
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
    });
    setShowMobileDetail(false);
    setShowAddForm(true);
  }, [contactDetail, setSelectedContactId, setShowMobileDetail]);

  const handleDeleteContact = useCallback(async (contact?: { id: string }) => {
    const id = contact?.id || selectedContactId;
    if (!id || !businessId) return;
    setConfirmState({
      open: true,
      action: async () => {
        try {
          await deleteContact(id, businessId);
          setContacts((prev) => prev.filter((c) => c.id !== id));
          if (selectedContactId === id) { setSelectedContactId(null); setContactDetail(null); }
          setShowMobileDetail(false);
          void loadFlowData();
          toast.success("Contact deleted");
        } catch { toast.error("Failed to delete contact"); }
      },
    });
  }, [businessId, selectedContactId, loadFlowData, setContacts, setSelectedContactId, setContactDetail, setShowMobileDetail]);

  const handleImportFile = async (type: "csv" | "xlsx" | "vcf" | "image", file: File) => {
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
  };

  const handleImportLink = async (url: string) => {
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
  };

  const handleDeviceImport = async (deviceContacts: { firstName?: string; lastName?: string; email?: string; phone?: string }[]) => {
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
  };

  const handleUpdateNote = useCallback(async (noteId: string, data: { body?: string; source?: string }) => {
    if (!businessId) return;
    try {
      await updateContactNote(noteId, data, businessId);
      if (selectedContactId) void loadDetail(selectedContactId);
      toast.success("Note updated");
    } catch {
      toast.error("Failed to update note");
    }
  }, [businessId, selectedContactId, loadDetail]);

  const handleUpdateTask = useCallback(async (taskId: string, data: { title?: string; dueDate?: string; priority?: string; remindAt?: string }) => {
    if (!businessId) return;
    try {
      await updateContactTask(taskId, data, businessId);
      if (selectedContactId) void loadDetail(selectedContactId);
      toast.success("Task updated");
    } catch {
      toast.error("Failed to update task");
    }
  }, [businessId, selectedContactId, loadDetail]);

  const handleQuickAction = useCallback((contactId: string, action: QuickActionType) => {
    switch (action) {
      case "create-invoice": router.push(`/app/commerce?tab=invoices&contactId=${contactId}`); break;
      case "book-appointment": router.push(`/app/bookings?contactId=${contactId}`); break;
      case "send-quote": router.push(`/app/commerce?tab=quotes&contactId=${contactId}`); break;
    }
  }, [router]);

  const handleViewExpiringQuotes = useCallback(() => {
    router.push("/app/commerce?tab=quotes&filter=expiring");
  }, [router]);

  const handleViewOverdueInvoices = useCallback(() => {
    router.push("/app/commerce?tab=invoices&filter=overdue");
  }, [router]);

  const handleBulkStatusChange = useCallback(async (newStatus: string) => {
    if (!businessId || selectedIds.size === 0) return;
    try {
      await bulkUpdateContacts({ businessId, contactIds: Array.from(selectedIds), status: newStatus });
      setContacts((prev) => prev.map((c) => selectedIds.has(c.id) ? { ...c, status: newStatus } : c));
      setSelectedIds(new Set());
      setSelectMode(false);
      toast.success(`Updated ${selectedIds.size} contact${selectedIds.size !== 1 ? "s" : ""}`);
    } catch { toast.error("Failed to update contacts"); }
  }, [businessId, selectedIds, setContacts, setSelectedIds, setSelectMode]);

  const handleBulkTag = useCallback(async (tag: string) => {
    if (!businessId || selectedIds.size === 0 || !tag.trim()) return;
    try {
      await bulkUpdateContacts({ businessId, contactIds: Array.from(selectedIds), addTags: [tag.trim()] });
      setContacts((prev) => prev.map((c) => {
        if (!selectedIds.has(c.id)) return c;
        const tags = c.tags ?? [];
        return tags.includes(tag.trim()) ? c : { ...c, tags: [...tags, tag.trim()] };
      }));
      toast.success(`Tagged ${selectedIds.size} contact${selectedIds.size !== 1 ? "s" : ""}`);
    } catch { toast.error("Failed to tag contacts"); }
  }, [businessId, selectedIds, setContacts]);

  const handleBulkDelete = useCallback(async () => {
    if (!businessId || selectedIds.size === 0) return;
    setConfirmState({
      open: true,
      action: async () => {
        try {
          await bulkDeleteContacts({ businessId, contactIds: Array.from(selectedIds) });
          setContacts((prev) => prev.filter((c) => !selectedIds.has(c.id)));
          if (selectedContactId && selectedIds.has(selectedContactId)) { setSelectedContactId(null); setContactDetail(null); }
          setSelectedIds(new Set());
          setSelectMode(false);
          void loadFlowData();
          toast.success(`Deleted ${selectedIds.size} contact${selectedIds.size !== 1 ? "s" : ""}`);
        } catch { toast.error("Failed to delete contacts"); }
      },
    });
  }, [businessId, selectedIds, selectedContactId, loadFlowData, setContacts, setSelectedIds, setSelectMode, setSelectedContactId, setContactDetail]);

  const selectedContactsForBroadcast = useMemo(
    () => contacts.filter((c) => selectedIds.has(c.id)) as ContactCardData[],
    [contacts, selectedIds],
  );

  return {
    showAddForm, setShowAddForm,
    editingContact, setEditingContact,
    showAddMenu, setShowAddMenu,
    showBroadcast, setShowBroadcast,
    showGuide, setShowGuide,
    confirmState, setConfirmState,
    selectedContactsForBroadcast,
    handleSubmitContact, handleAddNote, handleAddTask, handleCompleteTask,
    handleDeleteNote, handleDeleteTask, handleUpdateStatus, handleLogEvent,
    handleEditContact, handleDeleteContact,
    handleImportFile, handleImportLink, handleDeviceImport,
    handleUpdateNote, handleUpdateTask,
    handleQuickAction, handleViewExpiringQuotes, handleViewOverdueInvoices,
    handleBulkStatusChange, handleBulkTag, handleBulkDelete,
  };
}
