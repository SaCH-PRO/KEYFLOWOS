import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CrmService } from './crm.service';
import { AuthGuard } from '../../core/auth/auth.guard';

@Controller('crm')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @UseGuards(AuthGuard)
  @Get('businesses/:businessId/contacts')
  listContacts(@Param('businessId') businessId: string) {
    return this.crm.listContacts(businessId);
  }

  @UseGuards(AuthGuard)
  @Post('businesses/:businessId/contacts')
  createContact(
    @Param('businessId') businessId: string,
    @Body()
    body: {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
    },
  ) {
    return this.crm.createContact({ businessId, ...body });
  }
}
