import { describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { RiscAdminController } from './risc-admin.controller';
import { RiscService } from './risc.service';

describe('RiscAdminController', () => {
  let controller: RiscAdminController;
  let risc: { eraseForUser: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    risc = { eraseForUser: vi.fn() };
    const module = await Test.createTestingModule({
      controllers: [RiscAdminController],
      providers: [{ provide: RiscService, useValue: risc }],
    }).compile();

    controller = module.get(RiscAdminController);
  });

  it('erases events when super admin calls', async () => {
    risc.eraseForUser.mockResolvedValue({ deleted: 5 });

    const result = await controller.eraseUserEvents(
      { id: 'admin-1', email: 'admin@example.com', role: 'SUPER_ADMIN' },
      'user-123',
    );

    expect(result).toEqual({ erased: 5 });
    expect(risc.eraseForUser).toHaveBeenCalledWith('user-123');
  });

  it('rejects non-admin callers', async () => {
    risc.eraseForUser.mockResolvedValue({ deleted: 0 });

    await expect(
      controller.eraseUserEvents(
        { id: 'user-1', email: 'user@example.com', role: 'USER' },
        'user-123',
      ),
    ).rejects.toThrow(UnauthorizedException);

    expect(risc.eraseForUser).not.toHaveBeenCalled();
  });
});
