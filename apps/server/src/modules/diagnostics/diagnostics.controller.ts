import { Controller, Get, Post, Body, Param, ForbiddenException, Req, Inject } from '@nestjs/common';
import { DiagnosticsService } from './diagnostics.service';
import { Request } from 'express';

@Controller('api/diagnostics')
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
