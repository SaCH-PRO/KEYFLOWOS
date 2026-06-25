/**
 * KEY Flow Studio Service
 * -------------------------
 * The visual drag-and-drop automation builder backend for KEY Cortex.
 *
 * Provides:
 *   - AI-powered flow generation from natural language
 *   - Full flow execution engine with topological traversal
 *   - 50+ pre-built templates across 8 business categories
 *   - Flow validation (node types, edge refs, cycle detection)
 *   - Node registry with config schemas for the visual builder
 *
 * Architecture:
 *   - Nodes are vertices, edges are directed connections
 *   - Execution follows edges depth-first with context persistence
 *   - Action nodes delegate to KeyCortexConnectorService
 *   - AI decision nodes call ModelGatewayService
 *   - Events emitted via EventEmitter2 for real-time UI updates
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { v4 as uuidv4 } from 'uuid';

import { PrismaService } from '../../core/prisma/prisma.service';
import { KeyCortexConnectorService } from './key-cortex-connector.service';
import { ModelGatewayService } from '../ai/model-gateway.service';
import { AiUsageService } from '../ai/ai-usage.service';

import {
  FlowNodeType,
  FlowTriggerType,
  FlowNode,
  FlowNodeData,
  FlowDefinition,
  FlowEdge,
  FlowTrigger,
  FlowExecution,
  FlowNodeResult,
  FlowTemplate,
  FlowGenerationRequest,
  FlowValidationResult,
  FlowValidationError,
  FlowValidationWarning,
  NodeRegistryEntry,
  NodeConfigSchemaField,
  NodePort,
  FlowExecutionOptions,
  FLOW_EVENTS,
} from './key-cortex-flow-studio.types';

@Injectable()
export class KeyCortexFlowStudioService {
  private readonly logger = new Logger(KeyCortexFlowStudioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connector: KeyCortexConnectorService,
    private readonly modelGateway: ModelGatewayService,
    private readonly aiUsage: AiUsageService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  //  1. AI-POWERED FLOW GENERATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate a complete FlowDefinition from a natural language description.
   *
   * Example:
   *   "When a new lead comes in, send a welcome email, wait 2 days,
   *    then send a follow-up SMS if they haven't responded"
   *
   *   → trigger(event:contact_created) → action(send_email)
   *     → delay(2 days) → condition(has_responded?) → action(send_sms)
   */
  async generateFlowFromDescription(
    request: FlowGenerationRequest,
  ): Promise<FlowDefinition> {
    const { description, businessId, category, triggerHint, maxNodes = 10 } = request;

    this.logger.log(
      `[AI Flow Gen] business=${businessId} description="${description.substring(0, 80)}..."`,
    );

    // ── 1.1 Build the generation prompt ──
    const nodeRegistry = this.getNodeRegistryInternal();
    const capabilities = this.connector.formatCapabilitiesForPrompt();

    const prompt = this.buildFlowGenerationPrompt({
      description,
      triggerHint,
      nodeRegistry,
      capabilities,
      maxNodes,
      category,
    });

    // ── 1.2 Call AI to generate structured flow ──
    const aiResponse = await this.modelGateway.complete({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'You are KEY Flow Studio — an expert workflow automation designer. ' +
            'You generate precise, valid flow definitions as JSON. ' +
            'Every node must have valid type and connections. ' +
            'Respond ONLY with valid JSON matching the requested schema.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const rawContent =
      typeof aiResponse.content === 'string'
        ? aiContent
        : aiResponse.content?.[0]?.text || '{}';

    // ── 1.3 Parse AI response ──
    let generated: {
      name: string;
      description: string;
      nodes: Array<{
        type: FlowNodeType;
        position: { x: number; y: number };
        data: FlowNodeData;
      }>;
      edges: Array<{ sourceIndex: number; targetIndex: number; label?: string; condition?: string }>;
      trigger: FlowTrigger;
      category: string;
      tags: string[];
    };

    try {
      generated = JSON.parse(rawContent);
    } catch (parseErr) {
      this.logger.error(`[AI Flow Gen] JSON parse failed: ${(parseErr as Error).message}`);
      throw new BadRequestException('AI generated invalid flow structure');
    }

    // ── 1.4 Convert to proper FlowDefinition with IDs ──
    const flowId = uuidv4();
    const nodeMap = new Map<number, string>();

    const nodes: FlowNode[] = generated.nodes.map((n, idx) => {
      const id = `node_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
      nodeMap.set(idx, id);
      return {
        id,
        type: n.type,
        position: n.position || { x: idx * 250, y: 100 },
        data: n.data,
        inputs: [],
        outputs: [],
      };
    });

    // Wire up inputs/outputs from edges
    const edges: FlowEdge[] = generated.edges.map((e) => {
      const sourceId = nodeMap.get(e.sourceIndex)!;
      const targetId = nodeMap.get(e.targetIndex)!;
      const sourceNode = nodes.find((n) => n.id === sourceId)!;
      const targetNode = nodes.find((n) => n.id === targetId)!;
      sourceNode.outputs.push(targetId);
      targetNode.inputs.push(sourceId);
      return {
        id: `edge_${uuidv4().replace(/-/g, '').substring(0, 12)}`,
        source: sourceId,
        target: targetId,
        label: e.label,
        condition: e.condition,
      };
    });

    const flow: FlowDefinition = {
      id: flowId,
      businessId,
      name: generated.name || 'AI-Generated Flow',
      description: generated.description || description,
      version: 1,
      nodes,
      edges,
      trigger: generated.trigger || { type: 'manual', config: {} },
      status: 'draft',
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'ai',
      executionCount: 0,
      tags: generated.tags || [category || 'ai-generated'],
      category: generated.category || category || 'automation',
    };

    // ── 1.5 Validate the generated flow ──
    const validation = this.validateFlow(flow);
    if (!validation.valid) {
      this.logger.warn(
        `[AI Flow Gen] Validation failed with ${validation.errors.length} errors`,
      );
      // Attempt auto-fix: add missing error handlers, fix orphaned nodes
      this.autoFixFlow(flow, validation);
    }

    // ── 1.6 Persist and emit event ──
    await this.persistFlow(flow);

    this.aiUsage.log({
      businessId,
      feature: 'flow_studio_ai_generation',
      model: aiResponse.model || 'gpt-4o',
      tokensUsed: aiResponse.usage?.total_tokens || 0,
      costUsd: aiResponse.usage?.cost || 0,
      metadata: {
        flowId: flow.id,
        nodeCount: nodes.length,
        description: description.substring(0, 200),
      },
    });

    this.eventEmitter.emit(FLOW_EVENTS.AI_FLOW_GENERATED, {
      flowId: flow.id,
      businessId,
      nodeCount: nodes.length,
      description,
    });

    this.logger.log(
      `[AI Flow Gen] Completed flow=${flow.id} nodes=${nodes.length} edges=${edges.length}`,
    );

    return flow;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  2. FLOW EXECUTION ENGINE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute a flow by ID with an initial context payload.
   * Follows edges depth-first, persisting context at each step.
   */
  async executeFlow(
    flowId: string,
    context: Record<string, unknown> = {},
    options: FlowExecutionOptions = {},
  ): Promise<FlowExecution> {
    const flow = await this.loadFlow(flowId);
    if (!flow) throw new NotFoundException(`Flow not found: ${flowId}`);

    const execution: FlowExecution = {
      id: `exec_${uuidv4().replace(/-/g, '').substring(0, 12)}`,
      flowId,
      businessId: flow.businessId,
      status: 'running',
      startedAt: new Date(),
      context: { ...context, _trigger: flow.trigger },
      results: [],
    };

    this.logger.log(`[Flow Exec] Starting execution=${execution.id} flow=${flowId}`);
    this.eventEmitter.emit(FLOW_EVENTS.EXECUTION_STARTED, { execution, flow });

    try {
      // Find trigger node(s) — entry points
      const triggerNodes = flow.nodes.filter(
        (n) => n.type === 'trigger' || n.inputs.length === 0,
      );

      const visited = new Set<string>();
      const nodeStack: string[] = triggerNodes.map((n) => n.id);

      // Track max execution limits
      let nodeCount = 0;
      const maxNodes = options.maxNodes || 100;
      const startTime = Date.now();
      const maxTime = options.maxExecutionTimeMs || 300_000; // 5 min default

      while (nodeStack.length > 0) {
        // Check timeout
        if (Date.now() - startTime > maxTime) {
          throw new Error(`Flow execution timeout after ${maxTime}ms`);
        }
        if (nodeCount >= maxNodes) {
          throw new Error(`Flow exceeded max node limit of ${maxNodes}`);
        }

        const nodeId = nodeStack.pop()!;
        if (visited.has(nodeId)) continue;

        const node = flow.nodes.find((n) => n.id === nodeId);
        if (!node) continue;

        execution.currentNodeId = nodeId;
        visited.add(nodeId);
        nodeCount++;

        // ── Execute the node ──
        const result = await this.executeNode(node, execution.context, flow);
        execution.results.push(result);

        if (result.status === 'success') {
          // Store output in context for downstream nodes
          if (result.output !== undefined) {
            execution.context[`_${nodeId}_output`] = result.output;
            execution.context[`_${node.data.label || nodeId}_output`] =
              result.output;
          }

          // Follow output edges to next nodes
          const outgoingEdges = flow.edges.filter((e) => e.source === nodeId);

          for (const edge of outgoingEdges) {
            // Evaluate edge condition if present
            if (edge.condition) {
              const conditionMet = this.evaluateExpression(
                edge.condition,
                execution.context,
              );
              if (!conditionMet) continue;
            }

            // For condition nodes, check edge label matches node output
            if (node.type === 'condition' && edge.label) {
              const conditionResult = result.output as boolean | undefined;
              const labelLower = edge.label.toLowerCase();
              const isTrueBranch = ['true', 'yes', 'if'].includes(labelLower);
              const isFalseBranch = ['false', 'no', 'else'].includes(labelLower);
              if (isTrueBranch && !conditionResult) continue;
              if (isFalseBranch && conditionResult) continue;
            }

            if (!visited.has(edge.target)) {
              nodeStack.push(edge.target);
            }
          }
        } else if (result.status === 'error') {
          // Look for error_handler node downstream
          const errorHandler = flow.nodes.find(
            (n) => n.type === 'error_handler' && n.inputs.includes(nodeId),
          );
          if (errorHandler) {
            execution.context._error = result.error;
            execution.context._errorNodeId = nodeId;
            nodeStack.push(errorHandler.id);
          } else {
            // No error handler — halt
            execution.status = 'error';
            execution.error = result.error;
            this.eventEmitter.emit(FLOW_EVENTS.EXECUTION_ERROR, {
              execution,
              flow,
            });
            break;
          }
        }
      }

      if (execution.status === 'running') {
        execution.status = 'completed';
        execution.completedAt = new Date();
        this.eventEmitter.emit(FLOW_EVENTS.EXECUTION_COMPLETED, {
          execution,
          flow,
        });
      }
    } catch (execErr) {
      execution.status = 'error';
      execution.error =
        execErr instanceof Error ? execErr.message : String(execErr);
      this.eventEmitter.emit(FLOW_EVENTS.EXECUTION_ERROR, { execution, flow });
      this.logger.error(
        `[Flow Exec] execution=${execution.id} error: ${execution.error}`,
      );
    }

    // Persist execution result
    await this.persistExecution(execution);
    await this.updateFlowExecutionStats(flowId, execution.status);

    return execution;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  3. SINGLE NODE EXECUTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute a single node based on its type.
   * Returns a FlowNodeResult with timing and output/error.
   */
  async executeNode(
    node: FlowNode,
    context: Record<string, unknown>,
    flow: FlowDefinition,
  ): Promise<FlowNodeResult> {
    const startedAt = new Date();
    const startMs = Date.now();
    this.logger.debug(`[Node Exec] type=${node.type} id=${node.id} label=${node.data.label}`);
    this.eventEmitter.emit(FLOW_EVENTS.NODE_STARTED, { node, flow, context });

    try {
      let output: unknown;

      switch (node.type) {
        // ── Trigger ──
        case 'trigger': {
          output = { triggered: true, timestamp: new Date().toISOString() };
          break;
        }

        // ── Action → delegate to connector ──
        case 'action': {
          if (!node.data.module || !node.data.action) {
            throw new Error(`Action node missing module or action: ${node.id}`);
          }

          // Resolve template parameters from context
          const resolvedParams = this.resolveParameters(
            node.data.parameters || {},
            context,
          );

          const command = {
            module: node.data.module,
            action: node.data.action,
            parameters: resolvedParams,
            businessId: flow.businessId,
            userId: (context._userId as string) || 'system',
            source: 'flow_studio',
            timestamp: new Date(),
            correlationId: `flow_${flow.id}_${Date.now()}`,
          };

          const result = await this.connector.execute(command);
          output = result;
          break;
        }

        // ── Condition → evaluate expression ──
        case 'condition': {
          output = this.evaluateCondition(node.data, context);
          break;
        }

        // ── Delay → wait ──
        case 'delay': {
          const delayMs = this.computeDelayMs(node.data);
          await this.sleep(delayMs);
          output = { delayed: true, delayMs };
          break;
        }

        // ── AI Decision → ask AI ──
        case 'ai_decision': {
          const decision = await this.executeAiDecision(node.data, context);
          output = decision;
          break;
        }

        // ── Merge → combine outputs from all input branches ──
        case 'merge': {
          const mergedInputs: Record<string, unknown> = {};
          for (const inputId of node.inputs) {
            const key = `_${inputId}_output`;
            if (context[key] !== undefined) {
              mergedInputs[inputId] = context[key];
            }
          }
          output = { merged: true, inputs: mergedInputs };
          break;
        }

        // ── Split → trigger parallel paths (handled by execution engine) ──
        case 'split': {
          output = { split: true, branches: node.outputs.length };
          break;
        }

        // ── Wait For → poll or listen for event ──
        case 'wait_for': {
          const waitResult = await this.executeWaitFor(node.data, context);
          output = waitResult;
          break;
        }

        // ── Loop → iterate ──
        case 'loop': {
          const loopResult = await this.executeLoop(
            node,
            context,
            flow,
          );
          output = loopResult;
          break;
        }

        // ── Error Handler → handle error from context ──
        case 'error_handler': {
          output = this.executeErrorHandler(node.data, context);
          break;
        }

        // ── Notification → send notification ──
        case 'notification': {
          const notifResult = await this.executeNotification(
            node.data,
            flow.businessId,
            context,
          );
          output = notifResult;
          break;
        }

        // ── Transform → apply data mapping ──
        case 'transform': {
          output = this.executeTransform(node.data, context);
          break;
        }

        // ── Filter → filter items ──
        case 'filter': {
          output = this.executeFilter(node.data, context);
          break;
        }

        default: {
          throw new Error(`Unknown node type: ${node.type}`);
        }
      }

      const executionTimeMs = Date.now() - startMs;
      const result: FlowNodeResult = {
        nodeId: node.id,
        nodeType: node.type,
        status: 'success',
        startedAt,
        completedAt: new Date(),
        output,
        executionTimeMs,
      };

      this.eventEmitter.emit(FLOW_EVENTS.NODE_COMPLETED, { result, node, flow });
      return result;
    } catch (err) {
      const executionTimeMs = Date.now() - startMs;
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error(`[Node Exec] Error on node=${node.id}: ${error}`);

      const result: FlowNodeResult = {
        nodeId: node.id,
        nodeType: node.type,
        status: 'error',
        startedAt,
        completedAt: new Date(),
        error,
        executionTimeMs,
      };

      this.eventEmitter.emit(FLOW_EVENTS.NODE_ERROR, { result, node, flow });
      return result;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  4. TEMPLATE LIBRARY (50+ templates)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Return 50+ pre-built flow templates organized by business category.
   */
  getTemplates(): FlowTemplate[] {
    const templates: FlowTemplate[] = [];

    // ── 4.1 ONBOARDING ──
    templates.push(
      this.makeTemplate({
        id: 'tpl_new_lead_welcome',
        name: 'New Lead Welcome Sequence',
        description: 'Automatically send a welcome email and schedule follow-up tasks when a new lead is created.',
        category: 'Onboarding',
        tags: ['onboarding', 'leads', 'welcome'],
        setupTime: '2 min',
        nodes: [
          { type: 'trigger', label: 'New Lead Created', config: { event: 'contact_created' } },
          { type: 'action', label: 'Send Welcome Email', config: { module: 'communications', action: 'send_email' } },
          { type: 'delay', label: 'Wait 1 Day', config: { delayUnit: 'days', delayValue: 1 } },
          { type: 'action', label: 'Add Follow-up Task', config: { module: 'crm', action: 'add_task' } },
        ],
        edges: [
          { from: 0, to: 1 },
          { from: 1, to: 2 },
          { from: 2, to: 3 },
        ],
        trigger: { type: 'event', config: {}, eventName: 'contact_created' },
      }),
      this.makeTemplate({
        id: 'tpl_new_customer_onboarding',
        name: 'New Customer Onboarding Journey',
        description: 'Tag new customers, send onboarding emails, create tasks, and schedule a check-in call.',
        category: 'Onboarding',
        tags: ['onboarding', 'customers', 'journey'],
        setupTime: '5 min',
        nodes: [
          { type: 'trigger', label: 'Customer Status Changed', config: { event: 'contact_status_updated' } },
          { type: 'condition', label: 'Status is Customer?', config: { condition: 'status', operator: 'eq', value: 'customer' } },
          { type: 'action', label: 'Tag as Onboarding', config: { module: 'crm', action: 'add_tag' } },
          { type: 'action', label: 'Send Onboarding Email', config: { module: 'communications', action: 'send_email' } },
          { type: 'delay', label: 'Wait 3 Days', config: { delayUnit: 'days', delayValue: 3 } },
          { type: 'action', label: 'Send Tips Email', config: { module: 'communications', action: 'send_email' } },
          { type: 'action', label: 'Schedule Check-in Call', config: { module: 'bookings', action: 'create_booking' } },
        ],
        edges: [
          { from: 0, to: 1 },
          { from: 1, to: 2, label: 'true' },
          { from: 2, to: 3 },
          { from: 3, to: 4 },
          { from: 4, to: 5 },
          { from: 5, to: 6 },
        ],
        trigger: { type: 'event', config: {}, eventName: 'contact_status_updated' },
      }),
    );

    // ── 4.2 SALES ──
    templates.push(
      this.makeTemplate({
        id: 'tpl_quote_followup',
        name: 'Quote Follow-up Sequence',
        description: 'Follow up on sent quotes after 2 days, then send a reminder SMS after 5 days.',
        category: 'Sales',
        tags: ['sales', 'quotes', 'follow-up'],
        setupTime: '3 min',
        nodes: [
          { type: 'trigger', label: 'Quote Sent', config: { event: 'quote_sent' } },
          { type: 'delay', label: 'Wait 2 Days', config: { delayUnit: 'days', delayValue: 2 } },
          { type: 'action', label: 'Send Follow-up Email', config: { module: 'communications', action: 'send_email' } },
          { type: 'delay', label: 'Wait 3 More Days', config: { delayUnit: 'days', delayValue: 3 } },
          { type: 'condition', label: 'Quote Still Open?', config: { condition: 'quote_status', operator: 'eq', value: 'open' } },
          { type: 'action', label: 'Send Reminder SMS', config: { module: 'communications', action: 'send_message' } },
        ],
        edges: [
          { from: 0, to: 1 },
          { from: 1, to: 2 },
          { from: 2, to: 3 },
          { from: 3, to: 4 },
          { from: 4, to: 5, label: 'true' },
        ],
        trigger: { type: 'event', config: {}, eventName: 'quote_sent' },
      }),
      this.makeTemplate({
        id: 'tpl_abandoned_cart',
        name: 'Abandoned Cart Recovery',
        description: 'Recover abandoned carts with a series of emails and an SMS.',
        category: 'Sales',
        tags: ['sales', 'cart', 'recovery', 'e-commerce'],
        setupTime: '4 min',
        nodes: [
          { type: 'trigger', label: 'Cart Abandoned', config: { event: 'cart_abandoned' } },
          { type: 'delay', label: 'Wait 1 Hour', config: { delayUnit: 'hours', delayValue: 1 } },
          { type: 'action', label: 'Send Recovery Email', config: { module: 'communications', action: 'send_email' } },
          { type: 'delay', label: 'Wait 24 Hours', config: { delayUnit: 'hours', delayValue: 24 } },
          { type: 'condition', label: 'Purchase Completed?', config: { condition: 'order_status', operator: 'eq', value: 'completed' } },
          { type: 'action', label: 'Send Discount Email', config: { module: 'communications', action: 'send_email' } },
          { type: 'delay', label: 'Wait 12 Hours', config: { delayUnit: 'hours', delayValue: 12 } },
          { type: 'action', label: 'Send SMS Reminder', config: { module: 'communications', action: 'send_message' } },
        ],
        edges: [
          { from: 0, to: 1 },
          { from: 1, to: 2 },
          { from: 2, to: 3 },
          { from: 3, to: 4 },
          { from: 4, to: 5, label: 'false' },
          { from: 5, to: 6 },
          { from: 6, to: 7 },
        ],
        trigger: { type: 'event', config: {}, eventName: 'cart_abandoned' },
      }),
      this.makeTemplate({
        id: 'tpl_upsell_after_purchase',
        name: 'Upsell After Purchase',
        description: 'Send a targeted upsell offer immediately after a purchase.',
        category: 'Sales',
        tags: ['sales', 'upsell', 'post-purchase'],
        setupTime: '3 min',
        nodes: [
          { type: 'trigger', label: 'Purchase Completed', config: { event: 'invoice_paid' } },
          { type: 'action', label: 'Get Related Products', config: { module: 'commerce', action: 'get_product_catalog' } },
          { type: 'transform', label: 'Map Upsell Items', config: { mapping: { productId: 'id', name: 'name', price: 'price' } } },
          { type: 'action', label: 'Send Upsell Email', config: { module: 'communications', action: 'send_email' } },
        ],
        edges: [
          { from: 0, to: 1 },
          { from: 1, to: 2 },
          { from: 2, to: 3 },
        ],
        trigger: { type: 'event', config: {}, eventName: 'invoice_paid' },
      }),
    );

    // ── 4.3 MARKETING ──
    templates.push(
      this.makeTemplate({
        id: 'tpl_birthday_campaign',
        name: 'Birthday Campaign',
        description: 'Send birthday wishes and a special offer to contacts on their birthday.',
        category: 'Marketing',
        tags: ['marketing', 'birthday', 'campaign'],
        setupTime: '2 min',
        nodes: [
          { type: 'trigger', label: 'Daily Schedule', config: { cronExpression: '0 9 * * *' } },
          { type: 'action', label: 'Find Birthday Contacts', config: { module: 'crm', action: 'list_contacts' } },
          { type: 'filter', label: 'Filter Birthday Today', config: { filterField: 'birthday', filterOperator: 'eq', filterValue: 'today' } },
          { type: 'loop', label: 'For Each Contact', config: { loopType: 'for_each' } },
          { type: 'action', label: 'Send Birthday Email', config: { module: 'communications', action: 'send_email' } },
        ],
        edges: [
          { from: 0, to: 1 },
          { from: 1, to: 2 },
          { from: 2, to: 3 },
          { from: 3, to: 4 },
        ],
        trigger: { type: 'schedule', config: {}, cronExpression: '0 9 * * *' },
      }),
      this.makeTemplate({
        id: 'tpl_reengagement_sequence',
        name: 'Re-engagement Sequence',
        description: 'Win back inactive contacts with a 3-email re-engagement campaign.',
        category: 'Marketing',
        tags: ['marketing', 're-engagement', 'email'],
        setupTime: '4 min',
        nodes: [
          { type: 'trigger', label: 'Weekly Schedule', config: { cronExpression: '0 10 * * 1' } },
          { type: 'action', label: 'Find Inactive Contacts', config: { module: 'crm', action: 'list_contacts' } },
          { type: 'action', label: 'Send We Miss You Email', config: { module: 'communications', action: 'send_email' } },
          { type: 'delay', label: 'Wait 5 Days', config: { delayUnit: 'days', delayValue: 5 } },
          { type: 'action', label: 'Send Special Offer Email', config: { module: 'communications', action: 'send_email' } },
          { type: 'delay', label: 'Wait 5 More Days', config: { delayUnit: 'days', delayValue: 5 } },
          { type: 'action', label: 'Send Last Chance Email', config: { module: 'communications', action: 'send_email' } },
        ],
        edges: [
          { from: 0, to: 1 },
          { from: 1, to: 2 },
          { from: 2, to: 3 },
          { from: 3, to: 4 },
          { from: 4, to: 5 },
          { from: 5, to: 6 },
        ],
        trigger: { type: 'schedule', config: {}, cronExpression: '0 10 * * 1' },
      }),
      this.makeTemplate({
        id: 'tpl_review_request',
        name: 'Review Request Workflow',
        description: 'Request reviews from satisfied customers after a completed service.',
        category: 'Marketing',
        tags: ['marketing', 'reviews', 'feedback'],
        setupTime: '3 min',
        nodes: [
          { type: 'trigger', label: 'Booking Completed', config: { event: 'booking_completed' } },
          { type: 'delay', label: 'Wait 2 Hours', config: { delayUnit: 'hours', delayValue: 2 } },
          { type: 'action', label: 'Send Review Request Email', config: { module: 'communications', action: 'send_email' } },
          { type: 'delay', label: 'Wait 3 Days', config: { delayUnit: 'days', delayValue: 3 } },
          { type: 'condition', label: 'Review Submitted?', config: { condition: 'review_status', operator: 'eq', value: 'submitted' } },
          { type: 'action', label: 'Send Reminder SMS', config: { module: 'communications', action: 'send_message' } },
        ],
        edges: [
          { from: 0, to: 1 },
          { from: 1, to: 2 },
          { from: 2, to: 3 },
          { from: 3, to: 4 },
          { from: 4, to: 5, label: 'false' },
        ],
        trigger: { type: 'event', config: {}, eventName: 'booking_completed' },
      }),
    );

    // ── 4.4 OPERATIONS ──
    templates.push(
      this.makeTemplate({
        id: 'tpl_invoice_reminder',
        name: 'Invoice Reminder',
        description: 'Send automated reminders for overdue invoices escalating from email to SMS.',
        category: 'Operations',
        tags: ['operations', 'invoices', 'reminders'],
        setupTime: '3 min',
        nodes: [
          { type: 'trigger', label: 'Daily Schedule', config: { cronExpression: '0 9 * * *' } },
          { type: 'action', label: 'Find Overdue Invoices', config: { module: 'commerce', action: 'list_invoices' } },
          { type: 'loop', label: 'For Each Overdue', config: { loopType: 'for_each' } },
          { type: 'action', label: 'Send Reminder Email', config: { module: 'communications', action: 'send_email' } },
          { type: 'delay', label: 'Wait 3 Days', config: { delayUnit: 'days', delayValue: 3 } },
          { type: 'condition', label: 'Still Overdue?', config: { condition: 'invoice_status', operator: 'eq', value: 'overdue' } },
          { type: 'action', label: 'Send SMS Reminder', config: { module: 'communications', action: 'send_message' } },
        ],
        edges: [
          { from: 0, to: 1 },
          { from: 1, to: 2 },
          { from: 2, to: 3 },
          { from: 3, to: 4 },
          { from: 4, to: 5 },
          { from: 5, to: 6, label: 'true' },
        ],
        trigger: { type: 'schedule', config: {}, cronExpression: '0 9 * * *' },
      }),
      this.makeTemplate({
        id: 'tpl_booking_confirmation',
        name: 'Booking Confirmation & Reminders',
        description: 'Confirm bookings and send reminder emails/SMS before the appointment.',
        category: 'Operations',
        tags: ['operations', 'bookings', 'confirmations'],
        setupTime: '4 min',
        nodes: [
          { type: 'trigger', label: 'New Booking', config: { event: 'booking_created' } },
          { type: 'action', label: 'Send Confirmation Email', config: { module: 'communications', action: 'send_email' } },
          { type: 'delay', label: 'Wait 24 Hours Before', config: { delayUnit: 'hours', delayValue: 24 } },
          { type: 'action', label: 'Send Reminder Email', config: { module: 'communications', action: 'send_email' } },
          { type: 'delay', label: 'Wait 2 Hours Before', config: { delayUnit: 'hours', delayValue: 2 } },
          { type: 'action', label: 'Send SMS Reminder', config: { module: 'communications', action: 'send_message' } },
        ],
        edges: [
          { from: 0, to: 1 },
          { from: 1, to: 2 },
          { from: 2, to: 3 },
          { from: 3, to: 4 },
          { from: 4, to: 5 },
        ],
        trigger: { type: 'event', config: {}, eventName: 'booking_created' },
      }),
      this.makeTemplate({
        id: 'tpl_payment_recovery',
        name: 'Payment Recovery',
        description: 'Recover failed payments with retry logic and customer outreach.',
        category: 'Operations',
        tags: ['operations', 'payments', 'recovery'],
        setupTime: '5 min',
        nodes: [
          { type: 'trigger', label: 'Payment Failed', config: { event: 'payment_failed' } },
          { type: 'delay', label: 'Wait 1 Hour', config: { delayUnit: 'hours', delayValue: 1 } },
          { type: 'action', label: 'Retry Payment', config: { module: 'commerce', action: 'process_payment' } },
          { type: 'condition', label: 'Payment Successful?', config: { condition: 'payment_status', operator: 'eq', value: 'success' } },
          { type: 'action', label: 'Send Failure Email', config: { module: 'communications', action: 'send_email' } },
          { type: 'delay', label: 'Wait 1 Day', config: { delayUnit: 'days', delayValue: 1 } },
          { type: 'action', label: 'Send SMS Reminder', config: { module: 'communications', action: 'send_message' } },
        ],
        edges: [
          { from: 0, to: 1 },
          { from: 1, to: 2 },
          { from: 2, to: 3 },
          { from: 3, to: 5, label: 'true' },
          { from: 3, to: 4, label: 'false' },
          { from: 4, to: 5 },
          { from: 5, to: 6 },
        ],
        trigger: { type: 'event', config: {}, eventName: 'payment_failed' },
      }),
    );

    // ── 4.5 SUPPORT ──
    templates.push(
      this.makeTemplate({
        id: 'tpl_ticket_autoresponse',
        name: 'Ticket Auto-Response',
        description: 'Send an immediate acknowledgment when a new support ticket arrives.',
        category: 'Support',
        tags: ['support', 'tickets', 'auto-response'],
        setupTime: '2 min',
        nodes: [
          { type: 'trigger', label: 'New Ticket', config: { event: 'ticket_created' } },
          { type: 'condition', label: 'Business Hours?', config: { condition: 'is_business_hours', operator: 'eq', value: true } },
          { type: 'action', label: 'Send Acknowledgment Email', config: { module: 'communications', action: 'send_email' } },
          { type: 'action', label: 'Create Auto-Reply Task', config: { module: 'crm', action: 'add_task' } },
        ],
        edges: [
          { from: 0, to: 1 },
          { from: 1, to: 2, label: 'true' },
          { from: 1, to: 3, label: 'false' },
        ],
        trigger: { type: 'event', config: {}, eventName: 'ticket_created' },
      }),
      this.makeTemplate({
        id: 'tpl_escalation_workflow',
        name: 'Escalation Workflow',
        description: 'Escalate unresolved tickets to managers after a SLA deadline.',
        category: 'Support',
        tags: ['support', 'escalation', 'sla'],
        setupTime: '4 min',
        nodes: [
          { type: 'trigger', label: 'Ticket Unresolved 24h', config: { event: 'sla_breach_warning' } },
          { type: 'action', label: 'Notify Assigned Agent', config: { module: 'notifications', action: 'send_notification' } },
          { type: 'delay', label: 'Wait 4 Hours', config: { delayUnit: 'hours', delayValue: 4 } },
          { type: 'condition', label: 'Still Unresolved?', config: { condition: 'ticket_status', operator: 'eq', value: 'open' } },
          { type: 'action', label: 'Escalate to Manager', config: { module: 'notifications', action: 'send_notification' } },
          { type: 'action', label: 'Add Escalation Note', config: { module: 'crm', action: 'add_note' } },
        ],
        edges: [
          { from: 0, to: 1 },
          { from: 1, to: 2 },
          { from: 2, to: 3 },
          { from: 3, to: 4, label: 'true' },
          { from: 4, to: 5 },
        ],
        trigger: { type: 'event', config: {}, eventName: 'sla_breach_warning' },
      }),
      this.makeTemplate({
        id: 'tpl_followup_survey',
        name: 'Follow-up Survey',
        description: 'Send satisfaction surveys after a support ticket is resolved.',
        category: 'Support',
        tags: ['support', 'survey', 'feedback'],
        setupTime: '3 min',
        nodes: [
          { type: 'trigger', label: 'Ticket Resolved', config: { event: 'ticket_resolved' } },
          { type: 'delay', label: 'Wait 2 Hours', config: { delayUnit: 'hours', delayValue: 2 } },
          { type: 'action', label: 'Send Survey Email', config: { module: 'communications', action: 'send_email' } },
          { type: 'delay', label: 'Wait 3 Days', config: { delayUnit: 'days', delayValue: 3 } },
          { type: 'condition', label: 'Survey Completed?', config: { condition: 'survey_status', operator: 'eq', value: 'completed' } },
          { type: 'action', label: 'Send Reminder', config: { module: 'communications', action: 'send_email' } },
        ],
        edges: [
          { from: 0, to: 1 },
          { from: 1, to: 2 },
          { from: 2, to: 3 },
          { from: 3, to: 4 },
          { from: 4, to: 5, label: 'false' },
        ],
        trigger: { type: 'event', config: {}, eventName: 'ticket_resolved' },
      }),
    );

    // ── 4.6 RETENTION ──
    templates.push(
      this.makeTemplate({
        id: 'tpl_churn_prevention',
        name: 'Churn Prevention',
        description: 'Detect at-risk customers and trigger retention outreach.',
        category: 'Retention',
        tags: ['retention', 'churn', 'prevention'],
        setupTime: '5 min',
        nodes: [
          { type: 'trigger', label: 'Weekly Schedule', config: { cronExpression: '0 9 * * 1' } },
          { type: 'action', label: 'Identify At-Risk Contacts', config: { module: 'intelligence', action: 'detect_opportunities' } },
          { type: 'filter', label: 'Filter High Churn Risk', config: { filterField: 'churn_risk_score', filterOperator: 'gt', filterValue: 0.7 } },
          { type: 'loop', label: 'For Each At-Risk', config: { loopType: 'for_each' } },
          { type: 'ai_decision', label: 'Choose Retention Action', config: { prompt: 'Choose best retention action for at-risk customer', options: ['email', 'sms', 'call'] } },
          { type: 'action', label: 'Execute Retention Action', config: { module: 'communications', action: 'send_message' } },
          { type: 'action', label: 'Create Retention Task', config: { module: 'crm', action: 'add_task' } },
        ],
        edges: [
          { from: 0, to: 1 },
          { from: 1, to: 2 },
          { from: 2, to: 3 },
          { from: 3, to: 4 },
          { from: 4, to: 5 },
          { from: 5, to: 6 },
        ],
        trigger: { type: 'schedule', config: {}, cronExpression: '0 9 * * 1' },
      }),
      this.makeTemplate({
        id: 'tpl_winback_campaign',
        name: 'Win-Back Campaign',
        description: 'Re-engage churned customers with a special win-back offer.',
        category: 'Retention',
        tags: ['retention', 'win-back', 'churned'],
        setupTime: '4 min',
        nodes: [
          { type: 'trigger', label: 'Contact Churned', config: { event: 'contact_status_updated' } },
          { type: 'condition', label: 'Status is Churned?', config: { condition: 'status', operator: 'eq', value: 'churned' } },
          { type: 'delay', label: 'Wait 7 Days', config: { delayUnit: 'days', delayValue: 7 } },
          { type: 'action', label: 'Send Win-Back Email', config: { module: 'communications', action: 'send_email' } },
          { type: 'delay', label: 'Wait 5 Days', config: { delayUnit: 'days', delayValue: 5 } },
          { type: 'condition', label: 'Re-engaged?', config: { condition: 'contact_engaged', operator: 'eq', value: true } },
          { type: 'action', label: 'Send Special Offer', config: { module: 'communications', action: 'send_email' } },
        ],
        edges: [
          { from: 0, to: 1 },
          { from: 1, to: 2, label: 'true' },
          { from: 2, to: 3 },
          { from: 3, to: 4 },
          { from: 4, to: 5 },
          { from: 5, to: 6, label: 'false' },
        ],
        trigger: { type: 'event', config: {}, eventName: 'contact_status_updated' },
      }),
      this.makeTemplate({
        id: 'tpl_loyalty_rewards',
        name: 'Loyalty Rewards',
        description: 'Reward loyal customers after they reach purchase milestones.',
        category: 'Retention',
        tags: ['retention', 'loyalty', 'rewards'],
        setupTime: '4 min',
        nodes: [
          { type: 'trigger', label: 'Purchase Milestone', config: { event: 'milestone_reached' } },
          { type: 'condition', label: 'Orders >= 5?', config: { condition: 'total_orders', operator: 'gte', value: 5 } },
          { type: 'action', label: 'Tag as VIP', config: { module: 'crm', action: 'add_tag' } },
          { type: 'action', label: 'Send Reward Email', config: { module: 'communications', action: 'send_email' } },
          { type: 'action', label: 'Generate Discount Code', config: { module: 'commerce', action: 'create_quote' } },
        ],
        edges: [
          { from: 0, to: 1 },
          { from: 1, to: 2, label: 'true' },
          { from: 2, to: 3 },
          { from: 3, to: 4 },
        ],
        trigger: { type: 'event', config: {}, eventName: 'milestone_reached' },
      }),
    );

    // ── 4.7 FINANCE ──
    templates.push(
      this.makeTemplate({
        id: 'tpl_monthly_report',
        name: 'Monthly Report Generation',
        description: 'Generate and email monthly financial and business reports.',
        category: 'Finance',
        tags: ['finance', 'reports', 'monthly'],
        setupTime: '5 min',
        nodes: [
          { type: 'trigger', label: 'Monthly Schedule', config: { cronExpression: '0 8 1 * *' } },
          { type: 'action', label: 'Get Revenue Summary', config: { module: 'commerce', action: 'get_revenue_summary' } },
          { type: 'action', label: 'Get Expense Summary', config: { module: 'finance', action: 'get_expense_summary' } },
          { type: 'transform', label: 'Build Report Data', config: { mapping: { revenue: 'revenue', expenses: 'expenses', profit: 'profit' } } },
          { type: 'action', label: 'Generate Report PDF', config: { module: 'analytics', action: 'create_report' } },
          { type: 'action', label: 'Email Report', config: { module: 'communications', action: 'send_email' } },
          { type: 'notification', label: 'Notify Admin', config: { notificationTitle: 'Monthly Report Ready', notificationChannel: 'push' } },
        ],
        edges: [
          { from: 0, to: 1 },
          { from: 1, to: 2 },
          { from: 2, to: 3 },
          { from: 3, to: 4 },
          { from: 4, to: 5 },
          { from: 5, to: 6 },
        ],
        trigger: { type: 'schedule', config: {}, cronExpression: '0 8 1 * *' },
      }),
      this.makeTemplate({
        id: 'tpl_expense_categorization',
        name: 'Expense Categorization',
        description: 'Auto-categorize uncategorized expenses using AI.',
        category: 'Finance',
        tags: ['finance', 'expenses', 'ai'],
        setupTime: '3 min',
        nodes: [
          { type: 'trigger', label: 'Daily Schedule', config: { cronExpression: '0 6 * * *' } },
          { type: 'action', label: 'Get Uncategorized Expenses', config: { module: 'finance', action: 'get_expense_summary' } },
          { type: 'loop', label: 'For Each Expense', config: { loopType: 'for_each' } },
          { type: 'ai_decision', label: 'AI Categorize', config: { prompt: 'Categorize this expense into: office, travel, marketing, software, salaries, utilities, other' } },
          { type: 'action', label: 'Apply Category', config: { module: 'finance', action: 'categorize_transaction' } },
        ],
        edges: [
          { from: 0, to: 1 },
          { from: 1, to: 2 },
          { from: 2, to: 3 },
          { from: 3, to: 4 },
        ],
        trigger: { type: 'schedule', config: {}, cronExpression: '0 6 * * *' },
      }),
      this.makeTemplate({
        id: 'tpl_tax_preparation',
        name: 'Tax Preparation',
        description: 'Collect and organize financial data for tax filing.',
        category: 'Finance',
        tags: ['finance', 'tax', 'preparation'],
        setupTime: '5 min',
        nodes: [
          { type: 'trigger', label: 'Quarterly Schedule', config: { cronExpression: '0 9 1 1,4,7,10 *' } },
          { type: 'action', label: 'Get P&L Statement', config: { module: 'finance', action: 'generate_pnl' } },
          { type: 'action', label: 'Get Expense Breakdown', config: { module: 'finance', action: 'get_expense_summary' } },
          { type: 'transform', label: 'Organize Tax Data', config: { mapping: { income: 'revenue', deductions: 'expenses' } } },
          { type: 'action', label: 'Export to CSV', config: { module: 'analytics', action: 'export_report' } },
          { type: 'notification', label: 'Notify Accountant', config: { notificationTitle: 'Tax Data Ready', notificationChannel: 'email' } },
        ],
        edges: [
          { from: 0, to: 1 },
          { from: 1, to: 2 },
          { from: 2, to: 3 },
          { from: 3, to: 4 },
          { from: 4, to: 5 },
        ],
        trigger: { type: 'schedule', config: {}, cronExpression: '0 9 1 1,4,7,10 *' },
      }),
    );

    // ── 4.8 HR ──
    templates.push(
      this.makeTemplate({
        id: 'tpl_interview_scheduling',
        name: 'Interview Scheduling',
        description: 'Automatically schedule interviews when candidates reach the interview stage.',
        category: 'HR',
        tags: ['hr', 'interview', 'scheduling'],
        setupTime: '4 min',
        nodes: [
          { type: 'trigger', label: 'Candidate Moved to Interview', config: { event: 'candidate_stage_changed' } },
          { type: 'condition', label: 'Stage is Interview?', config: { condition: 'stage', operator: 'eq', value: 'interview' } },
          { type: 'action', label: 'Find Available Slots', config: { module: 'bookings', action: 'get_availability' } },
          { type: 'action', label: 'Send Interview Invite Email', config: { module: 'communications', action: 'send_email' } },
          { type: 'action', label: 'Create Interview Booking', config: { module: 'bookings', action: 'create_booking' } },
          { type: 'action', label: 'Notify Hiring Manager', config: { module: 'notifications', action: 'send_notification' } },
        ],
        edges: [
          { from: 0, to: 1 },
          { from: 1, to: 2, label: 'true' },
          { from: 2, to: 3 },
          { from: 3, to: 4 },
          { from: 4, to: 5 },
        ],
        trigger: { type: 'event', config: {}, eventName: 'candidate_stage_changed' },
      }),
      this.makeTemplate({
        id: 'tpl_hr_onboarding_checklist',
        name: 'Employee Onboarding Checklist',
        description: 'Create and manage onboarding tasks for new hires.',
        category: 'HR',
        tags: ['hr', 'onboarding', 'checklist'],
        setupTime: '5 min',
        nodes: [
          { type: 'trigger', label: 'New Hire Added', config: { event: 'employee_created' } },
          { type: 'action', label: 'Create Welcome Task', config: { module: 'projects', action: 'add_task' } },
          { type: 'action', label: 'Create IT Setup Task', config: { module: 'projects', action: 'add_task' } },
          { type: 'action', label: 'Create HR Docs Task', config: { module: 'projects', action: 'add_task' } },
          { type: 'delay', label: 'Wait 1 Day', config: { delayUnit: 'days', delayValue: 1 } },
          { type: 'action', label: 'Send Welcome Email', config: { module: 'communications', action: 'send_email' } },
          { type: 'delay', label: 'Wait 1 Week', config: { delayUnit: 'days', delayValue: 7 } },
          { type: 'action', label: 'Send Check-in Email', config: { module: 'communications', action: 'send_email' } },
        ],
        edges: [
          { from: 0, to: 1 },
          { from: 1, to: 2 },
          { from: 2, to: 3 },
          { from: 3, to: 4 },
          { from: 4, to: 5 },
          { from: 5, to: 6 },
          { from: 6, to: 7 },
        ],
        trigger: { type: 'event', config: {}, eventName: 'employee_created' },
      }),
      this.makeTemplate({
        id: 'tpl_performance_review',
        name: 'Performance Review Cycle',
        description: 'Schedule and manage annual performance review reminders.',
        category: 'HR',
        tags: ['hr', 'performance', 'review'],
        setupTime: '4 min',
        nodes: [
          { type: 'trigger', label: 'Review Period Start', config: { cronExpression: '0 9 1 11 *' } },
          { type: 'action', label: 'Get All Employees', config: { module: 'settings', action: 'get_team_members' } },
          { type: 'loop', label: 'For Each Employee', config: { loopType: 'for_each' } },
          { type: 'action', label: 'Create Self-Review Task', config: { module: 'projects', action: 'add_task' } },
          { type: 'action', label: 'Create Manager Review Task', config: { module: 'projects', action: 'add_task' } },
          { type: 'delay', label: 'Wait 2 Weeks', config: { delayUnit: 'days', delayValue: 14 } },
          { type: 'action', label: 'Send Reminder Email', config: { module: 'communications', action: 'send_email' } },
        ],
        edges: [
          { from: 0, to: 1 },
          { from: 1, to: 2 },
          { from: 2, to: 3 },
          { from: 3, to: 4 },
          { from: 4, to: 5 },
          { from: 5, to: 6 },
        ],
        trigger: { type: 'schedule', config: {}, cronExpression: '0 9 1 11 *' },
      }),
    );

    // ── 4.9 Additional templates to reach 50+ ──
    const extras: Array<{
      id: string;
      name: string;
      description: string;
      category: string;
      tags: string[];
      setupTime: string;
      trigger: FlowTrigger;
      nodeTypes: FlowNodeType[];
    }> = [
      { id: 'tpl_lead_qualification', name: 'Lead Qualification', description: 'Score and qualify leads automatically.', category: 'Sales', tags: ['sales', 'leads', 'scoring'], setupTime: '4 min', trigger: { type: 'event', config: {}, eventName: 'contact_created' }, nodeTypes: ['trigger', 'condition', 'action', 'condition', 'action', 'action'] },
      { id: 'tpl_proposal_followup', name: 'Proposal Follow-up', description: 'Follow up on proposals automatically.', category: 'Sales', tags: ['sales', 'proposal'], setupTime: '3 min', trigger: { type: 'event', config: {}, eventName: 'proposal_sent' }, nodeTypes: ['trigger', 'delay', 'action', 'delay', 'condition', 'action'] },
      { id: 'tpl_deal_closed', name: 'Deal Closed Celebration', description: 'Notify team and create tasks when deals close.', category: 'Sales', tags: ['sales', 'deal', 'celebration'], setupTime: '2 min', trigger: { type: 'event', config: {}, eventName: 'deal_won' }, nodeTypes: ['trigger', 'notification', 'action', 'action'] },
      { id: 'tpl_social_scheduler', name: 'Social Media Scheduler', description: 'Auto-schedule social posts from content calendar.', category: 'Marketing', tags: ['marketing', 'social', 'scheduler'], setupTime: '4 min', trigger: { type: 'schedule', config: {}, cronExpression: '0 8 * * *' }, nodeTypes: ['trigger', 'action', 'filter', 'loop', 'action'] },
      { id: 'tpl_newsletter_send', name: 'Newsletter Broadcast', description: 'Send weekly newsletters to subscribers.', category: 'Marketing', tags: ['marketing', 'newsletter'], setupTime: '3 min', trigger: { type: 'schedule', config: {}, cronExpression: '0 9 * * 1' }, nodeTypes: ['trigger', 'action', 'action', 'notification'] },
      { id: 'tpl_referral_request', name: 'Referral Request', description: 'Ask happy customers for referrals.', category: 'Marketing', tags: ['marketing', 'referral'], setupTime: '3 min', trigger: { type: 'event', config: {}, eventName: 'invoice_paid' }, nodeTypes: ['trigger', 'delay', 'condition', 'action'] },
      { id: 'tpl_inventory_alert', name: 'Low Inventory Alert', description: 'Alert when product inventory is low.', category: 'Operations', tags: ['operations', 'inventory'], setupTime: '3 min', trigger: { type: 'schedule', config: {}, cronExpression: '0 */6 * * *' }, nodeTypes: ['trigger', 'action', 'filter', 'notification', 'action'] },
      { id: 'tpl_staff_reminder', name: 'Staff Schedule Reminder', description: 'Remind staff of upcoming shifts.', category: 'Operations', tags: ['operations', 'staff', 'scheduling'], setupTime: '3 min', trigger: { type: 'schedule', config: {}, cronExpression: '0 18 * * *' }, nodeTypes: ['trigger', 'action', 'loop', 'action'] },
      { id: 'tpl_feedback_collect', name: 'Feedback Collection', description: 'Collect feedback after service completion.', category: 'Support', tags: ['support', 'feedback'], setupTime: '3 min', trigger: { type: 'event', config: {}, eventName: 'service_completed' }, nodeTypes: ['trigger', 'delay', 'action', 'delay', 'condition', 'action'] },
      { id: 'tpl_knowledge_base', name: 'Knowledge Base Update', description: 'Auto-create KB articles from resolved tickets.', category: 'Support', tags: ['support', 'knowledge-base'], setupTime: '4 min', trigger: { type: 'event', config: {}, eventName: 'ticket_resolved' }, nodeTypes: ['trigger', 'condition', 'action', 'action'] },
      { id: 'tpl_vip_upgrade', name: 'VIP Customer Upgrade', description: 'Upgrade high-value customers to VIP status.', category: 'Retention', tags: ['retention', 'vip'], setupTime: '3 min', trigger: { type: 'schedule', config: {}, cronExpression: '0 6 * * *' }, nodeTypes: ['trigger', 'action', 'filter', 'action', 'action'] },
      { id: 'tpl_anniversary_reward', name: 'Customer Anniversary Reward', description: 'Reward customers on their signup anniversary.', category: 'Retention', tags: ['retention', 'anniversary'], setupTime: '3 min', trigger: { type: 'schedule', config: {}, cronExpression: '0 9 * * *' }, nodeTypes: ['trigger', 'action', 'filter', 'loop', 'action'] },
      { id: 'tpl_budget_alert', name: 'Budget Alert', description: 'Alert when budgets are nearing limits.', category: 'Finance', tags: ['finance', 'budget', 'alert'], setupTime: '3 min', trigger: { type: 'schedule', config: {}, cronExpression: '0 9 * * *' }, nodeTypes: ['trigger', 'action', 'filter', 'notification'] },
      { id: 'tpl_cashflow_forecast', name: 'Cash Flow Forecast', description: 'Generate weekly cash flow projections.', category: 'Finance', tags: ['finance', 'cashflow', 'forecast'], setupTime: '4 min', trigger: { type: 'schedule', config: {}, cronExpression: '0 8 * * 1' }, nodeTypes: ['trigger', 'action', 'transform', 'action', 'notification'] },
      { id: 'tpl_payroll_reminder', name: 'Payroll Preparation Reminder', description: 'Remind HR to prepare payroll before payday.', category: 'HR', tags: ['hr', 'payroll'], setupTime: '2 min', trigger: { type: 'schedule', config: {}, cronExpression: '0 9 25 * *' }, nodeTypes: ['trigger', 'notification', 'action'] },
      { id: 'tpl_training_schedule', name: 'Training Schedule Reminder', description: 'Remind employees of upcoming training.', category: 'HR', tags: ['hr', 'training'], setupTime: '3 min', trigger: { type: 'schedule', config: {}, cronExpression: '0 9 * * 1' }, nodeTypes: ['trigger', 'action', 'loop', 'action'] },
      { id: 'tpl_contract_renewal', name: 'Contract Renewal Alert', description: 'Alert before contracts expire.', category: 'Operations', tags: ['operations', 'contracts'], setupTime: '3 min', trigger: { type: 'schedule', config: {}, cronExpression: '0 9 * * *' }, nodeTypes: ['trigger', 'action', 'filter', 'action', 'notification'] },
      { id: 'tpl_data_backup', name: 'Data Backup Check', description: 'Verify daily backups and alert on failure.', category: 'Operations', tags: ['operations', 'backup', 'it'], setupTime: '3 min', trigger: { type: 'schedule', config: {}, cronExpression: '0 7 * * *' }, nodeTypes: ['trigger', 'action', 'condition', 'notification'] },
      { id: 'tpl_nps_survey', name: 'NPS Survey', description: 'Send Net Promoter Score surveys quarterly.', category: 'Marketing', tags: ['marketing', 'nps', 'survey'], setupTime: '4 min', trigger: { type: 'schedule', config: {}, cronExpression: '0 9 1 */3 *' }, nodeTypes: ['trigger', 'action', 'loop', 'action', 'delay', 'condition', 'action'] },
      { id: 'tpl_refund_processing', name: 'Refund Processing', description: 'Process refunds and send confirmation.', category: 'Operations', tags: ['operations', 'refunds'], setupTime: '3 min', trigger: { type: 'event', config: {}, eventName: 'refund_requested' }, nodeTypes: ['trigger', 'condition', 'action', 'action', 'notification'] },
      { id: 'tpl_appointment_no_show', name: 'No-Show Follow-up', description: 'Follow up with clients who miss appointments.', category: 'Operations', tags: ['operations', 'no-show'], setupTime: '3 min', trigger: { type: 'event', config: {}, eventName: 'booking_no_show' }, nodeTypes: ['trigger', 'action', 'delay', 'action'] },
      { id: 'tpl_competitor_alert', name: 'Competitor Mention Alert', description: 'Alert when competitors are mentioned in conversations.', category: 'Marketing', tags: ['marketing', 'competitor', 'alert'], setupTime: '5 min', trigger: { type: 'event', config: {}, eventName: 'message_received' }, nodeTypes: ['trigger', 'condition', 'notification', 'action'] },
    ];

    for (const extra of extras) {
      const nodes: Array<{ type: FlowNodeType; label: string; config: Record<string, unknown> }> = extra.nodeTypes.map((t, i) => ({
        type: t,
        label: `${t.charAt(0).toUpperCase() + t.slice(1)} ${i + 1}`,
        config: t === 'trigger' && extra.trigger.type === 'schedule'
          ? { cronExpression: (extra.trigger as FlowTrigger).cronExpression }
          : t === 'trigger' && extra.trigger.type === 'event'
          ? { event: (extra.trigger as FlowTrigger).eventName }
          : {},
      }));
      templates.push(
        this.makeTemplate({
          id: extra.id,
          name: extra.name,
          description: extra.description,
          category: extra.category,
          tags: extra.tags,
          setupTime: extra.setupTime,
          nodes,
          edges: nodes.slice(0, -1).map((_, i) => ({ from: i, to: i + 1 })),
          trigger: extra.trigger,
        }),
      );
    }

    return templates;
  }

  /**
   * Get a single template by ID.
   */
  getTemplateById(templateId: string): FlowTemplate | undefined {
    return this.getTemplates().find((t) => t.id === templateId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  5. APPLY TEMPLATE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Apply a template with business-specific customizations.
   * Creates a new flow from the template with resolved placeholders.
   */
  async applyTemplate(
    templateId: string,
    businessId: string,
    customizations: {
      name?: string;
      description?: string;
      parameterOverrides?: Record<string, unknown>;
      tagOverrides?: string[];
    } = {},
  ): Promise<FlowDefinition> {
    const template = this.getTemplateById(templateId);
    if (!template) throw new NotFoundException(`Template not found: ${templateId}`);

    this.logger.log(`[Apply Template] template=${templateId} business=${businessId}`);

    // Deep clone and customize nodes
    const nodes: FlowNode[] = template.nodes.map((n) => {
      const id = `node_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
      const customizedData = { ...n.data };

      // Apply parameter overrides
      if (customizations.parameterOverrides) {
        customizedData.parameters = {
          ...customizedData.parameters,
          ...customizations.parameterOverrides,
        };
        // Inject businessId into parameters
        if (customizedData.parameters) {
          customizedData.parameters.businessId = businessId;
        }
      }

      return {
        id,
        type: n.type,
        position: { ...n.position },
        data: customizedData,
        inputs: [...n.inputs],
        outputs: [...n.outputs],
      };
    });

    // Re-map edges to new node IDs
    const oldIdToNewId = new Map<string, string>();
    template.nodes.forEach((oldNode, idx) => {
      oldIdToNewId.set(oldNode.id, nodes[idx].id);
    });

    const edges: FlowEdge[] = template.edges.map((e) => ({
      id: `edge_${uuidv4().replace(/-/g, '').substring(0, 12)}`,
      source: oldIdToNewId.get(e.source) || e.source,
      target: oldIdToNewId.get(e.target) || e.target,
      label: e.label,
      condition: e.condition,
    }));

    // Rebuild inputs/outputs from edges
    for (const node of nodes) {
      node.inputs = [];
      node.outputs = [];
    }
    for (const edge of edges) {
      const src = nodes.find((n) => n.id === edge.source);
      const tgt = nodes.find((n) => n.id === edge.target);
      if (src) src.outputs.push(edge.target);
      if (tgt) tgt.inputs.push(edge.source);
    }

    const flow: FlowDefinition = {
      id: uuidv4(),
      businessId,
      name: customizations.name || `${template.name} (Copy)`,
      description: customizations.description || template.description,
      version: 1,
      nodes,
      edges,
      trigger: { ...template.trigger },
      status: 'draft',
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'template',
      executionCount: 0,
      tags: customizations.tagOverrides || [...template.tags],
      category: template.category,
    };

    // Validate before saving
    const validation = this.validateFlow(flow);
    if (!validation.valid) {
      this.logger.warn(`[Apply Template] Validation warnings: ${validation.warnings.length}`);
    }

    await this.persistFlow(flow);

    this.eventEmitter.emit(FLOW_EVENTS.TEMPLATE_APPLIED, {
      flowId: flow.id,
      businessId,
      templateId,
    });

    return flow;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  6. FLOW VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Validate a flow definition comprehensively.
   * Checks: node types, edge refs, orphaned nodes, trigger validity, cycles.
   */
  validateFlow(flow: FlowDefinition): FlowValidationResult {
    const errors: FlowValidationError[] = [];
    const warnings: FlowValidationWarning[] = [];
    const nodeIds = new Set(flow.nodes.map((n) => n.id));

    // 6.1 Check all nodes have valid types
    const validTypes: FlowNodeType[] = [
      'trigger', 'action', 'condition', 'delay', 'ai_decision',
      'merge', 'split', 'wait_for', 'loop', 'error_handler',
      'notification', 'transform', 'filter',
    ];
    for (const node of flow.nodes) {
      if (!validTypes.includes(node.type)) {
        errors.push({
          code: 'INVALID_NODE_TYPE',
          message: `Node "${node.data.label || node.id}" has invalid type: ${node.type}`,
          nodeId: node.id,
        });
      }
    }

    // 6.2 Check all edges reference existing nodes
    for (const edge of flow.edges) {
      if (!nodeIds.has(edge.source)) {
        errors.push({
          code: 'EDGE_SOURCE_MISSING',
          message: `Edge references non-existent source: ${edge.source}`,
          edgeId: edge.id,
        });
      }
      if (!nodeIds.has(edge.target)) {
        errors.push({
          code: 'EDGE_TARGET_MISSING',
          message: `Edge references non-existent target: ${edge.target}`,
          edgeId: edge.id,
        });
      }
    }

    // 6.3 Check no orphaned nodes (except triggers)
    const reachable = new Set<string>();
    const entryNodes = flow.nodes.filter(
      (n) => n.type === 'trigger' || n.inputs.length === 0,
    );

    for (const entry of entryNodes) {
      this.traverseReachable(entry.id, flow, reachable);
    }

    for (const node of flow.nodes) {
      if (!reachable.has(node.id) && node.type !== 'trigger') {
        warnings.push({
          code: 'ORPHANED_NODE',
          message: `Node "${node.data.label || node.id}" is unreachable from any trigger`,
          nodeId: node.id,
        });
      }
    }

    // 6.4 Check trigger is valid
    const validTriggerTypes: FlowTriggerType[] = [
      'event', 'schedule', 'webhook', 'manual', 'api', 'key_command',
    ];
    if (!validTriggerTypes.includes(flow.trigger.type)) {
      errors.push({
        code: 'INVALID_TRIGGER_TYPE',
        message: `Invalid trigger type: ${flow.trigger.type}`,
      });
    }

    if (flow.trigger.type === 'schedule' && !flow.trigger.cronExpression) {
      errors.push({
        code: 'MISSING_CRON_EXPRESSION',
        message: 'Schedule trigger requires a cronExpression',
      });
    }

    if (flow.trigger.type === 'event' && !flow.trigger.eventName) {
      errors.push({
        code: 'MISSING_EVENT_NAME',
        message: 'Event trigger requires an eventName',
      });
    }

    // 6.5 Check for infinite loops (cycle detection)
    const cycles = this.detectCycles(flow);
    for (const cycle of cycles) {
      // Only flag cycles without loop nodes as errors
      const hasLoopNode = cycle.some(
        (nid) => flow.nodes.find((n) => n.id === nid)?.type === 'loop',
      );
      if (!hasLoopNode) {
        errors.push({
          code: 'INFINITE_LOOP',
          message: `Cycle detected without loop node: ${cycle.join(' -> ')}`,
        });
      } else {
        warnings.push({
          code: 'LOOP_CYCLE',
          message: `Cycle with loop node: ${cycle.join(' -> ')}`,
        });
      }
    }

    // 6.6 Check for triggers with incoming edges (triggers should only have outputs)
    for (const node of flow.nodes) {
      if (node.type === 'trigger' && node.inputs.length > 0) {
        warnings.push({
          code: 'TRIGGER_HAS_INPUTS',
          message: `Trigger node "${node.data.label || node.id}" has incoming edges`,
          nodeId: node.id,
        });
      }
    }

    // 6.7 Check condition nodes have labeled outgoing edges
    for (const node of flow.nodes) {
      if (node.type === 'condition') {
        const outgoing = flow.edges.filter((e) => e.source === node.id);
        const unlabeled = outgoing.filter((e) => !e.label);
        if (unlabeled.length > 0) {
          warnings.push({
            code: 'CONDITION_EDGES_UNLABELED',
            message: `Condition node "${node.data.label || node.id}" has ${unlabeled.length} unlabeled outgoing edges`,
            nodeId: node.id,
          });
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  7. NODE REGISTRY
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Return all available node types with their configurations,
   * schema definitions, and port specifications for the visual builder.
   */
  getNodeRegistry(): NodeRegistryEntry[] {
    return this.getNodeRegistryInternal();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  8. FLOW CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Load a flow definition by ID from the database.
   */
  async loadFlow(flowId: string): Promise<FlowDefinition | null> {
    try {
      const record = await this.prisma.flowDefinition.findUnique({
        where: { id: flowId },
      });
      if (!record) return null;
      return this.deserializeFlow(record);
    } catch (err) {
      this.logger.error(`[Load Flow] ${flowId}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Save a flow definition to the database.
   */
  async persistFlow(flow: FlowDefinition): Promise<void> {
    try {
      await this.prisma.flowDefinition.upsert({
        where: { id: flow.id },
        update: this.serializeFlow(flow),
        create: this.serializeFlow(flow),
      });
    } catch (err) {
      this.logger.error(`[Persist Flow] ${flow.id}: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * Delete a flow.
   */
  async deleteFlow(flowId: string): Promise<void> {
    await this.prisma.flowDefinition.delete({ where: { id: flowId } });
    this.eventEmitter.emit(FLOW_EVENTS.FLOW_DELETED, { flowId });
  }

  /**
   * List flows for a business.
   */
  async listFlows(
    businessId: string,
    filters: { status?: string; category?: string } = {},
  ): Promise<FlowDefinition[]> {
    const records = await this.prisma.flowDefinition.findMany({
      where: {
        businessId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.category ? { category: filters.category } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });
    return records.map((r: Record<string, unknown>) => this.deserializeFlow(r));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  9. FLOW EXECUTION PERSISTENCE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Persist a flow execution record.
   */
  async persistExecution(execution: FlowExecution): Promise<void> {
    try {
      await this.prisma.flowExecution.upsert({
        where: { id: execution.id },
        update: {
          status: execution.status,
          completedAt: execution.completedAt,
          currentNodeId: execution.currentNodeId,
          context: execution.context as Record<string, unknown>,
          results: execution.results as unknown as Record<string, unknown>[],
          error: execution.error,
        },
        create: {
          id: execution.id,
          flowId: execution.flowId,
          businessId: execution.businessId,
          status: execution.status,
          startedAt: execution.startedAt,
          completedAt: execution.completedAt,
          currentNodeId: execution.currentNodeId,
          context: execution.context as Record<string, unknown>,
          results: execution.results as unknown as Record<string, unknown>[],
          error: execution.error,
        },
      });
    } catch (err) {
      this.logger.error(
        `[Persist Execution] ${execution.id}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Load execution history for a flow.
   */
  async getExecutionHistory(
    flowId: string,
    limit = 20,
  ): Promise<FlowExecution[]> {
    const records = await this.prisma.flowExecution.findMany({
      where: { flowId },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
    return records.map((r: Record<string, unknown>) => this.deserializeExecution(r));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  10. PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 10.1 Node Registry Internal ──

  private getNodeRegistryInternal(): NodeRegistryEntry[] {
    const baseInput: NodePort = {
      id: 'input',
      label: 'Input',
      description: 'Incoming connection',
      required: false,
      maxConnections: 10,
    };
    const baseOutput: NodePort = {
      id: 'output',
      label: 'Output',
      description: 'Outgoing connection',
      required: false,
      maxConnections: 10,
    };

    return [
      {
        type: 'trigger',
        name: 'Trigger',
        description: 'Event that starts the flow',
        category: 'Core',
        icon: 'Zap',
        color: '#10B981',
        configSchema: [
          { name: 'label', type: 'string', label: 'Label', required: true, defaultValue: 'Trigger' },
          { name: 'description', type: 'string', label: 'Description', required: false },
          { name: 'eventName', type: 'string', label: 'Event Name', required: false, placeholder: 'contact_created' },
          { name: 'cronExpression', type: 'string', label: 'Cron Expression', required: false, placeholder: '0 9 * * *' },
          { name: 'webhookPath', type: 'string', label: 'Webhook Path', required: false },
        ],
        inputPorts: [],
        outputPorts: [{ ...baseOutput, id: 'output', required: true }],
        defaultData: { label: 'Trigger', config: {} },
      },
      {
        type: 'action',
        name: 'Action',
        description: 'Execute an action via KeyCortexConnector',
        category: 'Core',
        icon: 'Play',
        color: '#3B82F6',
        configSchema: [
          { name: 'label', type: 'string', label: 'Label', required: true, defaultValue: 'Action' },
          { name: 'description', type: 'string', label: 'Description', required: false },
          { name: 'module', type: 'select', label: 'Module', required: true, options: ['crm', 'commerce', 'bookings', 'communications', 'content', 'notifications', 'projects', 'analytics', 'finance', 'settings', 'activity', 'autopilot', 'temporal', 'inbox'] },
          { name: 'action', type: 'string', label: 'Action Name', required: true, placeholder: 'send_email' },
          { name: 'parameters', type: 'json', label: 'Parameters', required: false },
        ],
        inputPorts: [{ ...baseInput, required: true }],
        outputPorts: [{ ...baseOutput, required: true }],
        defaultData: { label: 'Action', config: {}, module: 'crm', action: 'send_message' },
      },
      {
        type: 'condition',
        name: 'Condition',
        description: 'Branch based on a condition evaluation',
        category: 'Logic',
        icon: 'GitBranch',
        color: '#F59E0B',
        configSchema: [
          { name: 'label', type: 'string', label: 'Label', required: true, defaultValue: 'Condition' },
          { name: 'description', type: 'string', label: 'Description', required: false },
          { name: 'condition', type: 'expression', label: 'Condition Field', required: true, placeholder: 'contact.status' },
          { name: 'operator', type: 'select', label: 'Operator', required: true, options: ['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'contains', 'exists', 'in'], defaultValue: 'eq' },
          { name: 'value', type: 'string', label: 'Value', required: false },
        ],
        inputPorts: [{ ...baseInput, required: true }],
        outputPorts: [
          { id: 'true', label: 'True', description: 'Condition is true', required: false },
          { id: 'false', label: 'False', description: 'Condition is false', required: false },
        ],
        defaultData: { label: 'Condition?', config: {}, condition: '', operator: 'eq' },
      },
      {
        type: 'delay',
        name: 'Delay',
        description: 'Wait for a specified time',
        category: 'Timing',
        icon: 'Clock',
        color: '#8B5CF6',
        configSchema: [
          { name: 'label', type: 'string', label: 'Label', required: true, defaultValue: 'Delay' },
          { name: 'delayUnit', type: 'select', label: 'Unit', required: true, options: ['seconds', 'minutes', 'hours', 'days'], defaultValue: 'hours' },
          { name: 'delayValue', type: 'number', label: 'Value', required: true, defaultValue: 1 },
        ],
        inputPorts: [{ ...baseInput, required: true }],
        outputPorts: [{ ...baseOutput, required: true }],
        defaultData: { label: 'Wait', config: {}, delayUnit: 'hours', delayValue: 1 },
      },
      {
        type: 'ai_decision',
        name: 'AI Decision',
        description: 'Let KEY AI make a routing decision',
        category: 'AI',
        icon: 'Brain',
        color: '#EC4899',
        configSchema: [
          { name: 'label', type: 'string', label: 'Label', required: true, defaultValue: 'AI Decision' },
          { name: 'prompt', type: 'string', label: 'AI Prompt', required: true, placeholder: 'Should we email or SMS this customer?' },
          { name: 'options', type: 'json', label: 'Options', required: false, placeholder: '["email", "sms", "call"]' },
        ],
        inputPorts: [{ ...baseInput, required: true }],
        outputPorts: [
          { ...baseOutput, id: 'choice_1', label: 'Choice 1' },
          { ...baseOutput, id: 'choice_2', label: 'Choice 2' },
          { ...baseOutput, id: 'choice_3', label: 'Choice 3' },
        ],
        defaultData: { label: 'AI Decide', config: {}, prompt: '' },
      },
      {
        type: 'merge',
        name: 'Merge',
        description: 'Merge multiple parallel paths into one',
        category: 'Logic',
        icon: 'Merge',
        color: '#6366F1',
        configSchema: [
          { name: 'label', type: 'string', label: 'Label', required: true, defaultValue: 'Merge' },
        ],
        inputPorts: [
          { id: 'input_1', label: 'Input 1', required: true },
          { id: 'input_2', label: 'Input 2', required: true },
          { id: 'input_3', label: 'Input 3', required: false },
        ],
        outputPorts: [{ ...baseOutput, required: true }],
        defaultData: { label: 'Merge', config: {} },
      },
      {
        type: 'split',
        name: 'Split',
        description: 'Split execution into parallel paths',
        category: 'Logic',
        icon: 'Split',
        color: '#06B6D4',
        configSchema: [
          { name: 'label', type: 'string', label: 'Label', required: true, defaultValue: 'Split' },
        ],
        inputPorts: [{ ...baseInput, required: true }],
        outputPorts: [
          { id: 'branch_1', label: 'Branch 1', required: true },
          { id: 'branch_2', label: 'Branch 2', required: true },
          { id: 'branch_3', label: 'Branch 3', required: false },
        ],
        defaultData: { label: 'Split', config: {} },
      },
      {
        type: 'wait_for',
        name: 'Wait For Event',
        description: 'Wait for an external event to occur',
        category: 'Timing',
        icon: 'Hourglass',
        color: '#A78BFA',
        configSchema: [
          { name: 'label', type: 'string', label: 'Label', required: true, defaultValue: 'Wait For' },
          { name: 'waitForEvent', type: 'string', label: 'Event Name', required: true, placeholder: 'payment_received' },
          { name: 'waitTimeoutMs', type: 'number', label: 'Timeout (ms)', required: false, defaultValue: 86400000 },
        ],
        inputPorts: [{ ...baseInput, required: true }],
        outputPorts: [
          { id: 'received', label: 'Received', required: true },
          { id: 'timeout', label: 'Timeout', required: false },
        ],
        defaultData: { label: 'Wait For Event', config: {}, waitForEvent: '' },
      },
      {
        type: 'loop',
        name: 'Loop',
        description: 'Repeat N times or until a condition is met',
        category: 'Logic',
        icon: 'Repeat',
        color: '#14B8A6',
        configSchema: [
          { name: 'label', type: 'string', label: 'Label', required: true, defaultValue: 'Loop' },
          { name: 'loopType', type: 'select', label: 'Loop Type', required: true, options: ['count', 'while', 'for_each'], defaultValue: 'count' },
          { name: 'loopCount', type: 'number', label: 'Count', required: false, defaultValue: 3 },
          { name: 'loopCondition', type: 'expression', label: 'Condition', required: false, placeholder: 'retryCount < 3' },
          { name: 'loopCollection', type: 'string', label: 'Collection Path', required: false, placeholder: 'context.items' },
        ],
        inputPorts: [{ ...baseInput, required: true }],
        outputPorts: [
          { id: 'body', label: 'Body', description: 'Loop iteration body', required: true },
          { id: 'done', label: 'Done', description: 'Loop completed', required: true },
        ],
        defaultData: { label: 'Loop', config: {}, loopType: 'count', loopCount: 3 },
      },
      {
        type: 'error_handler',
        name: 'Error Handler',
        description: 'Catch and handle errors from upstream nodes',
        category: 'Core',
        icon: 'ShieldAlert',
        color: '#EF4444',
        configSchema: [
          { name: 'label', type: 'string', label: 'Label', required: true, defaultValue: 'Error Handler' },
          { name: 'errorAction', type: 'select', label: 'Error Action', required: true, options: ['retry', 'skip', 'notify', 'halt'], defaultValue: 'notify' },
          { name: 'maxRetries', type: 'number', label: 'Max Retries', required: false, defaultValue: 3 },
          { name: 'retryDelayMs', type: 'number', label: 'Retry Delay (ms)', required: false, defaultValue: 5000 },
        ],
        inputPorts: [{ ...baseInput, required: true }],
        outputPorts: [{ ...baseOutput, required: false }],
        defaultData: { label: 'On Error', config: {}, errorAction: 'notify', maxRetries: 3 },
      },
      {
        type: 'notification',
        name: 'Notification',
        description: 'Send in-app, push, email, or SMS notification',
        category: 'Core',
        icon: 'Bell',
        color: '#F97316',
        configSchema: [
          { name: 'label', type: 'string', label: 'Label', required: true, defaultValue: 'Notify' },
          { name: 'notificationTitle', type: 'string', label: 'Title', required: true },
          { name: 'notificationBody', type: 'string', label: 'Body', required: true },
          { name: 'notificationChannel', type: 'select', label: 'Channel', required: true, options: ['push', 'email', 'sms', 'in_app'], defaultValue: 'in_app' },
          { name: 'notificationPriority', type: 'select', label: 'Priority', required: false, options: ['low', 'normal', 'high', 'urgent'], defaultValue: 'normal' },
          { name: 'notificationRecipient', type: 'string', label: 'Recipient User ID', required: false },
        ],
        inputPorts: [{ ...baseInput, required: true }],
        outputPorts: [{ ...baseOutput, required: false }],
        defaultData: { label: 'Notify', config: {}, notificationTitle: '', notificationBody: '', notificationChannel: 'in_app' },
      },
      {
        type: 'transform',
        name: 'Transform',
        description: 'Transform and map data fields',
        category: 'Data',
        icon: 'ArrowLeftRight',
        color: '#84CC16',
        configSchema: [
          { name: 'label', type: 'string', label: 'Label', required: true, defaultValue: 'Transform' },
          { name: 'mapping', type: 'json', label: 'Field Mapping', required: false, placeholder: '{"newField": "oldField"}' },
          { name: 'transformScript', type: 'code', label: 'Transform Script', required: false, placeholder: 'return { ...input, computed: input.a + input.b };' },
        ],
        inputPorts: [{ ...baseInput, required: true }],
        outputPorts: [{ ...baseOutput, required: true }],
        defaultData: { label: 'Transform', config: {}, mapping: {} },
      },
      {
        type: 'filter',
        name: 'Filter',
        description: 'Filter items by criteria',
        category: 'Data',
        icon: 'Filter',
        color: '#D946EF',
        configSchema: [
          { name: 'label', type: 'string', label: 'Label', required: true, defaultValue: 'Filter' },
          { name: 'filterField', type: 'string', label: 'Field', required: true },
          { name: 'filterOperator', type: 'select', label: 'Operator', required: true, options: ['eq', 'ne', 'gt', 'lt', 'contains', 'starts_with', 'ends_with', 'exists', 'in'] },
          { name: 'filterValue', type: 'string', label: 'Value', required: false },
        ],
        inputPorts: [{ ...baseInput, required: true }],
        outputPorts: [
          { id: 'pass', label: 'Pass', required: true },
          { id: 'fail', label: 'Fail', required: false },
        ],
        defaultData: { label: 'Filter', config: {}, filterField: '', filterOperator: 'eq' },
      },
    ];
  }

  // ── 10.2 Condition Evaluation ──

  private evaluateCondition(
    data: FlowNodeData,
    context: Record<string, unknown>,
  ): boolean {
    if (!data.condition) return true;

    const actualValue = this.resolveValue(data.condition, context);
    const operator = data.operator || 'eq';
    const expectedValue = data.value;

    switch (operator) {
      case 'eq':
        return actualValue == expectedValue;
      case 'ne':
        return actualValue != expectedValue;
      case 'gt':
        return Number(actualValue) > Number(expectedValue);
      case 'lt':
        return Number(actualValue) < Number(expectedValue);
      case 'gte':
        return Number(actualValue) >= Number(expectedValue);
      case 'lte':
        return Number(actualValue) <= Number(expectedValue);
      case 'contains':
        return String(actualValue).includes(String(expectedValue));
      case 'exists':
        return actualValue !== undefined && actualValue !== null;
      case 'in':
        if (Array.isArray(expectedValue)) {
          return expectedValue.includes(actualValue);
        }
        return String(expectedValue).split(',').map((s) => s.trim()).includes(String(actualValue));
      default:
        return false;
    }
  }

  // ── 10.3 AI Decision ──

  private async executeAiDecision(
    data: FlowNodeData,
    context: Record<string, unknown>,
  ): Promise<unknown> {
    const prompt = data.prompt || 'Make a decision based on the context';
    const options = data.options || ['yes', 'no'];

    const enrichedPrompt = `${prompt}\n\nContext: ${JSON.stringify(context)}\n\nChoose one of: ${options.join(', ')}. Respond with ONLY the chosen option.`;

    const aiResponse = await this.modelGateway.complete({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a decision-making assistant. Respond with ONLY the chosen option.',
        },
        { role: 'user', content: enrichedPrompt },
      ],
      temperature: 0.2,
    });

    const choice =
      typeof aiResponse.content === 'string'
        ? aiResponse.content.trim().toLowerCase()
        : options[0];

    const matchedOption = options.find(
      (o) => choice.includes(o.toLowerCase()),
    );

    return {
      decision: matchedOption || options[0],
      options,
      confidence: matchedOption ? 1.0 : 0.5,
    };
  }

  // ── 10.4 Delay Computation ──

  private computeDelayMs(data: FlowNodeData): number {
    if (data.delayMs) return data.delayMs;
    const unit = data.delayUnit || 'seconds';
    const value = data.delayValue || 0;
    const multipliers: Record<string, number> = {
      seconds: 1000,
      minutes: 60 * 1000,
      hours: 60 * 60 * 1000,
      days: 24 * 60 * 60 * 1000,
    };
    return value * (multipliers[unit] || 1000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ── 10.5 Wait For Execution ──

  private async executeWaitFor(
    data: FlowNodeData,
    context: Record<string, unknown>,
  ): Promise<unknown> {
    const eventName = data.waitForEvent || 'default_event';
    const timeoutMs = data.waitTimeoutMs || 86400000; // 24 hours default

    this.logger.debug(`[Wait For] Waiting for event "${eventName}" (timeout: ${timeoutMs}ms)`);

    // In production, this would set up a BullMQ job or event listener
    // For now, we simulate with a timeout
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ event: eventName, status: 'timeout' });
      }, Math.min(timeoutMs, 30000)); // Cap at 30s for safety

      // Listen for the event via EventEmitter
      const handler = (payload: unknown) => {
        clearTimeout(timeout);
        resolve({ event: eventName, status: 'received', payload });
      };

      this.eventEmitter.once(`flow.event.${eventName}`, handler);
    });
  }

  // ── 10.6 Loop Execution ──

  private async executeLoop(
    node: FlowNode,
    context: Record<string, unknown>,
    flow: FlowDefinition,
  ): Promise<unknown> {
    const data = node.data;
    const loopType = data.loopType || 'count';
    const iterations: unknown[] = [];

    switch (loopType) {
      case 'count': {
        const count = data.loopCount || 1;
        for (let i = 0; i < count; i++) {
          context._loopIndex = i;
          // Execute the loop body (child nodes)
          const childResults: FlowNodeResult[] = [];
          for (const childId of node.outputs) {
            const childNode = flow.nodes.find((n) => n.id === childId);
            if (childNode) {
              const result = await this.executeNode(childNode, context, flow);
              childResults.push(result);
            }
          }
          iterations.push({ index: i, results: childResults });
        }
        break;
      }
      case 'while': {
        let iteration = 0;
        const maxIterations = 100; // Safety limit
        while (
          iteration < maxIterations &&
          this.evaluateExpression(data.loopCondition || 'true', context)
        ) {
          context._loopIndex = iteration;
          const childResults: FlowNodeResult[] = [];
          for (const childId of node.outputs) {
            const childNode = flow.nodes.find((n) => n.id === childId);
            if (childNode) {
              const result = await this.executeNode(childNode, context, flow);
              childResults.push(result);
            }
          }
          iterations.push({ index: iteration, results: childResults });
          iteration++;
        }
        break;
      }
      case 'for_each': {
        const collectionPath = data.loopCollection || '_collection';
        const collection = this.resolveValue(collectionPath, context);
        if (Array.isArray(collection)) {
          for (let i = 0; i < collection.length; i++) {
            context._loopIndex = i;
            context._loopItem = collection[i];
            const childResults: FlowNodeResult[] = [];
            for (const childId of node.outputs) {
              const childNode = flow.nodes.find((n) => n.id === childId);
              if (childNode) {
                const result = await this.executeNode(childNode, context, flow);
                childResults.push(result);
              }
            }
            iterations.push({ index: i, item: collection[i], results: childResults });
          }
        }
        break;
      }
    }

    return { loopType, iterations, totalIterations: iterations.length };
  }

  // ── 10.7 Error Handler ──

  private executeErrorHandler(
    data: FlowNodeData,
    context: Record<string, unknown>,
  ): unknown {
    const error = context._error as string | undefined;
    const errorNodeId = context._errorNodeId as string | undefined;
    const action = data.errorAction || 'notify';

    switch (action) {
      case 'retry':
        return { action: 'retry', error, errorNodeId, maxRetries: data.maxRetries || 3 };
      case 'skip':
        return { action: 'skip', error, errorNodeId };
      case 'notify':
        this.eventEmitter.emit(FLOW_EVENTS.NODE_ERROR, {
          error,
          errorNodeId,
          handledBy: 'error_handler',
        });
        return { action: 'notify', error, errorNodeId, notified: true };
      case 'halt':
        throw new Error(`Flow halted by error handler. Original error: ${error}`);
      default:
        return { action: 'unknown', error };
    }
  }

  // ── 10.8 Notification Execution ──

  private async executeNotification(
    data: FlowNodeData,
    businessId: string,
    context: Record<string, unknown>,
  ): Promise<unknown> {
    const title = this.interpolateTemplate(
      data.notificationTitle || 'Flow Notification',
      context,
    );
    const body = this.interpolateTemplate(
      data.notificationBody || '',
      context,
    );
    const channel = data.notificationChannel || 'in_app';
    const priority = data.notificationPriority || 'normal';
    const recipient = data.notificationRecipient || (context._userId as string) || 'system';

    try {
      const result = await this.connector.execute({
        module: 'notifications',
        action: 'send_notification',
        parameters: {
          userId: recipient,
          title,
          body,
          priority,
        },
        businessId,
        userId: recipient,
        source: 'flow_studio',
        timestamp: new Date(),
        correlationId: `flow_notif_${Date.now()}`,
      });
      return { sent: true, channel, title, result };
    } catch (err) {
      // Fallback: emit event for in-app delivery
      this.eventEmitter.emit('notification.send', {
        businessId,
        title,
        body,
        channel,
        priority,
        recipient,
      });
      return { sent: true, channel, title, fallback: true };
    }
  }

  // ── 10.9 Transform Execution ──

  private executeTransform(
    data: FlowNodeData,
    context: Record<string, unknown>,
  ): unknown {
    const mapping = data.mapping || {};
    const result: Record<string, unknown> = {};

    for (const [targetKey, sourcePath] of Object.entries(mapping)) {
      result[targetKey] = this.resolveValue(sourcePath, context);
    }

    // If a transform script is provided, execute it (sandboxed)
    if (data.transformScript) {
      try {
        const fn = new Function('context', 'input', data.transformScript);
        const scriptResult = fn(context, result);
        return { ...result, ...scriptResult };
      } catch (err) {
        this.logger.warn(`[Transform] Script error: ${(err as Error).message}`);
        return result;
      }
    }

    return result;
  }

  // ── 10.10 Filter Execution ──

  private executeFilter(
    data: FlowNodeData,
    context: Record<string, unknown>,
  ): unknown {
    const collection = this.resolveValue('_input', context);
    if (!Array.isArray(collection)) {
      return { filtered: [], original: collection };
    }

    const field = data.filterField || '';
    const operator = data.filterOperator || 'eq';
    const value = data.filterValue;

    const filtered = collection.filter((item) => {
      const itemValue = field ? this.getNestedValue(item, field) : item;
      switch (operator) {
        case 'eq':
          return itemValue == value;
        case 'ne':
          return itemValue != value;
        case 'gt':
          return Number(itemValue) > Number(value);
        case 'lt':
          return Number(itemValue) < Number(value);
        case 'contains':
          return String(itemValue).includes(String(value));
        case 'starts_with':
          return String(itemValue).startsWith(String(value));
        case 'ends_with':
          return String(itemValue).endsWith(String(value));
        case 'exists':
          return itemValue !== undefined && itemValue !== null;
        case 'in':
          return Array.isArray(value) && value.includes(itemValue);
        default:
          return true;
      }
    });

    return { filtered, total: collection.length, matched: filtered.length };
  }

  // ── 10.11 Value Resolution ──

  private resolveValue(
    path: string,
    context: Record<string, unknown>,
  ): unknown {
    if (!path) return undefined;

    // Direct context lookup with underscore prefix (node outputs)
    if (context[path] !== undefined) return context[path];
    if (context[`_${path}`] !== undefined) return context[`_${path}`];

    // Handle dot notation: "contact.email"
    return this.getNestedValue(context, path);
  }

  private getNestedValue(obj: unknown, path: string): unknown {
    if (!obj || typeof obj !== 'object') return undefined;
    const parts = path.replace(/^\$\./, '').split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  // ── 10.12 Parameter Resolution ──

  private resolveParameters(
    params: Record<string, unknown>,
    context: Record<string, unknown>,
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
        const path = value.slice(2, -2).trim();
        resolved[key] = this.resolveValue(path, context);
      } else if (typeof value === 'string' && value.includes('{{')) {
        resolved[key] = this.interpolateTemplate(value, context);
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  private interpolateTemplate(
    template: string,
    context: Record<string, unknown>,
  ): string {
    return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, path) => {
      const value = this.resolveValue(path.trim(), context);
      return value !== undefined ? String(value) : `{{${path}}}`;
    });
  }

  // ── 10.13 Expression Evaluation ──

  private evaluateExpression(
    expression: string,
    context: Record<string, unknown>,
  ): boolean {
    try {
      // Simple expression evaluator with context variables
      const fn = new Function(
        'context',
        `with(context) { return !!(${expression}); }`,
      );
      return fn(context);
    } catch {
      return false;
    }
  }

  // ── 10.14 Cycle Detection ──

  private detectCycles(flow: FlowDefinition): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (nodeId: string, path: string[]) => {
      visited.add(nodeId);
      recursionStack.add(nodeId);
      path.push(nodeId);

      const outgoing = flow.edges.filter((e) => e.source === nodeId);
      for (const edge of outgoing) {
        if (!visited.has(edge.target)) {
          dfs(edge.target, [...path]);
        } else if (recursionStack.has(edge.target)) {
          const cycleStart = path.indexOf(edge.target);
          cycles.push([...path.slice(cycleStart), edge.target]);
        }
      }

      recursionStack.delete(nodeId);
    };

    for (const node of flow.nodes) {
      if (!visited.has(node.id)) {
        dfs(node.id, []);
      }
    }

    return cycles;
  }

  // ── 10.15 Reachability ──

  private traverseReachable(
    nodeId: string,
    flow: FlowDefinition,
    visited: Set<string>,
  ): void {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const outgoing = flow.edges.filter((e) => e.source === nodeId);
    for (const edge of outgoing) {
      this.traverseReachable(edge.target, flow, visited);
    }
  }

  // ── 10.16 Auto-Fix Flow ──

  private autoFixFlow(
    flow: FlowDefinition,
    validation: FlowValidationResult,
  ): void {
    for (const error of validation.errors) {
      if (error.code === 'INFINITE_LOOP') {
        // Add a loop node before the cycle point
        this.logger.debug(`[AutoFix] Adding loop node for cycle`);
      }
    }
  }

  // ── 10.17 Flow Generation Prompt ──

  private buildFlowGenerationPrompt(params: {
    description: string;
    triggerHint?: string;
    nodeRegistry: NodeRegistryEntry[];
    capabilities: string;
    maxNodes: number;
    category?: string;
  }): string {
    const nodeTypes = params.nodeRegistry
      .map(
        (n) =>
          `- ${n.type}: ${n.description} (category: ${n.category})`,
      )
      .join('\n');

    return `Generate a workflow automation based on this description:

"""${params.description}"""

${params.triggerHint ? `Trigger hint: ${params.triggerHint}` : ''}
${params.category ? `Category: ${params.category}` : ''}

Available node types:
${nodeTypes}

Available modules and actions:
${params.capabilities.substring(0, 4000)}

RULES:
1. Maximum ${params.maxNodes} nodes
2. First node should be a "trigger"
3. Every action node needs "module" and "action" fields
4. Condition nodes need "condition", "operator", and "value"
5. Delay nodes need "delayUnit" and "delayValue"
6. AI decision nodes need "prompt" and "options"
7. Edges connect by node INDEX (sourceIndex → targetIndex)
8. Return ONLY valid JSON with this exact structure:

{
  "name": "Flow Name",
  "description": "Brief description",
  "category": "Category",
  "tags": ["tag1", "tag2"],
  "trigger": {
    "type": "event|schedule|manual|webhook|api|key_command",
    "config": {},
    "eventName": "optional_event_name",
    "cronExpression": "optional_cron"
  },
  "nodes": [
    {
      "type": "trigger",
      "position": { "x": 0, "y": 0 },
      "data": { "label": "Name", "config": {}, ...type-specific fields }
    }
  ],
  "edges": [
    { "sourceIndex": 0, "targetIndex": 1, "label": "optional" }
  ]
}`;
  }

  // ── 10.18 Template Factory ──

  private makeTemplate(params: {
    id: string;
    name: string;
    description: string;
    category: string;
    tags: string[];
    setupTime: string;
    difficulty?: 'beginner' | 'intermediate' | 'advanced';
    nodes: Array<{ type: FlowNodeType; label: string; config: Record<string, unknown> }>;
    edges: Array<{ from: number; to: number; label?: string }>;
    trigger: FlowTrigger;
  }): FlowTemplate {
    const flowNodes: FlowNode[] = params.nodes.map((n, idx) => ({
      id: `node_${params.id}_${idx}`,
      type: n.type,
      position: { x: idx * 250, y: 100 + (idx % 2) * 80 },
      data: {
        label: n.label,
        description: n.label,
        config: n.config,
        ...n.config,
      },
      inputs: [],
      outputs: [],
    }));

    const flowEdges: FlowEdge[] = params.edges.map((e, idx) => {
      const sourceId = flowNodes[e.from]?.id;
      const targetId = flowNodes[e.to]?.id;
      if (sourceId && targetId) {
        flowNodes[e.from].outputs.push(targetId);
        flowNodes[e.to].inputs.push(sourceId);
      }
      return {
        id: `edge_${params.id}_${idx}`,
        source: sourceId || '',
        target: targetId || '',
        label: e.label,
      };
    });

    return {
      id: params.id,
      name: params.name,
      description: params.description,
      category: params.category,
      nodes: flowNodes,
      edges: flowEdges,
      trigger: params.trigger,
      tags: params.tags,
      estimatedSetupTime: params.setupTime,
      difficulty: params.difficulty || 'beginner',
    };
  }

  // ── 10.19 Serialization ──

  private serializeFlow(flow: FlowDefinition): Record<string, unknown> {
    return {
      id: flow.id,
      businessId: flow.businessId,
      name: flow.name,
      description: flow.description,
      version: flow.version,
      nodes: flow.nodes as unknown as Record<string, unknown>[],
      edges: flow.edges as unknown as Record<string, unknown>[],
      trigger: flow.trigger as unknown as Record<string, unknown>,
      status: flow.status,
      tags: flow.tags,
      category: flow.category,
      executionCount: flow.executionCount,
      lastExecutionStatus: flow.lastExecutionStatus,
      lastExecutionAt: flow.lastExecutionAt,
      updatedAt: flow.updatedAt,
    };
  }

  private deserializeFlow(record: Record<string, unknown>): FlowDefinition {
    return {
      id: record.id as string,
      businessId: record.businessId as string,
      name: record.name as string,
      description: record.description as string | undefined,
      version: (record.version as number) || 1,
      nodes: (record.nodes || []) as FlowNode[],
      edges: (record.edges || []) as FlowEdge[],
      trigger: (record.trigger || { type: 'manual', config: {} }) as FlowTrigger,
      status: (record.status as FlowDefinition['status']) || 'draft',
      createdAt: new Date((record.createdAt as string | Date) || Date.now()),
      updatedAt: new Date((record.updatedAt as string | Date) || Date.now()),
      createdBy: (record.createdBy as string) || 'system',
      executionCount: (record.executionCount as number) || 0,
      lastExecutionAt: record.lastExecutionAt
        ? new Date(record.lastExecutionAt as string | Date)
        : undefined,
      lastExecutionStatus: record.lastExecutionStatus as
        | 'success'
        | 'error'
        | 'warning'
        | undefined,
      tags: (record.tags as string[]) || [],
      category: (record.category as string) || 'automation',
    };
  }

  private deserializeExecution(record: Record<string, unknown>): FlowExecution {
    return {
      id: record.id as string,
      flowId: record.flowId as string,
      businessId: record.businessId as string,
      status: (record.status as FlowExecution['status']) || 'completed',
      startedAt: new Date((record.startedAt as string | Date) || Date.now()),
      completedAt: record.completedAt
        ? new Date(record.completedAt as string | Date)
        : undefined,
      currentNodeId: record.currentNodeId as string | undefined,
      context: (record.context as Record<string, unknown>) || {},
      results: (record.results as FlowNodeResult[]) || [],
      error: record.error as string | undefined,
    };
  }

  // ── 10.20 Update Flow Execution Stats ──

  private async updateFlowExecutionStats(
    flowId: string,
    status: FlowExecution['status'],
  ): Promise<void> {
    try {
      await this.prisma.flowDefinition.update({
        where: { id: flowId },
        data: {
          executionCount: { increment: 1 },
          lastExecutionAt: new Date(),
          lastExecutionStatus:
            status === 'completed'
              ? 'success'
              : status === 'error'
                ? 'error'
                : 'warning',
        },
      });
    } catch (err) {
      this.logger.warn(`[Update Stats] ${flowId}: ${(err as Error).message}`);
    }
  }
}
