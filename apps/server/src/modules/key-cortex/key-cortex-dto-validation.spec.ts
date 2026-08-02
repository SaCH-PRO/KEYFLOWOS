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
  const VALIDATORS =
    /@(IsString|IsNumber|IsBoolean|IsObject|IsArray|IsIn|IsEnum|IsInt|IsOptional|Allow)\(/;

  /**
   * Split the controller into DTO class blocks.
   *
   * `class \w+Dto\b`, NOT `class \w+Dto \{`. The earlier pattern required the
   * brace to follow the name immediately, so it could not see
   * `class ChatQueryDto implements CortexQuery {` — and both classes that use
   * `implements` were entirely undecorated. They folded into the preceding
   * block, which was decorated, so this suite passed while POST /cortex/chat
   * 400'd on every request. The test asserted a property it could not observe.
   */
  async function dtoBlocks(): Promise<Array<{ name: string; body: string }>> {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, 'key-cortex.controller.ts'), 'utf8');

    return src
      .split(/\n(?=(?:export )?class \w+Dto\b)/)
      .slice(1)
      .map((block) => ({
        name: (block.match(/class (\w+Dto)\b/) ?? [])[1] ?? 'unknown',
        // Stop at the class's closing brace so a later class's decorators are
        // never mistaken for this one's.
        body: block.slice(0, block.indexOf('\n}')),
      }));
  }

  it('sees the DTO classes declared with `implements`', async () => {
    // Guard on the guard: if this regression is ever reintroduced, the two
    // classes that triggered it must still be visible to the checks below.
    const names = (await dtoBlocks()).map((b) => b.name);
    expect(names).toContain('ChatQueryDto');
    expect(names).toContain('VoiceSpeakDto');
  });

  it('every DTO class carries validator metadata', async () => {
    const undecorated = (await dtoBlocks())
      .filter((b) => !VALIDATORS.test(b.body))
      .map((b) => b.name);

    expect(undecorated).toEqual([]);
  });

  it('every DECLARED PROPERTY carries metadata, not just one per class', async () => {
    // whitelist:true strips per PROPERTY. ExecuteBatchDto.commands was the only
    // undecorated field in an otherwise-decorated class, so POST /cortex/batch
    // always 400'd with "commands array is required" while a class-level check
    // reported the DTO as fine.
    const offenders: string[] = [];

    for (const { name, body } of await dtoBlocks()) {
      const lines = body.split('\n');
      let pendingDecorator = false;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('@')) {
          pendingDecorator ||= VALIDATORS.test(trimmed);
          continue;
        }
        // A top-level property declaration: `name: type;` or `name?: type;`.
        // Nested object-literal members are indented deeper and are skipped —
        // whitelist only strips at the top level unless @ValidateNested is used.
        const isProperty = /^ {2}(readonly )?\w+\??:/.test(line);
        if (!isProperty) continue;

        const property = (trimmed.match(/^(?:readonly )?(\w+)\??:/) ?? [])[1];
        if (!pendingDecorator) offenders.push(`${name}.${property}`);
        pendingDecorator = false;
      }
    }

    expect(offenders).toEqual([]);
  });
});
