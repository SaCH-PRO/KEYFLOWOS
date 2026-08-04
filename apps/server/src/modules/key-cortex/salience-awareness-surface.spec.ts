/**
 * Arc A: the ranked concerns finally reach a human without being asked.
 *
 * The amygdala computes up to ten concerns per pass, each with a written
 * summary — "12 overdue invoices in 24h against a normal of 3/day, escalating".
 * Eight were discarded outright, and the surviving two escaped only as the
 * `reason` riding on a hormone, inside a prompt block that explicitly forbids
 * treating them as reportable fact.
 *
 * So the arc terminated in a change of TONE. The owner learned the number only
 * if they happened to open the chat and ask something it bore on; if nobody
 * spoke to KEY, the appraisal expired silently and the invoices stayed overdue.
 *
 * This closes it to the awareness feed, which is already live and already
 * rendered on the command centre. Deliberately NOT to an action: this service
 * states in its own header that it has no hands, and giving a background sweep
 * the ability to act on a business is a product decision, not a missing wire.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AWARENESS_TYPES } from './key-cortex-awareness.service';

const server = readFileSync(join(__dirname, 'key-cortex-salience.service.ts'), 'utf8');
const awareness = readFileSync(join(__dirname, 'key-cortex-awareness.service.ts'), 'utf8');
const panel = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'web', 'src', 'components', 'key', 'KeyAwarenessPanel.tsx'),
  'utf8',
);

describe('the concerns are written where something reads them', () => {
  it('salience persists them', () => {
    const fn = server.slice(server.indexOf('private async persistConcerns('));
    expect(fn.slice(0, 2600)).toMatch(/keyCortexMemory\.upsert/);
  });

  it('is called from the appraisal, not merely defined', () => {
    // The failure this codebase repeats: a complete method nothing invokes.
    const appraise = server.slice(server.indexOf('async appraise('));
    expect(appraise.slice(0, 2600)).toMatch(/await this\.persistConcerns\(/);
  });

  it('uses the types the awareness feed actually whitelists', () => {
    // A discriminator the reader does not recognise is written and silently
    // dropped — the exact shape of three separate defects found today.
    const declared = Object.values(AWARENESS_TYPES);
    expect(declared).toContain('salience_concern');
    expect(declared).toContain('salience_momentum');

    expect(server).toMatch(/MEMORY_TYPE_CONCERN = 'salience_concern'/);
    expect(server).toMatch(/MEMORY_TYPE_MOMENTUM = 'salience_momentum'/);
  });

  it('renders the summary salience already wrote', () => {
    const fn = awareness.slice(awareness.indexOf('private headlineFor('));
    expect(fn.slice(0, 1400)).toMatch(/case 'concern':/);
    expect(fn.slice(0, 1400)).toMatch(/str\('summary'\)/);
  });
});

describe('a resolved concern disappears', () => {
  it('deletes concerns that no longer clear the floor', () => {
    // The half that is easy to forget and matters most. Without it the
    // dashboard goes on reporting twelve overdue invoices after they are paid,
    // and a stale fact stated confidently is worse than no fact.
    const fn = server.slice(server.indexOf('private async persistConcerns('));
    expect(fn.slice(0, 2600)).toMatch(/deleteMany/);
    expect(fn.slice(0, 2600)).toMatch(/notIn: live/);
  });

  it('scopes the delete to one business', () => {
    // Without businessId this clears every tenant's concerns on every hourly
    // appraisal. The guard establishes who is asking; it does not constrain
    // what a query touches.
    const fn = server.slice(server.indexOf('private async persistConcerns('));
    const del = fn.slice(fn.indexOf('deleteMany'), fn.indexOf('deleteMany') + 400);
    expect(del).toMatch(/businessId,/);
  });

  it('refreshes one row per signal rather than accumulating hourly', () => {
    const fn = server.slice(server.indexOf('private async persistConcerns('));
    expect(fn.slice(0, 2600)).toMatch(/conc_\$\{businessId\}_\$\{c\.signal\}/);
  });
});

describe('it does not overstate what it knows', () => {
  it('records full confidence, because these are counts and not inferences', () => {
    // The panel renders confidence as "N% confident". Writing the salience
    // score there would express uncertainty about a number that was counted
    // exactly — false modesty about the wrong thing.
    const fn = server.slice(server.indexOf('private async persistConcerns('));
    expect(fn.slice(0, 2600)).toMatch(/confidence: 1,/);
    expect(fn.slice(0, 2600)).toMatch(/salience: c\.salience/);
  });

  it('a failed write cannot undo the hormone release that already happened', () => {
    const fn = server.slice(server.indexOf('private async persistConcerns('));
    expect(fn.slice(0, 2600)).toMatch(/catch/);
  });
});

describe('the UI knows what it is being sent', () => {
  it('has metadata for both new kinds', () => {
    // KIND_META[item.kind] ?? KIND_META.weakSignal means a missing entry
    // silently relabels an escalating threat as a teal "Weak signal", and the
    // filter-chip loop over Object.keys(KIND_META) hides its count entirely.
    // Server and client whitelists have to move together.
    expect(panel).toMatch(/concern: \{/);
    expect(panel).toMatch(/momentum: \{/);
  });

  it('distinguishes threat from momentum visually', () => {
    // Rendering new bookings in threat red would be actively wrong.
    const concern = panel.slice(panel.indexOf('concern: {'), panel.indexOf('concern: {') + 200);
    const momentum = panel.slice(panel.indexOf('momentum: {'), panel.indexOf('momentum: {') + 200);
    expect(concern).toMatch(/rose/);
    expect(momentum).toMatch(/emerald/);
  });

  it('accepts them in its kind union', () => {
    const union = panel.slice(panel.indexOf('type AwarenessKind'), panel.indexOf('type AwarenessKind') + 240);
    expect(union).toMatch(/"concern"/);
    expect(union).toMatch(/"momentum"/);
  });

  it('every server-side awareness type has a client-side rendering', () => {
    // The durable version of the assertion above: adding a sixth kind on the
    // server without touching the panel fails here rather than rendering as
    // something it is not.
    const clientKinds = panel.slice(panel.indexOf('const KIND_META'), panel.indexOf('const KIND_META') + 2000);
    for (const key of Object.keys(AWARENESS_TYPES)) {
      expect(clientKinds, `panel has no entry for "${key}"`).toMatch(new RegExp(`${key}: \\{`));
    }
  });
});

describe('it still has no hands', () => {
  it('surfaces the concern without acting on the business', () => {
    // The service says so in its own header, and the efferent bridge exists but
    // is deliberately not crossed here. Autonomous action from a background
    // sweep is a product decision.
    const code = server
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
      .join('\n');

    expect(code).not.toMatch(/executeTool|toolRegistry|executeToolDirectly|emailService/);
  });

  it('writes only its own memory types', () => {
    const code = server
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
      .join('\n');
    const writes = code.match(/this\.prisma\.client\.(\w+)\.(upsert|create|update|deleteMany)/g) ?? [];

    for (const write of writes) {
      expect(write).toMatch(/keyCortexMemory/);
    }
  });
});
