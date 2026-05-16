import { Injectable, Logger, ServiceUnavailableException, Inject } from '@nestjs/common';
import { AiUsageService } from '../ai/ai-usage.service';

export interface KeyflowVoiceRequest {
  text: string;
  voice?: 'alloy' | 'ash' | 'coral' | 'echo' | 'fable' | 'onyx' | 'nova' | 'sage' | 'shimmer';
  format?: 'mp3' | 'opus' | 'aac' | 'flac';
}

@Injectable()
export class KeyflowVoiceService {
  private readonly logger = new Logger(KeyflowVoiceService.name);

  constructor(
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
  ) {}

  /**
   * Synthesize spoken audio from text using OpenAI TTS.
   * Returns the audio bytes as a Node Buffer the controller streams to the client.
   */
  async synthesize(businessId: string, req: KeyflowVoiceRequest): Promise<{ buffer: Buffer; format: string }> {
    const trimmed = (req.text ?? '').trim();
    if (!trimmed) {
      throw new ServiceUnavailableException('No text supplied for synthesis.');
    }
    const safe = trimmed.length > 4000 ? trimmed.slice(0, 4000) : trimmed;
    const format = req.format ?? 'mp3';
    const voice = req.voice ?? 'alloy';

    try {
      const result = await this.aiUsage.trackAudio(
        businessId,
        undefined,
        'audio_tts',
        'tts',
        {
          text: safe,
          voice,
          model: 'gpt-4o-mini-tts',
        },
      );
      return { buffer: result as Buffer, format };
    } catch (err) {
      this.logger.error(`TTS failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('Voice synthesis failed.');
    }
  }

  /**
   * Transcribe a short user utterance with Whisper.
   * The browser sends a webm/opus blob from MediaRecorder.
   */
  async transcribe(businessId: string, buffer: Buffer, mimeType: string): Promise<{ text: string }> {
    const ext = mimeType.includes('mp4') ? 'mp4'
      : mimeType.includes('mpeg') ? 'mp3'
      : mimeType.includes('wav') ? 'wav'
      : 'webm';

    try {
      const result = await this.aiUsage.trackAudio(
        businessId,
        undefined,
        'audio_stt',
        'stt',
        {
          audioFile: buffer,
          fileName: `utterance.${ext}`,
          model: 'whisper-1',
        },
      );
      return { text: result as string };
    } catch (err) {
      this.logger.error(`STT failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('Voice transcription failed.');
    }
  }
}
