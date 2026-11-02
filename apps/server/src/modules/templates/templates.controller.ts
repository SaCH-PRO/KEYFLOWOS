import { Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CurrentUser, type AuthenticatedUser } from '../../core/decorators/current-user.decorator';

@Controller()
export class TemplatesController {
  constructor(
    @Inject(TemplatesService) private readonly templates: TemplatesService,
  ) {}

  @Get('templates')
  listTemplates() {
    return this.templates.listTemplates();
  }

  @Get('templates/:id')
  getTemplate(@Param('id') id: string) {
    return this.templates.getTemplate(id);
  }

  /**
   * R0-09d (owner ruling D-11, R0-09b review SEC-1): applying a template writes
   * Business.industry and archetype and records the business's setup template,
   * so it is OWNER only; the check runs before the template is read.
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/templates/:templateId/apply')
  async applyTemplate(
    @Param('businessId') businessId: string,
    @Param('templateId') templateId: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    await this.templates.assertProfileOwner(businessId, user);
    return this.templates.applyTemplate(businessId, templateId);
  }
}
