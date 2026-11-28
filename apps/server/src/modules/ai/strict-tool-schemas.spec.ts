/**
 * RR-STRICT-TOOL-SCHEMAS (D-261, D-262, D-17, D-71, D-73, D-119, D-140)
 *
 * Verifies:
 *  (a) Every advertised tool definition from `getOpenAiToolDefinitions()` has a
 *      closed schema (`additionalProperties: false` at every object level that
 *      declares `properties`), OpenAI-strict-compatible tools emit `strict: true`
 *      with every property required and optional properties nullable, and
 *      non-strict tools match the shrink-only `NON_STRICT_OPENAI_TOOLS` allowlist
 *      with zero disallowed JSON-Schema keywords.
 *  (b) `FlowOrchestratorService.validateToolInput` refuses any undeclared
 *      argument with HTTP 400 (`BadRequestException`: `Field "<k>" is not a
 *      parameter of <tool>`), strips `null` values emitted by strict mode for
 *      optional parameters before required/type checks, validates typed array
 *      items, and lets declared arguments pass unchanged (negative control).
 *  (c) `ModelGatewayService` preserves `strict: true` and closed schemas for
 *      OpenAI and sends closed `input_schema` (without OpenAI null-union
 *      rewrites or `strict`) for Anthropic in both `complete` and `streamComplete`.
 */
import { BadRequestException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FLOW_TOOLS,
  NON_STRICT_OPENAI_TOOLS,
  OPENAI_STRICT_DISALLOWED_KEYWORDS,
  getOpenAiToolDefinitions,
  getToolByName,
  toProviderToolSchema,
} from './flow-tool-registry';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { ModelGatewayService, type GatewayToolDefinition } from './model-gateway.service';
import { LLMCostService } from './llm-cost.service';
import { LangfuseService } from './langfuse.service';

type AnySchema = Record<string, any>;

function collectOpenObjectPaths(schema: AnySchema, prefix = 'parameters', out: string[] = []): string[] {
  if (!schema || typeof schema !== 'object') return out;
  if (schema.type === 'object' && schema.properties && typeof schema.properties === 'object') {
    if (schema.additionalProperties !== false) {
      out.push(prefix);
    }
    for (const [key, prop] of Object.entries<AnySchema>(schema.properties)) {
      collectOpenObjectPaths(prop, `${prefix}.properties.${key}`, out);
    }
  }
  if (schema.type === 'array' && schema.items && typeof schema.items === 'object') {
    collectOpenObjectPaths(schema.items, `${prefix}.items`, out);
  }
  if (Array.isArray(schema.anyOf)) {
    schema.anyOf.forEach((branch: AnySchema, idx: number) =>
      collectOpenObjectPaths(branch, `${prefix}.anyOf[${idx}]`, out),
    );
  }
  return out;
}

function collectStrictInvariantViolations(
  schema: AnySchema,
  prefix = 'parameters',
  out: string[] = [],
): string[] {
  if (!schema || typeof schema !== 'object') return out;
  for (const k of Object.keys(schema)) {
    if (OPENAI_STRICT_DISALLOWED_KEYWORDS.has(k)) {
      out.push(`${prefix}:disallowed:${k}`);
    }
  }
  if (schema.type === 'object') {
    if (!schema.properties || typeof schema.properties !== 'object') {
      out.push(`${prefix}:object-without-properties`);
      return out;
    }
    if (schema.additionalProperties !== false) {
      out.push(`${prefix}:missing-additionalProperties-false`);
    }
    const propKeys = Object.keys(schema.properties).sort();
    const reqKeys = Array.isArray(schema.required) ? [...schema.required].sort() : [];
    if (JSON.stringify(propKeys) !== JSON.stringify(reqKeys)) {
      out.push(`${prefix}:required-mismatch`);
    }
    for (const [k, prop] of Object.entries<AnySchema>(schema.properties)) {
      collectStrictInvariantViolations(prop, `${prefix}.properties.${k}`, out);
    }
  } else if (schema.type === 'array') {
    if (!schema.items || typeof schema.items !== 'object') {
      out.push(`${prefix}:array-without-items`);
    } else {
      collectStrictInvariantViolations(schema.items, `${prefix}.items`, out);
    }
  } else if (Array.isArray(schema.anyOf)) {
    schema.anyOf.forEach((branch: AnySchema, idx: number) =>
      collectStrictInvariantViolations(branch, `${prefix}.anyOf[${idx}]`, out),
    );
  }
  return out;
}

