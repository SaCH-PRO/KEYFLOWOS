import { Injectable, Inject, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { VoiceProvider } from './voice-provider.interface';
import { OpenAiVoiceProvider } from './openai-voice.provider';
import { ElevenLabsVoiceProvider } from './elevenlabs-voice.provider';
import { BrowserVoiceProvider } from './browser-voice.provider';

@Injectable()
export class VoiceService {
  private readonly providers: Map<string, VoiceProvider>;

  constructor(
    @Inject(OpenAiVoiceProvider) openai: OpenAiVoiceProvider,
    @Inject(ElevenLabsVoiceProvider) elevenlabs: ElevenLabsVoiceProvider,
    @Inject(BrowserVoiceProvider) browser: BrowserVoiceProvider,
  ) {
    this.providers = new Map<string, VoiceProvider>([
      [browser.name, browser],
      [openai.name, openai],
      [elevenlabs.name, elevenlabs],
    ]);
  }

  listProviders(): Array<{
    name: string;
    displayName: string;
    defaultVoice: string;
    voices: { key: string; name: string; language?: string; gender?: string }[];
    available: boolean;
  }> {
    return Array.from(this.providers.values()).map((p) => ({
      name: p.name,
      displayName: p.displayName,
      defaultVoice: p.defaultVoice,
      voices: p.voices,
      available: p.name === 'browser' ? true : this.isProviderAvailable(p.name),
    }));
  }

  private isProviderAvailable(name: string): boolean {
    if (name === 'openai') return !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (name === 'elevenlabs') return !!process.env.ELEVENLABS_API_KEY;
    return false;
  }

  async synthesize(
    businessId: string,
    providerName: string,
    text: string,
    voice?: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new NotFoundException(`Unknown voice provider: ${providerName}`);
    }
    if (providerName === 'browser') {
      throw new ServiceUnavailableException('Browser TTS is handled on the client.');
    }
    const buffer = await provider.synthesize(businessId, text, voice);
    return { buffer, contentType: 'audio/mpeg' };
  }
}
