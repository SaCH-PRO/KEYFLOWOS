import { describe, expect, it, vi } from 'vitest';
import { ContentRequestService } from './content-request.service';

function createMockPrisma() {
  const store = {
    contentRequests: new Map<string, any>(),
    contentDeliveryPackages: new Map<string, any>(),
  };
  let idCounter = 0;

  return {
    client: {
      contentRequest: {
        create: vi.fn(async (args: any) => {
          const id = `cr_${++idCounter}`;
          const record = { id, ...args.data, createdAt: new Date(), updatedAt: new Date() };
          store.contentRequests.set(id, record);
          return record;
        }),
        findUnique: vi.fn(async (args: any) => store.contentRequests.get(args.where.id) ?? null),
        findMany: vi.fn(async (args: any) => {
          const items = Array.from(store.contentRequests.values()).filter((req: any) => {
            if (args.where?.businessId && req.businessId !== args.where.businessId) return false;
            if (args.where?.status?.not !== undefined && req.status === args.where.status.not) return false;
            if (args.where?.status && typeof args.where.status === 'string' && req.status !== args.where.status) return false;
            return true;
          });
          return items.sort((a: any, b: any) => b.createdAt - a.createdAt);
        }),
        update: vi.fn(async (args: any) => {
          const existing = store.contentRequests.get(args.where.id);
          if (!existing) return null;
          const updated = { ...existing, ...args.data, updatedAt: new Date() };
          store.contentRequests.set(args.where.id, updated);
          return updated;
        }),
        count: vi.fn(async () => store.contentRequests.size),
      },
      contentDeliveryPackage: {
        findFirst: vi.fn(async (args: any) => {
          for (const pkg of store.contentDeliveryPackages.values()) {
            if (args.where?.contentRequestId && pkg.contentRequestId === args.where.contentRequestId) return pkg;
          }
          return null;
        }),
        create: vi.fn(async (args: any) => {
          const id = `cdp_${++idCounter}`;
          const record = { id, ...args.data };
          store.contentDeliveryPackages.set(id, record);
          return record;
        }),
        update: vi.fn(async (args: any) => {
          const existing = store.contentDeliveryPackages.get(args.where.id);
          if (!existing) return null;
          const updated = { ...existing, ...args.data };
          store.contentDeliveryPackages.set(args.where.id, updated);
          return updated;
        }),
        updateMany: vi.fn(async (args: any) => {
          let count = 0;
          for (const [id, pkg] of store.contentDeliveryPackages) {
            if (args.where?.contentRequestId && pkg.contentRequestId === args.where.contentRequestId) {
              store.contentDeliveryPackages.set(id, { ...pkg, ...args.data });
              count++;
            }
          }
          return { count };
        }),
      },
    },
    store,
  };
}

function createMockEmitter() {
  return { emit: vi.fn() };
}

function createMockApprovals() {
  return {
    createRequest: vi.fn(async () => ({ id: 'ar_1', status: 'pending' })),
  };
}

function createMockContentInvoice() {
  return {
    generateInvoiceFromDelivery: vi.fn(async () => ({ id: 'inv_1', status: 'DRAFT' })),
  };
}

