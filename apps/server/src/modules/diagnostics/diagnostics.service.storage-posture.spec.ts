import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * RR-OBJECT-STORAGE-POSTURE-CHECK: the diagnostics object-storage check reports
 * whether the bucket is public and whether default encryption is on, with
 * read-only calls only (GetPublicAccessBlock, GetBucketPolicyStatus,
 * GetBucketEncryption after the existing HeadBucket). No object is written or
 * read. A provider that does not implement a call gets a 'warn' naming it, so
 * the owner verifies in the provider console. HeadBucket failing keeps today's
 * answer.
 *
 * The SDK is mocked at the module boundary: the service imports
 * '@aws-sdk/client-s3' dynamically, and vi.mock covers that import. Every
 * command the service sends is recorded, so the "no PutObject/GetObject/
 * DeleteObject" rule is asserted, not assumed. No test reaches a network.
 */

type Handler = (input: Record<string, unknown>) => unknown | Promise<unknown>;
const sent: string[] = [];
const handlers: Record<string, Handler> = {};

vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  class HeadBucketCommand extends Command {}
  class GetPublicAccessBlockCommand extends Command {}
  class GetBucketPolicyStatusCommand extends Command {}
  class GetBucketEncryptionCommand extends Command {}
  class PutObjectCommand extends Command {}
  class GetObjectCommand extends Command {}
  class DeleteObjectCommand extends Command {}
  class S3Client {
    constructor(public readonly config: Record<string, unknown>) {}
    async send(cmd: Command) {
      const name = cmd.constructor.name;
      sent.push(name);
      const handler = handlers[name];
      if (!handler) throw Object.assign(new Error(`unexpected ${name}`), { name: 'UnexpectedCommand' });
      return handler(cmd.input);
    }
  }
  return {
    S3Client,
    HeadBucketCommand,
    GetPublicAccessBlockCommand,
    GetBucketPolicyStatusCommand,
    GetBucketEncryptionCommand,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
  };
});

import { DiagnosticsService, classifyPostureError } from './diagnostics.service';

/** An SDK-shaped service error: `name` is the S3 error code, `$metadata.httpStatusCode` the HTTP status. */
function s3Error(name: string, httpStatusCode: number, message = name) {
  return Object.assign(new Error(message), { name, $metadata: { httpStatusCode } });
}

const BLOCKED = {
  PublicAccessBlockConfiguration: {
    BlockPublicAcls: true,
    IgnorePublicAcls: true,
    BlockPublicPolicy: true,
    RestrictPublicBuckets: true,
  },
};
const ENCRYPTED = {
  ServerSideEncryptionConfiguration: {
    Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }],
  },
};
const NOT_PUBLIC = { PolicyStatus: { IsPublic: false } };

function hardened() {
  handlers.HeadBucketCommand = () => ({});
  handlers.GetPublicAccessBlockCommand = () => BLOCKED;
  handlers.GetBucketPolicyStatusCommand = () => NOT_PUBLIC;
  handlers.GetBucketEncryptionCommand = () => ENCRYPTED;
}

