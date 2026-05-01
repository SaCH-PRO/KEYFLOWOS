import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ModelGatewayService } from '../ai/model-gateway.service';

export interface KeyflowNoteInput {
  targetType: string;
  targetId: string;
  targetLabel?: string | null;
  body?: string;
  pinned?: boolean;
}

@Injectable()
export class KeyflowNotesService {
  private readonly logger = new Logger(KeyflowNotesService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ModelGatewayService) private readonly gateway: ModelGatewayService,
  ) {}

  async list(businessId: string, targetType?: string, targetId?: string) {
    const notes = await this.prisma.client.keyflowNote.findMany({
      where: {
        businessId,
        ...(targetType ? { targetType } : {}),
        ...(targetId ? { targetId } : {}),
      },
      orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
      take: 100,
    });
    return notes;
  }

  async create(
    businessId: string,
    input: KeyflowNoteInput,
    authorId?: string | null,
  ) {
    return this.prisma.client.keyflowNote.create({
      data: {
        businessId,
        targetType: input.targetType,
        targetId: input.targetId,
        targetLabel: input.targetLabel ?? null,
        body: input.body ?? '',
        pinned: input.pinned ?? false,
        authorId: authorId ?? null,
      },
    });
  }

  async update(
    businessId: string,
    noteId: string,
    patch: Partial<KeyflowNoteInput>,
  ) {
    const existing = await this.prisma.client.keyflowNote.findFirst({
      where: { id: noteId, businessId },
    });
    if (!existing) throw new NotFoundException('Note not found');

    return this.prisma.client.keyflowNote.update({
      where: { id: noteId },
      data: {
        body: patch.body ?? existing.body,
        pinned: patch.pinned ?? existing.pinned,
        targetLabel: patch.targetLabel ?? existing.targetLabel,
      },
    });
  }

  async delete(businessId: string, noteId: string) {
    const existing = await this.prisma.client.keyflowNote.findFirst({
      where: { id: noteId, businessId },
    });
    if (!existing) throw new NotFoundException('Note not found');
    await this.prisma.client.keyflowNote.delete({ where: { id: noteId } });
    return { success: true };
  }

  /**
   * Generate a concise AI brief for a note's body and persist it.
   * Falls back to the first 220 chars of the body when the LLM is unreachable.
   */
  async generateBrief(businessId: string, noteId: string) {
    const note = await this.prisma.client.keyflowNote.findFirst({
      where: { id: noteId, businessId },
    });
    if (!note) throw new NotFoundException('Note not found');

    if (!note.body?.trim()) {
      return { ...note, aiBrief: null };
    }

    let brief: string | null = null;
    try {
      const response = await this.gateway.complete({
        businessId,
        taskCategory: 'summarization',
        messages: [
          {
            role: 'system',
            content:
              'You are a Caribbean small-business operator’s assistant. Summarize the user note in one or two clear sentences, surface action items as a short bullet list when present, and keep the tone warm and pragmatic. Use TTD currency formatting when amounts appear.',
          },
          {
            role: 'user',
            content: `Note attached to ${note.targetType}${note.targetLabel ? ` (${note.targetLabel})` : ''}:\n\n${note.body}`,
          },
        ],
        maxTokens: 280,
      });
      brief = response.content?.trim() || null;
    } catch (err) {
      this.logger.warn(`Keyflow note brief generation failed: ${(err as Error).message}`);
      brief = note.body.slice(0, 220) + (note.body.length > 220 ? '…' : '');
    }

    return this.prisma.client.keyflowNote.update({
      where: { id: noteId },
      data: { aiBrief: brief },
    });
  }
}
