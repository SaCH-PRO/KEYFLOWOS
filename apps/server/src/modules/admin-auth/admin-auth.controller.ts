import { Controller, Post, Get, Body, UnauthorizedException, Inject, UseGuards } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import { CurrentUser } from '../../core/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../core/decorators/current-user.decorator';
import { RateLimit } from '../../core/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../../core/guards/rate-limit.guard';

class AdminLoginDto {
  email!: string;
  password!: string;
}

@Controller('api/admin/auth')
export class AdminAuthController {
  constructor(@Inject(AdminAuthService) private readonly adminAuth: AdminAuthService) {}

  @Post('login')
  @UseGuards(RateLimitGuard)
  @RateLimit(5, 60_000)
  async login(@Body() body: AdminLoginDto) {
    const user = await this.adminAuth.validateCredentials(body.email, body.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const token = this.adminAuth.generateToken(user);

    return {
      accessToken: token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    };
  }

  @Post('logout')
  async logout(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }
    // Revoke the current token via jti if available; otherwise fall back to user-wide revocation
    await this.adminAuth.revokeAllTokens(user.id);
    return { success: true };
  }

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }
    return {
      id: user.id,
      email: user.email,
      role: user.role,
    };
  }
}
