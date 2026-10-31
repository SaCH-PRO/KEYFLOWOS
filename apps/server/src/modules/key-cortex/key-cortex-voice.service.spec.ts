/**
 * R0-07a-AI-DIRECT-503 (COST-LEDGER-001 section 4 and section 7 item 1):
 * KEY voice calls OpenAI directly, not through the model gateway. With no
 * OpenAI key it used to build its client with the sentinel key 'sk-no-key', so
 * every synthesis or transcription went out to OpenAI and failed there with a
 * 401 that names nothing useful. With neither AI_INTEGRATIONS_OPENAI_API_KEY
 * nor OPENAI_API_KEY set, the service must build no client and refuse each
 * call with the gateway's 503 shape { code: 'provider_not_configured',
 * service: 'ai' } before any provider call or usage record. With a key (SDK
 * stubbed) nothing changes.
 *
 * The REAL OpenAI SDK constructor runs; only the resource methods are stubs,
 * and a client holding the sentinel key answers as OpenAI does (401), so no
 * request can leave the process.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const sdk = vi.hoisted(() => ({
  /** Every `new OpenAI(options)` attempted, before the real constructor runs. */
  attempts: [] as Array<{ apiKey?: string }>,
  /** Every provider call a client made, with the key it carried. */
  requests: [] as Array<{ resource: string; apiKey: string }>,
  speechCreate: vi.fn(),
  transcriptionsCreate: vi.fn(),
}));

vi.mock('openai', async (importOriginal) => {
  const actual: any = await importOriginal();
  const RealOpenAI = actual.default;
  class RecordingOpenAI extends RealOpenAI {
    constructor(options: any = {}) {
      sdk.attempts.push({ apiKey: options.apiKey });
      super(options);
      const self = this as any;
      const call = (resource: string, impl: (...args: any[]) => any) => (...args: any[]) => {
        sdk.requests.push({ resource, apiKey: self.apiKey });
        if (self.apiKey === 'sk-no-key') {
          // What OpenAI answers for the sentinel key.
          return Promise.reject(Object.assign(new Error('401 Incorrect API key provided: sk-no-key.'), { status: 401 }));
        }
        return impl(...args);
      };
      self.audio = {
        speech: { create: call('audio.speech', (...a) => sdk.speechCreate(...a)) },
        transcriptions: { create: call('audio.transcriptions', (...a) => sdk.transcriptionsCreate(...a)) },
      };
    }
  }
  return { ...actual, default: RecordingOpenAI, OpenAI: RecordingOpenAI };
});

import { KeyCortexVoiceService } from './key-cortex-voice.service';

const ENV_KEYS = ['AI_INTEGRATIONS_OPENAI_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL'];

