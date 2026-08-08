import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ChatwootService } from './chatwoot.service';

@Controller('chatwoot')
export class ChatwootController {
  constructor(private readonly chatwoot: ChatwootService) {}

  /**
   * Agent-bot webhook receiver. Public by necessity (Chatwoot cannot send
   * user JWTs), so authentication is a shared secret in the path — verified
   * fail-closed in the service. Responds immediately and processes async so
   * slow LLM replies never time out Chatwoot's webhook retry.
   */
  @Post('webhook/:secret')
  @HttpCode(202)
  async webhook(@Param('secret') secret: string, @Body() payload: Record<string, unknown>) {
    this.chatwoot.assertWebhookSecret(secret);
    void this.chatwoot.handleWebhook(payload as never).catch(() => undefined);
    return { accepted: true };
  }
}
