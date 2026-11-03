/**
 * FOLLOW3-D2-CRM-CONTACT-ROUTES-VIS (V1-84): the remaining contact-scoped routes
 * of crm.controller.ts, and DELETE relationships/:relationshipId, apply the
 * session member's CRM record visibility (REAL database).
 *
 * V1-08 gated the contact-scoped sibling reads (events, notes, journey, ...)
 * with CrmController.assertVisibleContact, the rule GET contacts/:contactId
 * applies. The writes beside them and four conversation reads still reached
 * collaborators that check the tenant only, so a STAFF member with
 * {crm:'write', crm_view:'owned'} (or an ADMIN, on another member's PRIVATE
 * contact) could add a note, a task or an event to a contact GET detail hides
 * from them, toggle its favorite, verify it, override its relationship health,
 * clear or snooze its next action, rewrite its playbook, take it off a list,
 * mark its conversation read, send it a WhatsApp reply, have the AI summarize
 * or draft replies over its thread, read its AI insights, merge it, or delete
 * a relationship edge that names it (crm.e2e.test.ts it.todo, V1-08 review
 * ST-2/ST-4).
 *
 * Nothing on the authorization boundary is mocked: PrismaService over the real
 * client, AuthGuard, BusinessGuard, ModuleScopeGuard, CrmRateLimitGuard, the
 * user/business/membership/contact rows, CrmController and the CRM services the
 * routes call (CrmService, CrmTimelineService, CrmStatsService, CrmListsService,
 * CrmFlowService, CrmDataQualityService, CrmRelationshipHealthService,
 * CrmPlaybookService, CrmCommunicationService, ConversationAiService,
 * CrmNetworkService, plus the core TimelineService and ContactAuditService they
 * write through). Identity is attached by a test middleware from `x-test-user`
 * exactly as the Supabase-verifying AuthMiddleware would after token
 * verification. Two collaborators are recorders, so there is no provider
 * traffic: the AI gateway (AiUsageService.callAi) under ConversationAiService,
 * and the WhatsApp sender (WhatsAppService.sendMessage) under
 * CrmCommunicationService. ConversationAiService itself is the real service
 * behind a call recorder, so a route that reaches it is observed even when it
 * does not call the gateway (insights). The CrmCacheService a write
 * invalidates is a no-op stub (Redis).
 *
 * Actors: OWNER; ADMIN (no permission scopes: view all, which still excludes
 * another member's PRIVATE rows); STAFF_OWNED {crm:'write', crm_view:'owned'}
 * (own or shared rows only); a member of bizB. Contacts: the owner's PRIVATE
 * contact, the owner's TEAM contact, and a STAFF-owned TEAM contact.
 *
 * Cases CV-01..CV-20 (one route each) are the pre-fix failing controls: on
 * unmodified code each hidden call answers 2xx and writes its row or reaches a
 * recorder. The CONTROLS describe passes before and after.
 *
 * Requires DATABASE_URL. Every seeded row has the `v84b_` prefix (or belongs to
 * a v84b_ business) and is hard-deleted by raw SQL in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Each case sends every route for several actors against the real database.
vi.setConfig({ testTimeout: 30_000 });

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v84b_';
const ID = {
  owner: `${P}owner`,           // OWNER of bizA
  admin: `${P}admin`,           // ADMIN of bizA, no permission scopes
  staffOwned: `${P}staffOwned`, // STAFF of bizA, crm write + crm_view owned
  other: `${P}other`,           // OWNER of bizB only
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  cPriv: `${P}cPriv`,           // PRIVATE, owned by the owner
  cTeam: `${P}cTeam`,           // TEAM, owned by the owner
  cStaff: `${P}cStaff`,         // TEAM, owned by STAFF_OWNED
  cStaff2: `${P}cStaff2`,       // TEAM, owned by STAFF_OWNED (a relationship end)
  cB: `${P}cB`,                 // TEAM, bizB
  list: `${P}list`,             // MANUAL list of bizA
};
const ABSENT = `${P}absent`;
const ABSENT_REL = `${P}rel_absent`;

const NOT_FOUND_BODY = { statusCode: 404, message: 'Contact not found', error: 'Not Found' };
const REL_NOT_FOUND_BODY = { statusCode: 404, message: 'Relationship not found', error: 'Not Found' };

/** Contacts the routes act on: each carries the rows every route reads or writes. */
const MAIN_CONTACTS = [ID.cPriv, ID.cTeam, ID.cStaff, ID.cStaff2];

/**
 * Merge pairs. A merge soft-deletes its duplicate, so each case has its own pair:
 * on unmodified code the hidden merges succeed and would consume a shared one.
 * mPriv*: PRIVATE owned by the owner; mTeam*: TEAM owned by the owner;
 * mStaff*: TEAM owned by STAFF_OWNED.
 */
