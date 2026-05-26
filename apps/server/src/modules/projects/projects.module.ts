import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectRevenueListener } from './project-revenue.listener';
import { ProjectPlanListener } from './project-plan.listener';
import { ProjectPlannerService } from './project-planner.service';
import { ProjectPlanExecutorService } from './project-plan-executor.service';
import { TimelineModule } from '../timeline/timeline.module';
import { TaskAssignmentModule } from '../task-assignments/task-assignment.module';
import { EvidenceModule } from '../evidence/evidence.module';
import { AiModule } from '../ai/ai.module';
import { BlueprintModule } from '../blueprint/blueprint.module';

@Module({
  imports: [TimelineModule, TaskAssignmentModule, EvidenceModule, AiModule, BlueprintModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectRevenueListener, ProjectPlanListener, ProjectPlannerService, ProjectPlanExecutorService],
  exports: [ProjectsService, ProjectPlannerService, ProjectPlanExecutorService],
})
export class ProjectsModule {}
