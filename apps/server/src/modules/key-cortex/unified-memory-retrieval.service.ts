import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SemanticMemoryService, aiMemoryWithoutSettings } from '../ai/semantic-memory.service';
import { DOCUMENT_EXTRACTION_CATEGORY } from '../ai/ai-memory.service';
import { KEY_OBSERVATION_SOURCE } from './key-cortex-event.service';
import {
  GENOME_ROW_METADATA_KEY,
  MEMORY_CLASS_METADATA_KEY,
  SEMANTIC_SOURCE_METADATA_KEY,
} from './unified-memory.types';
import type {
  GenomeRowColumns,
  MemoryClassFragmentMeta,
  MemoryFragment,
  MemoryReaderContext,
  MemoryRetrievalOptions,
  MemorySourceType,
  SemanticSource,
} from './unified-memory.types';
import {
  buildDbMemoryClassPreFilter,
  buildDbNonSecretPreFilter,
  classifyAiMemoryForRead,
  classifyEmbeddingForRead,
  classifyTemporalMemoryForRead,
  evaluateBusinessEventForReader,
  evaluateEpisodicLogForReader,
  evaluateMemoryClassAccess,
  fetchProjectedBatch,
  getMemoryClassReadMode,
  isRowUnconditionallySecret,
  logMemoryClassShadowDiff,
  type MemoryClassShadowDiffEntry,
  type ReadMemoryClassification,
} from './memory-class-read-projection';
import type { TemporalEventProvenance } from '../ai/memory-classification';
import { isMoneyLabel, isMoneyMemoryEvent } from '../business-genome/key-genome/genome-finance-scope';

interface RawMemoryRow {
  id: string;
  createdAt: Date;
  content?: string;
  summary?: string;
  title?: string;
  confidence?: number;
  entityId?: string | null;
  entityType?: string | null;
  sourceType?: string;
  sourceEntityId?: string | null;
  eventType?: string;
  type?: string;
  metadata?: any;
  similarity?: number;
  category?: string;
  key?: string;
  value?: string;
  source?: string | null;
  sourceModule?: string | null;
  sourceEventIds?: string[];
  dataClass?: string | null;
  moduleScope?: readonly string[] | null;
  ownerUserId?: string | null;
  userResponse?: string;
  recommendation?: string;
  lessonsLearned?: string[];
}

/**
 * Single retrieval layer over all KEY memory stores.
 *
 * Hides the fragmentation between:
 *  - AiMemory / AiMemoryEmbedding (preferences, facts, semantic search)
 *  - GenomeMemoryEvent (recommendation/experiment/action outcomes)
 *  - TemporalFlowMemory (timeline summaries and patterns)
 *  - CognitionMemory (per-query learning)
 *
 * Returns a ranked list of normalized MemoryFragments for the reasoning engine.
 */
@Injectable()
export class UnifiedMemoryRetrievalService {
  private readonly logger = new Logger(UnifiedMemoryRetrievalService.name);
  /** Recency half-life in days. */
  private readonly RECENCY_HALF_LIFE_DAYS = 30;
  private readonly DECAY_CUTOFF_DAYS = 90;

  constructor(
    private readonly prisma: PrismaService,
    private readonly semanticMemory: SemanticMemoryService,
  ) {}

  async retrieveContext(
    businessId: string,
    options: MemoryRetrievalOptions = {},
  ): Promise<MemoryFragment[]> {
    const limit = options.limit ?? 20;
    const now = Date.now();
    const halfLifeMs = this.RECENCY_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000;

    const [structuredRows, semanticRows] = await Promise.all([
      this.loadStructuredMemory(businessId, options),
      options.query ? this.loadSemanticMemory(businessId, options.query, options) : [],
    ]);

    const combinedRows = [...structuredRows, ...semanticRows];
    // MEM-CLASS-READ (P137, design 6.1): filter BEFORE ranking and BEFORE any count/slice so a
    // withheld item changes nothing a reader sees (not rank, not score, not count, not top-K slot).
    const allRows = await this.filterRowsBeforeRank(businessId, combinedRows, options.readerContext);

    const decayCutoffMs = this.DECAY_CUTOFF_DAYS * 24 * 60 * 60 * 1000;

    const fragments = allRows.map((row) => {
      const sourceType = row.sourceType as MemorySourceType;
      const ageMs = now - new Date(row.createdAt).getTime();
      let recencyScore = Math.exp(-ageMs / halfLifeMs);
      if (ageMs > decayCutoffMs) {
        recencyScore *= 0.8;
      }
      // P92 (MEM-EXPIRED-NOT-SERVED): distinguish explicit confidence <= 0 (scores 0, lowest) from missing/unscored (0.5),
      // preserving `confidence * 0.5 + 0.5` (> 0.5) for all positive-confidence rows.
      const relevanceScore =
        row.similarity ??
        (typeof row.confidence === 'number' && Number.isFinite(row.confidence)
          ? row.confidence <= 0
            ? 0
            : row.confidence * 0.5 + 0.5
          : 0.5);
      const sourceWeight = this.sourceWeight(sourceType);
      let rankScore =
        (relevanceScore * 0.45 + recencyScore * 0.35 + sourceWeight * 0.2);

      if (options.entityId && (row.entityId ?? row.sourceEntityId) === options.entityId) {
        rankScore *= 1.2;
      }

      return {
        id: row.id,
        sourceType,
        title: this.extractTitle(row),
        content: this.extractContent(row),
        timestamp: new Date(row.createdAt),
        confidence: row.confidence ?? 0.5,
        relevanceScore,
        recencyScore,
        rankScore,
        entityId: row.entityId ?? row.sourceEntityId ?? null,
        entityType: row.entityType ?? null,
        metadata: this.safeMetadata(row.metadata),
      } as MemoryFragment;
    });

    const filtered = fragments.filter((f) => {
      if (options.sourceTypes && !options.sourceTypes.includes(f.sourceType)) return false;
      if (options.entityId && f.entityId !== options.entityId) return false;
      if (options.entityType && f.entityType !== options.entityType) return false;
      if (options.minRankScore && f.rankScore < options.minRankScore) return false;
      return true;
    });

    filtered.sort((a, b) => b.rankScore - a.rankScore);

    return filtered.slice(0, limit);
  }

