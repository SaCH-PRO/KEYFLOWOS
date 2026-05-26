import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ProjectPlanExecutorService } from './project-plan-executor.service';

@Injectable()
export class ProjectPlanListener {
  private readonly logger = new Logger(ProjectPlanListener.name);

  constructor(
    @Inject(ProjectPlanExecutorService) private readonly executor: ProjectPlanExecutorService,
  ) {}

  @OnEvent('project_plan.materialized')
  async handlePlanMaterialized(payload: { planId: string; projectId: string; businessId: string }) {
    this.logger.log(`Plan ${payload.planId} materialized into project ${payload.projectId}`);
    try {
      await this.executor.autoExecutePlanEvents(payload.businessId, payload.planId);
    } catch (err) {
      this.logger.error(`Auto-execution failed for plan ${payload.planId}: ${(err as Error).message}`);
    }
  }
}
