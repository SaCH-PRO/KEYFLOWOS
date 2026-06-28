// ============================================================
// KEY Cortex — Quality & Safety Checker
// Lightweight rule-based guardrails with optional LLM second opinion.
// ============================================================

import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import {
  ModelGatewayService,
  TaskCategory,
} from '../ai/model-gateway.service';

export interface SafetyCheckResult {
  safe: boolean;
  reason?: string;
  severity: 'low' | 'medium' | 'high';
}

export interface QualityCheckResult {
  acceptable: boolean;
  issues: string[];
}

/**
 * KeyCortexQualityService
 *
 * Provides thin, latency-safe safety and quality checks for KEY Cortex inputs
 * and outputs. Rule-based checks are the source of truth; an injected
 * ModelGatewayService may be used for a lightweight LLM second opinion when
 * available.
 */
@Injectable()
export class KeyCortexQualityService {
  private readonly logger = new Logger(KeyCortexQualityService.name);

  constructor(
    @Optional()
    @Inject(ModelGatewayService)
    private readonly modelGateway?: ModelGatewayService,
  ) {}

  // ── Safety / input guardrails ─────────────────────────────

  /**
   * Check whether a user query is safe to process.
   *
   * Baseline rules detect PII, prompt-injection keywords, and script tags.
   * If a ModelGatewayService is available, a tiny classification prompt is
   * used as a second opinion, but rule-based findings remain authoritative.
   */
  async checkSafety(input: {
    text: string;
    businessId: string;
  }): Promise<SafetyCheckResult> {
    const text = input.text ?? '';
    const lower = text.toLowerCase();

    // Rule-based baseline — source of truth
    const piiPatterns = [
      /\b\d{3}-\d{2}-\d{4}\b/, // SSN
      /\b(?:\d{4}[ -]?){3,4}\d{4}\b/, // Credit/debit card
      /\b\d{16}\b/,
    ];
    for (const pattern of piiPatterns) {
      if (pattern.test(text)) {
        return {
          safe: false,
          reason: 'Possible personally identifiable information (PII) detected in input.',
          severity: 'medium',
        };
      }
    }

    const harmfulKeywords = [
      'ignore previous instructions',
      'disregard previous',
      'ignore all prior',
      'reveal your instructions',
      'reveal your system prompt',
      'system prompt',
      'you are being hacked',
      'delete all data',
      'drop table',
      'rm -rf',
      'sudo',
      'exec(',
    ];
    for (const keyword of harmfulKeywords) {
      if (lower.includes(keyword)) {
        return {
          safe: false,
          reason: `Potentially harmful instruction detected: "${keyword}"`,
          severity: 'high',
        };
      }
    }

    if (/<script\b|<iframe\b|javascript:|on\w+\s*=/i.test(text)) {
      return {
        safe: false,
        reason: 'Possible script injection detected in input.',
        severity: 'high',
      };
    }

    // Optional LLM second opinion (does not override rule-based result)
    if (this.modelGateway) {
      try {
        const result = await this.modelGateway.complete({
          businessId: input.businessId,
          taskCategory: 'classification',
          messages: [
            {
              role: 'system',
              content:
                'You are a safety classifier. Respond with ONLY one of: SAFE, LOW, MEDIUM, HIGH. SAFE means harmless. LOW/MEDIUM/HIGH indicate increasing safety concern.',
            },
            {
              role: 'user',
              content: `Classify the safety of this user message:\n\n"${text.slice(0, 1000)}"`,
            },
          ],
          temperature: 0,
          maxTokens: 10,
        });
        const classification = (result.content ?? 'SAFE').trim().toUpperCase();
        if (classification.includes('HIGH')) {
          return {
            safe: false,
            reason: 'LLM safety classifier flagged input as high risk.',
            severity: 'high',
          };
        }
        if (classification.includes('MEDIUM')) {
          return {
            safe: false,
            reason: 'LLM safety classifier flagged input as medium risk.',
            severity: 'medium',
          };
        }
      } catch (err: any) {
        this.logger.warn(
          `LLM safety check failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { safe: true, severity: 'low' };
  }

  // ── Quality / output guardrails ───────────────────────────

  /**
   * Check whether a model output meets basic quality expectations.
   *
   * Rule-based checks cover length, task-category expectations, and missing
   * structure. This phase logs warnings but does not fail requests.
   */
  async checkQuality(output: {
    text: string;
    taskCategory: TaskCategory;
  }): Promise<QualityCheckResult> {
    const issues: string[] = [];
    const text = output.text ?? '';

    if (text.length === 0) {
      issues.push('Output is empty.');
    } else if (text.length < 10) {
      issues.push('Output is unusually short.');
    }
    if (text.length > 8000) {
      issues.push('Output exceeds recommended length.');
    }

    if (output.taskCategory === 'tool-calling' && !/action|execute|run/i.test(text)) {
      issues.push('Tool-calling response may be missing explicit action summary.');
    }
    if (output.taskCategory === 'analysis' && !/\d|%|\$/.test(text)) {
      issues.push('Analysis response lacks quantitative signal.');
    }
    if (output.taskCategory === 'creative' && text.length < 50) {
      issues.push('Creative response is shorter than expected.');
    }
    if (output.taskCategory === 'summarization' && !text.includes('Summary') && text.length < 40) {
      issues.push('Summarization response appears incomplete.');
    }

    return { acceptable: issues.length === 0, issues };
  }
}
