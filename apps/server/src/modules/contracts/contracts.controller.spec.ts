import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard } from '../../core/auth/module-scope.guard';

const mockService = () => ({
  listContracts: vi.fn().mockResolvedValue({ items: [], nextCursor: undefined, total: 0 }),
  getContract: vi.fn().mockResolvedValue({ id: 'c1', title: 'Test' }),
  createContract: vi.fn().mockResolvedValue({ id: 'c1', title: 'Test' }),
  updateContract: vi.fn().mockResolvedValue({ id: 'c1', title: 'Updated' }),
  deleteContract: vi.fn().mockResolvedValue({ deleted: true }),
  extractTermsFromDocument: vi.fn().mockResolvedValue({ id: 'c1' }),
  acknowledgeAlert: vi.fn().mockResolvedValue({ id: 'a1' }),
  getStats: vi.fn().mockResolvedValue({ total: 0, byStatus: {}, expiringSoon: 0, renewalDue: 0, expired: 0, alertCount: 0 }),
  listTags: vi.fn().mockResolvedValue([]),
  createTag: vi.fn().mockResolvedValue({ id: 't1' }),
  deleteTag: vi.fn().mockResolvedValue({ deleted: true }),
});

describe('ContractsController', () => {
  let controller: ContractsController;
  let service: ReturnType<typeof mockService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContractsController],
      providers: [{ provide: ContractsService, useValue: mockService() }],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(BusinessGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ModuleScopeGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ContractsController>(ContractsController);
    service = module.get(ContractsService);
  });

  it('should list contracts', async () => {
    const result = await controller.list('biz_1');
    expect(service.listContracts).toHaveBeenCalledWith('biz_1', expect.any(Object));
    expect(result.items).toEqual([]);
  });

  it('should create a contract', async () => {
    const dto = { title: 'NDA' } as any;
    const result = await controller.create('biz_1', dto, { user: { id: 'u1' } });
    expect(service.createContract).toHaveBeenCalledWith('biz_1', dto, 'u1');
    expect(result).toEqual({ id: 'c1', title: 'Test' });
  });

  it('should extract terms', async () => {
    const dto = { url: 'http://example.com/contract.pdf', filename: 'contract.pdf', mimeType: 'application/pdf' };
    await controller.extractTerms('biz_1', 'c1', dto, { user: { id: 'u1' } });
    expect(service.extractTermsFromDocument).toHaveBeenCalledWith('biz_1', 'c1', dto, 'u1');
  });
});
