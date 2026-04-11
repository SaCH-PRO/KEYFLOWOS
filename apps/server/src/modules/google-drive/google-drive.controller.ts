import { Controller, Get, Post, Delete, Param, Query, Body, Res, UseGuards, Inject } from '@nestjs/common';
import { Response } from 'express';
import { GoogleDriveService } from './google-drive.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

@Controller('drive')
export class GoogleDriveController {
  constructor(
    @Inject(GoogleDriveService) private readonly driveService: GoogleDriveService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/auth-url')
  getAuthUrl(@Param('businessId') businessId: string) {
    const url = this.driveService.getAuthUrl(businessId);
    return { url };
  }

  @Get('callback')
  async handleCallback(
    @Query('state') state: string,
    @Query('code') code: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    if (error) {
      return res.redirect(`/app/profile?tab=documents&drive=error&reason=${error}`);
    }

    if (!state || !code) {
      return res.redirect('/app/profile?tab=documents&drive=error&reason=missing_params');
    }

    const oauthState = this.driveService.verifyState(state);
    if (!oauthState) {
      return res.redirect('/app/profile?tab=documents&drive=error&reason=invalid_state');
    }

    try {
      await this.driveService.saveDriveCredentials(oauthState.businessId, code);
      return res.redirect('/app/profile?tab=documents&drive=success');
    } catch (err) {
      return res.redirect('/app/profile?tab=documents&drive=error&reason=token_exchange');
    }
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/status')
  getStatus(@Param('businessId') businessId: string) {
    return this.driveService.getConnectionStatus(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/disconnect')
  disconnect(@Param('businessId') businessId: string) {
    return this.driveService.disconnect(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/files')
  listFiles(
    @Param('businessId') businessId: string,
    @Query('pageToken') pageToken?: string,
    @Query('q') query?: string,
    @Query('mimeType') mimeType?: string,
    @Query('pageSize') pageSize?: string,
    @Query('orderBy') orderBy?: string,
  ) {
    return this.driveService.listFiles(businessId, {
      pageToken,
      query,
      mimeType,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      orderBy,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/files/:fileId')
  getFile(
    @Param('businessId') businessId: string,
    @Param('fileId') fileId: string,
  ) {
    return this.driveService.getFile(businessId, fileId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/files/:fileId/embed-url')
  getEmbedUrl(
    @Param('businessId') businessId: string,
    @Param('fileId') fileId: string,
    @Query('mimeType') mimeType: string,
  ) {
    const url = this.driveService.getEmbedUrl(fileId, mimeType);
    return { url };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/save-document')
  saveDocument(
    @Param('businessId') businessId: string,
    @Body() body: {
      title: string;
      sections: Array<{ sectionName: string; content: string }>;
      documentType: string;
      category: string;
      version: number;
    },
  ) {
    return this.driveService.saveDocumentToDrive(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/export-html')
  exportHtml(
    @Param('businessId') businessId: string,
    @Body() body: {
      title: string;
      sections: Array<{ sectionName: string; content: string }>;
      documentType: string;
      category: string;
      version: number;
    },
  ) {
    const html = this.driveService.buildDocumentHtml(body);
    return { html };
  }
}
