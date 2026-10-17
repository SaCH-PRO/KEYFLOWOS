import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Inject,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { AdminGuard } from '../../core/auth/admin.guard';
import { HandoffMonitorService } from './handoff-monitor.service';

/**
 * GET-only snapshot of the ChatGPT -> Claude handoffs on issue #80, for the
 * owner console's Mission Control. SUPER_ADMIN only: the class-level guards
 * run before the handler, so an unauthorized request never reaches the
 * service or its cache.
 *
 * This is the `/handoffs` sub-path of the Mission Control namespace. The bare
 * `api/admin/mission-control` route belongs to PR #146's project snapshot and
 * is not registered here.
 */
@Controller('api/admin/mission-control/handoffs')
@UseGuards(AuthGuard, AdminGuard)
export class HandoffMonitorController {
  constructor(
    @Inject(HandoffMonitorService)
    private readonly handoffs: HandoffMonitorService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  snapshot(
    @Query('task') task?: string,
    @Query('limit') limit?: string,
    @Query('noise') noise?: string,
  ) {
    if (task !== undefined && !/^\d{1,15}$/.test(task)) {
      throw new BadRequestException('task must be a comment id');
    }
    if (limit !== undefined && !/^\d{1,3}$/.test(limit)) {
      throw new BadRequestException('limit must be a number');
    }
    return this.handoffs.snapshot({
      task: task === undefined ? undefined : Number(task),
      limit: limit === undefined ? undefined : Number(limit),
      includeNoise: noise === '1' || noise === 'true',
    });
  }
}
