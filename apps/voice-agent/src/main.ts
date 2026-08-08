/**
 * KEY voice agent worker.
 *
 * Registers with the LiveKit server under the agent name `key-voice-agent`
 * (the NestJS LivekitService dispatches every voice room to that name), joins
 * each dispatched room, and holds a full-duplex voice conversation as KEY —
 * the business's AI co-founder — through the OpenAI Realtime API.
 *
 * Run:  pnpm dev        (tsx, watches nothing — the agents CLI spawns workers)
 *       pnpm build && pnpm start
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

// Env: prefer the repo-root .env over any inherited shell/user env (a stale
// Windows user-level DATABASE_URL points at the wrong database).
dotenv.config({
  path: [path.resolve(process.cwd(), '../../.env'), path.resolve(__dirname, '../../../.env'), '.env'],
  override: true,
});

// The valid OpenAI key lives in .env as AI_INTEGRATIONS_OPENAI_API_KEY; a stale
// user-level OPENAI_API_KEY may exist in the shell env, so overwrite unconditionally.
if (process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
}

// @keyflow/db reads DATABASE_URL at import time — require it only after env is set.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { db } = require('@keyflow/db');

import { cli, defineAgent, JobContext, llm, voice, WorkerOptions } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import { z } from 'zod';

const AGENT_NAME = 'key-voice-agent';

interface RoomMeta {
  businessId?: string;
  userId?: string | null;
}

async function buildInstructions(businessId: string | undefined): Promise<{ instructions: string; businessName: string }> {
  let businessName = 'your business';
  let context = '';
  if (businessId) {
    try {
      const [business, blueprint] = await Promise.all([
        db.business.findUnique({ where: { id: businessId }, select: { name: true } }),
        db.businessBlueprint.findUnique({ where: { businessId } }),
      ]);
      const identity = (blueprint?.identity as Record<string, unknown>) ?? {};
      const brand = (blueprint?.brand as Record<string, unknown>) ?? {};
      const operating = (blueprint?.operatingModel as Record<string, unknown>) ?? {};
      businessName = (identity.name as string) ?? business?.name ?? businessName;
      const bits = [
        identity.industry ? `Industry: ${identity.industry}` : null,
        identity.missionStatement ? `Mission: ${identity.missionStatement}` : null,
        operating.revenueModel ? `Revenue model: ${operating.revenueModel}` : null,
        brand.voice || brand.tone ? `Brand voice/tone: ${[brand.voice, brand.tone].filter(Boolean).join(', ')}` : null,
      ].filter(Boolean);
      if (bits.length) context = `\nBusiness context:\n${bits.join('\n')}`;
    } catch (err) {
      console.warn('[voice-agent] blueprint load failed (continuing with defaults):', (err as Error).message);
    }
  }

  const instructions = `You are KEY, the AI co-founder of ${businessName}. You are speaking with the owner or a team member over a live voice call.
${context}

How to behave on voice:
- Keep spoken answers under 3 sentences unless the caller asks for detail.
- Be warm, direct, and competent — a co-founder, not a call-center script.
- Think out loud briefly when working on something ("Let me check that for you...").
- If the caller asks for a human, manager, or owner — or you genuinely cannot help — use the transfer_to_human tool, then reassure the caller that a human has been notified.
- Never read out IDs, URLs, or technical internals. Summarize in plain language.`;
  return { instructions, businessName };
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect();

    let meta: RoomMeta = {};
    try { meta = JSON.parse(ctx.room.metadata || '{}'); } catch { /* no metadata */ }
    const { instructions, businessName } = await buildInstructions(meta.businessId);

    const transferToHuman = llm.tool({
      description: 'Notify a human team member that this caller needs human help. Use when the caller asks for a human/manager/owner or when you cannot resolve their need.',
      parameters: z.object({
        reason: z.string().describe('Why the caller needs a human, in one sentence'),
      }),
      execute: async ({ reason }) => {
        if (meta.businessId) {
          try {
            await db.supportTicket.create({
              data: {
                businessId: meta.businessId,
                title: 'Voice call — human handoff requested',
                description: `KEY voice agent transferred a live voice call. Reason: ${reason}`,
                status: 'OPEN',
                priority: 'HIGH',
                source: 'VOICE',
              },
            });
          } catch (err) {
            console.error('[voice-agent] transfer ticket failed:', (err as Error).message);
          }
        }
        return 'A human team member has been notified and will follow up. Reassure the caller.';
      },
    });

    const session = new voice.AgentSession({
      llm: new openai.realtime.RealtimeModel({
        model: process.env.KEY_VOICE_REALTIME_MODEL ?? 'gpt-realtime',
        voice: process.env.KEY_VOICE_NAME ?? 'alloy',
      }),
    });

    session.on('agent_speech_committed' as never, (() => { /* speech committed — hook for future transcript persistence */ }) as never);

    await session.start({
      agent: new voice.Agent({ instructions, tools: { transfer_to_human: transferToHuman } }),
      room: ctx.room,
    });

    await session.generateReply({
      instructions: `Greet the caller briefly as KEY, co-founder of ${businessName}, and ask how you can help. One or two short sentences.`,
    });
  },
});

cli.runApp(
  new WorkerOptions({
    agent: __filename,
    agentName: AGENT_NAME,
    wsURL: process.env.LIVEKIT_WS_URL ?? 'ws://localhost:7880',
    apiKey: process.env.LIVEKIT_API_KEY,
    apiSecret: process.env.LIVEKIT_API_SECRET,
    // Windows: first-load of the native inference/rtc runtimes in the spawned
    // job process can take far longer than the default allowance.
    initializeProcessTimeout: 120_000,
  }),
);
