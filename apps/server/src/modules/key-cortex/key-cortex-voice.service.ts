import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import OpenAI from 'openai';
import { AiUsageService } from '../ai/ai-usage.service';
import {
  CortexVoiceRequest,
  CortexVoiceResponse,
  CortexSTTRequest,
  CortexVoice,
  CortexPersona,
} from './key-cortex.types';
import { KeyCortexPersonalityService } from './key-cortex-personality.service';

/**
 * Voice-to-persona mapping.
 * Each personality is paired with a distinct OpenAI TTS voice
 * to create a coherent audio identity across interactions.
 *
 * Mappings:
 * - jarvis      → echo     (refined, British-butler feel)
 * - friday      → nova     (warm, proactive assistant)
 * - jarvis_dark → ash      (serious, tactical, no-nonsense)
 * - nova        → coral    (creative, enthusiastic)
 * - titan       → onyx     (executive, commanding)
 * - ghost       → sage     (calm, minimal, observant)
 * - mentor      → fable    (patient, educational, storytelling)
 * - hustler     → shimmer  (energetic, high-energy)
 */
const PERSONA_VOICE_MAP: Record<CortexPersona, CortexVoice> = {
  jarvis: 'echo',
  friday: 'nova',
  jarvis_dark: 'ash',
  nova: 'coral',
  titan: 'onyx',
  ghost: 'sage',
  mentor: 'fable',
  hustler: 'shimmer',
};

/**
 * Metadata for all available voices including human-readable
 * descriptions and recommended persona pairings.
 */
const VOICE_CATALOG: Array<{
  id: CortexVoice;
  name: string;
  description: string;
  personality: string;
  gender: string;
  accent: string;
  tone: string;
}> = [
  {
    id: 'alloy',
    name: 'Alloy',
    description: 'Versatile, balanced voice suitable for general-purpose assistance.',
    personality: 'Neutral, reliable, adaptable',
    gender: 'Female',
    accent: 'American',
    tone: 'Balanced',
  },
  {
    id: 'ash',
    name: 'Ash',
    description: 'Deep, serious voice with a commanding, tactical presence.',
    personality: 'Serious, authoritative, focused',
    gender: 'Male',
    accent: 'American',
    tone: 'Deep and commanding',
  },
  {
    id: 'coral',
    name: 'Coral',
    description: 'Bright, warm voice with a naturally friendly disposition.',
    personality: 'Cheerful, approachable, creative',
    gender: 'Female',
    accent: 'American',
    tone: 'Warm and bright',
  },
  {
    id: 'echo',
    name: 'Echo',
    description: 'Sophisticated, refined voice with a composed demeanor.',
    personality: 'Sophisticated, witty, intelligent',
    gender: 'Male',
    accent: 'British',
    tone: 'Refined and polished',
  },
  {
    id: 'fable',
    name: 'Fable',
    description: 'Warm, narrative voice with a patient, storytelling quality.',
    personality: 'Patient, educational, wise',
    gender: 'Male',
    accent: 'British',
    tone: 'Narrative and warm',
  },
  {
    id: 'onyx',
    name: 'Onyx',
    description: 'Powerful, executive voice that conveys authority and decisiveness.',
    personality: 'Executive, strategic, commanding',
    gender: 'Male',
    accent: 'American',
    tone: 'Deep and authoritative',
  },
  {
    id: 'nova',
    name: 'Nova',
    description: 'Warm, energetic voice with a proactive, engaging personality.',
    personality: 'Warm, proactive, helpful',
    gender: 'Female',
    accent: 'American',
    tone: 'Energetic and warm',
  },
  {
    id: 'sage',
    name: 'Sage',
    description: 'Calm, measured voice with a quiet, observant quality.',
    personality: 'Calm, minimal, wise',
    gender: 'Female',
    accent: 'American',
    tone: 'Calm and measured',
  },
  {
    id: 'shimmer',
    name: 'Shimmer',
    description: 'Dynamic, high-energy voice with an optimistic, vibrant character.',
    personality: 'Energetic, dynamic, optimistic',
    gender: 'Female',
    accent: 'American',
    tone: 'Vibrant and dynamic',
  },
  {
    id: 'echo_hd',
    name: 'Echo HD',
    description: 'Premium high-definition version of Echo with enhanced clarity.',
    personality: 'Sophisticated, premium, refined',
    gender: 'Male',
    accent: 'British',
    tone: 'Ultra-refined and clear',
  },
  {
    id: 'nova_hd',
    name: 'Nova HD',
    description: 'Premium high-definition version of Nova with enhanced warmth.',
    personality: 'Warm, premium, engaging',
    gender: 'Female',
    accent: 'American',
    tone: 'Ultra-warm and vibrant',
  },
];

