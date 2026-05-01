import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { KeyflowCommandService } from './keyflow-command.service';
import { KeyflowNotesService } from './keyflow-notes.service';
import { KeyflowVoiceService } from './keyflow-voice.service';

@Controller('keyflow')
export class KeyflowCommandController {
  constructor(
    @Inject(KeyflowCommandService) private readonly command: KeyflowCommandService,
    @Inject(KeyflowNotesService) private readonly notes: KeyflowNotesService,
    @Inject(KeyflowVoiceService) private readonly voice: KeyflowVoiceService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/events')
  async listEvents(
    @Param('businessId') businessId: string,
    @Query('timeMin') timeMin?: string,
    @Query('timeMax') timeMax?: string,
  ) {
    const now = new Date();
    const min = timeMin ? new Date(timeMin) : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const max = timeMax ? new Date(timeMax) : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const events = await this.command.listUnifiedEvents(businessId, min, max);
    return { events, range: { timeMin: min.toISOString(), timeMax: max.toISOString() } };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/notes')
  async listNotes(
    @Param('businessId') businessId: string,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
  ) {
    const items = await this.notes.list(businessId, targetType, targetId);
    return { items };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/notes')
  async createNote(
    @Param('businessId') businessId: string,
    @Req() req: Request,
    @Body()
    body: {
      targetType: string;
      targetId: string;
      targetLabel?: string | null;
      body?: string;
      pinned?: boolean;
    },
  ) {
    const userId = (req as any).user?.id;
    return this.notes.create(businessId, body, userId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Put('businesses/:businessId/notes/:noteId')
  async updateNote(
    @Param('businessId') businessId: string,
    @Param('noteId') noteId: string,
    @Body() body: { body?: string; pinned?: boolean; targetLabel?: string | null },
  ) {
    return this.notes.update(businessId, noteId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/notes/:noteId')
  async deleteNote(
    @Param('businessId') businessId: string,
    @Param('noteId') noteId: string,
  ) {
    return this.notes.delete(businessId, noteId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/notes/:noteId/brief')
  async generateBrief(
    @Param('businessId') businessId: string,
    @Param('noteId') noteId: string,
  ) {
    return this.notes.generateBrief(businessId, noteId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/voice/tts')
  async tts(
    @Param('businessId') _businessId: string,
    @Body() body: { text: string; voice?: any; format?: any },
    @Res() res: Response,
  ) {
    const { buffer, format } = await this.voice.synthesize({
      text: body.text,
      voice: body.voice,
      format: body.format,
    });
    res.setHeader(
      'Content-Type',
      format === 'mp3' ? 'audio/mpeg'
        : format === 'opus' ? 'audio/ogg'
        : format === 'aac' ? 'audio/aac'
        : 'audio/flac',
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/voice/transcribe')
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: 25 * 1024 * 1024 } }))
  async transcribe(
    @Param('businessId') _businessId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      return { text: '' };
    }
    return this.voice.transcribe(file.buffer, file.mimetype || 'audio/webm');
  }
}
