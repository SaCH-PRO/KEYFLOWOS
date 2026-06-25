import { Injectable, Logger } from '@nestjs/common';
import {
  KeyConnectorProviderDef,
  ProviderCategory,
  ProviderConfigField,
} from '../key-connector.types';

/**
 * ── Provider Registry Service ──────────────────────────────────────────
 * Maintains the unified registry of ALL providers — both external
 * (OAuth/API-based integrations) and internal (KeyFlowOS business modules).
 *
 * External providers (16) mirror IntegrationHub:
 *   Google, Microsoft, Payment, Communication, Marketing, Form, Automation
 *
 * Internal providers (19) mirror KeyCortex routing targets:
 *   CRM, Commerce, Bookings, Content, Communications, Flow, Autopilot,
 *   Temporal, Inbox, Genome, Intelligence, Notifications, Projects,
 *   Social, Analytics, Finance, Settings, Activity, KeyStore
 * ───────────────────────────────────────────────────────────────────────
 */

@Injectable()
export class ProviderRegistryService {
  private readonly logger = new Logger(ProviderRegistryService.name);

  /** In-memory registry of all provider definitions. */
  private readonly providers: Map<string, KeyConnectorProviderDef> = new Map();

  constructor() {
    this.registerExternalProviders();
    this.registerInternalProviders();
    this.logger.log(
      `ProviderRegistry initialised with ${this.providers.size} providers`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════════════

  /** Return every registered provider definition. */
  getAllProviders(): KeyConnectorProviderDef[] {
    return Array.from(this.providers.values());
  }

  /** Return a single provider by its unique key. */
  getProvider(key: string): KeyConnectorProviderDef | undefined {
    return this.providers.get(key);
  }

  /** Filter providers by category. */
  getProvidersByCategory(
    category: ProviderCategory,
  ): KeyConnectorProviderDef[] {
    return this.getAllProviders().filter((p) => p.category === category);
  }

  /** Return only external providers (authType !== 'internal'). */
  getExternalProviders(): KeyConnectorProviderDef[] {
    return this.getAllProviders().filter((p) => !p.isInternal);
  }

  /** Return only internal providers (authType === 'internal'). */
  getInternalProviders(): KeyConnectorProviderDef[] {
    return this.getAllProviders().filter((p) => p.isInternal);
  }

  /** Return metadata for every category that has at least one provider. */
  getProviderCategories(): Array<{
    key: ProviderCategory;
    label: string;
    count: number;
  }> {
    const all = this.getAllProviders();
    const categoryMap = new Map<ProviderCategory, number>();

    for (const p of all) {
      categoryMap.set(p.category, (categoryMap.get(p.category) ?? 0) + 1);
    }

    return Array.from(categoryMap.entries()).map(([key, count]) => ({
      key,
      label: this.categoryLabel(key),
      count,
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // External Providers — 16 providers mirroring IntegrationHub
  // ═══════════════════════════════════════════════════════════════════════

  private registerExternalProviders(): void {
    // ── Google ecosystem ──
    this.register({
      key: 'google_forms',
      name: 'Google Forms',
      category: 'google',
      description:
        'Create, manage, and collect responses from Google Forms. Sync form submissions into KeyFlowOS.',
      authType: 'oauth2',
      icon: 'google-forms',
      scopes: [
        'https://www.googleapis.com/auth/forms',
        'https://www.googleapis.com/auth/forms.responses.readonly',
        'https://www.googleapis.com/auth/drive.readonly',
      ],
      capabilities: [
        { type: 'read', resource: 'form', description: 'Read form metadata' },
        {
          type: 'read',
          resource: 'response',
          description: 'Read form responses',
        },
        {
          type: 'sync',
          resource: 'response',
          description: 'Sync form responses into KeyFlowOS',
        },
        {
          type: 'webhook',
          resource: 'response',
          description: 'Receive real-time form submission events',
        },
      ],
      configSchema: [
        {
          key: 'formId',
          label: 'Form ID',
          type: 'string',
          required: false,
          placeholder: 'Optional: limit to a specific form',
        },
        {
          key: 'syncMode',
          label: 'Sync Mode',
          type: 'select',
          required: true,
          options: ['incremental', 'full'],
        },
      ],
    });

    this.register({
      key: 'google_contacts',
      name: 'Google Contacts',
      category: 'google',
      description:
        'Two-way sync with Google Contacts. Import, update, and manage contacts.',
      authType: 'oauth2',
      icon: 'google-contacts',
      scopes: [
        'https://www.googleapis.com/auth/contacts',
        'https://www.googleapis.com/auth/contacts.readonly',
      ],
      capabilities: [
        {
          type: 'read',
          resource: 'contact',
          description: 'Read contact records',
        },
        {
          type: 'write',
          resource: 'contact',
          description: 'Create and update contacts',
        },
        {
          type: 'sync',
          resource: 'contact',
          description: 'Two-way contact sync',
        },
        {
          type: 'ai_query',
          resource: 'contact',
          description: 'Query contacts via AI',
        },
      ],
      configSchema: [
        {
          key: 'syncDirection',
          label: 'Sync Direction',
          type: 'select',
          required: true,
          options: ['inbound', 'outbound', 'bidirectional'],
        },
        {
          key: 'groupFilter',
          label: 'Contact Group Filter',
          type: 'string',
          required: false,
          placeholder: 'Optional: sync only a specific group',
        },
      ],
    });

    this.register({
      key: 'google_business',
      name: 'Google Business Profile',
      category: 'google',
      description:
        'Manage your Google Business Profile: reviews, posts, insights, and location data.',
      authType: 'oauth2',
      icon: 'google-business',
      scopes: [
        'https://www.googleapis.com/auth/business.manage',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      capabilities: [
        {
          type: 'read',
          resource: 'review',
          description: 'Read customer reviews',
        },
        {
          type: 'write',
          resource: 'review_reply',
          description: 'Reply to reviews',
        },
        {
          type: 'read',
          resource: 'insight',
          description: 'Read business insights',
        },
        {
          type: 'sync',
          resource: 'review',
          description: 'Sync reviews into KeyFlowOS',
        },
        {
          type: 'ai_action',
          resource: 'review_reply',
          description: 'AI-generated review replies',
        },
      ],
      configSchema: [
        {
          key: 'locationId',
          label: 'Location ID',
          type: 'string',
          required: false,
          placeholder: 'Optional: specific location',
        },
        {
          key: 'autoReply',
          label: 'Enable Auto-Reply',
          type: 'boolean',
          required: true,
        },
      ],
    });

    this.register({
      key: 'google_calendar',
      name: 'Google Calendar',
      category: 'google',
      description:
        'Sync events, create bookings, and manage calendar availability.',
      authType: 'oauth2',
      icon: 'google-calendar',
      scopes: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
      ],
      capabilities: [
        {
          type: 'read',
          resource: 'event',
          description: 'Read calendar events',
        },
        {
          type: 'write',
          resource: 'event',
          description: 'Create and update events',
        },
        {
          type: 'sync',
          resource: 'event',
          description: 'Sync calendar events',
        },
        {
          type: 'ai_action',
          resource: 'event',
          description: 'AI scheduling assistant',
        },
      ],
      configSchema: [
        {
          key: 'calendarId',
          label: 'Calendar ID',
          type: 'string',
          required: false,
          placeholder: 'primary',
        },
        {
          key: 'syncDirection',
          label: 'Sync Direction',
          type: 'select',
          required: true,
          options: ['inbound', 'outbound', 'bidirectional'],
        },
      ],
    });

    this.register({
      key: 'google_drive',
      name: 'Google Drive',
      category: 'google',
      description:
        'Access, store, and manage files in Google Drive. Upload attachments and backups.',
      authType: 'oauth2',
      icon: 'google-drive',
      scopes: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/drive.file',
      ],
      capabilities: [
        {
          type: 'read',
          resource: 'file',
          description: 'Read file metadata and content',
        },
        {
          type: 'write',
          resource: 'file',
          description: 'Upload and update files',
        },
        {
          type: 'sync',
          resource: 'file',
          description: 'Sync file references',
        },
      ],
      configSchema: [
        {
          key: 'folderId',
          label: 'Root Folder ID',
          type: 'string',
          required: false,
          placeholder: 'Optional: limit to a folder',
        },
      ],
    });

    // ── Microsoft / Outlook ──
    this.register({
      key: 'outlook_contacts',
      name: 'Outlook Contacts',
      category: 'microsoft',
      description: 'Two-way sync with Microsoft Outlook Contacts.',
      authType: 'oauth2',
      icon: 'outlook-contacts',
      scopes: ['Contacts.Read', 'Contacts.ReadWrite', 'User.Read'],
      capabilities: [
        {
          type: 'read',
          resource: 'contact',
          description: 'Read Outlook contacts',
        },
        {
          type: 'write',
          resource: 'contact',
          description: 'Create and update contacts',
        },
        {
          type: 'sync',
          resource: 'contact',
          description: 'Two-way contact sync',
        },
        {
          type: 'ai_query',
          resource: 'contact',
          description: 'Query contacts via AI',
        },
      ],
      configSchema: [
        {
          key: 'syncDirection',
          label: 'Sync Direction',
          type: 'select',
          required: true,
          options: ['inbound', 'outbound', 'bidirectional'],
        },
        {
          key: 'folderId',
          label: 'Contact Folder ID',
          type: 'string',
          required: false,
          placeholder: 'Optional: specific contact folder',
        },
      ],
    });

    this.register({
      key: 'outlook_calendar',
      name: 'Outlook Calendar',
      category: 'microsoft',
      description:
        'Sync events, create bookings, and manage calendar availability via Outlook.',
      authType: 'oauth2',
      icon: 'outlook-calendar',
      scopes: ['Calendars.Read', 'Calendars.ReadWrite', 'User.Read'],
      capabilities: [
        {
          type: 'read',
          resource: 'event',
          description: 'Read calendar events',
        },
        {
          type: 'write',
          resource: 'event',
          description: 'Create and update events',
        },
        {
          type: 'sync',
          resource: 'event',
          description: 'Sync calendar events',
        },
        {
          type: 'ai_action',
          resource: 'event',
          description: 'AI scheduling assistant',
        },
      ],
      configSchema: [
        {
          key: 'calendarId',
          label: 'Calendar ID',
          type: 'string',
          required: false,
          placeholder: 'default',
        },
        {
          key: 'syncDirection',
          label: 'Sync Direction',
          type: 'select',
          required: true,
          options: ['inbound', 'outbound', 'bidirectional'],
        },
      ],
    });

    // ── Communication ──
    this.register({
      key: 'whatsapp_business',
      name: 'WhatsApp Business',
      category: 'communication',
      description:
        'Send and receive WhatsApp messages, manage templates, and automate conversations.',
      authType: 'api_key',
      icon: 'whatsapp',
      capabilities: [
        {
          type: 'write',
          resource: 'message',
          description: 'Send WhatsApp messages',
        },
        {
          type: 'read',
          resource: 'message',
          description: 'Read message history',
        },
        {
          type: 'webhook',
          resource: 'message',
          description: 'Receive incoming messages',
        },
        {
          type: 'ai_action',
          resource: 'message',
          description: 'AI-powered message responses',
        },
        {
          type: 'sync',
          resource: 'template',
          description: 'Sync message templates',
        },
      ],
      configSchema: [
        {
          key: 'phoneNumberId',
          label: 'Phone Number ID',
          type: 'string',
          required: true,
        },
        {
          key: 'businessAccountId',
          label: 'Business Account ID',
          type: 'string',
          required: true,
        },
        {
          key: 'apiToken',
          label: 'API Token',
          type: 'secret',
          required: true,
        },
        {
          key: 'webhookVerifyToken',
          label: 'Webhook Verify Token',
          type: 'secret',
          required: true,
        },
      ],
    });

    // ── Payment ──
    this.register({
      key: 'stripe',
      name: 'Stripe',
      category: 'payment',
      description:
        'Process payments, manage subscriptions, handle refunds, and sync transaction data.',
      authType: 'api_key',
      icon: 'stripe',
      capabilities: [
        {
          type: 'read',
          resource: 'payment',
          description: 'Read payment records',
        },
        {
          type: 'read',
          resource: 'subscription',
          description: 'Read subscription data',
        },
        {
          type: 'write',
          resource: 'refund',
          description: 'Process refunds',
        },
        {
          type: 'sync',
          resource: 'transaction',
          description: 'Sync transaction history',
        },
        {
          type: 'webhook',
          resource: 'payment_intent',
          description: 'Receive payment webhooks',
        },
        {
          type: 'ai_query',
          resource: 'transaction',
          description: 'Query transactions via AI',
        },
      ],
      configSchema: [
        {
          key: 'secretKey',
          label: 'Secret Key',
          type: 'secret',
          required: true,
        },
        {
          key: 'webhookSecret',
          label: 'Webhook Secret',
          type: 'secret',
          required: true,
        },
        {
          key: 'publishableKey',
          label: 'Publishable Key',
          type: 'string',
          required: false,
        },
      ],
    });

    this.register({
      key: 'wipay',
      name: 'WiPay',
      category: 'payment',
      description:
        ' Caribbean payment gateway integration for local and regional transactions.',
      authType: 'api_key',
      icon: 'wipay',
      capabilities: [
        {
          type: 'write',
          resource: 'payment',
          description: 'Process payments via WiPay',
        },
        {
          type: 'read',
          resource: 'transaction',
          description: 'Read transaction records',
        },
        {
          type: 'sync',
          resource: 'transaction',
          description: 'Sync WiPay transactions',
        },
        {
          type: 'webhook',
          resource: 'payment',
          description: 'Receive payment notifications',
        },
      ],
      configSchema: [
        {
          key: 'apiKey',
          label: 'API Key',
          type: 'secret',
          required: true,
        },
        {
          key: 'accountId',
          label: 'Account ID',
          type: 'string',
          required: true,
        },
        {
          key: 'environment',
          label: 'Environment',
          type: 'select',
          required: true,
          options: ['sandbox', 'production'],
        },
      ],
    });

    // ── Form builders ──
    this.register({
      key: 'typeform',
      name: 'Typeform',
      category: 'form',
      description:
        'Collect and sync Typeform responses. Map form answers to KeyFlowOS records.',
      authType: 'api_key',
      icon: 'typeform',
      capabilities: [
        {
          type: 'read',
          resource: 'form',
          description: 'Read form definitions',
        },
        {
          type: 'read',
          resource: 'response',
          description: 'Read form responses',
        },
        {
          type: 'sync',
          resource: 'response',
          description: 'Sync responses into KeyFlowOS',
        },
        {
          type: 'webhook',
          resource: 'response',
          description: 'Real-time response webhooks',
        },
      ],
      configSchema: [
        {
          key: 'apiToken',
          label: 'API Token',
          type: 'secret',
          required: true,
        },
        {
          key: 'formId',
          label: 'Form ID',
          type: 'string',
          required: false,
          placeholder: 'Optional: limit to a specific form',
        },
        {
          key: 'workspaceId',
          label: 'Workspace ID',
          type: 'string',
          required: false,
        },
      ],
    });

    this.register({
      key: 'jotform',
      name: 'Jotform',
      category: 'form',
      description:
        'Collect and sync Jotform submissions. Map form data to CRM contacts and leads.',
      authType: 'api_key',
      icon: 'jotform',
      capabilities: [
        {
          type: 'read',
          resource: 'form',
          description: 'Read form definitions',
        },
        {
          type: 'read',
          resource: 'submission',
          description: 'Read form submissions',
        },
        {
          type: 'sync',
          resource: 'submission',
          description: 'Sync submissions into KeyFlowOS',
        },
        {
          type: 'webhook',
          resource: 'submission',
          description: 'Real-time submission webhooks',
        },
      ],
      configSchema: [
        {
          key: 'apiKey',
          label: 'API Key',
          type: 'secret',
          required: true,
        },
        {
          key: 'formId',
          label: 'Form ID',
          type: 'string',
          required: false,
          placeholder: 'Optional: limit to a specific form',
        },
      ],
    });

    // ── Marketing ──
    this.register({
      key: 'mailchimp',
      name: 'Mailchimp',
      category: 'marketing',
      description:
        'Sync audiences, manage campaigns, and track email marketing performance.',
      authType: 'api_key',
      icon: 'mailchimp',
      capabilities: [
        {
          type: 'read',
          resource: 'audience',
          description: 'Read audience lists',
        },
        {
          type: 'write',
          resource: 'audience',
          description: 'Manage audience members',
        },
        {
          type: 'read',
          resource: 'campaign',
          description: 'Read campaign data',
        },
        {
          type: 'sync',
          resource: 'audience',
          description: 'Sync audiences with KeyFlowOS contacts',
        },
        {
          type: 'ai_action',
          resource: 'campaign',
          description: 'AI-powered campaign recommendations',
        },
      ],
      configSchema: [
        {
          key: 'apiKey',
          label: 'API Key',
          type: 'secret',
          required: true,
        },
        {
          key: 'serverPrefix',
          label: 'Server Prefix',
          type: 'string',
          required: true,
          placeholder: 'e.g. us1',
        },
        {
          key: 'audienceId',
          label: 'Default Audience ID',
          type: 'string',
          required: false,
        },
      ],
    });

    this.register({
      key: 'sendgrid',
      name: 'SendGrid',
      category: 'marketing',
      description:
        'Send transactional and marketing emails with delivery tracking.',
      authType: 'api_key',
      icon: 'sendgrid',
      capabilities: [
        {
          type: 'write',
          resource: 'email',
          description: 'Send transactional emails',
        },
        {
          type: 'read',
          resource: 'email',
          description: 'Read email delivery status',
        },
        {
          type: 'sync',
          resource: 'template',
          description: 'Sync email templates',
        },
        {
          type: 'webhook',
          resource: 'event',
          description: 'Receive delivery event webhooks',
        },
        {
          type: 'ai_action',
          resource: 'email',
          description: 'AI-generated email content',
        },
      ],
      configSchema: [
        {
          key: 'apiKey',
          label: 'API Key',
          type: 'secret',
          required: true,
        },
        {
          key: 'fromEmail',
          label: 'From Email',
          type: 'string',
          required: false,
          placeholder: 'noreply@yourdomain.com',
        },
        {
          key: 'fromName',
          label: 'From Name',
          type: 'string',
          required: false,
          placeholder: 'Your Business Name',
        },
      ],
    });

    // ── Social / Collaboration ──
    this.register({
      key: 'slack',
      name: 'Slack',
      category: 'communication',
      description:
        'Send notifications, receive commands, and sync channel activity with KeyFlowOS.',
      authType: 'oauth2',
      icon: 'slack',
      scopes: [
        'chat:write',
        'channels:read',
        'users:read',
        'incoming-webhook',
      ],
      capabilities: [
        {
          type: 'write',
          resource: 'message',
          description: 'Send messages to channels',
        },
        {
          type: 'read',
          resource: 'channel',
          description: 'Read channel information',
        },
        {
          type: 'webhook',
          resource: 'event',
          description: 'Receive Slack events and commands',
        },
        {
          type: 'ai_action',
          resource: 'message',
          description: 'AI-generated Slack notifications',
        },
      ],
      configSchema: [
        {
          key: 'defaultChannel',
          label: 'Default Channel',
          type: 'string',
          required: false,
          placeholder: '#general',
        },
        {
          key: 'botName',
          label: 'Bot Name',
          type: 'string',
          required: false,
          placeholder: 'KeyFlowOS Bot',
        },
      ],
    });

    // ── Automation ──
    this.register({
      key: 'zapier',
      name: 'Zapier',
      category: 'automation',
      description:
        'Trigger and receive Zapier zaps. Connect KeyFlowOS to 5000+ apps.',
      authType: 'webhook',
      icon: 'zapier',
      capabilities: [
        {
          type: 'webhook',
          resource: 'trigger',
          description: 'Receive Zapier trigger webhooks',
        },
        {
          type: 'write',
          resource: 'action',
          description: 'Send data to Zapier actions',
        },
        {
          type: 'sync',
          resource: 'zap',
          description: 'Sync zap configurations',
        },
        {
          type: 'ai_action',
          resource: 'trigger',
          description: 'AI-powered zap recommendations',
        },
      ],
      configSchema: [
        {
          key: 'webhookUrl',
          label: 'Webhook URL',
          type: 'string',
          required: true,
          placeholder: 'https://hooks.zapier.com/hooks/catch/...',
        },
        {
          key: 'zapId',
          label: 'Zap ID',
          type: 'string',
          required: false,
        },
      ],
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Internal Providers — 19 KeyFlowOS modules mirroring KeyCortex
  // ═══════════════════════════════════════════════════════════════════════

  private registerInternalProviders(): void {
    const internalProviders: Array<{
      key: string;
      name: string;
      category: ProviderCategory;
      description: string;
      actions: string[];
      queries: string[];
    }> = [
      {
        key: 'crm',
        name: 'CRM',
        category: 'internal',
        description:
          'Customer Relationship Management — contacts, leads, opportunities, pipelines.',
        actions: [
          'create_contact',
          'update_contact',
          'delete_contact',
          'create_lead',
          'update_lead',
          'convert_lead',
          'create_opportunity',
          'update_pipeline_stage',
          'add_note',
          'create_task',
        ],
        queries: [
          'get_contact',
          'list_contacts',
          'search_contacts',
          'get_lead',
          'list_leads',
          'get_opportunity',
          'list_opportunities',
          'get_pipeline',
          'get_activity_feed',
        ],
      },
      {
        key: 'commerce',
        name: 'Commerce',
        category: 'internal',
        description:
          'E-commerce engine — products, orders, inventory, carts, checkout.',
        actions: [
          'create_product',
          'update_product',
          'delete_product',
          'create_order',
          'update_order_status',
          'process_checkout',
          'update_inventory',
          'create_discount',
          'apply_coupon',
          'create_collection',
        ],
        queries: [
          'get_product',
          'list_products',
          'get_order',
          'list_orders',
          'get_inventory',
          'get_cart',
          'get_collection',
          'search_products',
        ],
      },
      {
        key: 'bookings',
        name: 'Bookings',
        category: 'internal',
        description:
          'Appointment and reservation system — services, availability, schedules.',
        actions: [
          'create_booking',
          'update_booking',
          'cancel_booking',
          'confirm_booking',
          'reschedule_booking',
          'create_service',
          'update_availability',
          'block_time_slot',
          'send_reminder',
        ],
        queries: [
          'get_booking',
          'list_bookings',
          'get_availability',
          'get_service',
          'list_services',
          'get_schedule',
          'search_availability',
        ],
      },
      {
        key: 'content',
        name: 'Content',
        category: 'internal',
        description:
          'Content Management System — pages, posts, media, navigation, themes.',
        actions: [
          'create_page',
          'update_page',
          'publish_page',
          'unpublish_page',
          'create_post',
          'update_post',
          'delete_post',
          'upload_media',
          'update_navigation',
          'apply_theme',
        ],
        queries: [
          'get_page',
          'list_pages',
          'get_post',
          'list_posts',
          'get_media',
          'list_media',
          'get_navigation',
          'search_content',
        ],
      },
      {
        key: 'communications',
        name: 'Communications',
        category: 'internal',
        description:
          'Unified communications — SMS, email, voice, chat channels.',
        actions: [
          'send_sms',
          'send_email',
          'send_voice',
          'start_chat',
          'create_template',
          'update_template',
          'schedule_message',
          'create_campaign',
          'send_broadcast',
        ],
        queries: [
          'get_message',
          'list_messages',
          'get_conversation',
          'list_conversations',
          'get_template',
          'list_templates',
          'get_campaign',
          'search_messages',
        ],
      },
      {
        key: 'flow',
        name: 'Flow',
        category: 'internal',
        description:
          'Workflow automation engine — visual flows, triggers, actions, conditions.',
        actions: [
          'create_flow',
          'update_flow',
          'publish_flow',
          'trigger_flow',
          'pause_flow',
          'resume_flow',
          'create_trigger',
          'update_trigger',
          'delete_trigger',
          'run_flow_step',
        ],
        queries: [
          'get_flow',
          'list_flows',
          'get_flow_execution',
          'list_flow_executions',
          'get_trigger',
          'list_triggers',
          'get_flow_analytics',
        ],
      },
      {
        key: 'autopilot',
        name: 'Autopilot',
        category: 'internal',
        description:
          'Autonomous business operations — rules, schedules, auto-responses, smart routing.',
        actions: [
          'create_rule',
          'update_rule',
          'enable_rule',
          'disable_rule',
          'create_schedule',
          'update_schedule',
          'trigger_autopilot',
          'create_auto_response',
          'update_routing',
          'run_report',
        ],
        queries: [
          'get_rule',
          'list_rules',
          'get_schedule',
          'list_schedules',
          'get_autopilot_log',
          'list_auto_responses',
          'get_routing_config',
          'get_autopilot_analytics',
        ],
      },
      {
        key: 'temporal',
        name: 'Temporal',
        category: 'internal',
        description:
          'Temporal workflow engine — durable executions, sagas, scheduled jobs.',
        actions: [
          'start_workflow',
          'cancel_workflow',
          'signal_workflow',
          'schedule_job',
          'cancel_job',
          'create_saga',
          'compensate_saga',
          'retry_workflow',
          'pause_workflow',
          'resume_workflow',
        ],
        queries: [
          'get_workflow',
          'list_workflows',
          'get_workflow_history',
          'get_schedule',
          'list_schedules',
          'get_saga',
          'list_sagas',
          'get_job_status',
        ],
      },
      {
        key: 'inbox',
        name: 'Inbox',
        category: 'internal',
        description:
          'Unified inbox — emails, messages, tickets, tasks in one place.',
        actions: [
          'create_ticket',
          'update_ticket',
          'assign_ticket',
          'resolve_ticket',
          'add_reply',
          'add_internal_note',
          'merge_ticket',
          'split_ticket',
          'escalate_ticket',
          'snooze_ticket',
        ],
        queries: [
          'get_ticket',
          'list_tickets',
          'get_conversation',
          'list_conversations',
          'get_unread_count',
          'search_tickets',
          'get_inbox_metrics',
        ],
      },
      {
        key: 'genome',
        name: 'Genome',
        category: 'internal',
        description:
          'Business DNA engine — entity relationships, business model, structure.',
        actions: [
          'create_entity',
          'update_entity',
          'delete_entity',
          'create_relationship',
          'update_relationship',
          'map_business_model',
          'update_dna_score',
          'create_lineage',
          'merge_entities',
          'split_entity',
        ],
        queries: [
          'get_entity',
          'list_entities',
          'get_relationship',
          'list_relationships',
          'get_business_model',
          'get_dna_score',
          'get_lineage',
          'search_entities',
          'get_entity_graph',
        ],
      },
      {
        key: 'intelligence',
        name: 'Intelligence',
        category: 'internal',
        description:
          'AI/ML intelligence layer — predictions, recommendations, sentiment, scoring.',
        actions: [
          'train_model',
          'run_prediction',
          'generate_recommendation',
          'score_lead',
          'analyze_sentiment',
          'extract_entities',
          'classify_document',
          'generate_summary',
          'detect_anomaly',
          'create_forecast',
        ],
        queries: [
          'get_model',
          'list_models',
          'get_prediction',
          'list_predictions',
          'get_recommendation',
          'get_sentiment_analysis',
          'get_forecast',
          'get_intelligence_dashboard',
        ],
      },
      {
        key: 'notifications',
        name: 'Notifications',
        category: 'internal',
        description:
          'Notification hub — push, in-app, email, SMS alerts and digests.',
        actions: [
          'send_notification',
          'create_digest',
          'update_preferences',
          'mark_read',
          'mark_all_read',
          'create_template',
          'update_template',
          'schedule_digest',
          'trigger_broadcast',
          'create_topic',
        ],
        queries: [
          'get_notification',
          'list_notifications',
          'get_unread_notifications',
          'get_preferences',
          'get_digest',
          'list_digests',
          'get_notification_metrics',
        ],
      },
      {
        key: 'projects',
        name: 'Projects',
        category: 'internal',
        description:
          'Project management — tasks, boards, milestones, timelines, sprints.',
        actions: [
          'create_project',
          'update_project',
          'archive_project',
          'create_task',
          'update_task',
          'move_task',
          'assign_task',
          'create_milestone',
          'update_milestone',
          'start_sprint',
          'end_sprint',
        ],
        queries: [
          'get_project',
          'list_projects',
          'get_task',
          'list_tasks',
          'get_board',
          'get_milestone',
          'list_milestones',
          'get_timeline',
          'get_sprint',
          'search_tasks',
        ],
      },
      {
        key: 'social',
        name: 'Social',
        category: 'internal',
        description:
          'Social media management — posts, scheduling, analytics, engagement.',
        actions: [
          'create_post',
          'schedule_post',
          'publish_post',
          'delete_post',
          'reply_to_comment',
          'boost_post',
          'create_campaign',
          'update_campaign',
          'connect_account',
          'disconnect_account',
        ],
        queries: [
          'get_post',
          'list_posts',
          'get_scheduled_posts',
          'get_analytics',
          'get_engagement',
          'get_campaign',
          'list_campaigns',
          'get_follower_metrics',
          'search_posts',
        ],
      },
      {
        key: 'analytics',
        name: 'Analytics',
        category: 'internal',
        description:
          'Business analytics — dashboards, reports, funnels, cohorts, KPIs.',
        actions: [
          'create_dashboard',
          'update_dashboard',
          'create_report',
          'schedule_report',
          'create_funnel',
          'update_funnel',
          'create_cohort',
          'set_kpi',
          'export_data',
          'create_alert',
        ],
        queries: [
          'get_dashboard',
          'list_dashboards',
          'get_report',
          'list_reports',
          'get_funnel',
          'get_cohort',
          'get_kpi',
          'list_kpis',
          'get_analytics_summary',
          'get_realtime_metrics',
        ],
      },
      {
        key: 'finance',
        name: 'Finance',
        category: 'internal',
        description:
          'Financial operations — invoices, expenses, accounts, budgets, reconciliation.',
        actions: [
          'create_invoice',
          'update_invoice',
          'send_invoice',
          'record_payment',
          'create_expense',
          'update_expense',
          'create_budget',
          'update_budget',
          'reconcile_account',
          'create_journal_entry',
          'generate_report',
        ],
        queries: [
          'get_invoice',
          'list_invoices',
          'get_expense',
          'list_expenses',
          'get_account',
          'list_accounts',
          'get_budget',
          'get_cashflow',
          'get_profit_loss',
          'get_balance_sheet',
          'get_financial_summary',
        ],
      },
      {
        key: 'settings',
        name: 'Settings',
        category: 'internal',
        description:
          'Platform configuration — business profile, billing, team, permissions.',
        actions: [
          'update_business_profile',
          'update_billing',
          'invite_team_member',
          'update_role',
          'remove_team_member',
          'update_permission',
          'configure_integrations',
          'update_branding',
          'set_language',
          'set_timezone',
        ],
        queries: [
          'get_business_profile',
          'get_billing_info',
          'list_team_members',
          'get_roles',
          'get_permissions',
          'get_integration_config',
          'get_branding',
          'get_audit_log',
        ],
      },
      {
        key: 'activity',
        name: 'Activity',
        category: 'internal',
        description:
          'Activity tracking — user actions, system events, audit trails, timelines.',
        actions: [
          'log_activity',
          'create_timeline',
          'update_timeline',
          'add_timeline_event',
          'set_retention_policy',
          'export_audit_log',
          'create_activity_stream',
          'filter_activities',
        ],
        queries: [
          'get_activity',
          'list_activities',
          'get_timeline',
          'list_timelines',
          'get_audit_trail',
          'get_activity_summary',
          'get_user_activity',
          'search_activities',
        ],
      },
      {
        key: 'keystore',
        name: 'KeyStore',
        category: 'internal',
        description:
          'Secure key-value storage — secrets, tokens, credentials, configuration.',
        actions: [
          'store_value',
          'update_value',
          'delete_value',
          'rotate_secret',
          'create_vault',
          'update_vault',
          'grant_access',
          'revoke_access',
          'backup_keystore',
          'import_values',
        ],
        queries: [
          'get_value',
          'list_values',
          'get_secret',
          'list_secrets',
          'get_vault',
          'list_vaults',
          'get_access_log',
          'search_keystore',
          'get_keystore_metrics',
        ],
      },
    ];

    for (const p of internalProviders) {
      this.register({
        key: p.key,
        name: p.name,
        category: p.category,
        description: p.description,
        authType: 'internal',
        icon: p.key,
        isInternal: true,
        capabilities: [
          ...p.actions.map((a) => ({
            type: 'ai_action' as const,
            resource: a,
            description: `Execute ${a.replace(/_/g, ' ')}`,
          })),
          ...p.queries.map((q) => ({
            type: 'ai_query' as const,
            resource: q,
            description: `Query ${q.replace(/_/g, ' ')}`,
          })),
        ],
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════════════

  private register(def: KeyConnectorProviderDef): void {
    this.providers.set(def.key, def);
  }

  private categoryLabel(key: ProviderCategory): string {
    const labels: Record<ProviderCategory, string> = {
      google: 'Google',
      microsoft: 'Microsoft',
      payment: 'Payment',
      communication: 'Communication',
      marketing: 'Marketing',
      social: 'Social',
      automation: 'Automation',
      form: 'Forms',
      internal: 'Internal Modules',
    };
    return labels[key] ?? key;
  }
}
