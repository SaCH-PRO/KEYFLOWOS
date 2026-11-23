/**
 * FU-GENOME-EVOLUTION-SURFACES (D-238): the two other member-facing callers of
 * BusinessIntelligenceService.generateExecutiveBrief hand it their reader, so its pending-proposal insight quotes only
 * the proposals that reader may see (the projection itself is pinned end to end by
 * genome-evolution-surfaces.integration.test.ts GES-06).
 *
 *   GER-01  GET business-genome/.../document-pack/executive-brief/export (AuthGuard and BusinessGuard only) passes the
 *           request's reader through GenomeDocumentPackService.exportExecutiveBrief.
 *   GER-02  The KEY intelligence tool run_comprehensive_analysis reads the brief for the command's actor, as it already
 *           reads the command-center snapshot (D-238 round 3); no actor is no reader (null).
 */
import { describe, expect, it, vi } from 'vitest';
import { GenomeDocumentPackController } from './genome-document-pack.controller';
import { GenomeDocumentPackService } from './genome-document-pack.service';
import { IntelligenceAdapterService } from '../../key-cortex/adapters/intelligence-adapter.service';

const BRIEF = {
  businessId: 'biz_1', generatedAt: new Date().toISOString(), summary: 'S', genomeIntegrity: 0, executiveReadinessScore: 0,
  genomeStage: 'SEED', insights: [], topPriorities: [],
};

function res() {
  return { set: vi.fn().mockReturnThis(), setHeader: vi.fn(), send: vi.fn(), status: vi.fn().mockReturnThis(), end: vi.fn() } as any;
}

describe('FU-GENOME-EVOLUTION-SURFACES: the executive brief is read for the caller', () => {
  it('GER-01 the document-pack executive-brief export passes the request reader to the brief', async () => {
    const intelligence = { generateExecutiveBrief: vi.fn().mockResolvedValue(BRIEF) };
    const service = new GenomeDocumentPackService(intelligence as any, {} as any, {} as any);
    const controller = new GenomeDocumentPackController(service);
    await (controller.exportExecutiveBrief as any)('biz_1', 'docx', res(), { user: { id: 'user_1', role: 'USER' } });
    expect(intelligence.generateExecutiveBrief).toHaveBeenCalledWith('biz_1', { id: 'user_1', role: 'USER' });
    intelligence.generateExecutiveBrief.mockClear();
    await (controller.exportExecutiveBrief as any)('biz_1', 'docx', res(), {});
    expect(intelligence.generateExecutiveBrief).toHaveBeenCalledWith('biz_1', null);
  });

  it('GER-02 run_comprehensive_analysis reads the brief for the command actor (null with none)', async () => {
    const intelligence = { generateExecutiveBrief: vi.fn().mockResolvedValue(BRIEF) };
    const svc = new IntelligenceAdapterService(
      intelligence as any,
      { getDashboard: vi.fn().mockResolvedValue({}) } as any,
      { snapshot: vi.fn().mockResolvedValue({}) } as any,
      {} as any,
    );
    const cmd = (userId?: string) => ({
      module: 'intelligence', action: 'run_comprehensive_analysis', parameters: {}, businessId: 'biz_9', userId,
      source: 'key_cortex', timestamp: new Date(), correlationId: 'c',
    }) as any;
    await svc.execute(cmd('user_9'));
    expect(intelligence.generateExecutiveBrief).toHaveBeenCalledWith('biz_9', { id: 'user_9' });
    intelligence.generateExecutiveBrief.mockClear();
    await svc.execute(cmd(undefined));
    expect(intelligence.generateExecutiveBrief).toHaveBeenCalledWith('biz_9', null);
  });
});
