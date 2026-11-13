/**
 * PR195-KEY-GATES (review findings SEC-P195BW-1, SEC-P195BW-2; owner rulings D-73, D-93): what KEY may do on a
 * turn that names no member.
 *
 * KEY runs on surfaces where nobody authenticated is driving it: a customer's Messenger, Instagram or WhatsApp DM
 * (INBOUND_CONVERSATION, ConversationalAIService), the Chatwoot support desk (FlowOrchestratorService.chat with no
 * user), a phone caller (PHONE_STREAM), a KEY-cortex run for no one (CORTEX_BRIDGE), a caller that declares nothing.
 * The text that drives those turns is written by a customer, so it can say anything. The packet before refused
 * them only money writes, and only on an allowlist of member-driven surfaces: a customer's DM still posted an
 * expense, matched bank lines and received a purchase order, and the support desk still read every customer's
 * balance, the bank balances and the P&L.
 *
 * DENIED BY DEFAULT. Such a turn may use only the tools below: what a customer-facing assistant needs (the
 * business's own service catalogue, whether a time is free, a lead for the person writing, a hand-off to a human),
 * and nothing that writes money or the Books, reads finance figures, reads the contact book or touches settings,
 * the team or a connector. Both the tool menu (FlowOrchestratorService.selectToolsForRequest) and every dispatch
 * door (executeTool through memberScopeRefusal, executeToolByName for the phone stream and an inner
 * execute_custom_logic call) refuse anything else, before any service is called. memberless-key-allowlist.spec.ts
 * pins this list by name, so adding a tool is a reviewed edit there.
 *
 * Out of scope here, held elsewhere: a stored plan step on the plan queue, an approved proposal and the Pro Auto
 * monitor are held to their member before dispatch (memberToolRunAuthority), and one with no member to D-73
 * (noMemberToolRefusal); the WhatsApp/SMS staff bridge is bounded by its issued position envelope
 * (JobRolePolicyService) and writes no money with no member (noMemberMoneyWriteRefusal, D-73).
 */

/** A tool a turn with no member may use, with why it is safe there. */
export interface MemberlessKeyTool {
  /** Why a customer-facing assistant may run it. */
  why: string;
  /**
   * Why these arguments are refused on such a turn, or null. Read only when the call's arguments are known (a
   * dispatch); the menu offers the tool.
   */
  refuseArgs?: (args: Record<string, unknown>) => string | null;
}

export const MEMBERLESS_KEY_TOOLS: Readonly<Record<string, MemberlessKeyTool>> = {
  helpdesk_create_ticket: {
    why: 'hands the conversation to a human: files a support ticket for the team (the action boundary still decides whether it is filed, sent for approval or refused on this surface)',
  },
  crm_create_contact: {
    why: 'records the person writing as a new lead (status LEAD); reads no other contact',
    refuseArgs: (args) => {
      const status = args.status;
      if (status === undefined || status === null || status === '' || status === 'LEAD') return null;
      return `creates a lead only (status LEAD), not a ${String(status)} contact`;
    },
  },
  bookings_list_services: {
    why: "the business's own service catalogue (names, durations and prices), as its public booking page shows it",
  },
  calendar_check_conflicts: {
    why: 'whether a time is free: a turn with no member is answered free or busy, with the busy times only (no event, title, note or contact)',
  },
};

/** The allowlist's names, for the words of a refusal and the prompt that tells a model which tools it may name. */
export const MEMBERLESS_KEY_TOOL_NAMES: readonly string[] = Object.keys(MEMBERLESS_KEY_TOOLS).sort();

/**
 * Why a turn that names no member may not run `toolName` with `args` (omitted: the menu, which judges the tool
 * alone), or null when it may. The words name the surface and the allowlist, and end as noMemberMoneyWriteRefusal's
 * do, so a refusal reads the same whichever door gave it.
 */
export function memberlessKeyToolRefusal(toolName: string, args?: unknown, surface = 'KEY'): string | null {
  const entry = Object.prototype.hasOwnProperty.call(MEMBERLESS_KEY_TOOLS, toolName) ? MEMBERLESS_KEY_TOOLS[toolName] : null;
  const tail = `this ${surface} turn names no member it runs for, so KEY does not run it (D-73)`;
  if (!entry) {
    return `"${toolName}" is not one of the tools KEY runs on a turn that names no member (${MEMBERLESS_KEY_TOOL_NAMES.join(', ')}); ${tail}`;
  }
  if (entry.refuseArgs && args !== undefined) {
    const why = entry.refuseArgs(args && typeof args === 'object' ? (args as Record<string, unknown>) : {});
    if (why) return `"${toolName}" ${why} on a turn that names no member; ${tail}`;
  }
  return null;
}
