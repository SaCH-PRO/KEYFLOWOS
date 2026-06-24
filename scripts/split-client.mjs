import ts from 'typescript';
import fs from 'fs';
import path from 'path';

const clientFile = path.resolve('apps/web/src/lib/client.ts');
const source = fs.readFileSync(clientFile, 'utf8');
const src = ts.createSourceFile(clientFile, source, ts.ScriptTarget.Latest, true);

const apiDir = path.resolve('apps/web/src/lib/api');
fs.mkdirSync(apiDir, { recursive: true });

const domains = {
  crm: [/^fetchContacts/, /^fetchContact/, /^createContact/, /^updateContact/, /^deleteContact/, /^mergeContacts/, /^fetchDuplicateContacts/, /^fetchMergePreview/, /^revertMerge/, /^fetchFavorites/, /^toggleFavorite/, /^fetchCustomField/, /^createCustomField/, /^updateCustomField/, /^archiveCustomField/, /^restoreCustomField/, /^deleteCustomField/, /^fetchContactCustomField/, /^fetchDeal/, /^createDeal/, /^updateDeal/, /^deleteDeal/, /^moveDeal/, /^bulkMoveDeal/, /^winDeal/, /^loseDeal/, /^fetchDealForecast/, /^fetchDealVelocity/, /^fetchWonLost/, /^createWonLost/, /^updateWonLost/, /^deleteWonLost/, /^fetchAccount/, /^createAccount/, /^updateAccount/, /^deleteAccount/, /^suggestAccount/, /^previewAccountMerge/, /^applyAccountMerge/, /^fetchLifecycleByAccount/, /^fetchDealsByAccount/, /^fetchContactDeals/, /^fetchContactStats/, /^fetchSegmentSummary/, /^fetchRelationshipHealth/, /^updateRelationshipHealth/, /^recomputeRelationshipHealth/, /^setContactRelationshipHealth/, /^clearContactRelationshipHealth/, /^fetchAtRiskContacts/, /^fetchCrmHighlights/, /^fetchContactNextActions/, /^completeContactNextAction/, /^snoozeContactNextAction/, /^fetchDueTasks/, /^bulkUpdateContacts/, /^bulkDeleteContacts/, /^bulkReassignContacts/, /^fetchTeamMembers/, /^checkImportDuplicates/, /^fetchImportJobs/, /^importContacts/, /^getGoogleContactsAuthUrl/, /^createContactFromOcr/, /^scanContactImage/, /^completeContactTask/, /^reopenContactTask/, /^fetchContactEvents/, /^fetchContactNotes/, /^fetchContactTasks/, /^fetchBestChannelExplain/, /^fetchContactPlaybook/, /^updateContactPlaybook/, /^logContactEvent/, /^logCommunication/, /^addContactNote/, /^addContactTask/, /^updateContactNote/, /^deleteContactNote/, /^updateContactTask/, /^deleteContactTask/, /^fetchContactRevenueSummary/, /^fetchContactInsightSnapshot/, /^recomputeContactInsightSnapshot/, /^fetchActivityFeed/, /^fetchContactHealthMetrics/, /^fetchContactDossier/, /^fetchContactJourney/, /^fetchContactCrossJourney/, /^fetchPredictiveRevenue/, /^fetchConversationContext/, /^generateAiInsight/, /^fetchContactRelationships/, /^fetchContactNetwork/, /^fetchNetworkGraph/, /^createContactRelationship/, /^deleteContactRelationship/, /^referContact/, /^fetchDataQuality/, /^runDataQuality/, /^applyDataQuality/, /^dismissDataQuality/, /^bulkApplyDataQuality/, /^updateDataQualitySettings/, /^fetchUnreadCounts/, /^sendContactReply/, /^fetchConversationSummary/, /^regenerateConversationSummary/, /^fetchSuggestedReplies/, /^fetchConversationInsights/, /^markContactConversationsRead/],
  commerce: [/^fetchProducts/, /^createProduct/, /^updateProduct/, /^deleteProduct/, /^bulkUpdateProducts/, /^fetchInvoices/, /^getInvoice/, /^createInvoice/, /^updateInvoice/, /^deleteInvoice/, /^bulkUpdateInvoices/, /^updateInvoiceStatus/, /^markInvoicePaid/, /^recordInvoicePayment/, /^recordPaymentFromEvidence/, /^extractPaymentEvidence/, /^listInvoicePayments/, /^getInvoiceTimeline/, /^createInvoicePaymentLink/, /^sendInvoiceEmail/, /^sendInvoiceReminder/, /^resendInvoiceReceipt/, /^getPublicInvoiceByToken/, /^listQuotes/, /^getQuote/, /^createQuote/, /^updateQuote/, /^deleteQuote/, /^bulkUpdateQuotes/, /^updateQuoteStatus/, /^convertQuoteToInvoice/, /^getGmailAuthUrl/, /^getGmailStatus/, /^disconnectGmail/, /^sendQuoteEmail/, /^fetchStaleQuotes/, /^sendStaleQuoteFollowUp/, /^fetchPublicQuote/, /^acceptPublicQuote/, /^rejectPublicQuote/, /^fetchBookings/, /^createBooking/, /^rescheduleBooking/, /^updateBookingNotes/, /^updateBookingLocation/, /^fetchReminderSettings/, /^updateReminderSettings/, /^fetchStaffAvailability/, /^setStaffAvailability/, /^fetchStaff/, /^createStaff/, /^deleteStaff/, /^fetchServices/, /^createService/, /^updateService/, /^deleteService/, /^syncBookingToCalendar/, /^createInvoiceFromBooking/, /^fetchBookingStats/, /^fetchScheduleHealth/, /^fetchCockpitSummary/, /^fetchTodaysTasks/, /^fetchAllAutopilotTasks/, /^updateAutopilotTaskStatus/, /^approveAutopilotTask/, /^denyAutopilotTask/, /^generateAutopilotDraft/, /^executeAutopilotAction/, /^fetchAutopilotSettings/, /^updateAutopilotSettings/, /^fetchAutopilotStats/, /^fetchCriticalAlerts/, /^generateSetupTasks/, /^fetchMomentumRecommendations/, /^actionMomentumRecommendation/, /^snoozeMomentumRecommendation/, /^dismissMomentumRecommendation/, /^generateMomentumDraft/, /^fetchContactMomentum/, /^fetchContactMomentumHistory/, /^fetchMomentumSummary/, /^triggerMomentumSweep/, /^fetchConversionFunnel/, /^fetchProductHealth/, /^fetchSeoHealth/, /^fetchConversionSuggestions/, /^fetchAiConversionAdvice/, /^PAYMENT_METHODS/, /^fetchRecurringInvoices/, /^createRecurringInvoice/, /^updateRecurringInvoice/, /^deleteRecurringInvoice/, /^toggleRecurringInvoice/, /^cancelRecurringInvoice/, /^fetchRecurringGenerationHistory/, /^fetchSlowPayers/, /^fetchPricingSignals/, /^fetchRevenueActions/, /^fetchRevenueOverview/, /^reconcileRevenueActions/, /^completeRevenueAction/, /^dismissRevenueAction/, /^snoozeRevenueAction/, /^fetchCommerceRevenueForecast/, /^fetchRevenueBriefing/, /^regenerateRevenueBriefing/, /^delegateRevenueBriefingChase/, /^fetchRevenueReport/, /^sendAccountantExportEmail/, /^getStorefrontVisitorId/, /^getStorefrontReferralCode/, /^trackStoreEvent/, /^backfillStoreLinks/, /^fetchStorefrontConfig/, /^updateStorefrontConfig/, /^fetchStoreAnalytics/, /^fetchStoreGraph/, /^fetchStoreReadiness/],
  finance: [/^fetchExpenses/, /^getExpense/, /^createExpense/, /^updateExpense/, /^deleteExpense/, /^fetchExpenseCategories/, /^createExpenseCategory/, /^deleteExpenseCategory/, /^fetchExpenseSummary/, /^fetchMarginAnalysis/, /^fetchExpensesByProject/, /^fetchExpensesByService/, /^fetchRecurringCandidates/, /^fetchRecurringExpenses/, /^createRecurringExpense/, /^updateRecurringExpense/, /^cancelRecurringExpense/, /^runRecurringExpenseNow/, /^fetchVendorAnalytics/, /^fetchExpenseBudgets/, /^upsertExpenseBudget/, /^deleteExpenseBudget/, /^getExpenseExportUrl/, /^fetchBusinessPayments/, /^fetchPaymentsGateways/, /^fetchPaymentsTransactions/, /^fetchPaymentsLinks/, /^createPaymentsLink/, /^revokePaymentsLink/, /^refundPaymentsCharge/, /^fetchTransactionLink/, /^fetchAccountingSummary/, /^fetchUnsyncedInvoices/, /^pushInvoicesToAccounting/, /^pushCustomersToAccounting/, /^fetchChartOfAccounts/, /^fetchFinanceOverview/, /^fetchFinanceIntelActions/, /^runFinanceIntelScan/, /^resolveFinanceIntelAction/, /^dismissFinanceIntelAction/, /^fetchFinanceInsightStrip/, /^fetchFinanceAccounts/, /^createFinanceAccount/, /^updateFinanceAccount/, /^archiveFinanceAccount/, /^fetchFinanceCoa/, /^createFinanceCoa/, /^updateFinanceCoa/, /^archiveFinanceCoa/, /^fetchJournalEntries/, /^createJournalEntry/, /^extractReceipt/, /^fetchTaxRates/, /^createTaxRate/, /^updateTaxRate/, /^deleteTaxRate/, /^fetchFinanceSettings/, /^updateFinanceSettings/, /^fetchTaxLiabilities/, /^recomputeTaxLiabilities/, /^fetchTaxLiability/, /^fetchTaxContributingInvoices/, /^fileTaxLiability/, /^payTaxLiability/, /^downloadAccountantExport/],
  identity: [/^bootstrapIdentity/, /^identitySignup/, /^identityLogin/, /^identityResendVerification/, /^fetchMe/, /^getBusinessById/, /^updateBusiness/],
  social: [/^fetchPosts/, /^postNow/, /^schedulePost/, /^fetchRecentExternalPosts/, /^createPost/, /^updatePost/, /^deletePost/, /^publishPost/, /^fetchSocialConnections/, /^startSocialOAuth/, /^completeSocialOAuth/, /^fetchOAuthAvailability/, /^connectSocialManual/, /^disconnectSocial/, /^testSocialConnection/, /^fetchSocialAnalytics/, /^fetchAccountMetrics/, /^fetchMarketingLists/, /^pushContactsToMarketingList/, /^fetchMarketingCampaigns/, /^triggerMarketingCampaign/],
  projects: [/^fetchProjects/, /^createProject/, /^updateProject/, /^deleteProject/, /^createProjectTask/, /^updateProjectTask/, /^deleteProjectTask/, /^fetchProjectTemplates/, /^createProjectTemplate/, /^deleteProjectTemplate/, /^createProjectFromTemplate/, /^fetchSupportTickets/, /^createSupportTicket/, /^updateSupportTicket/, /^deleteSupportTicket/],
  calendar: [/^getCalendarAuthUrl/, /^getCalendarStatus/, /^disconnectCalendar/, /^fetchGoogleCalendarEvents/, /^updateBookingStatus/, /^fetchCalendarEvents/, /^fetchCalendarAgenda/, /^fetchCalendarConflicts/, /^fetchCalendarInsights/, /^fetchCalendarDailyPlan/, /^fetchCalendarWeeklyCapacity/, /^createCalendarEvent/, /^patchCalendarEvent/, /^cancelCalendarEvent/],
  ai: [/^fetchPlaybooks/, /^createPlaybook/, /^updatePlaybook/, /^testRunPlaybook/, /^aiGenerateFlow/, /^keyInterpretFlow/, /^keyBuildFlow/, /^keyExecuteFlow/, /^keyTalkFlow/, /^keyInterpretDelegation/, /^keyBuildDelegation/, /^keyExecuteDelegation/, /^keyTalkDelegation/, /^keyInterpretCalendar/, /^keyBuildCalendar/, /^keyExecuteCalendar/, /^keyTalkCalendar/, /^fetchFlowIntelligence/, /^fetchAiNextActions/, /^fetchNextActions/, /^completeNextAction/, /^fetchAutopilotActionsForCrm/, /^aiGenerateDraft/, /^aiRewriteContent/, /^aiSuggestSubjects/, /^aiSuggestCta/, /^aiSuggestHashtags/, /^aiShortenExpand/, /^aiSuggestChannels/, /^aiSuggestSendTime/, /^aiSuggestPreviewText/, /^aiSuggestAudienceSegments/, /^aiSuggestContentIdeas/],
  analytics: [/^fetchAnalyticsOverview/, /^fetchAnalyticsSnapshots/, /^fetchAnalyticsTrends/, /^fetchAnalyticsMetrics/, /^generateRevenueProjection/, /^generateContactProjection/, /^fetchProjections/, /^generateInsights/, /^fetchInsights/, /^markInsightRead/, /^dismissInsight/, /^assessMaturity/, /^fetchLatestMaturity/, /^fetchMaturityHistory/, /^fetchFinancialGrowth/],
  trash: [/^fetchTrashItems/, /^restoreTrashItem/, /^permanentDeleteTrashItem/],
  marketing: [/^listChannelConnections/, /^createChannelConnection/, /^listChannelDestinations/, /^createOutboundContent/, /^updateOutboundContent/, /^listOutboundContent/, /^getOutboundContent/, /^deleteOutboundContent/, /^upsertOutboundVariant/, /^publishContentNow/, /^scheduleContent/, /^rescheduleDelivery/, /^cancelDelivery/, /^retryDelivery/, /^getDeliverySummary/, /^getChannelHealthSummary/, /^runChannelHealthCheck/, /^toggleChannelDestination/, /^updateChannelConnection/, /^deleteChannelConnection/, /^syncChannelConnectionsFromSocial/, /^validateEmailSend/, /^expandAudience/, /^getAudienceHealth/, /^listDeliveries/, /^getDeliveryEvents/, /^retryAllFailedDeliveries/],
  omnichannel: [/^fetchQualificationConfig/, /^updateQualificationConfig/, /^fetchQualificationAnalytics/, /^quoteFromConversation/],
  keyflow: [/^fetchKeyflowEvents/, /^fetchKeyflowNotes/, /^createKeyflowNote/, /^updateKeyflowNote/, /^deleteKeyflowNote/, /^generateKeyflowNoteBrief/, /^synthesizeKeyflowSpeech/, /^transcribeKeyflowSpeech/, /^fetchVoiceSessions/, /^createVoiceSession/, /^endVoiceSession/, /^fetchVoicePreferences/, /^saveVoicePreference/],
  community: [/^listOpportunities/, /^getOpportunity/, /^createOpportunity/, /^listMyOpportunities/, /^updateOpportunity/, /^closeOpportunity/, /^deleteOpportunity/, /^applyToOpportunity/, /^listMyOpportunityApplications/, /^respondToOpportunityApplication/, /^withdrawOpportunityApplication/, /^proposePartnerProgram/, /^listPartnerPrograms/, /^listPublicPartnerProgramsForProfile/, /^getPartnerProgram/, /^respondToPartnerProgram/, /^terminatePartnerProgram/, /^listResources/, /^getResource/, /^publishResource/, /^listMyResources/, /^recordResourceDownload/, /^listMyResourceDownloads/, /^listNetworkActivity/, /^listFollowingActivity/, /^listActivityForBusiness/, /^recordProfileView/, /^getNetworkAnalyticsDashboard/, /^listRecentProfileViewers/],
  presence: [/^fetchPresenceDraft/, /^savePresenceDraft/, /^fetchPresenceDiff/, /^createPresencePreview/, /^publishPresence/, /^unpublishPresence/, /^fetchPresenceCompleteness/, /^fetchPresenceTodayStats/, /^detectAbandonedCarts/, /^fetchPresenceCommandOverview/, /^syncPresenceActionCards/, /^fetchPresenceInsights/, /^regeneratePresenceInsights/, /^delegatePresenceInsight/, /^fetchPresenceLeads/, /^fetchPresenceOrders/, /^fetchPresenceBookings/, /^fetchPresenceOverview/, /^fetchPresenceSourcesReport/, /^fetchPresencePagesReport/, /^fetchPresenceFunnelReport/],
  commerceOps: [/^fetchProductCostProfile/, /^upsertProductCostProfile/, /^fetchDocumentTemplates/, /^createDocumentTemplate/, /^updateDocumentTemplate/, /^deleteDocumentTemplate/, /^fetchProcurementRequests/, /^createProcurementRequest/, /^updateProcurementRequest/, /^deleteProcurementRequest/],
  structure: [/^fetchStructure/],
  contentOps: [/^fetchContentRequests/, /^createContentRequest/, /^updateContentRequest/, /^deleteContentRequest/, /^approveContentRequest/, /^rejectContentRequest/],
  approvals: [/^fetchApprovals/, /^createApproval/, /^updateApproval/, /^deleteApproval/],
  assets: [/^fetchAssets/, /^createAsset/, /^updateAsset/, /^deleteAsset/],
  evidence: [/^fetchEvidence/, /^createEvidence/, /^updateEvidence/, /^deleteEvidence/],
  callTasks: [/^fetchCallTasks/, /^createCallTask/, /^updateCallTask/, /^deleteCallTask/, /^fetchCallScripts/, /^createCallScript/, /^updateCallScript/, /^deleteCallScript/],
};

