import { Injectable, Logger } from '@nestjs/common';
import { ChannelAdapter } from './channel-adapter.interface';
import { MetaAdapter } from './meta-adapter';
import { EmailAdapter } from './email-adapter';
import { WhatsAppAdapter } from './whatsapp-adapter';
import { ResendEmailAdapter } from './resend-email-adapter';

@Injectable()
export class AdapterRegistryService {
  private readonly logger = new Logger(AdapterRegistryService.name);
  private readonly adapters = new Map<string, ChannelAdapter>();

  constructor() {
    this.register(new MetaAdapter());
    this.register(new EmailAdapter());
    this.register(new WhatsAppAdapter());
    this.register(new ResendEmailAdapter());
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
   * EMAIL maps to GOOGLE, which is Gmail and needs a connected account. A
   * business without one had nothing to send through at all — see
   * resend-email-adapter.ts. `resolveEmail` below picks the fallback when the
   * connection is not actually usable; this stays a pure platform lookup so
   * existing callers are unchanged.
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
   * The adapter that can actually deliver this email.
   *
   * Gmail when the connection carries a usable token, the platform ESP when it
   * does not. Deciding on the CONNECTION rather than the platform is the point:
   * a business can have an EMAIL destination whose token has expired, and
   * failing that delivery with MISSING_CREDENTIALS when a working fallback
   * exists is the same "correct in isolation" failure the rest of this codebase
   * keeps producing.
   */
  resolveEmailFor(connection: { provider?: string | null; token?: string | null } | null | undefined): ChannelAdapter | null {
    const usableGmail =
      (connection?.provider === 'GOOGLE' || connection?.provider === 'EMAIL') && !!connection?.token;
    if (usableGmail) return this.resolve('GOOGLE');
    return this.resolve('RESEND');
  }

  listProviders(): string[] {
    return Array.from(this.adapters.keys());
  }
}
