import type { Logger } from '@nestjs/common';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { CanonicalModule } from '../../core/authority/module-vocabulary';
import {
  EVENT_MODULES,
  modulesNamedBy,
  readsDocumentExtractions,
  type ModuleSight,
} from '../key-cortex/key-cortex-prompt-context.service';
import { isMoneyLabel, proposalTextStatesMoney } from '../business-genome/key-genome/genome-finance-scope';
import { AI_MEMORY_COPY_SOURCE_TYPE, DOCUMENT_EXTRACTION_CATEGORY, type SemanticMemory } from './semantic-memory.service';

/**
 * MEM-SEMANTIC-SIGHT (P0; D-234, D-227, D-238, D-100, D-128, D-257): who a semantic memory read is for. `reader` is the
 * member whose read it is (promptMemoryReader: the caller while a member, else null); `sight` the modules they may read
 * (readersModuleSight, or a staff position's resolved modules).
 */
export interface SemanticReader {
  reader: string | null;
  sight: ModuleSight;
}

/** The ai_memory_embeddings source types a hit can resolve to; any other has no source to resolve and fails closed. */
export const TEMPORAL_MEMORY_SOURCE_TYPE = 'temporal_memory';
export const KNOWLEDGE_CHUNK_SOURCE_TYPE = 'document';

/** Whether free text states money (a money word or a figure): the fail-closed text backstop of design 8.2. */
function textIsMoney(value: unknown): boolean {
  return typeof value === 'string' && value !== '' && (isMoneyLabel(value) || proposalTextStatesMoney(value));
}

/** A knowledge chunk's source id: `<knowledgeSourceId>:<chunkIndex>` (KnowledgeIngestionService.ingestText). */
function knowledgeSourceIdOf(sourceId: string): string {
  const at = sourceId.lastIndexOf(':');
  return at > 0 ? sourceId.slice(0, at) : sourceId;
}

interface TemporalRow {
  id: string;
  entityType: string;
  sourceModule: string;
  sourceEventIds: string[];
  content: string;
}
interface SourceEvent {
  id: string;
  type: string;
  source: string;
  module: string | null;
  entityType: string | null;
  title: string | null;
  summary: string | null;
  description: string | null;
}

/**
 * MEM-SEMANTIC-SIGHT (design 8.2 taint propagation): the modules a reader needs to see a temporal-memory summary: those
 * its entity type and source module name, the union of those every source event names (its module, type, source and
 * entity type), and revenue when a source event is money (a KEY proposal's event, or money in its title, summary or
 * description) or the summary's own text (or its copy's) states money. A source event that is gone, or that names no
 * module, needs every module (D-227: unclassified fails closed); so does a summary that names none at all.
 */
export function temporalMemoryModulesOf(row: TemporalRow, events: ReadonlyMap<string, SourceEvent>, copyContent?: string): CanonicalModule[] {
  const modules = new Set<CanonicalModule>(modulesNamedBy(row.entityType, row.sourceModule));
  const add = (list: readonly CanonicalModule[]) => list.forEach((module) => modules.add(module));
  for (const id of row.sourceEventIds ?? []) {
    const event = events.get(id);
    if (!event) {
      add(EVENT_MODULES);
      continue;
    }
    const named = modulesNamedBy(event.module, event.type, event.source, event.entityType);
    add(named.length ? named : EVENT_MODULES);
    if (event.entityType === 'key_action_proposal' || [event.title, event.summary, event.description].some(textIsMoney)) modules.add('revenue');
  }
  if (textIsMoney(row.content) || textIsMoney(copyContent)) modules.add('revenue');
  return modules.size ? [...modules] : [...EVENT_MODULES];
}

/**
 * MEM-SEMANTIC-SIGHT: for each hit, whether `who` may be handed it, by its source's own rule (sourceType, sourceId,
 * always within `businessId`):
 * - an AiMemory copy ('memory') as its row: a document extraction (DOCUMENT_EXTRACTION_CATEGORY) only to a member reader
 *   with revenue read (readsDocumentExtractions, MEM-DOC-EXTRACTION-SIGHT); any other row as readersOwnPromptMemory
 *   serves AiMemory rows (business-wide);
 * - a temporal-memory summary ('temporal_memory') when the reader may read every module temporalMemoryModulesOf names;
 * - a knowledge-source chunk ('document'): its KnowledgeSource carries no classification (a statement or a menu alike),
 *   so only a member reader with revenue read (D-234 fail closed, as a document extraction);
 * - any other source type, or a source not found in the business: nobody (an unresolvable source fails closed).
 * A read that fails withholds every hit of the page (fail closed).
 */
