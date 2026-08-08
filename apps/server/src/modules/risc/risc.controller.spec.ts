import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { RiscController } from './risc.controller';
import { RiscService } from './risc.service';

describe('RiscController', () => {
  let controller: RiscController;
  let service: { receiveEvent: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    service = { receiveEvent: vi.fn() };
    const module = await Test.createTestingModule({
      controllers: [RiscController],
      providers: [{ provide: RiscService, useValue: service }],
    }).compile();

    controller = module.get(RiscController);
  });

  it('returns received=true for a valid event', async () => {
    service.receiveEvent.mockResolvedValue({ status: 202 as const, processed: true });

    const req = { rawBody: Buffer.from('valid-token') } as any;
    const result = await controller.receiveEvent(req);

    expect(result).toEqual({ received: true });
    expect(service.receiveEvent).toHaveBeenCalledWith('valid-token');
  });

  it('throws BadRequestException when validation fails', async () => {
    service.receiveEvent.mockResolvedValue({ status: 400 as const, processed: false });

    const req = { rawBody: Buffer.from('bad-token') } as any;
    await expect(controller.receiveEvent(req)).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException when body is missing', async () => {
    const req = { rawBody: Buffer.from('') } as any;
    await expect(controller.receiveEvent(req)).rejects.toThrow(BadRequestException);
  });
});
