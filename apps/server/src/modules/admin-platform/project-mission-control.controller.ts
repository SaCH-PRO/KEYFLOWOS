import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { AdminGuard } from '../../core/auth/admin.guard';
import { ProjectMissionControlService } from './project-mission-control.service';

@Controller('api/admin/mission-control')
@UseGuards(AuthGuard, AdminGuard)
export class ProjectMissionControlController {
  constructor(
    @Inject(ProjectMissionControlService)
    private readonly missionControl: ProjectMissionControlService,
  ) {}

  @Get()
  snapshot() {
    return this.missionControl.snapshot();
  }
}
