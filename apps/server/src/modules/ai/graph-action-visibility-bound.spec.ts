/**
 * W3-KEY-CRM-VISIBILITY review SEC-W3CV-1 (D-37): the tools whose contacts only the principal's
 * visibility clause bounds are known from the dispatcher itself, not from a hand list.
 *
 * FlowOrchestratorService.contactReadAccess returns the principal's clause, or null with no principal
 * (the OWNER's view). Every dispatcher case that reaches it (directly, or through a private helper
 * such as calendarContactScope) therefore reads or writes the whole book when the plan queue or a
 * plan approval runs it with no principal, so graphActionRequirement must keep such a tool to the
 * OWNER there and graphPlanReadScope must show its stored output to the OWNER only
 * (graphActionBoundByContactVisibility). The packet listed fetch_client_health and
 * sequence_enroll_overdue and missed calendar_list_events, calendar_check_conflicts,
 * bookings_list_bookings and bookings_list_waitlist (V1-84) and sequence_enroll (SEC-W3CV-4).
 *
 * A static census (TypeScript AST over flow-orchestrator.service.ts): the class's methods that reach
 * contactReadAccess, then every case group of executeToolAction's `switch (toolName)` that calls one
 * of them. Its negative control plants a dispatcher with a helper-mediated reader and a case that
 * only names the helper in a comment.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { graphActionBoundByContactVisibility, graphActionRequirement } from './graph-actions.controller';

const READER = 'contactReadAccess';
const DISPATCHER = 'executeToolAction';

/** The tools of every case group of the dispatcher switch that reaches contactReadAccess. */
function visibilityBoundCases(source: string): string[] {
  const sf = ts.createSourceFile('dispatcher.ts', source, ts.ScriptTarget.Latest, true);
  const methods = new Map<string, ts.MethodDeclaration>();
  const collect = (n: ts.Node) => {
    if (ts.isMethodDeclaration(n) && n.body && ts.isIdentifier(n.name)) methods.set(n.name.text, n);
    ts.forEachChild(n, collect);
  };
  collect(sf);
  const thisCalls = (node: ts.Node): Set<string> => {
    const names = new Set<string>();
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
        names.add(n.expression.name.text);
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return names;
  };

  // The helpers that reach the reader, transitively; the dispatcher itself is not one (a case that
  // re-enters it, such as execute_custom_logic, is judged by the tool it runs, not here).
  const readers = new Set<string>([READER]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, method] of methods) {
      if (readers.has(name) || name === DISPATCHER) continue;
      if ([...thisCalls(method)].some((c) => readers.has(c))) {
        readers.add(name);
        grew = true;
      }
    }
  }

  const dispatcher = methods.get(DISPATCHER);
  if (!dispatcher?.body) throw new Error(`${DISPATCHER} not found`);
  let sw: ts.SwitchStatement | undefined;
  const findSwitch = (n: ts.Node) => {
    if (!sw && ts.isSwitchStatement(n) && n.expression.getText(sf) === 'toolName') sw = n;
    ts.forEachChild(n, findSwitch);
  };
  findSwitch(dispatcher.body);
  if (!sw) throw new Error('the dispatcher switch (switch (toolName)) not found');

  const bound: string[] = [];
  let labels: string[] = [];
  for (const clause of sw.caseBlock.clauses) {
    if (ts.isCaseClause(clause) && ts.isStringLiteral(clause.expression)) labels.push(clause.expression.text);
    if (clause.statements.length === 0) continue; // falls through to the next clause's body
    const calls = new Set<string>();
    for (const statement of clause.statements) for (const c of thisCalls(statement)) calls.add(c);
    if ([...calls].some((c) => readers.has(c))) bound.push(...labels);
    labels = [];
  }
  return bound.sort();
}

const dispatcherSource = () => readFileSync(join(__dirname, 'flow-orchestrator.service.ts'), 'utf8');

describe('W3-KEY-CRM-VISIBILITY review SEC-W3CV-1 (D-37): every dispatcher case the principal\'s visibility clause bounds is the OWNER\'s only with no principal', () => {
  it('finds the cases it exists for (contact reads, the packet\'s tools, the V1-84 calendar and booking reads, sequence_enroll)', () => {
    const cases = visibilityBoundCases(dispatcherSource());
    for (const tool of [
      'crm_list_contacts',
      'crm_find_duplicates',
      'segment_contacts',
      'create_followup_queue',
      'fetch_client_health',
      'sequence_enroll_overdue',
      'sequence_enroll',
      'calendar_list_events',
      'calendar_check_conflicts',
      'bookings_list_bookings',
      'bookings_list_waitlist',
    ]) {
      expect(cases, tool).toContain(tool);
    }
  });

  it('SEC-W3CV-1 (D-37): each such tool is graphActionBoundByContactVisibility, and with no principal its requirement is the OWNER\'s only', () => {
    const cases = visibilityBoundCases(dispatcherSource());
    expect(cases.filter((tool) => !graphActionBoundByContactVisibility(tool))).toEqual([]);
    const notOwnerOnly = cases.filter((tool) => {
      const requirement = graphActionRequirement(tool);
      if (!requirement || 'refused' in requirement) return false; // refused to everyone
      return !(requirement.ownerOnly ?? requirement.ownerOnlyWithoutPrincipal);
    });
    expect(notOwnerOnly).toEqual([]);
  });

  it('negative control: the census follows a helper that reaches the reader, and ignores a case that only mentions it', () => {
    const planted = `
      class FlowOrchestratorService {
        private async contactReadAccess(businessId: string, action?: unknown) { return null; }
        private async scopeFor(businessId: string, action?: unknown) { return this.contactReadAccess(businessId, action); }
        private async executeToolAction(businessId: string, toolName: string, args: any, action?: unknown) {
          switch (toolName) {
            case 'planted_direct': {
              const r = await this.contactReadAccess(businessId, action);
              return r;
            }
            case 'planted_alias':
            case 'planted_helper': {
              return this.scopeFor(businessId, action);
            }
            case 'planted_comment': {
              // this.contactReadAccess(businessId, action) is not called here
              return this.other();
            }
            default:
              return this.executeToolAction(businessId, args.tool, args, action);
          }
        }
        private other() { return null; }
      }`;
    expect(visibilityBoundCases(planted)).toEqual(['planted_alias', 'planted_direct', 'planted_helper']);
  });
});
