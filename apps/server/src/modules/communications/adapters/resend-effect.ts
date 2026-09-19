import { createHash } from 'node:crypto';
import { PublishPayload } from './channel-adapter.interface';

export interface ResendEffectSnapshot {
  version: 1;
  provider: 'RESEND';
  businessId: string;
  destinationId: string;
  connectionId: string;
  to: string;
  from: string;
  subject: string;
  html: string;
  text?: string;
}

export function renderResendHtml(payload: PublishPayload): string {
  if (payload.htmlBody) return payload.htmlBody;
  return `<pre style="font:inherit;white-space:pre-wrap">${escapeHtml(payload.textBody ?? '')}</pre>`;
}

export function buildResendEffectSnapshot(args: {
  businessId: string;
  destinationId: string;
  connectionId: string;
  from: string;
  payload: PublishPayload;
  fallbackRecipient?: string | null;
}): ResendEffectSnapshot {
  const to = args.payload.recipientEmail ?? args.fallbackRecipient ?? '';
  if (!to) throw new Error('Cannot bind Resend effect without recipient');
  if (!args.from) throw new Error('Cannot bind Resend effect without sender identity');

  return {
    version: 1,
    provider: 'RESEND',
    businessId: args.businessId,
    destinationId: args.destinationId,
    connectionId: args.connectionId,
    to,
    from: args.from,
    subject: args.payload.subject ?? '(no subject)',
    html: renderResendHtml(args.payload),
    ...(args.payload.textBody !== undefined ? { text: args.payload.textBody } : {}),
  };
}

export function parseResendEffectSnapshot(value: unknown): ResendEffectSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Resend effect snapshot');
  }
  const v = value as Record<string, unknown>;
  const required = ['businessId', 'destinationId', 'connectionId', 'to', 'from', 'subject', 'html'];
  if (v.version !== 1 || v.provider !== 'RESEND' || required.some((key) => typeof v[key] !== 'string' || !(v[key] as string))) {
    throw new Error('Invalid Resend effect snapshot');
  }
  if (v.text !== undefined && typeof v.text !== 'string') {
    throw new Error('Invalid Resend effect snapshot');
  }
  return v as unknown as ResendEffectSnapshot;
}

export function fingerprintResendEffect(snapshot: ResendEffectSnapshot): string {
  const canonical = JSON.stringify({
    version: snapshot.version,
    provider: snapshot.provider,
    businessId: snapshot.businessId,
    destinationId: snapshot.destinationId,
    connectionId: snapshot.connectionId,
    to: snapshot.to,
    from: snapshot.from,
    subject: snapshot.subject,
    html: snapshot.html,
    text: snapshot.text ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function resendProviderIdempotencyKey(effectId: string, fingerprint: string): string {
  return `keyflow/resend/${effectId}/${fingerprint.slice(0, 40)}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