/**
 * Default preview phrases for voice samples.
 * Each persona gets a unique preview line that captures their character.
 */
const VOICE_PREVIEW_PHRASES: Record<CortexPersona, string> = {
  jarvis:
    "At your service. I've analyzed your business metrics and identified three opportunities for optimization. Shall I proceed?",
  friday:
    "Good morning! I've prepared your daily summary, prioritized your tasks, and flagged two messages that need your attention.",
  jarvis_dark:
    'Situation report. Two anomalies detected in revenue flow. Immediate analysis required. Standing by for orders.',
  nova:
    "What shall we create today? I've been brainstorming and I think I found a brilliant angle for your next campaign!",
  titan:
    'The numbers are clear. Revenue opportunity detected in the quarterly data. I recommend immediate execution. Show me the math.',
  ghost: 'Pattern detected. Three correlations found in your workflow data. Intervention may be required.',
  mentor:
    "Every master was once a beginner. Let me walk you through the fundamentals of cash flow optimization — it's simpler than it seems.",
  hustler:
    "Let's make money! I spotted an arbitrage opportunity in your customer data that nobody else is seeing. We need to move fast!",
};

/**
 * KeyCortexVoiceService — STT/TTS voice interface for KEY Cortex.
 *
 * Responsibilities:
 * - Text-to-Speech (TTS) via OpenAI with personality voice mapping
 * - Speech-to-Text (STT) via OpenAI Whisper
 * - Voice selection and customization per persona
 * - Audio usage tracking via AiUsageService
 *
 * @example
 * const audioBuffer = await voiceService.synthesize({ text: "Hello!", persona: "jarvis" }, businessId);
 * const transcript = await voiceService.transcribe({ audioBuffer, mimeType: "audio/webm" }, businessId);
 */
@Injectable()
export class KeyCortexVoiceService {
  private readonly logger = new Logger(KeyCortexVoiceService.name);
  private readonly openai: OpenAI;

