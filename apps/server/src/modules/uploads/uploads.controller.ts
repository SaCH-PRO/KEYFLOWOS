import { BadRequestException, Body, Controller, Inject, Post, UseGuards } from '@nestjs/common';
import { UploadsService } from './uploads.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/vcard',
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024;

@Controller('uploads')
export class UploadsController {
  constructor(@Inject(UploadsService) private readonly uploads: UploadsService) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('request-url')
  async requestUploadUrl(
    @Body('businessId') businessId: string,
    @Body() body: { name?: string; size?: number; contentType?: string },
  ) {
    if (body.contentType && !ALLOWED_CONTENT_TYPES.has(body.contentType)) {
      throw new BadRequestException(`File type '${body.contentType}' is not allowed`);
    }
    if (body.size && body.size > MAX_FILE_SIZE) {
      throw new BadRequestException(`File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    }
    if (body.name) {
      const sanitized = body.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      body.name = sanitized;
    }
    const result = await this.uploads.getUploadUrl();
    return {
      ...result,
      metadata: {
        name: body.name,
        size: body.size,
        contentType: body.contentType,
      },
    };
  }
}
