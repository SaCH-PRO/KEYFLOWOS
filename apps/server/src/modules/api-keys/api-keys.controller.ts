import { Controller, Get, Post, Delete, Param, Body, Inject, UseGuards } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

@Controller('api/businesses/:businessId/api-keys')
export class ApiKeysController {
  constructor(@Inject(ApiKeysService) private readonly apiKeysService: ApiKeysService) {}

  @Get()
  @UseGuards(AuthGuard, BusinessGuard)
  async list(@Param('businessId') businessId: string) {
    const keys = await this.apiKeysService.listKeys(businessId);
    return { keys };
  }

  @Post()
  @UseGuards(AuthGuard, BusinessGuard)
  async create(
    @Param('businessId') businessId: string,
    @Body() body: { name: string; scopes: string[] },
  ) {
    return this.apiKeysService.createKey(businessId, body.name, body.scopes ?? []);
  }

  @Delete(':keyId')
  @UseGuards(AuthGuard, BusinessGuard)
  async revoke(
    @Param('businessId') businessId: string,
    @Param('keyId') keyId: string,
  ) {
    await this.apiKeysService.revokeKey(businessId, keyId);
    return { success: true };
  }
}