const MERGE = {
  staffPrimaryHidden: { primary: `${P}mPrivP1`, duplicate: `${P}mStaffD1` },
  staffDuplicateHidden: { primary: `${P}mStaffP1`, duplicate: `${P}mPrivD1` },
  adminPrimaryHidden: { primary: `${P}mPrivP2`, duplicate: `${P}mTeamD1` },
  adminDuplicateHidden: { primary: `${P}mTeamP1`, duplicate: `${P}mPrivD2` },
  adminControl: { primary: `${P}mTeamP2`, duplicate: `${P}mTeamD2` },
  staffControl: { primary: `${P}mStaffP2`, duplicate: `${P}mStaffD2` },
  ownerControl: { primary: `${P}mPrivP3`, duplicate: `${P}mPrivD3` },
};
const MERGE_CONTACTS = Object.values(MERGE).flatMap((m) => [m.primary, m.duplicate]);

/** Relationship edges, none the inverse of another (DELETE also removes the inverse). */
const REL = {
  staffToHidden: { id: `${P}rel_e1`, from: ID.cStaff, to: ID.cTeam },     // STAFF: the to end is hidden
  fromHidden: { id: `${P}rel_e2`, from: ID.cPriv, to: ID.cStaff },        // STAFF and ADMIN: the from end is hidden
  toPrivate: { id: `${P}rel_e3`, from: ID.cTeam, to: ID.cPriv },          // ADMIN: the to end is hidden; STAFF: both
  staffControl: { id: `${P}rel_c1`, from: ID.cStaff, to: ID.cStaff2 },
  adminControl: { id: `${P}rel_c2`, from: ID.cTeam, to: ID.cStaff2 },
  ownerControl: { id: `${P}rel_c3`, from: ID.cPriv, to: ID.cStaff2 },
};

const SENSITIVE_INSIGHT = 'v84b-sensitive-ai-insight-summary-3c71e2';

// ---- recorders (no provider traffic) --------------------------------------
const AI_REPLY = JSON.stringify({
  summary: 'v84b recorded summary',
  sentiment: 'neutral',
  lastIntent: 'v84b_intent',
  openQuestions: [],
  actionItems: [],
  replies: [{ channel: 'whatsapp', body: 'v84b recorded reply', tone: 'warm', rationale: 'recorded' }],
});
const aiCalls: Array<{ businessId: string; feature: string }> = [];
const aiGateway = {
  callAi: async (args: { businessId: string; feature: string }) => {
    aiCalls.push({ businessId: args.businessId, feature: args.feature });
    return { content: AI_REPLY, model: 'v84b-recorder' };
  },
};
const sendCalls: Array<{ businessId: string; to: string }> = [];
const sender = {
  sendMessage: async (businessId: string, msg: { to: string; body: string }) => {
    sendCalls.push({ businessId, to: msg.to });
    return { id: `${P}wa_sent`, status: 'recorded' };
  },
};
const conversationAiCalls: Array<{ method: string; contactId: string }> = [];
const CONVERSATION_AI_METHODS = ['summarizeThread', 'suggestReplies', 'getContactRollup', 'getMessageInsights'];

function resetRecorders() {
  aiCalls.length = 0;
  sendCalls.length = 0;
  conversationAiCalls.length = 0;
}
function recorderCalls() {
  return { ai: aiCalls.length, sender: sendCalls.length, conversationAi: conversationAiCalls.length };
}

let db: any;
let app: any;
let assertContactVisible: (prisma: any, businessId: string, contactId: string, actorUserId: string) => Promise<unknown>;

