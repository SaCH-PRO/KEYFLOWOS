import { describe, expect, it } from 'vitest';
import { ContentOpsController } from './content-ops.controller';
import { ContentRequestService } from './content-request.service';
import { ContentDeliveryService } from './content-delivery.service';

function createMockContentRequestService(): any {
  return {
    createRequest: async () => ({ id: 'cr_1', status: 'draft', businessGoal: 'Test' }),
    getById: async () => ({ id: 'cr_1', status: 'draft', businessGoal: 'Test' }),
    listForBusiness: async () => ({ items: [], total: 0 }),
    updateRequest: async () => ({ id: 'cr_1', status: 'updated' }),
    submitRequest: async () => ({ id: 'cr_1', status: 'submitted' }),
    assignRequest: async () => ({ id: 'cr_1', status: 'assigned' }),
    startProduction: async () => ({ id: 'cr_1', status: 'in_production' }),
    submitForReview: async () => ({ id: 'cr_1', status: 'internal_review' }),
    reviewContent: async () => ({ id: 'cr_1', status: 'approved' }),
    uploadDeliverables: async () => ({ id: 'cr_1', status: 'uploaded_to_drive' }),
    deliverRequest: async () => ({ id: 'cr_1', status: 'delivered' }),
    cancelRequest: async () => ({ id: 'cr_1', status: 'cancelled' }),
    getPipeline: async () => ({ pipeline: {}, counts: {}, total: 0 }),
  };
}

function createMockDeliveryService(): any {
  return {
    createFolder: async () => ({ folderId: 'f_1' }),
    createDoc: async () => ({ id: 'doc_1' }),
    getDeliveryStatus: async () => ({ requestStatus: 'approved', driveFolderId: 'f_1' }),
  };
}

describe('ContentOpsController', () => {
  const contentRequests = createMockContentRequestService();
  const delivery = createMockDeliveryService();
  const controller = new ContentOpsController(contentRequests, delivery);

  it('creates a content request', async () => {
    const result = await controller.create('biz_1', {
      source: 'user_request',
      contentTypes: ['blog_post'],
      businessGoal: 'Increase traffic',
    } as any, { user: { id: 'user_1' } } as any);
    expect(result.status).toBe('draft');
  });

  it('submits a request', async () => {
    const result = await controller.submit('cr_1', { user: { id: 'user_1' } } as any);
    expect(result.status).toBe('submitted');
  });

  it('assigns team members', async () => {
    const result = await controller.assign('cr_1', { teamMemberIds: ['writer_1'] }, { user: { id: 'user_1' } } as any);
    expect(result.status).toBe('assigned');
  });

  it('reviews content', async () => {
    const result = await controller.review('cr_1', { action: 'approve' } as any, { user: { id: 'user_1' } } as any);
    expect(result.status).toBe('approved');
  });

  it('creates drive folder', async () => {
    const result = await controller.createDriveFolder('biz_1', 'cr_1', {});
    expect(result.folderId).toBe('f_1');
  });
});
