import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { CrmRateLimitGuard, CrmRateLimit } from './guards/rate-limit.guard';
import { CrmAccountsService } from './crm-accounts.service';
import { ApplyAccountMergeDto, CreateAccountDto, UpdateAccountDto } from './dto/account.dto';

@Controller('crm')
@UseGuards(CrmRateLimitGuard)
export class CrmAccountsController {
  constructor(@Inject(CrmAccountsService) private readonly accounts: CrmAccountsService) {}

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/accounts')
  list(
    @Param('businessId') businessId: string,
    @Query('search') search?: string,
    @Query('industry') industry?: string,
    @Query('ownerUserId') ownerUserId?: string,
    @Query('tags') tags?: string,
    @Query('minDealValue') minDealValue?: string,
    @Query('lastActivityWithinDays') lastActivityWithinDays?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.accounts.listAccounts({
      businessId,
      search: search || undefined,
      industry: industry || undefined,
      ownerUserId: ownerUserId || undefined,
      tags: tags ? tags.split(',').filter(Boolean) : undefined,
      minDealValue: minDealValue ? Number(minDealValue) : undefined,
      lastActivityWithinDays: lastActivityWithinDays ? Number(lastActivityWithinDays) : undefined,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/accounts/:accountId')
  detail(@Param('businessId') businessId: string, @Param('accountId') accountId: string) {
    return this.accounts.getAccountDetail({ businessId, accountId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(60, 60_000)
  @Get('businesses/:businessId/accounts/:accountId/insight')
  insight(@Param('businessId') businessId: string, @Param('accountId') accountId: string) {
    return this.accounts.getAccountInsight(businessId, accountId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/accounts')
  create(@Param('businessId') businessId: string, @Body() body: CreateAccountDto) {
    return this.accounts.createAccount({ businessId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Patch('businesses/:businessId/accounts/:accountId')
  update(
    @Param('businessId') businessId: string,
    @Param('accountId') accountId: string,
    @Body() body: UpdateAccountDto,
  ) {
    return this.accounts.updateAccount({ businessId, accountId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Delete('businesses/:businessId/accounts/:accountId')
  remove(@Param('businessId') businessId: string, @Param('accountId') accountId: string) {
    return this.accounts.deleteAccount({ businessId, accountId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(60, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/account-suggestion')
  suggestForContact(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.accounts.suggestForContact(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(30, 60_000)
  @Get('businesses/:businessId/accounts-merge/preview')
  mergePreview(@Param('businessId') businessId: string) {
    return this.accounts.previewMerge(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/accounts-merge/apply')
  mergeApply(@Param('businessId') businessId: string, @Body() body: ApplyAccountMergeDto) {
    return this.accounts.applyMerge({ businessId, items: body.items });
  }

  // ---- Pivot helpers used by dashboard / lifecycle reports ----

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(60, 60_000)
  @Get('businesses/:businessId/deals/pivot/by-account')
  dealsByAccount(@Param('businessId') businessId: string) {
    return this.accounts.dealsByAccount(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(60, 60_000)
  @Get('businesses/:businessId/lifecycle/pivot/by-account')
  lifecycleByAccount(@Param('businessId') businessId: string) {
    return this.accounts.lifecycleByAccount(businessId);
  }
}
