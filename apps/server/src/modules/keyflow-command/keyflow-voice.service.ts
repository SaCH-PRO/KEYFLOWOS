import { Injectable, Logger, HttpException, HttpStatus, ServiceUnavailableException, Inject } from '@nestjs/common';
import { AiUsageService } from '../ai/ai-usage.service';

/**
 * R0-34b (COST-LEDGER-001 section 7 item 7): the structured 503 AiUsageService
 * answers when no OpenAI key is configured (provider_not_configured), or the
 * gateway when every credential's circuit is open (provider_unavailable). It is
 * rethrown unchanged so the body keeps its code; every other failure keeps this
 * service's own 503.
 */
function isAiProviderUnavailable(err: unknown): err is HttpException {
  if (!(err instanceof HttpException) || err.getStatus() !== HttpStatus.SERVICE_UNAVAILABLE) return false;
  const body = err.getResponse();
  const code = typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined;
  return code === 'provider_not_configured' || code === 'provider_unavailable';
}

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
    } catch (err: any) {
      if (isAiProviderUnavailable(err)) throw err;
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
    } catch (err: any) {
      if (isAiProviderUnavailable(err)) throw err;
      this.logger.error(`STT failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('Voice transcription failed.');
    }
  }
}
