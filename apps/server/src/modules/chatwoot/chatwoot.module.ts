import { Module, forwardRef } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ChatwootController } from './chatwoot.controller';
import { ChatwootService } from './chatwoot.service';

@Module({
  imports: [forwardRef(() => AiModule)],
  controllers: [ChatwootController],
  providers: [ChatwootService],
  exports: [ChatwootService],
})
export class ChatwootModule {}
