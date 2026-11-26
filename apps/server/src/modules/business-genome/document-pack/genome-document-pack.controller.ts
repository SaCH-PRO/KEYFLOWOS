import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { BusinessGuard } from '../../../core/auth/business.guard';
import type { GenomeReader } from '../key-genome/genome-finance-scope';
import { GenomeDocumentPackService } from './genome-document-pack.service';
import type { ExportFormat } from './genome-document-pack.types';

const VALID_FORMATS: ExportFormat[] = ['pdf', 'docx'];
type DocPackRequest = { user?: { id?: string; role?: string } };

@Controller('business-genome/businesses/:businessId/document-pack')
@UseGuards(AuthGuard, BusinessGuard)
export class GenomeDocumentPackController {
  constructor(
    @Inject(GenomeDocumentPackService) private readonly service: GenomeDocumentPackService,
  ) {}

  private readerOf(req?: DocPackRequest): GenomeReader | null {
    return req?.user?.id ? { id: req.user.id, role: req.user.role } : null;
  }

  @Get('executive-brief/export')
  async exportExecutiveBrief(
    @Param('businessId') businessId: string,
    @Query('format') format: string = 'pdf',
    @Res({ passthrough: false }) res: Response,
    @Req() req?: DocPackRequest,
  ) {
    const exportFormat = this.parseFormat(format);
    const result = await this.service.exportExecutiveBrief(businessId, exportFormat, this.readerOf(req));
    this.send(res, result);
  }

  @Get('constitution/export')
  async exportConstitution(
    @Param('businessId') businessId: string,
    @Query('format') format: string = 'pdf',
    @Query('version') version: string,
    @Res({ passthrough: false }) res: Response,
    @Req() req?: DocPackRequest,
  ) {
    const exportFormat = this.parseFormat(format);
    const versionNumber = version === undefined || version === '' ? undefined : Number(version);
    if (versionNumber !== undefined && (!Number.isFinite(versionNumber) || versionNumber < 1)) {
      throw new BadRequestException('version must be a positive integer');
    }
    const result = await this.service.exportConstitution(
      businessId,
      versionNumber,
      exportFormat,
      this.readerOf(req),
    );
    this.send(res, result);
  }

  @Get('dna/export')
  async exportDnaReport(
    @Param('businessId') businessId: string,
    @Query('format') format: string = 'pdf',
    @Res({ passthrough: false }) res: Response,
    @Req() req?: DocPackRequest,
  ) {
    const exportFormat = this.parseFormat(format);
    const result = await this.service.exportDnaReport(businessId, exportFormat, this.readerOf(req));
    this.send(res, result);
  }

  private parseFormat(format: string): ExportFormat {
    const normalized = format.toLowerCase();
    if (!VALID_FORMATS.includes(normalized as ExportFormat)) {
      throw new BadRequestException(`format must be one of: ${VALID_FORMATS.join(', ')}`);
    }
    return normalized as ExportFormat;
  }

  private send(res: Response, result: { buffer: Buffer; filename: string; contentType: string }): void {
    res.set({
      'Content-Type': result.contentType,
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Content-Length': String(result.buffer.length),
    });
    res.end(result.buffer);
  }
}
