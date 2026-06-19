import { describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConstitutionVersionController } from './constitution-version.controller';
import { ConstitutionVersionService } from './constitution-version.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import type { ConstitutionVersionData } from './constitution-version.types';

describe('ConstitutionVersionController', () => {
  async function makeController() {
    const version: ConstitutionVersionData = {
      id: 'const_1',
      businessId: 'biz_1',
      version: 1,
      title: 'Business Constitution',
      status: 'ACTIVE',
      content: {},
      generatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [ConstitutionVersionController],
      providers: [
        {
          provide: ConstitutionVersionService,
          useValue: {
            latest: vi.fn().mockResolvedValue(version),
            list: vi.fn().mockResolvedValue([version]),
            getVersion: vi.fn().mockResolvedValue(version),
            generate: vi.fn().mockResolvedValue(version),
            staleness: vi.fn().mockResolvedValue({ stale: false, reason: 'ok' }),
            archive: vi.fn().mockResolvedValue({ ...version, status: 'ARCHIVED' }),
          },
        },
      ],
    })
      .overrideGuard(AuthGuard).useValue({ canActivate: vi.fn(() => true) })
      .overrideGuard(BusinessGuard).useValue({ canActivate: vi.fn(() => true) })
      .compile();

    const controller = moduleRef.get(ConstitutionVersionController);
    const service = moduleRef.get(ConstitutionVersionService);
    return { controller, service, version };
  }

  it('returns the latest version', async () => {
    const { controller, service, version } = await makeController();
    const result = await controller.latest('biz_1');
    expect(result).toEqual(version);
    expect(service.latest).toHaveBeenCalledWith('biz_1');
  });

  it('lists versions', async () => {
    const { controller, service } = await makeController();
    const result = await controller.versions('biz_1');
    expect(result).toHaveLength(1);
    expect(service.list).toHaveBeenCalledWith('biz_1');
  });

  it('fetches a specific version', async () => {
    const { controller, service, version } = await makeController();
    const result = await controller.version('biz_1', '3');
    expect(result).toEqual(version);
    expect(service.getVersion).toHaveBeenCalledWith('biz_1', 3);
  });

  it('generates a new version', async () => {
    const { controller, service, version } = await makeController();
    const result = await controller.generate('biz_1', { changeNotes: 'notes' }, { user: { id: 'user_1' } });
    expect(result).toEqual(version);
    expect(service.generate).toHaveBeenCalledWith('biz_1', { changeNotes: 'notes' }, 'user_1');
  });

  it('returns staleness', async () => {
    const { controller, service } = await makeController();
    const result = await controller.staleness('biz_1');
    expect(result.stale).toBe(false);
    expect(service.staleness).toHaveBeenCalledWith('biz_1');
  });

  it('archives a version', async () => {
    const { controller, service } = await makeController();
    const result = await controller.archive('biz_1', '2');
    expect(result.status).toBe('ARCHIVED');
    expect(service.archive).toHaveBeenCalledWith('biz_1', 2);
  });
});
