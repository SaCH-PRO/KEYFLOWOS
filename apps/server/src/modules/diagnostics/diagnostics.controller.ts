import { Controller, Get, Post, Body, Param, Query, ForbiddenException, Req, Inject, UseGuards } from '@nestjs/common';
import { errorRegistry } from '../../core/observability/error-registry';
import { DiagnosticsService } from './diagnostics.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { AdminGuard, isAdminSignIn, type AdminRequestLike } from '../../core/auth/admin.guard';
import { Request } from 'express';

// AuthGuard + AdminGuard at the controller level enforce D-291 (SUPER_ADMIN
// role AND separate admin sign-in kind) and keep these handlers visible to the
// public-surface ledger; the inline assertSuperAdmin enforces the same check
// for direct calls. Keep UseGuards BELOW the Controller decorator —
// public-surface.spec.ts only reads guards that sit between the two — and keep
// decorator-call syntax out of comments, which that parser cannot tell from code.
@Controller('api/diagnostics')
@UseGuards(AuthGuard, AdminGuard)
export class DiagnosticsController {
  constructor(@Inject(DiagnosticsService) private readonly diagnosticsService: DiagnosticsService) {}

  private assertSuperAdmin(req: Request) {
    const r = req as unknown as AdminRequestLike;
    if (!r.user || r.user.role !== 'SUPER_ADMIN' || !isAdminSignIn(r)) {
      throw new ForbiddenException('Super admin access required');
    }
  }

  @Post('run')
  runFull(@Req() req: Request) {
    this.assertSuperAdmin(req);
    return this.diagnosticsService.runFullDiagnostics();
  }

  @Get('infrastructure')
  infrastructure(@Req() req: Request) {
    this.assertSuperAdmin(req);
    return this.diagnosticsService.checkInfrastructure();
  }

  @Get('modules')
  modules(@Req() req: Request) {
    this.assertSuperAdmin(req);
    return this.diagnosticsService.checkModules();
  }

  @Get('integrations')
  integrations(@Req() req: Request) {
    this.assertSuperAdmin(req);
    return this.diagnosticsService.checkIntegrations();
  }

  @Get('cross-module')
  crossModule(@Req() req: Request) {
    this.assertSuperAdmin(req);
    return this.diagnosticsService.checkCrossModuleFlows();
  }

  // What has actually been failing, from the two places errors funnel
  // through: GlobalHttpExceptionFilter (500s only) and runGuarded (every
  // background tick). Super-admin only, like the rest of this controller —
  // the entries carry route names and error text.
  @Get('errors')
  errors(@Req() req: Request, @Query('limit') limit?: string) {
    this.assertSuperAdmin(req);
    const parsed = Number.parseInt(limit ?? '', 10);
    // NaN from a junk ?limit must not become take:NaN — clamp to a sane range.
    const n = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 50;
    return errorRegistry.snapshot(n);
  }

  @Get('env-vars')
  envVars(@Req() req: Request) {
    this.assertSuperAdmin(req);
    return this.diagnosticsService.checkEnvVars();
  }

  @Post('check/:name')
  async runSingleCheck(@Req() req: Request, @Param('name') name: string) {
    this.assertSuperAdmin(req);
    const decoded = decodeURIComponent(name);
    const result = await this.diagnosticsService.runSingleCheck(decoded);
    if (!result) {
      return {
        name: decoded,
        status: 'warn',
        latencyMs: 0,
        checkedAt: new Date().toISOString(),
        message: `No check registered for "${decoded}"`,
      };
    }
    return result;
  }
}
