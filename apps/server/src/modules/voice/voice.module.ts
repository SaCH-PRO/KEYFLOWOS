import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { VoiceService } from './voice.service';
import { VoiceController } from './voice.controller';
import { BrowserVoiceProvider } from './browser-voice.provider';
import { OpenAiVoiceProvider } from './openai-voice.provider';
import { ElevenLabsVoiceProvider } from './elevenlabs-voice.provider';

@Module({
  imports: [AiModule],
  controllers: [VoiceController],
  providers: [VoiceService, BrowserVoiceProvider, OpenAiVoiceProvider, ElevenLabsVoiceProvider],
  exports: [VoiceService],
})
export class VoiceModule {}
