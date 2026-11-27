/**
 * RR-SECURITY-SIGNAL-COUNTERS (P158; D-261, D-262) & RR-AUTHORITY-SHADOW-PARITY:
 * Bounded in-process runtime counters for security-relevant refusals & shadow mismatches:
 *   - bearer_verification_failed
 *   - cross_business_refusal
 *   - webhook_signature_failed
 *   - authority_shadow_mismatch
 *
 * Design invariants (matching ErrorRegistry):
 *   - Fixed label cardinality cap per signal (MAX_LABELS_PER_SIGNAL); excess labels roll into OVERFLOW_LABEL.
 *   - Fixed 24-hour rolling hourly bucket window (MAX_HOURLY_BUCKETS).
 *   - Never throws on any input (defensive try/catch + type guards).
 *   - Stores zero tenant IDs, user IDs, IPs, emails, headers, payloads, or tokens.
 *   - Strictly observational: never alters any allow/deny outcome.
 */

export type SecuritySignalType =
  | 'bearer_verification_failed'
  | 'cross_business_refusal'
  | 'webhook_signature_failed'
  | 'authority_shadow_mismatch';

export const SECURITY_SIGNAL_TYPES: readonly SecuritySignalType[] = [
  'bearer_verification_failed',
  'cross_business_refusal',
  'webhook_signature_failed',
  'authority_shadow_mismatch',
] as const;

export const MAX_LABELS_PER_SIGNAL = 64;
export const OVERFLOW_LABEL = '__other__';
export const MAX_HOURLY_BUCKETS = 24;

const HOUR_MS = 3_600_000;
const MAX_LABEL_LENGTH = 64;
const MAX_DATE_MS = 8_640_000_000_000_000;
const VALID_SIGNAL_SET: ReadonlySet<string> = new Set(SECURITY_SIGNAL_TYPES);
const FORBIDDEN_PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export type SecuritySignalCounts = Record<SecuritySignalType, number>;

export interface SecuritySignalHourlyBucket {
  hour: string;
  counts: SecuritySignalCounts;
}

export interface SecuritySignalsSnapshot {
  startedAt: string;
  counts: SecuritySignalCounts;
  byLabel: Record<SecuritySignalType, Record<string, number>>;
  hourly: SecuritySignalHourlyBucket[];
}

function emptyCounts(): SecuritySignalCounts {
  return {
    bearer_verification_failed: 0,
    cross_business_refusal: 0,
    webhook_signature_failed: 0,
    authority_shadow_mismatch: 0,
  };
}

function safeTimestampMs(nowMs: unknown): number {
  if (typeof nowMs === 'number' && Number.isFinite(nowMs) && Math.abs(nowMs) <= MAX_DATE_MS) {
    return nowMs;
  }
  return Date.now();
}

function normalizeLabel(raw: unknown): string {
  if (typeof raw !== 'string') return OVERFLOW_LABEL;
  const trimmed = raw.trim().slice(0, MAX_LABEL_LENGTH * 2).toLowerCase();
  if (!trimmed) return OVERFLOW_LABEL;
  const cleaned = trimmed
    .replace(/[^a-z0-9_.:-]/g, '_')
    .slice(0, MAX_LABEL_LENGTH);
  if (!cleaned || FORBIDDEN_PROTOTYPE_KEYS.has(cleaned)) {
    return OVERFLOW_LABEL;
  }
  return cleaned;
}

