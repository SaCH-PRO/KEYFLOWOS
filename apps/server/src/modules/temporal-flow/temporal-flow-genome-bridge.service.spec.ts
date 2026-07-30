import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemporalFlowGenomeBridgeService } from './temporal-flow-genome-bridge.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GenomeSignalService } from '../business-genome/key-genome/genome-signal.service';

describe('TemporalFlowGenomeBridgeService', () => {
  let service: TemporalFlowGenomeBridgeService;
  let prisma: { client: { temporalFlowEvent: { findMany: ReturnType<typeof vi.fn> } } };
  let genomeSignal: { createSignal: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    prisma = {
      client: {
        temporalFlowEvent: { findMany: vi.fn() },
      },
    };
    genomeSignal = { createSignal: vi.fn() };
    service = new TemporalFlowGenomeBridgeService(
      prisma as unknown as PrismaService,
      genomeSignal as unknown as GenomeSignalService,
    );
  });

  it('creates a genome signal when pattern threshold is met', async () => {
    prisma.client.temporalFlowEvent.findMany.mockResolvedValue([
      { id: 'e1', source: 'email', type: 'invoice_request', title: 'Invoice req', summary: 'Please send invoice', occurredAt: new Date(), payload: {} },
      { id: 'e2', source: 'email', type: 'invoice_request', title: 'Invoice req 2', summary: '', occurredAt: new Date(), payload: {} },
      { id: 'e3', source: 'email', type: 'invoice_request', title: 'Invoice req 3', summary: '', occurredAt: new Date(), payload: {} },
    ]);

    await service.detectPatterns('b1');

    expect(genomeSignal.createSignal).toHaveBeenCalled();
    const call = genomeSignal.createSignal.mock.calls[0][0];
    expect(call.businessId).toBe('b1');
    expect(call.signalType).toBe('REVENUE_PATTERN');
    expect(call.proposedValue.pattern).toBe('email_invoice_requests');
  });

  it('creates risk signal for repeated invoice complaints', async () => {
    prisma.client.temporalFlowEvent.findMany.mockResolvedValue([
      { id: 'e1', source: 'email', type: 'invoice_complaint', title: 'Complaint', summary: 'Wrong invoice', occurredAt: new Date(), payload: { sentiment: 'negative' } },
      { id: 'e2', source: 'email', type: 'invoice_complaint', title: 'Complaint 2', summary: '', occurredAt: new Date(), payload: { sentiment: 'negative' } },
    ]);

    await service.detectPatterns('b1');

    const calls = genomeSignal.createSignal.mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c.proposedValue.pattern === 'repeated_invoice_complaints')).toBe(true);
  });

  it('does not create signal below threshold', async () => {
    prisma.client.temporalFlowEvent.findMany.mockResolvedValue([
      { id: 'e1', source: 'email', type: 'invoice_request', title: 'Invoice req', occurredAt: new Date(), payload: {} },
    ]);

    await service.detectPatterns('b1');
    expect(genomeSignal.createSignal).not.toHaveBeenCalled();
  });
});
