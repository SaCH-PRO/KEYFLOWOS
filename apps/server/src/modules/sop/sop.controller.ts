import { Controller, Get, Post, Patch, Delete, Inject, Param, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { SopService } from './sop.service';

@Controller('sop/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class SopController {
  constructor(@Inject(SopService) private readonly sop: SopService) {}

  @Get('sops')
  async list(@Param('businessId') businessId: string) {
    return this.sop.list(businessId);
  }

  @Post('sops')
  async create(@Param('businessId') businessId: string, @Body() body: { title: string; department?: string; body: string }) {
    return this.sop.create(businessId, body);
  }

  @Get('sops/:id')
  async get(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.sop.get(businessId, id);
  }

  @Patch('sops/:id')
  async update(@Param('businessId') businessId: string, @Param('id') id: string, @Body() body: Partial<{ title: string; department: string; body: string; status: string }>) {
    return this.sop.update(businessId, id, body);
  }

  @Delete('sops/:id')
  async delete(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.sop.delete(businessId, id);
  }
}
