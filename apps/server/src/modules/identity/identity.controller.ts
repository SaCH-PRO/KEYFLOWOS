import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { IdentityService } from './identity.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CreateBusinessDto } from './dto/create-business.dto';
import { BootstrapDto } from './dto/bootstrap.dto';
import { InviteMemberDto } from './dto/invite-member.dto';

@Controller('identity')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @UseGuards(AuthGuard)
  @Get('businesses')
  listBusinesses(@Req() req: Request) {
    const user = (req as any).user as { id?: string } | undefined;
    return this.identity.listBusinesses(user?.id);
  }

  @UseGuards(AuthGuard)
  @Post('businesses')
  createBusiness(@Body() body: CreateBusinessDto, @Req() req: Request) {
    const user = (req as any).user as { id?: string } | undefined;
    return this.identity.createBusiness({
      name: body.name,
      ownerId: body.ownerId ?? user?.id,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/team')
  listTeam(@Param('businessId') businessId: string) {
    return this.identity.listTeam(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/team/invite')
  inviteMember(@Param('businessId') businessId: string, @Body() body: InviteMemberDto, @Req() req: Request) {
    const role = (req as any).business?.role;
    if (role !== 'OWNER') {
      throw new ForbiddenException('Only business owners can invite team members');
    }
    return this.identity.inviteMember({
      businessId,
      email: body.email,
      role: body.role,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/team/:membershipId')
  deleteMembership(@Param('membershipId') membershipId: string, @Req() req: Request) {
    const role = (req as any).business?.role;
    if (role !== 'OWNER') {
      throw new ForbiddenException('Only business owners can remove team members');
    }
    return this.identity.deleteMembership({ membershipId });
  }

  @UseGuards(AuthGuard)
  @Post('bootstrap')
  async bootstrap(@Body() body: BootstrapDto, @Req() req: Request) {
    const identity = this.identity ?? new IdentityService(new PrismaService());
    const user = (req as any).user as { id?: string; email?: string } | undefined;
    if (!user?.id || !user?.email) {
      throw new UnauthorizedException('Missing authenticated user');
    }

    return identity.bootstrapUser({
      userId: user.id,
      email: body.email ?? user.email,
      username: body.username,
      name: body.name,
    });
  }
}
