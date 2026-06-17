import { Injectable } from '@nestjs/common';
import type { InboxAnalysis, InboxSuggestedAction } from './key-inbox.types';

const SUPPORTED_ACTION_TYPES = new Set([
  'create_task',
  'create_contact',
  'create_invoice',
  'create_booking',
  'draft_reply',
  'schedule_followup',
  'escalate',
  'none',
  'review',
]);

@Injectable()
export class KeyInboxActionService {
  async buildActions(analysis: InboxAnalysis): Promise<InboxSuggestedAction[]> {
    const actions = (analysis.suggestedActions ?? [])
      .filter(
        (action) =>
          action &&
          typeof action === 'object' &&
          SUPPORTED_ACTION_TYPES.has(action.type) &&
          action.confidence >= 0.4,
      )
      .map((action) => ({
        type: action.type,
        label: action.label,
        confidence: action.confidence,
        payload: action.payload,
      }));

    if (actions.length === 0) {
      actions.push({ type: 'review', label: 'Review in Key Inbox', confidence: 1, payload: undefined });
    }

    return actions;
  }
}
