import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';

interface GenerateDraftInput {
  contentType: string;
  objective?: string;
  tone?: string;
  audience?: string;
  topic?: string;
  existingBody?: string;
  businessName?: string;
  industry?: string;
}

interface RewriteInput {
  body: string;
  targetChannel: string;
  tone?: string;
  objective?: string;
}

interface SuggestSubjectsInput {
  body: string;
  objective?: string;
  tone?: string;
  audience?: string;
}

interface SuggestCtaInput {
  body: string;
  objective?: string;
  contentType?: string;
}

interface SuggestHashtagsInput {
  body: string;
  industry?: string;
}

interface ShortenExpandInput {
  body: string;
  action: 'shorten' | 'expand';
  targetChannel?: string;
}

interface SuggestChannelsInput {
  body: string;
  objective?: string;
  audience?: string;
  availableChannels: string[];
}

interface SuggestTimeInput {
  contentType: string;
  audience?: string;
  timezone?: string;
}

interface SuggestPreviewTextInput {
  subject: string;
  body: string;
  objective?: string;
}

interface SuggestAudienceSegmentsInput {
  body: string;
  contentType?: string;
  objective?: string;
  existingSegments?: string[];
}

interface SuggestContentIdeasInput {
  objective?: string;
  audience?: string;
  recentTopics?: string[];
  contentType?: string;
}

function sanitize(input: string, maxLen = 500): string {
  let s = input;
  const patterns = [
    /<\|system\|>/gi, /<\|user\|>/gi, /<\|assistant\|>/gi,
    /\[INST\]/gi, /\[\/INST\]/gi, /<<SYS>>/gi, /<<\/SYS>>/gi,
    /<\/s>/gi, /^Human:/gim, /^Assistant:/gim, /^System:/gim,
  ];
  for (const p of patterns) s = s.replace(p, '');
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return s.slice(0, maxLen);
}

@Injectable()
export class ContentAiService {
  private readonly logger = new Logger(ContentAiService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
  ) {}

