import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CrmService } from './crm.service';

@Controller('crm')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Get('businesses/:businessId/contacts')
  listContacts(@Param('businessId') businessId: string) {
    return this.crm.listContacts(businessId);
  }

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
