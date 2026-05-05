"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContactDetailData } from "@/components/contacts/contact-detail";
import type { ContactEvent, ContactNote, ContactTask } from "@/components/contacts/contact-detail";
import type { HealthMetrics } from "@/components/contacts/contact-health-score";
import type { JourneyMilestone } from "@/components/contacts/relationship-timeline";
import type { ConversationContextData } from "@/components/contacts/conversation-context";
import type { AiInsight } from "@/components/contacts/ai-copilot";
import type { Contact, ContactDetail as ContactDetailAPI, ContactInsightSnapshot, CrossJourneyResponse } from "@/lib/client";
import {
  fetchContactDetail,
  fetchContactHealthMetrics,
  fetchContactJourney,
  fetchConversationContext,
  fetchContactInsightSnapshot,
  recomputeContactInsightSnapshot,
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
  const [insightSnapshot, setInsightSnapshot] = useState<ContactInsightSnapshot | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);

  const detailAbortRef = useRef<AbortController | null>(null);
  const aiAbortRef = useRef<AbortController | null>(null);
  const insightAbortRef = useRef<AbortController | null>(null);
  const insightPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setInsightSnapshot(null);
      if (insightPollRef.current) {
        clearTimeout(insightPollRef.current);
        insightPollRef.current = null;
      }
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

  const loadInsightSnapshot = useCallback(
    async (contactId: string, options: { force?: boolean } = {}) => {
      if (!businessId) return;
      if (insightAbortRef.current) insightAbortRef.current.abort();
      const controller = new AbortController();
      insightAbortRef.current = controller;
      setInsightLoading(true);
      try {
        const { data } = options.force
          ? await recomputeContactInsightSnapshot(contactId, businessId, { signal: controller.signal })
          : await fetchContactInsightSnapshot(contactId, businessId, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (data) {
          setInsightSnapshot(data);
          if (data.stale && !options.force) {
            if (insightPollRef.current) clearTimeout(insightPollRef.current);
            insightPollRef.current = setTimeout(() => {
              void loadInsightSnapshot(contactId);
            }, 4000);
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      } finally {
        if (!controller.signal.aborted) setInsightLoading(false);
      }
    },
    [businessId],
  );

  const handleRecomputeInsight = useCallback(async () => {
    if (!selectedContactId) return;
    await loadInsightSnapshot(selectedContactId, { force: true });
  }, [selectedContactId, loadInsightSnapshot]);

  const selectContact = useCallback(
    (contactId: string, trackRecent?: (id: string) => void) => {
      setSelectedContactId(contactId);
      trackRecent?.(contactId);
      void loadDetail(contactId);
      void loadInsightSnapshot(contactId);
      if (window.innerWidth < 1024) setShowMobileDetail(true);
    },
    [loadDetail, loadInsightSnapshot],
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

  const hasAutoSelectedRef = useRef(false);
  useEffect(() => {
    if (hasAutoSelectedRef.current) return;
    if (contacts.length > 0 && !selectedContactId) {
      hasAutoSelectedRef.current = true;
      setSelectedContactId(contacts[0].id);
      void loadDetail(contacts[0].id);
    }
  }, [contacts, selectedContactId, loadDetail]);

  useEffect(() => {
    return () => {
      if (detailAbortRef.current) detailAbortRef.current.abort();
      if (aiAbortRef.current) aiAbortRef.current.abort();
      if (insightAbortRef.current) insightAbortRef.current.abort();
      if (insightPollRef.current) clearTimeout(insightPollRef.current);
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
    insightSnapshot, insightLoading, handleRecomputeInsight,
    selectedContact, detailEvents, detailNotes, detailTasks, detailInvoices, detailBookings, contactName,
    loadDetail, selectContact,
    handleGenerateAiInsight, handleRefreshConversationContext,
  };
}
