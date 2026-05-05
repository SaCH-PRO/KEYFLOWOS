import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { GoogleFormsService } from './google-forms.service';
import {
  GoogleFormsMappingService,
  FieldMappingEntry,
  OpportunityDefaults,
} from './google-forms-mapping.service';
import {
  GoogleContactsSyncService,
  ContactMappingRules,
} from './google-contacts-sync.service';
import {
  OutlookContactsSyncService,
  OutlookContactMappingRules,
} from './outlook-contacts-sync.service';
import { ContactSyncService } from './contact-sync.service';
import { SignatureParserService } from './signature-parser.service';
import { GoogleBusinessProfileService } from './google-business-profile.service';
import {
  ConnectorFormMappingService,
  isSupportedSource,
  ConnectorFormSource,
} from './connector-form-mapping.service';

function ensureSource(s: string): ConnectorFormSource {
  if (!isSupportedSource(s)) {
    throw new BadRequestException(`Unsupported form source "${s}"`);
  }
  return s;
}

@Controller('connect')
@UseGuards(AuthGuard, BusinessGuard)
export class ConnectController {
  constructor(
    @Inject(GoogleFormsService) private readonly forms: GoogleFormsService,
    @Inject(GoogleFormsMappingService) private readonly formsMapping: GoogleFormsMappingService,
    @Inject(GoogleContactsSyncService) private readonly contacts: GoogleContactsSyncService,
    @Inject(OutlookContactsSyncService) private readonly outlook: OutlookContactsSyncService,
    @Inject(ContactSyncService) private readonly contactSync: ContactSyncService,
    @Inject(SignatureParserService) private readonly signatures: SignatureParserService,
    @Inject(GoogleBusinessProfileService) private readonly bp: GoogleBusinessProfileService,
    @Inject(ConnectorFormMappingService)
    private readonly connectorForms: ConnectorFormMappingService,
  ) {}

  // ----- Google Forms -----
  @Get('businesses/:businessId/forms')
  listForms(
    @Param('businessId') businessId: string,
    @Query('pageToken') pageToken?: string,
  ) {
    return this.forms.listForms(businessId, pageToken);
  }

  @Post('businesses/:businessId/forms')
  createForm(
    @Param('businessId') businessId: string,
    @Body() body: { title: string; description?: string },
  ) {
    return this.forms.createForm(businessId, body.title, body.description);
  }

  @Get('businesses/:businessId/forms/:formId')
  getForm(@Param('businessId') businessId: string, @Param('formId') formId: string) {
    return this.forms.getForm(businessId, formId);
  }

  @Get('businesses/:businessId/forms/:formId/responses')
  listFormResponses(
    @Param('businessId') businessId: string,
    @Param('formId') formId: string,
    @Query('pageToken') pageToken?: string,
  ) {
    return this.forms.listResponses(businessId, formId, pageToken);
  }

  @Delete('businesses/:businessId/forms/:formId')
  deleteForm(@Param('businessId') businessId: string, @Param('formId') formId: string) {
    return this.forms.deleteForm(businessId, formId);
  }

  // ----- Google Form → CRM Mapping -----
  @Get('businesses/:businessId/forms/:formId/mapping')
  getFormMapping(
    @Param('businessId') businessId: string,
    @Param('formId') formId: string,
  ) {
    return this.formsMapping.getMapping(businessId, formId);
  }

  @Post('businesses/:businessId/forms/:formId/mapping')
  saveFormMapping(
    @Param('businessId') businessId: string,
    @Param('formId') formId: string,
    @Body()
    body: {
      formTitle?: string;
      fieldMappings: FieldMappingEntry[];
      opportunityDefaults?: OpportunityDefaults | null;
      autoCreate?: boolean;
    },
  ) {
    if (!Array.isArray(body?.fieldMappings)) {
      throw new BadRequestException('fieldMappings array is required');
    }
    return this.formsMapping.saveMapping({
      businessId,
      formId,
      formTitle: body.formTitle,
      fieldMappings: body.fieldMappings,
      opportunityDefaults: body.opportunityDefaults ?? null,
      autoCreate: body.autoCreate,
    });
  }

  @Delete('businesses/:businessId/forms/:formId/mapping')
  deleteFormMapping(
    @Param('businessId') businessId: string,
    @Param('formId') formId: string,
  ) {
    return this.formsMapping.deleteMapping(businessId, formId);
  }

  @Post('businesses/:businessId/forms/:formId/backfill')
  backfillFormResponses(
    @Param('businessId') businessId: string,
    @Param('formId') formId: string,
  ) {
    return this.formsMapping.backfill(businessId, formId);
  }

  @Post('businesses/:businessId/forms/:formId/process-new')
  processNewFormResponses(
    @Param('businessId') businessId: string,
    @Param('formId') formId: string,
  ) {
    return this.formsMapping.processNewResponses(businessId, formId);
  }

