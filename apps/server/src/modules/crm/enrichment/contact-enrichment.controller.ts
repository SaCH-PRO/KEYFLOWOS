import { Controller, Post, Param, Body, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { BusinessGuard } from '../../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../../core/auth/module-scope.guard';
import { CrmRateLimitGuard, CrmRateLimit } from '../guards/rate-limit.guard';
import { ContactEnrichmentService } from './contact-enrichment.service';

/**
 * Manual "enrich this contact" action. Sits under the same `crm` prefix and the
 * same guard stack as the rest of the contact routes, so tenancy, auth and
 * module-scope are enforced identically. Auto-enrichment on contact create is a
 * deliberate follow-up (gate it behind a GrowthBook flag) — a manual action
 * first keeps paid lookups intentional.
 */
@Controller('crm')
@UseGuards(CrmRateLimitGuard)
export class ContactEnrichmentController {
  constructor(private readonly enrichment: ContactEnrichmentService) {}

  // Each call can trigger a PAID Apollo lookup (especially with force:true, which
  // skips the 7-day guard), so this is capped well below the general API limit —
  // a retry loop can't burn provider quota.
  @CrmRateLimit(20, 60_000)
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @Post('businesses/:businessId/contacts/:contactId/enrich')
  enrich(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: { force?: boolean } | undefined,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.enrichment.enrichContact({
      businessId,
      contactId,
      actorUserId: req?.user?.id,
      force: body?.force,
    });
  }
}
