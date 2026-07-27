import { Controller, Post, Req, BadRequestException, Headers, Inject, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { RiscService } from './risc.service';

/**
 * Google Cross-Account Protection (RISC) event receiver.
 *
 * This endpoint is called directly by Google with signed JWTs. It is
 * intentionally public: Google has no KeyFlowOS bearer token. Token
 * authenticity is verified cryptographically inside {@link RiscService}.
 */
@Controller('webhooks/risc')
export class RiscController {
  private readonly logger = new Logger(RiscController.name);

  constructor(@Inject(RiscService) private readonly risc: RiscService) {}

  @Post()
  async receiveEvent(
    @Req() req: Request,
    @Headers('content-type') contentType?: string,
  ): Promise<{ received: boolean }> {
    const rawBody = (req as { rawBody?: Buffer }).rawBody ?? Buffer.from('');
    if (rawBody.length === 0) {
      this.logger.warn('RISC event received with empty body');
      throw new BadRequestException('Missing body');
    }

    // Google sends the security event token as the raw POST body.
    // Some payloads arrive with content-type application/secevent+jwt,
    // others application/json; accept any and trim whitespace.
    const token = rawBody.toString('utf8').trim();
    if (!token) {
      this.logger.warn('RISC event received with empty token');
      throw new BadRequestException('Missing token');
    }

    const result = await this.risc.receiveEvent(token);
    if (result.status === 400) {
      throw new BadRequestException('Invalid security event token');
    }

    // Per spec: return 202 Accepted. Nest serializes the body after the status.
    return { received: true };
  }
}
