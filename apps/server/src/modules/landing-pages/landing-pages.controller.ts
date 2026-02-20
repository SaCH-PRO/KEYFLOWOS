import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { LandingPagesService } from './landing-pages.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

@Controller()
export class LandingPagesController {
  constructor(
    @Inject(LandingPagesService) private readonly landingPages: LandingPagesService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/landing-pages')
  listPages(@Param('businessId') businessId: string) {
    return this.landingPages.listPages(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/landing-pages/:id')
  getPage(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.landingPages.getPage(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/landing-pages')
  createPage(
    @Param('businessId') businessId: string,
    @Body() body: {
      title: string;
      slug: string;
      template?: string;
      sections: any;
      settings?: any;
    },
  ) {
    return this.landingPages.createPage({ businessId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/landing-pages/:id')
  updatePage(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: {
      title?: string;
      slug?: string;
      template?: string;
      sections?: any;
      settings?: any;
    },
  ) {
    return this.landingPages.updatePage({ businessId, id, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/landing-pages/:id')
  deletePage(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.landingPages.deletePage(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/landing-pages/:id/toggle-publish')
  togglePublish(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.landingPages.togglePublish(businessId, id);
  }

  @Get('public/businesses/:businessId/pages/:slug')
  getPublicPage(
    @Param('businessId') businessId: string,
    @Param('slug') slug: string,
  ) {
    return this.landingPages.getPublicPage(businessId, slug);
  }
}
