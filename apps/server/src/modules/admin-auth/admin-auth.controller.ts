import { Controller, Post, Get, Body, UnauthorizedException, Inject } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import { CurrentUser } from '../../core/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../core/decorators/current-user.decorator';

class AdminLoginDto {
  email!: string;
  password!: string;
}

@Controller('api/admin/auth')
export class AdminAuthController {
  constructor(@Inject(AdminAuthService) private readonly adminAuth: AdminAuthService) {}

  @Post('login')
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