  private async getBusinessContext(businessId: string) {
    const biz = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { name: true, industry: true, tagline: true, description: true, currency: true },
    });
    return biz;
  }

  async generateDraft(businessId: string, input: GenerateDraftInput) {

    const biz = await this.getBusinessContext(businessId);
    const channelContext = this.getChannelContext(input.contentType);

    const prompt = `You are an expert marketing copywriter for a Caribbean service business.
Business: ${biz?.name || input.businessName || 'Business'} (${biz?.industry || input.industry || 'Service'})
${biz?.tagline ? `Tagline: ${biz.tagline}` : ''}
Currency: ${biz?.currency || 'TTD'}

Write ${channelContext.label} content.
${input.objective ? `Objective: ${sanitize(input.objective, 100)}` : ''}
${input.tone ? `Tone: ${sanitize(input.tone, 50)}` : ''}
${input.audience ? `Target Audience: ${sanitize(input.audience, 100)}` : ''}
${input.topic ? `Topic/Brief: ${sanitize(input.topic, 300)}` : ''}

${channelContext.guidelines}

Respond in valid JSON:
{
  "body": "The full content text",
  "subject": "Subject line (for email only, null otherwise)",
  "hashtags": ["relevant", "hashtags"],
  "cta": "Suggested call-to-action phrase"
}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'content_draft_generation',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: input.existingBody ? `Improve this draft: ${sanitize(input.existingBody, 1000)}` : `Generate a ${channelContext.label} draft for my ${biz?.industry || 'service'} business.` },
      ],
      maxTokens: 1500,
      temperature: 0.7,
      responseMode: 'structured_json',
    });

    return this.parseJsonResponse(result.content, { body: '', subject: null, hashtags: [], cta: '' });
  }

  async rewriteForChannel(businessId: string, input: RewriteInput) {

    const channelContext = this.getChannelContext(input.targetChannel);
    const isEmail = ['email', 'campaign_email'].includes(input.targetChannel.toLowerCase());

    const prompt = `Rewrite the following content specifically optimized for ${channelContext.label}.
${input.tone ? `Maintain a ${sanitize(input.tone, 50)} tone.` : ''}
${input.objective ? `Objective: ${sanitize(input.objective, 100)}` : ''}

Channel-specific optimization rules:
${channelContext.guidelines}

Respond in valid JSON:
{
  "body": "The rewritten content optimized for ${channelContext.label}",
  "subject": ${isEmail ? '"Compelling subject line under 60 chars"' : 'null'},
  "previewText": ${isEmail ? '"Preview/preheader text (40-90 chars)"' : 'null'},
  "hashtags": ["relevant", "hashtags"]
}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'content_channel_rewrite',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Rewrite for ${channelContext.label}: ${sanitize(input.body, 2000)}` },
      ],
      maxTokens: 1500,
      temperature: 0.6,
      responseMode: 'structured_json',
    });

    return this.parseJsonResponse(result.content, { body: '', subject: null, previewText: null, hashtags: [] });
  }

  async suggestSubjects(businessId: string, input: SuggestSubjectsInput) {

    const prompt = `Generate 5 compelling email subject lines for the following content.
${input.objective ? `Objective: ${sanitize(input.objective, 100)}` : ''}
${input.tone ? `Tone: ${sanitize(input.tone, 50)}` : ''}
${input.audience ? `Audience: ${sanitize(input.audience, 100)}` : ''}

Rules:
- Keep under 60 characters each
- Use power words and urgency where appropriate
- Avoid spam trigger words
- Optimize for open rates

Respond in valid JSON:
{ "subjects": ["subject1", "subject2", "subject3", "subject4", "subject5"] }`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'content_subject_suggestions',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Suggest subjects for: ${sanitize(input.body, 1000)}` },
      ],
      maxTokens: 500,
      temperature: 0.8,
      responseMode: 'structured_json',
    });

    return this.parseJsonResponse(result.content, { subjects: [] });
  }

  async suggestCta(businessId: string, input: SuggestCtaInput) {

    const prompt = `Generate 4 compelling calls-to-action for the following content.
${input.objective ? `Objective: ${sanitize(input.objective, 100)}` : ''}
Content type: ${input.contentType || 'general'}

Rules:
- Be action-oriented
- Create urgency
- Be specific to the content
- Vary between soft and strong CTAs

Respond in valid JSON:
{ "ctas": [{ "text": "CTA text", "style": "button|inline|link" }] }`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'content_cta_suggestions',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Suggest CTAs for: ${sanitize(input.body, 1000)}` },
      ],
      maxTokens: 400,
      temperature: 0.7,
      responseMode: 'structured_json',
    });

    return this.parseJsonResponse(result.content, { ctas: [] });
  }

  async suggestHashtags(businessId: string, input: SuggestHashtagsInput) {

    const biz = await this.getBusinessContext(businessId);

    const prompt = `Generate relevant hashtags for this social media post.
Industry: ${biz?.industry || input.industry || 'Service Business'}
Location context: Trinidad & Tobago / Caribbean

Rules:
- Mix popular and niche hashtags
- Include location-relevant tags
- Include industry-specific tags
- 8-12 hashtags total

Respond in valid JSON:
{ "hashtags": ["hashtag1", "hashtag2"], "groups": { "trending": ["tag"], "niche": ["tag"], "local": ["tag"] } }`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'content_hashtag_suggestions',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Suggest hashtags for: ${sanitize(input.body, 1000)}` },
      ],
      maxTokens: 400,
      temperature: 0.7,
      responseMode: 'structured_json',
    });

    return this.parseJsonResponse(result.content, { hashtags: [], groups: {} });
  }

  async shortenOrExpand(businessId: string, input: ShortenExpandInput) {

    const action = input.action === 'shorten' ? 'shorter and more concise' : 'longer with more detail and depth';
    const channelContext = input.targetChannel ? this.getChannelContext(input.targetChannel) : null;

    const prompt = `Rewrite the following content to be ${action}.
${channelContext ? `Optimized for: ${channelContext.label}` : ''}
${channelContext ? channelContext.guidelines : ''}
Maintain the same tone and message. ${input.action === 'shorten' ? 'Remove filler words, tighten sentences.' : 'Add examples, expand on key points, add transitions.'}

Respond in valid JSON:
{ "body": "The rewritten content" }`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'content_shorten_expand',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `${input.action === 'shorten' ? 'Shorten' : 'Expand'}: ${sanitize(input.body, 2000)}` },
      ],
      maxTokens: 1500,
      temperature: 0.5,
      responseMode: 'structured_json',
    });

    return this.parseJsonResponse(result.content, { body: '' });
  }

  async suggestChannels(businessId: string, input: SuggestChannelsInput) {

    const prompt = `Recommend the best distribution channels for this content.
Available channels: ${input.availableChannels.join(', ')}
${input.objective ? `Objective: ${sanitize(input.objective, 100)}` : ''}
${input.audience ? `Target Audience: ${sanitize(input.audience, 100)}` : ''}

Respond in valid JSON:
{ "recommended": [{ "channel": "channel_name", "reason": "Why this channel", "priority": "primary|secondary" }] }`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'content_channel_suggestions',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Recommend channels for: ${sanitize(input.body, 1000)}` },
      ],
      maxTokens: 500,
      temperature: 0.5,
      responseMode: 'structured_json',
    });

    return this.parseJsonResponse(result.content, { recommended: [] });
  }

  async suggestSendTime(businessId: string, input: SuggestTimeInput) {

    const tz = input.timezone || 'America/Port_of_Spain';

    const prompt = `Recommend the best times to publish ${input.contentType} content.
Timezone: ${tz}
${input.audience ? `Target Audience: ${sanitize(input.audience, 100)}` : ''}
Location context: Trinidad & Tobago / Caribbean

Consider:
- Local business hours and culture
- Social media peak engagement times for the Caribbean
- Email open rate patterns
- Day of week recommendations

Respond in valid JSON:
{
  "suggestions": [
    { "day": "Tuesday", "time": "10:00 AM", "reason": "High engagement for Caribbean audiences", "score": 85 },
    { "day": "Thursday", "time": "2:00 PM", "reason": "Post-lunch browsing peak", "score": 78 }
  ],
  "bestWindow": "Tuesday-Thursday, 9AM-11AM AST"
}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'content_send_time_suggestions',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Best send times for ${input.contentType} targeting ${input.audience || 'general audience'}` },
      ],
      maxTokens: 500,
      temperature: 0.4,
      responseMode: 'structured_json',
    });

    return this.parseJsonResponse(result.content, { suggestions: [], bestWindow: '' });
  }

  async suggestPreviewText(businessId: string, input: SuggestPreviewTextInput) {

    const prompt = `Generate email preview text (preheader) options for an email.
Subject line: ${sanitize(input.subject, 200)}
${input.objective ? `Objective: ${sanitize(input.objective, 100)}` : ''}

Rules:
- Preview text appears after the subject line in the inbox
- Keep each option 40-90 characters
- Should complement the subject, not repeat it
- Create curiosity or urgency to drive opens
- Generate 5 variations with different approaches

Respond in valid JSON:
{
  "previews": [
    { "text": "Preview text here", "approach": "curiosity|urgency|benefit|social-proof|question", "charCount": 45 }
  ]
}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'content_preview_text',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Generate preview text for email body: ${sanitize(input.body, 500)}` },
      ],
      maxTokens: 600,
      temperature: 0.7,
      responseMode: 'structured_json',
    });

    return this.parseJsonResponse(result.content, { previews: [] });
  }

  async suggestAudienceSegments(businessId: string, input: SuggestAudienceSegmentsInput) {

    const biz = await this.getBusinessContext(businessId);

    const prompt = `Recommend audience segments for distributing this content.
Business: ${biz?.name || 'Business'} (${biz?.industry || 'Service'})
${input.contentType ? `Content Type: ${sanitize(input.contentType, 50)}` : ''}
${input.objective ? `Objective: ${sanitize(input.objective, 100)}` : ''}
${input.existingSegments?.length ? `Existing segments: ${input.existingSegments.map(s => sanitize(s, 50)).join(', ')}` : ''}

Recommend 3-5 audience segments that would benefit most from this content.
Consider demographics, behavior, purchase history, and engagement level.

Respond in valid JSON:
{
  "segments": [
    { "name": "Segment Name", "description": "Who this is", "reason": "Why target them", "expectedImpact": "high|medium|low", "estimatedReach": "broad|moderate|narrow" }
  ],
  "primarySegment": "Name of the single best segment"
}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'content_audience_segments',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Recommend segments for: ${sanitize(input.body, 500)}` },
      ],
      maxTokens: 800,
      temperature: 0.5,
      responseMode: 'structured_json',
    });

    return this.parseJsonResponse(result.content, { segments: [], primarySegment: '' });
  }

  private async getCrossModuleSignals(businessId: string) {
    const [contactStats, recentInvoices, upcomingBookings, recentContent] = await Promise.all([
      this.prisma.client.contact.groupBy({
        by: ['status'],
        where: { businessId, deletedAt: null },
        _count: true,
      }).catch(() => []),
      this.prisma.client.invoice.findMany({
        where: { businessId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { status: true, total: true, createdAt: true },
      }).catch(() => []),
      this.prisma.client.booking.findMany({
        where: {
          businessId,
          deletedAt: null,
          startTime: { gte: new Date() },
        },
        orderBy: { startTime: 'asc' },
        take: 5,
        select: { id: true, startTime: true, status: true },
      }).catch(() => []),
      this.prisma.client.outboundContent.findMany({
        where: { businessId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { subject: true, contentType: true, status: true, createdAt: true },
      }).catch(() => []),
    ]);

    const statusCounts = (contactStats as Array<{ status: string; _count: number }>)
      .map(s => `${s.status}: ${s._count}`).join(', ');
    const invoiceSummary = (recentInvoices as Array<{ status: string; total: number }>)
      .map(i => `${i.status} ($${i.total})`).join(', ');
    const bookingSummary = (upcomingBookings as Array<{ serviceName: string | null; startTime: Date }>)
      .map(b => b.serviceName || 'Booking').join(', ');
    const recentTopics = (recentContent as Array<{ subject: string | null; contentType: string }>)
      .map(c => c.subject || c.contentType).join('; ');

    return {
      clientPipeline: statusCounts || 'No contacts yet',
      recentRevenue: invoiceSummary || 'No invoices yet',
      upcomingServices: bookingSummary || 'No bookings scheduled',
      recentContent: recentTopics || 'No recent content',
    };
  }

  async suggestContentIdeas(businessId: string, input: SuggestContentIdeasInput) {

    const [biz, signals] = await Promise.all([
      this.getBusinessContext(businessId),
      this.getCrossModuleSignals(businessId),
    ]);

    const prompt = `Generate content ideas for a Caribbean service business using real business intelligence signals.
Business: ${biz?.name || 'Business'} (${biz?.industry || 'Service'})
${biz?.tagline ? `Tagline: ${biz.tagline}` : ''}
Currency: ${biz?.currency || 'TTD'}
${input.objective ? `Objective: ${sanitize(input.objective, 100)}` : ''}
${input.audience ? `Target Audience: ${sanitize(input.audience, 100)}` : ''}
${input.contentType ? `Content Type: ${sanitize(input.contentType, 50)}` : ''}

CROSS-MODULE BUSINESS INTELLIGENCE:
- Client Pipeline: ${signals.clientPipeline}
- Recent Revenue Activity: ${signals.recentRevenue}
- Upcoming Services/Bookings: ${signals.upcomingServices}
- Recent Content Published: ${signals.recentContent}
${input.recentTopics?.length ? `Topics to avoid repeating: ${input.recentTopics.map(t => sanitize(t, 80)).join('; ')}` : ''}

Generate 5 content ideas that leverage these real business signals. Ideas should:
- Reference actual pipeline stages to re-engage leads or nurture prospects
- Create urgency around upcoming bookings or services
- Capitalize on revenue patterns for upsell/cross-sell content
- Avoid repeating recent content topics
- Be relevant to Caribbean business context and culture

Respond in valid JSON:
{
  "ideas": [
    { "title": "Idea title", "brief": "2-3 sentence description referencing specific business signals", "contentType": "social_post|campaign_email|whatsapp_message", "category": "engagement|promotion|education|social-proof|seasonal", "effort": "low|medium|high", "dataSource": "crm|revenue|calendar|content" }
  ]
}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'content_idea_suggestions',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Suggest content ideas based on my business intelligence` },
      ],
      maxTokens: 1000,
      temperature: 0.8,
      responseMode: 'structured_json',
    });

    return this.parseJsonResponse(result.content, { ideas: [] });
  }

  private getChannelContext(contentType: string) {
    const map: Record<string, { label: string; guidelines: string }> = {
      campaign_email: {
        label: 'Email Campaign',
        guidelines: 'Write professional email body content. Include a clear subject line and preview text suggestion. Use paragraphs with a compelling opening, value proposition, and clear CTA. Personalize the greeting. Keep subject under 60 characters. Preview text should complement subject (40-90 chars).',
      },
      email: {
        label: 'Email Campaign',
        guidelines: 'Write professional email body content. Include a clear subject line and preview text suggestion. Use paragraphs with a compelling opening, value proposition, and clear CTA. Personalize the greeting. Keep subject under 60 characters. Preview text should complement subject (40-90 chars).',
      },
      instagram: {
        label: 'Instagram Post',
        guidelines: 'Keep caption under 2200 characters. Start with a strong visual hook in the first line (crucial for feed). Use line breaks for readability. Include 5-15 relevant hashtags at the end. Use emojis strategically. End with a question or CTA to drive engagement. Consider carousel format tips if explaining a process.',
      },
      facebook: {
        label: 'Facebook Post',
        guidelines: 'Optimal length is 40-80 characters for highest engagement, but can go up to 500. Start with a question or bold statement. Use line breaks. Include a CTA. Hashtags optional (1-2 max). Encourage shares and comments. Consider linking to a landing page.',
      },
      social_post: {
        label: 'Social Media Post',
        guidelines: 'Keep under 2200 characters. Start with a hook. Use line breaks for readability. End with a CTA. Include suggested hashtags.',
      },
      social: {
        label: 'Social Media Post',
        guidelines: 'Keep under 2200 characters. Start with a hook. Use line breaks for readability. End with a CTA. Include suggested hashtags.',
      },
      whatsapp: {
        label: 'WhatsApp Message',
        guidelines: 'Keep under 1000 characters for best readability. Be conversational, warm, and direct — like texting a client. Use emojis sparingly (1-3 max). No hashtags. Include a clear CTA. Use bold (*text*) for emphasis. Short paragraphs, one idea per message. Consider template message format for first contact.',
      },
      whatsapp_message: {
        label: 'WhatsApp Message',
        guidelines: 'Keep under 1000 characters for best readability. Be conversational, warm, and direct — like texting a client. Use emojis sparingly (1-3 max). No hashtags. Include a clear CTA. Use bold (*text*) for emphasis. Short paragraphs, one idea per message.',
      },
      messaging: {
        label: 'WhatsApp Message',
        guidelines: 'Keep under 1000 characters for best readability. Be conversational, warm, and direct — like texting a client. Use emojis sparingly (1-3 max). No hashtags. Include a clear CTA. Short paragraphs, one idea per message.',
      },
      multi_channel_broadcast: {
        label: 'Multi-Channel Broadcast',
        guidelines: 'Write versatile content that works across email, social media, and messaging. Keep the core message adaptable. Provide a subject line for email, hashtags for social, and a shorter conversational version for WhatsApp.',
      },
      multi: {
        label: 'Multi-Channel Broadcast',
        guidelines: 'Write versatile content that works across email, social media, and messaging. Keep the core message adaptable. Provide a subject line for email, hashtags for social, and a shorter conversational version for WhatsApp.',
      },
    };
    return map[contentType.toLowerCase()] || map.social_post;
  }

  private parseJsonResponse<T>(content: string, fallback: T): T {
    try {
      const cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
      return fallback;
    } catch {
      this.logger.warn('Failed to parse AI JSON response');
      return fallback;
    }
  }
}
