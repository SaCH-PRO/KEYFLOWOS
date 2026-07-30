import { Injectable, Inject, ServiceUnavailableException } from '@nestjs/common';
import { VoiceProvider, VoiceInfo } from './voice-provider.interface';
import { AiUsageService } from '../ai/ai-usage.service';

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
      throw new ServiceUnavailableException(`OpenAI TTS failed: ${(err as Error).message}`);
    }
  }
}