  // ----- Connector Forms (Typeform / Jotform / Webhook) -----
  @Get('businesses/:businessId/connector-forms/:source')
  listConnectorForms(
    @Param('businessId') businessId: string,
    @Param('source') source: string,
  ) {
    return this.connectorForms.listForms(businessId, ensureSource(source));
  }

  @Get('businesses/:businessId/connector-forms/:source/:leadFormId/submissions')
  listConnectorSubmissions(
    @Param('businessId') businessId: string,
    @Param('source') source: string,
    @Param('leadFormId') leadFormId: string,
    @Query('limit') limit?: string,
  ) {
    return this.connectorForms.listSubmissions(
      businessId,
      ensureSource(source),
      leadFormId,
      limit ? Number(limit) : undefined,
    );
  }

  @Get('businesses/:businessId/connector-forms/:source/:externalFormId/mapping')
  getConnectorFormMapping(
    @Param('businessId') businessId: string,
    @Param('source') source: string,
    @Param('externalFormId') externalFormId: string,
  ) {
    return this.connectorForms.getMapping(businessId, ensureSource(source), externalFormId);
  }

  @Post('businesses/:businessId/connector-forms/:source/:externalFormId/mapping')
  saveConnectorFormMapping(
    @Param('businessId') businessId: string,
    @Param('source') source: string,
    @Param('externalFormId') externalFormId: string,
    @Body()
    body: {
      formTitle?: string;
      fieldMappings: FieldMappingEntry[];
      defaultTags?: string[];
      defaultStatus?: string | null;
      autoCreate?: boolean;
    },
  ) {
    return this.connectorForms.saveMapping(businessId, ensureSource(source), externalFormId, body);
  }

  @Delete('businesses/:businessId/connector-forms/:source/:externalFormId/mapping')
  deleteConnectorFormMapping(
    @Param('businessId') businessId: string,
    @Param('source') source: string,
    @Param('externalFormId') externalFormId: string,
  ) {
    return this.connectorForms.deleteMapping(businessId, ensureSource(source), externalFormId);
  }

  @Post('businesses/:businessId/connector-forms/:source/:leadFormId/backfill')
  backfillConnectorForm(
    @Param('businessId') businessId: string,
    @Param('source') source: string,
    @Param('leadFormId') leadFormId: string,
  ) {
    return this.connectorForms.backfill(businessId, ensureSource(source), leadFormId);
  }

  // ----- Contacts -----
  @Post('businesses/:businessId/contacts/sync')
  syncContacts(@Param('businessId') businessId: string) {
    return this.contacts.sync(businessId);
  }

  @Get('businesses/:businessId/contacts/status')
  getContactsStatus(@Param('businessId') businessId: string) {
    return this.contacts.getStatus(businessId);
  }

  @Get('businesses/:businessId/contacts/recent')
  getContactsRecent(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
  ) {
    return this.contacts.getRecent(businessId, limit ? Number(limit) : undefined);
  }

  @Get('businesses/:businessId/contacts/mapping-rules')
  getContactsRules(@Param('businessId') businessId: string) {
    return this.contacts.getMappingRules(businessId);
  }

  @Put('businesses/:businessId/contacts/mapping-rules')
  saveContactsRules(
    @Param('businessId') businessId: string,
    @Body() body: Partial<ContactMappingRules>,
  ) {
    return this.contacts.saveMappingRules(businessId, body ?? {});
  }

  // ----- Outlook Contacts -----
  @Post('businesses/:businessId/outlook-contacts/sync')
  syncOutlookContacts(@Param('businessId') businessId: string) {
    return this.outlook.sync(businessId);
  }

  @Get('businesses/:businessId/outlook-contacts/status')
  getOutlookStatus(@Param('businessId') businessId: string) {
    return this.outlook.getStatus(businessId);
  }

  @Get('businesses/:businessId/outlook-contacts/recent')
  getOutlookRecent(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
  ) {
    return this.outlook.getRecent(businessId, limit ? Number(limit) : undefined);
  }

  @Get('businesses/:businessId/outlook-contacts/mapping-rules')
  getOutlookRules(@Param('businessId') businessId: string) {
    return this.outlook.getMappingRules(businessId);
  }

  @Put('businesses/:businessId/outlook-contacts/mapping-rules')
  saveOutlookRules(
    @Param('businessId') businessId: string,
    @Body() body: Partial<OutlookContactMappingRules>,
  ) {
    return this.outlook.saveMappingRules(businessId, body ?? {});
  }

  // ----- Cross-Source Contact Sync -----
  @Get('businesses/:businessId/contact-sources/summary')
  getContactSourcesSummary(@Param('businessId') businessId: string) {
    return this.contactSync.getSummary(businessId);
  }

