import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { CustomFieldDefinitionService } from './custom-field-definition.service';
import { ContactCustomFieldValueService } from './contact-custom-field-value.service';
import { CreateCustomFieldDefinitionDto, UpdateCustomFieldDefinitionDto } from './dto/custom-field-definition.dto';
import { CrmRateLimitGuard, CrmRateLimit } from './guards/rate-limit.guard';

@Controller('crm')
@UseGuards(CrmRateLimitGuard)
export class CrmCustomFieldsController {
  constructor(
    @Inject(CustomFieldDefinitionService) private readonly definitions: CustomFieldDefinitionService,
    @Inject(ContactCustomFieldValueService) private readonly values: ContactCustomFieldValueService,
  ) {}

  // ---------------------------------------------------------------------------
  // Custom Field Definitions
  // ---------------------------------------------------------------------------

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/custom-field-definitions')
  listDefinitions(
    @Param('businessId') businessId: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.definitions.listDefinitions(businessId, { includeArchived: includeArchived === 'true' });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/custom-field-definitions/:definitionId')
  getDefinition(
    @Param('businessId') businessId: string,
    @Param('definitionId') definitionId: string,
  ) {
    return this.definitions.getDefinition(businessId, definitionId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/custom-field-definitions')
  createDefinition(
    @Param('businessId') businessId: string,
    @Body() dto: CreateCustomFieldDefinitionDto,
  ) {
    return this.definitions.createDefinition({ ...dto, businessId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Patch('businesses/:businessId/custom-field-definitions/:definitionId')
  updateDefinition(
    @Param('businessId') businessId: string,
    @Param('definitionId') definitionId: string,
    @Body() dto: UpdateCustomFieldDefinitionDto,
  ) {
    return this.definitions.updateDefinition(businessId, definitionId, {
      ...dto,
      archivedAt: dto.archivedAt === null ? null : dto.archivedAt ? new Date(dto.archivedAt) : undefined,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/custom-field-definitions/:definitionId/archive')
  archiveDefinition(
    @Param('businessId') businessId: string,
    @Param('definitionId') definitionId: string,
  ) {
    return this.definitions.archiveDefinition(businessId, definitionId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/custom-field-definitions/:definitionId/restore')
  restoreDefinition(
    @Param('businessId') businessId: string,
    @Param('definitionId') definitionId: string,
  ) {
    return this.definitions.restoreDefinition(businessId, definitionId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Delete('businesses/:businessId/custom-field-definitions/:definitionId')
  deleteDefinition(
    @Param('businessId') businessId: string,
    @Param('definitionId') definitionId: string,
  ) {
    return this.definitions.deleteDefinition(businessId, definitionId);
  }

  // ---------------------------------------------------------------------------
  // Contact Custom Field Values
  // ---------------------------------------------------------------------------

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/custom-field-values')
  getContactValues(
    @Param('contactId') contactId: string,
  ) {
    return this.values.getValuesForContact(contactId);
  }
}
