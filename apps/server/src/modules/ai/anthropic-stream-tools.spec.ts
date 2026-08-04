/**
 * The Anthropic fallback could not act.
 *
 * The live chat is the STREAMING path. streamAnthropic built its request body
 * with no `tools` key at all, while the non-streaming callAnthropic mapped them
 * properly — and Anthropic is the declared fallback for every category in the
 * balanced routing table. So any turn that failed over from OpenAI silently lost
 * all 118 tools. KEY answered warmly and performed nothing, which is the failure
 * mode that reads as success.
 *
 * The stream parser was the other half: it handled only `text_delta`. Sending
 * tools without parsing the response would have been worse than sending none —
 * the model would decide to act and the decision would be dropped.
 *
 * Both halves are asserted here, because either alone is still broken.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'model-gateway.service.ts'), 'utf8');

/** The body of a named method, by brace matching. */
function methodBody(name: string): string {
  const start = src.indexOf(name);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

describe('the streaming path can be given tools', () => {
  const body = methodBody('private async *streamAnthropic(');

  it('sends tools when the request has them', () => {
    expect(body).toMatch(/body\.tools = request\.tools\.map/);
  });

  it('maps them to Anthropic shape, not OpenAI shape', () => {
    // Anthropic wants { name, description, input_schema }, not the OpenAI
    // { type: 'function', function: {...} } envelope.
    expect(body).toMatch(/input_schema:/);
    expect(body).toMatch(/name: t\.function\.name/);
  });

  it('honours tool_choice', () => {
    expect(body).toMatch(/tool_choice/);
    expect(body).toMatch(/type: 'any'/);
  });
});

describe('and can hear the answer', () => {
  const body = methodBody('private async *streamAnthropic(');

  it('recognises a tool_use block starting', () => {
    // content_block_start carries the id and name.
    expect(body).toMatch(/content_block_start/);
    expect(body).toMatch(/content_block\?\.type === 'tool_use'/);
  });

  it('accumulates the arguments', () => {
    // Anthropic streams tool arguments as partial JSON fragments.
    expect(body).toMatch(/input_json_delta/);
    expect(body).toMatch(/partial_json/);
  });

  it('emits them on the contract the consumer already reassembles', () => {
    const emissions = [...body.matchAll(/type: 'tool_call_delta'/g)];
    expect(emissions.length).toBeGreaterThanOrEqual(2);
    expect(body).toMatch(/index: event\.index/);
  });

  it('still streams text', () => {
    // The regression that would matter most if the parsing changes broke it.
    expect(body).toMatch(/text_delta/);
    expect(body).toMatch(/type: 'content_delta'/);
  });
});

describe('streaming and non-streaming agree', () => {
  it('both map tools the same way', () => {
    const streaming = methodBody('private async *streamAnthropic(');
    const blocking = methodBody('private async callAnthropic(');

    for (const path of [streaming, blocking]) {
      expect(path).toMatch(/input_schema:/);
      expect(path).toMatch(/description: t\.function\.description/);
    }
  });

  it('neither silently drops tools it was given', () => {
    // The original defect in one assertion: a path that accepts request.tools
    // and never references them.
    const streaming = methodBody('private async *streamAnthropic(');
    expect(streaming).toMatch(/request\.tools/);
  });
});
