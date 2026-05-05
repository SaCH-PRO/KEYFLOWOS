import { Body, Controller, ForbiddenException, Inject, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { InboundCommunicationsService } from './inbound-communications.service';

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

/**
 * Public webhook endpoints for inbound email and SMS providers. Both use a
 * shared HMAC scheme over the raw request body so any provider (Gmail Pub/Sub
 * push, Resend inbound, Twilio inbound) can be normalised to the Keyflow
 * inbound event shape in front of these endpoints.
 *
 * Header: `x-keyflow-signature: sha256=<hex>` over the raw body, signed with
 * `INBOUND_WEBHOOK_SECRET`. Fails closed when the secret is unset.
 */
@Controller('communications/inbound')
export class InboundCommunicationsController {
  constructor(
    @Inject(InboundCommunicationsService) private readonly inbound: InboundCommunicationsService,
  ) {}

  @Post('email')
  async email(
    @Req() req: RawBodyRequest,
    @Body()
    body: {
      businessId?: string;
      from: string;
      to?: string;
      subject?: string;
      body?: string;
      externalId?: string;
      senderName?: string;
      receivedAt?: string;
    },
  ) {
    this.assertValidSignature(req);
    if (!body?.from) throw new ForbiddenException('from is required');
    return this.inbound.receiveEmail({
      businessId: body.businessId,
      from: body.from,
      to: body.to,
      subject: body.subject,
      body: body.body,
      externalId: body.externalId,
      senderName: body.senderName,
      receivedAt: body.receivedAt ? new Date(body.receivedAt) : undefined,
    });
  }

  @Post('sms')
  async sms(
    @Req() req: RawBodyRequest,
    @Body()
    body: {
      businessId?: string;
      from: string;
      to?: string;
      body?: string;
      externalId?: string;
      senderName?: string;
      receivedAt?: string;
    },
  ) {
    this.assertValidSignature(req);
    if (!body?.from) throw new ForbiddenException('from is required');
    return this.inbound.receiveSms({
      businessId: body.businessId,
      from: body.from,
      to: body.to,
      body: body.body,
      externalId: body.externalId,
      senderName: body.senderName,
      receivedAt: body.receivedAt ? new Date(body.receivedAt) : undefined,
    });
  }

  private assertValidSignature(req: RawBodyRequest) {
    const secret = process.env.INBOUND_WEBHOOK_SECRET;
    if (!secret) {
      throw new ForbiddenException('Inbound webhook secret is not configured');
    }
    const header = (req.headers['x-keyflow-signature'] || req.headers['X-Keyflow-Signature']) as
      | string
      | undefined;
    if (!header || !header.startsWith('sha256=')) {
      throw new ForbiddenException('Missing webhook signature');
    }
    const raw = req.rawBody;
    if (!raw || raw.length === 0) {
      throw new ForbiddenException('Missing webhook body for signature verification');
    }
    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    const provided = header.slice('sha256='.length);
    const expectedBuf = Buffer.from(expected, 'hex');
    const providedBuf = Buffer.from(provided, 'hex');
    if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
      throw new ForbiddenException('Invalid webhook signature');
    }
  }
}
