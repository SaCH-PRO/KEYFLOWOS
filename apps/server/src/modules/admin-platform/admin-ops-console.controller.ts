import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { AdminGuard } from '../../core/auth/admin.guard';
import { AdminOpsConsoleService, type OpsConsoleSnapshot } from './admin-ops-console.service';

/**
 * D-237 / D-291 (OPS-CONSOLE-READONLY, server half):
 * Bounded, owner-only (`SUPER_ADMIN` + local HMAC admin sign-in), strictly read-only
 * engineering console endpoint. No mutations, no approval/execution actions, and no
 * browser-exposed credentials.
 */
@Controller('api/admin/ops')
@UseGuards(AuthGuard, AdminGuard)
export class AdminOpsConsoleController {
  constructor(
    @Inject(AdminOpsConsoleService)
    private readonly opsConsole: AdminOpsConsoleService,
  ) {}

  @Get('console')
  async getConsole(): Promise<OpsConsoleSnapshot> {
    return this.opsConsole.getSnapshot();
  }
}