  private async loadStructuredMemory(
    businessId: string,
    options: MemoryRetrievalOptions,
  ): Promise<RawMemoryRow[]> {
    const since = options.boostRecency !== false ? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) : undefined;
    const whereBase: any = { businessId };
    if (since) whereBase.createdAt = { gte: since };
    // FU-MEMORY-COPIES-REWRITE review SEC-FUMCR-2: not the settings rows (the owner's AI preferences with the BYOK keys'
    // ciphertext, the routing table, the autonomy settings): configuration, not memory, for no prompt.
    // MEM-DOC-EXTRACTION-SIGHT (D-234): nor the document extractions, unless the read asks for them (a reader with
    // revenue read): unread, a withheld extraction takes no place in the take or the ranked limit below.
    const settingsFree = aiMemoryWithoutSettings();
    // MEM-PATTERNS-SIGHT (D-100, D-234): nor the behavioural patterns, when the read says so (a reader who may not read
    // every pattern): unread, a withheld pattern takes no place in the take or the ranked limit either.
    const unreadCategories = [
      ...settingsFree.notIn,
      ...(options.documentExtractions === true ? [] : [DOCUMENT_EXTRACTION_CATEGORY]),
      ...(options.aiMemoryPatterns === false ? ['patterns'] : []),
    ];
    const readerCtx = options.readerContext;
    const classMode = getMemoryClassReadMode();
    const applyDbPreFilter = Boolean(readerCtx) && classMode === 'ACTIVE';
    const classPreFilter = applyDbPreFilter
      ? buildDbMemoryClassPreFilter(readerCtx!)
      : classMode !== 'OFF'
        ? buildDbNonSecretPreFilter()
        : undefined;

    // P92 (MEM-EXPIRED-NOT-SERVED): exclude expired AiMemory rows, matching AiMemoryService.getAll and SemanticMemoryService.
    const aiMemoryWhere: any = {
      ...whereBase,
      category: { notIn: unreadCategories },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      ...(classPreFilter ? { AND: [classPreFilter] } : {}),
    };
    const temporalWhere: any = classPreFilter
      ? { ...whereBase, AND: [classPreFilter] }
      : whereBase;
    const cognitionWhere: any =
      applyDbPreFilter && readerCtx?.reader
        ? { ...whereBase, userId: readerCtx.reader }
        : whereBase;
    const skipCognition = applyDbPreFilter && readerCtx?.reader === null;

    const includeEpisodic = options.includeEpisodic !== false;
    const episodicSince = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    // Some episodic memory is PERSONAL. AiExecutionLog and CortexActionLog carry
    // a userId and a rationale describing why someone asked for something; those
    // belong to the person, not the company. Business-wide stores are
    // deliberately NOT narrowed — an assistant that could not see that an invoice
    // went overdue because a colleague was the one who noticed would be useless.
    const episodicWhere: any = { businessId, createdAt: { gte: episodicSince } };

    // Only AiExecutionLog and CortexActionLog actually HAVE a userId column.
    // BusinessEvent does not — it identifies the actor via actorType/actorId.
    //
    // This was one object shared by all three. Adding `userId` to it made the
    // BusinessEvent query reference a column that does not exist, Prisma
    // rejected it, and because all eight stores are awaited by a single
    // Promise.all with one shared .catch() returning eight empty arrays, EVERY
    // store was lost — not just business events. The live chat always supplies a
    // userId, so the entire "WHAT YOU HAVE OBSERVED" section was silently absent
    // from every authenticated message, leaving one warn line behind.
    //
    // Worth knowing why it was easy to get wrong: apps/server/prisma/schema.prisma
    // is a stale duplicate whose BusinessEvent DOES declare userId. The runtime
    // schema is packages/db/prisma/schema.prisma, which is what PrismaService
    // binds to.
    // FU-KEY-EVENT-COLUMNS (D-220): the business's events, business-wide, but not KEY's own observations (its
    // decision, process and calibration logs, its cortex claims), which the KEY event writer keeps in business_events
    // for KEY's self-model: they are KEY's bookkeeping, not something that happened in the business, and would crowd
    // the business's events out of the 50 read.
    const episodicWhereOfEvents: any = { ...episodicWhere, NOT: { source: KEY_OBSERVATION_SOURCE } };
    const personalWhere: any = { ...episodicWhere };
    if (options.userId) personalWhere.userId = options.userId;
    if (applyDbPreFilter && readerCtx?.reader) personalWhere.userId = readerCtx.reader;
    // W11-FLOW-PERCEPTION-SCOPE review CR-W11FPS-1: a read that names the stores it wants (sourceTypes) does not
    // query a personal store it leaves out. A prompt with no reader names the business-wide stores, so it reads no
    // member's AiExecutionLog or CortexActionLog row at all, rather than every member's rows to drop afterwards.
    const readsPersonal = (source: MemorySourceType) =>
      includeEpisodic &&
      !(applyDbPreFilter && readerCtx?.reader === null) &&
      (!options.sourceTypes || options.sourceTypes.includes(source));

    const resolvedTemporalClass = new Map<string, ReadMemoryClassification>();