function getName(stmt) {
  if (ts.isFunctionDeclaration(stmt) && stmt.name) return stmt.name.text;
  if (ts.isVariableStatement(stmt)) {
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) return decl.name.text;
    }
  }
  if (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) {
    return stmt.name.text;
  }
  return null;
}

function isExported(stmt) {
  return stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
}

function classify(name) {
  if (!name) return 'shared';
  if (name === 'DEFAULT_BUSINESS_ID' || name === 'DEMO_MODE_ENABLED' || name === 'apiGet') return 'shared';
  for (const [d, patterns] of Object.entries(domains)) {
    if (patterns.some(p => p.test(name))) return d;
  }
  return 'shared';
}

const buckets = Object.fromEntries([...Object.keys(domains), 'shared'].map(d => [d, []]));

for (const stmt of src.statements) {
  const name = getName(stmt);
  let domain = classify(name);
  if ((ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) && domain !== 'shared') {
    domain = 'shared';
  } else if (ts.isVariableStatement(stmt) && name && name.endsWith('Schema') && domain !== 'shared') {
    domain = 'shared';
  }
  buckets[domain].push(stmt);
}

function getText(stmt) {
  return source.slice(stmt.getFullStart(), stmt.getEnd());
}

function exportedText(stmt) {
  let text = getText(stmt);
  if (!isExported(stmt)) {
    // Prepend export to the first declaration keyword
    if (ts.isFunctionDeclaration(stmt)) {
      text = text.replace(/^async\s+function\b/, 'export async function').replace(/^function\b/, 'export function');
    } else if (ts.isVariableStatement(stmt)) {
      text = text.replace(/^const\b/, 'export const');
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      text = text.replace(/^type\b/, 'export type');
    } else if (ts.isInterfaceDeclaration(stmt)) {
      text = text.replace(/^interface\b/, 'export interface');
    }
  }
  return text;
}

