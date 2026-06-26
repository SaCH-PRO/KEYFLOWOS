import { Controller, Get, Post, Delete, Patch, Param, Query, Body, Req, Res, UseGuards, Inject } from '@nestjs/common';
import { Response } from 'express';
import { GoogleDriveService } from './google-drive.service';
import { GeneratedDocumentService } from './generated-document.service';
import { TransactionalEmailService } from '../notifications/transactional-email.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

@Controller('drive')
export class GoogleDriveController {
  constructor(
    @Inject(GoogleDriveService) private readonly driveService: GoogleDriveService,
    @Inject(GeneratedDocumentService) private readonly generatedDocService: GeneratedDocumentService,
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
    const returnPath = '/app/key-connect';

    if (error) {
      return res.redirect(`${returnPath}?drive=error&reason=${error}`);
    }

    if (!state || !code) {
      return res.redirect(`${returnPath}?drive=error&reason=missing_params`);
    }

    const oauthState = this.driveService.verifyState(state);
    if (!oauthState) {
      return res.redirect(`${returnPath}?drive=error&reason=invalid_state`);
    }

    try {
      await this.driveService.saveDriveCredentials(oauthState.businessId, code);
      return res.redirect(`${returnPath}?drive=success`);
    } catch (err: any) {
      return res.redirect(`${returnPath}?drive=error&reason=token_exchange`);
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
  @Patch('businesses/:businessId/files/:fileId/rename')
  rename(
    @Param('businessId') businessId: string,
    @Param('fileId') fileId: string,
    @Body() body: { name: string },
  ) {
    return this.driveService.renameFile(businessId, fileId, body.name);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/files/:fileId/move')
  move(
    @Param('businessId') businessId: string,
    @Param('fileId') fileId: string,
    @Body() body: { addParents?: string[]; removeParents?: string[] },
  ) {
    return this.driveService.moveFile(businessId, fileId, body.addParents, body.removeParents);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/files/:fileId/trash')
  trash(@Param('businessId') businessId: string, @Param('fileId') fileId: string) {
    return this.driveService.trashFile(businessId, fileId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/files/:fileId/untrash')
  untrash(@Param('businessId') businessId: string, @Param('fileId') fileId: string) {
    return this.driveService.untrashFile(businessId, fileId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/files/:fileId')
  deleteFile(@Param('businessId') businessId: string, @Param('fileId') fileId: string) {
    return this.driveService.deleteFile(businessId, fileId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/files/:fileId/share')
  share(
    @Param('businessId') businessId: string,
    @Param('fileId') fileId: string,
    @Body()
    body: {
      type: 'user' | 'group' | 'domain' | 'anyone';
      role: 'reader' | 'commenter' | 'writer' | 'owner';
      emailAddress?: string;
      domain?: string;
      sendNotification?: boolean;
    },
  ) {
    return this.driveService.shareFile(businessId, fileId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/docs')
  createDoc(
    @Param('businessId') businessId: string,
    @Body() body: { title: string; parentId?: string },
  ) {
    return this.driveService.createDoc(businessId, body.title, body.parentId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/sheets')
  createSheet(
    @Param('businessId') businessId: string,
    @Body() body: { title: string; parentId?: string },
  ) {
    return this.driveService.createSheet(businessId, body.title, body.parentId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/folders')
  createFolder(
    @Param('businessId') businessId: string,
    @Body() body: { name: string; parentId?: string },
  ) {
    return this.driveService.createFolder(businessId, body.name, body.parentId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/files/:fileId/content')
  getFileContent(
    @Param('businessId') businessId: string,
    @Param('fileId') fileId: string,
    @Query('as') as?: string,
  ) {
    // `as` reserved for future formats; only HTML is supported today.
    void as;
    return this.driveService.getFileContent(businessId, fileId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/files/:fileId/content')
  updateFileContent(
    @Param('businessId') businessId: string,
    @Param('fileId') fileId: string,
    @Body() body: { html: string },
  ) {
    return this.driveService.updateFileContent(businessId, fileId, body.html || '');
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
      sections: Array<{ sectionName: string; content: string; contentFormat?: string }>;
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
      sections: Array<{ sectionName: string; content: string; contentFormat?: string }>;
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
  @Post('businesses/:businessId/generated-documents')
  async uploadGeneratedDocument(
    @Param('businessId') businessId: string,
    @Body() body: {
      entityType: string;
      entityId: string;
      fileName: string;
      mimeType: string;
      contentBase64: string;
      contentFormat: 'binary' | 'html';
    },
  ) {
    const content = body.contentFormat === 'binary'
      ? Buffer.from(body.contentBase64, 'base64')
      : body.contentBase64;

    return this.generatedDocService.uploadAndTrack({
      businessId,
      entityType: body.entityType as any,
      entityId: body.entityId,
      fileName: body.fileName,
      mimeType: body.mimeType,
      content,
      contentFormat: body.contentFormat,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/generated-documents')
  async listGeneratedDocuments(
    @Param('businessId') businessId: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.generatedDocService.list(businessId, {
      entityType,
      entityId,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
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
