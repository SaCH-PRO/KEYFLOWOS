import { BadRequestException } from '@nestjs/common';

const SCRIPT_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /javascript:/gi,
  /on\w+\s*=/gi,
];

const SQL_INJECTION_PATTERNS = [
  /(\b)(union\s+select|select\s+.*\s+from|drop\s+table|insert\s+into|delete\s+from|update\s+.*\s+set)\b/gi,
  /(--|\/\*|\*\/|;\s*--)/g,
];

export function sanitizeString(input: string | null | undefined, maxLength = 5000): string | null {
  return sanitize(input, maxLength);
}

export function sanitize(input: string | null | undefined, maxLength = 5000): string | null {
  if (input === null || input === undefined) return null;
  let value = String(input).replace(/<[^>]*>/g, '');
  for (const pat of SCRIPT_PATTERNS) value = value.replace(pat, '');
  for (const pat of SQL_INJECTION_PATTERNS) value = value.replace(pat, '');
  value = value.trim();
  if (value.length > maxLength) value = value.slice(0, maxLength);
  return value || null;
}

export function sanitizeRequired(input: string | null | undefined, fieldName: string, maxLength = 5000): string {
  const cleaned = sanitize(input, maxLength);
  if (!cleaned) {
    throw new BadRequestException(`${fieldName} is required`);
  }
  return cleaned;
}

export function sanitizeObject<T extends Record<string, unknown>>(obj: T, maxLength = 5000): T {
  if (!obj || typeof obj !== 'object') return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      out[k] = sanitize(v, maxLength);
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) => (typeof item === 'string' ? sanitize(item, maxLength) : item));
    } else if (v && typeof v === 'object') {
      out[k] = sanitizeObject(v as Record<string, unknown>, maxLength);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}