export async function semanticHitsVisibleTo(
  prisma: PrismaService,
  businessId: string,
  who: SemanticReader,
  hits: ReadonlyArray<Pick<SemanticMemory, 'sourceType' | 'sourceId' | 'content'>>,
  logger?: Pick<Logger, 'warn'>,
): Promise<boolean[]> {
  try {
    const idsOf = (type: string) => [...new Set(hits.filter((h) => h.sourceType === type).map((h) => h.sourceId))];
    const memoryIds = idsOf(AI_MEMORY_COPY_SOURCE_TYPE);
    const temporalIds = idsOf(TEMPORAL_MEMORY_SOURCE_TYPE);
    const knowledgeIds = [...new Set(idsOf(KNOWLEDGE_CHUNK_SOURCE_TYPE).map(knowledgeSourceIdOf))];

    const [memoryRows, temporalRows, knowledgeRows] = await Promise.all([
      memoryIds.length
        ? prisma.client.aiMemory.findMany({ where: { businessId, id: { in: memoryIds } }, select: { id: true, category: true } })
        : [],
      temporalIds.length
        ? prisma.client.temporalFlowMemory.findMany({
            where: { businessId, id: { in: temporalIds } },
            select: { id: true, entityType: true, sourceModule: true, sourceEventIds: true, content: true },
          })
        : [],
      knowledgeIds.length
        ? prisma.client.knowledgeSource.findMany({ where: { businessId, id: { in: knowledgeIds } }, select: { id: true } })
        : [],
    ]);
    const eventIds = [...new Set((temporalRows as TemporalRow[]).flatMap((row) => row.sourceEventIds ?? []))];
    const eventRows: SourceEvent[] = eventIds.length
      ? await prisma.client.temporalFlowEvent.findMany({
          where: { businessId, id: { in: eventIds } },
          select: { id: true, type: true, source: true, module: true, entityType: true, title: true, summary: true, description: true },
        })
      : [];

    const categories = new Map((memoryRows as Array<{ id: string; category: string }>).map((row) => [row.id, row.category]));
    const temporal = new Map((temporalRows as TemporalRow[]).map((row) => [row.id, row]));
    const knowledge = new Set((knowledgeRows as Array<{ id: string }>).map((row) => row.id));
    const events = new Map(eventRows.map((event) => [event.id, event]));
    const memberWithRevenue = readsDocumentExtractions(who.sight, who.reader);

    return hits.map((hit) => {
      switch (hit.sourceType) {
        case AI_MEMORY_COPY_SOURCE_TYPE: {
          const category = categories.get(hit.sourceId);
          if (category === undefined) return false;
          return category !== DOCUMENT_EXTRACTION_CATEGORY || memberWithRevenue;
        }
        case TEMPORAL_MEMORY_SOURCE_TYPE: {
          const row = temporal.get(hit.sourceId);
          return row ? temporalMemoryModulesOf(row, events, hit.content).every(who.sight) : false;
        }
        case KNOWLEDGE_CHUNK_SOURCE_TYPE:
          return knowledge.has(knowledgeSourceIdOf(hit.sourceId)) && memberWithRevenue;
        default:
          return false;
      }
    });
  } catch (err: unknown) {
    logger?.warn(`[semanticSight][${businessId}] source read failed, no semantic hit served: ${err instanceof Error ? err.message : String(err)}`);
    return hits.map(() => false);
  }
}

/**
 * MEM-SEMANTIC-SIGHT: the SemanticMemoryService.search options that make a read `who`'s: every hit passes
 * semanticHitsVisibleTo before the limit is cut (search pages on past withheld hits, so they take no place and change
 * nothing returned), and the copies of document extractions are not even read for a reader who may not see them.
 */
export function readerSearchOptions(
  prisma: PrismaService,
  businessId: string,
  who: SemanticReader,
  logger?: Pick<Logger, 'warn'>,
): { withoutDocumentExtractionCopies: boolean; visibleTo: (hits: SemanticMemory[]) => Promise<boolean[]> } {
  return {
    withoutDocumentExtractionCopies: !readsDocumentExtractions(who.sight, who.reader),
    visibleTo: (hits) => semanticHitsVisibleTo(prisma, businessId, who, hits, logger),
  };
}
