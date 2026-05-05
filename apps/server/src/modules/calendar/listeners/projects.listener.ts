import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CalendarProjectionService } from '../calendar-projection.service';
import {
  mapProject,
  mapProjectTask,
  SourceProject,
  SourceProjectTask,
} from '../projection-mappers';

interface ProjectPayload {
  businessId: string;
  project: SourceProject;
}
interface ProjectDeletedPayload {
  businessId: string;
  projectId: string;
}
interface ProjectTaskPayload {
  businessId: string;
  task: SourceProjectTask;
}
interface ProjectTaskDeletedPayload {
  businessId: string;
  taskId: string;
}

@Injectable()
export class CalendarProjectsListener {
  private readonly logger = new Logger(CalendarProjectsListener.name);

  constructor(
    @Inject(CalendarProjectionService)
    private readonly projection: CalendarProjectionService,
  ) {}

  @OnEvent('project.created', { async: true })
  @OnEvent('project.updated', { async: true })
  @OnEvent('project.completed', { async: true })
  async onProjectChanged(payload: ProjectPayload): Promise<void> {
    const p = payload?.project;
    if (!payload?.businessId || !p) return;
    const input = mapProject(p, payload.businessId);
    if (!input) {
      await this.projection
        .removeForSource({
          businessId: payload.businessId,
          sourceType: 'project',
          sourceId: p.id,
        })
        .catch(() => {});
      return;
    }
    try {
      await this.projection.upsertFromSource(input);
    } catch (err) {
      this.logger.warn(`project projection failed id=${p.id}: ${(err as Error).message}`);
    }
  }

  @OnEvent('project.deleted', { async: true })
  async onProjectDeleted(payload: ProjectDeletedPayload): Promise<void> {
    if (!payload?.businessId || !payload?.projectId) return;
    await this.projection
      .removeForSource({
        businessId: payload.businessId,
        sourceType: 'project',
        sourceId: payload.projectId,
      })
      .catch((err: Error) =>
        this.logger.warn(`project delete projection failed: ${err.message}`),
      );
  }

  @OnEvent('project_task.created', { async: true })
  @OnEvent('project_task.updated', { async: true })
  @OnEvent('project_task.completed', { async: true })
  @OnEvent('project_task.rescheduled', { async: true })
  async onProjectTaskChanged(payload: ProjectTaskPayload): Promise<void> {
    const t = payload?.task;
    if (!payload?.businessId || !t) return;
    const input = mapProjectTask(t, payload.businessId);
    if (!input) {
      await this.projection
        .removeForSource({
          businessId: payload.businessId,
          sourceType: 'project_task',
          sourceId: t.id,
        })
        .catch(() => {});
      return;
    }
    try {
      await this.projection.upsertFromSource(input);
    } catch (err) {
      this.logger.warn(`project_task projection failed id=${t.id}: ${(err as Error).message}`);
    }
  }

  @OnEvent('project_task.deleted', { async: true })
  async onProjectTaskDeleted(payload: ProjectTaskDeletedPayload): Promise<void> {
    if (!payload?.businessId || !payload?.taskId) return;
    await this.projection
      .removeForSource({
        businessId: payload.businessId,
        sourceType: 'project_task',
        sourceId: payload.taskId,
      })
      .catch((err: Error) =>
        this.logger.warn(`project_task delete projection failed: ${err.message}`),
      );
  }
}
