import { Controller, Get, Post, Delete, Patch, Param, Query, Body, Req, Res, UseGuards, Inject } from '@nestjs/common';
import { Response } from 'express';
import { GoogleDriveService } from './google-drive.service';
import { TransactionalEmailService } from '../notifications/transactional-email.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

@Controller('drive')
export class GoogleDriveController {
  constructor(
    @Inject(GoogleDriveService) private readonly driveService: GoogleDriveService,
    @Inject(TransactionalEmailService) private readonly emailService: TransactionalEmailService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
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

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/inventory-sheet/status')
  getInventorySheetStatus(@Param('businessId') businessId: string) {
    return this.driveService.getInventorySheetSyncStatus(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/inventory-sheet/create')
  createInventorySheet(
    @Param('businessId') businessId: string,
    @Body() body: { title?: string },
  ) {
    return this.driveService.createInventorySheet(businessId, body.title || 'Inventory Sync');
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/inventory-sheet/link')
  linkInventorySheet(
    @Param('businessId') businessId: string,
    @Body() body: { sheetId: string; sheetName: string },
  ) {
    return this.driveService.linkInventorySheet(businessId, body.sheetId, body.sheetName);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/inventory-sheet/unlink')
  unlinkInventorySheet(@Param('businessId') businessId: string) {
    return this.driveService.unlinkInventorySheet(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/inventory-sheet/push')
  pushInventoryToSheet(@Param('businessId') businessId: string) {
    return this.driveService.pushInventoryToSheet(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/inventory-sheet/pull')
  pullInventoryFromSheet(@Param('businessId') businessId: string) {
    return this.driveService.pullInventoryFromSheet(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/inventory-sheet/apply')
  applyPulledInventory(
    @Param('businessId') businessId: string,
    @Body() body: { rows: Record<string, string>[] },
    @Req() req: { user?: { id?: string } },
  ) {
    return this.driveService.applyPulledInventory(businessId, body.rows || [], req.user?.id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/inventory-sheet/diff')
  generateInventorySheetDiff(@Param('businessId') businessId: string) {
    return this.driveService.generateInventorySheetDiff(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/email-content')
  async emailContent(
    @Param('businessId') businessId: string,
    @Req() req: { user?: { id?: string } },
    @Body() body: {
      title: string;
      sections: Array<{ sectionName: string; content: string }>;
      documentType: string;
      category: string;
      version: number;
    },
  ) {
    let user: { email: string | null; name: string | null; firstName: string | null } | null = null;

    if (req.user?.id) {
      user = await this.prisma.client.user.findUnique({
        where: { id: req.user.id },
        select: { email: true, name: true, firstName: true },
      });
    }

    if (!user || !user.email) {
      const business = await this.prisma.client.business.findUnique({
        where: { id: businessId },
        include: { members: { include: { user: { select: { email: true, name: true, firstName: true } } }, take: 1 } },
      });
      if (!business || business.members.length === 0) return { sent: false, reason: 'No recipient email found' };
      user = business.members[0].user;
    }

    if (!user?.email) return { sent: false, reason: 'No recipient email found' };

    try {
      const result = await this.emailService.send({
        businessId,
        type: 'document_generated',
        recipientEmail: user.email,
        recipientName: user.name || user.firstName || 'there',
        templateData: {
          documentTitle: body.title,
          documentTypeName: body.documentType,
          categoryName: body.category,
          riskTier: 'GREEN',
          documentId: '',
          version: body.version,
          sections: body.sections.slice(0, 20).map((s) => ({
            name: String(s.sectionName || '').slice(0, 200),
            content: String(s.content || '').slice(0, 10000),
          })),
          documentUrl: '',
        },
      });

      if (result?.status === 'SENT') return { sent: true };
      if (result?.status === 'QUEUED') return { sent: false, reason: 'Email queued — connect Gmail to send immediately' };
      return { sent: false, reason: 'Email delivery failed. Please try again.' };
    } catch {
      return { sent: false, reason: 'Failed to send email. Please try again.' };
    }
  }
}
