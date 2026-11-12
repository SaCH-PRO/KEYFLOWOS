import { Injectable, Logger } from '@nestjs/common';
import { ChannelAdapter } from './channel-adapter.interface';
import { MetaAdapter } from './meta-adapter';
import { EmailAdapter } from './email-adapter';
import { WhatsAppAdapter } from './whatsapp-adapter';

@Injectable()
export class AdapterRegistryService {
  private readonly logger = new Logger(AdapterRegistryService.name);
  private readonly adapters = new Map<string, ChannelAdapter>();

  constructor() {
    this.register(new MetaAdapter());
    this.register(new EmailAdapter());
    this.register(new WhatsAppAdapter());
    // D-82: ResendEmailAdapter (the platform sender) is not registered. Business
    // email never relays through the platform's own address.
  }

  private register(adapter: ChannelAdapter) {
    this.adapters.set(adapter.provider, adapter);
    this.logger.log(`Registered adapter: ${adapter.provider}`);
  }

  resolve(provider: string): ChannelAdapter | null {
    return this.adapters.get(provider) ?? null;
  }

  /**
   * The adapter for a destination's platform.
   *
   * EMAIL maps to GOOGLE, which is Gmail and needs a connected account.
   * `resolveEmailFor` below checks that the connection is actually usable; this
   * stays a pure platform lookup so existing callers are unchanged.
   */
  resolveByPlatform(platform: string): ChannelAdapter | null {
    const providerMap: Record<string, string> = {
      FACEBOOK: 'META',
      FACEBOOK_PAGE: 'META',
      INSTAGRAM: 'META',
      INSTAGRAM_BUSINESS: 'META',
      EMAIL: 'GOOGLE',
      GOOGLE: 'GOOGLE',
      WHATSAPP: 'WHATSAPP',
    };
    const provider = providerMap[platform];
    return provider ? this.resolve(provider) : null;
  }

  /**
   * The adapter that can actually deliver this business email: Gmail when the
   * connection carries a usable token, otherwise none.
   *
   * D-82 (2026-11-09): business email leaves only from the business's own
   * mailbox. It used to fall back to the platform ESP (Resend, sending from the
   * platform's sign-in address); it no longer does. With no usable Gmail the
   * caller gets null and fails the delivery visibly
   * (DeliveryQueueService: EMAIL_ACCOUNT_NOT_CONNECTED).
   */
  resolveEmailFor(connection: { provider?: string | null; token?: string | null } | null | undefined): ChannelAdapter | null {
    const usableGmail =
      (connection?.provider === 'GOOGLE' || connection?.provider === 'EMAIL') && !!connection?.token;
    return usableGmail ? this.resolve('GOOGLE') : null;
  }

  listProviders(): string[] {
    return Array.from(this.adapters.keys());
  }
}
