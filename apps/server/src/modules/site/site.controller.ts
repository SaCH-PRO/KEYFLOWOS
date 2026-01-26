import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { SiteService } from './site.service';

@Controller('site')
export class SiteController {
  constructor(private readonly site: SiteService) {}

  @Get('health')
  health() {
    return { status: 'ok', module: 'site' };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId')
  getSite(@Param('businessId') businessId: string) {
    return this.site.getByBusiness(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId')
  upsertSite(
    @Param('businessId') businessId: string,
    @Body() body: { subdomain: string; siteData?: any },
  ) {
    return this.site.upsertSite({
      businessId,
      subdomain: body.subdomain,
      siteData: body.siteData ?? {},
    });
  }

  @Get('subdomain/:subdomain')
  getBySubdomain(@Param('subdomain') subdomain: string) {
    return this.site.getBySubdomain(subdomain);
  }
}
