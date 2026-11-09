import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { isSystemActor } from '../../core/auth/system-actor';
import { PrismaService } from '../../core/prisma/prisma.service';
import { FlowOrchestratorService } from '../ai/flow-orchestrator.service';
import type {
  ExecutionOutcome,
  KeyActionExecutorPlugin,
} from '../key-autonomy/key-action-executor-plugin.interface';
import { KeyActionExecutorRegistryService } from '../key-autonomy/key-action-executor-registry.service';
import type { KeyActionProposalData } from '../key-autonomy/key-action-proposal.types';
import {
  KeyCortexToolRegistryService,
  KeyCortexToolContext,
} from './key-cortex-tool-registry.service';

@Injectable()
export class KeyCortexActionExecutorPlugin
  implements OnModuleInit, KeyActionExecutorPlugin
{
  readonly name = 'key-cortex-execute-tool';

  constructor(
    @Inject(KeyActionExecutorRegistryService)
    private readonly registry: KeyActionExecutorRegistryService,
    @Inject(KeyCortexToolRegistryService)
    private readonly toolRegistry: KeyCortexToolRegistryService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  canExecute(actionType: string): boolean {
    return actionType === 'EXECUTE_TOOL';
  }

  async execute(
    businessId: string,
    proposal: KeyActionProposalData,
    executedBy?: string,
  ): Promise<ExecutionOutcome> {
    const payload = (proposal.payload ?? {}) as {
      toolName?: string;
      /** What PlanExecutorService actually writes. */
      inputPayload?: Record<string, unknown>;
      /** Legacy/alternate key, kept as a fallback. */
      parameters?: Record<string, unknown>;
      planContext?: { planId: string; planStepId: string };
      sessionId?: string;
      correlationId?: string;
      autonomyLevel?: number;
    };

    const toolName = payload.toolName;
    if (!toolName) {
      return { success: false, error: 'EXECUTE_TOOL proposal missing payload.toolName' };
    }

    // `inputPayload` FIRST. PlanExecutorService.createStepProposal writes
    // `payload.inputPayload`; this plugin read `payload.parameters`, so every
    // approved plan step executed with `{}` and failed required-field
    // validation — on top of the registry mismatch below.
    const args = payload.inputPayload ?? payload.parameters ?? {};

    // W4-PROPOSAL-PRINCIPAL (owner rulings D-73, D-71, D-46; review
    // SEC-W3CV-3): an AI_PLAN proposal is a stored plan step that needed
    // approval, and a KEY plan always runs as its member (D-73). Before this it
    // ran here with surface PROPOSAL, no principal and no plan-step rule, for
    // every tool: a STAFF member's step read and wrote the whole book once
    // someone approved it, and a plan with no member read contacts and wrote
    // money. It now runs as the plan's member (the principal, so the
    // dispatcher's contact reads apply that member's visibility) and only if
    // the plan queue's run rule lets that member run it (planStepRunAuthority:
    // module scopes D-71, owner-only tools, D-46); a plan with no member, or a
    // proposal that names no plan, is held to noMemberToolRefusal (no contact
    // read, no money or invoice write). Checked before either registry is
    // reached, as the queue checks before it dispatches: a refused step runs
    // nothing.
    //
    // Review repairs (SEC-W4PP-1, CR-W4PP-1, SEC-W4PP-2, CR-W4PP-2): a plan
    // step's proposal is known by its stored planId alone, a column only the
    // server writes (PlanExecutorService.createStepProposal; POST
    // .../actions/proposals stores the client's sourceType and payload, never
    // a planId), so no payload chooses the member a proposal runs as; a
    // payload.planContext naming a plan the proposal was not filed for is
    // refused. Every other flow-tool proposal runs only if the member it runs
    // for may run the tool with no principal (runAuthority).
    let authority: ProposalRunAuthority;
    try {
      authority = await this.runAuthority(businessId, proposal, payload.planContext, toolName, executedBy);
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (authority.refusal) {
      return { success: false, error: `Refused: ${authority.refusal}` };
    }
    const plan = authority.plan;

    // Route by name shape. There are two disjoint tool vocabularies in this
    // server and they share ZERO names: the cortex registry uses dotted
    // namespaces (`cortex.create_task`, `key_inbox.send_reply`), while
    // FLOW_TOOLS — the 118 tools the shipped chat and the planner both use —
    // are bare snake_case (`commerce_create_invoice`).
    //
    // This plugin sent everything to the cortex registry, so every proposal
    // originating from a plan or from ProAutoMonitor failed with
    // `Tool "..." not found in canonical registry`. Approval was a dead end
    // for 100% of flow-named actions, which is every action a plan produces.
    if (!toolName.includes('.')) {
      try {
        // Resolved through ModuleRef rather than the constructor: AiModule and
        // KeyCortexModule forwardRef each other at the module level, and a
        // constructor edge would add a boot-graph dependency for something
        // only needed at execution time. The import is static and safe —
        // flow-orchestrator pulls in two key-cortex *service* files and
        // nothing that leads back to this plugin, so there is no file cycle.
        const orchestrator = this.moduleRef.get(FlowOrchestratorService, {
          strict: false,
        });

        // planContext is forwarded so an approved step is still attributed to
        // its plan — that is what lets FeedbackLoopService engage, since it
        // requires both planId and planStepId. Review SEC-W4PP-1: the plan as
        // stored on the proposal, never the payload's own object (no other key
        // of it, such as an actorUserId the execution log is attributed to).
        const result = await orchestrator.executeToolDirectly(
          businessId,
          toolName,
          args as Record<string, any>,
          plan?.planContext,
          // KF-EXEC-ACTION-001: the proposal is the action record. A capability
          // the action boundary has adopted is admitted by this id, against
          // the envelope sealed on the proposal, never by these arguments.
          //
          // W3-D64-COMMERCE-CREATE review (SEC-W3D64-3a; D-64, D-88): the
          // member who runs the approved action (else who approved it, else
          // who asked, as the cortex branch below runs as the executor, else
          // the requester) rides beside it, not as a principal: KEY's
          // commerce writes judge the contact they bind by that member's CRM
          // view, so an approver binds no contact they may not open. KEY's
          // own ids (executeApproved with no user runs as 'key_ai') are no
          // member.
          //
          // W4-PROPOSAL-PRINCIPAL (D-73): a plan step's proposal runs as the
          // plan's member, its principal; the approver neither widens nor
          // narrows that member's run. Review CR-W4PP-2: an owner by
          // Business.ownerId alone (no membership row) is no principal the
          // dispatcher's CRM reads can resolve; their step runs with none (the
          // whole book, their own view), as the plan queue runs it.
          {
            surface: 'PROPOSAL',
            actionId: proposal.id,
            onBehalfOfUserId: [executedBy, proposal.approvedBy, proposal.userId].find((id): id is string => !!id && !isSystemActor(id)) ?? null,
            ...(plan?.principalId ? { principalUserId: plan.principalId } : {}),
          },
        );

        return { success: true, result: result as Record<string, unknown> | undefined };
      } catch (err: unknown) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    const ctx: KeyCortexToolContext = {
      businessId,
      // W4-PROPOSAL-PRINCIPAL (D-73): a plan step's proposal runs as the plan's member.
      userId: plan ? (plan.memberId ?? undefined) : (executedBy ?? proposal.userId ?? undefined),
      sessionId: payload.sessionId,
      correlationId: payload.correlationId,
      autonomyLevel: payload.autonomyLevel ?? 4,
      // This plugin only ever runs an APPROVED proposal — that is the whole
      // contract of KeyActionExecutorPlugin. Without this flag a tier-3 tool
      // could never execute: checkRisk refuses tier 3 at every autonomy level,
      // so the approval bounced off the same gate that raised it and filed
      // another proposal. Safety limits and the kill switch still apply.
      preApproved: true,
    };

    const result = await this.toolRegistry.execute(toolName, ctx, args);

    return {
      success: result.success,
      result: result.data as Record<string, unknown> | undefined,
      error: result.error,
    };
  }

  /**
   * Who a proposal runs as, and why it may not run `toolName` now.
   *
   * W4-PROPOSAL-PRINCIPAL (D-73, D-71, D-46; review SEC-W3CV-3), a plan step's
   * proposal: the plan's member and why that member may not run `toolName`
   * now, by the rule the plan queue applies at run time (planStepRunAuthority,
   * read against the plan as stored, in this business), with the member as the
   * run's principal.
   *
   * Review SEC-W4PP-1 / CR-W4PP-1: a plan step's proposal is one with a stored
   * planId, a column only the server writes. The client-controlled fields
   * (sourceType, payload) never choose the plan, so they never choose the
   * member: a payload.planContext that names a plan the proposal was not
   * filed for (another plan, or any plan when none is stored) is refused, and
   * an AI_PLAN proposal with no stored plan is a plan step with no member
   * (noMemberToolRefusal, D-73).
   *
   * Review SEC-W4PP-2: any other flow-tool proposal (MANUAL, KEY_CORTEX, ...,
   * and an AI_PLAN one with no stored plan) runs, with no principal, only if
   * the member it runs for (who executes it, else who approved it, else who
   * asked: the member KEY-04 binds contacts for, D-64/D-88) may run the tool
   * with no principal (memberToolRunAuthority: the approve rule, so a contact
   * read no visibility clause bounds is the OWNER's only; module scopes D-71;
   * D-46); with no member, noMemberToolRefusal (D-73). A KEY-cortex (dotted)
   * tool keeps its own registry's rules.
   */
  private async runAuthority(
    businessId: string,
    proposal: KeyActionProposalData,
    planContext: { planId?: string; planStepId?: string } | undefined,
    toolName: string,
    executedBy: string | undefined,
  ): Promise<ProposalRunAuthority> {
    // Kept off the static import graph, as the queue worker and the flow
    // orchestrator load it: plan-step-authority imports graph-actions.controller.
    const { memberToolRunAuthority, noMemberToolRefusal, planStepRunAuthority } = await import('../ai/plan-step-authority');
    const prisma = () => this.moduleRef.get(PrismaService, { strict: false });
    const named = planContext?.planId;
    if (proposal.planId) {
      // The plan the step is attributed to (forwarded to the dispatcher) is the plan judged.
      if (named && named !== proposal.planId) {
        return { refusal: 'This proposal names two different plans, so it is not run as a plan step' };
      }
      const run = await planStepRunAuthority(prisma(), businessId, proposal.planId, toolName, { memberIsPrincipal: true });
      const planStepId = proposal.planStepId ?? planContext?.planStepId;
      return {
        refusal: run.refusal,
        plan: {
          memberId: run.memberId,
          principalId: run.principalId,
          planContext: planStepId ? { planId: proposal.planId, planStepId } : undefined,
        },
      };
    }
    if (named) {
      return { refusal: `This proposal's payload names a plan it was not filed for (${named}), so it is not run` };
    }
    let plan: ProposalRunAuthority['plan'];
    if (proposal.sourceType === 'AI_PLAN') {
      const refusal = noMemberToolRefusal(toolName);
      if (refusal) return { refusal };
      plan = { memberId: null, principalId: null };
    }
    if (toolName.includes('.')) return { refusal: null, plan };
    const member = [executedBy, proposal.approvedBy, proposal.userId].find((id): id is string => !!id && !isSystemActor(id));
    if (!member) return { refusal: noMemberToolRefusal(toolName), plan };
    const run = await memberToolRunAuthority(prisma(), businessId, member, toolName);
    return { refusal: run.refusal, plan };
  }
}

/**
 * What KeyCortexActionExecutorPlugin.runAuthority answers: why the proposal is
 * not run (null when it is) and, for a plan step's proposal (a stored plan, or
 * an AI_PLAN one with none), the plan's member, the dispatcher's principal and
 * the plan context it is attributed to.
 */
interface ProposalRunAuthority {
  refusal: string | null;
  plan?: {
    memberId: string | null;
    principalId: string | null;
    planContext?: { planId: string; planStepId: string };
  };
}
