import { Controller, Get, Post, Body, Param, ForbiddenException, Req, Inject, UseGuards } from '@nestjs/common';
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
