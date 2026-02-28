"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { MessageSquare } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ContactDetailHeader } from "./contact-detail-header";
import { ContactDetailStats } from "./contact-detail-stats";
import { ContactDetailInfo } from "./contact-detail-info";
import { ContactDetailTabs } from "./contact-detail-tabs";

export type ContactDetailData = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  industry?: string | null;
  status?: string | null;
  source?: string | null;
  sourceDetail?: string | null;
  preferredChannel?: string | null;
  tags?: string[];
  displayName?: string | null;
  secondaryEmail?: string | null;
  secondaryPhone?: string | null;
  whatsappNumber?: string | null;
  language?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  timezone?: string | null;
  segment?: string | null;
  lifecycleStage?: string | null;
  marketingOptIn?: boolean | null;
  doNotContact?: boolean | null;
  notesInternal?: string | null;
  createdAt?: string | null;
  meta?: {
    leadScore?: number | null;
    outstandingBalance?: number | null;
    totalRevenue?: number | null;
    invoiceCount?: number | null;
    bookingCount?: number | null;
    lastInteractionAt?: string | null;
    nextDueTaskAt?: string | null;
  } | null;
};

export type ContactEvent = {
  id: string;
  type: string;
  createdAt: string;
  data?: unknown;
};

export type ContactNote = {
  id: string;
  body: string;
  createdAt: string;
  source?: string | null;
};

export type ContactTask = {
  id: string;
  title: string;
  status?: string | null;
  dueDate?: string | null;
};

export type DetailQuickAction = "create-invoice" | "book-appointment" | "send-quote";

interface ContactDetailProps {
  contact: ContactDetailData | null;
  events?: ContactEvent[];
  notes?: ContactNote[];
  tasks?: ContactTask[];
  loading?: boolean;
  isPinned?: boolean;
  onTogglePin?: (id: string) => void;
  onClose?: () => void;
  onAddNote?: (body: string) => Promise<void>;
  onAddTask?: (title: string, dueDate?: string) => Promise<void>;
  onCompleteTask?: (taskId: string) => Promise<void>;
  onDeleteNote?: (noteId: string) => Promise<void>;
  onDeleteTask?: (taskId: string) => Promise<void>;
  onUpdateStatus?: (status: string) => Promise<void>;
  onEdit?: () => void;
  onDelete?: () => void;
  onQuickAction?: (contactId: string, action: DetailQuickAction) => void;
  onLogEvent?: (type: string, description?: string) => Promise<void>;
}

export function ContactDetail({
  contact,
  events = [],
  notes = [],
  tasks = [],
  loading,
  isPinned,
  onTogglePin,
  onClose,
  onAddNote,
  onAddTask,
  onCompleteTask,
  onDeleteNote,
  onDeleteTask,
  onUpdateStatus,
  onEdit,
  onDelete,
  onQuickAction,
  onLogEvent,
}: ContactDetailProps) {
  const [activeTab, setActiveTab] = useState<string>("notes");
  const [confirmState, setConfirmState] = useState<{ open: boolean; action: () => void }>({
    open: false,
    action: () => {},
  });

  if (loading) {
    return (
      <div className="kf-card p-6 flex items-center justify-center min-h-[300px]">
        <div className="text-muted-foreground text-sm">Loading contact...</div>
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="kf-card p-6 flex flex-col items-center justify-center min-h-[300px] text-center">
        <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <MessageSquare className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground">Select a contact to view details</p>
      </div>
    );
  }

  const handleDeleteClick = () => {
    if (!onDelete) return;
    setConfirmState({
      open: true,
      action: () => {
        onDelete();
      },
    });
  };

  const handleDeleteNote = (noteId: string) => {
    if (!onDeleteNote) return;
    setConfirmState({
      open: true,
      action: async () => {
        await onDeleteNote(noteId);
      },
    });
  };

  const handleDeleteTask = (taskId: string) => {
    if (!onDeleteTask) return;
    setConfirmState({
      open: true,
      action: async () => {
        await onDeleteTask(taskId);
      },
    });
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="kf-card p-5 space-y-4 h-full overflow-y-auto"
      >
        <ContactDetailHeader
          contact={contact}
          isPinned={isPinned}
          onTogglePin={onTogglePin}
          onClose={onClose}
          onEdit={onEdit}
          onDelete={onDelete ? handleDeleteClick : undefined}
          onUpdateStatus={onUpdateStatus}
          onQuickAction={onQuickAction}
        />

        <ContactDetailStats
          contact={contact}
          events={events}
          onSetActiveTab={setActiveTab}
          onQuickAction={onQuickAction}
        />

        <ContactDetailInfo contact={contact} />

        <ContactDetailTabs
          contact={contact}
          events={events}
          notes={notes}
          tasks={tasks}
          activeTab={activeTab}
          onSetActiveTab={setActiveTab}
          onAddNote={onAddNote}
          onAddTask={onAddTask}
          onCompleteTask={onCompleteTask}
          onDeleteNote={onDeleteNote ? handleDeleteNote : undefined}
          onDeleteTask={onDeleteTask ? handleDeleteTask : undefined}
          onLogEvent={onLogEvent}
        />
      </motion.div>

      <ConfirmDialog
        open={confirmState.open}
        title="Confirm Delete"
        message="Are you sure? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          confirmState.action();
          setConfirmState({ open: false, action: () => {} });
        }}
        onCancel={() => setConfirmState({ open: false, action: () => {} })}
      />
    </>
  );
}
