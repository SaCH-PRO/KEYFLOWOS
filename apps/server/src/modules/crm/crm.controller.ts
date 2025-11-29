import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CrmService } from './crm.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CreateContactDto } from './dto/create-contact.dto';

@Controller('crm')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/contacts')
  listContacts(@Param('businessId') businessId: string) {
    return this.crm.listContacts(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/contacts')
  createContact(
    @Param('businessId') businessId: string,
    @Body() body: CreateContactDto,
  ) {
    return this.crm.createContact({ businessId, ...body });
  }
}
