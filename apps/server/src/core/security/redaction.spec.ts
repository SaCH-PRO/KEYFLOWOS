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

  describe('review round 1: a card next to short digit runs, separator variants, PEM cost and truncation, Bearer prose, 13-digit ids', () => {
    it('a card followed or preceded by a CVV, an expiry or a quantity is still redacted (the window is found inside the run)', () => {
      expect(redactSensitiveText('card 4111 1111 1111 1111 123')).toBe('card <card> 123');
      expect(redactSensitiveText('378282246310005 1234')).toBe('<card> 1234');
      expect(redactSensitiveText('4111 1111 1111 1111 1')).toBe('<card> 1');
      expect(redactSensitiveText('4111111111111111 12/26 123')).toBe('<card> 12/26 123');
      expect(redactSensitiveText('123 4111 1111 1111 1111')).toBe('123 <card>');
      expect(redactSensitiveText('qty 2 4111111111111111')).toBe('qty 2 <card>');
      expect(redactSensitiveText('4111111111111111-123')).toBe('<card>-123');
      expect(redactSensitiveText('4111 1111 1111 1111 1226')).toBe('<card> 1226');
      expect(redactSensitiveText('2026-11-23 4111 1111 1111 1111')).toBe('2026-11-23 <card>');
    });

    it('double spaces and a spaced dash between groups are separators; a 20-digit unbroken run is still not a card', () => {
      expect(redactSensitiveText('4111  1111  1111  1111')).toBe('<card>');
      expect(redactSensitiveText('4111 - 1111 - 1111 - 1111')).toBe('<card>');
      expect(redactSensitiveText('41111111111111110000')).toBe('41111111111111110000');
    });

    it('a 13-digit run is a card only when it starts with 4 (legacy Visa): a Luhn-valid epoch-millisecond id is untouched', () => {
      expect(redactSensitiveText('4222222222222')).toBe('<card>');
      // Find a Luhn-valid 13-digit millisecond timestamp near now and assert it stays (one in ten is Luhn-valid).
      const luhn = (digits: string) => {
        let sum = 0;
        let double = false;
        for (let i = digits.length - 1; i >= 0; i -= 1) {
          let d = digits.charCodeAt(i) - 48;
          if (double) { d *= 2; if (d > 9) d -= 9; }
          sum += d;
          double = !double;
        }
        return sum % 10 === 0;
      };
      let ms = 1795406180020;
      while (!luhn(String(ms))) ms += 1;
      expect(String(ms)).toHaveLength(13);
      expect(redactSensitiveText(`invoiceNumber: AI-${ms}`)).toBe(`invoiceNumber: AI-${ms}`);
    });

    it('an E.164 number is never a card: a + before the digits refuses the candidate', () => {
      expect(redactSensitiveText('+493012345678907')).toBe('+493012345678907'); // 15 digits, Luhn-valid
      expect(redactSensitiveText('+1234567890128')).toBe('+1234567890128');
    });

    it('a truncated PEM block (no END) is redacted to the end of the text, and many BEGIN headers cost linear time', () => {
      const truncated = ['err: -----BEGIN RSA PRIVATE KEY-----', 'MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn', 'abc'].join('\n');
      expect(redactSensitiveText(truncated)).toBe('err: <secret>');
      const header = '-----BEGIN PRIVATE KEY-----\n';
      const many = header.repeat(Math.ceil(200_000 / header.length));
      const start = performance.now();
      const out = redactSensitiveText(many);
      const elapsed = performance.now() - start;
      expect(out).toBe('<secret>');
      expect(elapsed, `200 kB of BEGIN headers took ${elapsed.toFixed(0)} ms`).toBeLessThan(500);
    });

    it('the PEM block goes first: a key body that holds a card-shaped digit run is one <secret>, not <secret> around a <card>', () => {
      const body = ['-----BEGIN PRIVATE KEY-----', 'MIIE4111111111111111owIBAAKCAQEA', '-----END PRIVATE KEY-----'].join('\n');
      expect(redactSensitiveText(body)).toBe('<secret>');
    });

    it('Bearer: the token must look like a credential (a digit or a dot, dash, slash, plus, equals, tilde or underscore, or 20+ letters); prose after "bearer" stays', () => {
      expect(redactSensitiveText('the bearer presented a letter')).toBe('the bearer presented a letter');
      expect(redactSensitiveText('bearer instruments and bearer certificates')).toBe('bearer instruments and bearer certificates');
      expect(redactSensitiveText('bearer abc.def.ghi')).toBe('bearer <secret>');
      expect(redactSensitiveText('Bearer ' + 'abcdefghijklmnopqrstuvwxyz')).toBe('Bearer <secret>');
      expect(redactSensitiveText('Bearer secret1')).toBe('Bearer secret1'); // 7 characters: under the floor
      expect(redactSensitiveText('Authorization: Bearer: abcdefghijklmnop1')).toBe('Authorization: Bearer: <secret>');
    });

    it('a JWT with an empty or short signature (alg none) is still a JWT', () => {
      const unsigned = ['eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', ''].join('.');
      expect(redactSensitiveText(`t=${unsigned} end`)).toBe('t=<secret> end');
      expect(redactSensitiveText(`t=${['eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'abc'].join('.')}`)).toBe('t=<secret>');
    });

    it('the patterns are read-only objects: a consumer cannot replace one, and calling .test on them is not how they are meant to be used', () => {
      const card = SENSITIVE_VALUE_PATTERNS.find((e) => e.name.includes('card'))!;
      // Checked before any write is attempted, so a failing run cannot mutate the policy for later cases.
      expect(Object.isFrozen(card)).toBe(true);
      expect(Object.isFrozen(SENSITIVE_VALUE_PATTERNS)).toBe(true);
      expect(() => { (card as { marker: string }).marker = '<x>'; }).toThrow();
      expect(() => { (SENSITIVE_VALUE_PATTERNS as unknown as unknown[]).push({}); }).toThrow();
    });
  });

  describe('review round 2: every Luhn-valid window in a run is redacted, Bearer prose before a period, longest-first', () => {
    it('a digit group before a card never leaves the card\'s tail visible: the union of valid windows is redacted', () => {
      expect(redactSensitiveText('tel 1000000006 4111 1111 1111 1111')).toBe('tel <card>');
      expect(redactSensitiveText('order 10000000 4111 1111 1111 1111')).toBe('order <card>');
      expect(redactSensitiveText('868 200 0000 4111 1111 1111 1111')).toMatch(/^868 200 (?:0000 )?<card>$/);
      expect(redactSensitiveText('868 348 1676 3782 822463 10005')).toMatch(/^868 348 (?:1676 )?<card>$/);
      expect(redactSensitiveText('2026-11-29 4111 1111 1111 1111')).toBe('2026-11-29 <card>');
      expect(redactSensitiveText('2026-11-26 4111 1111 1111 1111')).toBe('2026-11-26 <card>');
      expect(redactSensitiveText('2026-01-01 5555 5555 5555 4444')).toBe('2026-01-01 <card>');
    });

    it('a window is card-shaped: in a multi-group window every group has 3+ digits and the first 4+, so dates and phones do not join it', () => {
      expect(redactSensitiveText('qty 14 4111 1111 1111 1111')).toBe('qty 14 <card>');
      expect(redactSensitiveText('ref 42 4111 1111 1111 1111 and 5500 0000 0000 0004 x')).toBe('ref 42 <card> and <card> x');
      // Date ranges and phones next to each other, no card: untouched, every one of them.
      const notes = [
        '2026-02-04 - 2026-06-12 868 237 7919',
        '2026-05-13 - 2026-09-17 868 348 1676',
        '2026-11-23 09:30 call 868 555 0123 or 868 555 9876',
        'INV-2026-000123 paid 4500.00 on 2026-11-23 by 868 555 0123',
        'orders 10001 10002 10003 10004',
        'total 1 250 000 00 TTD',
      ];
      for (const note of notes) expect(redactSensitiveText(note), note).toBe(note);
      // Amex 4-6-5 and 19-digit 4-4-4-4-3 shapes are still cards.
      expect(redactSensitiveText('3782 822463 10005')).toBe('<card>');
      expect(redactSensitiveText('6011 0009 9013 9000 007')).toBe('<card>');
    });

    it('property: for every date of 2026 before a card, and every 3-3-4 phone before a card, the card is gone whole and the lead stays', () => {
      const cards = ['4111 1111 1111 1111', '5555 5555 5555 4444', '3782 822463 10005', '6011 0009 9013 9424', '4000 0566 5566 5556'];
      for (let month = 1; month <= 12; month += 1) {
        for (let day = 1; day <= 28; day += 1) {
          const date = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          for (const card of cards) expect(redactSensitiveText(`${date} ${card}`), `${date} ${card}`).toBe(`${date} <card>`);
        }
      }
      for (let n = 0; n < 300; n += 1) {
        const phone = `868 ${String(200 + n).padStart(3, '0')} ${String((n * 37) % 10000).padStart(4, '0')}`;
        for (const card of cards) {
          const out = redactSensitiveText(`${phone} ${card}`);
          expect(out.endsWith('<card>'), `${phone} ${card} -> ${out}`).toBe(true);
          expect(out.includes(card.slice(0, 9)), `${phone} ${card} -> ${out}`).toBe(false);
          expect(out.startsWith('868 '), `${phone} ${card} -> ${out}`).toBe(true);
        }
      }
    });

    it('tab and no-break space are separators too; a line break, a dot or a slash is not (documented as not covered)', () => {
      expect(redactSensitiveText('4111\t1111\t1111\t1111')).toBe('<card>');
      expect(redactSensitiveText('4111\u00a01111\u00a01111\u00a01111')).toBe('<card>');
      expect(redactSensitiveText('4111.1111.1111.1111')).toBe('4111.1111.1111.1111');
    });

    it('a 19-digit window whose 16-digit prefix is also Luhn-valid is redacted whole (longest first)', () => {
      expect(redactSensitiveText('4111 1111 1111 1111 003')).toBe('<card>');
    });

    it('a word after "bearer" that ends a sentence is prose: a lone trailing period is not a credential signal', () => {
      expect(redactSensitiveText('the bearer payment. x')).toBe('the bearer payment. x');
      expect(redactSensitiveText('bearer certificates. Also')).toBe('bearer certificates. Also');
      expect(redactSensitiveText('Bearer abc.def.ghi.')).toBe('Bearer <secret>.');
    });
  });

  describe('review round 3: generic 4-digit masks with a short tail, Unicode separators, adjacency', () => {
    const withCheckDigit = (base: string) => {
      for (let d = 0; d <= 9; d += 1) {
        const candidate = `${base}${d}`;
        let sum = 0;
        let double = true;
        for (let i = candidate.length - 2; i >= 0; i -= 1) {
          let x = candidate.charCodeAt(i) - 48;
          if (double) { x *= 2; if (x > 9) x -= 9; }
          sum += x;
          double = !double;
        }
        if ((sum + d) % 10 === 0) return candidate;
      }
      throw new Error('unreachable');
    };

    it('a card typed under a generic #### mask whose last group has 1 or 2 digits is still a card (4-4-4-1, 4-4-4-2, 4-4-4-4-1, 4-4-4-4-2)', () => {
      expect(redactSensitiveText('diners 3056 9309 0259 04')).toBe('diners <card>'); // 14 digits
      expect(redactSensitiveText('visa 4222 2222 2222 2')).toBe('visa <card>'); // 13 digits, starts with 4
      const maestro18 = withCheckDigit('67596498264384531'); // 18 digits
      expect(redactSensitiveText(`${maestro18.slice(0, 4)} ${maestro18.slice(4, 8)} ${maestro18.slice(8, 12)} ${maestro18.slice(12, 16)} ${maestro18.slice(16)}`)).toBe('<card>');
      const seventeen = withCheckDigit('6759649826438453'); // 17 digits
      expect(redactSensitiveText(`${seventeen.slice(0, 4)} ${seventeen.slice(4, 8)} ${seventeen.slice(8, 12)} ${seventeen.slice(12, 16)} ${seventeen.slice(16)}`)).toBe('<card>');
      // The short tail is accepted only after groups of exactly four: a 4-3-3-3-1 shape is not a card mask.
      expect(redactSensitiveText('4111 111 111 111 1')).toBe('4111 111 111 111 1');
      // Dates and phones still do not join: the round-2 corpus shapes stay untouched.
      expect(redactSensitiveText('2026-02-04 - 2026-06-12 868 237 7919')).toBe('2026-02-04 - 2026-06-12 868 237 7919');
      expect(redactSensitiveText('qty 14 4111 1111 1111 1111')).toBe('qty 14 <card>');
    });

    it('thin space, narrow no-break space and an en dash separate groups too', () => {
      expect(redactSensitiveText('4111\u20091111\u20091111\u20091111')).toBe('<card>');
      expect(redactSensitiveText('4111\u202f1111\u202f1111\u202f1111')).toBe('<card>');
      expect(redactSensitiveText('4111\u20131111\u20131111\u20131111')).toBe('<card>');
    });

    it('pins: two adjacent cards merge into one marker; a card directly after a plus sign is not covered (E.164 rule)', () => {
      expect(redactSensitiveText('4111 1111 1111 1111 5500 0000 0000 0004')).toBe('<card>');
      expect(redactSensitiveText('4111 1111 1111 1111, 5500 0000 0000 0004')).toBe('<card>, <card>');
      expect(redactSensitiveText('+4111 1111 1111 1111')).toBe('+4111 1111 1111 1111');
    });
  });

  describe('orchestrator acceptance round (A1, A2, B1, owner question 1): cost bound per pattern, anchors, zero-width separators, key shape, id keys', () => {
    const budgetMs = 500; // generous for a loaded machine: the defect measured 12 s at 200 kB

    it('A1: every pattern is linear: 200,000 characters of its worst input redact in well under a second', () => {
      const worst: Array<[string, string]> = [
        ['jwt: eyJ- repeats', 'eyJ-'.repeat(50_000)],
        ['jwt: eyJ runs with dots', 'eyJaaaaaaa.'.repeat(18_182)],
        ['bearer: Bearer repeats', 'Bearer '.repeat(28_572)],
        ['bearer: Bearer + 19 letters', 'Bearer aaaaaaaaaaaaaaaaaaa '.repeat(7_408)],
        ['aws: AKIA repeats', 'AKIA'.repeat(50_000)],
        ['provider: sk- repeats', 'sk-'.repeat(66_667)],
        ['provider: sk-a- repeats', 'sk-a-'.repeat(40_000)],
        ['provider: ghp_ repeats', 'ghp_'.repeat(50_000)],
        ['pem: BEGIN headers without END', '-----BEGIN PRIVATE KEY-----\n'.repeat(7_143)],
        ['card: single digits and spaces', '1 '.repeat(100_000)],
        ['card: 12 - groups', '12 - '.repeat(40_000)],
        ['card: spaced cards', '4111 1111 1111 1111 '.repeat(10_000)],
        ['card: zero-width joined digits', '4111​1111​1111​1111 '.repeat(9_090)],
        ['prose', 'the quick brown fox jumps over 13 lazy dogs on 2026-11-23 at 09:30, invoice INV-2026-000123. '.repeat(2_151)],
      ];
      for (const [label, text] of worst) {
        const start = performance.now();
        redactSensitiveText(text);
        const elapsed = performance.now() - start;
        expect(elapsed, `${label}: ${elapsed.toFixed(0)} ms for ${text.length} chars`).toBeLessThan(budgetMs);
      }
    });

    it('A2: a key prefix after an underscore or in upper case is still a key; a JWT after a dash or underscore is not (the anchor that keeps the scan linear)', () => {
      expect(redactSensitiveText('x_ghp_' + 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789')).toBe('x_<secret>');
      expect(redactSensitiveText('SK-' + 'proj' + '-' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4')).toBe('<secret>');
      expect(redactSensitiveText('Sk-Ant-' + 'api03-' + 'Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1Qq0')).toBe('<secret>');
      expect(redactSensitiveText('GHP_' + 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789')).toBe('<secret>');
      const jwt = ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ', 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'].join('.');
      expect(redactSensitiveText(`token=${jwt}`)).toBe('token=<secret>');
      expect(redactSensitiveText(`token ${jwt}.`)).toBe('token <secret>.');
      // Documented limit: a JWT glued to a letter, digit, dash or underscore is not a token boundary.
      expect(redactSensitiveText(`token-${jwt}`)).toBe(`token-${jwt}`);
    });

    it('A2: zero-width characters between digit groups do not hide a card; where nothing matches, the text is returned as it was', () => {
      for (const zw of ['​', '‌', '‍', '⁠']) {
        expect(redactSensitiveText(`card 4111${zw}1111${zw}1111${zw}1111 ok`), JSON.stringify(zw)).toBe('card <card> ok');
        expect(redactSensitiveText(`4111 1111${zw} 1111 1111`), JSON.stringify(zw)).toBe('<card>');
      }
      const untouched = 'note​with​zero​width joiners and 4111 1111 1111 1112';
      expect(redactSensitiveText(untouched)).toBe(untouched);
    });

    it('B1: sk- needs a real key shape (a run of 20+ key characters without a dash): a product slug is not a secret', () => {
      expect(redactSensitiveText('sk-classic-fit-cotton-shirt-blue')).toBe('sk-classic-fit-cotton-shirt-blue');
      expect(redactSensitiveText('sku sk-2026-11-23-red-large-x-y-z-w')).toBe('sku sk-2026-11-23-red-large-x-y-z-w');
      expect(redactSensitiveText('sk-' + 'proj' + '-' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4')).toBe('<secret>');
      expect(redactSensitiveText('xoxb-' + '1234567890-' + '0987654321-' + 'AbCdEfGhIjKlMnOpQrStUvWx')).toBe('<secret>');
      expect(redactSensitiveText('github_pat_' + '11ABCDEFG0' + '_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF')).toBe('<secret>');
    });

    it('owner question 1 default: a field whose key ends in Id or _id is an identifier, not a card; secrets in it are still redacted', () => {
      const out = deepRedact({
        externalPostId: '4111111111111111',
        platform_id: '5500 0000 0000 0004',
        id: '378282246310005',
        contactId: 'key ' + 'sk-' + 'proj' + '-' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4',
        note: 'card 4111111111111111',
        bid: '4111111111111111',
        ids: ['4111111111111111'],
      });
      expect(out).toEqual({
        externalPostId: '4111111111111111',
        platform_id: '5500 0000 0000 0004',
        id: '378282246310005',
        contactId: 'key <secret>',
        note: 'card <card>',
        bid: '<card>', // "bid" does not end in the id suffix
        ids: ['<card>'], // "ids" is not an id key either
      });
    });
  });

  describe('repair round 2: real key bodies with dashes, AWS anchor, key tail, more invisible characters', () => {
    const body = (n: number, seed: number) => {
      // Deterministic base64url-like body of n characters with a dash every 15th character (no secret is real).
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_';
      let out = '';
      for (let i = 0; i < n; i += 1) out += (i + 1) % 15 === 0 ? '-' : alphabet[(seed * 7 + i * 13) % alphabet.length];
      return out;
    };

    it('F1: an Anthropic or OpenAI key whose body starts with or contains dashes is still a key (never-slug prefixes keep the plain 20+ rule)', () => {
      expect(redactSensitiveText('k ' + 'sk-ant-' + 'api03--v-F1JiMIvoSLnY0WGT_FF-jNkDITQdPVeQzOFPqmnGSIh0Ah6VeIyXUYxmOnHCY5iSG2LECqCRropTUbQC1Fw6l-EzDzME')).toBe('k <secret>');
      expect(redactSensitiveText('k ' + 'sk-ant-api03-' + body(95, 3))).toBe('k <secret>');
      expect(redactSensitiveText('k ' + 'sk-proj-' + body(156, 5))).toBe('k <secret>');
      expect(redactSensitiveText('k ' + 'sk-proj-' + '-' + body(60, 9))).toBe('k <secret>');
      expect(redactSensitiveText('k ' + 'xoxb-1-2-3-4-5-' + 'AbCdEfGhIjKlMnOpQrStUvWx')).toBe('k <secret>');
      // Bare sk- keeps the slug-proof shape: a product slug stays, a legacy key is redacted, an empty segment is allowed.
      expect(redactSensitiveText('sk-classic-fit-cotton-shirt-blue')).toBe('sk-classic-fit-cotton-shirt-blue');
      expect(redactSensitiveText('sk-' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4P5q6')).toBe('<secret>');
      expect(redactSensitiveText('sk-' + '-' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4P5q6')).toBe('<secret>');
    });

    it('F2: the AWS key id is anchored on letters and digits, not word boundaries: x_AKIA... is a key, 17 characters are not', () => {
      expect(redactSensitiveText('x_' + 'AKIA' + 'IOSFODNN7EXAMPLE')).toBe('x_<secret>');
      expect(redactSensitiveText('AKIA' + 'IOSFODNN7EXAMPLE' + 'X')).toBe('AKIA' + 'IOSFODNN7EXAMPLE' + 'X');
      expect(redactSensitiveText('AKIA' + 'IOSFODNN7EXAMPLE' + '_x')).toBe('<secret>_x');
    });

    it('F3: the key tail is part of the key: a dashed continuation after the 20-run is redacted with it', () => {
      expect(redactSensitiveText('sk-' + 'A'.repeat(20) + '-' + 'B'.repeat(10))).toBe('<secret>');
      expect(redactSensitiveText('ghp_' + 'A'.repeat(36) + '-tail')).toBe('<secret>');
    });

    it('F4: soft hyphen and the directional marks between digit groups do not hide a card either', () => {
      for (const inv of ['­', '‎', '‏']) {
        expect(redactSensitiveText(`card 4111${inv}1111${inv}1111${inv}1111 ok`), JSON.stringify(inv)).toBe('card <card> ok');
      }
      const plain = 'soft­hyphen‎only, no secret 4111 1111 1111 1112';
      expect(redactSensitiveText(plain)).toBe(plain);
    });
  });

  describe('the value patterns are a named, tested list', () => {
    it('every pattern has a name, a marker of <card> or <secret>, is global, and is exercised above; the list is frozen', () => {
      expect(SENSITIVE_VALUE_PATTERNS.length).toBeGreaterThanOrEqual(5);
      expect(Object.isFrozen(SENSITIVE_VALUE_PATTERNS)).toBe(true);
      const names = new Set<string>();
      for (const entry of SENSITIVE_VALUE_PATTERNS) {
        expect(Object.isFrozen(entry)).toBe(true);
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
