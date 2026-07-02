import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { VoiceProvider, VoiceInfo } from './voice-provider.interface';

const VOICES: VoiceInfo[] = [
  { key: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', language: 'en' },
  { key: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', language: 'en' },
  { key: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', language: 'en' },
  { key: 'ErXwobaYiN019PkySvjV', name: 'Antoni', language: 'en' },
  { key: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', language: 'en' },
  { key: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', language: 'en' },
  { key: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', language: 'en' },
  { key: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', language: 'en' },
];

@Injectable()
export class ElevenLabsVoiceProvider implements VoiceProvider {
  readonly name = 'elevenlabs';
  readonly displayName = 'ElevenLabs';
  readonly defaultVoice = '21m00Tcm4TlvDq8ikWAM';
  readonly voices = VOICES;

  async synthesize(_businessId: string, text: string, voice?: string): Promise<Buffer> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('ELEVENLABS_API_KEY is not configured.');
    }
    const voiceId = voice || process.env.ELEVENLABS_VOICE_ID || this.defaultVoice;
    const safe = text.trim();
    if (!safe) {
      throw new ServiceUnavailableException('No text supplied for synthesis.');
    }

    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text: safe.length > 5000 ? safe.slice(0, 5000) : safe,
          model_id: 'eleven_monolingual_v1',
        }),
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => 'unknown');
      throw new ServiceUnavailableException(`ElevenLabs TTS failed: ${res.status} ${body}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
