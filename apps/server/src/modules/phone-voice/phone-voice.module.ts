import { Module, forwardRef } from '@nestjs/common';
import { PhoneVoiceService } from './phone-voice.service';
import { PhoneVoiceController } from './phone-voice.controller';
import { RealtimeBridgeService } from './realtime-bridge.service';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [PrismaModule, forwardRef(() => AiModule)],
  controllers: [PhoneVoiceController],
  providers: [PhoneVoiceService, RealtimeBridgeService],
  exports: [PhoneVoiceService, RealtimeBridgeService],
})
export class PhoneVoiceModule {}
