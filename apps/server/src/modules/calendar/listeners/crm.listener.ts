import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CalendarProjectionService } from '../calendar-projection.service';
import {
  mapContactNextAction,
  mapContactTask,
  SourceContact,
  SourceContactTask,
} from '../projection-mappers';

interface ContactTaskPayload {
  businessId: string;
  task: SourceContactTask;
}
interface ContactTaskDeletedPayload {
  businessId: string;
  taskId: string;
}
interface ContactNextActionPayload {
  businessId: string;
  contactId: string;
}

@Injectable()
export class CalendarCrmListener {
  private readonly logger = new Logger(CalendarCrmListener.name);

  constructor(
    @Inject(CalendarProjectionService)
    private readonly projection: CalendarProjectionService,
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent('contact_task.created', { async: true })
  @OnEvent('contact_task.updated', { async: true })
  @OnEvent('contact_task.rescheduled', { async: true })
  @OnEvent('contact_task.completed', { async: true })
  @OnEvent('contact_task.reopened', { async: true })
  async onContactTaskChanged(payload: ContactTaskPayload): Promise<void> {
    if (!payload?.businessId || !payload?.task) return;
    const input = mapContactTask(payload.task, payload.businessId);
    if (!input) {
      await this.projection
        .removeForSource({
          businessId: payload.businessId,
          sourceType: 'contact_task',
          sourceId: payload.task.id,
        })
        .catch(() => {});
      return;
    }
    try {
      await this.projection.upsertFromSource(input);
    } catch (err: any) {
      this.logger.warn(
        `contact_task projection failed id=${payload.task.id}: ${(err as Error).message}`,
      );
    }
  }

  @OnEvent('contact_task.deleted', { async: true })
  async onContactTaskDeleted(payload: ContactTaskDeletedPayload): Promise<void> {
    if (!payload?.businessId || !payload?.taskId) return;
    await this.projection
      .removeForSource({
        businessId: payload.businessId,
        sourceType: 'contact_task',
        sourceId: payload.taskId,
      })
      .catch((err: Error) =>
        this.logger.warn(`contact_task delete projection failed: ${err.message}`),
      );
  }

  // ---- Contact next action (follow-up reminder) ----

  @OnEvent('contact.next_action_set', { async: true })
  async onNextActionSet(payload: ContactNextActionPayload): Promise<void> {
    if (!payload?.businessId || !payload?.contactId) return;
    const contact = (await this.prisma.client.contact
      .findFirst({
        where: { id: payload.contactId, businessId: payload.businessId, deletedAt: null },
      })
      .catch(() => null)) as SourceContact | null;
    if (!contact) return;
    const input = mapContactNextAction(contact, payload.businessId);
    if (!input) {
      await this.projection
        .removeForSource({
          businessId: payload.businessId,
          sourceType: 'activity',
          sourceId: `next_action:${payload.contactId}`,
        })
        .catch(() => {});
      return;
    }
    try {
      await this.projection.upsertFromSource(input);
    } catch (err: any) {
      this.logger.warn(
        `contact.next_action projection failed contact=${payload.contactId}: ${(err as Error).message}`,
      );
    }
  }

  @OnEvent('contact.next_action_cleared', { async: true })
  async onNextActionCleared(payload: ContactNextActionPayload): Promise<void> {
    if (!payload?.businessId || !payload?.contactId) return;
    await this.projection
      .removeForSource({
        businessId: payload.businessId,
        sourceType: 'activity',
        sourceId: `next_action:${payload.contactId}`,
      })
      .catch((err: Error) =>
        this.logger.warn(`contact.next_action delete failed: ${err.message}`),
      );
  }
}