    const loadAiMemories = async () => {
      const fetchPage = (skip: number) =>
        this.prisma.client.aiMemory.findMany({
          where: aiMemoryWhere,
          orderBy: { createdAt: 'desc' },
          ...(skip > 0 ? { skip } : {}),
          take: 50,
          select: {
            id: true,
            category: true,
            key: true,
            value: true,
            source: true,
            confidence: true,
            dataClass: true,
            moduleScope: true,
            createdAt: true,
          },
        });
      if (!applyDbPreFilter || !readerCtx) return fetchPage(0);
      return fetchProjectedBatch({
        targetCount: 50,
        batchSize: 50,
        fetchPage: (skip) => fetchPage(skip),
        projectPage: (page) =>
          page.filter((m: any) => {
            const classified = classifyAiMemoryForRead({
              id: m.id,
              category: m.category,
              key: m.key,
              value: m.value,
              source: m.source ?? null,
              dataClass: m.dataClass ?? null,
              moduleScope: m.moduleScope ?? null,
            });
            return evaluateMemoryClassAccess(
              {
                dataClass: classified.dataClass,
                moduleScope: classified.moduleScope,
                invalidDataClass: classified.invalidDataClass,
                invalidModuleScope: classified.invalidModuleScope,
                hasOwnerColumn: false,
                backstopTexts: [m.category, m.key, m.value],
                skipExpenseBackstop: m.category === DOCUMENT_EXTRACTION_CATEGORY,
              },
              readerCtx,
            ).allowed;
          }),
      });
    };

