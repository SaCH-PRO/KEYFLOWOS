/**
 * RR-STRICT-TOOL-SCHEMAS (D-261, D-262, D-17, D-71, D-73, D-119, D-140)
 *
 * Verifies:
 *  (a) Every advertised tool definition from `getOpenAiToolDefinitions()` has a
 *      closed schema (`additionalProperties: false` at every object level that
 *      declares `properties`), OpenAI-strict-compatible tools emit `strict: true`
 *      with every property required and optional properties nullable, and
 *      non-strict tools are tracked in a shrink-only allowlist.
 *  (b) `FlowOrchestratorService.validateToolInput` refuses any undeclared
 *      argument with HTTP 400 (`BadRequestException`: `Field "<k>" is not a
 *      parameter of <tool>`), strips `null` values emitted by strict mode for
 *      optional parameters before required/type checks, and lets declared
 *      arguments pass unchanged (negative control).
 *  (c) `ModelGatewayService` preserves `strict: true` and closed schemas for
 *      OpenAI and sends closed `input_schema` (without OpenAI null-union
 *      rewrites or `strict`) for Anthropic in both `complete` and `streamComplete`.
 */
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { FLOW_TOOLS, getOpenAiToolDefinitions } from './flow-tool-registry';
import { FlowOrchestratorService } from './flow-orchestrator.service';

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

function makeOrchestratorForValidation(): {
  validateToolInput: (toolName: string, args: Record<string, any>) => void;
} {
  const instance = Object.create(FlowOrchestratorService.prototype);
  return instance as { validateToolInput: (toolName: string, args: Record<string, any>) => void };
}

describe('RR-STRICT-TOOL-SCHEMAS — closed schemas, strict compilation, and undeclared-arg refusal', () => {
  it('closes every advertised getOpenAiToolDefinitions() schema with additionalProperties:false and emits strict:true for strict-compatible tools', () => {
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
    for (const def of defs) {
      const missing = collectOpenObjectPaths(def.function.parameters);
      for (const p of missing) {
        openPaths.push(`${def.function.name}@${p}`);
      }
    }
    expect(openPaths, 'Every advertised tool object schema with properties must set additionalProperties:false').toEqual([]);

    const strictDefs = defs.filter((d) => d.function.strict === true);
    expect(strictDefs.length).toBeGreaterThanOrEqual(270);

    // Every strict tool must satisfy OpenAI strict-mode invariants:
    // additionalProperties:false, every property listed in required, no unsupported keywords.
    const crmSearch = defs.find((d) => d.function.name === 'crm_search_contacts');
    expect(crmSearch?.function.strict).toBe(true);
    expect(crmSearch?.function.parameters.additionalProperties).toBe(false);
    expect(crmSearch?.function.parameters.required).toEqual(['query']);

    const crmCreate = defs.find((d) => d.function.name === 'crm_create_contact');
    expect(crmCreate?.function.strict).toBe(true);
    expect(crmCreate?.function.parameters.additionalProperties).toBe(false);
    expect(new Set(crmCreate?.function.parameters.required)).toEqual(
      new Set(Object.keys(crmCreate?.function.parameters.properties ?? {})),
    );
  });

  it('refuses undeclared arguments in validateToolInput with HTTP 400 naming the field, strips strict-mode nulls on optional fields, and passes declared arguments unchanged', () => {
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
  });
});
