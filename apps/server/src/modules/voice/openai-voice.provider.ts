import { Injectable, Inject, HttpException, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { VoiceProvider, VoiceInfo } from './voice-provider.interface';
import { AiUsageService } from '../ai/ai-usage.service';

/**
 * R0-34b (COST-LEDGER-001 section 7 item 7): the structured 503 AiUsageService
 * answers when no OpenAI key is configured (provider_not_configured), or the
 * gateway when every credential's circuit is open (provider_unavailable). It is
 * rethrown unchanged so the body keeps its code; every other failure keeps this
 * provider's own 503.
 */
function isAiProviderUnavailable(err: unknown): err is HttpException {
  if (!(err instanceof HttpException) || err.getStatus() !== HttpStatus.SERVICE_UNAVAILABLE) return false;
  const body = err.getResponse();
  const code = typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined;
  return code === 'provider_not_configured' || code === 'provider_unavailable';
}

const VOICES: VoiceInfo[] = [
  { key: 'alloy', name: 'Alloy', language: 'en' },
  { key: 'ash', name: 'Ash', language: 'en' },
  { key: 'coral', name: 'Coral', language: 'en' },
  { key: 'echo', name: 'Echo', language: 'en' },
  { key: 'fable', name: 'Fable', language: 'en' },
  { key: 'onyx', name: 'Onyx', language: 'en' },
  { key: 'nova', name: 'Nova', language: 'en' },
  { key: 'sage', name: 'Sage', language: 'en' },
  { key: 'shimmer', name: 'Shimmer', language: 'en' },
];

@Injectable()
export class OpenAiVoiceProvider implements VoiceProvider {
  readonly name = 'openai';
  readonly displayName = 'OpenAI TTS';
  readonly defaultVoice = 'alloy';
  readonly voices = VOICES;

  constructor(
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
  ) {}

  async synthesize(businessId: string, text: string, voice?: string): Promise<Buffer> {
    const safe = text.trim();
    if (!safe) {
      throw new ServiceUnavailableException('No text supplied for synthesis.');
    }
    try {
      const result = await this.aiUsage.trackAudio(
        businessId,
        undefined,
        'audio_tts',
        'tts',
        {
          text: safe.length > 4000 ? safe.slice(0, 4000) : safe,
          voice: (voice as any) || 'alloy',
          model: 'gpt-4o-mini-tts',
        },
      );
      return result as Buffer;
    } catch (err: any) {
      if (isAiProviderUnavailable(err)) throw err;
      throw new ServiceUnavailableException(`OpenAI TTS failed: ${(err as Error).message}`);
    }
  }
}
