import { describe, it, expect } from 'vitest';
import { timingSafeStringEqual } from './timing-safe-equal';

describe('timingSafeStringEqual', () => {
  it('returns true for equal strings', () => {
    expect(timingSafeStringEqual('abc123', 'abc123')).toBe(true);
  });

  it('returns false for different strings of equal length', () => {
    expect(timingSafeStringEqual('abc123', 'abc124')).toBe(false);
  });

  it('returns false (no throw) for different lengths', () => {
    expect(timingSafeStringEqual('abc', 'abcdef')).toBe(false);
    expect(timingSafeStringEqual('', 'x')).toBe(false);
  });

  it('handles empty strings', () => {
    expect(timingSafeStringEqual('', '')).toBe(true);
  });

  it('handles unicode without throwing', () => {
    expect(timingSafeStringEqual('café', 'café')).toBe(true);
    expect(timingSafeStringEqual('café', 'cafe')).toBe(false);
  });
});
