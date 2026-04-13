import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
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
    @Optional() @Inject(AiUsageService) private readonly aiUsage: AiUsageService | null,
  ) {}

  private async getBusinessContext(businessId: string) {
    const biz = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { name: true, industry: true, tagline: true, description: true, currency: true },
    });
    return biz;
  }

  async generateDraft(businessId: string, input: GenerateDraftInput) {
    if (!this.aiUsage) throw new Error('AI service unavailable');

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
    if (!this.aiUsage) throw new Error('AI service unavailable');

    const channelContext = this.getChannelContext(input.targetChannel);

    const prompt = `Rewrite the following content optimized for ${channelContext.label}.
${input.tone ? `Maintain a ${sanitize(input.tone, 50)} tone.` : ''}
${input.objective ? `Objective: ${sanitize(input.objective, 100)}` : ''}

${channelContext.guidelines}

Respond in valid JSON:
{
  "body": "The rewritten content",
  "subject": "Subject line (for email only, null otherwise)",
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

    return this.parseJsonResponse(result.content, { body: '', subject: null, hashtags: [] });
  }

  async suggestSubjects(businessId: string, input: SuggestSubjectsInput) {
    if (!this.aiUsage) throw new Error('AI service unavailable');

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
    if (!this.aiUsage) throw new Error('AI service unavailable');

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
    if (!this.aiUsage) throw new Error('AI service unavailable');

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
    if (!this.aiUsage) throw new Error('AI service unavailable');

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
    if (!this.aiUsage) throw new Error('AI service unavailable');

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
    if (!this.aiUsage) throw new Error('AI service unavailable');

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
    if (!this.aiUsage) throw new Error('AI service unavailable');

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
    if (!this.aiUsage) throw new Error('AI service unavailable');

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

  async suggestContentIdeas(businessId: string, input: SuggestContentIdeasInput) {
    if (!this.aiUsage) throw new Error('AI service unavailable');

    const biz = await this.getBusinessContext(businessId);

    const prompt = `Generate content ideas for a Caribbean service business.
Business: ${biz?.name || 'Business'} (${biz?.industry || 'Service'})
${biz?.tagline ? `Tagline: ${biz.tagline}` : ''}
Currency: ${biz?.currency || 'TTD'}
${input.objective ? `Objective: ${sanitize(input.objective, 100)}` : ''}
${input.audience ? `Target Audience: ${sanitize(input.audience, 100)}` : ''}
${input.contentType ? `Content Type: ${sanitize(input.contentType, 50)}` : ''}
${input.recentTopics?.length ? `Recent topics (avoid repeating): ${input.recentTopics.map(t => sanitize(t, 80)).join('; ')}` : ''}

Generate 5 fresh content ideas drawing from:
- Client engagement patterns and retention
- Revenue opportunities and promotions
- Seasonal/calendar events relevant to Caribbean businesses
- Industry trends
- Customer success stories / social proof angles

Respond in valid JSON:
{
  "ideas": [
    { "title": "Idea title", "brief": "2-3 sentence description", "contentType": "social_post|campaign_email|whatsapp_message", "category": "engagement|promotion|education|social-proof|seasonal", "effort": "low|medium|high" }
  ]
}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'content_idea_suggestions',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Suggest content ideas for my ${biz?.industry || 'service'} business` },
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
        guidelines: 'Write professional email body content. Include a clear subject line suggestion. Use paragraphs, not just bullet points. Include a compelling opening, value proposition, and clear CTA.',
      },
      email: {
        label: 'Email Campaign',
        guidelines: 'Write professional email body content. Include a clear subject line suggestion. Use paragraphs, not just bullet points. Include a compelling opening, value proposition, and clear CTA.',
      },
      social_post: {
        label: 'Social Media Post',
        guidelines: 'Keep under 2200 characters. Start with a hook. Use line breaks for readability. End with a CTA. Include suggested hashtags.',
      },
      social: {
        label: 'Social Media Post',
        guidelines: 'Keep under 2200 characters. Start with a hook. Use line breaks for readability. End with a CTA. Include suggested hashtags.',
      },
      whatsapp_message: {
        label: 'WhatsApp Message',
        guidelines: 'Keep under 4096 characters. Be conversational and direct. Use emojis sparingly. Include a clear CTA. No hashtags needed.',
      },
      messaging: {
        label: 'WhatsApp Message',
        guidelines: 'Keep under 4096 characters. Be conversational and direct. Use emojis sparingly. Include a clear CTA. No hashtags needed.',
      },
      multi_channel_broadcast: {
        label: 'Multi-Channel Broadcast',
        guidelines: 'Write versatile content that works across email, social media, and messaging. Keep the core message adaptable.',
      },
      multi: {
        label: 'Multi-Channel Broadcast',
        guidelines: 'Write versatile content that works across email, social media, and messaging. Keep the core message adaptable.',
      },
    };
    return map[contentType] || map.social_post;
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
