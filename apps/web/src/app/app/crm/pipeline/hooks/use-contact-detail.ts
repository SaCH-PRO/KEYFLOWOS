"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContactDetailData } from "@/components/contacts/contact-detail";
import type { ContactEvent, ContactNote, ContactTask } from "@/components/contacts/contact-detail";
import type { HealthMetrics } from "@/components/contacts/contact-health-score";
import type { JourneyMilestone } from "@/components/contacts/relationship-timeline";
import type { ConversationContextData } from "@/components/contacts/conversation-context";
import type { AiInsight } from "@/components/contacts/ai-copilot";
import type { Contact, ContactDetail as ContactDetailAPI, CrossJourneyResponse } from "@/lib/client";
import {
  fetchContactDetail,
  fetchContactHealthMetrics,
  fetchContactJourney,
  fetchConversationContext,
  generateAiInsight,
  fetchContactCrossJourney,
} from "@/lib/client";

export function useContactDetail(businessId: string | null, contacts: Contact[]) {
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [contactDetail, setContactDetail] = useState<ContactDetailAPI | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [showMobileDetail, setShowMobileDetail] = useState(false);

  const [healthMetrics, setHealthMetrics] = useState<HealthMetrics | null>(null);
  const [journeyMilestones, setJourneyMilestones] = useState<JourneyMilestone[]>([]);
  const [crossJourney, setCrossJourney] = useState<CrossJourneyResponse | null>(null);
  const [conversationContext, setConversationContext] = useState<ConversationContextData | null>(null);
  const [aiInsight, setAiInsight] = useState<AiInsight | null>(null);
  const [aiInsightLoading, setAiInsightLoading] = useState(false);

  const detailAbortRef = useRef<AbortController | null>(null);
  const aiAbortRef = useRef<AbortController | null>(null);

  const loadDetail = useCallback(
    async (contactId: string) => {
      if (!businessId) return;

      if (detailAbortRef.current) {
        detailAbortRef.current.abort();
      }
      const controller = new AbortController();
      detailAbortRef.current = controller;
      const { signal } = controller;

      setDetailLoading(true);
      setDetailError(null);
      setCrossJourney(null);
      setHealthMetrics(null);
      setJourneyMilestones([]);
      setConversationContext(null);
      setAiInsight(null);
      try {
        const results = await Promise.allSettled([
          fetchContactDetail(contactId, businessId, { signal }),
          fetchContactHealthMetrics(contactId, businessId, { signal }),
          fetchContactJourney(contactId, businessId, { signal }),
          fetchConversationContext(contactId, businessId, { signal }),
          fetchContactCrossJourney(contactId, businessId, { signal }),
        ]);
        if (signal.aborted) return;

        const allFailed = results.every((r) => r.status === "rejected");
        if (allFailed) {
          setDetailError("Failed to load contact details. Please try again.");
          return;
        }

        if (results[0].status === "fulfilled") {
          setContactDetail(results[0].value.data ?? null);
        } else {
          setDetailError("Failed to load contact details. Please try again.");
        }
        if (results[1].status === "fulfilled" && results[1].value.data) setHealthMetrics(results[1].value.data);
        if (results[2].status === "fulfilled" && results[2].value.data) setJourneyMilestones(results[2].value.data);
        if (results[3].status === "fulfilled" && results[3].value.data) setConversationContext(results[3].value.data);
        if (results[4].status === "fulfilled" && results[4].value.data) setCrossJourney(results[4].value.data);
        setAiInsight(null);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!signal.aborted) {
          setDetailError("Failed to load contact details. Please try again.");
        }
      } finally {
        if (!signal.aborted) {
          setDetailLoading(false);
        }
      }
    },
    [businessId],
  );

  const selectContact = useCallback(
    (contactId: string, trackRecent?: (id: string) => void) => {
      setSelectedContactId(contactId);
      trackRecent?.(contactId);
      void loadDetail(contactId);
      if (window.innerWidth < 1024) setShowMobileDetail(true);
    },
    [loadDetail],
  );

  const handleGenerateAiInsight = useCallback(async () => {
    if (!selectedContactId || !businessId) return;
    if (aiAbortRef.current) aiAbortRef.current.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    setAiInsightLoading(true);
    try {
      const { data } = await generateAiInsight(selectedContactId, businessId, { signal: controller.signal });
      if (!controller.signal.aborted && data) setAiInsight(data);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    } finally {
      if (!controller.signal.aborted) setAiInsightLoading(false);
    }
  }, [selectedContactId, businessId]);

  const handleRefreshConversationContext = useCallback(async () => {
    if (!selectedContactId || !businessId) return;
    const currentSignal = detailAbortRef.current?.signal;
    try {
      const { data } = await fetchConversationContext(selectedContactId, businessId, { signal: currentSignal });
      if (!currentSignal?.aborted && data) setConversationContext(data);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
  }, [selectedContactId, businessId]);

  useEffect(() => {
    if (contacts.length > 0 && !selectedContactId) {
      setSelectedContactId(contacts[0].id);
      void loadDetail(contacts[0].id);
    }
  }, [contacts, selectedContactId, loadDetail]);

  useEffect(() => {
    return () => {
      if (detailAbortRef.current) detailAbortRef.current.abort();
      if (aiAbortRef.current) aiAbortRef.current.abort();
    };
  }, []);

  const selectedContact = useMemo<ContactDetailData | null>(() => {
    if (!contactDetail?.contact) return null;
    return { ...contactDetail.contact, tags: contactDetail.contact.tags ?? [] } as ContactDetailData;
  }, [contactDetail]);

  const detailEvents: ContactEvent[] = useMemo(() => contactDetail?.events ?? [], [contactDetail]);
  const detailNotes: ContactNote[] = useMemo(() => contactDetail?.notes ?? [], [contactDetail]);
  const detailTasks: ContactTask[] = useMemo(() => (contactDetail?.tasks ?? []).map((t) => ({
    id: t.id, title: t.title, status: t.status ?? null, priority: t.priority ?? null,
    dueDate: t.dueDate ?? null, remindAt: t.remindAt ?? null,
    completedAt: t.completedAt ?? null, source: t.source ?? null, createdAt: t.createdAt ?? null,
  })), [contactDetail]);
  const detailInvoices = useMemo(() => contactDetail?.invoices ?? [], [contactDetail]);
  const detailBookings = useMemo(() => contactDetail?.bookings ?? [], [contactDetail]);

  const contactName = selectedContact
    ? `${selectedContact.firstName ?? ""} ${selectedContact.lastName ?? ""}`.trim() || "Contact"
    : "Contact";

  return {
    selectedContactId, setSelectedContactId,
    contactDetail, setContactDetail,
    detailLoading, detailError,
    showMobileDetail, setShowMobileDetail,
    healthMetrics, journeyMilestones, crossJourney, conversationContext,
    aiInsight, aiInsightLoading,
    selectedContact, detailEvents, detailNotes, detailTasks, detailInvoices, detailBookings, contactName,
    loadDetail, selectContact,
    handleGenerateAiInsight, handleRefreshConversationContext,
  };
}
