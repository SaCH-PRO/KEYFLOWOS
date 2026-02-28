"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Users, RefreshCw } from "lucide-react";
import { ContactCard, ContactCardData } from "@/components/contacts";
import type { QuickActionType } from "@/components/contacts";
import type { ListTab } from "./pipeline-toolbar";

const ITEM_HEIGHT = 140;
const ITEM_GAP = 12;
const ROW_HEIGHT = ITEM_HEIGHT + ITEM_GAP;
const BUFFER_COUNT = 5;
const VIRTUAL_SCROLL_THRESHOLD = 30;

function useVirtualScroll(itemCount: number, enabled: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (el) setScrollTop(el.scrollTop);
  }, []);

  if (!enabled) {
    return {
      containerRef,
      startIndex: 0,
      endIndex: itemCount - 1,
      totalHeight: 0,
      offsetY: 0,
      isVirtual: false,
      handleScroll,
    };
  }

  const totalHeight = itemCount * ROW_HEIGHT - ITEM_GAP;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_COUNT);
  const visibleCount = Math.ceil(containerHeight / ROW_HEIGHT);
  const endIndex = Math.min(itemCount - 1, startIndex + visibleCount + BUFFER_COUNT * 2);
  const offsetY = startIndex * ROW_HEIGHT;

  return {
    containerRef,
    startIndex,
    endIndex,
    totalHeight,
    offsetY,
    isVirtual: true,
    handleScroll,
  };
}

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
  const enableVirtual = contacts.length >= VIRTUAL_SCROLL_THRESHOLD;
  const {
    containerRef,
    startIndex,
    endIndex,
    totalHeight,
    offsetY,
    isVirtual,
    handleScroll,
  } = useVirtualScroll(contacts.length, enableVirtual);

  const [focusedIndex, setFocusedIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLElement>>(new Map());

  useEffect(() => {
    setFocusedIndex(-1);
  }, [contacts.length, activeListTab]);

  const scrollItemIntoView = useCallback((index: number) => {
    const el = itemRefs.current.get(index);
    if (el) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } else if (isVirtual && containerRef.current) {
      const targetTop = index * ROW_HEIGHT;
      containerRef.current.scrollTo({ top: targetTop, behavior: "smooth" });
    }
  }, [isVirtual, containerRef]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (contacts.length === 0) return;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const next = Math.min(focusedIndex + 1, contacts.length - 1);
          setFocusedIndex(next);
          scrollItemIntoView(next);
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const prev = Math.max(focusedIndex - 1, 0);
          setFocusedIndex(prev);
          scrollItemIntoView(prev);
          break;
        }
        case "Enter": {
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < contacts.length) {
            onSelectContact(contacts[focusedIndex].id);
          }
          break;
        }
      }
    },
    [contacts, focusedIndex, onSelectContact, scrollItemIntoView]
  );

  const setItemRef = useCallback((index: number, el: HTMLElement | null) => {
    if (el) {
      itemRefs.current.set(index, el);
    } else {
      itemRefs.current.delete(index);
    }
  }, []);

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

  const visibleContacts = isVirtual
    ? contacts.slice(startIndex, endIndex + 1)
    : contacts;

  const loadMoreButton = activeListTab === "all" && hasMore && (
    <button
      onClick={onLoadMore}
      disabled={loading}
      className="w-full kf-btn-secondary py-3"
    >
      {loading ? "Loading..." : "Load More"}
    </button>
  );

  const renderContactItem = (contact: ContactCardData, absoluteIndex: number) => (
    <div
      key={contact.id}
      ref={(el) => setItemRef(absoluteIndex, el)}
      role="option"
      aria-selected={selectedContactId === contact.id}
      data-focused={focusedIndex === absoluteIndex || undefined}
      className={focusedIndex === absoluteIndex ? "ring-2 ring-primary rounded-lg" : ""}
    >
      <ContactCard
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
        index={absoluteIndex}
      />
    </div>
  );

  if (isVirtual) {
    return (
      <div
        ref={containerRef}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        role="listbox"
        aria-label="Contacts list"
        tabIndex={0}
        className="max-h-[calc(100vh-16rem)] overflow-y-auto outline-none"
        style={{ willChange: "transform" }}
      >
        <div style={{ height: totalHeight, position: "relative" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${offsetY}px)` }}>
            <div className="space-y-3">
              {visibleContacts.map((contact, i) => renderContactItem(contact, startIndex + i))}
            </div>
          </div>
        </div>
        {loadMoreButton}
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Contacts list"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="space-y-3 outline-none"
    >
      {visibleContacts.map((contact, index) => renderContactItem(contact, index))}
      {loadMoreButton}
    </div>
  );
}

export const PipelineContactList = React.memo(PipelineContactListInner);