async function cleanup() {
  for (const sql of [
    `DELETE FROM contact_read_states WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM merge_operations WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM conversation_ai_insights WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_list_members WHERE list_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_lists WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_playbooks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_relationships WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_data_issues WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_notes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

const q = (sql: string) => db.$queryRawUnsafe(sql);

/**
 * Every row of bizA a refused route could write, read back by raw SQL: the
 * contacts (the columns the routes update), the child rows by count, and the
 * rows a route updates in place (playbooks, insights, read states, data issues,
 * list members, relationship edges).
 */
async function snapshot() {
  const biz = `'${ID.bizA}'`;
  const count = async (table: string) =>
    Number((await q(`SELECT count(*)::int AS n FROM ${table} WHERE business_id = ${biz}`))[0].n);
  return {
    contacts: await q(`SELECT id, updated_at, deleted_at, custom, relationship_health, next_action_at, next_action_type,
                              last_verified_at, last_merge_id, merged_into_id
                         FROM contacts WHERE business_id = ${biz} ORDER BY id`),
    counts: {
      contactNotes: await count('contact_notes'),
      contactTasks: await count('contact_tasks'),
      contactEvents: await count('contact_events'),
      contactPlaybooks: await count('contact_playbooks'),
      contactReadStates: await count('contact_read_states'),
      conversationAiInsights: await count('conversation_ai_insights'),
      mergeOperations: await count('merge_operations'),
      contactRelationships: await count('contact_relationships'),
      contactAuditEntries: await count('contact_audit_entries'),
      activities: await count('activities'),
    },
    playbooks: await q(`SELECT id, data, last_used_at, updated_at FROM contact_playbooks WHERE business_id = ${biz} ORDER BY id`),
    insights: await q(`SELECT id, hash, summary, updated_at FROM conversation_ai_insights WHERE business_id = ${biz} ORDER BY id`),
    readStates: await q(`SELECT user_id, contact_id, last_read_at FROM contact_read_states WHERE business_id = ${biz} ORDER BY user_id, contact_id`),
    dataIssues: await q(`SELECT id, status, resolved_at FROM contact_data_issues WHERE business_id = ${biz} ORDER BY id`),
    listMembers: await q(`SELECT m.list_id, m.contact_id FROM contact_list_members m JOIN contact_lists l ON l.id = m.list_id
                           WHERE l.business_id = ${biz} ORDER BY m.contact_id`),
    relationships: await q(`SELECT id, from_contact_id, to_contact_id FROM contact_relationships WHERE business_id = ${biz} ORDER BY id`),
  };
}

const contactCol = async (contactId: string, col: string) =>
  (await q(`SELECT ${col} AS v FROM contacts WHERE id = '${contactId}'`))[0]?.v ?? null;

// ---------------------------------------------------------------------------
// The contact-scoped routes (CV-01 merge and CV-20 DELETE relationships have
// their own cases below: they name two contacts).
// ---------------------------------------------------------------------------

type Route = {
  cv: string;
  name: string;
  method: 'get' | 'post' | 'put' | 'delete';
  path: (contactId: string) => string;
  body?: Record<string, unknown>;
  /** Puts the contact in a state where a permitted call writes something. */
  prepare?: (actor: string, contactId: string) => Promise<void>;
  /** A value a permitted call by `actor` on `contactId` changes. */
  effect: (actor: string, contactId: string) => Promise<unknown>;
  /** The recorder a permitted call reaches. */
  reaches?: 'ai' | 'sender';
};

const aiServiceCallsFor = async (_actor: string, contactId: string) =>
  conversationAiCalls.filter((c) => c.contactId === contactId).length;

const ROUTES: Route[] = [
  {
    cv: 'CV-02', name: 'POST contacts/:contactId/data-quality/mark-verified', method: 'post',
    path: (c) => `contacts/${c}/data-quality/mark-verified`,
    prepare: async (_a, c) => {
      await q(`UPDATE contacts SET last_verified_at = NULL WHERE id = '${c}'`);
    },
    effect: async (_a, c) => contactCol(c, 'last_verified_at'),
  },
  {
    cv: 'CV-03', name: 'POST contacts/:contactId/notes', method: 'post',
    path: (c) => `contacts/${c}/notes`, body: { body: 'v84b note body' },
    effect: async (_a, c) => db.contactNote.count({ where: { contactId: c } }),
  },
  {
    cv: 'CV-04', name: 'PUT contacts/:contactId/relationship-health', method: 'put',
    path: (c) => `contacts/${c}/relationship-health`, body: { value: 'COLD' },
    prepare: async (_a, c) => {
      await q(`UPDATE contacts SET relationship_health = NULL, custom = COALESCE(custom, '{}'::jsonb) - 'relationshipHealthOverride' WHERE id = '${c}'`);
    },
    effect: async (_a, c) => contactCol(c, 'relationship_health'),
  },
  {
    cv: 'CV-05', name: 'DELETE contacts/:contactId/relationship-health', method: 'delete',
    path: (c) => `contacts/${c}/relationship-health`,
    prepare: async (_a, c) => {
      await q(`UPDATE contacts SET relationship_health = 'HOT',
                 custom = jsonb_set(COALESCE(custom, '{}'::jsonb), '{relationshipHealthOverride}', '{"manual":true,"value":"HOT"}'::jsonb)
               WHERE id = '${c}'`);
    },
    effect: async (_a, c) => (await q(`SELECT custom ? 'relationshipHealthOverride' AS v FROM contacts WHERE id = '${c}'`))[0].v,
  },
  {
    cv: 'CV-06', name: 'POST contacts/:contactId/tasks', method: 'post',
    path: (c) => `contacts/${c}/tasks`, body: { title: 'v84b task title' },
    effect: async (_a, c) => db.contactTask.count({ where: { contactId: c } }),
  },
  {
    cv: 'CV-07', name: 'POST contacts/:contactId/next-action/complete', method: 'post',
    path: (c) => `contacts/${c}/next-action/complete`,
    prepare: async (_a, c) => {
      await q(`UPDATE contacts SET next_action_at = now() + interval '1 day', next_action_type = 'call' WHERE id = '${c}'`);
    },
    effect: async (_a, c) => contactCol(c, 'next_action_at'),
  },
  {
    cv: 'CV-08', name: 'POST contacts/:contactId/next-action/snooze', method: 'post',
    path: (c) => `contacts/${c}/next-action/snooze`, body: { days: 3 },
    prepare: async (_a, c) => {
      await q(`UPDATE contacts SET next_action_at = NULL WHERE id = '${c}'`);
    },
    effect: async (_a, c) => contactCol(c, 'next_action_at'),
  },
  {
    cv: 'CV-09', name: 'POST contacts/:contactId/log-communication', method: 'post',
    path: (c) => `contacts/${c}/log-communication`, body: { channelType: 'call', outcome: 'answered', notes: 'v84b call notes' },
    effect: async (_a, c) => db.contactEvent.count({ where: { contactId: c } }),
  },
  {
    cv: 'CV-10', name: 'POST contacts/:contactId/events', method: 'post',
    path: (c) => `contacts/${c}/events`, body: { type: 'followup.scheduled', description: 'v84b event' },
    effect: async (_a, c) => db.contactEvent.count({ where: { contactId: c } }),
  },
  {
    cv: 'CV-11', name: 'POST contacts/:contactId/playbook', method: 'post',
    path: (c) => `contacts/${c}/playbook`, body: { data: { marker: 'v84b-playbook-write' } },
    prepare: async (_a, c) => {
      await q(`UPDATE contact_playbooks SET data = '{}'::jsonb, last_used_at = NULL WHERE contact_id = '${c}'`);
    },
    effect: async (_a, c) => (await q(`SELECT data, last_used_at FROM contact_playbooks WHERE contact_id = '${c}'`))[0] ?? null,
  },
  {
    cv: 'CV-12', name: 'DELETE lists/:listId/contacts/:contactId', method: 'delete',
    path: (c) => `lists/${ID.list}/contacts/${c}`,
    prepare: async (_a, c) => {
      await q(`INSERT INTO contact_list_members (id, list_id, contact_id) VALUES ('${P}lm_${c}', '${ID.list}', '${c}')
               ON CONFLICT (list_id, contact_id) DO NOTHING`);
    },
    effect: async (_a, c) => db.contactListMember.count({ where: { listId: ID.list, contactId: c } }),
  },
  {
    cv: 'CV-13', name: 'POST contacts/:contactId/favorite', method: 'post',
    path: (c) => `contacts/${c}/favorite`,
    effect: async (_a, c) => (await q(`SELECT custom->>'isFavorite' AS v FROM contacts WHERE id = '${c}'`))[0].v,
  },
  {
    cv: 'CV-14', name: 'POST contacts/:contactId/conversations/read', method: 'post',
    path: (c) => `contacts/${c}/conversations/read`,
    prepare: async (a, c) => {
      await q(`DELETE FROM contact_read_states WHERE user_id = '${a}' AND contact_id = '${c}'`);
    },
    effect: async (a, c) => db.contactReadState.count({ where: { userId: a, contactId: c } }),
  },
  {
    cv: 'CV-15', name: 'POST contacts/:contactId/conversations/reply', method: 'post',
    path: (c) => `contacts/${c}/conversations/reply`, body: { channel: 'whatsapp', body: 'v84b reply body' },
    effect: async () => sendCalls.length,
    reaches: 'sender',
  },
  {
    cv: 'CV-16', name: 'GET contacts/:contactId/conversations/summary', method: 'get',
    path: (c) => `contacts/${c}/conversations/summary`,
    // A stale cached summary: the read regenerates it through the AI gateway.
    prepare: async (_a, c) => {
      await q(`UPDATE conversation_ai_insights SET hash = 'seed' WHERE contact_id = '${c}' AND kind = 'thread_summary'`);
    },
    effect: aiServiceCallsFor,
    reaches: 'ai',
  },
  {
    cv: 'CV-17', name: 'POST contacts/:contactId/conversations/summary/regenerate', method: 'post',
    path: (c) => `contacts/${c}/conversations/summary/regenerate`,
    effect: aiServiceCallsFor,
    reaches: 'ai',
  },
  {
    cv: 'CV-18', name: 'POST contacts/:contactId/conversations/suggest-replies', method: 'post',
    path: (c) => `contacts/${c}/conversations/suggest-replies`, body: { count: 1 },
    effect: aiServiceCallsFor,
    reaches: 'ai',
  },
  {
    cv: 'CV-19', name: 'GET contacts/:contactId/conversations/insights', method: 'get',
    path: (c) => `contacts/${c}/conversations/insights`,
    effect: aiServiceCallsFor,
  },
];

/** The (actor, contact) pairs GET detail refuses: the hidden calls. */
const HIDDEN: Array<{ actor: string; contactId: string; why: string }> = [
  { actor: ID.staffOwned, contactId: ID.cPriv, why: "STAFF_OWNED on the owner's PRIVATE contact" },
  { actor: ID.staffOwned, contactId: ID.cTeam, why: "STAFF_OWNED on the owner's TEAM contact (owned view)" },
  { actor: ID.admin, contactId: ID.cPriv, why: "ADMIN on the owner's PRIVATE contact" },
];

/** The (actor, contact) pairs GET detail opens: the controls. */
const VISIBLE: Array<{ actor: string; contactId: string; why: string }> = [
  { actor: ID.admin, contactId: ID.cTeam, why: 'ADMIN on the TEAM contact' },
  { actor: ID.staffOwned, contactId: ID.cStaff, why: 'STAFF_OWNED on its own contact' },
  { actor: ID.owner, contactId: ID.cPriv, why: 'OWNER on its PRIVATE contact' },
];

function send(route: Route, actor: string, contactId: string) {
  const req = request(app.getHttpServer())[route.method](`/crm/businesses/${ID.bizA}/${route.path(contactId)}`).set('x-test-user', actor);
  return route.body ? req.send(route.body) : req;
}

function sendMerge(actor: string, primaryId: string, duplicateId: string) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${ID.bizA}/contacts/${primaryId}/merge/${duplicateId}`)
    .set('x-test-user', actor)
    .send({});
}

function sendDeleteRelationship(actor: string, relationshipId: string) {
  return request(app.getHttpServer())
    .delete(`/crm/businesses/${ID.bizA}/relationships/${relationshipId}`)
    .set('x-test-user', actor);
}

const is2xx = (status: number) => status >= 200 && status < 300;

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { EntityResolutionService } = await import('../src/core/connectors/entity-resolution.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { CrmController } = await import('../src/modules/crm/crm.controller');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { CrmStatsService } = await import('../src/modules/crm/crm-stats.service');
  const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
  const { CrmCacheService } = await import('../src/modules/crm/crm-cache.service');
  const { CrmListsService } = await import('../src/modules/crm/crm-lists.service');
  const { CrmFlowService } = await import('../src/modules/crm/crm-flow.service');
  const { ContactAuditService } = await import('../src/modules/crm/privacy/contact-audit.service');
  const { ContactCustomFieldValueService } = await import('../src/modules/crm/contact-custom-field-value.service');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { FeatureFlagGuard } = await import('../src/modules/crm/guards/feature-flag.guard');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { CrmImportService } = await import('../src/modules/crm/crm-import.service');
  const { CrmPlaybookService } = await import('../src/modules/crm/crm-playbook.service');
  const { CrmActionsService } = await import('../src/modules/crm/crm-actions.service');
  const { CrmRevenueService } = await import('../src/modules/crm/crm-revenue.service');
  const { CrmJourneyService } = await import('../src/modules/crm/crm-journey.service');
  const { CrmDuplicateDetectionService } = await import('../src/modules/crm/crm-duplicate-detection.service');
  const { CrmDataQualityService } = await import('../src/modules/crm/crm-data-quality.service');
  const { CrmSavedViewsService } = await import('../src/modules/crm/crm-saved-views.service');
  const { CrmRelationshipHealthService } = await import('../src/modules/crm/crm-relationship-health.service');
  const { CrmCommunicationService } = await import('../src/modules/crm/crm-communication.service');
  const { BestChannelService } = await import('../src/modules/crm/best-channel.service');
  const { ConversationAiService } = await import('../src/modules/crm/conversation-ai.service');
  const { CrmNetworkService } = await import('../src/modules/crm/crm-network.service');
  const { ContactInsightService } = await import('../src/modules/crm/contact-insight.service');
  ({ assertContactVisible } = await import('../src/modules/crm/crm-permissions.helper') as any);

  // ---- the real services over the real client -----------------------------
  const prisma = { client: db } as any;
  const events = new EventEmitter2();
  const cache = { invalidate: async () => undefined }; // CrmCacheService is Redis
  const coreTimeline = new TimelineService(prisma);
  // EvidenceService and TaskAssignmentService: on no route here (task
  // completion and assignee resolution).
  const crmTimeline = new CrmTimelineService(prisma, events, coreTimeline, {} as any, {} as any);
  const stats = new CrmStatsService(prisma, crmTimeline, cache as any);
  const flow = new CrmFlowService(prisma, cache as any);
  const realConversationAi = new ConversationAiService(prisma, aiGateway as any, events);
  // The real service behind a call recorder: a route that reaches it is seen
  // even when it reads stored insights without the gateway.
  const conversationAi = new Proxy(realConversationAi, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop === 'string' && CONVERSATION_AI_METHODS.includes(prop) && typeof value === 'function') {
        return (...args: unknown[]) => {
          conversationAiCalls.push({ method: prop, contactId: String(args[1]) });
          return value.apply(target, args);
        };
      }
      return value;
    },
  });

  const moduleRef = await Test.createTestingModule({
    controllers: [CrmController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      FeatureFlagGuard,
      PlanLimitGuard,
      TeamAuditInterceptor,
      CrmService,
      { provide: EventEmitter2, useValue: events },
      { provide: CrmTimelineService, useValue: crmTimeline },
      { provide: CrmStatsService, useValue: stats },
      { provide: CrmListsService, useValue: new CrmListsService(prisma) },
      { provide: CrmFlowService, useValue: flow },
      { provide: ContactAuditService, useValue: new ContactAuditService(prisma) },
      { provide: CrmPlaybookService, useValue: new CrmPlaybookService(prisma) },
      // CrmDuplicateDetectionService: not on mark-verified's path.
      { provide: CrmDataQualityService, useValue: new CrmDataQualityService(prisma, {} as any) },
      { provide: CrmRelationshipHealthService, useValue: new CrmRelationshipHealthService(prisma, crmTimeline, stats) },
      { provide: CrmCommunicationService, useValue: new CrmCommunicationService(prisma, events, crmTimeline, sender as any) },
      { provide: ConversationAiService, useValue: conversationAi },
      // ReputationService: on POST refer only.
      { provide: CrmNetworkService, useValue: new CrmNetworkService(prisma, crmTimeline, {} as any) },
      { provide: CrmCacheService, useValue: cache },
      // Not on any route under test.
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: EntityResolutionService, useValue: {} },
      { provide: ContactCustomFieldValueService, useValue: {} },
      { provide: CrmImportService, useValue: {} },
      { provide: CrmActionsService, useValue: {} },
      { provide: CrmRevenueService, useValue: {} },
      { provide: CrmJourneyService, useValue: {} },
      { provide: CrmDuplicateDetectionService, useValue: {} },
      { provide: CrmSavedViewsService, useValue: {} },
      { provide: BestChannelService, useValue: {} },
      { provide: ContactInsightService, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only: what AuthMiddleware attaches after Supabase
  // verifies the token, for seeded v84b_ users only. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  await app.init();

  await cleanup(); // in case a prior run aborted

  // ---- identities, tenants, memberships ----------------------------------
  for (const id of [ID.owner, ID.admin, ID.staffOwned, ID.other]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V84B Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V84B Biz B', ownerId: ID.other } });
  const m = async (user: string, biz: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({
      data: { id: `${P}m_${user.slice(P.length)}_${biz.slice(P.length)}`, userId: user, businessId: biz, role, permissionScopes: permissionScopes ?? undefined },
    });
  await m(ID.owner, ID.bizA, 'OWNER');
  await m(ID.admin, ID.bizA, 'ADMIN');
  await m(ID.staffOwned, ID.bizA, 'STAFF', { crm: 'write', crm_view: 'owned' });
  await m(ID.other, ID.bizB, 'OWNER');

  // ---- contacts ------------------------------------------------------------
  const c = async (id: string, businessId: string, visibility: string, ownerId: string, n: number) =>
    db.contact.create({
      data: {
        id, businessId, firstName: id, visibility, ownerId,
        phone: `+1868555${String(1000 + n)}`,
        nextActionAt: new Date(Date.now() + 86_400_000), nextActionType: 'call',
      },
    });
  await c(ID.cPriv, ID.bizA, 'PRIVATE', ID.owner, 1);
  await c(ID.cTeam, ID.bizA, 'TEAM', ID.owner, 2);
  await c(ID.cStaff, ID.bizA, 'TEAM', ID.staffOwned, 3);
  await c(ID.cStaff2, ID.bizA, 'TEAM', ID.staffOwned, 4);
  await c(ID.cB, ID.bizB, 'TEAM', ID.other, 5);
  let n = 10;
  for (const id of MERGE_CONTACTS) {
    const kind = id.slice(P.length);
    if (kind.startsWith('mPriv')) await c(id, ID.bizA, 'PRIVATE', ID.owner, n++);
    else if (kind.startsWith('mTeam')) await c(id, ID.bizA, 'TEAM', ID.owner, n++);
    else await c(id, ID.bizA, 'TEAM', ID.staffOwned, n++);
  }

  // ---- what each route reads or writes, on every main contact ---------------
  await db.contactList.create({ data: { id: ID.list, businessId: ID.bizA, name: 'V84B list', type: 'MANUAL' } });
  for (const contactId of MAIN_CONTACTS) {
    const tail = contactId.slice(P.length);
    // A conversation thread (the AI routes skip an empty one).
    await db.contactEvent.create({
      data: { id: `${P}ev_${tail}`, businessId: ID.bizA, contactId, type: 'communication.email', data: { body: `v84b thread message ${tail}`, direction: 'in' } },
    });
    // A stored thread summary (insights returns it; summary regenerates a stale one).
    await db.conversationAIInsight.create({
      data: {
        id: `${P}ins_${tail}`, businessId: ID.bizA, contactId, kind: 'thread_summary', messageRef: '', hash: 'seed',
        sentiment: 'neutral', intent: 'v84b', summary: contactId === ID.cPriv ? SENSITIVE_INSIGHT : `v84b insight ${tail}`,
      },
    });
    await db.contactPlaybook.create({ data: { id: `${P}pb_${tail}`, businessId: ID.bizA, contactId, type: 'default', schemaVersion: '1', data: {} } });
    await db.contactDataIssue.create({
      data: { id: `${P}dq_${tail}`, businessId: ID.bizA, contactId, kind: 'stale_data', severity: 'low', message: `v84b stale ${tail}` },
    });
    await db.contactListMember.create({ data: { id: `${P}lm_${contactId}`, listId: ID.list, contactId } });
  }
  for (const edge of Object.values(REL)) {
    await db.contactRelationship.create({ data: { id: edge.id, businessId: ID.bizA, fromContactId: edge.from, toContactId: edge.to, type: 'colleague_of' } });
  }
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  // Let fire-and-forget writes (activity ledger, contact audit) of the last
  // permitted calls settle before the rows are removed.
  await new Promise((r) => setTimeout(r, 300));
  if (db) await cleanup();
});

describe('fixture sanity (real rows, real visibility rule)', () => {
  it('seeded the actors, contacts and child rows, and GET detail\'s rule hides exactly the HIDDEN pairs', async () => {
    expect(await db.membership.count({ where: { businessId: ID.bizA } })).toBe(3);
    const staff = await db.membership.findUnique({ where: { userId_businessId: { userId: ID.staffOwned, businessId: ID.bizA } } });
    expect(staff.permissionScopes).toEqual({ crm: 'write', crm_view: 'owned' });
    expect(await db.contactRelationship.count({ where: { businessId: ID.bizA } })).toBe(Object.keys(REL).length);
    expect(await db.contactListMember.count({ where: { listId: ID.list } })).toBe(MAIN_CONTACTS.length);
    const prisma = { client: db };
    const opens = async (actor: string, contactId: string) =>
      assertContactVisible(prisma, ID.bizA, contactId, actor).then(() => true, (err: any) => {
        if (err?.status === 404) return false;
        throw err;
      });
    for (const { actor, contactId, why } of HIDDEN) expect(await opens(actor, contactId), why).toBe(false);
    for (const { actor, contactId, why } of VISIBLE) expect(await opens(actor, contactId), why).toBe(true);
    for (const id of [MERGE.staffPrimaryHidden.primary, MERGE.staffDuplicateHidden.duplicate]) expect(await opens(ID.staffOwned, id), id).toBe(false);
    for (const id of [MERGE.adminPrimaryHidden.primary, MERGE.adminDuplicateHidden.duplicate]) expect(await opens(ID.admin, id), id).toBe(false);
    for (const id of [MERGE.staffPrimaryHidden.duplicate, MERGE.staffDuplicateHidden.primary]) expect(await opens(ID.staffOwned, id), id).toBe(true);
    for (const id of [MERGE.adminPrimaryHidden.duplicate, MERGE.adminDuplicateHidden.primary]) expect(await opens(ID.admin, id), id).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RED-BEFORE / GREEN-AFTER: a contact hidden from the member answers 404,
// byte-identical to an unknown id, and nothing is written or reached.
// ---------------------------------------------------------------------------

describe('contact-scoped routes refuse a contact the member cannot open (FOLLOW3-D2)', () => {
  for (const route of ROUTES) {
    it(`${route.cv} ${route.name}: a hidden contact answers 404 like an unknown id; no row is written and no recorder is reached (pre-fix FAIL expected)`, async () => {
      // Each hidden contact in a state where a permitted call would write.
      for (const { actor, contactId } of HIDDEN) await route.prepare?.(actor, contactId);
      const before = await snapshot();
      resetRecorders();

      const statuses: Record<string, number> = {};
      const bodies: Record<string, string> = {};
      for (const { actor, contactId, why } of HIDDEN) {
        const res = await send(route, actor, contactId);
        statuses[why] = res.status;
        bodies[why] = res.text;
      }
      const absent: Record<string, { status: number; text: string }> = {};
      for (const actor of [ID.staffOwned, ID.admin]) {
        const res = await send(route, actor, ABSENT);
        absent[actor] = { status: res.status, text: res.text };
      }

      expect(statuses, `${route.cv} statuses`).toEqual(Object.fromEntries(HIDDEN.map((h) => [h.why, 404])));
      for (const { actor, why } of HIDDEN) {
        expect(bodies[why], `${why}: discloses the stored AI insight`).not.toContain(SENSITIVE_INSIGHT);
        expect(JSON.parse(bodies[why]), why).toEqual(NOT_FOUND_BODY);
        expect(bodies[why], `${why}: body vs an unknown id`).toBe(absent[actor].text);
      }
      expect(recorderCalls(), `${route.cv} recorders`).toEqual({ ai: 0, sender: 0, conversationAi: 0 });
      expect(await snapshot(), `${route.cv} rows`).toEqual(before);
    });
  }

  it("CV-01 POST contacts/:contactId/merge/:duplicateId: merge refuses when either the primary or the duplicate is hidden, like an unknown id, and nothing is merged (pre-fix FAIL expected)", async () => {
    const before = await snapshot();
    resetRecorders();
    const cases = [
      { actor: ID.staffOwned, ...MERGE.staffPrimaryHidden, why: 'STAFF_OWNED: hidden PRIVATE primary' },
      { actor: ID.staffOwned, ...MERGE.staffDuplicateHidden, why: 'STAFF_OWNED: hidden PRIVATE duplicate' },
      { actor: ID.admin, ...MERGE.adminPrimaryHidden, why: 'ADMIN: hidden PRIVATE primary' },
      { actor: ID.admin, ...MERGE.adminDuplicateHidden, why: 'ADMIN: hidden PRIVATE duplicate' },
    ];
    const statuses: Record<string, number> = {};
    const bodies: Record<string, string> = {};
    for (const k of cases) {
      const res = await sendMerge(k.actor, k.primary, k.duplicate);
      statuses[k.why] = res.status;
      bodies[k.why] = res.text;
    }
    // One unknown id (the rate limit allows ten merges a minute per business).
    const absent = await sendMerge(ID.staffOwned, ABSENT, ID.cStaff);

    expect(statuses).toEqual(Object.fromEntries(cases.map((k) => [k.why, 404])));
    expect(absent.status).toBe(404);
    for (const k of cases) {
      expect(JSON.parse(bodies[k.why]), k.why).toEqual(NOT_FOUND_BODY);
      expect(bodies[k.why], `${k.why}: body vs an unknown id`).toBe(absent.text);
    }
    expect(recorderCalls()).toEqual({ ai: 0, sender: 0, conversationAi: 0 });
    // No merge operation, no soft-deleted duplicate, no repointed row.
    expect(await snapshot()).toEqual(before);
  });

  it('CV-20 DELETE relationships/:relationshipId: an edge with a hidden end answers 404 like an unknown relationship id, and the edge row is still present (pre-fix FAIL expected)', async () => {
    const before = await snapshot();
    const cases = [
      { actor: ID.staffOwned, rel: REL.staffToHidden.id, why: 'STAFF_OWNED: the to end is hidden' },
      { actor: ID.staffOwned, rel: REL.fromHidden.id, why: 'STAFF_OWNED: the from end is hidden' },
      { actor: ID.staffOwned, rel: REL.toPrivate.id, why: 'STAFF_OWNED: both ends are hidden' },
      { actor: ID.admin, rel: REL.fromHidden.id, why: 'ADMIN: the PRIVATE from end is hidden' },
      { actor: ID.admin, rel: REL.toPrivate.id, why: 'ADMIN: the PRIVATE to end is hidden' },
    ];
    const statuses: Record<string, number> = {};
    const bodies: Record<string, string> = {};
    for (const k of cases) {
      const res = await sendDeleteRelationship(k.actor, k.rel);
      statuses[k.why] = res.status;
      bodies[k.why] = res.text;
    }
    const absent: Record<string, string> = {};
    for (const actor of [ID.staffOwned, ID.admin]) absent[actor] = (await sendDeleteRelationship(actor, ABSENT_REL)).text;

    expect(statuses).toEqual(Object.fromEntries(cases.map((k) => [k.why, 404])));
    for (const k of cases) {
      expect(JSON.parse(bodies[k.why]), k.why).toEqual(REL_NOT_FOUND_BODY);
      expect(bodies[k.why], `${k.why}: body vs an unknown relationship id`).toBe(absent[k.actor]);
    }
    for (const id of [REL.staffToHidden.id, REL.fromHidden.id, REL.toPrivate.id]) {
      expect(await db.contactRelationship.count({ where: { id } }), id).toBe(1);
    }
    expect(await snapshot()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// CONTROLS (pass before and after): the same routes on contacts the member may
// open behave as today; OWNER is unaffected; a member of another business is
// refused by BusinessGuard.
// ---------------------------------------------------------------------------

describe('CONTROLS: visible contacts, OWNER and another tenant (pass before and after)', () => {
  for (const route of ROUTES) {
    it(`${route.cv} ${route.name}: ADMIN on the TEAM contact, STAFF_OWNED on its own contact and OWNER on its PRIVATE contact get 2xx and the write lands; a bizB member gets 403`, async () => {
      for (const { actor, contactId, why } of VISIBLE) {
        await route.prepare?.(actor, contactId);
        const ai = aiCalls.length;
        const sent = sendCalls.length;
        const effectBefore = await route.effect(actor, contactId);
        const res = await send(route, actor, contactId);
        expect(is2xx(res.status), `${why}: ${res.status} ${res.text}`).toBe(true);
        expect(await route.effect(actor, contactId), `${why}: effect`).not.toEqual(effectBefore);
        if (route.reaches === 'ai') expect(aiCalls.length, `${why}: AI gateway`).toBe(ai + 1);
        if (route.reaches === 'sender') {
          expect(sendCalls.length, `${why}: sender`).toBe(sent + 1);
          expect(sendCalls[sendCalls.length - 1].to).toBe(await contactCol(contactId, 'phone'));
        }
        if (route.cv === 'CV-19') {
          // The stored thread summary (the seed, or what the summary controls
          // above regenerated through the recorder).
          const stored = (await q(`SELECT summary FROM conversation_ai_insights WHERE contact_id = '${contactId}' AND kind = 'thread_summary'`))[0].summary;
          expect(stored).toBeTruthy();
          expect(res.body.rollup.lastSummary, `${why}: stored summary`).toBe(stored);
        }
      }
      const foreign = await send(route, ID.other, ID.cTeam);
      expect(foreign.status, `bizB member: ${foreign.text}`).toBe(403);
    });
  }

  it('CV-01 merge: ADMIN merges two TEAM contacts, STAFF_OWNED two of its own, OWNER two PRIVATE ones; a bizB member gets 403', async () => {
    const ops = () => db.mergeOperation.count({ where: { businessId: ID.bizA } });
    for (const [actor, pair] of [
      [ID.admin, MERGE.adminControl],
      [ID.staffOwned, MERGE.staffControl],
      [ID.owner, MERGE.ownerControl],
    ] as const) {
      const before = await ops();
      const res = await sendMerge(actor, pair.primary, pair.duplicate);
      expect(is2xx(res.status), `${actor}: ${res.status} ${res.text}`).toBe(true);
      expect(await ops()).toBe(before + 1);
      expect(await contactCol(pair.duplicate, 'deleted_at')).not.toBeNull();
      expect(await contactCol(pair.duplicate, 'merged_into_id')).toBe(pair.primary);
    }
    const foreign = await sendMerge(ID.other, ID.cTeam, ID.cStaff);
    expect(foreign.status).toBe(403);
  });

  it('CV-20 DELETE relationships: STAFF_OWNED deletes an edge between its own contacts, ADMIN one between TEAM contacts, OWNER one with a PRIVATE end; a bizB member gets 403 and the edge stays', async () => {
    for (const [actor, edge] of [
      [ID.staffOwned, REL.staffControl],
      [ID.admin, REL.adminControl],
      [ID.owner, REL.ownerControl],
    ] as const) {
      const res = await sendDeleteRelationship(actor, edge.id);
      expect(is2xx(res.status), `${actor}: ${res.status} ${res.text}`).toBe(true);
      expect(await db.contactRelationship.count({ where: { id: edge.id } })).toBe(0);
    }
    const foreign = await sendDeleteRelationship(ID.other, REL.toPrivate.id);
    expect(foreign.status).toBe(403);
  });
});
