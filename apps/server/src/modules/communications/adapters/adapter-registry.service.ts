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
  }

  private register(adapter: ChannelAdapter) {
    this.adapters.set(adapter.provider, adapter);
    this.logger.log(`Registered adapter: ${adapter.provider}`);
  }

  resolve(provider: string): ChannelAdapter | null {
    return this.adapters.get(provider) ?? null;
  }

  resolveByPlatform(platform: string): ChannelAdapter | null {
    const providerMap: Record<string, string> = {
      FACEBOOK_PAGE: 'META',
      INSTAGRAM_BUSINESS: 'META',
      EMAIL: 'GOOGLE',
      WHATSAPP: 'WHATSAPP',
    };
    const provider = providerMap[platform];
    return provider ? this.resolve(provider) : null;
  }

  listProviders(): string[] {
    return Array.from(this.adapters.keys());
  }
}
