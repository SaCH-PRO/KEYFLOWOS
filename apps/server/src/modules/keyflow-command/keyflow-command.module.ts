import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { BookingsModule } from '../bookings/bookings.module';
import { AiModule } from '../ai/ai.module';
import { KeyflowCommandController } from './keyflow-command.controller';
import { KeyflowCommandService } from './keyflow-command.service';
import { KeyflowNotesService } from './keyflow-notes.service';
import { KeyflowVoiceService } from './keyflow-voice.service';

@Module({
  imports: [PrismaModule, BookingsModule, AiModule],
  controllers: [KeyflowCommandController],
  providers: [KeyflowCommandService, KeyflowNotesService, KeyflowVoiceService],
  exports: [KeyflowCommandService, KeyflowNotesService, KeyflowVoiceService],
})
export class KeyflowCommandModule {}
