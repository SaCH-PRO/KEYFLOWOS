/**
 * FU-GENOME-SURFACES-REVENUE round 1 (security review NIT-7, D-233): IntelligenceAdapterService.getSnapshot, which the
 * KEY context assembly reads, has no member to read the command-center snapshot for. It reads it for no reader (null),
 * so the genome composites and the money sections are withheld (fail closed), never as an internal caller (undefined).
 */
import { describe, expect, it, vi } from 'vitest';
import { IntelligenceAdapterService } from './intelligence-adapter.service';

describe('IntelligenceAdapterService.getSnapshot reads for no member', () => {
  it('passes null as the reader', async () => {
    const commandCenter = { snapshot: vi.fn().mockResolvedValue({}) };
    const svc = new IntelligenceAdapterService({} as any, {} as any, commandCenter as any, {} as any);
    await svc.getSnapshot('biz_1');
    expect(commandCenter.snapshot).toHaveBeenCalledWith('biz_1', null);
  });
});
