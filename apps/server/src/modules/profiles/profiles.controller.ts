import { Body, Controller, Get, Inject, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../core/decorators/current-user.decorator';
import { ProfilesService } from './profiles.service';

@Controller('profiles')
@UseGuards(AuthGuard)
export class ProfilesController {
  constructor(@Inject(ProfilesService) private readonly profiles: ProfilesService) {}

  @Get('me')
  getMyProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.profiles.getMyProfile(user.id);
  }

  @Put('me')
  upsertMyProfile(@CurrentUser() user: AuthenticatedUser, @Body() body: { displayName?: string }) {
    return this.profiles.upsertMyProfile(user.id, user.email ?? '', body.displayName ?? '');
  }
}
