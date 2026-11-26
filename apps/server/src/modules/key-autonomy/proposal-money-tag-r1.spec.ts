/**
 * FU-PROPOSAL-MONEY-TAG R1 regression & security-hardening suite:
 * Covers every R1 Security & Correctness blocking finding without modifying
 * the immutable RED integration test file.
 */
import { describe, it, expect } from 'vitest';
import {
  isFinancialProposal,
  isMoneyMemoryEvent,
} from '../business-genome/key-genome/genome-finance-scope';
import {
  computeProposalCarriesMoney,
  isStructurallyFinancialProposal,
  isStructurallyFinancialTool,
  structuredPayloadCarriesMoney,
} from './proposal-money-tag';

describe('FU-PROPOSAL-MONEY-TAG R1 security & classification regressions', () => {
  it('fails closed on unknown tools even when prefixed with a non-money module (crm_*, crm.*, bookings.*)', () => {
    expect(isStructurallyFinancialTool('crm_backdoor_export')).toBe(true);
    expect(isStructurallyFinancialTool('crm.secret_tool')).toBe(true);
    expect(isStructurallyFinancialTool('bookings.update_service')).toBe(true);
    expect(isStructurallyFinancialTool('bookings.get_services')).toBe(true);
    expect(isStructurallyFinancialTool('bookings.unknown_custom_op')).toBe(true);
    expect(isStructurallyFinancialTool('operations_unknown_action')).toBe(true);
    // Known non-money dotted/snake tools remain non-financial
    expect(isStructurallyFinancialTool('crm.create_contact')).toBe(false);
    expect(isStructurallyFinancialTool('crm_create_contact')).toBe(false);
    expect(isStructurallyFinancialTool('temporal_flow.create_event')).toBe(false);
  });

  it('fails closed on EXECUTE_TOOL with no toolName and on unrecognized actionType even in non-money modules', () => {
    expect(
      isStructurallyFinancialProposal({
        actionType: 'EXECUTE_TOOL',
        module: 'crm',
        title: 'Run something',
      }),
    ).toBe(true);
    expect(
      isStructurallyFinancialProposal({
        actionType: 'CUSTOM_FUTURE_ACTION',
        module: 'crm',
        title: 'Run custom action',
      }),
    ).toBe(true);
    expect(
      isStructurallyFinancialProposal({
        actionType: '',
        module: 'crm',
        title: 'Empty action',
      }),
    ).toBe(true);
  });

  it('detects prefixed figure-trigger keys (grandTotal, hourlyRate, monthlyRetainer) and snake_case figures', () => {
    expect(structuredPayloadCarriesMoney({ grandTotal: 500 })).toBe(true);
    expect(structuredPayloadCarriesMoney({ hourlyRate: 150 })).toBe(true);
    expect(structuredPayloadCarriesMoney({ monthlyRetainer: 2400 })).toBe(true);
    expect(structuredPayloadCarriesMoney({ net_total: 900 })).toBe(true);
    expect(structuredPayloadCarriesMoney({ base_rate: 85 })).toBe(true);
    expect(
      computeProposalCarriesMoney({
        actionType: 'CREATE_TASK',
        module: 'crm',
        title: 'Follow up total_900',
      }),
    ).toBe(true);
    // Benign counts/rates stay non-financial
    expect(structuredPayloadCarriesMoney({ totalCount2: 12, responseRate: 95, totalItems: 4 })).toBe(false);
  });

  it('classifies approval_create_request by requestType/threshold and catches contracts_update & time_update_entry', () => {
    expect(isStructurallyFinancialTool('contracts_update')).toBe(true);
    expect(isStructurallyFinancialTool('contracts_delete')).toBe(true);
    expect(isStructurallyFinancialTool('time_update_entry')).toBe(true);
    expect(isStructurallyFinancialTool('approval_list')).toBe(true);
    expect(isStructurallyFinancialTool('approval_decide_step')).toBe(true);

    // approval_create_request: po / general / missing requestType / threshold -> true
    expect(
      isStructurallyFinancialProposal({
        actionType: 'EXECUTE_TOOL',
        module: 'operations',
        toolName: 'approval_create_request',
        payload: { requestType: 'po', title: 'Chairs' },
      }),
    ).toBe(true);
    expect(
      isStructurallyFinancialProposal({
        actionType: 'EXECUTE_TOOL',
        module: 'operations',
        toolName: 'approval_create_request',
        payload: { params: { requestType: 'time_off', threshold: 250 } },
      }),
    ).toBe(true);
    expect(
      isStructurallyFinancialProposal({
        actionType: 'EXECUTE_TOOL',
        module: 'operations',
        toolName: 'approval_create_request',
        payload: { title: 'Sign off' },
      }),
    ).toBe(true);

    // approval_create_request: non-money requestType with no threshold -> false
    expect(
      isStructurallyFinancialProposal({
        actionType: 'EXECUTE_TOOL',
        module: 'operations',
        toolName: 'approval_create_request',
        payload: { params: { requestType: 'time_off', title: 'Friday off' } },
      }),
    ).toBe(false);
  });

  it('inspects custom toJSON() outputs and catches money tokens/homoglyphs under id-named keys', () => {
    const disguised = {
      safe: 'ok',
      toJSON() {
        return { amount: 500 };
      },
    };
    expect(structuredPayloadCarriesMoney(disguised)).toBe(true);
    expect(structuredPayloadCarriesMoney({ createdAt: new Date('2026-11-26T12:00:00Z') })).toBe(false);

    // ID-named key smuggling vectors
    expect(structuredPayloadCarriesMoney({ refId: '$500' })).toBe(true);
    expect(structuredPayloadCarriesMoney({ refId: 'usd_500' })).toBe(true);
    expect(structuredPayloadCarriesMoney({ refId: 'total_900' })).toBe(true);
    expect(structuredPayloadCarriesMoney({ refId: '\u0440rice_500' })).toBe(true); // Cyrillic р
    expect(structuredPayloadCarriesMoney({ balanceId: 'x_1' })).toBe(true);
    expect(structuredPayloadCarriesMoney({ rentId: 'x_1' })).toBe(true);

    // Benign IDs remain false
    expect(structuredPayloadCarriesMoney({ taskId: 'tsk_1', contactId: '550e8400-e29b-41d4-a716-446655440000' })).toBe(false);
  });

  it('propagates executionResult on memory events even when carriesMoney was stamped false at creation', () => {
    const event = {
      sourceType: 'KEY_ACTION_PROPOSAL',
      eventType: 'ACTION_EXECUTED',
      title: 'Action executed: Create task',
      summary: 'KEY action CREATE_TASK was executed.',
      metadata: {
        actionType: 'CREATE_TASK',
        module: 'crm',
        toolName: null,
        carriesMoney: false,
        executionResult: { amount: 12345 },
      },
    };
    expect(isMoneyMemoryEvent(event)).toBe(true);

    // Direct proposal with carriesMoney=false + monetary executionResult is also caught
    expect(
      isFinancialProposal({
        actionType: 'CREATE_TASK',
        module: 'crm',
        title: 'Create task',
        carriesMoney: false,
        executionResult: { amount: 12345 },
      }),
    ).toBe(true);
  });
});
