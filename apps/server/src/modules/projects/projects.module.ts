import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectRevenueListener } from './project-revenue.listener';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectRevenueListener],
  exports: [ProjectsService],
})
export class ProjectsModule {}
