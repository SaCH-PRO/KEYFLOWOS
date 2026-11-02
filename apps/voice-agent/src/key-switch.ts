/**
 * V1-24b review (SEC-V124b-2): the server-side KEY off switch, KEY_DISABLED
 * (D-17), as this worker reads it.
 *
 * With KEY_DISABLED set the server dispatches no KEY voice room
 * (LivekitService.createVoiceSession answers the KEY-disabled 503 before any
 * room, dispatch or token). This worker is a separate process with its own
 * environment (the repo-root .env it loads at start), so it reads the switch
 * too: while it is on, every dispatched job is rejected and the entry returns
 * before it joins a room, reads a business blueprint or opens an OpenAI
 * Realtime session.
 *
 * Parsed exactly as apps/server/src/core/config/env.ts keyDisabled() parses it:
 * '1' or 'true', any case, surrounding space ignored. The server's
 * livekit.service.spec.ts pins the two together value by value.
 */
export function keyDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.KEY_DISABLED;
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true';
}

export const KEY_DISABLED_JOB_NOTICE = 'KEY_DISABLED is set: KEY is switched off, so the KEY voice agent takes no job';

/** The part of a LiveKit JobRequest the filter uses. */
export interface JobRequestLike {
  accept(): Promise<void>;
  reject(): Promise<void>;
}

/**
 * The worker's job filter (WorkerOptions.requestFunc): rejects every dispatched
 * job while KEY is switched off, and otherwise accepts it, which is the agents
 * framework's own default.
 */
export async function screenJobRequest(req: JobRequestLike, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (keyDisabled(env)) {
    console.warn(`[voice-agent] ${KEY_DISABLED_JOB_NOTICE}: job rejected`);
    await req.reject();
    return;
  }
  await req.accept();
}
