import { createHash } from 'node:crypto';
import type { ProviderEffectMaterial } from './adapters/channel-adapter.interface';

export const RESEND_IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function effectFingerprint(material: ProviderEffectMaterial): string {
  return createHash('sha256').update(canonicalJson(material)).digest('hex');
}

export function resendIdempotencyKey(effectId: string, fingerprint: string): string {
  if (!effectId || !fingerprint) {
    throw new Error('effectId and fingerprint are required');
  }
  const key = `keyflow/outbound-delivery/${effectId}/${fingerprint}`;
  if (key.length > 256) {
    return `keyflow/outbound-delivery/${createHash('sha256').update(effectId).digest('hex')}/${fingerprint}`;
  }
  return key;
}

export function isInsideResendIdempotencyWindow(
  firstAttemptAt: Date | string | null | undefined,
  now = new Date(),
): boolean {
  if (!firstAttemptAt) return false;
  const first = new Date(firstAttemptAt).getTime();
  if (!Number.isFinite(first)) return false;
  const age = now.getTime() - first;
  return age >= 0 && age < RESEND_IDEMPOTENCY_WINDOW_MS;
}
