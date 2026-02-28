"use client";

import { useCallback, useEffect, useMemo } from "react";
import type { ContactCardData } from "@/components/contacts/contact-card";
import type { NextAction as NextActionUI } from "@/components/contacts/next-action-queue";
import type { PipelineDetailPanelProps } from "./pipeline-detail-panel";
import { useContactsData } from "./hooks/use-contacts-data";
import { useContactDetail } from "./hooks/use-contact-detail";
import { useContactActions } from "./hooks/use-contact-actions";
import { useFlowIntelligence } from "./hooks/use-flow-intelligence";

export function useContactsPipeline() {
  const contactsData = useContactsData();
  const {
    businessId, contacts, setContacts, loading,
    isPending, startTransition,
    selectedIds, setSelectedIds, setSelectMode,
    loadContacts, trackRecent,
  } = contactsData;

  const detail = useContactDetail(businessId, contacts);
  const {
    selectedContactId, setSelectedContactId,
    contactDetail, setContactDetail,
    showMobileDetail, setShowMobileDetail,
    loadDetail, detailError,
  } = detail;

  const flow = useFlowIntelligence(businessId);
  const { loadFlowData } = flow;

  const actions = useContactActions({
    businessId, contacts, setContacts,
    selectedContactId, setSelectedContactId,
    contactDetail, setContactDetail,
    selectedIds, setSelectedIds, setSelectMode,
    setShowMobileDetail: detail.setShowMobileDetail,
    loadContacts, loadDetail, loadFlowData,
  });

  const selectContact = useCallback(
    (contactId: string) => {
      detail.selectContact(contactId, trackRecent);
    },
    [detail.selectContact, trackRecent],
  );

  const handleDoAction = useCallback((action: NextActionUI) => {
    selectContact(action.contactId);
  }, [selectContact]);

  useEffect(() => {
    if (businessId) {
      startTransition(() => {
        void loadContacts();
      });
    }
  }, [businessId, contactsData.search, contactsData.statusFilter, loadContacts, startTransition]);

  useEffect(() => {
    if (businessId) {
      void loadFlowData();
    }
  }, [businessId, loadFlowData]);

  const handleDeleteForPanel = useCallback(() => {
    void actions.handleDeleteContact();
  }, [actions.handleDeleteContact]);

  const handleRetryDetail = useCallback(() => {
    if (selectedContactId) void loadDetail(selectedContactId);
  }, [selectedContactId, loadDetail]);

  const isPinned = selectedContactId ? contactsData.pinnedIds.includes(selectedContactId) : false;

  const detailPanelProps: Omit<PipelineDetailPanelProps, "onClose"> = useMemo(() => ({
    contact: detail.selectedContact,
    events: detail.detailEvents,
    notes: detail.detailNotes,
    tasks: detail.detailTasks,
    loading: detail.detailLoading,
    detailError: detailError,
    onRetryDetail: handleRetryDetail,
    isPinned,
    contactName: detail.contactName,
    healthMetrics: detail.healthMetrics,
    journeyMilestones: detail.journeyMilestones,
    conversationContext: detail.conversationContext,
    aiInsight: detail.aiInsight,
    aiInsightLoading: detail.aiInsightLoading,
    onTogglePin: contactsData.handleTogglePin,
    onAddNote: actions.handleAddNote,
    onAddTask: actions.handleAddTask,
    onCompleteTask: actions.handleCompleteTask,
    onDeleteNote: actions.handleDeleteNote,
    onDeleteTask: actions.handleDeleteTask,
    onUpdateNote: actions.handleUpdateNote,
    onUpdateTask: actions.handleUpdateTask,
    onUpdateStatus: actions.handleUpdateStatus,
    onEdit: actions.handleEditContact,
    onDelete: handleDeleteForPanel,
    onLogEvent: actions.handleLogEvent,
    onGenerateAiInsight: detail.handleGenerateAiInsight,
    onRefreshConversationContext: detail.handleRefreshConversationContext,
  }), [
    detail.selectedContact, detail.detailEvents, detail.detailNotes, detail.detailTasks,
    detail.detailLoading, detailError, handleRetryDetail, isPinned, detail.contactName, detail.healthMetrics,
    detail.journeyMilestones, detail.conversationContext, detail.aiInsight, detail.aiInsightLoading,
    contactsData.handleTogglePin, actions.handleAddNote, actions.handleAddTask,
    actions.handleCompleteTask, actions.handleDeleteNote, actions.handleDeleteTask,
    actions.handleUpdateNote, actions.handleUpdateTask, actions.handleUpdateStatus,
    actions.handleEditContact, handleDeleteForPanel, actions.handleLogEvent,
    detail.handleGenerateAiInsight, detail.handleRefreshConversationContext,
  ]);

  const selectedContactsForBroadcast = useMemo(
    () => contacts.filter((c) => selectedIds.has(c.id)) as ContactCardData[],
    [contacts, selectedIds],
  );

  return {
    businessId, workspaceLoading: contactsData.workspaceLoading, workspaceError: contactsData.workspaceError,
    contacts, loading, loadError: contactsData.loadError, hasMore: contactsData.hasMore,
    searchInput: contactsData.searchInput, setSearchInput: contactsData.setSearchInput,
    statusFilter: contactsData.statusFilter, setStatusFilter: contactsData.setStatusFilter,
    sortBy: contactsData.sortBy, setSortBy: contactsData.setSortBy,
    activeSegment: contactsData.activeSegment, setActiveSegment: contactsData.setActiveSegment,
    activeListTab: contactsData.activeListTab, setActiveListTab: contactsData.setActiveListTab,
    selectedContactId, selectedContact: detail.selectedContact, detailLoading: detail.detailLoading,
    detailEvents: detail.detailEvents, detailNotes: detail.detailNotes,
    detailTasks: detail.detailTasks, contactName: detail.contactName,
    showAddForm: actions.showAddForm, setShowAddForm: actions.setShowAddForm,
    editingContact: actions.editingContact, setEditingContact: actions.setEditingContact,
    showMobileDetail, setShowMobileDetail,
    showAddMenu: actions.showAddMenu, setShowAddMenu: actions.setShowAddMenu,
    showBroadcast: actions.showBroadcast, setShowBroadcast: actions.setShowBroadcast,
    showGuide: actions.showGuide, setShowGuide: actions.setShowGuide,
    selectMode: contactsData.selectMode, selectedIds, setSelectedIds, setSelectMode,
    isPending,
    crmViewTab: contactsData.crmViewTab,
    setCrmViewTab: contactsData.setCrmViewTab,
    activeListId: contactsData.activeListId, setActiveListId: contactsData.setActiveListId,
    activeListContactIds: contactsData.activeListContactIds, setActiveListContactIds: contactsData.setActiveListContactIds,
    listsCount: contactsData.listsCount, setListsCount: contactsData.setListsCount,
    confirmState: actions.confirmState, setConfirmState: actions.setConfirmState,
    flowIntelligence: flow.flowIntelligence, flowDataLoading: flow.flowDataLoading,
    nextActions: flow.nextActions,
    autopilotActions: flow.autopilotActions, setAutopilotActions: flow.setAutopilotActions,
    autopilotPaused: flow.autopilotPaused, setAutopilotPaused: flow.setAutopilotPaused,
    revenueData: flow.revenueData,
    healthMetrics: detail.healthMetrics,
    journeyMilestones: detail.journeyMilestones,
    conversationContext: detail.conversationContext,
    aiInsight: detail.aiInsight, aiInsightLoading: detail.aiInsightLoading,
    pinnedIds: contactsData.pinnedIds, pinnedContacts: contactsData.pinnedContacts,
    recentContacts: contactsData.recentContacts,
    displayContacts: contactsData.displayContacts,
    segmentCounts: contactsData.segmentCounts,
    selectedContactsForBroadcast,
    detailPanelProps,
    loadContacts, loadFlowData, selectContact,
    handleSubmitContact: actions.handleSubmitContact,
    handleAddNote: actions.handleAddNote,
    handleAddTask: actions.handleAddTask,
    handleCompleteTask: actions.handleCompleteTask,
    handleDeleteNote: actions.handleDeleteNote,
    handleDeleteTask: actions.handleDeleteTask,
    handleUpdateStatus: actions.handleUpdateStatus,
    handleLogEvent: actions.handleLogEvent,
    handleEditContact: actions.handleEditContact,
    handleDeleteContact: actions.handleDeleteContact,
    handleImportFile: actions.handleImportFile,
    handleImportLink: actions.handleImportLink,
    handleDeviceImport: actions.handleDeviceImport,
    handleCompleteNextAction: flow.handleCompleteNextAction,
    handleDoAction,
    handleQuickAction: actions.handleQuickAction,
    handleViewExpiringQuotes: actions.handleViewExpiringQuotes,
    handleViewOverdueInvoices: actions.handleViewOverdueInvoices,
    handleApproveAutopilot: flow.handleApproveAutopilot,
    handleDenyAutopilot: flow.handleDenyAutopilot,
    handleUpdateNote: actions.handleUpdateNote,
    handleUpdateTask: actions.handleUpdateTask,
    handleBulkStatusChange: actions.handleBulkStatusChange,
    handleBulkTag: actions.handleBulkTag,
    handleBulkDelete: actions.handleBulkDelete,
    handleToggleSelectMode: contactsData.handleToggleSelectMode,
    handleTogglePin: contactsData.handleTogglePin,
    handleToggleSelect: contactsData.handleToggleSelect,
    handleSelectAll: contactsData.handleSelectAll,
    handleGenerateAiInsight: detail.handleGenerateAiInsight,
    handleRefreshConversationContext: detail.handleRefreshConversationContext,
  };
}

export type PipelineState = ReturnType<typeof useContactsPipeline>;
