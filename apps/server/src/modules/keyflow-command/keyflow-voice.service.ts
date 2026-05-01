import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import OpenAI from 'openai';

export interface KeyflowVoiceRequest {
  text: string;
  voice?: 'alloy' | 'ash' | 'coral' | 'echo' | 'fable' | 'onyx' | 'nova' | 'sage' | 'shimmer';
  format?: 'mp3' | 'opus' | 'aac' | 'flac';
}

@Injectable()
export class KeyflowVoiceService {
  private readonly logger = new Logger(KeyflowVoiceService.name);
  private readonly openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }

  /**
   * Synthesize spoken audio from text using OpenAI TTS.
   * Returns the audio bytes as a Node Buffer the controller streams to the client.
   */
  async synthesize(req: KeyflowVoiceRequest): Promise<{ buffer: Buffer; format: string }> {
    if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
      throw new ServiceUnavailableException('Voice service is not configured.');
    }
    const trimmed = (req.text ?? '').trim();
    if (!trimmed) {
      throw new ServiceUnavailableException('No text supplied for synthesis.');
    }
    const safe = trimmed.length > 4000 ? trimmed.slice(0, 4000) : trimmed;
    const format = req.format ?? 'mp3';
    const voice = req.voice ?? 'alloy';

    try {
      const response = await this.openai.audio.speech.create({
        model: 'gpt-4o-mini-tts',
        voice,
        input: safe,
        response_format: format,
      });
      const arrayBuffer = await response.arrayBuffer();
      return { buffer: Buffer.from(arrayBuffer), format };
    } catch (err) {
      this.logger.error(`TTS failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('Voice synthesis failed.');
    }
  }

  /**
   * Transcribe a short user utterance with Whisper.
   * The browser sends a webm/opus blob from MediaRecorder.
   */
  async transcribe(buffer: Buffer, mimeType: string): Promise<{ text: string }> {
    if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
      throw new ServiceUnavailableException('Voice service is not configured.');
    }

    const ext = mimeType.includes('mp4') ? 'mp4'
      : mimeType.includes('mpeg') ? 'mp3'
      : mimeType.includes('wav') ? 'wav'
      : 'webm';

    try {
      const file = new File([new Uint8Array(buffer)], `utterance.${ext}`, { type: mimeType });
      const result = await this.openai.audio.transcriptions.create({
        file,
        model: 'whisper-1',
      });
      return { text: result.text ?? '' };
    } catch (err) {
      this.logger.error(`STT failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('Voice transcription failed.');
    }
  }
}