describe('DiagnosticsService.checkObjectStorage: bucket posture (RR-OBJECT-STORAGE-POSTURE-CHECK)', () => {
  const savedEnv = { ...process.env };
  const service = () => new DiagnosticsService({} as any, {} as any, {} as any, {} as any);

  beforeEach(() => {
    sent.length = 0;
    for (const k of Object.keys(handlers)) delete handlers[k];
    process.env.S3_BUCKET = 'kf-test-bucket';
    process.env.S3_ENDPOINT = 'https://s3.example.test';
    process.env.S3_ACCESS_KEY_ID = 'test-key';
    process.env.S3_SECRET_ACCESS_KEY = 'test-secret';
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    // The one invariant every case shares: the check never writes, reads or deletes an object.
    expect(sent.filter((c) => /^(Put|Get|Delete)Object/.test(c))).toEqual([]);
  });

  it('DoD RED: a bucket whose policy status says IsPublic: true is a FAIL, not a pass that says nothing about exposure', async () => {
    handlers.HeadBucketCommand = () => ({});
    handlers.GetPublicAccessBlockCommand = () => ({
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: false, RestrictPublicBuckets: false },
    });
    handlers.GetBucketPolicyStatusCommand = () => ({ PolicyStatus: { IsPublic: true } });
    handlers.GetBucketEncryptionCommand = () => ENCRYPTED;

    const result = await service().checkObjectStorage();

    expect(result.name).toBe('Object Storage');
    expect(result.status).toBe('fail');
    expect(`${result.message} ${result.detail}`).toMatch(/public/i);
    expect(sent).toEqual(['HeadBucketCommand', 'GetPublicAccessBlockCommand', 'GetBucketPolicyStatusCommand', 'GetBucketEncryptionCommand']);
  });

  it('a blocked bucket with default encryption on is a PASS that states both facts', async () => {
    hardened();
    const result = await service().checkObjectStorage();
    expect(result.status).toBe('pass');
    expect(result.message).toMatch(/reachable/);
    expect(`${result.message} ${result.detail}`).toMatch(/public access blocked/i);
    expect(`${result.message} ${result.detail}`).toMatch(/default encryption on/i);
  });

  it('missing default encryption is a WARN naming it (ServerSideEncryptionConfigurationNotFoundError is "none", not "not implemented")', async () => {
    hardened();
    handlers.GetBucketEncryptionCommand = () => {
      throw s3Error('ServerSideEncryptionConfigurationNotFoundError', 404, 'The server side encryption configuration was not found');
    };
    const result = await service().checkObjectStorage();
    expect(result.status).toBe('warn');
    expect(result.detail).toMatch(/no default encryption/i);
    expect(result.detail).not.toMatch(/not implemented/i);
  });

  it('a public access block that is not fully on, or absent, is a WARN; a policy that is not public does not make it a fail', async () => {
    hardened();
    handlers.GetPublicAccessBlockCommand = () => ({
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: false },
    });
    const partial = await service().checkObjectStorage();
    expect(partial.status).toBe('warn');
    expect(partial.detail).toMatch(/RestrictPublicBuckets/);

    hardened();
    handlers.GetPublicAccessBlockCommand = () => {
      throw s3Error('NoSuchPublicAccessBlockConfiguration', 404);
    };
    const absent = await service().checkObjectStorage();
    expect(absent.status).toBe('warn');
    expect(absent.detail).toMatch(/no public access block/i);
  });

  it('a bucket with no policy at all (NoSuchBucketPolicy) is not public: with block and encryption it still passes', async () => {
    hardened();
    handlers.GetBucketPolicyStatusCommand = () => {
      throw s3Error('NoSuchBucketPolicy', 404);
    };
    const result = await service().checkObjectStorage();
    expect(result.status).toBe('pass');
  });

  it('NotImplemented (501) on each posture call is a WARN naming that call, never a fail, never a pass', async () => {
    for (const call of ['GetPublicAccessBlockCommand', 'GetBucketPolicyStatusCommand', 'GetBucketEncryptionCommand'] as const) {
      hardened();
      handlers[call] = () => {
        throw s3Error('NotImplemented', 501, 'A header you provided implies functionality that is not implemented');
      };
      const result = await service().checkObjectStorage();
      expect(result.status, call).toBe('warn');
      expect(result.detail, call).toMatch(new RegExp(`${call.replace(/Command$/, '')}[^;]*not implemented`, 'i'));
    }
  });

  it('a 4xx other than access denied (a provider that answers 400 or 405 to a call it lacks) is reported as not implemented; access denied is reported as denied', async () => {
    hardened();
    handlers.GetBucketPolicyStatusCommand = () => {
      throw s3Error('MethodNotAllowed', 405);
    };
    const lacking = await service().checkObjectStorage();
    expect(lacking.status).toBe('warn');
    expect(lacking.detail).toMatch(/GetBucketPolicyStatus[^;]*not implemented/i);

    hardened();
    handlers.GetBucketEncryptionCommand = () => {
      throw s3Error('AccessDenied', 403, 'Access Denied');
    };
    const denied = await service().checkObjectStorage();
    expect(denied.status).toBe('warn');
    expect(denied.detail).toMatch(/GetBucketEncryption[^;]*access denied/i);
    expect(denied.detail).not.toMatch(/GetBucketEncryption[^;]*not implemented/i);
  });

  it('a public bucket outranks every warning: IsPublic true with unimplemented calls elsewhere is still a FAIL', async () => {
    hardened();
    handlers.GetBucketPolicyStatusCommand = () => ({ PolicyStatus: { IsPublic: true } });
    handlers.GetBucketEncryptionCommand = () => {
      throw s3Error('NotImplemented', 501);
    };
    const result = await service().checkObjectStorage();
    expect(result.status).toBe('fail');
    expect(result.detail).toMatch(/public/i);
    expect(result.detail).toMatch(/GetBucketEncryption[^;]*not implemented/i);
  });

  it('an unexpected error on a posture call (a 5xx, a network error) is a WARN naming the call, and the other probes still run', async () => {
    hardened();
    handlers.GetPublicAccessBlockCommand = () => {
      throw s3Error('InternalError', 500, 'We encountered an internal error');
    };
    const result = await service().checkObjectStorage();
    expect(result.status).toBe('warn');
    expect(result.detail).toMatch(/GetPublicAccessBlock[^;]*InternalError/);
    expect(sent).toContain('GetBucketPolicyStatusCommand');
    expect(sent).toContain('GetBucketEncryptionCommand');
  });

  it('HeadBucket failure keeps today\'s answer: FAIL "not reachable" and no posture call is attempted', async () => {
    handlers.HeadBucketCommand = () => {
      throw s3Error('NoSuchBucket', 404, 'The specified bucket does not exist');
    };
    const result = await service().checkObjectStorage();
    expect(result.status).toBe('fail');
    expect(result.message).toMatch(/not reachable/);
    expect(result.detail).toMatch(/does not exist/);
    expect(sent).toEqual(['HeadBucketCommand']);
  });

  it('nothing configured keeps today\'s answer: WARN "not configured" and no client call at all', async () => {
    delete process.env.S3_BUCKET;
    const result = await service().checkObjectStorage();
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(/not configured/);
    expect(sent).toEqual([]);
  });

  it('review round 1: a policy status that does not say IsPublic: false is not known to be private; it is a WARN, never a pass', async () => {
    for (const body of [{}, { PolicyStatus: {} }, { PolicyStatus: { IsPublic: 'true' } }, { PolicyStatus: { IsPublic: 1 } }, undefined]) {
      hardened();
      handlers.GetBucketPolicyStatusCommand = () => body;
      const result = await service().checkObjectStorage();
      expect(result.status, JSON.stringify(body)).toBe('warn');
      expect(result.detail, JSON.stringify(body)).toMatch(/GetBucketPolicyStatus: policy status not reported/i);
    }
  });

  it('review round 1: an encryption rule without a default algorithm is not "encryption on"', async () => {
    hardened();
    handlers.GetBucketEncryptionCommand = () => ({ ServerSideEncryptionConfiguration: { Rules: [{ BucketKeyEnabled: true }] } });
    const result = await service().checkObjectStorage();
    expect(result.status).toBe('warn');
    expect(result.detail).toMatch(/GetBucketEncryption: rule present but no default algorithm/i);
  });

  it('review round 1: public-access-block flags must be exactly true; strings are reported as off', async () => {
    hardened();
    handlers.GetPublicAccessBlockCommand = () => ({
      PublicAccessBlockConfiguration: { BlockPublicAcls: 'true', IgnorePublicAcls: 'true', BlockPublicPolicy: 'true', RestrictPublicBuckets: 'true' },
    });
    const result = await service().checkObjectStorage();
    expect(result.status).toBe('warn');
    expect(result.detail).toMatch(/BlockPublicAcls, IgnorePublicAcls, BlockPublicPolicy, RestrictPublicBuckets off/);
  });

  it('review round 1: the access-denied hint names the real IAM action for each call', async () => {
    const cases: Array<[string, string]> = [
      ['GetPublicAccessBlockCommand', 's3:GetBucketPublicAccessBlock'],
      ['GetBucketPolicyStatusCommand', 's3:GetBucketPolicyStatus'],
      ['GetBucketEncryptionCommand', 's3:GetEncryptionConfiguration'],
    ];
    for (const [call, action] of cases) {
      hardened();
      handlers[call] = () => {
        throw s3Error('AccessDenied', 403, 'Access Denied');
      };
      const result = await service().checkObjectStorage();
      expect(result.status, call).toBe('warn');
      expect(result.detail, call).toContain(action);
      // the naive `s3:<call name>` guess is wrong for two of the three calls; it must not appear there
      const naive = `s3:${call.replace(/Command$/, '')}`;
      if (naive !== action) expect(result.detail, call).not.toContain(naive);
    }
  });

  it('review round 1: expired or invalid credentials (400-class token codes) are "denied", not "not implemented"; an unknown 4xx is worded as rejected, possibly not implemented', () => {
    for (const code of ['ExpiredToken', 'InvalidToken', 'TokenRefreshRequired', 'InvalidAccessKeyId', 'SignatureDoesNotMatch']) {
      expect(classifyPostureError(s3Error(code, 400)).kind, code).toBe('denied');
    }
    expect(classifyPostureError(s3Error('NoSuchBucket', 404)).kind).toBe('error');
    expect(classifyPostureError(s3Error('MethodNotAllowed', 405))).toMatchObject({ kind: 'not-implemented', code: 'MethodNotAllowed' });
    expect(classifyPostureError(s3Error('NotImplemented', 501))).toMatchObject({ kind: 'not-implemented' });
  });

  it('review round 1: an unknown 4xx names the code and status in the detail, so the operator can tell a stub from a lacking provider', async () => {
    hardened();
    handlers.GetBucketPolicyStatusCommand = () => {
      throw s3Error('MethodNotAllowed', 405);
    };
    const result = await service().checkObjectStorage();
    expect(result.detail).toMatch(/GetBucketPolicyStatus: rejected \(MethodNotAllowed, HTTP 405\)[^;]*not implemented/i);
  });

  it('every posture call names the configured bucket and nothing else leaves the check (no object key, no body)', async () => {
    hardened();
    const inputs: Record<string, unknown>[] = [];
    for (const call of ['GetPublicAccessBlockCommand', 'GetBucketPolicyStatusCommand', 'GetBucketEncryptionCommand'] as const) {
      const prior = handlers[call];
      handlers[call] = (input) => {
        inputs.push(input);
        return prior(input);
      };
    }
    await service().checkObjectStorage();
    expect(inputs).toHaveLength(3);
    for (const input of inputs) expect(input).toEqual({ Bucket: 'kf-test-bucket' });
  });
});
