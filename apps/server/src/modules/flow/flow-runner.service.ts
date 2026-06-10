import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { FlowActionRegistry, ActionContext } from './flow-action.registry';

interface FlowNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

interface FlowEdge {
  source: string;
  target: string;
}

@Injectable()
export class FlowRunnerService {
  private readonly logger = new Logger(FlowRunnerService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FlowActionRegistry) private readonly registry: FlowActionRegistry,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
  ) {}

  async runFlow(
    businessId: string,
    flowId: string,
    triggerPayload: Record<string, unknown>,
  ) {
    const flow = await this.prisma.client.automationFlow.findFirst({
      where: { id: flowId, businessId, deletedAt: null },
    });
    if (!flow) throw new Error('Flow not found');
    if (flow.status !== 'ACTIVE') throw new Error('Flow is not active');

    // Check idempotency
    const idempotencyKey = triggerPayload.idempotencyKey as string | undefined;
    if (idempotencyKey) {
      const existing = await this.prisma.client.flowRun.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        this.logger.log(`Idempotent run skipped for key ${idempotencyKey}`);
        return existing;
      }
    }

    const version = await this.prisma.client.flowVersion.findFirst({
      where: { flowId, status: 'PUBLISHED' },
      orderBy: { version: 'desc' },
    });
    if (!version) throw new Error('No published version found');

    const nodes = (version.nodes as unknown as FlowNode[]) ?? [];
    const edges = (version.edges as unknown as FlowEdge[]) ?? [];

    const run = await this.prisma.client.flowRun.create({
      data: {
        businessId,
        flowId,
        flowVersionId: version.id,
        sourceEventId: (triggerPayload.sourceEventId as string) || null,
        contactId: (triggerPayload.contactId as string) || null,
        status: 'RUNNING',
        input: triggerPayload,
        output: {},
        idempotencyKey: idempotencyKey ?? null,
      },
    });
    this.realtime.emit({
      businessId,
      type: 'flow.run_started',
      payload: { runId: run.id, flowId, status: 'RUNNING' },
    });

    try {
      await this.executeNodes(run.id, businessId, flowId, nodes, edges, triggerPayload);
      const updated = await this.prisma.client.flowRun.update({
        where: { id: run.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      this.realtime.emit({
        businessId,
        type: 'flow.run_completed',
        payload: { runId: run.id, flowId, status: 'COMPLETED' },
      });
      await this.writeTimeline(businessId, flowId, run.id, 'flow_completed', triggerPayload);
      return updated;
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      const updated = await this.prisma.client.flowRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', error, completedAt: new Date() },
      });
      this.realtime.emit({
        businessId,
        type: 'flow.run_failed',
        payload: { runId: run.id, flowId, status: 'FAILED', error },
      });
      await this.writeTimeline(businessId, flowId, run.id, 'flow_failed', { ...triggerPayload, error });
      return updated;
    }
  }

  private async executeNodes(
    runId: string,
    businessId: string,
    flowId: string,
    nodes: FlowNode[],
    edges: FlowEdge[],
    triggerPayload: Record<string, unknown>,
  ) {
    const triggerNode = nodes.find((n) => n.type === 'trigger');
    if (!triggerNode) throw new Error('No trigger node found');

    const adjacency = new Map<string, string[]>();
    for (const e of edges) {
      const list = adjacency.get(e.source) ?? [];
      list.push(e.target);
      adjacency.set(e.source, list);
    }

    const queue: string[] = [triggerNode.id];
    const visited = new Set<string>();
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // Simple cycle detection: if queue grows beyond node count, we have a cycle
    const maxIterations = nodes.length * 2;
    let iterations = 0;

    while (queue.length > 0) {
      iterations++;
      if (iterations > maxIterations) {
        throw new Error('Possible cycle detected in flow graph');
      }

      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const node = nodeMap.get(nodeId);
      if (!node) continue;

      await this.prisma.client.flowRun.update({
        where: { id: runId },
        data: { currentNodeId: nodeId },
      });
      this.realtime.emit({
        businessId,
        type: 'flow.node_changed',
        payload: { runId, nodeId, nodeType: node.type },
      });

      const shouldContinue = await this.executeNode(runId, businessId, flowId, node, triggerPayload);
      if (!shouldContinue) break;

      const nextIds = adjacency.get(nodeId) ?? [];
      for (const nextId of nextIds) {
        if (!visited.has(nextId)) queue.push(nextId);
      }
    }
  }

  /**
   * Execute a single node. Returns false if execution should stop (e.g. condition not met).
   */
  private async executeNode(
    runId: string,
    businessId: string,
    flowId: string,
    node: FlowNode,
    triggerPayload: Record<string, unknown>,
  ): Promise<boolean> {
    const step = await this.prisma.client.flowRunStep.create({
      data: {
        runId,
        nodeId: node.id,
        nodeType: node.type,
        status: 'RUNNING',
        input: node.data as any,
        startedAt: new Date(),
      },
    });

    try {
      if (node.type === 'trigger') {
        await this.completeStep(step.id, { triggered: true, type: node.data.triggerType });
        return true;
      }

      if (node.type === 'delay') {
        const seconds = (node.data.seconds as number) || 0;
        const hours = (node.data.hours as number) || 0;
        const totalMs = (seconds * 1000) + (hours * 3600 * 1000);
        // Persist delay intent but do not block execution for long delays
        // In production, this should queue to BullMQ
        if (totalMs > 0 && totalMs <= 30000) {
          await new Promise((res) => setTimeout(res, totalMs));
        }
        await this.completeStep(step.id, { delayed: true, ms: totalMs, persisted: totalMs > 30000 });
        return true;
      }

      if (node.type === 'condition') {
        const result = this.evaluateCondition(node.data, triggerPayload);
        await this.completeStep(step.id, { conditionMet: result });
        // If condition is not met, stop traversing this branch
        return result;
      }

      if (node.type === 'action') {
        const actionType = node.data.actionType as string;
        if (!actionType) {
          throw new Error('Action node missing actionType');
        }
        const executor = this.registry.get(actionType);
        if (!executor) {
          throw new Error(`Unknown action type: ${actionType}`);
        }
        const ctx: ActionContext = {
          businessId,
          flowId,
          runId,
          contactId: (triggerPayload.contactId as string) || null,
          userId: (triggerPayload.userId as string) || null,
          input: { nodeId: node.id, ...node.data },
        };
        const output = await executor(ctx, node.data);
        await this.completeStep(step.id, output);
        return true;
      }

      if (node.type === 'key_step') {
        await this.completeStep(step.id, { keyStep: true, simulated: true });
        return true;
      }

      await this.completeStep(step.id, { unknownNodeType: node.type });
      return true;
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      await this.failStep(step.id, error);
      throw err;
    }
  }

  private async completeStep(stepId: string, output: Record<string, unknown>) {
    await this.prisma.client.flowRunStep.update({
      where: { id: stepId },
      data: { status: 'COMPLETED', output: output as any, completedAt: new Date() },
    });
  }

  private async failStep(stepId: string, error: string) {
    await this.prisma.client.flowRunStep.update({
      where: { id: stepId },
      data: { status: 'FAILED', error, completedAt: new Date() },
    });
  }

  private evaluateCondition(data: Record<string, unknown>, payload: Record<string, unknown>): boolean {
    const conditionType = data.conditionType as string;
    if (!conditionType) return true;

    switch (conditionType) {
      case 'if_message_contains': {
        const keywords = (data.keywords as string[]) || [];
        const text = String(payload.body || payload.message || '').toLowerCase();
        return keywords.some((k) => text.includes(k.toLowerCase()));
      }
      case 'if_amount_over': {
        const amount = Number(data.amount) || 0;
        const value = Number(payload.amount || payload.total || 0);
        return value > amount;
      }
      case 'if_contact_new': {
        return payload.isNewContact === true;
      }
      case 'if_channel': {
        const channel = data.channel as string;
        return String(payload.channel || '') === channel;
      }
      default:
        return true;
    }
  }

  async findRuns(businessId: string, flowId: string, filters: {
    status?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: Record<string, unknown> = { businessId, flowId };
    if (filters.status) where.status = filters.status;

    const [items, total] = await Promise.all([
      this.prisma.client.flowRun.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        take: filters.limit ?? 25,
        skip: filters.offset ?? 0,
        select: {
          id: true,
          businessId: true,
          flowId: true,
          flowVersionId: true,
          status: true,
          startedAt: true,
          completedAt: true,
          currentNodeId: true,
          error: true,
          input: true,
          output: true,
          metrics: true,
          contactId: true,
          sourceEventId: true,
          _count: { select: { steps: true } },
        },
      }),
      this.prisma.client.flowRun.count({ where }),
    ]);

    return { items, total };
  }

  async findRunSteps(runId: string) {
    return this.prisma.client.flowRunStep.findMany({
      where: { runId },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async writeTimeline(
    businessId: string,
    flowId: string,
    runId: string,
    action: string,
    metadata: Record<string, unknown>,
  ) {
    try {
      await this.prisma.client.businessEvent.create({
        data: {
          businessId,
          source: 'FLOW',
          eventType: 'flow_run',
          subjectType: 'flow_run',
          subjectId: runId,
          actorType: 'system',
          actorId: 'flow_runner',
          action,
          metadata: {
            flowId,
            ...metadata,
          },
        },
      });
    } catch (e) {
      this.logger.error(`Failed to write timeline event: ${(e as Error).message}`);
    }
  }
}
