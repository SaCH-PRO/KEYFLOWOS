import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { FeatureFlagsService } from './feature-flags.service';
import { AuthGuard } from '../../core/auth/auth.guard';

@Controller('api/feature-flags')
export class FeatureFlagsController {
  constructor(@Inject(FeatureFlagsService) private readonly service: FeatureFlagsService) {}

  /**
   * Resolved view used by the regular workspace UI. Returns the public
   * fields plus a `bypass` flag computed from the caller's email so the
   * client never has to know who is on the bypass list.
   */
  @Get()
  @UseGuards(AuthGuard)
  async listForUser(@Req() req: Request) {
    const user = (req as { user?: { email?: string | null } }).user;
    const flags = await this.service.resolveForUser(user?.email ?? null);
    return { flags };
  }
}

@Controller('api/admin/feature-flags')
@UseGuards(AuthGuard)
export class AdminFeatureFlagsController {
  constructor(@Inject(FeatureFlagsService) private readonly service: FeatureFlagsService) {}

  private assertSuperAdmin(req: Request) {
    const user = (req as { user?: { role?: string } }).user;
    if (!user || user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Super admin access required');
    }
  }

  @Get()
  async listAll(@Req() req: Request) {
    this.assertSuperAdmin(req);
    const flags = await this.service.listAll();
    return { flags };
  }

  @Put(':key')
  async update(
    @Req() req: Request,
    @Param('key') key: string,
    @Body()
    body: {
      comingSoon?: boolean;
      bypassEmails?: string[];
      label?: string;
      category?: string | null;
    },
  ) {
    this.assertSuperAdmin(req);
    const flag = await this.service.update(decodeURIComponent(key), body ?? {});
    return { flag };
  }
}
