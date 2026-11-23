import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { deepRedact, safeRedactedSnapshot, SENSITIVE_FIELD_PATTERNS, SENSITIVE_VALUE_PATTERNS, redactAddresses, redactSensitiveText } from './redaction';

const R = '***REDACTED***';

describe('redaction — previous denylist gap (business-event interceptor)', () => {
  // The interceptor previously used exactly these keys with substring matching.
  const OLD_KEYS = ['password', 'token', 'secret', 'refreshToken', 'accessToken', 'apiKey'];
  const oldRedactMisses = (field: string) =>
    !OLD_KEYS.some((k) => field.toLowerCase().includes(k.toLowerCase()));

  it('documents that the old denylist missed credentials and privateKey', () => {
    // These are the concrete fields (SupplierConnection.credentials, private keys)
    // that the previous policy failed to redact — the reason for centralizing.
    expect(oldRedactMisses('credentials')).toBe(true);
    expect(oldRedactMisses('privateKey')).toBe(true);
    // ...while it did catch the token-family fields:
    expect(oldRedactMisses('gmailAccessToken')).toBe(false);
  });
});

describe('deepRedact — comprehensive sensitive-key policy', () => {
  it('redacts credentials and privateKey (the previous gaps)', () => {
    const out = deepRedact({ credentials: 'blob', privateKey: 'pk', apiKey: 'ak' });
    expect(out).toEqual({ credentials: R, privateKey: R, apiKey: R });
  });

  it('redacts the token family case-insensitively', () => {
    const out = deepRedact({ AccessToken: 'a', refresh_token: 'b', WebhookSecret: 'c', Password: 'd' });
    expect(out).toEqual({ AccessToken: R, refresh_token: R, WebhookSecret: R, Password: R });
  });

  it('redacts secrets nested inside objects', () => {
    const out = deepRedact({ config: { provider: 'plaid', accessToken: 'x', label: 'ok' } });
    expect(out).toEqual({ config: { provider: 'plaid', accessToken: R, label: 'ok' } });
  });

  it('redacts secrets inside arrays of objects', () => {
    const out = deepRedact({ connections: [{ id: '1', token: 'a' }, { id: '2', refreshToken: 'b' }] });
    expect(out).toEqual({ connections: [{ id: '1', token: R }, { id: '2', refreshToken: R }] });
  });

  it('redacts a relation-included Business record (14 OAuth token columns)', () => {
    const out = deepRedact({
      after: {
        id: 'biz1',
        name: 'Acme',
        business: {
          id: 'biz1',
          gmailAccessToken: 'x',
          calendarRefreshToken: 'y',
          bpAccessToken: 'z',
        },
      },
    }) as any;
    expect(out.after.name).toBe('Acme');
    expect(out.after.business.gmailAccessToken).toBe(R);
    expect(out.after.business.calendarRefreshToken).toBe(R);
    expect(out.after.business.bpAccessToken).toBe(R);
  });

  it('leaves non-sensitive fields untouched', () => {
    const input = { id: 'x', name: 'Bob', amount: 100, tags: ['a', 'b'], nested: { city: 'PoS' } };
    expect(deepRedact(structuredClone(input))).toEqual(input);
  });

  it('does not over-match ordinary key-like words', () => {
    const input = { monkey: 'ok', keyword: 'ok', publicKeyId: 'ok-not-secret' };
    // "publicKeyId" contains no sensitive pattern (no bare "key" pattern exists).
    expect(deepRedact(structuredClone(input))).toEqual(input);
  });

  it('policy does not include a bare "key" pattern (avoids false positives)', () => {
    expect((SENSITIVE_FIELD_PATTERNS as readonly string[]).includes('key')).toBe(false);
  });
});

