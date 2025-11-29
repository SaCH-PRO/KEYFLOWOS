import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { IdentityService } from './identity.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { CreateBusinessDto } from './dto/create-business.dto';

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
}
