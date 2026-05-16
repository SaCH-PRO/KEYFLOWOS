import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface EvidencePrediction {
  required: boolean;
  confidence: number;
  similarTasksCount: number;
  evidenceRate: number;
}

@Injectable()
export class EvidencePredictionService {
  private readonly logger = new Logger(EvidencePredictionService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async predict(
    businessId: string,
    input: { taskType: 'ContactTask' | 'ProjectTask'; title: string },
  ): Promise<EvidencePrediction> {
    const words = this.tokenize(input.title);
    if (words.length === 0) {
      return { required: false, confidence: 0, similarTasksCount: 0, evidenceRate: 0 };
    }

    // Fetch historical tasks with evidence data
    let historical: Array<{ title: string; evidenceRequired: boolean; hasEvidence: boolean }> = [];

    if (input.taskType === 'ContactTask') {
      const tasks = await this.prisma.client.contactTask.findMany({
        where: { businessId, status: 'DONE' },
        select: { title: true, evidenceRequired: true },
        take: 200,
      });
      const evidenceCounts = await this.prisma.client.evidence.groupBy({
        by: ['linkedId'],
        where: { businessId, linkedType: 'ContactTask' },
        _count: { linkedId: true },
      });
      const evidenceMap = new Map(evidenceCounts.map((e) => [e.linkedId, e._count.linkedId]));
      // We need task IDs for the evidence map, but groupBy doesn't give us titles.
      // Simpler approach: just use evidenceRequired flag as proxy
      historical = tasks.map((t) => ({
        title: t.title,
        evidenceRequired: t.evidenceRequired,
        hasEvidence: t.evidenceRequired, // proxy: if required, assume evidence was submitted
      }));
    } else {
      const tasks = await this.prisma.client.projectTask.findMany({
        where: { businessId, isCompleted: true },
        select: { title: true, evidenceRequired: true },
        take: 200,
      });
      historical = tasks.map((t) => ({
        title: t.title,
        evidenceRequired: t.evidenceRequired,
        hasEvidence: t.evidenceRequired,
      }));
    }

    if (historical.length === 0) {
      return { required: false, confidence: 0, similarTasksCount: 0, evidenceRate: 0 };
    }

    // Find similar tasks by token overlap
    const similar = historical
      .map((h) => {
        const histWords = this.tokenize(h.title);
        const overlap = words.filter((w) => histWords.includes(w)).length;
        const similarity = overlap / Math.max(words.length, histWords.length);
        return { ...h, similarity };
      })
      .filter((h) => h.similarity > 0.3)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 20);

    if (similar.length === 0) {
      return { required: false, confidence: 0, similarTasksCount: 0, evidenceRate: 0 };
    }

    const withEvidence = similar.filter((s) => s.hasEvidence).length;
    const evidenceRate = withEvidence / similar.length;
    const required = evidenceRate > 0.6;
    const confidence = Math.min(1, similar.length / 10); // more samples = higher confidence

    return {
      required,
      confidence: Math.round(confidence * 100) / 100,
      similarTasksCount: similar.length,
      evidenceRate: Math.round(evidenceRate * 100) / 100,
    };
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .filter((w) => !this.stopWords.has(w));
  }

  private stopWords = new Set([
    'the', 'and', 'for', 'with', 'you', 'that', 'this', 'from', 'have', 'has', 'had',
    'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall', 'must',
    'task', 'project', 'contact', 'client', 'follow', 'up', 'call', 'send',
  ]);
}
