import { describe, expect, it, vi } from 'vitest';
import { DeviceService, CreateCaptureInput } from '../src/modules/device/device.service';

class ClassifierMock {
  classify() {
    return null;
  }
}

class CommandsMock {
  async create() {
    return { id: 'cmd_1' };
  }
}

class DocIntelMock {
  async extractFromUrl() {
    return {};
  }
}

describe('DeviceService.createCapture', () => {
  it('persists publicUrl in MediaAsset and triggers auto-extraction for images', async () => {
    const createdAssets: any[] = [];
    const prisma: any = {
      client: {
        mediaAsset: {
          create: vi.fn(async ({ data }: any) => {
            const asset = { id: 'asset_1', ...data };
            createdAssets.push(asset);
            return asset;
          }),
        },
        visualIntake: {
          create: vi.fn(async ({ data }: any) => ({ id: 'intake_1', ...data })),
        },
        extractedEntity: {
          create: vi.fn(async () => ({ id: 'entity_1' })),
        },
        businessEvent: {
          create: vi.fn(async () => ({ id: 'event_1' })),
        },
      },
    };

    const service = new DeviceService(
      prisma,
      new ClassifierMock() as any,
      new CommandsMock() as any,
      new DocIntelMock() as any,
    );
    const autoExtractionSpy = vi
      .spyOn(service as any, 'runAutoExtraction')
      .mockResolvedValue(undefined);

    const input: CreateCaptureInput = {
      objectPath: 'uploads/receipt.jpg',
      publicUrl: 'https://cdn.keyflow.test/receipt.jpg',
      fileName: 'receipt.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 1024,
      mediaType: 'image',
    };

    const result = await service.createCapture('biz_1', 'user_1', input);

    expect(result.asset.publicUrl).toBe('https://cdn.keyflow.test/receipt.jpg');
    expect(prisma.client.mediaAsset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ publicUrl: 'https://cdn.keyflow.test/receipt.jpg' }),
      }),
    );

    // Allow the un-awaited auto-extraction promise to start
    await new Promise((res) => setImmediate(res));
    expect(autoExtractionSpy).toHaveBeenCalledWith(
      'biz_1',
      'asset_1',
      expect.any(String),
      input,
    );
  });

  it('allows publicUrl to be undefined', async () => {
    const prisma: any = {
      client: {
        mediaAsset: {
          create: vi.fn(async ({ data }: any) => ({ id: 'asset_2', ...data })),
        },
        visualIntake: {
          create: vi.fn(async ({ data }: any) => ({ id: 'intake_2', ...data })),
        },
        extractedEntity: {
          create: vi.fn(async () => ({ id: 'entity_2' })),
        },
        businessEvent: {
          create: vi.fn(async () => ({ id: 'event_2' })),
        },
      },
    };

    const service = new DeviceService(
      prisma,
      new ClassifierMock() as any,
      new CommandsMock() as any,
      new DocIntelMock() as any,
    );
    const autoExtractionSpy = vi
      .spyOn(service as any, 'runAutoExtraction')
      .mockResolvedValue(undefined);

    const input: CreateCaptureInput = {
      objectPath: 'uploads/doc.pdf',
      contentType: 'application/pdf',
      mediaType: 'document',
    };

    const result = await service.createCapture('biz_1', null, input);

    expect(result.asset.publicUrl).toBeNull();
    expect(autoExtractionSpy).not.toHaveBeenCalled();
  });
});
