import { Injectable, Logger } from '@nestjs/common';
import WebSocket from 'ws';

const REALTIME_URL = 'wss://api.openai.com/v1/realtime?model=gpt-realtime';

export interface RealtimeBridgeEvents {
  onAudioDelta: (base64Mulaw: string) => void;
  onTranscript: (role: 'user' | 'assistant', text: string) => void;
  onFunctionCall: (name: string, callId: string, argumentsJson: string) => Promise<unknown>;
  onError: (message: string) => void;
  onClose: () => void;
}

export interface RealtimeToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * One OpenAI Realtime session per phone call. Audio flows g711_ulaw both
 * ways (Twilio's native format — no transcoding), server-side VAD + barge-in
 * are handled by the model. Function calls are delegated back to KEY's tool
 * executor via onFunctionCall.
 */
@Injectable()
export class RealtimeBridgeService {
  private readonly logger = new Logger(RealtimeBridgeService.name);

  async openSession(opts: {
    instructions: string;
    tools: RealtimeToolDef[];
    events: RealtimeBridgeEvents;
  }): Promise<{ sendAudio: (base64Mulaw: string) => void; close: () => void } | null> {
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (!apiKey) {
      this.logger.error('Realtime bridge: AI_INTEGRATIONS_OPENAI_API_KEY is not set');
      return null;
    }

    const ws = new WebSocket(REALTIME_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    let open = false;

    ws.on('open', () => {
      open = true;
      // GA Realtime API shape (the beta flat shape is retired).
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          type: 'realtime',
          model: 'gpt-realtime',
          instructions: opts.instructions,
          audio: {
            input: {
              format: { type: 'audio/pcmu' },
              transcription: { model: 'whisper-1' },
              turn_detection: {
                type: 'server_vad',
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 500,
              },
            },
            output: {
              format: { type: 'audio/pcmu' },
              voice: 'alloy',
            },
          },
          tools: opts.tools.map((t) => ({
            type: 'function',
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
          tool_choice: 'auto',
        },
      }));
    });

    ws.on('message', async (raw: WebSocket.RawData) => {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        return;
      }
      const type = event.type as string;

      if (type === 'response.audio.delta' && typeof event.delta === 'string') {
        opts.events.onAudioDelta(event.delta);
      } else if (type === 'conversation.item.input_audio_transcription.completed') {
        opts.events.onTranscript('user', String(event.transcript ?? ''));
      } else if (type === 'response.audio_transcript.done') {
        opts.events.onTranscript('assistant', String(event.transcript ?? ''));
      } else if (type === 'response.function_call_arguments.done') {
        const name = String(event.name ?? '');
        const callId = String(event.call_id ?? '');
        const argsJson = String(event.arguments ?? '{}');
        try {
          const result = await opts.events.onFunctionCall(name, callId, argsJson);
          ws.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'function_call_output',
              call_id: callId,
              output: JSON.stringify(result ?? { ok: true }).slice(0, 4000),
            },
          }));
          ws.send(JSON.stringify({ type: 'response.create' }));
        } catch (err) {
          ws.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'function_call_output',
              call_id: callId,
              output: JSON.stringify({ error: (err as Error).message }),
            },
          }));
          ws.send(JSON.stringify({ type: 'response.create' }));
        }
      } else if (type === 'error') {
        opts.events.onError(JSON.stringify(event.error ?? event));
      }
    });

    ws.on('close', () => opts.events.onClose());
    ws.on('error', (err: Error) => {
      this.logger.warn(`Realtime WS error: ${err.message}`);
      opts.events.onError(err.message);
    });

    await new Promise<void>((resolve) => {
      if (open) return resolve();
      ws.once('open', () => resolve());
      ws.once('error', () => resolve());
    });

    if (!open) return null;

    return {
      sendAudio: (base64Mulaw: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: base64Mulaw }));
        }
      },
      close: () => {
        try { ws.close(); } catch { /* ignore */ }
      },
    };
  }
}