describe('safeRedactedSnapshot', () => {
  it('returns undefined for non-object input', () => {
    expect(safeRedactedSnapshot(null)).toBeUndefined();
    expect(safeRedactedSnapshot('str')).toBeUndefined();
    expect(safeRedactedSnapshot(42)).toBeUndefined();
  });

  it('clones (does not mutate the original) and redacts', () => {
    const original = { accessToken: 'secret', name: 'keep' };
    const snap = safeRedactedSnapshot(original);
    expect(snap).toEqual({ accessToken: R, name: 'keep' });
    expect(original.accessToken).toBe('secret'); // original untouched
  });
});

/**
 * W4-HOUSEKEEPING (9B-D2: a sender's log line carries no recipient address).
 * SystemEmailService kept the address pattern in a private redactAddresses,
 * and W3-C2b-EMAIL-LOG-LEAK repeated it in TransactionalEmailService because
 * that file was outside its write set. Both senders now import the one helper
 * from this module. BEFORE_PATTERN is the literal both files carried before
 * the move: every input below redacts exactly as it did, and neither sender
 * keeps its own copy.
 */
describe('redactAddresses: the one address redactor both email senders log through (9B-D2, W4-HOUSEKEEPING)', () => {
  const BEFORE_PATTERN = /[^\s<>"'`(),;:[\]]+@[^\s<>"'`(),;:[\]]+/g;
  const CASES: Array<[string, string]> = [
    ['Resend rejected owner@example.test', 'Resend rejected <address>'],
    ['gmail 503 for owner@example.test', 'gmail 503 for <address>'],
    ['To: "Owner" <owner@example.test>, cc: second+tag@sub.example.test;', 'To: "Owner" <<address>>, cc: <address>;'],
    ['mailto:owner@example.test', 'mailto:<address>'],
    ["(owner@example.test) [team@example.test] 'a@b.example' `c@d.example`", "(<address>) [<address>] '<address>' `<address>`"],
    ['x@y@z', '<address>'],
    ['first@one.test\nsecond@two.test', '<address>\n<address>'],
    ['no address here', 'no address here'],
    ['@handle and user@ alone', '@handle and user@ alone'],
    ['V40A template stand-in has no invoice for owner@example.test', 'V40A template stand-in has no invoice for <address>'],
  ];

  it('9B-D2 W4-HOUSEKEEPING: every address-shaped token becomes <address>, and the rest of the text stays', () => {
    for (const [input, expected] of CASES) expect(redactAddresses(input), JSON.stringify(input)).toBe(expected);
  });

  it('9B-D2 W4-HOUSEKEEPING: the same inputs redact as under the pattern both senders carried before the move, call after call', () => {
    for (let round = 0; round < 2; round++) {
      for (const [input] of CASES) {
        expect(redactAddresses(input), JSON.stringify(input)).toBe(input.replace(BEFORE_PATTERN, '<address>'));
      }
    }
  });

  it('9B-D2 W4-HOUSEKEEPING: SystemEmailService and TransactionalEmailService both import it and keep no copy of the pattern', () => {
    const notifications = path.resolve(__dirname, '../../modules/notifications');
    for (const file of ['system-email.service.ts', 'transactional-email.service.ts']) {
      const src = readFileSync(path.join(notifications, file), 'utf8');
      expect(src, `${file} imports redactAddresses from core/security/redaction`).toMatch(
        /import\s*\{[^}]*\bredactAddresses\b[^}]*\}\s*from\s*'\.\.\/\.\.\/core\/security\/redaction'/,
      );
      expect(src.includes(BEFORE_PATTERN.source), `${file} carries no copy of the address pattern`).toBe(false);
      expect(src, `${file} defines no local redactAddresses`).not.toMatch(/function\s+redactAddresses\b/);
    }
  });
});

/**
 * RR-REDACTION-BY-CONTENT (D-261): redaction by VALUE. Secrets are built from parts at run time
 * so no scanner reads this file as a committed credential; none of them is a real key.
 */
