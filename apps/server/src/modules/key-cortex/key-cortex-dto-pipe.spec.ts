/**
 * The REAL cortex DTOs through the REAL global ValidationPipe.
 *
 * key-cortex-dto-validation.spec.ts tests hand-written *mirrors* of these
 * classes. Mirrors prove the mechanism but not the code: they stay decorated
 * while the real DTOs quietly are not, and the suite reports green.
 *
 * That is exactly what happened. ChatQueryDto and VoiceSpeakDto carried no
 * decorators at all, so the global pipe (whitelist: true) deleted every field
 * of the request body and POST /api/v1/cortex/chat — the main chat endpoint —
 * returned 400 "Query text is required" on 100% of requests, including requests
 * that plainly contained text.
 *
 * The failure was maximally misleading: BusinessGuard reads the RAW pre-pipe
 * body, so auth and tenancy looked healthy, and the handler's own guard clause
 * threw ABOVE the try block, so nothing was ever logged. Every signal pointed
 * at the client payload.
 *
 * These tests import the actual exported classes, so there is nothing left to
 * drift out of sync.
 */
import { describe, it, expect } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import {
  ChatQueryDto,
  VoiceSpeakDto,
  ExecuteBatchDto,
  ConsciousChatDto,
} from './key-cortex.controller';

/** Identical options to apps/server/src/app-bootstrap.ts. */
const pipe = new ValidationPipe({ whitelist: true, transform: true });

const through = <T>(body: unknown, metatype: new () => T): Promise<T> =>
  pipe.transform(body, { type: 'body', metatype }) as Promise<T>;

describe('ChatQueryDto — the main chat endpoint', () => {
  const valid = {
    text: 'what is my cash position',
    businessId: 'biz_1',
    userId: 'user_1',
  };

  it('survives the pipe with its required fields intact', async () => {
    // The regression in one assertion: before decorators, this returned {}.
    const out = await through(valid, ChatQueryDto);
    expect(out.text).toBe(valid.text);
    expect(out.businessId).toBe('biz_1');
    expect(out.userId).toBe('user_1');
  });

  it('keeps every optional field the handler reads', async () => {
    const out = await through(
      {
        ...valid,
        sessionId: 'sess_1',
        persona: { id: 'p1', name: 'Advisor' },
        voice: { id: 'v1' },
        provider: 'anthropic',
        mood: 'focused',
        stream: true,
        enableActions: false,
        enableVoice: true,
        attachments: [
          { type: 'image', url: 'https://x/y.png', mimeType: 'image/png', name: 'y.png' },
        ],
      },
      ChatQueryDto,
    );

    expect(out.sessionId).toBe('sess_1');
    expect(out.persona).toBeDefined();
    expect(out.voice).toBeDefined();
    expect(out.provider).toBe('anthropic');
    expect(out.mood).toBe('focused');
    expect(out.stream).toBe(true);
    expect(out.enableActions).toBe(false);
    expect(out.enableVoice).toBe(true);
    expect(out.attachments).toHaveLength(1);
  });

  it('still strips undeclared properties', async () => {
    const out = (await through(
      { ...valid, isAdmin: true },
      ChatQueryDto,
    )) as Record<string, unknown>;

    expect(out.text).toBe(valid.text);
    expect(out.isAdmin).toBeUndefined();
  });

  it('rejects a body missing text rather than silently emptying it', async () => {
    await expect(
      through({ businessId: 'biz_1', userId: 'user_1' }, ChatQueryDto),
    ).rejects.toThrow();
  });

  it('rejects a wrongly typed field', async () => {
    await expect(through({ ...valid, text: 42 }, ChatQueryDto)).rejects.toThrow();
  });
});

describe('VoiceSpeakDto', () => {
  it('survives the pipe', async () => {
    const out = await through(
      { text: 'hello', format: 'mp3', speed: 1.2, instructions: 'warm' },
      VoiceSpeakDto,
    );
    expect(out.text).toBe('hello');
    expect(out.format).toBe('mp3');
    expect(out.speed).toBe(1.2);
    expect(out.instructions).toBe('warm');
  });

  it('rejects an unsupported audio format', async () => {
    await expect(
      through({ text: 'hello', format: 'wma' }, VoiceSpeakDto),
    ).rejects.toThrow();
  });
});

describe('ExecuteBatchDto — the per-property case', () => {
  it('keeps commands, which whitelist stripped when only the class was decorated', async () => {
    // commands was the ONLY undecorated field in an otherwise-decorated class,
    // so POST /cortex/batch always 400'd with "commands array is required"
    // while a class-level check reported the DTO as fine.
    const out = await through(
      {
        commands: [{ type: 'natural', command: 'send the invoice' }],
        businessId: 'biz_1',
        userId: 'user_1',
      },
      ExecuteBatchDto,
    );

    expect(out.commands).toHaveLength(1);
    expect(out.businessId).toBe('biz_1');
  });

  it('rejects a non-array commands value', async () => {
    await expect(
      through(
        { commands: 'send the invoice', businessId: 'biz_1', userId: 'user_1' },
        ExecuteBatchDto,
      ),
    ).rejects.toThrow();
  });
});

describe('ConsciousChatDto — the CNS surface', () => {
  it('survives the pipe', async () => {
    const out = await through(
      { text: 'should we hire', businessId: 'biz_1', sessionId: 'sess_1' },
      ConsciousChatDto,
    );
    expect(out.text).toBe('should we hire');
    expect(out.businessId).toBe('biz_1');
    expect(out.sessionId).toBe('sess_1');
  });
});
