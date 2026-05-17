import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectRevenueListener } from './project-revenue.listener';
import { TimelineModule } from '../timeline/timeline.module';
import { TaskAssignmentModule } from '../task-assignments/task-assignment.module';
import { EvidenceModule } from '../evidence/evidence.module';

@Module({
  imports: [TimelineModule, TaskAssignmentModule, EvidenceModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectRevenueListener],
  exports: [ProjectsService],
})
export class ProjectsModule {}