describe('redactSensitiveText and deepRedact on string values (RR-REDACTION-BY-CONTENT)', () => {
  const pem = ['-----BEGIN RSA PRIVATE KEY-----', 'MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn', 'abc123==', '-----END RSA PRIVATE KEY-----'].join('\n');
  const jwt = ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ', 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'].join('.');
  const openaiKey = 'sk-' + 'proj' + '-' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4';
  const anthropicKey = 'sk-ant-' + 'api03-' + 'Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1Qq0';
  const slackToken = 'xoxb-' + '1234567890-' + '0987654321-' + 'AbCdEfGhIjKlMnOpQrStUvWx';
  const githubToken = 'ghp_' + 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
  const githubPat = 'github_pat_' + '11ABCDEFG0' + '_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF';
  const awsKeyId = 'AKIA' + 'IOSFODNN7EXAMPLE';

  describe('card numbers (Luhn-checked digit runs of 13 to 19 digits, spaces or dashes allowed)', () => {
    it('DoD RED: deepRedact({note: "card 4111 1111 1111 1111"}) yields note "card <card>"', () => {
      expect(deepRedact({ note: 'card 4111 1111 1111 1111' })).toEqual({ note: 'card <card>' });
    });

    it('dashed, unspaced, 15- and 19-digit forms, and several in one text', () => {
      expect(redactSensitiveText('4242-4242-4242-4242')).toBe('<card>');
      expect(redactSensitiveText('pan 5500000000000004 ok')).toBe('pan <card> ok');
      expect(redactSensitiveText('amex 378282246310005')).toBe('amex <card>'); // 15 digits
      expect(redactSensitiveText('long 6011000990139424 and 4111111111111111')).toBe('long <card> and <card>');
      expect(redactSensitiveText('4000 0566 5566 5556, then 4000056655665556')).toBe('<card>, then <card>');
    });

    it('negative controls: an invoice number, a phone, a 16-digit non-Luhn number, a 12-digit id, a UUID, a cuid and a 20-digit run are unchanged', () => {
      const untouched = [
        'INV-2026-000123',
        '+1 868 555 0123',
        '4111111111111112', // last digit changed: fails Luhn
        '1234 5678 9012 3456', // fails Luhn
        '123456789012',
        '3f2a9c7e-1b4d-4f6a-9e8b-0c1d2e3f4a5b',
        'clx3k2j9f0000abcd1234efgh',
        '41111111111111110000', // 20 digits: longer than any card
        'order 2026000123456789 shipped', // 16 digits inside a longer run? no: exactly 16 non-Luhn
        'amount 1,234,567.89 TTD',
      ];
      for (const text of untouched) expect(redactSensitiveText(text), text).toBe(text);
    });
  });

  describe('secret-shaped tokens', () => {
    it('DoD RED: {msg: "Authorization was Bearer abc.def.ghi"} redacts the token and keeps the words', () => {
      expect(deepRedact({ msg: 'Authorization was Bearer abc.def.ghi' })).toEqual({ msg: 'Authorization was Bearer <secret>' });
    });

    it('DoD RED: a PEM private-key block inside a value becomes <secret>', () => {
      expect(deepRedact({ cert: `key follows\n${pem}\nend` })).toEqual({ cert: 'key follows\n<secret>\nend' });
      expect(redactSensitiveText(pem.replace('RSA PRIVATE KEY', 'PRIVATE KEY'))).toBe('<secret>');
      expect(redactSensitiveText(pem.replace('RSA PRIVATE KEY', 'EC PRIVATE KEY').replace('RSA PRIVATE KEY', 'EC PRIVATE KEY'))).toBe('<secret>');
    });

    it('JWT, AWS access key id and provider key prefixes (sk-, sk-ant-, xoxb-, ghp_, github_pat_) followed by 20+ key characters', () => {
      expect(redactSensitiveText(`token=${jwt}`)).toBe('token=<secret>');
      expect(redactSensitiveText(`aws ${awsKeyId} region us-east-1`)).toBe('aws <secret> region us-east-1');
      expect(redactSensitiveText(`use key ${openaiKey} please`)).toBe('use key <secret> please');
      expect(redactSensitiveText(`anthropic ${anthropicKey}`)).toBe('anthropic <secret>');
      expect(redactSensitiveText(`slack ${slackToken}`)).toBe('slack <secret>');
      expect(redactSensitiveText(`gh ${githubToken} and ${githubPat}`)).toBe('gh <secret> and <secret>');
    });

    it('negative controls: a short sk- word, a public key block, "bearer" as a word, a UUID-ish token and ordinary prose are unchanged', () => {
      const untouched = [
        'sk-short',
        'the bearer of this note',
        'Bearer',
        '-----BEGIN PUBLIC KEY-----\nMIIBIjANBg\n-----END PUBLIC KEY-----',
        'AKIA is not a key by itself',
        'AKIAIOSFODNN7EXAMPL', // 15 after the prefix
        'eyJ alone is not a token',
        'ghp_short',
        'a sentence with numbers 2026 and words',
      ];
      for (const text of untouched) expect(redactSensitiveText(text), text).toBe(text);
    });
  });

  describe('deepRedact applies it to string leaves and keeps the field-name policy', () => {
    it('string values under non-sensitive keys, nested and inside arrays, are redacted by value; sensitive keys still get the marker', () => {
      const out = deepRedact({
        note: `pay with 4111 1111 1111 1111 or ${openaiKey}`,
        items: ['ok', 'Bearer abc.def.ghi', { memo: 'card 4242 4242 4242 4242' }],
        accessToken: 'keep-the-field-marker',
        amount: 4111111111111111,
        nested: { deeper: { text: `jwt ${jwt}` } },
      });
      expect(out).toEqual({
        note: 'pay with <card> or <secret>',
        items: ['ok', 'Bearer <secret>', { memo: 'card <card>' }],
        accessToken: R,
        amount: 4111111111111111, // numbers are not text: a numeric leaf is left alone (documented limit)
        nested: { deeper: { text: 'jwt <secret>' } },
      });
    });

    it('a top-level string is a string leaf too, and the result is idempotent', () => {
      expect(deepRedact('card 4111 1111 1111 1111')).toBe('card <card>');
      const once = redactSensitiveText(`x ${jwt} y 4111111111111111 z Bearer abc.def.ghi`);
      expect(redactSensitiveText(once)).toBe(once);
      expect(once).toBe('x <secret> y <card> z Bearer <secret>');
    });

    it('safeRedactedSnapshot inherits value redaction and still does not mutate its input', () => {
      const input = { after: { note: 'card 4111 1111 1111 1111', apiKey: 'k' } };
      const snap = safeRedactedSnapshot(input);
      expect(snap).toEqual({ after: { note: 'card <card>', apiKey: R } });
      expect(input.after.note).toBe('card 4111 1111 1111 1111');
    });

    it('the existing field-name cases are unchanged: non-sensitive plain values stay byte-identical', () => {
      const input = { id: 'x', name: 'Bob', amount: 100, tags: ['a', 'b'], nested: { city: 'PoS' }, email: 'bob@example.com', phone: '+1 868 555 0123' };
      expect(deepRedact(structuredClone(input))).toEqual(input);
    });
  });

  describe('the value patterns are a named, tested list', () => {
    it('every pattern has a name, a marker of <card> or <secret>, is global, and is exercised above', () => {
      expect(SENSITIVE_VALUE_PATTERNS.length).toBeGreaterThanOrEqual(5);
      const names = new Set<string>();
      for (const entry of SENSITIVE_VALUE_PATTERNS) {
        expect(typeof entry.name).toBe('string');
        expect(names.has(entry.name), `duplicate pattern name ${entry.name}`).toBe(false);
        names.add(entry.name);
        expect(['<card>', '<secret>']).toContain(entry.marker);
        expect(entry.pattern.global).toBe(true);
      }
      for (const expected of ['card', 'pem', 'bearer', 'jwt', 'aws', 'provider']) {
        expect([...names].some((n) => n.toLowerCase().includes(expected)), `a pattern named for ${expected}`).toBe(true);
      }
    });
  });
});
