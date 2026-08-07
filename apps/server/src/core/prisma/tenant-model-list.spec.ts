/**
 * The tenant isolation list has to name models that exist.
 *
 * BUSINESS_ID_MODELS in packages/db/src/client.ts is a hand-maintained set of
 * model names. It is consulted by string:
 *
 *   function tenantOperationAllowed(model: string) {
 *     return !!activeBusinessId() && BUSINESS_ID_MODELS.has(model);
 *   }
 *
 * A name that does not match a real model never matches anything, so that model
 * is silently unscoped. Nothing throws. Nothing logs. The set just quietly
 * protects one fewer table than it appears to.
 *
 * This has now happened twice. The file's own comment records the first:
 * MessageThread, CommunicationEvent and NotificationEvent survived a rename and
 * named nothing. The second was mine — ConversationThread stayed in the list
 * after I dropped the model in the inbox merge, in the same week I wrote the
 * comment warning about it.
 *
 * A list checked by string against a schema nobody diffs it with is exactly the
 * shape of every other defect here: nav labels vs allowlists, compensation keys
 * vs tool names, tool enums vs domain enums, reason codes vs a form. This is
 * that diff, run every build.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const CLIENT = path.join(ROOT, 'packages', 'db', 'src', 'client.ts');
const SCHEMA = path.join(ROOT, 'packages', 'db', 'prisma', 'schema.prisma');

function listedModels(): string[] {
  const src = fs.readFileSync(CLIENT, 'utf8');
  const at = src.indexOf('const BUSINESS_ID_MODELS = new Set([');
  expect(at, 'BUSINESS_ID_MODELS not found — client.ts was restructured').toBeGreaterThan(-1);

  const body = src.slice(at, src.indexOf(']);', at));
  // Only quoted entries, so the surrounding prose cannot contribute names.
  return [...body.matchAll(/'([A-Za-z][A-Za-z0-9_]*)'/g)].map((m) => m[1]);
}

function schemaModels(): Set<string> {
  const src = fs.readFileSync(SCHEMA, 'utf8');
  return new Set([...src.matchAll(/^model\s+([A-Za-z][A-Za-z0-9_]*)\s*\{/gm)].map((m) => m[1]));
}

describe('BUSINESS_ID_MODELS describes reality', () => {
  const listed = listedModels();
  const models = schemaModels();

  it('finds both sides', () => {
    expect(listed.length).toBeGreaterThan(20);
    expect(models.size).toBeGreaterThan(200);
  });

  it('every listed name is a real model', () => {
    const ghosts = listed.filter((name) => !models.has(name));

    expect(
      ghosts,
      'these name no model in schema.prisma, so they scope nothing and the set ' +
        'silently protects fewer tables than it appears to',
    ).toEqual([]);
  });

  it('every listed model actually has a businessId column', () => {
    // The other direction. Injecting businessId into a model that has no such
    // column throws PrismaClientValidationError at runtime — which is why
    // TaskAssignment is deliberately excluded and says so in the file.
    const src = fs.readFileSync(SCHEMA, 'utf8');
    const without = listed.filter((name) => {
      const at = src.search(new RegExp(`^model\\s+${name}\\s*\\{`, 'm'));
      if (at === -1) return false; // covered by the assertion above
      const block = src.slice(at, src.indexOf('\n}', at));
      return !/\bbusinessId\s+String/.test(block);
    });

    expect(
      without,
      'these have no businessId column — injecting one throws PrismaClientValidationError',
    ).toEqual([]);
  });

  it('the goal tables are covered', () => {
    // Named because their absence was a live cross-tenant hole:
    // POST /cortex/goals/:goalId/plans resolved a goal id straight from the URL
    // with no scoping at the service layer either, so a user of one business
    // could build a plan from another business's goal and read its title and
    // description back in the response.
    expect(listed).toContain('AiGoal');
    expect(listed).toContain('AiPlan');
  });
});