  @Post('businesses/:businessId/contact-sources/sync-all')
  syncAllSources(@Param('businessId') businessId: string) {
    return this.contactSync.syncAll(businessId);
  }

  @Get('businesses/:businessId/contact-sources/audit')
  getContactSourcesAudit(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
  ) {
    return this.contactSync.listAudit(businessId, limit ? Number(limit) : undefined);
  }

  @Put('businesses/:businessId/contact-sources/signature-parsing')
  setSignatureParsing(
    @Param('businessId') businessId: string,
    @Body() body: { enabled: boolean },
  ) {
    return this.contactSync.setSignatureParsingEnabled(businessId, !!body?.enabled);
  }

  @Post('businesses/:businessId/contact-sources/:source/resync')
  resyncSource(
    @Param('businessId') businessId: string,
    @Param('source') source: string,
  ) {
    if (source === 'google_contacts') return this.contacts.sync(businessId);
    if (source === 'outlook_contacts') return this.outlook.sync(businessId);
    throw new BadRequestException(`Unknown source "${source}"`);
  }

  @Delete('businesses/:businessId/contact-sources/:source')
  disconnectSource(
    @Param('businessId') businessId: string,
    @Param('source') source: string,
  ) {
    if (source === 'google_contacts') return this.contacts.disconnect(businessId);
    if (source === 'outlook_contacts') return this.outlook.disconnect(businessId);
    throw new BadRequestException(`Unknown source "${source}"`);
  }

  @Post('businesses/:businessId/contact-sources/parse-signature')
  parseSignature(
    @Param('businessId') businessId: string,
    @Body() body: { emailBody: string },
  ) {
    if (!body?.emailBody) throw new BadRequestException('emailBody required');
    return this.signatures.parseAndApply(businessId, body.emailBody);
  }

  // ----- Business Profile -----
  @Get('businesses/:businessId/business-profile/accounts')
  listBpAccounts(@Param('businessId') businessId: string) {
    return this.bp.listAccounts(businessId);
  }

  @Get('businesses/:businessId/business-profile/locations')
  listBpLocations(
    @Param('businessId') businessId: string,
    @Query('accountId') accountId?: string,
  ) {
    return this.bp.listLocations(businessId, accountId);
  }

  @Post('businesses/:businessId/business-profile/active-location')
  setBpActiveLocation(
    @Param('businessId') businessId: string,
    @Body() body: { accountId: string; locationId: string },
  ) {
    return this.bp.setActiveLocation(businessId, body.accountId, body.locationId);
  }

  @Get('businesses/:businessId/business-profile/reviews')
  listBpReviews(
    @Param('businessId') businessId: string,
    @Query('location') locationName: string,
  ) {
    if (!locationName) throw new BadRequestException('location query param required');
    return this.bp.listReviews(businessId, locationName);
  }

  @Get('businesses/:businessId/business-profile/posts')
  listBpPosts(
    @Param('businessId') businessId: string,
    @Query('location') locationName: string,
  ) {
    if (!locationName) throw new BadRequestException('location query param required');
    return this.bp.listPosts(businessId, locationName);
  }

  @Post('businesses/:businessId/business-profile/posts')
  createBpPost(
    @Param('businessId') businessId: string,
    @Body()
    body: {
      location: string;
      summary: string;
      callToAction?: { actionType: string; url: string };
    },
  ) {
    if (!body.location) throw new BadRequestException('location is required');
    return this.bp.createPost(businessId, body.location, body);
  }

  @Post('businesses/:businessId/business-profile/reviews/reply')
  replyBpReview(
    @Param('businessId') businessId: string,
    @Body() body: { reviewName: string; comment: string },
  ) {
    return this.bp.replyToReview(businessId, body.reviewName, body.comment);
  }

  @Get('businesses/:businessId/business-profile/insights')
  getBpInsights(
    @Param('businessId') businessId: string,
    @Query('location') locationName: string,
    @Query('days') days?: string,
  ) {
    if (!locationName) throw new BadRequestException('location query param required');
    return this.bp.getInsights(businessId, locationName, days ? Number(days) : undefined);
  }

  @Get('businesses/:businessId/business-profile/scheduled-posts')
  listBpScheduled(@Param('businessId') businessId: string) {
    return this.bp.listScheduledPosts(businessId);
  }

  @Post('businesses/:businessId/business-profile/scheduled-posts')
  scheduleBpPost(
    @Param('businessId') businessId: string,
    @Body()
    body: {
      location: string;
      summary: string;
      callToAction?: { actionType: string; url: string };
      scheduledFor: string;
    },
  ) {
    return this.bp.schedulePost(businessId, body);
  }

  @Delete('businesses/:businessId/business-profile/scheduled-posts/:id')
  cancelBpScheduled(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.bp.cancelScheduledPost(businessId, id);
  }
}