describe('ContentRequestService', () => {
  it('creates a content request', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const approvals = createMockApprovals();
    const svc = new ContentRequestService(prisma as any, emitter as any, approvals as any, undefined);

    const result = await svc.createRequest({
      businessId: 'biz_1',
      requestedBy: 'user_1',
      source: 'user_request',
      contentTypes: ['blog_post'],
      businessGoal: 'Increase traffic',
    });

    expect(result.id).toBeDefined();
    expect(result.status).toBe('draft');
    expect(emitter.emit).toHaveBeenCalledWith('content_request.created', expect.any(Object));
  });

  it('transitions through pipeline', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const approvals = createMockApprovals();
    const svc = new ContentRequestService(prisma as any, emitter as any, approvals as any, undefined);

    const created = await svc.createRequest({
      businessId: 'biz_1',
      requestedBy: 'user_1',
      source: 'user_request',
      contentTypes: ['blog_post'],
      businessGoal: 'Increase traffic',
    });

    await svc.submitRequest(created.id, 'user_1');
    let req = await svc.getById(created.id);
    expect(req.status).toBe('submitted');

    await svc.assignRequest(created.id, ['writer_1'], 'user_1');
    req = await svc.getById(created.id);
    expect(req.status).toBe('assigned');

    await svc.startProduction(created.id, 'writer_1');
    req = await svc.getById(created.id);
    expect(req.status).toBe('in_production');

    await svc.submitForReview(created.id, 'writer_1');
    req = await svc.getById(created.id);
    expect(req.status).toBe('internal_review');

    await svc.reviewContent(created.id, 'submit_to_user', 'editor_1');
    req = await svc.getById(created.id);
    expect(req.status).toBe('user_review');

    await svc.reviewContent(created.id, 'approve', 'user_1');
    req = await svc.getById(created.id);
    expect(req.status).toBe('approved');
  });

  it('rejects invalid transitions', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const approvals = createMockApprovals();
    const svc = new ContentRequestService(prisma as any, emitter as any, approvals as any, undefined);

    const created = await svc.createRequest({
      businessId: 'biz_1',
      requestedBy: 'user_1',
      source: 'user_request',
      contentTypes: ['blog_post'],
      businessGoal: 'Increase traffic',
    });

    await expect(svc.startProduction(created.id, 'user_1')).rejects.toThrow('Invalid transition');
  });

  it('uploads deliverables', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const approvals = createMockApprovals();
    const svc = new ContentRequestService(prisma as any, emitter as any, approvals as any, undefined);

    const created = await svc.createRequest({
      businessId: 'biz_1',
      requestedBy: 'user_1',
      source: 'user_request',
      contentTypes: ['blog_post'],
      businessGoal: 'Increase traffic',
    });

    await svc.submitRequest(created.id, 'user_1');
    await svc.assignRequest(created.id, ['writer_1'], 'user_1');
    await svc.startProduction(created.id, 'writer_1');
    await svc.submitForReview(created.id, 'writer_1');
    await svc.reviewContent(created.id, 'submit_to_user', 'editor_1');
    await svc.reviewContent(created.id, 'approve', 'user_1');
    const result = await svc.uploadDeliverables(created.id, ['file_1', 'file_2'], 'folder_1', 'user_1');

    expect(result.status).toBe('uploaded_to_drive');
    expect(result.deliveryFileIds).toContain('file_1');
  });

  it('delivers request', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const approvals = createMockApprovals();
    const svc = new ContentRequestService(prisma as any, emitter as any, approvals as any, undefined);

    const created = await svc.createRequest({
      businessId: 'biz_1',
      requestedBy: 'user_1',
      source: 'user_request',
      contentTypes: ['blog_post'],
      businessGoal: 'Increase traffic',
    });

    await svc.submitRequest(created.id, 'user_1');
    await svc.assignRequest(created.id, ['writer_1'], 'user_1');
    await svc.startProduction(created.id, 'writer_1');
    await svc.submitForReview(created.id, 'writer_1');
    await svc.reviewContent(created.id, 'submit_to_user', 'editor_1');
    await svc.reviewContent(created.id, 'approve', 'user_1');
    await svc.uploadDeliverables(created.id, ['file_1'], 'folder_1', 'user_1');
    const result = await svc.deliverRequest(created.id, 'user_1');

    expect(result.status).toBe('delivered');
  });

  it('auto-generates invoice on delivery when invoiceOnDelivery is true', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const approvals = createMockApprovals();
    const contentInvoice = createMockContentInvoice();
    const svc = new ContentRequestService(prisma as any, emitter as any, approvals as any, contentInvoice as any);

    const created = await svc.createRequest({
      businessId: 'biz_1',
      requestedBy: 'user_1',
      source: 'user_request',
      contentTypes: ['blog_post'],
      businessGoal: 'Increase traffic',
      invoiceOnDelivery: true,
    });

    await svc.submitRequest(created.id, 'user_1');
    await svc.assignRequest(created.id, ['writer_1'], 'user_1');
    await svc.startProduction(created.id, 'writer_1');
    await svc.submitForReview(created.id, 'writer_1');
    await svc.reviewContent(created.id, 'submit_to_user', 'editor_1');
    await svc.reviewContent(created.id, 'approve', 'user_1');
    await svc.uploadDeliverables(created.id, ['file_1'], 'folder_1', 'user_1');
    const result = await svc.deliverRequest(created.id, 'user_1');

    expect(result.status).toBe('delivered');
    expect(contentInvoice.generateInvoiceFromDelivery).toHaveBeenCalledWith(created.id, 'biz_1');
  });

  it('gets pipeline', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const approvals = createMockApprovals();
    const svc = new ContentRequestService(prisma as any, emitter as any, approvals as any, undefined);

    await svc.createRequest({ businessId: 'biz_1', requestedBy: 'user_1', source: 'user_request', contentTypes: ['blog_post'], businessGoal: 'G1' });
    await svc.createRequest({ businessId: 'biz_1', requestedBy: 'user_1', source: 'user_request', contentTypes: ['social_post'], businessGoal: 'G2' });

    const pipeline = await svc.getPipeline('biz_1');
    expect(pipeline.total).toBe(2);
  });
});
