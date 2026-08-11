/**
 * A malformed tool call on a live phone call must not run the tool empty.
 *
 * THE DEFECT
 *
 *   let args: Record<string, unknown> = {};
 *   try { args = JSON.parse(argsJson); } catch { /* keep empty *\/ }
 *   return this.executeVoiceTool(businessId, name, args, ctx);
 *
 * `args` was pre-set to `{}` and the catch was empty, so when the model emitted
 * malformed JSON for a tool call the parse failed silently and THE TOOL RAN
 * ANYWAY, with nothing in it, mid-conversation with a customer:
 *
 *   bookings_create_booking({})  -> contactName undefined, startTime undefined
 *   helpdesk_create_ticket({})   -> a blank ticket
 *
 * and the caller hears the assistant say it is done.
 *
 * This is the same family as every other finding in this codebase — a failure
 * converted silently into a wrong action rather than into a refusal — except
 * here it happens out loud, to a person, in real time.
 *
 * WHAT THESE TESTS ASSERT
 *
 * That the TOOL WAS NOT CALLED, not merely that an error was returned. A
 * handler that executed and then reported an error would still have created the
 * booking.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PhoneVoiceService } from './phone-voice.service';

/**
 * The onFunctionCall closure is built inside a WebSocket message handler, so
 * reaching it through the real socket plumbing would test the plumbing. This
 * reconstructs the same closure from the source under test and runs it, which
 * keeps the assertion on the branch that matters.
 *
 * The reconstruction is checked against the file: if the source stops matching,
 * the extraction test below fails rather than this file quietly grading a copy
 * of code that no longer ships.
 */
const SOURCE = readFileSync(join(__dirname, 'phone-voice.service.ts'), 'utf8');

function makeService() {
  const executeToolByName = vi.fn(async () => ({ ok: true }));
  const svc = Object.assign(Object.create(PhoneVoiceService.prototype), {
    flow: { executeToolByName },
    logger: { warn: vi.fn(), debug: vi.fn(), log: vi.fn(), error: vi.fn() },
  }) as PhoneVoiceService;
  return { svc, executeToolByName };
}

/** Mirrors the handler's parse-and-refuse branch, then delegates as it does. */
function onFunctionCall(svc: PhoneVoiceService, name: string, argsJson: string) {
  const ctx = { callSid: 'CA_test' };
  let args: Record<string, unknown>;
  try {
    const parsed = JSON.parse(argsJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('tool arguments were not a JSON object');
    }
    args = parsed as Record<string, unknown>;
  } catch {
    return Promise.resolve({ error: `Could not read the arguments for ${name}. Nothing was done.` });
  }
  return (svc as unknown as {
    executeVoiceTool: (b: string, n: string, a: Record<string, unknown>, c: unknown) => Promise<unknown>;
  }).executeVoiceTool('biz_1', name, args, ctx);
}

describe('the shipped handler refuses unparseable arguments', () => {
  it('does not pre-seed args to an empty object', () => {
    // The exact shape of the bug. If this line comes back, the tool runs empty
    // again and every behavioural test below still passes, because they
    // exercise a reconstruction.
    const block = SOURCE.slice(SOURCE.indexOf('onFunctionCall:'), SOURCE.indexOf('onError:'));
    expect(
      /let args: Record<string, unknown> = \{\};/.test(block),
      'args is pre-seeded to {} again — a failed parse will run the tool empty',
    ).toBe(false);
  });

  it('returns an error from the catch instead of falling through', () => {
    const block = SOURCE.slice(SOURCE.indexOf('onFunctionCall:'), SOURCE.indexOf('onError:'));
    expect(block).toMatch(/catch \(err\)/);
    expect(block).toMatch(/return \{\s*error:/);
    expect(block, 'the catch is empty again').not.toMatch(/catch\s*\{\s*\/\*[^*]*\*\/\s*\}/);
  });

  it('rejects a JSON value that is not an object', () => {
    // JSON.parse('"hello"') and JSON.parse('[]') both succeed. Spreading a
    // string into a tool's args gives it numbered keys; an array gives it none.
    const block = SOURCE.slice(SOURCE.indexOf('onFunctionCall:'), SOURCE.indexOf('onError:'));
    expect(block).toMatch(/typeof parsed !== 'object'/);
    expect(block).toMatch(/Array\.isArray\(parsed\)/);
  });
});

describe('behaviour: nothing is executed when the arguments cannot be read', () => {
  let svc: PhoneVoiceService;
  let executeToolByName: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ svc, executeToolByName } = makeService());
  });

  it('does not create a booking from malformed JSON', async () => {
    const out = (await onFunctionCall(svc, 'bookings_create_booking', '{"contactName": "Ada"')) as {
      error?: string;
    };

    // The load-bearing assertion. An error return is not enough — a handler
    // that booked first and reported the error afterwards would still have put
    // a nameless, timeless booking in the calendar.
    expect(executeToolByName, 'a booking was created from unreadable arguments').not.toHaveBeenCalled();
    expect(out.error).toMatch(/could not read the arguments/i);
  });

  it('does not open a blank ticket', async () => {
    await onFunctionCall(svc, 'helpdesk_create_ticket', 'not json at all');
    expect(executeToolByName).not.toHaveBeenCalled();
  });

  it('refuses a bare JSON string, which parses but is not arguments', async () => {
    await onFunctionCall(svc, 'helpdesk_create_ticket', '"just a string"');
    expect(executeToolByName).not.toHaveBeenCalled();
  });

  it('refuses a JSON array for the same reason', async () => {
    await onFunctionCall(svc, 'helpdesk_create_ticket', '[1,2,3]');
    expect(executeToolByName).not.toHaveBeenCalled();
  });

  // Negative controls. Without these every test above passes against a handler
  // that refuses every tool call the model ever makes — which on a phone call
  // is its own outage.
  it('still executes a well-formed call', async () => {
    await onFunctionCall(svc, 'helpdesk_create_ticket', '{"subject":"Broken tap"}');
    expect(executeToolByName).toHaveBeenCalledWith('biz_1', 'helpdesk_create_ticket', {
      subject: 'Broken tap',
    });
  });

  it('still executes a booking with real arguments', async () => {
    await onFunctionCall(
      svc,
      'bookings_create_booking',
      '{"contactName":"Ada","start":"2026-03-01T10:00:00Z"}',
    );
    const [, name, mapped] = executeToolByName.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(name).toBe('bookings_create_booking');
    expect(mapped.contactName).toBe('Ada');
    expect(mapped.startTime).toBe('2026-03-01T10:00:00Z');
  });

  it('accepts an empty object, which is a valid no-argument call', async () => {
    // `{}` from the MODEL is legitimate for a tool that takes nothing. The bug
    // was `{}` manufactured from a parse failure. The difference is whether the
    // model said it.
    await onFunctionCall(svc, 'calendar_check_conflicts', '{}');
    expect(executeToolByName).toHaveBeenCalledWith('biz_1', 'calendar_check_conflicts', {});
  });
});
