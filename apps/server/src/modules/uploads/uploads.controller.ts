import { Body, Controller, Get, Inject, Param, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { UploadsService } from './uploads.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { ObjectStorageService, ObjectNotFoundError } from '../../replit_integrations/object_storage';

@Controller('uploads')
export class UploadsController {
  private objectStorage: ObjectStorageService;

  constructor(@Inject(UploadsService) private readonly uploads: UploadsService) {
    this.objectStorage = new ObjectStorageService();
  }

  @UseGuards(AuthGuard)
  @Post('request-url')
  async requestUploadUrl(@Body() body: { name?: string; size?: number; contentType?: string }) {
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