describe('KeyCortexVoiceService fails visibly when no OpenAI key is configured (R0-07a)', () => {
  const saved: Record<string, string | undefined> = {};
  const aiUsage = { trackAudioUsage: vi.fn() };
  const personality = {};

  function build(): KeyCortexVoiceService {
    return new KeyCortexVoiceService(aiUsage as any, personality as any);
  }

  /** The structured 503 the model gateway answers when no AI provider is configured (R0-07). */
  async function expectNotConfigured(call: Promise<unknown>) {
    const err: any = await call.then(
      () => { throw new Error('expected the call to be refused'); },
      (e: unknown) => e,
    );
    expect(err, String(err?.stack ?? err)).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(503);
    expect(err.getResponse()).toMatchObject({ code: 'provider_not_configured', service: 'ai', error: 'Service Unavailable' });
    expect(typeof err.getResponse().message).toBe('string');
    expect(err.getResponse().message.length).toBeGreaterThan(0);
  }

  function expectNoProviderCallAndNoUsage() {
    expect(sdk.requests).toEqual([]);
    expect(sdk.speechCreate).not.toHaveBeenCalled();
    expect(sdk.transcriptionsCreate).not.toHaveBeenCalled();
    expect(aiUsage.trackAudioUsage).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    vi.resetAllMocks();
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    sdk.attempts.length = 0;
    sdk.requests.length = 0;
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  describe('with neither AI_INTEGRATIONS_OPENAI_API_KEY nor OPENAI_API_KEY set', () => {
    it('builds no OpenAI client, and none with the sentinel key sk-no-key', () => {
      build();
      expect(sdk.attempts).toEqual([]);
    });

    it('synthesize answers 503 {code: provider_not_configured, service: ai} before any provider call or usage record', async () => {
      const voice = build();
      await expectNotConfigured(voice.synthesize({ text: 'Hello there', persona: 'jarvis' }, 'biz-r07a'));
      expectNoProviderCallAndNoUsage();
    });

    it('transcribe answers 503 {code: provider_not_configured, service: ai} before any provider call or usage record', async () => {
      const voice = build();
      await expectNotConfigured(voice.transcribe({ audioBuffer: Buffer.from('r07a-audio'), mimeType: 'audio/webm' }, 'biz-r07a'));
      expectNoProviderCallAndNoUsage();
    });

    it('synthesizeWithMetadata, transcribeWithMetadata and generateVoicePreview answer the same 503', async () => {
      const voice = build();
      await expectNotConfigured(voice.synthesizeWithMetadata({ text: 'Hello', persona: 'friday' }, 'biz-r07a'));
      await expectNotConfigured(voice.transcribeWithMetadata({ audioBuffer: Buffer.from('r07a'), mimeType: 'audio/mpeg' }, 'biz-r07a'));
      await expectNotConfigured(voice.generateVoicePreview('nova', 'nova'));
      expectNoProviderCallAndNoUsage();
    });

    it('listing voices still works: the catalog is not a provider call', async () => {
      const voice = build();
      const voices = await voice.getAvailableVoices();
      expect(voices.map((v) => v.id)).toContain('echo');
      expect(sdk.requests).toEqual([]);
    });
  });

  describe('with a key configured (SDK stubbed): behaviour is unchanged', () => {
    it('AI_INTEGRATIONS_OPENAI_API_KEY: synthesize maps the persona to its voice, returns the audio and tracks tts usage', async () => {
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'r07a-test-not-a-real-key';
      sdk.speechCreate.mockResolvedValue({ arrayBuffer: async () => new Uint8Array([7, 8, 9]).buffer });
      const voice = build();

      const audio = await voice.synthesize({ text: 'At your service.', persona: 'jarvis', speed: 5 }, 'biz-r07a');

      expect(sdk.attempts).toEqual([{ apiKey: 'r07a-test-not-a-real-key' }]);
      expect([...audio]).toEqual([7, 8, 9]);
      expect(sdk.speechCreate).toHaveBeenCalledWith({
        model: 'tts-1',
        voice: 'echo',
        input: 'At your service.',
        response_format: 'mp3',
        speed: 2,
      });
      expect(aiUsage.trackAudioUsage).toHaveBeenCalledWith(expect.objectContaining({
        businessId: 'biz-r07a',
        type: 'audio_tts',
        model: 'tts-1',
        inputLength: 'At your service.'.length,
        outputLength: 3,
      }));
    });

    it('transcribe returns the text and tracks stt usage', async () => {
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'r07a-test-not-a-real-key';
      sdk.transcriptionsCreate.mockResolvedValue({ text: 'book a meeting tomorrow' });
      const voice = build();

      const text = await voice.transcribe({ audioBuffer: Buffer.from('r07a-audio'), mimeType: 'audio/webm', language: 'en' }, 'biz-r07a');

      expect(text).toBe('book a meeting tomorrow');
      expect(sdk.transcriptionsCreate).toHaveBeenCalledWith(expect.objectContaining({ model: 'whisper-1', language: 'en' }));
      expect(aiUsage.trackAudioUsage).toHaveBeenCalledWith(expect.objectContaining({ type: 'audio_stt', model: 'whisper-1' }));
    });

    it('OPENAI_API_KEY alone (the production container name) builds the client with that key', async () => {
      process.env.OPENAI_API_KEY = 'r07a-test-container-key';
      sdk.speechCreate.mockResolvedValue({ arrayBuffer: async () => new Uint8Array([1]).buffer });
      const voice = build();

      await voice.synthesize({ text: 'Hi' }, 'biz-r07a');
      expect(sdk.attempts).toEqual([{ apiKey: 'r07a-test-container-key' }]);
      expect(sdk.requests).toEqual([{ resource: 'audio.speech', apiKey: 'r07a-test-container-key' }]);
    });

    it('a configured provider that fails keeps its existing 503: "Voice synthesis unavailable: <provider error>", and tracks no usage', async () => {
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'r07a-test-not-a-real-key';
      sdk.speechCreate.mockRejectedValue(new Error('r07a: provider answered 500'));
      const voice = build();

      const err: any = await voice.synthesize({ text: 'Hi' }, 'biz-r07a').catch((e) => e);
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect(err.message).toBe('Voice synthesis unavailable: r07a: provider answered 500');
      expect((err.getResponse() as any).code).toBeUndefined();
      expect(aiUsage.trackAudioUsage).not.toHaveBeenCalled();
    });
  });

  it('no sentinel key remains in the service source', () => {
    const src = readFileSync(path.join(__dirname, 'key-cortex-voice.service.ts'), 'utf8');
    expect(src).not.toContain('sk-no-key');
  });
});