function collectNames(text) {
  const names = new Set();
  const regex = /\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g;
  let m;
  while ((m = regex.exec(text))) names.add(m[1]);
  return names;
}

// Build shared.ts and collect its exported names
const sharedParts = [];
const sharedImports = [
  'import { z } from "zod";',
  'import { API_BASE, apiPost, apiPostSimple, apiPatch, apiPut, apiDelete, apiGet as apiGetSimple, getAuthHeaders, emitUnauthorizedEvent, type PlanLimitError } from "../api";',
  'import { refreshAccessToken, getStoredBusinessId } from "../workspace";',
].join('\n');
for (const stmt of buckets.shared) {
  sharedParts.push(exportedText(stmt));
}
const sharedText = `${sharedImports}\n\n${sharedParts.join('\n\n')}\n`;
fs.writeFileSync(path.join(apiDir, 'shared.ts'), sharedText, 'utf8');

// Parse shared.ts to get exported names
const sharedSrc = ts.createSourceFile('shared.ts', sharedText, ts.ScriptTarget.Latest, true);
const sharedExports = new Set();
for (const stmt of sharedSrc.statements) {
  const name = getName(stmt);
  if (name && isExported(stmt)) sharedExports.add(name);
}

function buildImports(text) {
  const lines = [];
  if (/\bz\b/.test(text)) lines.push('import { z } from "zod";');
  const apiHelpers = ['API_BASE', 'apiPost', 'apiPostSimple', 'apiPatch', 'apiPut', 'apiDelete', 'apiGetSimple', 'getAuthHeaders', 'emitUnauthorizedEvent'];
  const usedApi = apiHelpers.filter(h => new RegExp(`\\b${h}\\b`).test(text));
  if (usedApi.length) {
    lines.push(`import { ${usedApi.join(', ')}${usedApi.includes('PlanLimitError') ? '' : ', type PlanLimitError'} } from "../api";`);
  }
  const names = collectNames(text);
  const usedShared = [...sharedExports].filter(n => names.has(n));
  if (usedShared.length) {
    const typeNames = usedShared.filter(n => /^[A-Z]/.test(n) && n !== 'PAYMENT_METHODS' && n !== 'DEFAULT_BUSINESS_ID' && n !== 'DEMO_MODE_ENABLED');
    const valueNames = usedShared.filter(n => !typeNames.includes(n));
    const parts = [];
    if (valueNames.length) parts.push(valueNames.join(', '));
    if (typeNames.length) parts.push(`type ${typeNames.join(', ')}`);
    lines.push(`import { ${parts.join(', ')} } from "./shared";`);
  }
  const workspaceItems = ['refreshAccessToken', 'getStoredBusinessId'];
  const usedWorkspace = workspaceItems.filter(h => new RegExp(`\\b${h}\\b`).test(text));
  if (usedWorkspace.length) {
    lines.push(`import { ${usedWorkspace.join(', ')} } from "../workspace";`);
  }
  return lines.join('\n');
}

const activeDomains = [];
for (const [domain, stmts] of Object.entries(buckets)) {
  if (domain === 'shared' || stmts.length === 0) continue;
  const parts = stmts.map(getText);
  const text = parts.join('\n\n');
  const imports = buildImports(text);
  fs.writeFileSync(path.join(apiDir, `${domain}.ts`), `${imports}\n\n${text}\n`, 'utf8');
  activeDomains.push(domain);
}

// Write client.ts barrel
const clientLines = [
  'export * from "./api/shared";',
  ...activeDomains.map(d => `export * from "./api/${d}";`),
].join('\n');
fs.writeFileSync(clientFile, `${clientLines}\n`, 'utf8');

console.log('Active domains:', activeDomains.length);
console.log(activeDomains.join(', '));
