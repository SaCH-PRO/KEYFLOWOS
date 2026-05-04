"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Users, RefreshCw, AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { CardListSkeleton } from "@/components/ui/skeleton";
import { ContactCard, ContactCardData } from "@/components/contacts";
import type { QuickActionType } from "@/components/contacts";
import type { ListTab } from "./pipeline-toolbar";

const ITEM_HEIGHT = 148;
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
  loadError?: string | null;
  hasMore: boolean;
  activeListTab: ListTab;
  selectedContactId: string | null;
  selectMode: boolean;
  selectedIds: Set<string>;
  pinnedIds: string[];
  favoriteIds?: Set<string>;
  onSelectContact: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onTogglePin: (id: string) => void;
  onToggleFavorite?: (id: string) => void;
  onDelete: (contact?: ContactCardData) => void;
  onQuickAction: (contactId: string, action: QuickActionType) => void;
  onLoadMore: () => void;
  onRetry?: () => void;
  onAddContact: () => void;
  expandedPanel?: React.ReactNode;
  onCollapse?: () => void;
}

function PipelineContactListInner({
  contacts,
  loading,
  loadError,
  hasMore,
  activeListTab,
  selectedContactId,
  selectMode,
  selectedIds,
  pinnedIds,
  favoriteIds,
  onSelectContact,
  onToggleSelect,
  onTogglePin,
  onToggleFavorite,
  onDelete,
  onQuickAction,
  onLoadMore,
  onRetry,
  onAddContact,
  expandedPanel,
  onCollapse,
}: PipelineContactListProps) {
  const hasExpansion = expandedPanel != null && selectedContactId != null;
  const enableVirtual = contacts.length >= VIRTUAL_SCROLL_THRESHOLD && !hasExpansion;
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
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
        case "Enter":
        case " ": {
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < contacts.length) {
            onSelectContact(contacts[focusedIndex].id);
          }
          break;
        }
        case "Escape": {
          if (selectedContactId && onCollapse) {
            e.preventDefault();
            onCollapse();
          }
          break;
        }
      }
    },
    [contacts, focusedIndex, onSelectContact, scrollItemIntoView, selectedContactId, onCollapse]
  );

  const expandedRowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selectedContactId || !expandedPanel) return;
    const id = window.requestAnimationFrame(() => {
      const el = expandedRowRef.current;
      if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(id);
  }, [selectedContactId, expandedPanel]);

  const setItemRef = useCallback((index: number, el: HTMLElement | null) => {
    if (el) {
      itemRefs.current.set(index, el);
    } else {
      itemRefs.current.delete(index);
    }
  }, []);

  if (loading && contacts.length === 0) {
    return <CardListSkeleton rows={4} />;
  }

  if (loadError && contacts.length === 0) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card p-10 text-center" role="alert">
        <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center mx-auto mb-3">
          <AlertTriangle className="w-5 h-5 text-red-400/70" />
        </div>
        <p className="text-sm font-semibold tracking-tight mb-1">Could not load contacts</p>
        <p className="text-xs text-muted-foreground/60 mb-4">{loadError}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-gradient-to-r from-[hsl(var(--kf-accent1))]/15 to-[hsl(var(--kf-accent1))]/5 text-[hsl(var(--kf-accent1))] hover:from-[hsl(var(--kf-accent1))]/25 hover:to-[hsl(var(--kf-accent1))]/10 transition-all"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Try Again
          </button>
        )}
      </div>
    );
  }

  if (contacts.length === 0) {
    return (
      <div className="space-y-3">
        <EmptyState
          icon={Users}
          title={activeListTab === "pinned" ? "No pinned contacts" : activeListTab === "recent" ? "No recent contacts" : "No contacts yet"}
          description={
            activeListTab === "pinned"
              ? "Pin your most important contacts for quick access"
              : activeListTab === "recent"
              ? "Your recently viewed contacts will appear here"
              : "Add your first contact to get started"
          }
          actionLabel={activeListTab === "all" ? "Add contact" : undefined}
          onAction={activeListTab === "all" ? onAddContact : undefined}
          tip={activeListTab === "all" ? "Contacts are the heart of your CRM — add contacts, leads, and partners to track relationships and activity." : undefined}
        />
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

  const renderContactItem = (contact: ContactCardData, absoluteIndex: number) => {
    const isExpanded = selectedContactId === contact.id && expandedPanel != null;
    return (
      <div key={contact.id} ref={isExpanded ? expandedRowRef : undefined}>
        <div
          ref={(el) => setItemRef(absoluteIndex, el)}
          role="option"
          aria-selected={selectedContactId === contact.id}
          data-expanded={isExpanded || undefined}
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
            isFavorite={favoriteIds?.has(contact.id)}
            onToggleFavorite={onToggleFavorite}
            onClick={() => {
              if (selectMode) onToggleSelect(contact.id);
              else onSelectContact(contact.id);
            }}
            onDelete={onDelete}
            onQuickAction={onQuickAction}
            index={absoluteIndex}
          />
        </div>
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              key="expanded-panel"
              role="region"
              aria-label="Contact details"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden"
            >
              <div className="pt-3">{expandedPanel}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  if (isVirtual) {
    return (
      <div className="space-y-3">
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
      </div>
    );
  }

  return (
    <div className="space-y-3">
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
    </div>
  );
}

export const PipelineContactList = React.memo(PipelineContactListInner);
