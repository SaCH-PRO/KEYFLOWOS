import { Injectable } from '@nestjs/common';
import { VoiceProvider } from './voice-provider.interface';

@Injectable()
export class BrowserVoiceProvider implements VoiceProvider {
  readonly name = 'browser';
  readonly displayName = 'Browser / OS TTS';
  readonly defaultVoice = 'default';
  readonly voices = [
    { key: 'default', name: 'System default', language: 'en' },
  ];

  async synthesize(_businessId: string): Promise<Buffer> {
    // Browser TTS is handled entirely on the client.
    throw new Error('Browser TTS does not generate server audio.');
  }
}
