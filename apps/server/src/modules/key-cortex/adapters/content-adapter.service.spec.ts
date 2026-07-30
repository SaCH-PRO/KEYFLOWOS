import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentAdapterService } from './content-adapter.service';
import { ContentService } from '../../content/content.service';
import { ConnectorCommand } from '../key-cortex-connector.types';

const mkCmd = (action: string, parameters: Record<string, unknown> = {}): ConnectorCommand => ({
  module: 'content',
  action,
  parameters,
  businessId: 'biz_123',
  userId: 'user_456',
  source: 'key_cortex',
  timestamp: new Date(),
  correlationId: 'corr_001',
});

describe('ContentAdapterService', () => {
  let service: ContentAdapterService;
  let content: ContentService;

  beforeEach(() => {
    content = {
      createPost: vi.fn(),
      schedulePost: vi.fn(),
      publishPost: vi.fn(),
      updatePost: vi.fn(),
      deletePost: vi.fn(),
      createCampaign: vi.fn(),
      sendCampaign: vi.fn(),
      generateContent: vi.fn(),
      getPosts: vi.fn(),
      getDrafts: vi.fn(),
      getScheduledPosts: vi.fn(),
      getCampaignPerformance: vi.fn(),
    } as unknown as ContentService;

    service = new ContentAdapterService(content);
  });

  // ── Actions ───────────────────────────────────────────────────────────────

  it('create_post delegates to ContentService.createPost', async () => {
    (content.createPost as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'p1' });
    const result = await service.execute(mkCmd('create_post', { title: 'Hello', body: 'World' }));
    expect(result.success).toBe(true);
    expect(content.createPost).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz_123', title: 'Hello' }));
  });

  it('send_campaign delegates to ContentService.sendCampaign', async () => {
    (content.sendCampaign as ReturnType<typeof vi.fn>).mockResolvedValue({ sent: 1 });
    const result = await service.execute(mkCmd('send_campaign', { campaignId: 'c1' }));
    expect(result.success).toBe(true);
    expect(content.sendCampaign).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz_123', campaignId: 'c1' }));
  });

  it('generate_content delegates to ContentService.generateContent', async () => {
    (content.generateContent as ReturnType<typeof vi.fn>).mockResolvedValue({ draft: 'X' });
    const result = await service.execute(mkCmd('generate_content', { topic: 'AI' }));
    expect(result.success).toBe(true);
    expect(content.generateContent).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz_123', topic: 'AI' }));
  });

  it('delete_post delegates to ContentService.deletePost', async () => {
    (content.deletePost as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const result = await service.execute(mkCmd('delete_post', { postId: 'p1' }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ deleted: true });
  });

  // ── Queries (Phase 1.3) ───────────────────────────────────────────────────

  it('get_content_calendar returns scheduled posts', async () => {
    (content.getScheduledPosts as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'p1', status: 'Scheduled' }]);
    const result = await service.execute(mkCmd('get_content_calendar', { from: '2026-07-01', to: '2026-07-31' }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ id: 'p1', status: 'Scheduled' }]);
  });

  it('get_campaign_performance returns performance', async () => {
    (content.getCampaignPerformance as ReturnType<typeof vi.fn>).mockResolvedValue({ sent: 10, opened: 2 });
    const result = await service.execute(mkCmd('get_campaign_performance', { campaignId: 'c1' }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ sent: 10, opened: 2 });
  });

  it('get_recent_posts returns posts', async () => {
    (content.getPosts as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'p1' }]);
    const result = await service.execute(mkCmd('get_recent_posts', { limit: 5 }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ id: 'p1' }]);
  });

  it('get_drafts returns drafts', async () => {
    (content.getDrafts as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'p1', status: 'Draft' }]);
    const result = await service.execute(mkCmd('get_drafts', { limit: 5 }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ id: 'p1', status: 'Draft' }]);
  });

  it('returns connectorFail for unknown action', async () => {
    const result = await service.execute(mkCmd('nonexistent'));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown content action');
  });
});
