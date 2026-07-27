import {
  Controller,
  Inject,
  Logger,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../core/decorators/current-user.decorator';
import { RiscService } from './risc.service';

/**
 * Admin operations for Cross-Account Protection (RISC) data.
 *
 * These endpoints are not called by Google; they are for operators to exercise
 * GDPR data subject rights (e.g. right to erasure) for security event data.
 */
@Controller('admin/risc')
@UseGuards(AuthGuard)
export class RiscAdminController {
  private readonly logger = new Logger(RiscAdminController.name);

  constructor(@Inject(RiscService) private readonly risc: RiscService) {}

  /**
   * Erase all RISC security event records linked to a user.
   *
   * Restricted to SUPER_ADMIN. Intended for GDPR right-to-erasure requests.
   */
  @Post('users/:userId/erase')
  async eraseUserEvents(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
  ): Promise<{ erased: number }> {
    if (user?.role !== 'SUPER_ADMIN') {
      throw new UnauthorizedException('Admin access required');
    }

    const { deleted } = await this.risc.eraseForUser(userId);
    this.logger.log(`Admin ${user.id} erased ${deleted} RISC event(s) for user ${userId}`);
    return { erased: deleted };
  }
}
