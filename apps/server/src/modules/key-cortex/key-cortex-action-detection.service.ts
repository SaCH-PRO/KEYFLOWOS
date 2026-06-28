import { Injectable } from '@nestjs/common';
import { CortexActionType, CortexActionResult } from './key-cortex.types';

/**
 * KeyCortexActionDetectionService
 *
 * Parses action intents from AI-generated text content.
 * Supports structured action markers (e.g. `[[ACTION:CREATE_TASK]]`) and
 * natural-language action heuristics.
 */
@Injectable()
export class KeyCortexActionDetectionService {
  /**
   * Parse action intents from AI-generated text content.
   */
  detectActions(content: string): CortexActionResult[] {
    const actions: CortexActionResult[] = [];

    // Structured action markers: [[ACTION:TYPE]] ... [[/ACTION]]
    const structuredPattern =
      /\[\[ACTION:(\w+)\]\](.*?)\[\[\/ACTION\]\]/gs;
    let match: RegExpExecArray | null;
    while ((match = structuredPattern.exec(content)) !== null) {
      const actionType = match[1] as CortexActionType;
      const description = match[2].trim();
      if (this.isValidActionType(actionType)) {
        actions.push({
          actionType,
          status: 'pending_approval',
          description,
          requiresApproval: this.requiresApproval(actionType),
        });
      }
    }

    // Natural-language action heuristics
    const actionPatterns: Array<{
      type: CortexActionType;
      patterns: RegExp[];
      requiresApproval: boolean;
    }> = [
      {
        type: 'CREATE_TASK',
        patterns: [
          /(?:create|add|make)\s+(?:a\s+)?(?:new\s+)?task/i,
          /(?:set\s+up|schedule)\s+(?:a\s+)?task/i,
        ],
        requiresApproval: false,
      },
      {
        type: 'CREATE_EVENT',
        patterns: [
          /(?:schedule|create|book)\s+(?:a\s+)?(?:meeting|event|appointment)/i,
          /(?:set\s+up|plan)\s+(?:a\s+)?(?:call|sync|review)/i,
        ],
        requiresApproval: false,
      },
      {
        type: 'CREATE_INVOICE',
        patterns: [
          /(?:create|generate|send)\s+(?:an?\s+)?invoice/i,
          /(?:bill|invoice)\s+(?:the\s+)?(?:client|customer)/i,
        ],
        requiresApproval: true,
      },
      {
        type: 'CREATE_LEAD',
        patterns: [
          /(?:add|create)\s+(?:a\s+)?(?:new\s+)?lead/i,
          /(?:log|record)\s+(?:a\s+)?(?:potential\s+)?(?:client|customer|opportunity)/i,
        ],
        requiresApproval: false,
      },
      {
        type: 'SEND_EMAIL',
        patterns: [
          /(?:send|draft|compose)\s+(?:an?\s+)?email/i,
          /(?:email|write\s+to)\s+(?:the\s+)?(?:client|team|customer)/i,
        ],
        requiresApproval: true,
      },
      {
        type: 'ANALYZE_DATA',
        patterns: [
          /(?:analyze|examine|review)\s+(?:the\s+)?(?:data|metrics|numbers|performance)/i,
          /(?:run|generate)\s+(?:an?\s+)?(?:analysis|report)/i,
        ],
        requiresApproval: false,
      },
      {
        type: 'GENERATE_REPORT',
        patterns: [
          /(?:generate|create|produce)\s+(?:a\s+)?report/i,
          /(?:pull|get)\s+(?:a\s+)?(?:summary|report|dashboard)/i,
        ],
        requiresApproval: false,
      },
      {
        type: 'EXECUTE_FLOW',
        patterns: [
          /(?:run|execute|trigger)\s+(?:a\s+)?(?:workflow|flow|automation)/i,
          /(?:start|initiate)\s+(?:the\s+)?(?:process|pipeline)/i,
        ],
        requiresApproval: true,
      },
      {
        type: 'CREATE_DOCUMENT',
        patterns: [
          /(?:create|draft|write)\s+(?:a\s+)?(?:document|proposal|contract|memo)/i,
          /(?:generate|prepare)\s+(?:a\s+)?(?:doc|file|agreement)/i,
        ],
        requiresApproval: false,
      },
      {
        type: 'SCHEDULE_REMINDER',
        patterns: [
          /(?:set|create)\s+(?:a\s+)?reminder/i,
          /(?:remind\s+me|don't\s+let\s+me\s+forget)/i,
        ],
        requiresApproval: false,
      },
      {
        type: 'UPDATE_CRM',
        patterns: [
          /(?:update|change)\s+(?:the\s+)?(?:CRM|contact|deal|opportunity)/i,
          /(?:move|advance)\s+(?:the\s+)?(?:deal|lead)\s+(?:to|into)/i,
        ],
        requiresApproval: true,
      },
      {
        type: 'SEARCH_KNOWLEDGE',
        patterns: [
          /(?:search|find|look\s+up)\s+(?:in\s+)?(?:knowledge\s+base|docs|wiki|help)/i,
          /(?:what\s+do\s+we\s+know|find\s+information)\s+about/i,
        ],
        requiresApproval: false,
      },
    ];

    for (const actionDef of actionPatterns) {
      for (const pattern of actionDef.patterns) {
        if (pattern.test(content)) {
          const alreadyDetected = actions.some(
            (a) => a.actionType === actionDef.type,
          );
          if (!alreadyDetected) {
            actions.push({
              actionType: actionDef.type,
              status: 'pending_approval',
              description: `Detected intent: ${actionDef.type}`,
              requiresApproval: actionDef.requiresApproval,
            });
          }
          break;
        }
      }
    }

    return actions;
  }

  isValidActionType(type: string): type is CortexActionType {
    const validTypes: CortexActionType[] = [
      'CREATE_TASK',
      'CREATE_EVENT',
      'SEND_MESSAGE',
      'CREATE_DOCUMENT',
      'ANALYZE_DATA',
      'GENERATE_REPORT',
      'EXECUTE_FLOW',
      'QUERY_DATABASE',
      'UPDATE_RECORD',
      'SCHEDULE_REMINDER',
      'CREATE_INVOICE',
      'SEND_EMAIL',
      'CREATE_LEAD',
      'UPDATE_CRM',
      'SEARCH_KNOWLEDGE',
      'EXECUTE_TOOL',
    ];
    return validTypes.includes(type as CortexActionType);
  }

  requiresApproval(actionType: CortexActionType): boolean {
    const highImpactActions: CortexActionType[] = [
      'SEND_EMAIL',
      'CREATE_INVOICE',
      'EXECUTE_FLOW',
      'UPDATE_CRM',
      'SEND_MESSAGE',
      'EXECUTE_TOOL',
    ];
    return highImpactActions.includes(actionType);
  }
}