    const loadTemporalMemories = async () => {
      const fetchPage = (skip: number) =>
        this.prisma.client.temporalFlowMemory.findMany({
          where: temporalWhere,
          orderBy: { createdAt: 'desc' },
          ...(skip > 0 ? { skip } : {}),
          take: 50,
          select: {
            id: true,
            entityType: true,
            entityId: true,
            type: true,
            content: true,
            sourceModule: true,
            sourceEventIds: true,
            confidence: true,
            dataClass: true,
            moduleScope: true,
            createdAt: true,
            metadata: true,
          },
        });
      if (!applyDbPreFilter || !readerCtx) return fetchPage(0);
      return fetchProjectedBatch({
        targetCount: 50,
        batchSize: 50,
        fetchPage: (skip) => fetchPage(skip),
        projectPage: async (page) => {
          const legacyIds = new Set<string>();
          for (const t of page as any[]) {
            if (!t.dataClass && t.entityType !== 'business' && t.sourceModule !== 'key_cortex') {
              for (const evId of t.sourceEventIds ?? []) legacyIds.add(evId);
            }
          }
          const pageEventMap = new Map<string, TemporalEventProvenance>();
          if (legacyIds.size > 0 && this.prisma.client.temporalFlowEvent?.findMany) {
            try {
              const fetched = await this.prisma.client.temporalFlowEvent.findMany({
                where: { businessId, id: { in: [...legacyIds] } },
                select: {
                  id: true,
                  source: true,
                  type: true,
                  module: true,
                  entityType: true,
                  title: true,
                  summary: true,
                  description: true,
                },
              });
              for (const ev of fetched) pageEventMap.set(ev.id, ev);
            } catch (err: unknown) {
              this.logger.warn(
                `[unifiedMemory][${businessId}] temporal event resolution failed (fail closed): ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
          return page.filter((t: any) => {
            const classified = classifyTemporalMemoryForRead(
              {
                id: t.id,
                entityType: t.entityType,
                entityId: t.entityId ?? null,
                type: t.type ?? null,
                sourceModule: t.sourceModule ?? null,
                sourceEventIds: Array.isArray(t.sourceEventIds) ? t.sourceEventIds : [],
                metadata: t.metadata,
                content: t.content ?? null,
                dataClass: t.dataClass ?? null,
                moduleScope: t.moduleScope ?? null,
              },
              pageEventMap,
            );
            resolvedTemporalClass.set(t.id, classified);
            return evaluateMemoryClassAccess(
              {
                dataClass: classified.dataClass,
                moduleScope: classified.moduleScope,
                invalidDataClass: classified.invalidDataClass,
                invalidModuleScope: classified.invalidModuleScope,
                hasOwnerColumn: false,
                backstopTexts: [t.entityType, t.type, t.sourceModule, t.content],
                unclassifiedRequiresAllModules: true,
              },
              readerCtx,
            ).allowed;
          });
        },
      });
    };

    const [
      aiMemories,
      genomeEvents,
      temporalMemories,
      cognitionMemories,
      cognitiveEvents,
      businessEvents,
      aiExecutionLogs,
      cortexActionLogs,
    ] = await Promise.all([
      loadAiMemories(),
      this.prisma.client.genomeMemoryEvent.findMany({
        where: whereBase,
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          sourceType: true,
          sourceEntityId: true,
          eventType: true,
          // FU-KEY-MEMORY-MONEY-SIGHT (SEC-W1FPMS-3): the row's module columns, carried in the fragment (genomeRowOf).
          domain: true,
          section: true,
          title: true,
          summary: true,
          confidenceDelta: true,
          createdAt: true,
          metadata: true,
        },
      }),
      loadTemporalMemories(),
      skipCognition
        ? Promise.resolve([])
        : this.prisma.client.cognitionMemory.findMany({
            where: cognitionWhere,
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: {
              id: true,
              userId: true,
              roleId: true,
              query: true,
              recommendation: true,
              userResponse: true,
              confidence: true,
              lessonsLearned: true,
              createdAt: true,
              metadata: true,
            },
          }),
      this.prisma.client.cognitiveEvent.findMany({
        where: whereBase,
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          sourceType: true,
          sourceId: true,
          eventType: true,
          payload: true,
          confidence: true,
          createdAt: true,
        },
      }),
      includeEpisodic
        ? this.prisma.client.businessEvent.findMany({
            where: episodicWhereOfEvents,
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: {
              id: true,
              eventType: true,
              subjectType: true,
              subjectId: true,
              actorType: true,
              actorId: true,
              action: true,
              before: true,
              after: true,
              metadata: true,
              createdAt: true,
            },
          })
        : Promise.resolve([]),
      readsPersonal('ai_execution_log')
        ? this.prisma.client.aiExecutionLog.findMany({
            where: personalWhere,
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: {
              id: true,
              userId: true,
              action: true,
              toolName: true,
              module: true,
              success: true,
              rationale: true,
              inputSummary: true,
              outputSummary: true,
              errorMessage: true,
              createdAt: true,
            },
          })
        : Promise.resolve([]),
      readsPersonal('cortex_action_log')
        ? this.prisma.client.cortexActionLog.findMany({
            where: personalWhere,
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: {
              id: true,
              userId: true,
              actionType: true,
              status: true,
              description: true,
              result: true,
              error: true,
              requiresApproval: true,
              estimatedImpact: true,
              createdAt: true,
            },
          })
        : Promise.resolve([]),
      // Settled individually, NOT Promise.all with one shared catch.
      //
      // A single shared .catch() returning eight empty arrays meant any one
      // malformed query silently erased all eight stores. That is precisely how
      // the BusinessEvent/userId bug above stayed invisible: perception looked
      // merely empty rather than broken. Now a bad store costs only itself, and
      // says which one it was.
    ].map((p, i) =>
      Promise.resolve(p).catch((err: any) => {
        const names = [
          'aiMemory', 'genomeMemoryEvent', 'temporalFlowMemory', 'cognitionMemory',
          'cognitiveEvent', 'businessEvent', 'aiExecutionLog', 'cortexActionLog',
        ];
        this.logger.warn(
          `Structured memory load failed for ${names[i]}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return [] as any[];
      }),
    ));

    const rows: RawMemoryRow[] = [];

    for (const m of aiMemories as any[]) {
      const classMeta: MemoryClassFragmentMeta = {
        store: 'ai_memory',
        dataClass: m.dataClass ?? null,
        moduleScope: m.moduleScope ?? null,
        hasOwnerColumn: false,
        category: m.category,
        key: m.key,
        source: m.source ?? null,
      };
      rows.push({
        id: m.id,
        sourceType: 'ai_memory',
        category: m.category,
        key: m.key,
        value: m.value,
        source: m.source ?? null,
        dataClass: m.dataClass ?? null,
        moduleScope: m.moduleScope ?? null,
        content: `${m.category}.${m.key}: ${m.value}`,
        confidence: m.confidence ?? 1,
        createdAt: m.createdAt,
        metadata: { [MEMORY_CLASS_METADATA_KEY]: classMeta },
      });
    }

    for (const e of genomeEvents as any[]) {
      rows.push({
        id: e.id,
        sourceType: 'genome_memory_event',
        sourceEntityId: e.sourceEntityId,
        eventType: e.eventType,
        title: e.title,
        summary: e.summary,
        content: e.summary ?? e.title,
        confidence: e.confidenceDelta ? 0.5 + e.confidenceDelta / 2 : 0.5,
        createdAt: e.createdAt,
        metadata: this.genomeMetadata(e),
      });
    }

    for (const t of temporalMemories as any[]) {
      const resolved = resolvedTemporalClass.get(t.id);
      const effectiveDataClass =
        resolved && !resolved.invalidDataClass && !t.dataClass ? resolved.dataClass : (t.dataClass ?? null);
      const effectiveModuleScope =
        resolved && !resolved.invalidModuleScope && !t.dataClass
          ? resolved.moduleScope
          : (t.moduleScope ?? null);
      const classMeta: MemoryClassFragmentMeta = {
        store: 'temporal_flow_memory',
        dataClass: effectiveDataClass,
        moduleScope: effectiveModuleScope,
        hasOwnerColumn: false,
        entityType: t.entityType,
        entityId: t.entityId ?? null,
        type: t.type ?? null,
        sourceModule: t.sourceModule ?? null,
        sourceEventIds: Array.isArray(t.sourceEventIds) ? t.sourceEventIds : [],
      };
      rows.push({
        id: t.id,
        sourceType: 'temporal_flow_memory',
        entityType: t.entityType,
        entityId: t.entityId,
        type: t.type,
        sourceModule: t.sourceModule ?? null,
        sourceEventIds: Array.isArray(t.sourceEventIds) ? t.sourceEventIds : [],
        dataClass: effectiveDataClass,
        moduleScope: effectiveModuleScope,
        content: t.content,
        confidence: t.confidence,
        createdAt: t.createdAt,
        metadata: this.withClassMetadata(t.metadata, classMeta),
      });
    }

    for (const c of cognitionMemories as any[]) {
      const lessons = Array.isArray(c.lessonsLearned) ? c.lessonsLearned.join(' ') : '';
      const classMeta: MemoryClassFragmentMeta = {
        store: 'cognition_memory',
        dataClass: 'PERSONAL',
        moduleScope: [],
        ownerUserId: c.userId ?? null,
        hasOwnerColumn: true,
      };
      rows.push({
        id: c.id,
        sourceType: 'cognition_memory',
        dataClass: 'PERSONAL',
        moduleScope: [],
        ownerUserId: c.userId ?? null,
        content: `Query: ${c.query}\nRecommendation: ${c.recommendation}\nUser response: ${c.userResponse}\nLessons: ${lessons}`,
        confidence: c.confidence,
        createdAt: c.createdAt,
        metadata: this.withClassMetadata(c.metadata, classMeta),
      });
    }

    for (const e of cognitiveEvents as any[]) {
      rows.push({
        id: e.id,
        sourceType: 'cognitive_event',
        sourceEntityId: e.sourceId,
        eventType: e.eventType,
        content: `${e.eventType}: ${JSON.stringify(e.payload)}`,
        confidence: e.confidence,
        createdAt: e.createdAt,
        // FU-KEY-MEMORY-MONEY-SIGHT (review COR-W1FPMS-1 follow-up): the payload itself, so a prompt's projection reads a
        // task's own type (and a proposal's action and status, SEC-W1FPMS-4) without parsing the rendered content.
        metadata: { sourceType: e.sourceType, payload: e.payload },
      });
    }

    for (const e of businessEvents as any[]) {
      rows.push({
        id: e.id,
        sourceType: 'business_event',
        entityType: e.subjectType,
        entityId: e.subjectId,
        eventType: e.eventType,
        content: `${e.actorType} ${e.action} ${e.subjectType}${e.after ? ': ' + JSON.stringify(e.after) : ''}`,
        confidence: 0.8,
        createdAt: e.createdAt,
        // FU-KEY-MEMORY-MONEY-SIGHT (SEC-W1FPMS-4): its actor type and action too, which a memberless turn's proposal
        // line is built from (the rendered content is never parsed back).
        metadata: { before: e.before, after: e.after, source: e.source, metadata: e.metadata, actorType: e.actorType, action: e.action },
      });
    }

    for (const l of aiExecutionLogs as any[]) {
      rows.push({
        id: l.id,
        sourceType: 'ai_execution_log',
        ownerUserId: l.userId ?? null,
        eventType: l.action,
        content: `${l.action}${l.toolName ? ' (' + l.toolName + ')' : ''}${l.module ? ' [' + l.module + ']' : ''}: ${l.success ? 'success' : 'failure'} — ${l.rationale ?? JSON.stringify(l.outputSummary ?? l.inputSummary ?? {})}`,
        confidence: l.success ? 0.85 : 0.6,
        createdAt: l.createdAt,
        metadata: { toolName: l.toolName, module: l.module, success: l.success, errorMessage: l.errorMessage } as Record<string, unknown>,
      });
    }

    for (const l of cortexActionLogs as any[]) {
      rows.push({
        id: l.id,
        sourceType: 'cortex_action_log',
        ownerUserId: l.userId ?? null,
        eventType: l.actionType,
        content: `${l.actionType}: ${l.status}${l.description ? ' — ' + l.description : ''}${l.result ? ' — ' + l.result : ''}`,
        confidence: l.status === 'success' ? 0.9 : 0.6,
        createdAt: l.createdAt,
        metadata: { status: l.status, requiresApproval: l.requiresApproval, estimatedImpact: l.estimatedImpact },
      });
    }

    return rows;
  }

  /**
   * MEM-CLASS-READ (P137, design 6.1): filters candidate rows across ALL stores
   * through the unified `data_class` / `module_scope` / `PERSONAL` / backstop
   * projection BEFORE composite ranking and BEFORE slicing to `limit`.
   */
  private async filterRowsBeforeRank(
    businessId: string,
    rows: RawMemoryRow[],
    readerCtx?: MemoryReaderContext,
  ): Promise<RawMemoryRow[]> {
    const mode = getMemoryClassReadMode();
    if (mode === 'OFF') return rows;

    // Even when no readerContext is passed, SECRET_BEARING and secret-pattern rows are NEVER served.
    if (!readerCtx) {
      if (mode === 'SHADOW') return rows;
      return rows.filter(
        (r) =>
          !isRowUnconditionallySecret(r.dataClass, [
            r.value,
            r.content,
            r.summary,
            r.title,
            r.recommendation,
          ]),
      );
    }

    // Batch-resolve source temporal events for any remaining legacy dataClass=null TemporalFlowMemory rows.
    const legacyEventIds = new Set<string>();
    for (const row of rows) {
      if (
        row.sourceType === 'temporal_flow_memory' &&
        !row.dataClass &&
        row.entityType !== 'business' &&
        row.sourceModule !== 'key_cortex'
      ) {
        for (const evId of row.sourceEventIds ?? []) legacyEventIds.add(evId);
      }
    }
    const eventMap = new Map<string, TemporalEventProvenance>();
    if (legacyEventIds.size > 0 && this.prisma.client.temporalFlowEvent?.findMany) {
      try {
        const fetched = await this.prisma.client.temporalFlowEvent.findMany({
          where: { businessId, id: { in: [...legacyEventIds] } },
          select: {
            id: true,
            source: true,
            type: true,
            module: true,
            entityType: true,
            title: true,
            summary: true,
            description: true,
          },
        });
        for (const ev of fetched) eventMap.set(ev.id, ev);
      } catch (err: unknown) {
        this.logger.warn(
          `[unifiedMemory][${businessId}] temporal event resolution failed (fail closed): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const PROPOSAL_GENOME_SOURCES = new Set(['KEY_ACTION_PROPOSAL', 'GOVERNANCE_DECISION']);
    const isProposalEvent = (row: RawMemoryRow): boolean => {
      if (row.entityType === 'key_action_proposal') return true;
      if (row.eventType === 'GOVERNANCE_DECISION') return true;
      const ev = (row.eventType ?? '').toLowerCase();
      if (ev.includes('proposal')) return true;
      const meta = row.metadata && typeof row.metadata === 'object' ? (row.metadata as Record<string, unknown>) : null;
      if (meta) {
        if (typeof meta.sourceType === 'string' && meta.sourceType.toLowerCase().includes('proposal')) {
          return true;
        }
        const genomeRow =
          meta[GENOME_ROW_METADATA_KEY] && typeof meta[GENOME_ROW_METADATA_KEY] === 'object'
            ? (meta[GENOME_ROW_METADATA_KEY] as GenomeRowColumns)
            : null;
        if (typeof genomeRow?.sourceType === 'string' && PROPOSAL_GENOME_SOURCES.has(genomeRow.sourceType)) {
          return true;
        }
        const payload =
          meta.payload && typeof meta.payload === 'object' ? (meta.payload as Record<string, unknown>) : null;
        if (payload?.eventType === 'GOVERNANCE_DECISION' || payload?.subjectType === 'key_action_proposal') {
          return true;
        }
      }
      return false;
    };

    const evaluateRow = (row: RawMemoryRow) => {
      switch (row.sourceType) {
        case 'ai_memory': {
          const classified = classifyAiMemoryForRead({
            id: row.id,
            category: row.category ?? '',
            key: row.key ?? '',
            value: row.value ?? row.content ?? null,
            source: row.source ?? null,
            dataClass: row.dataClass ?? null,
            moduleScope: (row.moduleScope as readonly string[] | null | undefined) ?? null,
          });
          return evaluateMemoryClassAccess(
            {
              dataClass: classified.dataClass,
              moduleScope: classified.moduleScope,
              invalidDataClass: classified.invalidDataClass,
              invalidModuleScope: classified.invalidModuleScope,
              hasOwnerColumn: false,
              backstopTexts: [row.category, row.key, row.value ?? row.content],
              skipExpenseBackstop: row.category === DOCUMENT_EXTRACTION_CATEGORY,
            },
            readerCtx,
          );
        }
        case 'temporal_flow_memory': {
          const classified = classifyTemporalMemoryForRead(
            {
              id: row.id,
              entityType: row.entityType ?? 'business',
              entityId: row.entityId ?? null,
              type: row.type ?? null,
              sourceModule: row.sourceModule ?? null,
              sourceEventIds: row.sourceEventIds ?? [],
              metadata: row.metadata,
              content: row.content ?? null,
              dataClass: row.dataClass ?? null,
              moduleScope: (row.moduleScope as readonly string[] | null | undefined) ?? null,
            },
            eventMap,
          );
          // R1 Blocker 3: stamp resolved classification onto fragment metadata so downstream
          // `readersOwnPromptMemory` does not re-classify legacy NULL rows without `eventMap`.
          if (!row.dataClass && !classified.invalidDataClass && !classified.invalidModuleScope) {
            const existingMeta =
              row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
                ? (row.metadata as Record<string, unknown>)
                : {};
            const existingClassMeta =
              existingMeta[MEMORY_CLASS_METADATA_KEY] &&
              typeof existingMeta[MEMORY_CLASS_METADATA_KEY] === 'object' &&
              !Array.isArray(existingMeta[MEMORY_CLASS_METADATA_KEY])
                ? (existingMeta[MEMORY_CLASS_METADATA_KEY] as Record<string, unknown>)
                : {};
            row.metadata = {
              ...existingMeta,
              [MEMORY_CLASS_METADATA_KEY]: {
                ...existingClassMeta,
                store: 'temporal_flow_memory',
                dataClass: classified.dataClass,
                moduleScope: classified.moduleScope,
              },
            };
          }
          return evaluateMemoryClassAccess(
            {
              dataClass: classified.dataClass,
              moduleScope: classified.moduleScope,
              invalidDataClass: classified.invalidDataClass,
              invalidModuleScope: classified.invalidModuleScope,
              hasOwnerColumn: false,
              backstopTexts: [row.entityType, row.type, row.sourceModule, row.content],
              unclassifiedRequiresAllModules: true,
            },
            readerCtx,
          );
        }
        case 'cognition_memory': {
          return evaluateMemoryClassAccess(
            {
              dataClass: 'PERSONAL',
              moduleScope: [],
              hasOwnerColumn: true,
              ownerUserId: row.ownerUserId ?? null,
              backstopTexts: [row.content],
            },
            readerCtx,
          );
        }
        case 'ai_memory_embedding': {
          const meta =
            row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
              ? (row.metadata as Record<string, unknown>)
              : {};
          const semanticSource =
            meta[SEMANTIC_SOURCE_METADATA_KEY] && typeof meta[SEMANTIC_SOURCE_METADATA_KEY] === 'object'
              ? (meta[SEMANTIC_SOURCE_METADATA_KEY] as { sourceType?: unknown })
              : undefined;
          const embSourceType =
            typeof semanticSource?.sourceType === 'string' ? semanticSource.sourceType : 'unknown';
          const classified = classifyEmbeddingForRead({
            id: row.id,
            sourceType: embSourceType,
            content: row.content ?? null,
            metadata: meta,
            dataClass: row.dataClass ?? null,
            moduleScope: (row.moduleScope as readonly string[] | null | undefined) ?? null,
          });
          const isDocExtraction =
            embSourceType === 'memory' &&
            (meta.category === DOCUMENT_EXTRACTION_CATEGORY || meta.type === DOCUMENT_EXTRACTION_CATEGORY);
          return evaluateMemoryClassAccess(
            {
              dataClass: classified.dataClass,
              moduleScope: classified.moduleScope,
              invalidDataClass: classified.invalidDataClass,
              invalidModuleScope: classified.invalidModuleScope,
              hasOwnerColumn: false,
              backstopTexts: [row.content],
              skipExpenseBackstop: isDocExtraction,
            },
            readerCtx,
          );
        }
        case 'ai_execution_log':
        case 'cortex_action_log': {
          const meta =
            row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
              ? (row.metadata as Record<string, unknown>)
              : {};
          return evaluateEpisodicLogForReader(
            {
              id: row.id,
              userId: row.ownerUserId ?? null,
              module: typeof meta.module === 'string' ? meta.module : null,
              toolName: typeof meta.toolName === 'string' ? meta.toolName : null,
              action: row.eventType ?? null,
              actionType: row.eventType ?? null,
              description: row.content ?? null,
            },
            readerCtx,
          );
        }
        case 'genome_memory_event': {
          // Proposal outcome genome records follow D-226/D-238 (memberlessProposalView / financialProposalRecordIds)
          if (isProposalEvent(row)) {
            if (isRowUnconditionallySecret(row.dataClass, [row.title, row.summary, row.content])) {
              return evaluateMemoryClassAccess(
                { dataClass: 'SECRET_BEARING', moduleScope: [] },
                readerCtx,
              );
            }
            return {
              allowed: true,
              reason: 'proposal_surface_projection',
              effectiveDataClass: 'GENERAL' as const,
              effectiveModuleScope: [],
            };
          }
          const meta =
            row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
              ? (row.metadata as Record<string, unknown>)
              : {};
          const genomeRow =
            meta[GENOME_ROW_METADATA_KEY] && typeof meta[GENOME_ROW_METADATA_KEY] === 'object'
              ? (meta[GENOME_ROW_METADATA_KEY] as GenomeRowColumns)
              : null;
          // Match FU-KEY-MEMORY-MONEY-SIGHT (`genomeModulesOf`): money genome events require `revenue:read`;
          // non-money genome summaries (e.g. OPERATIONS_GENOME) remain general business summaries.
          const isMoney = genomeRow
            ? isMoneyMemoryEvent(genomeRow) ||
              isMoneyLabel(genomeRow.domain) ||
              isMoneyLabel(genomeRow.section)
            : false;
          return evaluateMemoryClassAccess(
            {
              dataClass: isMoney ? 'REVENUE' : 'GENERAL',
              moduleScope: isMoney ? ['revenue'] : [],
              hasOwnerColumn: false,
              backstopTexts: [row.title, row.summary, row.content],
            },
            readerCtx,
          );
        }
        case 'business_event':
        case 'cognitive_event': {
          // Proposal events follow D-226 / D-238 (DB-backed financial classification + memberlessProposalView
          // in readersOwnPromptMemory); still enforce unconditional secret defense here.
          if (isProposalEvent(row)) {
            if (isRowUnconditionallySecret(row.dataClass, [row.content])) {
              return evaluateMemoryClassAccess(
                { dataClass: 'SECRET_BEARING', moduleScope: [] },
                readerCtx,
              );
            }
            return {
              allowed: true,
              reason: 'proposal_surface_projection',
              effectiveDataClass: 'GENERAL' as const,
              effectiveModuleScope: [],
            };
          }
          const meta =
            row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
              ? (row.metadata as Record<string, unknown>)
              : {};
          return evaluateBusinessEventForReader(
            {
              id: row.id,
              eventType: row.eventType ?? null,
              subjectType: row.entityType ?? (typeof meta.sourceType === 'string' ? meta.sourceType : null),
              action: typeof meta.action === 'string' ? meta.action : null,
              source: typeof meta.source === 'string' ? meta.source : null,
              before: meta.before,
              after: meta.after ?? meta.payload,
              metadata: meta.metadata,
            },
            readerCtx,
          );
        }
        default: {
          if (isRowUnconditionallySecret(row.dataClass, [row.content, row.value, row.summary])) {
            return evaluateMemoryClassAccess(
              { dataClass: 'SECRET_BEARING', moduleScope: [] },
              readerCtx,
            );
          }
          return {
            allowed: true,
            reason: 'deferred_to_surface_projection',
            effectiveDataClass: 'GENERAL' as const,
            effectiveModuleScope: [],
          };
        }
      }
    };

    if (mode === 'SHADOW') {
      try {
        const diffs: MemoryClassShadowDiffEntry[] = [];
        let projectedCount = 0;
        for (const row of rows) {
          const decision = evaluateRow(row);
          if (decision.allowed) projectedCount += 1;
          else {
            diffs.push({
              id: row.id ?? 'unknown',
              store: row.sourceType ?? 'unknown',
              dataClass: decision.effectiveDataClass,
              moduleScope: decision.effectiveModuleScope,
              legacyAllowed: true,
              projectedAllowed: false,
              reason: decision.reason,
            });
          }
        }
        logMemoryClassShadowDiff(this.logger, {
          path: 'UnifiedMemoryRetrievalService.retrieveContext',
          businessId,
          readerPresent: readerCtx.reader !== null,
          totalCandidates: rows.length,
          legacyCount: rows.length,
          projectedCount,
          diffs,
        });
      } catch {
        // Crash-isolated: shadow failure never impacts live retrieval.
      }
      return rows;
    }

    return rows.filter((row) => evaluateRow(row).allowed);
  }

  private withClassMetadata(
    metadata: unknown,
    classMeta: MemoryClassFragmentMeta,
  ): Record<string, unknown> {
    const own = this.safeMetadata(metadata);
    const base = own && !Array.isArray(own) ? own : own === undefined ? {} : { raw: own };
    return { ...base, [MEMORY_CLASS_METADATA_KEY]: classMeta };
  }

  /**
   * Retrieve only episodic memory fragments (business events, AI execution logs,
   * cortex action logs) from the last 90 days.
   */
  async retrieveEpisodicContext(
    businessId: string,
    options: Omit<MemoryRetrievalOptions, 'includeEpisodic'> = {},
  ): Promise<MemoryFragment[]> {
    return this.retrieveContext(businessId, {
      ...options,
      includeEpisodic: true,
      sourceTypes: ['business_event', 'ai_execution_log', 'cortex_action_log'],
    });
  }

  private async loadSemanticMemory(
    businessId: string,
    query: string,
    options: MemoryRetrievalOptions,
  ): Promise<RawMemoryRow[]> {
    // MEM-UNIFIED-SEMANTIC-SIGHT (D-257, D-234, D-100): a hit's text is whatever its source holds (a temporal summary of
    // an overdue invoice, a statement chunk, a money pattern's copy), so a read that carries no reader's sight reads no
    // semantic memory at all (fail closed).
    const sight = options.semanticSight;
    if (!sight) return [];
    try {
      const results = await this.semanticMemory.search({
        businessId,
        query,
        limit: options.limit ?? 20,
        sourceTypes: options.sourceTypes?.filter((s) =>
          ['ai_memory_embedding', 'memory', 'event', 'conversation', 'document'].includes(s as string),
        ) as any,
        minSimilarity: 0.65,
        // MEM-DOC-EXTRACTION-SIGHT (D-234): nor the copies of document extractions, unless the read asks for them and the
        // reader may see them.
        includeDocumentExtractionCopies: options.documentExtractions === true && sight.includeDocumentExtractionCopies === true,
        // MEM-UNIFIED-SEMANTIC-SIGHT: MEM-SEMANTIC-SIGHT's reader projection (readerSearchOptions): each hit resolved to its
        // source and kept only when its source's rule admits the reader, before the limit is cut.
        visibleTo: sight.visibleTo,
      });

      return results.map((r) => ({
        id: r.id,
        sourceType: 'ai_memory_embedding' as MemorySourceType,
        content: r.content,
        similarity: r.similarity,
        confidence: r.similarity,
        dataClass: r.dataClass ?? null,
        moduleScope: r.moduleScope ?? null,
        createdAt: r.metadata?.createdAt ? new Date(r.metadata.createdAt as string) : new Date(),
        // MEM-UNIFIED-SEMANTIC-SIGHT: the copy keeps its source, written after the copy's own metadata.
        metadata: this.semanticMetadata(r),
      }));
    } catch (err: any) {
      this.logger.warn(`Semantic memory search failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  private sourceWeight(sourceType: MemorySourceType): number {
    switch (sourceType) {
      case 'ai_memory':
        return 0.85;
      case 'ai_memory_embedding':
        return 0.8;
      case 'genome_memory_event':
        return 0.9;
      case 'temporal_flow_memory':
        return 0.75;
      case 'cognition_memory':
        return 0.8;
      case 'cognitive_event':
        return 0.75;
      case 'conversation':
        return 0.7;
      case 'business_event':
        return 0.8;
      case 'ai_execution_log':
        return 0.75;
      case 'cortex_action_log':
        return 0.85;
      default:
        return 0.5;
    }
  }

  private extractTitle(row: RawMemoryRow): string {
    return row.title ?? row.eventType ?? row.type ?? row.category ?? row.key ?? 'Memory fragment';
  }

  private extractContent(row: RawMemoryRow): string {
    return row.content ?? row.summary ?? row.value ?? row.recommendation ?? '';
  }

  /**
   * FU-KEY-MEMORY-MONEY-SIGHT (review SEC-W1FPMS-3; D-128, D-100): a genome fragment's metadata, the row's own metadata
   * with the row's sourceType, eventType, domain and section under GENOME_ROW_METADATA_KEY, written last so a writer's
   * metadata cannot stand in for them. The genome's REST routes withhold its money memory events (isMoneyMemoryEvent:
   * FINANCE_GENOME, a finance signal, CROSS_DOMAIN, the customer-sales snapshot) from a reader without revenue read;
   * the fragment carried none of these columns, so a KEY prompt could not apply the same rule.
   */
  private genomeMetadata(e: {
    sourceType?: string | null;
    eventType?: string | null;
    domain?: string | null;
    section?: string | null;
    metadata?: unknown;
  }): Record<string, unknown> {
    const own = this.safeMetadata(e.metadata);
    const row: GenomeRowColumns = {
      sourceType: e.sourceType ?? null,
      eventType: e.eventType ?? null,
      domain: e.domain ?? null,
      section: e.section ?? null,
    };
    const base = own && !Array.isArray(own) ? own : own === undefined ? {} : { raw: own };
    return { ...base, [GENOME_ROW_METADATA_KEY]: row };
  }

  /**
   * MEM-UNIFIED-SEMANTIC-SIGHT (D-257): a semantic fragment's metadata: the copy's own, then its source (sourceType,
   * sourceId) under SEMANTIC_SOURCE_METADATA_KEY, written last so the copy's own metadata cannot stand in for it.
   */
  private semanticMetadata(r: {
    sourceType: string;
    sourceId: string;
    metadata?: unknown;
    dataClass?: string | null;
    moduleScope?: string[] | null;
  }): Record<string, unknown> {
    const own = this.safeMetadata(r.metadata);
    const base = own && !Array.isArray(own) ? own : own === undefined ? {} : { raw: own };
    const source: SemanticSource = { sourceType: r.sourceType, sourceId: r.sourceId };
    const classMeta: MemoryClassFragmentMeta = {
      store: 'ai_memory_embedding',
      dataClass: r.dataClass ?? null,
      moduleScope: r.moduleScope ?? null,
      hasOwnerColumn: false,
      source: r.sourceType,
    };
    return {
      ...base,
      [SEMANTIC_SOURCE_METADATA_KEY]: source,
      [MEMORY_CLASS_METADATA_KEY]: classMeta,
    };
  }

  private safeMetadata(metadata: any): Record<string, unknown> | undefined {
    if (!metadata) return undefined;
    if (typeof metadata === 'object') return metadata as Record<string, unknown>;
    try {
      return JSON.parse(metadata) as Record<string, unknown>;
    } catch {
      return { raw: metadata };
    }
  }
}
