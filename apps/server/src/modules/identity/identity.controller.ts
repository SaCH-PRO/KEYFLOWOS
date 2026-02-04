import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { IdentityService } from './identity.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { CreateBusinessDto } from './dto/create-business.dto';
import { BootstrapDto } from './dto/bootstrap.dto';

@Controller('identity')
export class IdentityController {
  constructor(@Inject(IdentityService) private readonly identity: IdentityService) {}

  @UseGuards(AuthGuard)
  @Get('businesses')
  listBusinesses(@Req() req: Request) {
    const user = (req as any).user as { id?: string } | undefined;
    return this.identity.listBusinesses(user?.id);
  }

  @UseGuards(AuthGuard)
  @Get('businesses/:businessId')
  getBusiness(@Param('businessId') businessId: string) {
    return this.identity.getBusiness(businessId);
  }

  @Get('businesses/slug/:slug')
  getBusinessBySlug(@Param('slug') slug: string) {
    return this.identity.getBusinessBySlug(slug);
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

  @UseGuards(AuthGuard)
  @Patch('businesses/:businessId')
  updateBusiness(
    @Param('businessId') businessId: string,
    @Body() body: {
      name?: string;
      slug?: string;
      timezone?: string;
      currency?: string;
      logo?: string;
      address?: string;
      phone?: string;
      email?: string;
      website?: string;
      facebookHandle?: string;
      instagramHandle?: string;
      twitterHandle?: string;
      linkedinHandle?: string;
      tiktokHandle?: string;
      youtubeHandle?: string;
      whatsappNumber?: string;
      primaryColor?: string;
      secondaryColor?: string;
      defaultTaxRate?: number;
    },
  ) {
    return this.identity.updateBusiness(businessId, body);
  }

  @UseGuards(AuthGuard)
  @Get('businesses/:businessId/team')
  listTeamMembers(@Param('businessId') businessId: string) {
    return this.identity.listTeamMembers(businessId);
  }

  @UseGuards(AuthGuard)
  @Post('businesses/:businessId/team')
  inviteTeamMember(
    @Param('businessId') businessId: string,
    @Body() body: { email: string; role: string },
    @Req() req: Request,
  ) {
    const user = (req as any).user as { id?: string } | undefined;
    return this.identity.inviteTeamMember(businessId, body.email, body.role, user?.id ?? '');
  }

  @UseGuards(AuthGuard)
  @Patch('businesses/:businessId/team/:membershipId')
  updateMemberRole(
    @Param('businessId') businessId: string,
    @Param('membershipId') membershipId: string,
    @Body() body: { role: string },
  ) {
    return this.identity.updateMemberRole(businessId, membershipId, body.role);
  }

  @UseGuards(AuthGuard)
  @Delete('businesses/:businessId/team/:membershipId')
  removeTeamMember(
    @Param('businessId') businessId: string,
    @Param('membershipId') membershipId: string,
    @Req() req: Request,
  ) {
    const user = (req as any).user as { id?: string } | undefined;
    return this.identity.removeTeamMember(businessId, membershipId, user?.id ?? '');
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
