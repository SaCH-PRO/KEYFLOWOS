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
    // nothing. Any other proposal runs as before.
    let plan: { memberId: string | null; refusal: string | null } | undefined;
    try {
      plan = await this.planStepAuthority(businessId, proposal, payload.planContext?.planId, toolName);
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (plan?.refusal) {
      return { success: false, error: `Refused: ${plan.refusal}` };
    }

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
        // requires both planId and planStepId.
        const result = await orchestrator.executeToolDirectly(
          businessId,
          toolName,
          args as Record<string, any>,
          payload.planContext,
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
          // narrows that member's run.
          {
            surface: 'PROPOSAL',
            actionId: proposal.id,
            onBehalfOfUserId: [executedBy, proposal.approvedBy, proposal.userId].find((id): id is string => !!id && !isSystemActor(id)) ?? null,
            ...(plan?.memberId ? { principalUserId: plan.memberId } : {}),
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
   * W4-PROPOSAL-PRINCIPAL (D-73, D-71, D-46; review SEC-W3CV-3). For a plan
   * step's proposal (sourceType AI_PLAN, or one that names a plan): the plan's
   * member and why that member may not run `toolName` now, by the rule the
   * plan queue applies at run time (planStepRunAuthority, read against the plan
   * as stored, in this business), with the member as the run's principal. A
   * proposal that names no plan has no member (noMemberToolRefusal). Undefined
   * for any other proposal, which runs as before.
   */
  private async planStepAuthority(
    businessId: string,
    proposal: KeyActionProposalData,
    payloadPlanId: string | undefined,
    toolName: string,
  ): Promise<{ memberId: string | null; refusal: string | null } | undefined> {
    if (proposal.sourceType !== 'AI_PLAN' && !proposal.planId) return undefined;
    // Kept off the static import graph, as the queue worker and the flow
    // orchestrator load it: plan-step-authority imports graph-actions.controller.
    const { noMemberToolRefusal, planStepRunAuthority } = await import('../ai/plan-step-authority');
    // The plan the step is attributed to (payload.planContext, forwarded below) is the plan judged.
    if (proposal.planId && payloadPlanId && proposal.planId !== payloadPlanId) {
      return { memberId: null, refusal: 'This proposal names two different plans, so it is not run as a plan step' };
    }
    const planId = proposal.planId ?? payloadPlanId;
    if (!planId) return { memberId: null, refusal: noMemberToolRefusal(toolName) };
    const prisma = this.moduleRef.get(PrismaService, { strict: false });
    return planStepRunAuthority(prisma, businessId, planId, toolName, { memberIsPrincipal: true });
  }
}
