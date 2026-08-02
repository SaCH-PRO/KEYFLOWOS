/**
 * KEY Cortex — Interoception (the afferent nervous system)
 *
 * The peripheral nervous system had only one direction wired. Organ adapters
 * declare `getState(businessId)`, and the registrar harvested `listTools()` at
 * boot so the brain could act on organs — the efferent, motor path. But
 * `getState` had zero call sites anywhere in the server: nothing ever asked an
 * organ how it was doing. KEY could move its limbs and could not feel them.
 *
 * This service is the return path. It polls every organ, caches the readings,
 * and turns them into something cognition can actually use.
 *
 * Two design decisions worth stating:
 *
 *  1. A failing organ is a READING, not an error. If StoreLink throws, that is
 *     information — the organ is unhealthy — and it belongs in the body state
 *     rather than propagating up and failing the query. Interoception must
 *     never be able to break the thought it is informing.
 *
 *  2. Readings are cached briefly. Organ state is queried once per conscious
 *     query, and five adapters each hitting the database on every keystroke-fast
 *     path would cost more than the signal is worth. The TTL is short enough
 *     that a degradation is noticed within one interaction.
 */

import { Injectable, Logger } from '@nestjs/common';
import { KeyCortexOrganRegistrarService } from './key-cortex-organ-registrar.service';
import type { KeyOrganState } from './organs/key-organ-adapter.interface';

/** One organ's reading, including the case where the organ could not answer. */
export interface OrganReading {
  organId: string;
  organName: string;
  healthy: boolean;
  status: string;
  gaps: string[];
  /** Set when getState itself threw — the organ is unreachable, not merely unwell. */
  unreachable?: string;
  /** How long the organ took to answer. A slow organ is a signal too. */
  ms: number;
}

/** The whole body, as felt from the inside. */
export interface BodyState {
  businessId: string;
  readings: OrganReading[];
  /** Organs answering healthy, out of those that answered at all. */
  healthyCount: number;
  totalCount: number;
  /** Organs that threw rather than reporting. */
  unreachableCount: number;
  /** Every gap any organ reported, deduplicated. */
  gaps: string[];
  /** 0–1. Not a score to display; a signal for cognition to weigh. */
  integrity: number;
  sampledAt: Date;
}

/**
 * How long a reading stays fresh.
 *
 * Short by design: the point of interoception is noticing that something has
 * changed, and a long TTL would let KEY reason confidently from a stale body.
 */
const READING_TTL_MS = 15_000;

/** An organ that takes longer than this is treated as unreachable. */
const ORGAN_TIMEOUT_MS = 3_000;

@Injectable()
export class KeyCortexInteroceptionService {
  private readonly logger = new Logger(KeyCortexInteroceptionService.name);
  private readonly cache = new Map<string, BodyState>();

  constructor(private readonly registrar: KeyCortexOrganRegistrarService) {}

  /**
   * Sense the current state of every organ.
   *
   * Never throws. An organ that fails or hangs becomes an unreachable reading.
   */
  async senseBody(businessId: string, force = false): Promise<BodyState> {
    if (!force) {
      const cached = this.cache.get(businessId);
      if (cached && Date.now() - cached.sampledAt.getTime() < READING_TTL_MS) {
        return cached;
      }
    }

    const adapters = this.registrar.listAdapters();

    // Poll in parallel. Sequential polling would make the slowest organ set the
    // latency of every conscious query.
    const readings = await Promise.all(
      adapters.map((adapter) => this.readOrgan(adapter.organId, adapter.organName, () =>
        adapter.getState(businessId),
      )),
    );

    const answered = readings.filter((r) => !r.unreachable);
    const healthyCount = answered.filter((r) => r.healthy).length;
    const unreachableCount = readings.length - answered.length;

    const body: BodyState = {
      businessId,
      readings,
      healthyCount,
      totalCount: readings.length,
      unreachableCount,
      gaps: [...new Set(readings.flatMap((r) => r.gaps))],
      // An unreachable organ counts against integrity exactly as an unhealthy
      // one does. From the brain's perspective "I cannot feel it" and "it is
      // not working" warrant the same caution.
      integrity: readings.length === 0 ? 1 : healthyCount / readings.length,
      sampledAt: new Date(),
    };

    this.cache.set(businessId, body);
    return body;
  }

  /**
   * Render body state as a line of context for the reasoning prompt.
   *
   * Returns null when everything is healthy. Telling the model "all systems
   * normal" on every query spends tokens to say nothing and trains it to skim
   * the section — so the signal appears only when there is a signal.
   */
  describeForPrompt(body: BodyState): string | null {
    const impaired = body.readings.filter((r) => r.unreachable || !r.healthy);
    if (impaired.length === 0) return null;

    const lines = impaired.map((r) =>
      r.unreachable
        ? `- ${r.organName}: unreachable (${r.unreachable})`
        : `- ${r.organName}: ${r.status}`,
    );

    if (body.gaps.length > 0) {
      lines.push(`- Outstanding gaps: ${body.gaps.slice(0, 5).join('; ')}`);
    }

    return (
      `SYSTEM STATE — ${impaired.length} of ${body.totalCount} subsystems impaired.\n` +
      `${lines.join('\n')}\n` +
      `Treat data sourced from an impaired subsystem as incomplete, and say so ` +
      `rather than presenting it as a full picture.`
    );
  }

  /** Drop cached readings, e.g. after an action that changes organ state. */
  invalidate(businessId: string): void {
    this.cache.delete(businessId);
  }

  /**
   * Read one organ, converting both failure and hang into a reading.
   */
  private async readOrgan(
    organId: string,
    organName: string,
    read: () => Promise<KeyOrganState>,
  ): Promise<OrganReading> {
    const start = Date.now();
    try {
      const state = await this.withTimeout(read());
      return {
        organId,
        organName,
        healthy: state.healthy,
        status: state.status,
        gaps: state.gaps ?? [],
        ms: Date.now() - start,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown failure';
      // debug, not error: an organ being down is expected operational state for
      // a business that has not connected it, and logging it at error level on
      // every query would bury real faults.
      this.logger.debug(`[interoception] ${organId} unreachable: ${message}`);
      return {
        organId,
        organName,
        healthy: false,
        status: 'unreachable',
        gaps: [],
        unreachable: message,
        ms: Date.now() - start,
      };
    }
  }

  /**
   * A hanging organ must not hang cognition. Without this an adapter awaiting a
   * dead third-party connector would hold the whole pipeline open.
   */
  private withTimeout(promise: Promise<KeyOrganState>): Promise<KeyOrganState> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no response in ${ORGAN_TIMEOUT_MS}ms`)),
        ORGAN_TIMEOUT_MS,
      );
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }
}
