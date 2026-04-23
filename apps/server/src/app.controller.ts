import { Controller, Get, Inject, Req } from '@nestjs/common';
import { AppService } from './app.service';
import { SupabaseAuthService } from './core/auth/supabase-auth.service';
import { Request } from 'express';
import { CurrentUser, AuthenticatedUser } from './core/decorators/current-user.decorator';

@Controller()
export class AppController {
  constructor(
    @Inject(AppService) private readonly appService: AppService,
    @Inject(SupabaseAuthService) private readonly auth: SupabaseAuthService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('auth-debug')
  async authDebug(@Req() req: Request) {
    const summary = await this.auth.inspectAuthEnv();
    const header = req.headers.authorization;
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.replace('Bearer ', '').trim()
        : undefined;

    if (!token) {
      return {
        ok: false,
        reason: 'no-bearer-token',
        env: summary,
      };
    }

    const inspection = await this.auth.inspectToken(token);
    const user = await this.auth.getUserFromToken(token);

    if (!user?.id) {
      return {
        ok: false,
        reason: 'token-not-resolved',
        env: summary,
        inspection,
      };
    }

    return {
      ok: true,
      reason: 'authenticated',
      env: summary,
      inspection,
      user: {
        id: user.id,
        email: user.email ?? null,
      },
    };
  }

  @Get('auth/whoami')
  whoAmI(@CurrentUser() user: AuthenticatedUser | undefined) {
    return {
      authenticated: !!user?.id,
      userId: user?.id ?? null,
      email: user?.email ?? null,
      role: user?.role ?? null,
    };
  }
}