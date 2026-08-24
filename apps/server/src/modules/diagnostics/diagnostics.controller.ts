import { Controller, Get, Post, Body, Param, Query, ForbiddenException, Req, Inject, UseGuards } from '@nestjs/common';
import { errorRegistry } from '../../core/observability/error-registry';
import { DiagnosticsService } from './diagnostics.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { Request } from 'express';

// AuthGuard at the controller level makes these handlers visible to the
// guard convention and the public-surface ledger; the inline assertSuperAdmin
// stays for the role check (there is no SuperAdminGuard, and inventing one is
// not this change). Behavior for callers is unchanged: anonymous 401 instead
// of 403, super admins pass as before. Keep UseGuards BELOW the Controller
// decorator — public-surface.spec.ts only reads guards that sit between the
// two — and keep decorator-call syntax out of comments, which that parser
// cannot tell from code.
@Controller('api/diagnostics')
@UseGuards(AuthGuard)
export class DiagnosticsController {
  constructor(@Inject(DiagnosticsService) private readonly diagnosticsService: DiagnosticsService) {}

  private assertSuperAdmin(req: Request) {
    const user = (req as any).user;
    if (!user || user.role !== 'SUPER_ADMIN') {
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
