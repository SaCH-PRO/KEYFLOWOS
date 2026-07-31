/**
 * The cortex HTTP surface only works if its DTOs carry class-validator metadata.
 *
 * app-bootstrap installs a GLOBAL ValidationPipe with `whitelist: true`. That
 * option deletes every property lacking validation metadata. The cortex DTOs had
 * none, so every request body was stripped to {} before reaching a handler —
 * businessId came through undefined and every body-taking endpoint 400'd.
 *
 * That made the whole CNS peripheral surface unreachable over HTTP while looking
 * perfectly healthy in unit tests, which never go through the pipe.
 *
 * These tests run the REAL pipe with the REAL global config.
 */
import { describe, it, expect } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

/** Same options as apps/server/src/app-bootstrap.ts. */
const pipe = new ValidationPipe({ whitelist: true, transform: true });

/** Mirrors the decorated shape of the cortex DTOs. */
class DecoratedDto {
  @IsString()
  code!: string;

  @IsOptional()
  @IsIn(['typescript', 'javascript', 'python', 'json', 'sql'])
  language?: string;

  @IsString()
  businessId!: string;

  @IsOptional()
  @IsObject()
  inputs?: Record<string, unknown>;
}

/** The shape the cortex DTOs had before: no decorators at all. */
class UndecoratedDto {
  code!: string;
  businessId!: string;
}

describe('cortex DTO validation under the global ValidationPipe', () => {
  const body = {
    code: 'SELECT 1',
    language: 'sql',
    businessId: 'biz_123',
    inputs: { a: 1 },
  };

  it('an undecorated DTO is stripped to {} — the bug this guards against', async () => {
    const out = await pipe.transform(
      { code: 'x', businessId: 'biz_123' },
      { type: 'body', metatype: UndecoratedDto },
    );
    expect(out).toEqual({});
    expect((out as { businessId?: string }).businessId).toBeUndefined();
  });

  it('a decorated DTO preserves every declared field', async () => {
    const out = (await pipe.transform(body, {
      type: 'body',
      metatype: DecoratedDto,
    })) as DecoratedDto;

    expect(out.businessId).toBe('biz_123');
    expect(out.code).toBe('SELECT 1');
    expect(out.language).toBe('sql');
    expect(out.inputs).toEqual({ a: 1 });
  });

  it('still strips properties that are not declared', async () => {
    // whitelist must keep doing its job — this is why it is enabled.
    const out = (await pipe.transform(
      { ...body, injected: 'should-not-survive' },
      { type: 'body', metatype: DecoratedDto },
    )) as Record<string, unknown>;

    expect(out.businessId).toBe('biz_123');
    expect(out.injected).toBeUndefined();
  });

  it('rejects a body violating a declared constraint', async () => {
    await expect(
      pipe.transform(
        { code: 'x', businessId: 'biz_1', language: 'brainfuck' },
        { type: 'body', metatype: DecoratedDto },
      ),
    ).rejects.toThrow();
  });

  it('rejects a body missing a required field', async () => {
    await expect(
      pipe.transform({ code: 'x' }, { type: 'body', metatype: DecoratedDto }),
    ).rejects.toThrow();
  });
});

describe('the real cortex controller DTOs', () => {
  it('every DTO class in the controller carries validator metadata', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, 'key-cortex.controller.ts'), 'utf8');

    // Each `class XDto {` must be followed by at least one decorator before its
    // first field, otherwise whitelist:true will strip that DTO's body.
    const blocks = src.split(/\n(?=(?:export )?class \w+Dto \{)/).slice(1);
    expect(blocks.length).toBeGreaterThan(0);

    const undecorated = blocks
      .filter((b) => !/@(IsString|IsNumber|IsBoolean|IsObject|IsArray|IsIn|IsOptional|Allow)\(/.test(b))
      .map((b) => (b.match(/class (\w+Dto)/) ?? [])[1]);

    expect(undecorated).toEqual([]);
  });
});
