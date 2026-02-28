"use client";

import React from "react";
import { Plus, Users, RefreshCw } from "lucide-react";
import { ContactCard, ContactCardData } from "@/components/contacts";
import type { QuickActionType } from "@/components/contacts";
import type { ListTab } from "./pipeline-toolbar";

export interface PipelineContactListProps {
  contacts: ContactCardData[];
  loading: boolean;
  hasMore: boolean;
  activeListTab: ListTab;
  selectedContactId: string | null;
  selectMode: boolean;
  selectedIds: Set<string>;
  pinnedIds: string[];
  onSelectContact: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onTogglePin: (id: string) => void;
  onDelete: (contact?: ContactCardData) => void;
  onQuickAction: (contactId: string, action: QuickActionType) => void;
  onLoadMore: () => void;
  onAddContact: () => void;
}

function PipelineContactListInner({
  contacts,
  loading,
  hasMore,
  activeListTab,
  selectedContactId,
  selectMode,
  selectedIds,
  pinnedIds,
  onSelectContact,
  onToggleSelect,
  onTogglePin,
  onDelete,
  onQuickAction,
  onLoadMore,
  onAddContact,
}: PipelineContactListProps) {
  if (loading && contacts.length === 0) {
    return (
      <div className="kf-card p-8 text-center">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto text-muted-foreground mb-3" />
        <p className="text-muted-foreground">Loading contacts...</p>
      </div>
    );
  }

  if (contacts.length === 0) {
    return (
      <div className="kf-card p-8 text-center">
        <Users className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
        <p className="text-lg font-medium mb-1">
          {activeListTab === "pinned" ? "No pinned contacts" : activeListTab === "recent" ? "No recent contacts" : "No contacts yet"}
        </p>
        <p className="text-muted-foreground mb-4">
          {activeListTab === "pinned"
            ? "Pin your most important contacts for quick access"
            : activeListTab === "recent"
            ? "Your recently viewed contacts will appear here"
            : "Add your first contact to get started"}
        </p>
        {activeListTab === "all" && (
          <button
            onClick={onAddContact}
            className="kf-btn-primary inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Contact
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {contacts.map((contact, index) => (
        <ContactCard
          key={contact.id}
          contact={contact}
          isSelected={selectedContactId === contact.id}
          selectable={selectMode}
          selected={selectedIds.has(contact.id)}
          onToggleSelect={onToggleSelect}
          isPinned={pinnedIds.includes(contact.id)}
          onTogglePin={onTogglePin}
          onClick={() => onSelectContact(contact.id)}
          onDelete={onDelete}
          onQuickAction={onQuickAction}
          index={index}
        />
      ))}
      {activeListTab === "all" && hasMore && (
        <button
          onClick={onLoadMore}
          disabled={loading}
          className="w-full kf-btn-secondary py-3"
        >
          {loading ? "Loading..." : "Load More"}
        </button>
      )}
    </div>
  );
}

export const PipelineContactList = React.memo(PipelineContactListInner);
