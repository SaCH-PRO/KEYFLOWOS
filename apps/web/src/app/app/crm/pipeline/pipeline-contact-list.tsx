"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Users, RefreshCw, AlertTriangle, X, Loader2, Mail, Phone, User } from "lucide-react";
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
  onQuickCreate?: (data: { firstName: string; lastName?: string; email?: string; phone?: string }) => Promise<void>;
}

function QuickAddRow({ onSubmit, onCancel }: { onSubmit: (data: { firstName: string; lastName?: string; email?: string; phone?: string }) => Promise<void>; onCancel: () => void }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  const handleSubmit = async () => {
    if (!firstName.trim()) return;
    setSaving(true);
    try {
      await onSubmit({
        firstName: firstName.trim(),
        lastName: lastName.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      setFirstName("");
      setLastName("");
      setEmail("");
      setPhone("");
      firstRef.current?.focus();
    } catch {
      // error handled by parent
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="kf-card p-3 space-y-2" style={{ borderColor: "hsl(var(--kf-accent1) / 0.3)", background: "hsl(var(--kf-accent1) / 0.03)" }}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "hsl(var(--kf-accent1))" }}>
          <Plus className="w-3 h-3" /> Quick Add Client
        </span>
        <button onClick={onCancel} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-muted/50">
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="relative">
          <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
          <input
            ref={firstRef}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="First name *"
            className="kf-input w-full text-xs pl-7"
            onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); if (e.key === "Escape") onCancel(); }}
          />
        </div>
        <input
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          placeholder="Last name"
          className="kf-input w-full text-xs"
          onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); if (e.key === "Escape") onCancel(); }}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="relative">
          <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            type="email"
            className="kf-input w-full text-xs pl-7"
            onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); if (e.key === "Escape") onCancel(); }}
          />
        </div>
        <div className="relative">
          <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone"
            className="kf-input w-full text-xs pl-7"
            onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); if (e.key === "Escape") onCancel(); }}
          />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground/50">Press Enter to save, Esc to cancel</span>
        <button
          onClick={handleSubmit}
          disabled={!firstName.trim() || saving}
          className="inline-flex items-center gap-1.5 px-3 min-h-[44px] text-xs font-medium rounded-lg text-white transition-all disabled:opacity-40"
          style={{ background: firstName.trim() && !saving ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-accent1) / 0.4)" }}
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          {saving ? "Adding..." : "Add"}
        </button>
      </div>
    </div>
  );
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
  onQuickCreate,
}: PipelineContactListProps) {
  const [showQuickAdd, setShowQuickAdd] = useState(false);
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
    return <CardListSkeleton rows={4} />;
  }

  if (loadError && contacts.length === 0) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card p-10 text-center" role="alert">
        <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center mx-auto mb-3">
          <AlertTriangle className="w-5 h-5 text-red-400/70" />
        </div>
        <p className="text-sm font-semibold tracking-tight mb-1">Could not load clients</p>
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

  const quickAddRow = onQuickCreate && activeListTab === "all" && (
    showQuickAdd ? (
      <QuickAddRow onSubmit={onQuickCreate} onCancel={() => setShowQuickAdd(false)} />
    ) : (
      <button
        onClick={() => setShowQuickAdd(true)}
        className="w-full kf-card p-2.5 flex items-center justify-center gap-1.5 text-xs font-medium transition-all hover:border-[hsl(var(--kf-accent1)/0.3)] min-h-[44px]"
        style={{ color: "hsl(var(--kf-accent1))", borderStyle: "dashed" }}
      >
        <Plus className="w-3.5 h-3.5" />
        Quick Add Client
      </button>
    )
  );

  if (contacts.length === 0) {
    return (
      <div className="space-y-3">
        {quickAddRow}
        <EmptyState
          icon={Users}
          title={activeListTab === "pinned" ? "No pinned clients" : activeListTab === "recent" ? "No recent clients" : "No clients yet"}
          description={
            activeListTab === "pinned"
              ? "Pin your most important clients for quick access"
              : activeListTab === "recent"
              ? "Your recently viewed clients will appear here"
              : "Add your first client to get started"
          }
          actionLabel={activeListTab === "all" ? "Add Client" : undefined}
          onAction={activeListTab === "all" ? onAddContact : undefined}
          tip={activeListTab === "all" ? "Clients are the heart of your CRM — add clients, leads, and partners to track relationships and activity." : undefined}
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
        isFavorite={favoriteIds?.has(contact.id)}
        onToggleFavorite={onToggleFavorite}
        onClick={() => onSelectContact(contact.id)}
        onDelete={onDelete}
        onQuickAction={onQuickAction}
        index={absoluteIndex}
      />
    </div>
  );

  if (isVirtual) {
    return (
      <div className="space-y-3">
        {quickAddRow}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          role="listbox"
          aria-label="Clients list"
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
      {quickAddRow}
      <div
        ref={listRef}
        role="listbox"
        aria-label="Clients list"
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
