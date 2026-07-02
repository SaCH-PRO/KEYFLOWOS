import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { VoiceService } from './voice.service';

interface TtsBody {
  text: string;
  voice?: string;
  provider?: string;
}

@Controller('voice')
@UseGuards(AuthGuard)
export class VoiceController {
  constructor(private readonly voice: VoiceService) {}

  @Get('businesses/:businessId/providers')
  @UseGuards(BusinessGuard)
  listProviders(@Param('businessId') _businessId: string) {
    return { providers: this.voice.listProviders() };
  }

  @Post('businesses/:businessId/tts')
  @HttpCode(HttpStatus.OK)
  @UseGuards(BusinessGuard)
  async synthesize(
    @Param('businessId') businessId: string,
    @Body() body: TtsBody,
    @Res() res: Response,
  ) {
    const provider = body.provider || 'openai';
    const { buffer, contentType } = await this.voice.synthesize(
      businessId,
      provider,
      body.text,
      body.voice,
    );
    res.set('Content-Type', contentType);
    res.send(buffer);
  }
}
