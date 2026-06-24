import { describe, expect, it } from 'vitest';
import { assertNoDevAuthBypass } from './env';

describe('assertNoDevAuthBypass', () => {
  it('does nothing when the variable is unset', () => {
    expect(() =>
      assertNoDevAuthBypass({ KEYFLOW_DEV_AUTH_BYPASS: undefined } as unknown as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it('does nothing when the variable is "false"', () => {
    expect(() => assertNoDevAuthBypass({ KEYFLOW_DEV_AUTH_BYPASS: 'false' } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('throws when the variable is "true"', () => {
    expect(() => assertNoDevAuthBypass({ KEYFLOW_DEV_AUTH_BYPASS: 'true' } as NodeJS.ProcessEnv)).toThrow(
      /KEYFLOW_DEV_AUTH_BYPASS/,
    );
  });

  it('throws when the variable is "1"', () => {
    expect(() => assertNoDevAuthBypass({ KEYFLOW_DEV_AUTH_BYPASS: '1' } as NodeJS.ProcessEnv)).toThrow(
      /KEYFLOW_DEV_AUTH_BYPASS/,
    );
  });
});