function makeOrchestratorForValidation(): {
  validateToolInput: (
    toolName: string,
    args: Record<string, any>,
    options?: { allowExtraKeys?: readonly string[] },
  ) => void;
} {
  const instance = Object.create(FlowOrchestratorService.prototype);
  return instance as {
    validateToolInput: (
      toolName: string,
      args: Record<string, any>,
      options?: { allowExtraKeys?: readonly string[] },
    ) => void;
  };
}

describe('RR-STRICT-TOOL-SCHEMAS — closed schemas, strict compilation, and undeclared-arg refusal', () => {
  it('closes every advertised getOpenAiToolDefinitions() schema with additionalProperties:false and matches the shrink-only NON_STRICT_OPENAI_TOOLS compile census', () => {
    const defs = getOpenAiToolDefinitions() as Array<{
      type: 'function';
      function: {
        name: string;
        description: string;
        strict?: boolean;
        parameters: AnySchema;
      };
    }>;

    expect(defs.length).toBe(FLOW_TOOLS.length);

    const openPaths: string[] = [];
    const nonStrictComputed: string[] = [];
    const strictViolations: string[] = [];
    const disallowedKeywordTools: string[] = [];

    for (const tool of FLOW_TOOLS) {
      const compiled = toProviderToolSchema(tool, 'openai');
      const keywordReasons = compiled.strictReasons.filter((r) => r.includes('disallowed-keyword:'));
      if (keywordReasons.length > 0) {
        disallowedKeywordTools.push(`${tool.name} [${keywordReasons.join(', ')}]`);
      }
      if (!compiled.strict) {
        nonStrictComputed.push(tool.name);
      } else {
        for (const v of collectStrictInvariantViolations(compiled.schema)) {
          strictViolations.push(`${tool.name}@${v}`);
        }
      }
    }

    for (const def of defs) {
      const missing = collectOpenObjectPaths(def.function.parameters);
      for (const p of missing) {
        openPaths.push(`${def.function.name}@${p}`);
      }
    }

    expect(openPaths, 'Every advertised tool object schema with properties must set additionalProperties:false').toEqual([]);
    expect(disallowedKeywordTools, 'No FLOW_TOOL may use a JSON-Schema keyword rejected by OpenAI strict mode').toEqual([]);
    expect(strictViolations, 'Every strict-compiled FLOW_TOOL must satisfy all OpenAI strict-mode invariants').toEqual([]);
    expect([...nonStrictComputed].sort()).toEqual([...NON_STRICT_OPENAI_TOOLS].sort());

    const strictDefs = defs.filter((d) => d.function.strict === true);
    expect(strictDefs.length).toBe(FLOW_TOOLS.length - NON_STRICT_OPENAI_TOOLS.length);

    const crmSearch = defs.find((d) => d.function.name === 'crm_search_contacts');
    expect(crmSearch?.function.strict).toBe(true);
    expect(crmSearch?.function.parameters.additionalProperties).toBe(false);
    expect(crmSearch?.function.parameters.required).toEqual(['query']);

    // Optional fields in OpenAI strict mode become required + nullable; enum uses anyOf with null
    const crmCreate = defs.find((d) => d.function.name === 'crm_create_contact');
    expect(crmCreate?.function.strict).toBe(true);
    expect(crmCreate?.function.parameters.additionalProperties).toBe(false);
    expect(new Set(crmCreate?.function.parameters.required)).toEqual(
      new Set(Object.keys(crmCreate?.function.parameters.properties ?? {})),
    );
    expect(crmCreate?.function.parameters.properties.firstName.type).toEqual(['string', 'null']);
    expect(crmCreate?.function.parameters.properties.status.anyOf).toEqual([
      { type: 'string', enum: ['LEAD', 'PROSPECT', 'CLIENT', 'LOST'] },
      { type: 'null' },
    ]);

    // Negative control: synthetic tool with a disallowed keyword fails strict compilation
    const badCompiled = toProviderToolSchema(
      {
        name: 'synthetic_bad_tool',
        parameters: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'Code', minLength: 3 } as any,
          },
          required: ['code'],
        },
      },
      'openai',
    );
    expect(badCompiled.strict).toBe(false);
    expect(badCompiled.strictReasons).toContain('parameters.properties.code:disallowed-keyword:minLength');
  });

  it('refuses undeclared arguments in validateToolInput with HTTP 400 naming the field, strips strict-mode nulls on optional fields, validates typed array items, and passes declared arguments unchanged', () => {
    const orchestrator = makeOrchestratorForValidation();

    // DoD RED case (b): undeclared businessId argument must throw 400 naming businessId
    let thrown: unknown;
    try {
      orchestrator.validateToolInput('crm_search_contacts', {
        query: 'x',
        businessId: 'other',
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(BadRequestException);
    expect((thrown as BadRequestException).getStatus()).toBe(400);
    expect((thrown as Error).message).toBe('Field "businessId" is not a parameter of crm_search_contacts');

    // Negative control: declared arguments pass unchanged
    const declaredArgs: Record<string, any> = { query: 'Jane Doe' };
    expect(() => orchestrator.validateToolInput('crm_search_contacts', declaredArgs)).not.toThrow();
    expect(declaredArgs).toEqual({ query: 'Jane Doe' });

    // Strict-mode null union on optional parameters: null stripped before type checks
    const optionalNullArgs: Record<string, any> = {
      firstName: 'Jane',
      lastName: null,
      email: null,
      status: null,
    };
    expect(() => orchestrator.validateToolInput('crm_create_contact', optionalNullArgs)).not.toThrow();
    expect(optionalNullArgs).toEqual({ firstName: 'Jane' });

    // Required field sent as null must STILL throw 400 Missing required fields
    expect(() =>
      orchestrator.validateToolInput('crm_search_contacts', { query: null }),
    ).toThrow(BadRequestException);

    // Array item type check on a tool with typed array items (find first string[] tool)
    const stringArrayTool = FLOW_TOOLS.find((t) =>
      Object.values(t.parameters.properties).some(
        (p) => p.type === 'array' && p.items?.type === 'string',
      ),
    );
    expect(stringArrayTool).toBeDefined();
    const arrayKey = Object.entries(stringArrayTool!.parameters.properties).find(
      ([, p]) => p.type === 'array' && p.items?.type === 'string',
    )![0];
    const baseReq: Record<string, any> = {};
    for (const r of stringArrayTool!.parameters.required) {
      baseReq[r] = stringArrayTool!.parameters.properties[r]?.type === 'number' ? 1 : 'val';
    }
    expect(() =>
      orchestrator.validateToolInput(stringArrayTool!.name, { ...baseReq, [arrayKey]: ['ok', 42] }),
    ).toThrow(BadRequestException);

    // Shrink-only extra-key allowlist permits ONLY the listed key, refusing any other undeclared key
    expect(() =>
      orchestrator.validateToolInput(
        'fetch_business_summary',
        { businessId: 'biz_1' },
        { allowExtraKeys: ['businessId'] },
      ),
    ).not.toThrow();
    expect(() =>
      orchestrator.validateToolInput(
        'fetch_business_summary',
        { businessId: 'biz_1', evil: true },
        { allowExtraKeys: ['businessId'] },
      ),
    ).toThrow('Field "evil" is not a parameter of fetch_business_summary');
  });

  describe('ModelGatewayService Anthropic input_schema closure (complete & streamComplete)', () => {
    let savedEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      savedEnv = { ...process.env };
      process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
      delete process.env.KEY_DISABLED;
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      process.env = savedEnv;
    });

    it('sends closed additionalProperties:false input_schema without OpenAI strict or null-union rewrites on both callAnthropic and streamAnthropic', async () => {
      const captured: Array<Record<string, any>> = [];
      const sse = (type: string, data: Record<string, unknown> = {}) =>
        `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init?: RequestInit) => {
          const parsed = JSON.parse(String(init?.body ?? '{}'));
          captured.push(parsed);
          if (parsed.stream) {
            const enc = new TextEncoder();
            return new Response(
              new ReadableStream({
                start(controller) {
                  for (const chunk of [
                    sse('message_start', { message: { usage: { input_tokens: 5 } } }),
                    sse('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
                    sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'ok' } }),
                    sse('content_block_stop', { index: 0 }),
                    sse('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } }),
                    sse('message_stop'),
                  ]) {
                    controller.enqueue(enc.encode(chunk));
                  }
                  controller.close();
                },
              }),
              { status: 200 },
            );
          }
          return new Response(
            JSON.stringify({
              content: [{ type: 'text', text: 'ok' }],
              usage: { input_tokens: 5, output_tokens: 2 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }),
      );

      const cost = {
        recordCost: vi.fn().mockResolvedValue({}),
        getCurrentMonthSpend: vi.fn().mockResolvedValue({ total: 0, byProvider: {} }),
      } as unknown as LLMCostService;
      const langfuse = {
        isEnabled: () => false,
        startTrace: () => null,
        logGeneration: () => undefined,
      } as unknown as LangfuseService;
      const gateway = new ModelGatewayService(cost, langfuse);

      // Feed an OpenAI-strict-compiled tool from getOpenAiToolDefinitions() into Anthropic!
      const crmCreateOpenAi = getOpenAiToolDefinitions().find(
        (d) => d.function.name === 'crm_create_contact',
      ) as GatewayToolDefinition;
      const adHocTool: GatewayToolDefinition = {
        type: 'function',
        function: {
          name: 'ad_hoc_custom',
          description: 'Non-FLOW tool',
          parameters: {
            type: 'object',
            properties: {
              nested: { type: 'object', properties: { flag: { type: 'boolean' } } },
            },
            required: [],
          },
        },
      };

      await gateway.complete({
        businessId: 'biz_1',
        taskCategory: 'general',
        providerOverride: 'anthropic',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [crmCreateOpenAi, adHocTool],
        toolChoice: 'auto',
      });

      for await (const _chunk of gateway.streamComplete({
        businessId: 'biz_1',
        taskCategory: 'general',
        providerOverride: 'anthropic',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [crmCreateOpenAi, adHocTool],
        toolChoice: 'auto',
      })) {
        // drain stream
      }

      expect(captured).toHaveLength(2);
      for (const body of captured) {
        const crmAnthropic = body.tools.find((t: any) => t.name === 'crm_create_contact');
        expect(crmAnthropic.strict).toBeUndefined();
        expect(crmAnthropic.input_schema.additionalProperties).toBe(false);
        // Original required=[] preserved (not OpenAI strict's all-keys required)
        expect(crmAnthropic.input_schema.required).toEqual(
          getToolByName('crm_create_contact')!.parameters.required,
        );
        // Original string type preserved (not ['string', 'null'])
        expect(crmAnthropic.input_schema.properties.firstName.type).toBe('string');

        const adHocAnthropic = body.tools.find((t: any) => t.name === 'ad_hoc_custom');
        expect(adHocAnthropic.input_schema.additionalProperties).toBe(false);
        expect(adHocAnthropic.input_schema.properties.nested.additionalProperties).toBe(false);
      }
    });
  });
});
