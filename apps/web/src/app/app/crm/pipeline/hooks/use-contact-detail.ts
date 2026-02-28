"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ContactDetailData } from "@/components/contacts/contact-detail";
import type { ContactEvent, ContactNote, ContactTask } from "@/components/contacts/contact-detail";
import type { HealthMetrics } from "@/components/contacts/contact-health-score";
import type { JourneyMilestone } from "@/components/contacts/relationship-timeline";
import type { ConversationContextData } from "@/components/contacts/conversation-context";
import type { AiInsight } from "@/components/contacts/ai-copilot";
import type { Contact, ContactDetail as ContactDetailAPI } from "@/lib/client";
import {
  fetchContactDetail, fetchContactHealthMetrics, fetchContactJourney,
  fetchConversationContext, generateAiInsight,
} from "@/lib/client";

export function useContactDetail(businessId: string | null, contacts: Contact[]) {
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [contactDetail, setContactDetail] = useState<ContactDetailAPI | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showMobileDetail, setShowMobileDetail] = useState(false);

  const [healthMetrics, setHealthMetrics] = useState<HealthMetrics | null>(null);
  const [journeyMilestones, setJourneyMilestones] = useState<JourneyMilestone[]>([]);
  const [conversationContext, setConversationContext] = useState<ConversationContextData | null>(null);
  const [aiInsight, setAiInsight] = useState<AiInsight | null>(null);
  const [aiInsightLoading, setAiInsightLoading] = useState(false);

  const loadContactEnhancements = useCallback(
    async (contactId: string) => {
      if (!businessId) return;
      const [healthRes, journeyRes, contextRes] = await Promise.all([
        fetchContactHealthMetrics(contactId, businessId),
        fetchContactJourney(contactId, businessId),
        fetchConversationContext(contactId, businessId),
      ]);
      if (healthRes.data) setHealthMetrics(healthRes.data);
      if (journeyRes.data) setJourneyMilestones(journeyRes.data);
      if (contextRes.data) setConversationContext(contextRes.data);
      setAiInsight(null);
    },
    [businessId],
  );

  const loadDetail = useCallback(
    async (contactId: string) => {
      if (!businessId) return;
      setDetailLoading(true);
      const { data } = await fetchContactDetail(contactId, businessId);
      setContactDetail(data ?? null);
      setDetailLoading(false);
      void loadContactEnhancements(contactId);
    },
    [businessId, loadContactEnhancements],
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
    setAiInsightLoading(true);
    const { data } = await generateAiInsight(selectedContactId, businessId);
    if (data) setAiInsight(data);
    setAiInsightLoading(false);
  }, [selectedContactId, businessId]);

  const handleRefreshConversationContext = useCallback(async () => {
    if (selectedContactId && businessId) {
      const { data } = await fetchConversationContext(selectedContactId, businessId);
      if (data) setConversationContext(data);
    }
  }, [selectedContactId, businessId]);

  useEffect(() => {
    if (contacts.length > 0 && !selectedContactId) {
      setSelectedContactId(contacts[0].id);
      void loadDetail(contacts[0].id);
    }
  }, [contacts, selectedContactId, loadDetail]);

  const selectedContact = useMemo<ContactDetailData | null>(() => {
    if (!contactDetail?.contact) return null;
    return { ...contactDetail.contact, tags: contactDetail.contact.tags ?? [] } as ContactDetailData;
  }, [contactDetail]);

  const detailEvents: ContactEvent[] = contactDetail?.events ?? [];
  const detailNotes: ContactNote[] = contactDetail?.notes ?? [];
  const detailTasks: ContactTask[] = (contactDetail?.tasks ?? []).map((t) => ({
    id: t.id, title: t.title, status: t.status ?? null, priority: t.priority ?? null,
    dueDate: t.dueDate ?? null, remindAt: t.remindAt ?? null,
    completedAt: t.completedAt ?? null, source: t.source ?? null, createdAt: t.createdAt ?? null,
  }));

  const contactName = selectedContact
    ? `${selectedContact.firstName ?? ""} ${selectedContact.lastName ?? ""}`.trim() || "Contact"
    : "Contact";

  return {
    selectedContactId, setSelectedContactId,
    contactDetail, setContactDetail,
    detailLoading,
    showMobileDetail, setShowMobileDetail,
    healthMetrics, journeyMilestones, conversationContext,
    aiInsight, aiInsightLoading,
    selectedContact, detailEvents, detailNotes, detailTasks, contactName,
    loadDetail, selectContact, loadContactEnhancements,
    handleGenerateAiInsight, handleRefreshConversationContext,
  };
}