function floorHourMs(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

export class SecuritySignals {
  private startedAtIso: string;
  private totals: SecuritySignalCounts;
  private labelMaps: Record<SecuritySignalType, Map<string, number>>;
  private hourlyBuckets: Map<number, SecuritySignalCounts>;

  constructor(nowMs: number = Date.now()) {
    this.startedAtIso = new Date(safeTimestampMs(nowMs)).toISOString();
    this.totals = emptyCounts();
    this.labelMaps = {
      bearer_verification_failed: new Map<string, number>(),
      cross_business_refusal: new Map<string, number>(),
      webhook_signature_failed: new Map<string, number>(),
      authority_shadow_mismatch: new Map<string, number>(),
    };
    this.hourlyBuckets = new Map<number, SecuritySignalCounts>();
  }

  record(signal: SecuritySignalType, label: string, nowMs: number = Date.now()): void {
    try {
      if (typeof signal !== 'string' || !VALID_SIGNAL_SET.has(signal)) {
        return;
      }

      const safeLabel = normalizeLabel(label);
      const safeNow = safeTimestampMs(nowMs);
      const hourStart = floorHourMs(safeNow);

      this.totals[signal] += 1;

      const labels = this.labelMaps[signal];
      if (labels.has(safeLabel)) {
        labels.set(safeLabel, (labels.get(safeLabel) ?? 0) + 1);
      } else {
        // Reserve one slot for OVERFLOW_LABEL so total keys never exceed MAX_LABELS_PER_SIGNAL.
        const maxDistinctNamed = labels.has(OVERFLOW_LABEL)
          ? MAX_LABELS_PER_SIGNAL
          : MAX_LABELS_PER_SIGNAL - 1;
        if (safeLabel !== OVERFLOW_LABEL && labels.size < maxDistinctNamed) {
          labels.set(safeLabel, 1);
        } else {
          labels.set(OVERFLOW_LABEL, (labels.get(OVERFLOW_LABEL) ?? 0) + 1);
        }
      }

      let bucket = this.hourlyBuckets.get(hourStart);
      if (!bucket) {
        bucket = emptyCounts();
        this.hourlyBuckets.set(hourStart, bucket);
      }
      bucket[signal] += 1;

      // Enforce fixed bounded memory on hourly buckets by keeping at most MAX_HOURLY_BUCKETS newest hours.
      if (this.hourlyBuckets.size > MAX_HOURLY_BUCKETS) {
        const sortedHours = [...this.hourlyBuckets.keys()].sort((a, b) => a - b);
        const excess = sortedHours.length - MAX_HOURLY_BUCKETS;
        for (let i = 0; i < excess; i++) {
          this.hourlyBuckets.delete(sortedHours[i]);
        }
      }
    } catch {
      // SecuritySignals must never throw or disrupt auth/guard/webhook control flow.
    }
  }

  snapshot(nowMs: number = Date.now()): SecuritySignalsSnapshot {
    const safeNow = safeTimestampMs(nowMs);
    const currentHour = floorHourMs(safeNow);
    const oldestAllowed = currentHour - (MAX_HOURLY_BUCKETS - 1) * HOUR_MS;

    const byLabel: Record<SecuritySignalType, Record<string, number>> = {
      bearer_verification_failed: {},
      cross_business_refusal: {},
      webhook_signature_failed: {},
      authority_shadow_mismatch: {},
    };

    for (const signal of SECURITY_SIGNAL_TYPES) {
      const target = byLabel[signal];
      for (const [k, v] of this.labelMaps[signal].entries()) {
        if (!FORBIDDEN_PROTOTYPE_KEYS.has(k)) {
          target[k] = v;
        }
      }
    }

    const hourly: SecuritySignalHourlyBucket[] = [];
    const sortedHours = [...this.hourlyBuckets.keys()]
      .filter((h) => h >= oldestAllowed && h <= currentHour)
      .sort((a, b) => a - b);

    for (const h of sortedHours) {
      const b = this.hourlyBuckets.get(h);
      if (!b) continue;
      hourly.push({
        hour: new Date(h).toISOString(),
        counts: {
          bearer_verification_failed: b.bearer_verification_failed,
          cross_business_refusal: b.cross_business_refusal,
          webhook_signature_failed: b.webhook_signature_failed,
          authority_shadow_mismatch: b.authority_shadow_mismatch,
        },
      });
    }

    return {
      startedAt: this.startedAtIso,
      counts: {
        bearer_verification_failed: this.totals.bearer_verification_failed,
        cross_business_refusal: this.totals.cross_business_refusal,
        webhook_signature_failed: this.totals.webhook_signature_failed,
        authority_shadow_mismatch: this.totals.authority_shadow_mismatch,
      },
      byLabel,
      hourly,
    };
  }

  reset(nowMs: number = Date.now()): void {
    this.startedAtIso = new Date(safeTimestampMs(nowMs)).toISOString();
    this.totals = emptyCounts();
    for (const signal of SECURITY_SIGNAL_TYPES) {
      this.labelMaps[signal].clear();
    }
    this.hourlyBuckets.clear();
  }
}

export const securitySignals = new SecuritySignals();
