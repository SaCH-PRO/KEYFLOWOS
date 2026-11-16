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
  Inject,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { VoiceService } from './voice.service';
import { HiddenModuleWrites, HiddenModuleWritesExempt } from '../../core/auth/hidden-module-writes.decorator';

interface TtsBody {
  text: string;
  voice?: string;
  provider?: string;
}

@HiddenModuleWrites('key_voice', 'ai')
@Controller('voice')
@UseGuards(AuthGuard)
export class VoiceController {
  constructor(@Inject(VoiceService) private readonly voice: VoiceService) {}

  @Get('businesses/:businessId/providers')
  @UseGuards(BusinessGuard)
  listProviders(@Param('businessId') _businessId: string) {
    return { providers: this.voice.listProviders() };
  }

  /**
   * KEY chat's voice: use-key-chat-tts speaks each sentence of KEY's reply through this route. KEY chat is every
   * member's surface (AiFlowController.flowChatStream, census exempt-ruled), so its voice follows it: a member who may
   * chat with KEY hears the reply. It writes no row. The class gate's ai write silenced every STAFF member's
   * auto-speak, with nothing said (SWP-CENSUS-HIDDEN review COR-HID-3).
   */
  @HiddenModuleWritesExempt("KEY chat's voice: it speaks KEY's reply to a member who may chat with KEY (KEY chat is every member's surface) and writes no row (SWP-CENSUS-HIDDEN review COR-HID-3)")
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
