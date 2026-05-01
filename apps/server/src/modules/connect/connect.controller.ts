import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { GoogleFormsService } from './google-forms.service';
import { GoogleContactsSyncService } from './google-contacts-sync.service';
import { GoogleBusinessProfileService } from './google-business-profile.service';
import { GoogleMapsService } from './google-maps.service';

@Controller('connect')
@UseGuards(AuthGuard, BusinessGuard)
export class ConnectController {
  constructor(
    @Inject(GoogleFormsService) private readonly forms: GoogleFormsService,
    @Inject(GoogleContactsSyncService) private readonly contacts: GoogleContactsSyncService,
    @Inject(GoogleBusinessProfileService) private readonly bp: GoogleBusinessProfileService,
    @Inject(GoogleMapsService) private readonly maps: GoogleMapsService,
  ) {}

  // ----- Forms -----
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

  // ----- Contacts -----
  @Post('businesses/:businessId/contacts/sync')
  syncContacts(@Param('businessId') businessId: string) {
    return this.contacts.sync(businessId);
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

  // ----- Maps -----
  @Post('businesses/:businessId/maps/api-key')
  setMapsApiKey(
    @Param('businessId') businessId: string,
    @Body() body: { apiKey: string },
  ) {
    if (!body.apiKey?.trim()) throw new BadRequestException('apiKey is required');
    return this.maps.setApiKey(businessId, body.apiKey).then(() => ({ success: true }));
  }

  @Delete('businesses/:businessId/maps/api-key')
  clearMapsApiKey(@Param('businessId') businessId: string) {
    return this.maps.clearApiKey(businessId).then(() => ({ success: true }));
  }

  @Get('businesses/:businessId/maps/autocomplete')
  mapsAutocomplete(
    @Param('businessId') businessId: string,
    @Query('input') input: string,
    @Query('sessiontoken') sessionToken?: string,
    @Query('types') types?: string,
    @Query('components') components?: string,
  ) {
    return this.maps.autocomplete(businessId, input ?? '', { sessionToken, types, components });
  }

  @Get('businesses/:businessId/maps/place/:placeId')
  mapsPlaceDetails(
    @Param('businessId') businessId: string,
    @Param('placeId') placeId: string,
    @Query('sessiontoken') sessionToken?: string,
  ) {
    return this.maps.placeDetails(businessId, placeId, sessionToken);
  }
}