  constructor(
    private readonly aiUsageService: AiUsageService,
    private readonly personalityService: KeyCortexPersonalityService,
  ) {
    // .env sets AI_INTEGRATIONS_OPENAI_API_KEY; the production container gets
    // OPENAI_API_KEY instead, because docker-compose.production.yml maps one to
    // the other. Reading only the bare name meant this worked in production and
    // was unset locally — surviving on this machine solely because the developer
    // happened to have OPENAI_API_KEY exported in their shell. Accept either.
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      this.logger.warn(
        'Neither AI_INTEGRATIONS_OPENAI_API_KEY nor OPENAI_API_KEY is set. Voice synthesis and transcription will be unavailable.',
      );
    }
    this.openai = new OpenAI({ apiKey: apiKey ?? 'sk-no-key' });
  }

  // ========================================================================
  // Text-to-Speech (TTS)
  // ========================================================================

  /**
   * Synthesize text into spoken audio using OpenAI's TTS API.
   *
   * Automatically selects the voice based on the persona specified in
   * the request, or uses the explicit voice override if provided.
   *
   * @param request     Voice synthesis request with text and options
   * @param businessId  Tenant-scoped business identifier for usage tracking
   * @returns           Audio buffer containing the synthesized speech
   * @throws ServiceUnavailableException if TTS fails or OpenAI is unreachable
   */
  async synthesize(
    request: CortexVoiceRequest,
    businessId: string,
  ): Promise<Buffer> {
    const {
      text,
      voice: explicitVoice,
      persona,
      format = 'mp3',
      speed = 1.0,
      instructions,
    } = request;

    // Resolve voice: explicit > persona-mapped > fallback
    const voice: CortexVoice =
      explicitVoice ?? (persona ? this.getVoiceForPersona(persona) : 'echo');

    this.logger.debug(
      `Synthesizing TTS: voice="${voice}", format="${format}", speed=${speed}, persona="${persona ?? 'none'}"`,
    );

    // Validate speed range
    const clampedSpeed = Math.max(0.5, Math.min(2.0, speed));

    try {
      const response = await this.openai.audio.speech.create({
        model: 'tts-1',
        voice: voice as string,
        input: text,
        response_format: format,
        speed: clampedSpeed,
        ...(instructions ? { instructions } : {}),
      });

      const audioBuffer = Buffer.from(await response.arrayBuffer());

      // Track usage for billing and monitoring
      this.aiUsageService.trackAudioUsage({
        businessId,
        type: 'audio_tts',
        model: 'tts-1',
        inputLength: text.length,
        outputLength: audioBuffer.length,
        metadata: {
          voice,
          persona: persona ?? 'default',
          format,
          speed: clampedSpeed,
        },
      });

      this.logger.debug(
        `TTS complete: ${audioBuffer.length} bytes, voice="${voice}"`,
      );

      return audioBuffer;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown TTS error';
      this.logger.error(`TTS synthesis failed: ${message}`);
      throw new ServiceUnavailableException(
        `Voice synthesis unavailable: ${message}`,
      );
    }
  }

  /**
   * Synthesize text and return a structured response with metadata.
   *
   * @param request     Voice synthesis request
   * @param businessId  Tenant-scoped business identifier
   * @returns           CortexVoiceResponse with audio URL and metadata
   */
  async synthesizeWithMetadata(
    request: CortexVoiceRequest,
    businessId: string,
  ): Promise<CortexVoiceResponse> {
    const audioBuffer = await this.synthesize(request, businessId);

    // Store audio in temporary storage and generate URL
    // In production, this would upload to S3 or similar
    const audioUrl = await this.storeAudioTemporarily(audioBuffer, request.format ?? 'mp3');

    // Estimate duration: ~0.15 seconds per character at normal speed
    const estimatedDuration = (request.text.length * 0.15) / (request.speed ?? 1.0);

    return {
      audioUrl,
      duration: Math.round(estimatedDuration * 100) / 100,
      format: request.format ?? 'mp3',
      voice: request.voice ?? this.getVoiceForPersona(request.persona ?? 'jarvis'),
    };
  }

  // ========================================================================
  // Speech-to-Text (STT)
  // ========================================================================

  /**
   * Transcribe audio to text using OpenAI's Whisper API.
   *
   * Supports multiple audio formats (webm, mp3, wav, m4a, ogg).
   * An optional prompt can be provided to guide transcription context.
   *
   * @param request     STT request with audio buffer and metadata
   * @param businessId  Tenant-scoped business identifier for usage tracking
   * @returns           Transcribed text string
   * @throws ServiceUnavailableException if transcription fails
   */
  async transcribe(
    request: CortexSTTRequest,
    businessId: string,
  ): Promise<string> {
    const { audioBuffer, mimeType, language, prompt } = request;

    this.logger.debug(
      `Transcribing audio: ${audioBuffer.length} bytes, mimeType="${mimeType}"`,
    );

    try {
      // Map MIME types to Whisper-compatible file extensions
      const extension = this.mimeTypeToExtension(mimeType);

      // Create a File object for the OpenAI API
      const file = new File([audioBuffer as any], `audio.${extension}`, {
        type: mimeType,
      });

      const transcription = await this.openai.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        ...(language ? { language } : {}),
        ...(prompt ? { prompt } : {}),
      });

      const text = transcription.text;

      // Track usage for billing and monitoring
      this.aiUsageService.trackAudioUsage({
        businessId,
        type: 'audio_stt',
        model: 'whisper-1',
        inputLength: audioBuffer.length,
        outputLength: text.length,
        metadata: {
          mimeType,
          language: language ?? 'auto-detected',
          durationSeconds: this.estimateAudioDuration(audioBuffer.length, mimeType),
        },
      });

      this.logger.debug(`STT complete: "${text.substring(0, 80)}..." (${text.length} chars)`);

      return text;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown STT error';
      this.logger.error(`STT transcription failed: ${message}`);
      throw new ServiceUnavailableException(
        `Speech transcription unavailable: ${message}`,
      );
    }
  }

  /**
   * Transcribe audio and return additional metadata including
   * detected language and confidence estimate.
   *
   * @param request     STT request with audio buffer
   * @param businessId  Tenant-scoped business identifier
   * @returns           Transcription with metadata
   */
  async transcribeWithMetadata(
    request: CortexSTTRequest,
    businessId: string,
  ): Promise<{
    text: string;
    language?: string;
    durationSeconds: number;
  }> {
    const text = await this.transcribe(request, businessId);

    return {
      text,
      language: request.language,
      durationSeconds: this.estimateAudioDuration(
        request.audioBuffer.length,
        request.mimeType,
      ),
    };
  }

  // ========================================================================
  // Voice Selection & Persona Mapping
  // ========================================================================

  /**
   * Get the default voice for a given persona.
   *
   * @param persona The personality persona
   * @returns       The mapped voice identifier
   */
  getVoiceForPersona(persona: CortexPersona): CortexVoice {
    const voice = PERSONA_VOICE_MAP[persona];
    if (!voice) {
      this.logger.warn(`Unknown persona "${persona}", falling back to "echo"`);
      return 'echo';
    }
    return voice;
  }

  /**
   * List all available voices with their descriptions.
   *
   * @returns Array of voice metadata including descriptions
   */
  async getAvailableVoices(): Promise<
    Array<{
      id: CortexVoice;
      name: string;
      description: string;
      personality: string;
      gender: string;
      accent: string;
      tone: string;
      defaultPersona?: CortexPersona;
    }>
  > {
    // Map voices back to their default personas
    const personaReverseMap = new Map<CortexVoice, CortexPersona>();
    for (const [persona, voice] of Object.entries(PERSONA_VOICE_MAP) as [
      CortexPersona,
      CortexVoice,
    ][]) {
      personaReverseMap.set(voice, persona);
    }

    return VOICE_CATALOG.map((voice) => ({
      ...voice,
      defaultPersona: personaReverseMap.get(voice.id),
    }));
  }

  /**
   * Get voices recommended for a specific persona.
   *
   * @param persona The personality persona
   * @returns       Array of recommended voice metadata
   */
  async getVoicesForPersona(persona: CortexPersona): Promise<
    Array<{
      id: CortexVoice;
      name: string;
      description: string;
      isDefault: boolean;
    }>
  > {
    const defaultVoice = this.getVoiceForPersona(persona);

    // Recommend voices with similar tonal qualities
    const toneMatches: Record<CortexPersona, CortexVoice[]> = {
      jarvis: ['echo', 'fable', 'echo_hd'],
      friday: ['nova', 'coral', 'nova_hd'],
      jarvis_dark: ['ash', 'onyx', 'echo'],
      nova: ['coral', 'nova', 'shimmer', 'nova_hd'],
      titan: ['onyx', 'ash', 'echo_hd'],
      ghost: ['sage', 'echo', 'fable'],
      mentor: ['fable', 'echo', 'sage', 'echo_hd'],
      hustler: ['shimmer', 'nova', 'coral', 'nova_hd'],
    };

    const recommendedIds = toneMatches[persona] ?? ['echo'];

    return recommendedIds.map((id) => {
      const catalogEntry = VOICE_CATALOG.find((v) => v.id === id);
      return {
        id,
        name: catalogEntry?.name ?? id,
        description: catalogEntry?.description ?? '',
        isDefault: id === defaultVoice,
      };
    });
  }

  // ========================================================================
  // Voice Preview
  // ========================================================================

  /**
   * Generate a voice preview sample for a given voice and persona.
   * Uses a personality-appropriate preview phrase.
   *
   * @param voice   The voice to preview
   * @param persona The persona character to use for the sample text
   * @returns       Audio buffer with the preview
   */
  async generateVoicePreview(
    voice: CortexVoice,
    persona: CortexPersona,
  ): Promise<Buffer> {
    const previewText =
      VOICE_PREVIEW_PHRASES[persona] ??
      'Hello, I am your AI business partner. How can I help you today?';

    this.logger.debug(
      `Generating voice preview: voice="${voice}", persona="${persona}"`,
    );

    // Use a placeholder business ID for previews (not billed)
    return this.synthesize(
      {
        text: previewText,
        voice,
        persona,
        format: 'mp3',
        speed: 1.0,
      },
      'preview', // Special non-billed business ID for previews
    );
  }

  /**
   * Generate a voice preview and return structured metadata.
   *
   * @param voice   The voice to preview
   * @param persona The persona character
   * @returns       Preview with metadata
   */
  async generateVoicePreviewWithMetadata(
    voice: CortexVoice,
    persona: CortexPersona,
  ): Promise<{
    audioBuffer: Buffer;
    previewText: string;
    voice: CortexVoice;
    persona: CortexPersona;
    estimatedDuration: number;
  }> {
    const previewText =
      VOICE_PREVIEW_PHRASES[persona] ??
      'Hello, I am your AI business partner. How can I help you today?';

    const audioBuffer = await this.generateVoicePreview(voice, persona);
    const estimatedDuration = (previewText.length * 0.15) / 1.0;

    return {
      audioBuffer,
      previewText,
      voice,
      persona,
      estimatedDuration: Math.round(estimatedDuration * 100) / 100,
    };
  }

  // ========================================================================
  // Utility Methods
  // ========================================================================

  /**
   * Map MIME type to file extension for the Whisper API.
   *
   * @param mimeType The MIME type of the audio
   * @returns        File extension string
   */
  private mimeTypeToExtension(mimeType: string): string {
    const map: Record<string, string> = {
      'audio/webm': 'webm',
      'audio/webm;codecs=opus': 'webm',
      'audio/mp4': 'm4a',
      'audio/m4a': 'm4a',
      'audio/mp3': 'mp3',
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav',
      'audio/x-wav': 'wav',
      'audio/ogg': 'ogg',
      'audio/flac': 'flac',
      'audio/aac': 'aac',
      'audio/opus': 'opus',
    };

    return map[mimeType] ?? 'webm';
  }

  /**
   * Estimate audio duration from buffer size and MIME type.
   * Used for usage tracking metadata.
   *
   * @param byteLength Size of the audio buffer in bytes
   * @param mimeType   The MIME type of the audio
   * @returns          Estimated duration in seconds
   */
  private estimateAudioDuration(byteLength: number, mimeType: string): number {
    // Rough bitrate estimates for common formats
    const bitrates: Record<string, number> = {
      'audio/webm': 24000,
      'audio/webm;codecs=opus': 24000,
      'audio/mp4': 64000,
      'audio/m4a': 64000,
      'audio/mp3': 128000,
      'audio/mpeg': 128000,
      'audio/wav': 1411000,
      'audio/x-wav': 1411000,
      'audio/ogg': 96000,
      'audio/flac': 700000,
      'audio/aac': 64000,
      'audio/opus': 24000,
    };

    const bitrate = bitrates[mimeType] ?? 128000;
    return Math.round((byteLength * 8) / bitrate);
  }

  /**
   * Store audio temporarily and return a URL.
   * In production, this uploads to S3 or a CDN.
   *
   * @param audioBuffer The audio data
   * @param format      Audio file format extension
   * @returns           URL where the audio can be accessed
   */
  private async storeAudioTemporarily(
    audioBuffer: Buffer,
    format: string,
  ): Promise<string> {
    // TODO: Implement S3/CloudFront upload for production
    // For now, return a placeholder indicating the audio is available
    // In the controller layer, the buffer is served directly or via base64
    this.logger.debug(
      `Audio storage placeholder: ${audioBuffer.length} bytes (${format})`,
    );
    return `/api/v1/cortex/voice/audio/preview.${format}`;
  }
}
