/**
 * KEY Cortex — Organ Adapter Contract
 *
 * Every organ (KeyGenome, KeyInbox, TemporalFlow, StoreLink/Portal,
 * KeyConnector, etc.) implements this interface so the brain can:
 * - ask what state the organ is in
 * - ask what tools the organ exposes
 * - tell the organ to execute one of its tools
 * - subscribe the organ to bus events
 *
 * Adapters are the peripheral nervous system's plugs into each organ.
 */

import { KeyCortexEvent, KeyCortexEventBusService } from '../key-cortex-event-bus.service';
import {
  KeyCortexToolContext,
  KeyCortexToolDefinition,
  KeyCortexToolResult,
} from '../key-cortex-tool-registry.service';

export interface KeyOrganState {
  /** Whether the organ is healthy enough to be used */
  healthy: boolean;
  /** Human-readable status message */
  status: string;
  /** Recent events/observations from this organ */
  recentEvents?: KeyCortexEvent[];
  /** Any readiness gaps */
  gaps?: string[];
  /** Arbitrary organ-specific state snapshot */
  metadata?: Record<string, unknown>;
}

export interface IKeyOrganAdapter {
  /** Unique organ id, e.g. "key_inbox", "temporal_flow" */
  readonly organId: string;

  /** Human-readable organ name */
  readonly organName: string;

  /** Return the current state of the organ for a business */
  getState(businessId: string): Promise<KeyOrganState>;

  /** Return tool definitions this organ contributes to the canonical registry */
  listTools(): KeyCortexToolDefinition[];

  /** Execute one of this organ's tools */
  executeTool(
    toolName: string,
    ctx: KeyCortexToolContext,
    input: Record<string, unknown>,
  ): Promise<KeyCortexToolResult>;

  /** Wire the organ to the event bus (subscribe + optionally publish) */
  connect(bus: KeyCortexEventBusService): void | Promise<void>;
}

export abstract class KeyOrganAdapter implements IKeyOrganAdapter {
  abstract readonly organId: string;
  abstract readonly organName: string;

  protected bus?: KeyCortexEventBusService;

  abstract getState(businessId: string): Promise<KeyOrganState>;
  abstract listTools(): KeyCortexToolDefinition[];
  abstract executeTool(
    toolName: string,
    ctx: KeyCortexToolContext,
    input: Record<string, unknown>,
  ): Promise<KeyCortexToolResult>;

  connect(bus: KeyCortexEventBusService): void {
    this.bus = bus;
  }

  protected async publish(
    type: string,
    businessId: string,
    payload: Record<string, unknown>,
    metadata?: KeyCortexEvent['metadata'],
  ): Promise<KeyCortexEvent> {
    if (!this.bus) {
      throw new Error(`Organ ${this.organId} is not connected to the event bus`);
    }
    return this.bus.publish({
      source: this.organId,
      type,
      businessId,
      payload,
      metadata,
    });
  }
}
