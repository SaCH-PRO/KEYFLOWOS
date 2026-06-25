          name: 'get_dna_history',
          description: 'Historical DNA score changes.',
          parameters: [
            { name: 'dimension', type: 'enum', description: 'Filter dimension', enumValues: ['revenue', 'operations', 'marketing', 'product', 'team', 'finance', 'customer_success'], required: false },
            { name: 'from', type: 'date', description: 'Start date', required: false },
          ],
          returns: 'DnaSnapshot[]',
          examples: ['Show DNA history', 'How has revenue DNA changed?'],
        },
        {
          name: 'get_benchmark',
          description: 'Compare DNA against industry benchmarks.',
          parameters: [
            { name: 'industry', type: 'string', description: 'Industry vertical', required: false },
          ],
          returns: 'BenchmarkComparison',
          examples: ['How do we compare to industry peers?', 'Show benchmark data'],
        },
        {
          name: 'get_recommendations',
          description: 'Get strategic recommendations based on DNA.',
          parameters: [
            { name: 'dimension', type: 'enum', description: 'Focus dimension', enumValues: ['revenue', 'operations', 'marketing', 'product', 'team', 'finance', 'customer_success'], required: false },
            { name: 'limit', type: 'number', description: 'Max recommendations', required: false, default: 5 },
          ],
          returns: 'Recommendation[]',
          examples: ['What should we focus on?', 'Get strategic recommendations'],
        },
        {
          name: 'get_growth_trajectory',
          description: 'Projected growth path based on current DNA.',
          parameters: [
            { name: 'monthsAhead', type: 'number', description: 'Projection horizon', required: false, default: 6 },
          ],
          returns: 'GrowthProjection',
          examples: ['Where will we be in 6 months?', 'Show growth trajectory'],
        },
        {
          name: 'get_dna_breakdown',
          description: 'Detailed per-dimension breakdown with gaps.',
          parameters: [],
          returns: 'DnaBreakdown',
          examples: ['Show DNA breakdown', 'What are our weakest areas?'],
        },
      ],
    },

    // ── 11. INTELLIGENCE ────────────────────────────────────────────────────
    {
      module: 'intelligence',
      description: 'AI-powered insights — churn risk, sentiment analysis, opportunity detection, and forecasting.',
      actions: [
        {
          name: 'analyze_sentiment',
          description: 'Run sentiment analysis on a conversation or text.',
          parameters: [
            { name: 'text', type: 'string', description: 'Text to analyze', required: false },
            { name: 'threadId', type: 'id', description: 'Thread to analyze', required: false },
            { name: 'contactId', type: 'id', description: 'Contact scope', required: false },
          ],
          requiresApproval: false,
          examples: ['Analyze sentiment of thread abc123', 'What is the mood of this conversation?'],
        },
        {
          name: 'detect_opportunities',
          description: 'Scan contacts for revenue opportunities.',
          parameters: [
            { name: 'segment', type: 'string', description: 'Target segment/tag', required: false },
            { name: 'minConfidence', type: 'number', description: 'Minimum confidence 0-1', required: false, default: 0.7 },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 20 },
          ],
          requiresApproval: false,
          examples: ['Find upsell opportunities', 'Detect opportunities in VIP segment'],
        },
        {
          name: 'generate_forecast',
          description: 'Predict future metric values.',
          parameters: [
            { name: 'metric', type: 'enum', description: 'Metric to forecast', enumValues: ['revenue', 'contacts', 'bookings', 'churn', 'conversion'], required: true },
            { name: 'horizon', type: 'enum', description: 'Forecast horizon', enumValues: ['1_week', '2_weeks', '1_month', '3_months', '6_months', '1_year'], required: true },
          ],
          requiresApproval: false,
          examples: ['Forecast revenue for next quarter', 'Predict bookings next month'],
        },
        {
          name: 'run_comprehensive_analysis',
          description: 'Run a full business intelligence analysis.',
          parameters: [
            { name: 'scope', type: 'enum', description: 'Analysis scope', enumValues: ['full', 'sales', 'marketing', 'operations', 'financial'], required: false, default: 'full' },
            { name: 'depth', type: 'enum', description: 'Analysis depth', enumValues: ['summary', 'detailed', 'exhaustive'], required: false, default: 'detailed' },
          ],
          requiresApproval: false,
          examples: ['Run full business analysis', 'Deep dive on sales'],
        },
      ],
      queries: [
        {
          name: 'get_churn_risk',
          description: 'Identify contacts at risk of churning.',
          parameters: [
            { name: 'threshold', type: 'number', description: 'Risk score threshold 0-1', required: false, default: 0.6 },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 20 },
          ],
          returns: 'ChurnRiskContact[]',
          examples: ['Who is at risk of churning?', 'Show high churn risk contacts'],
        },
        {
          name: 'get_opportunity_pipeline',
          description: 'View current opportunity pipeline with confidence scores.',
          parameters: [
            { name: 'stage', type: 'enum', description: 'Filter by stage', enumValues: ['early', 'qualified', 'proposal', 'negotiation', 'closing'], required: false },
            { name: 'minValue', type: 'number', description: 'Minimum deal value', required: false },
          ],
          returns: 'Opportunity[]',
          examples: ['Show opportunity pipeline', 'List qualified opportunities'],
        },
        {
          name: 'get_sentiment_trends',
          description: 'Track sentiment trends over time.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
            { name: 'channel', type: 'enum', description: 'Filter channel', enumValues: ['sms', 'email', 'whatsapp', 'all'], required: false, default: 'all' },
          ],
          returns: 'SentimentTrend[]',
          examples: ['How has sentiment changed this month?', 'Track sentiment trends'],
        },
        {
          name: 'get_forecast_accuracy',
          description: 'Compare past forecasts to actuals.',
          parameters: [
            { name: 'metric', type: 'enum', description: 'Metric', enumValues: ['revenue', 'contacts', 'bookings', 'churn', 'conversion'], required: true },
          ],
          returns: 'ForecastAccuracy',
          examples: ['How accurate were our forecasts?', 'Check forecast accuracy'],
        },
      ],
    },

    // ── 12. NOTIFICATIONS ───────────────────────────────────────────────────
    {
      module: 'notifications',
      description: 'Push notifications, alerts, email digests, and notification preferences.',
      actions: [
        {
          name: 'send_notification',
          description: 'Send an in-app push notification.',
          parameters: [
            { name: 'userId', type: 'id', description: 'Target user', required: true },
            { name: 'title', type: 'string', description: 'Notification title', required: true },
            { name: 'body', type: 'string', description: 'Notification body', required: true },
            { name: 'actionUrl', type: 'string', description: 'Deep link URL', required: false },
            { name: 'priority', type: 'enum', description: 'Priority', enumValues: ['low', 'normal', 'high', 'urgent'], required: false, default: 'normal' },
          ],
          requiresApproval: false,
          examples: ['Notify Jane about the new lead', 'Send urgent notification about overdue invoice'],
        },
        {
          name: 'create_alert',
          description: 'Create a persistent alert or reminder.',
          parameters: [
            { name: 'title', type: 'string', description: 'Alert title', required: true },
            { name: 'description', type: 'string', description: 'Alert details', required: false },
            { name: 'severity', type: 'enum', description: 'Alert severity', enumValues: ['info', 'warning', 'critical'], required: false, default: 'info' },
            { name: 'entityType', type: 'string', description: 'Related entity type', required: false },
            { name: 'entityId', type: 'id', description: 'Related entity ID', required: false },
          ],
          requiresApproval: false,
          examples: ['Create alert: 3 invoices overdue', 'Set warning alert for low inventory'],
        },
        {
          name: 'dismiss_alert',
          description: 'Mark an alert as acknowledged.',
          parameters: [
            { name: 'alertId', type: 'id', description: 'UUID of the alert', required: true },
            { name: 'notes', type: 'string', description: 'Dismissal notes', required: false },
          ],
          requiresApproval: false,
          examples: ['Dismiss alert abc123', 'Acknowledge the warning'],
        },
        {
          name: 'send_digest',
          description: 'Send a summary digest email to users.',
          parameters: [
            { name: 'userId', type: 'id', description: 'Target user', required: false },
            { name: 'period', type: 'enum', description: 'Digest period', enumValues: ['daily', 'weekly', 'monthly'], required: true },
            { name: 'sections', type: 'array', description: 'Sections to include', required: false },
          ],
          requiresApproval: false,
          examples: ['Send daily digest to Jane', 'Email weekly summary'],
        },
        {
          name: 'update_preferences',
          description: 'Update notification channel preferences.',
          parameters: [
            { name: 'userId', type: 'id', description: 'Target user', required: true },
            { name: 'channel', type: 'enum', description: 'Channel', enumValues: ['push', 'email', 'sms', 'in_app'], required: true },
            { name: 'enabled', type: 'boolean', description: 'Enable/disable', required: true },
            { name: 'categories', type: 'array', description: 'Categories affected', required: false },
          ],
          requiresApproval: false,
          examples: ['Enable email notifications for Jane', 'Turn off SMS alerts'],
        },
        {
          name: 'broadcast_alert',
          description: 'Send an alert to all business users.',
          parameters: [
            { name: 'title', type: 'string', description: 'Alert title', required: true },
            { name: 'body', type: 'string', description: 'Alert body', required: true },
            { name: 'severity', type: 'enum', description: 'Severity', enumValues: ['info', 'warning', 'critical'], required: false, default: 'info' },
          ],
          requiresApproval: true,
          examples: ['Broadcast critical alert: System maintenance tonight'],
        },
      ],
      queries: [
        {
          name: 'get_alerts',
          description: 'List active alerts with optional filtering.',
          parameters: [
            { name: 'severity', type: 'enum', description: 'Filter severity', enumValues: ['info', 'warning', 'critical'], required: false },
            { name: 'acknowledged', type: 'boolean', description: 'Include dismissed', required: false, default: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 50 },
          ],
          returns: 'Alert[]',
          examples: ['Show active alerts', 'List critical alerts'],
        },
        {
          name: 'get_notification_history',
          description: 'Retrieve past notifications sent.',
          parameters: [
            { name: 'userId', type: 'id', description: 'Filter by user', required: false },
            { name: 'from', type: 'date', description: 'Start date', required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 50 },
          ],
          returns: 'Notification[]',
          examples: ['Show notification history', 'List recent notifications'],
        },
        {
          name: 'get_user_preferences',
          description: 'Fetch notification preferences for a user.',
          parameters: [
            { name: 'userId', type: 'id', description: 'User ID', required: true },
          ],
          returns: 'NotificationPreferences',
          examples: ['Get Jane notification preferences'],
        },
        {
          name: 'get_alert_stats',
          description: 'Alert volume and resolution statistics.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
          ],
          returns: 'AlertStats',
          examples: ['How many alerts this week?', 'Show alert statistics'],
        },
      ],
    },

    // ── 13. PROJECTS ────────────────────────────────────────────────────────
    {
      module: 'projects',
      description: 'Project management — projects, milestones, tasks, timelines, and resource allocation.',
      actions: [
        {
          name: 'create_project',
          description: 'Create a new project.',
          parameters: [
            { name: 'name', type: 'string', description: 'Project name', required: true },
            { name: 'description', type: 'string', description: 'Project description', required: false },
            { name: 'contactId', type: 'id', description: 'Related client', required: false },
            { name: 'dueDate', type: 'date', description: 'Target completion date', required: false },
            { name: 'priority', type: 'enum', description: 'Priority', enumValues: ['low', 'medium', 'high', 'urgent'], required: false, default: 'medium' },
            { name: 'assigneeId', type: 'id', description: 'Project owner', required: false },
          ],
          requiresApproval: false,
          examples: ['Create project "Website Redesign"', 'Start project for Acme Corp'],
        },
        {
          name: 'add_task',
          description: 'Add a task to a project.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'UUID of the project', required: true },
            { name: 'title', type: 'string', description: 'Task title', required: true },
            { name: 'description', type: 'string', description: 'Task details', required: false },
            { name: 'assigneeId', type: 'id', description: 'Assigned user', required: false },
            { name: 'dueDate', type: 'date', description: 'Due date', required: false },
            { name: 'priority', type: 'enum', description: 'Priority', enumValues: ['low', 'medium', 'high', 'urgent'], required: false, default: 'medium' },
          ],
          requiresApproval: false,
          examples: ['Add task "Design homepage" to project abc', 'Create task for John in website project'],
        },
        {
          name: 'update_task',
          description: 'Edit a project task.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'UUID of the project', required: true },
            { name: 'taskId', type: 'id', description: 'UUID of the task', required: true },
            { name: 'title', type: 'string', description: 'New title', required: false },
            { name: 'status', type: 'enum', description: 'New status', enumValues: ['todo', 'in_progress', 'review', 'done', 'blocked'], required: false },
            { name: 'assigneeId', type: 'id', description: 'Reassign', required: false },
            { name: 'dueDate', type: 'date', description: 'New due date', required: false },
          ],
          requiresApproval: false,
          examples: ['Update task abc to in_progress', 'Reassign task to Jane'],
        },
        {
          name: 'complete_task',
          description: 'Mark a project task as done.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'UUID of the project', required: true },
            { name: 'taskId', type: 'id', description: 'UUID of the task', required: true },
            { name: 'notes', type: 'string', description: 'Completion notes', required: false },
          ],
          requiresApproval: false,
          examples: ['Mark task abc as complete', 'Finish the homepage design task'],
        },
        {
          name: 'delete_project',
          description: 'Remove a project and its tasks.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'UUID of the project', required: true },
          ],
          requiresApproval: true,
          examples: ['Delete project abc123'],
        },
        {
          name: 'add_milestone',
          description: 'Add a milestone to a project timeline.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'UUID of the project', required: true },
            { name: 'name', type: 'string', description: 'Milestone name', required: true },
            { name: 'dueDate', type: 'date', description: 'Target date', required: true },
            { name: 'description', type: 'string', description: 'Milestone details', required: false },
          ],
          requiresApproval: false,
          examples: ['Add milestone "Beta Launch" to project abc'],
        },
        {
          name: 'complete_milestone',
          description: 'Mark a milestone as achieved.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'UUID of the project', required: true },
            { name: 'milestoneId', type: 'id', description: 'UUID of the milestone', required: true },
            { name: 'notes', type: 'string', description: 'Completion notes', required: false },
          ],
          requiresApproval: false,
          examples: ['Complete milestone abc in project def'],
        },
        {
          name: 'archive_project',
          description: 'Archive a completed project.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'UUID of the project', required: true },
          ],
          requiresApproval: false,
          examples: ['Archive project abc123'],
        },
      ],
      queries: [
        {
          name: 'get_projects',
          description: 'List projects with optional filters.',
          parameters: [
            { name: 'status', type: 'enum', description: 'Filter status', enumValues: ['active', 'completed', 'archived', 'all'], required: false, default: 'active' },
            { name: 'priority', type: 'enum', description: 'Filter priority', enumValues: ['low', 'medium', 'high', 'urgent'], required: false },
            { name: 'assigneeId', type: 'id', description: 'Filter by owner', required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 50 },
          ],
          returns: 'Project[]',
          examples: ['List active projects', 'Show high-priority projects'],
        },
        {
          name: 'get_project_details',
          description: 'Fetch full project with tasks and milestones.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'UUID of the project', required: true },
          ],
          returns: 'ProjectDetails',
          examples: ['Show project abc123 details', 'Get project overview'],
        },
        {
          name: 'get_overdue_tasks',
          description: 'List overdue tasks across projects.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'Filter by project', required: false },
            { name: 'assigneeId', type: 'id', description: 'Filter by assignee', required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 50 },
          ],
          returns: 'Task[]',
          examples: ['What tasks are overdue?', 'Show overdue items for John'],
        },
        {
          name: 'get_project_timeline',
          description: 'Visual timeline of project milestones and tasks.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'UUID of the project', required: true },
          ],
          returns: 'TimelineEntry[]',
          examples: ['Show timeline for project abc', 'What is the project schedule?'],
        },
      ],
    },

    // ── 14. SOCIAL ──────────────────────────────────────────────────────────
    {
      module: 'social',
      description: 'Social media management — accounts, posts, engagement, and audience analytics.',
      actions: [
        {
          name: 'connect_account',
          description: 'Link a social media account.',
          parameters: [
            { name: 'platform', type: 'enum', description: 'Social platform', enumValues: ['facebook', 'instagram', 'twitter', 'linkedin', 'tiktok', 'youtube'], required: true },
            { name: 'handle', type: 'string', description: 'Account handle', required: true },
            { name: 'accessToken', type: 'string', description: 'OAuth token', required: true },
          ],
          requiresApproval: false,
          examples: ['Connect Facebook page @acme', 'Link Instagram account'],
        },
        {
          name: 'disconnect_account',
          description: 'Unlink a connected social account.',
          parameters: [
            { name: 'accountId', type: 'id', description: 'UUID of the connected account', required: true },
          ],
          requiresApproval: false,
          examples: ['Disconnect account abc123'],
        },
        {
          name: 'schedule_social_post',
          description: 'Queue a post for a social platform.',
          parameters: [
            { name: 'accountId', type: 'id', description: 'UUID of the social account', required: true },
            { name: 'body', type: 'string', description: 'Post content', required: true },
            { name: 'mediaUrls', type: 'array', description: 'Attached media', required: false },
            { name: 'scheduledAt', type: 'date', description: 'Publish time', required: true },
          ],
          requiresApproval: false,
          examples: ['Schedule Instagram post for tomorrow 10am'],
        },
        {
          name: 'publish_now',
          description: 'Immediately publish to a social platform.',
          parameters: [
            { name: 'accountId', type: 'id', description: 'UUID of the social account', required: true },
            { name: 'body', type: 'string', description: 'Post content', required: true },
            { name: 'mediaUrls', type: 'array', description: 'Attached media', required: false },
          ],
          requiresApproval: false,
          examples: ['Post to Facebook now', 'Tweet this message'],
        },
        {
          name: 'reply_to_comment',
          description: 'Respond to a comment on a social post.',
          parameters: [
            { name: 'accountId', type: 'id', description: 'UUID of the social account', required: true },
            { name: 'postId', type: 'string', description: 'Platform post ID', required: true },
            { name: 'commentId', type: 'string', description: 'Platform comment ID', required: true },
            { name: 'reply', type: 'string', description: 'Reply text', required: true },
          ],
          requiresApproval: false,
          examples: ['Reply to comment on Facebook post'],
        },
        {
          name: 'delete_social_post',
          description: 'Remove a published social post.',
          parameters: [
            { name: 'accountId', type: 'id', description: 'UUID of the social account', required: true },
            { name: 'postId', type: 'string', description: 'Platform post ID', required: true },
          ],
          requiresApproval: true,
          examples: ['Delete the Facebook post'],
        },
      ],
      queries: [
        {
          name: 'get_connected_accounts',
          description: 'List linked social media accounts.',
          parameters: [
            { name: 'platform', type: 'enum', description: 'Filter by platform', enumValues: ['facebook', 'instagram', 'twitter', 'linkedin', 'tiktok', 'youtube'], required: false },
          ],
          returns: 'SocialAccount[]',
          examples: ['List connected social accounts', 'Show Facebook pages'],
        },
        {
          name: 'get_scheduled_posts',
          description: 'View upcoming scheduled social posts.',
          parameters: [
            { name: 'accountId', type: 'id', description: 'Filter by account', required: false },
            { name: 'from', type: 'date', description: 'Start date', required: false },
            { name: 'to', type: 'date', description: 'End date', required: false },
          ],
          returns: 'ScheduledPost[]',
          examples: ['Show scheduled posts', 'What is posting this week?'],
        },
        {
          name: 'get_engagement_stats',
          description: 'Aggregate engagement metrics.',
          parameters: [
            { name: 'accountId', type: 'id', description: 'Filter by account', required: false },
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
          ],
          returns: 'EngagementStats',
          examples: ['Show engagement stats', 'How are our posts performing?'],
        },
        {
          name: 'get_follower_growth',
          description: 'Track follower/subscriber growth over time.',
          parameters: [
            { name: 'accountId', type: 'id', description: 'Filter by account', required: false },
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
          ],
          returns: 'FollowerGrowth[]',
          examples: ['Show follower growth', 'How many new followers this month?'],
        },
      ],
    },

    // ── 15. ANALYTICS ───────────────────────────────────────────────────────
    {
      module: 'analytics',
      description: 'Business analytics — dashboards, reports, funnels, cohorts, and custom metrics.',
      actions: [
        {
          name: 'create_dashboard',
          description: 'Build a custom analytics dashboard.',
          parameters: [
            { name: 'name', type: 'string', description: 'Dashboard name', required: true },
            { name: 'widgets', type: 'array', description: 'Widget configurations', required: true },
            { name: 'shared', type: 'boolean', description: 'Share with team', required: false, default: false },
          ],
          requiresApproval: false,
          examples: ['Create dashboard "Sales Overview"'],
        },
        {
          name: 'create_report',
          description: 'Generate a one-time or recurring report.',
          parameters: [
            { name: 'name', type: 'string', description: 'Report name', required: true },
            { name: 'type', type: 'enum', description: 'Report type', enumValues: ['revenue', 'contacts', 'engagement', 'custom'], required: true },
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
            { name: 'schedule', type: 'enum', description: 'Recurrence', enumValues: ['once', 'daily', 'weekly', 'monthly'], required: false, default: 'once' },
          ],
          requiresApproval: false,
          examples: ['Create weekly revenue report'],
        },
        {
          name: 'create_funnel',
          description: 'Define a conversion funnel.',
          parameters: [
            { name: 'name', type: 'string', description: 'Funnel name', required: true },
            { name: 'steps', type: 'array', description: 'Ordered step definitions', required: true },
          ],
          requiresApproval: false,
          examples: ['Create funnel "Lead to Customer"'],
        },
        {
          name: 'track_event',
          description: 'Record a custom analytics event.',
          parameters: [
            { name: 'eventName', type: 'string', description: 'Event key', required: true },
            { name: 'contactId', type: 'id', description: 'Associated contact', required: false },
            { name: 'properties', type: 'object', description: 'Event properties', required: false },
          ],
          requiresApproval: false,
          examples: ['Track event "pricing_page_view"'],
        },
        {
          name: 'export_report',
          description: 'Export a report to CSV/PDF.',
          parameters: [
            { name: 'reportId', type: 'id', description: 'UUID of the report', required: true },
            { name: 'format', type: 'enum', description: 'Export format', enumValues: ['csv', 'pdf', 'xlsx'], required: false, default: 'csv' },
          ],
          requiresApproval: false,
          examples: ['Export report abc123 as CSV'],
        },
      ],
      queries: [
        {
          name: 'get_dashboard',
          description: 'Fetch a dashboard with current data.',
          parameters: [
            { name: 'dashboardId', type: 'id', description: 'UUID of the dashboard', required: true },
          ],
          returns: 'Dashboard',
          examples: ['Show dashboard abc123', 'Open the sales dashboard'],
        },
        {
          name: 'get_funnel_conversion',
          description: 'Compute conversion rate for a funnel.',
          parameters: [
            { name: 'funnelId', type: 'id', description: 'UUID of the funnel', required: true },
            { name: 'from', type: 'date', description: 'Start date', required: false },
            { name: 'to', type: 'date', description: 'End date', required: false },
          ],
          returns: 'FunnelConversion',
          examples: ['What is our lead-to-customer conversion?', 'Show funnel stats'],
        },
        {
          name: 'get_cohort_retention',
          description: 'Calculate cohort retention matrix.',
          parameters: [
            { name: 'cohortType', type: 'enum', description: 'Cohort dimension', enumValues: ['signup_date', 'first_purchase', 'first_booking'], required: true },
            { name: 'periods', type: 'number', description: 'Number of periods', required: false, default: 6 },
          ],
          returns: 'CohortMatrix',
          examples: ['Show customer retention cohorts', 'Get signup cohort analysis'],
        },
        {
          name: 'get_kpis',
          description: 'Fetch core business KPIs.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: false },
            { name: 'to', type: 'date', description: 'End date', required: false },
          ],
          returns: 'KpiSet',
          examples: ['What are our KPIs?', 'Show core metrics'],
        },
        {
          name: 'get_trend',
          description: 'Time-series trend for a specific metric.',
          parameters: [
            { name: 'metric', type: 'enum', description: 'Metric name', enumValues: ['revenue', 'contacts', 'bookings', 'conversations', 'conversion_rate', 'response_time'], required: true },
            { name: 'granularity', type: 'enum', description: 'Time bucket', enumValues: ['hourly', 'daily', 'weekly', 'monthly'], required: false, default: 'daily' },
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
          ],
          returns: 'TrendPoint[]',
          examples: ['Show revenue trend this month', 'Plot contact growth'],
        },
      ],
    },

    // ── 16. FINANCE ─────────────────────────────────────────────────────────
    {
      module: 'finance',
      description: 'Financial management — expenses, budgets, tax categories, and financial reporting.',
      actions: [
        {
          name: 'record_expense',
          description: 'Log a business expense.',
          parameters: [
            { name: 'description', type: 'string', description: 'Expense description', required: true },
            { name: 'amount', type: 'number', description: 'Expense amount', required: true },
            { name: 'category', type: 'enum', description: 'Expense category', enumValues: ['office', 'travel', 'marketing', 'software', 'salaries', 'utilities', 'other'], required: true },
            { name: 'date', type: 'date', description: 'Expense date', required: false },
            { name: 'receiptUrl', type: 'string', description: 'Receipt image URL', required: false },
          ],
          requiresApproval: false,
          examples: ['Record $50 office supplies expense'],
        },
        {
          name: 'create_budget',
          description: 'Set a spending budget for a category.',
          parameters: [
            { name: 'category', type: 'enum', description: 'Budget category', enumValues: ['office', 'travel', 'marketing', 'software', 'salaries', 'utilities', 'other', 'overall'], required: true },
            { name: 'amount', type: 'number', description: 'Budget limit', required: true },
            { name: 'period', type: 'enum', description: 'Budget period', enumValues: ['weekly', 'monthly', 'quarterly', 'yearly'], required: true },
            { name: 'startDate', type: 'date', description: 'Budget start', required: true },
          ],
          requiresApproval: false,
          examples: ['Set monthly marketing budget to $2000'],
        },
        {
          name: 'update_budget',
          description: 'Modify an existing budget.',
          parameters: [
            { name: 'budgetId', type: 'id', description: 'UUID of the budget', required: true },
            { name: 'amount', type: 'number', description: 'New limit', required: false },
            { name: 'active', type: 'boolean', description: 'Enable/disable', required: false },
          ],
          requiresApproval: false,
          examples: ['Update budget abc123 to $3000'],
        },
        {
          name: 'delete_expense',
          description: 'Remove an expense record.',
          parameters: [
            { name: 'expenseId', type: 'id', description: 'UUID of the expense', required: true },
          ],
          requiresApproval: false,
          examples: ['Delete expense abc123'],
        },
        {
          name: 'categorize_transaction',
          description: 'Assign a category to an uncategorized transaction.',
          parameters: [
            { name: 'transactionId', type: 'id', description: 'UUID of the transaction', required: true },
            { name: 'category', type: 'enum', description: 'Category', enumValues: ['office', 'travel', 'marketing', 'software', 'salaries', 'utilities', 'other'], required: true },
          ],
          requiresApproval: false,
          examples: ['Categorize transaction abc as marketing'],
        },
        {
          name: 'generate_pnl',
          description: 'Generate a profit and loss statement.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
            { name: 'format', type: 'enum', description: 'Output format', enumValues: ['summary', 'detailed'], required: false, default: 'summary' },
          ],
          requiresApproval: false,
          examples: ['Generate P&L for this quarter'],
        },
      ],
      queries: [
        {
          name: 'get_expense_summary',
          description: 'Aggregate expenses by category for a period.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
          ],
          returns: 'ExpenseSummary',
          examples: ['Show expense summary for this month', 'How much did we spend?'],
        },
        {
          name: 'get_budget_status',
          description: 'Check budget utilization vs limits.',
          parameters: [
            { name: 'category', type: 'enum', description: 'Filter by category', enumValues: ['office', 'travel', 'marketing', 'software', 'salaries', 'utilities', 'other', 'overall'], required: false },
          ],
          returns: 'BudgetStatus[]',
          examples: ['Are we within budget?', 'Show budget status'],
        },
        {
          name: 'get_cashflow',
          description: 'Cash flow projection and history.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
          ],
          returns: 'CashFlow',
          examples: ['Show cash flow', 'What is our cash position?'],
        },
        {
          name: 'get_financial_health',
          description: 'Overall financial health score and metrics.',
          parameters: [],
          returns: 'FinancialHealth',
          examples: ['How is our financial health?', 'Show financial overview'],
        },
      ],
    },

    // ── 17. SETTINGS ────────────────────────────────────────────────────────
    {
      module: 'settings',
      description: 'Business settings — profile, branding, integrations, team, and permissions.',
      actions: [
        {
          name: 'update_business_profile',
          description: 'Update core business information.',
          parameters: [
            { name: 'name', type: 'string', description: 'Business name', required: false },
            { name: 'timezone', type: 'string', description: 'IANA timezone', required: false },
            { name: 'currency', type: 'string', description: 'ISO currency code', required: false },
            { name: 'industry', type: 'string', description: 'Industry vertical', required: false },
          ],
          requiresApproval: false,
          examples: ['Update business timezone to America/New_York'],
        },
        {
          name: 'update_branding',
          description: 'Update brand colors, logo, and email templates.',
          parameters: [
            { name: 'primaryColor', type: 'string', description: 'Hex primary color', required: false },
            { name: 'logoUrl', type: 'string', description: 'Logo image URL', required: false },
            { name: 'emailSignature', type: 'string', description: 'Default email signature', required: false },
          ],
          requiresApproval: false,
          examples: ['Update primary color to #FF5733'],
        },
        {
          name: 'add_team_member',
          description: 'Invite a new user to the business.',
          parameters: [
            { name: 'email', type: 'string', description: 'User email', required: true },
            { name: 'role', type: 'enum', description: 'Permission role', enumValues: ['owner', 'admin', 'manager', 'member', 'viewer'], required: true },
            { name: 'firstName', type: 'string', description: 'First name', required: false },
            { name: 'lastName', type: 'string', description: 'Last name', required: false },
          ],
          requiresApproval: false,
          examples: ['Invite john@example.com as admin'],
        },
        {
          name: 'remove_team_member',
          description: 'Revoke a user\'s access.',
          parameters: [
            { name: 'userId', type: 'id', description: 'UUID of the user', required: true },
          ],
          requiresApproval: true,
          examples: ['Remove user abc123 from team'],
        },
        {
          name: 'update_role',
          description: 'Change a team member\'s permission role.',
          parameters: [
            { name: 'userId', type: 'id', description: 'UUID of the user', required: true },
            { name: 'role', type: 'enum', description: 'New role', enumValues: ['owner', 'admin', 'manager', 'member', 'viewer'], required: true },
          ],
          requiresApproval: true,
          examples: ['Change user abc123 role to manager'],
        },
        {
          name: 'configure_integration',
          description: 'Enable or configure a third-party integration.',
          parameters: [
            { name: 'integration', type: 'enum', description: 'Integration key', enumValues: ['stripe', 'paypal', 'twilio', 'sendgrid', 'mailchimp', 'google_calendar', 'zoom', 'slack', 'zapier'], required: true },
            { name: 'config', type: 'object', description: 'Integration-specific config', required: true },
            { name: 'enabled', type: 'boolean', description: 'Enable/disable', required: false, default: true },
          ],
          requiresApproval: false,
          examples: ['Configure Stripe integration', 'Enable Google Calendar sync'],
        },
      ],
      queries: [
        {
          name: 'get_business_profile',
          description: 'Fetch current business profile settings.',
          parameters: [],
          returns: 'BusinessProfile',
          examples: ['Show business profile', 'What is our business info?'],
        },
        {
          name: 'get_team_members',
          description: 'List all team members and their roles.',
          parameters: [
            { name: 'role', type: 'enum', description: 'Filter by role', enumValues: ['owner', 'admin', 'manager', 'member', 'viewer'], required: false },
            { name: 'activeOnly', type: 'boolean', description: 'Only active users', required: false, default: true },
          ],
          returns: 'TeamMember[]',
          examples: ['List team members', 'Who has admin access?'],
        },
        {
          name: 'get_integrations',
          description: 'List configured third-party integrations.',
          parameters: [
            { name: 'enabledOnly', type: 'boolean', description: 'Only active', required: false, default: true },
          ],
          returns: 'Integration[]',
          examples: ['What integrations are connected?', 'List active integrations'],
        },
        {
          name: 'get_permissions',
          description: 'Get role-based permission matrix.',
          parameters: [],
          returns: 'PermissionMatrix',
          examples: ['Show permission matrix', 'What can managers do?'],
        },
      ],
    },

    // ── 18. ACTIVITY ────────────────────────────────────────────────────────
    {
      module: 'activity',
      description: 'Activity logging, audit trails, recent actions, and system events.',
      actions: [
        {
          name: 'log_activity',
          description: 'Record a custom activity event.',
          parameters: [
            { name: 'entityType', type: 'enum', description: 'Entity type', enumValues: ['contact', 'invoice', 'booking', 'project', 'task', 'automation', 'user'], required: true },
            { name: 'entityId', type: 'id', description: 'Entity UUID', required: true },
            { name: 'action', type: 'string', description: 'Action verb', required: true },
            { name: 'description', type: 'string', description: 'Human-readable description', required: false },
            { name: 'metadata', type: 'object', description: 'Extra context', required: false },
          ],
          requiresApproval: false,
          examples: ['Log that invoice abc was sent', 'Record contact creation event'],
        },
        {
          name: 'log_bulk_activity',
          description: 'Record multiple activity events at once.',
          parameters: [
            { name: 'events', type: 'array', description: 'Array of activity events', required: true },
          ],
          requiresApproval: false,
          examples: ['Log batch of campaign send events'],
        },
        {
          name: 'create_audit_note',
          description: 'Attach a manual audit note to an entity.',
          parameters: [
            { name: 'entityType', type: 'enum', description: 'Entity type', enumValues: ['contact', 'invoice', 'booking', 'project', 'task', 'automation', 'user'], required: true },
            { name: 'entityId', type: 'id', description: 'Entity UUID', required: true },
            { name: 'note', type: 'string', description: 'Audit note text', required: true },
          ],
          requiresApproval: false,
          examples: ['Add audit note to contact abc123'],
        },
        {
          name: 'export_audit_log',
          description: 'Export audit trail for compliance.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
            { name: 'entityType', type: 'enum', description: 'Filter by entity', enumValues: ['contact', 'invoice', 'booking', 'project', 'task', 'automation', 'user'], required: false },
            { name: 'format', type: 'enum', description: 'Export format', enumValues: ['csv', 'pdf', 'json'], required: false, default: 'csv' },
          ],
          requiresApproval: false,
          examples: ['Export audit log for January'],
        },
        {
          name: 'delete_old_logs',
          description: 'Purge activity logs older than a retention threshold.',
          parameters: [
            { name: 'olderThanDays', type: 'number', description: 'Retention in days', required: true },
            { name: 'entityType', type: 'enum', description: 'Filter by entity', enumValues: ['contact', 'invoice', 'booking', 'project', 'task', 'automation', 'user'], required: false },
          ],
          requiresApproval: true,
          examples: ['Delete logs older than 365 days'],
        },
      ],
      queries: [
        {
          name: 'get_activity',
          description: 'Query activity log with filters.',
          parameters: [
            { name: 'entityType', type: 'enum', description: 'Filter by entity', enumValues: ['contact', 'invoice', 'booking', 'project', 'task', 'automation', 'user'], required: false },
            { name: 'entityId', type: 'id', description: 'Filter by entity ID', required: false },
            { name: 'userId', type: 'id', description: 'Filter by actor', required: false },
            { name: 'from', type: 'date', description: 'Start date', required: false },
            { name: 'to', type: 'date', description: 'End date', required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 50 },
          ],
          returns: 'ActivityEntry[]',
          examples: ['Show activity log', 'What happened with contact abc?'],
        },
        {
          name: 'get_recent',
          description: 'Fetch the most recent activity across the business.',
          parameters: [
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 20 },
            { name: 'entityType', type: 'enum', description: 'Filter by entity', enumValues: ['contact', 'invoice', 'booking', 'project', 'task', 'automation', 'user'], required: false },
          ],
          returns: 'ActivityEntry[]',
          examples: ['What happened recently?', 'Show recent activity'],
        },
        {
          name: 'get_activity_stats',
          description: 'Aggregate activity statistics.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
            { name: 'groupBy', type: 'enum', description: 'Grouping', enumValues: ['hour', 'day', 'week', 'month'], required: false, default: 'day' },
          ],
          returns: 'ActivityStats',
          examples: ['Show activity stats', 'How active was the team this week?'],
        },
        {
          name: 'get_user_activity',
          description: 'Activity performed by a specific user.',
          parameters: [
            { name: 'userId', type: 'id', description: 'User UUID', required: true },
            { name: 'from', type: 'date', description: 'Start date', required: false },
            { name: 'to', type: 'date', description: 'End date', required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 50 },
          ],
          returns: 'ActivityEntry[]',
          examples: ['What did Jane do today?', 'Show user activity'],
        },
      ],
    },
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  //  2. PUBLIC API — Capabilities
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Return every registered capability across all 18 modules.
   */
  getAllCapabilities(): ModuleCapability[] {
    return this.MODULE_CAPABILITIES;
  }

  /**
   * Return capabilities for a subset of modules.
   */
  getCapabilities(modules: ModuleName[]): ModuleCapability[] {
    return this.MODULE_CAPABILITIES.filter((c) => modules.includes(c.module));
  }

  /**
   * Format the full capability registry as a human-readable text block
   * suitable for injection into an AI system-prompt context window.
   */
  formatCapabilitiesForPrompt(): string {
    const lines: string[] = [];
    lines.push('=== KeyFlowOS Module Capabilities ===');
    lines.push('');

    for (const cap of this.MODULE_CAPABILITIES) {
      lines.push(`Module: ${cap.module}`);
      lines.push(`  Description: ${cap.description}`);
      lines.push(`  Actions (${cap.actions.length}):`);
      for (const action of cap.actions) {
        const params = action.parameters.map((p) => `${p.name}${p.required ? '' : '?'}`).join(', ');
        lines.push(`    • ${action.name}(${params}) ${action.requiresApproval ? '[APPROVAL REQUIRED]' : ''}`);
        lines.push(`      ${action.description}`);
      }
      lines.push(`  Queries (${cap.queries.length}):`);
      for (const query of cap.queries) {
        const params = query.parameters.map((p) => `${p.name}${p.required ? '' : '?'}`).join(', ');
        lines.push(`    • ${query.name}(${params}) → ${query.returns}`);
        lines.push(`      ${query.description}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Return a compact JSON representation of capabilities for a given set of modules.
   */
  formatCapabilitiesForJson(modules?: ModuleName[]): Record<string, unknown> {
    const caps = modules ? this.getCapabilities(modules) : this.MODULE_CAPABILITIES;
    return {
      modules: caps.map((c) => ({
        module: c.module,
        description: c.description,
        actions: c.actions.map((a) => ({
          name: a.name,
          description: a.description,
          parameters: a.parameters,
          requiresApproval: a.requiresApproval,
        })),
        queries: c.queries.map((q) => ({
          name: q.name,
          description: q.description,
          parameters: q.parameters,
          returns: q.returns,
        })),
      })),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  3. COMMAND ROUTER
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute a connector command by routing it to the appropriate module adapter.
   */
  async executeCommand(command: ConnectorCommand): Promise<ConnectorResult> {
    // Validate command structure
    if (!command.module || !command.action) {
      return this.fail(command, Date.now(), 'Missing module or action in command');
    }

    // Route to module adapter
    switch (command.module) {
      case 'crm':
        return this.executeCrmAction(command);
      case 'commerce':
        return this.executeCommerceAction(command);
      case 'bookings':
        return this.executeBookingsAction(command);
      case 'content':
        return this.executeContentAction(command);
      case 'communications':
        return this.executeCommunicationsAction(command);
      case 'flow':
        return this.executeFlowAction(command);
      case 'autopilot':
        return this.executeAutopilotAction(command);
      case 'temporal':
        return this.executeTemporalAction(command);
      case 'inbox':
        return this.executeInboxAction(command);
      case 'genome':
        return this.executeGenomeAction(command);
      case 'intelligence':
        return this.executeIntelligenceAction(command);
      case 'notifications':
        return this.executeNotificationsAction(command);
      case 'projects':
        return this.executeProjectsAction(command);
      case 'social':
        return this.executeSocialAction(command);
      case 'analytics':
        return this.executeAnalyticsAction(command);
      case 'finance':
        return this.executeFinanceAction(command);
      case 'settings':
        return this.executeSettingsAction(command);
      case 'activity':
        return this.executeActivityAction(command);
      default:
        return this.fail(command, Date.now(), `Unknown module: ${command.module}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  4. RESULT HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private ok(command: ConnectorCommand, startTime: number, data: unknown): ConnectorResult {
    return {
      success: true,
      module: command.module,
      action: command.action,
      durationMs: Date.now() - startTime,
      data,
      timestamp: new Date().toISOString(),
    };
  }

  private fail(command: ConnectorCommand, startTime: number, error: string): ConnectorResult {
    return {
      success: false,
      module: command.module,
      action: command.action,
      durationMs: Date.now() - startTime,
      error,
      timestamp: new Date().toISOString(),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  5. MODULE ADAPTERS — CRM (12 actions)
  // ═══════════════════════════════════════════════════════════════════════════

  private async executeCrmAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'create_contact': {
        const contact = await this.crm.createContact({
          businessId: command.businessId,
          firstName: command.parameters.firstName as string,
          lastName: command.parameters.lastName as string,
          email: command.parameters.email as string,
          phone: command.parameters.phone as string,
          company: command.parameters.company as string,
          tags: command.parameters.tags as string[],
          status: (command.parameters.status as string) || 'lead',
        });
        return this.ok(command, start, contact);
      }
      case 'get_contact': {
        const contact = await this.crm.getContact({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
        });
        return this.ok(command, start, contact);
      }
      case 'update_contact': {
        const contact = await this.crm.updateContact({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          firstName: command.parameters.firstName as string,
          lastName: command.parameters.lastName as string,
          email: command.parameters.email as string,
          phone: command.parameters.phone as string,
          status: command.parameters.status as string,
          tags: command.parameters.tags as string[],
        });
        return this.ok(command, start, contact);
      }
      case 'delete_contact': {
        await this.crm.deleteContact({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
        });
        return this.ok(command, start, { deleted: true });
      }
      case 'list_contacts': {
        const contacts = await this.crm.listContacts({
          businessId: command.businessId,
          status: command.parameters.status as string,
          tag: command.parameters.tag as string,
          search: command.parameters.search as string,
          limit: (command.parameters.limit as number) || 50,
          offset: (command.parameters.offset as number) || 0,
        });
        return this.ok(command, start, contacts);
      }
      case 'add_task': {
        const task = await this.crm.addTask({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          title: command.parameters.title as string,
          priority: (command.parameters.priority as string) || 'medium',
          dueDate: command.parameters.dueDate as string,
          assignedTo: command.parameters.assignedTo as string,
        });
        return this.ok(command, start, task);
      }
      case 'complete_task': {
        const task = await this.crm.completeTask({
          businessId: command.businessId,
          taskId: command.parameters.taskId as string,
          contactId: command.parameters.contactId as string,
          notes: command.parameters.notes as string,
        });
        return this.ok(command, start, task);
      }
      case 'add_note': {
        const note = await this.crm.addNote({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          body: command.parameters.body as string,
          type: (command.parameters.type as string) || 'general',
        });
        return this.ok(command, start, note);
      }
      case 'add_tag': {
        const contact = await this.crm.addTag({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          tags: command.parameters.tags as string[],
        });
        return this.ok(command, start, contact);
      }
      case 'update_status': {
        const contact = await this.crm.updateStatus({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          status: command.parameters.status as string,
          reason: command.parameters.reason as string,
        });
        return this.ok(command, start, contact);
      }
      case 'log_event': {
        const event = await this.crm.logEvent({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          eventType: command.parameters.eventType as string,
          metadata: command.parameters.metadata as Record<string, unknown>,
        });
        return this.ok(command, start, event);
      }
      case 'merge_contacts': {
        const result = await this.crm.mergeContacts({
          businessId: command.businessId,
          masterContactId: command.parameters.masterContactId as string,
          duplicateContactId: command.parameters.duplicateContactId as string,
        });
        return this.ok(command, start, result);
      }
      default:
        return this.fail(command, start, `Unknown CRM action: ${command.action}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  6. MODULE ADAPTERS — COMMERCE (10 actions)
  // ═══════════════════════════════════════════════════════════════════════════

  private async executeCommerceAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'create_invoice': {
        const invoice = await this.commerce.createInvoice({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          items: command.parameters.items as Array<Record<string, unknown>>,
          dueDate: command.parameters.dueDate as string,
          notes: command.parameters.notes as string,
          sendImmediately: (command.parameters.sendImmediately as boolean) || false,
        });
        return this.ok(command, start, invoice);
      }
      case 'send_invoice': {
        const invoice = await this.commerce.sendInvoice({
          businessId: command.businessId,
          invoiceId: command.parameters.invoiceId as string,
          message: command.parameters.message as string,
        });
        return this.ok(command, start, invoice);
      }
      case 'get_invoice': {
        const invoice = await this.commerce.getInvoice({
          businessId: command.businessId,
          invoiceId: command.parameters.invoiceId as string,
        });
        return this.ok(command, start, invoice);
      }
      case 'list_invoices': {
        const invoices = await this.commerce.listInvoices({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          status: command.parameters.status as string,
          limit: (command.parameters.limit as number) || 50,
        });
        return this.ok(command, start, invoices);
      }
      case 'create_product': {
        const product = await this.commerce.createProduct({
          businessId: command.businessId,
          name: command.parameters.name as string,
          description: command.parameters.description as string,
          price: command.parameters.price as number,
          sku: command.parameters.sku as string,
          taxable: (command.parameters.taxable as boolean) ?? true,
        });
        return this.ok(command, start, product);
      }
      case 'get_product': {
        const product = await this.commerce.getProduct({
          businessId: command.businessId,
          productId: command.parameters.productId as string,
          sku: command.parameters.sku as string,
        });
        return this.ok(command, start, product);
      }
      case 'create_order': {
        const order = await this.commerce.createOrder({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          items: command.parameters.items as Array<Record<string, unknown>>,
          notes: command.parameters.notes as string,
        });
        return this.ok(command, start, order);
      }
      case 'process_payment': {
        const payment = await this.commerce.processPayment({
          businessId: command.businessId,
          invoiceId: command.parameters.invoiceId as string,
          amount: command.parameters.amount as number,
          method: command.parameters.method as string,
          reference: command.parameters.reference as string,
        });
        return this.ok(command, start, payment);
      }
      case 'create_quote': {
        const quote = await this.commerce.createQuote({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          items: command.parameters.items as Array<Record<string, unknown>>,
          validUntil: command.parameters.validUntil as string,
          notes: command.parameters.notes as string,
        });
        return this.ok(command, start, quote);
      }
      case 'send_quote': {
        const quote = await this.commerce.sendQuote({
          businessId: command.businessId,
          quoteId: command.parameters.quoteId as string,
          message: command.parameters.message as string,
        });
        return this.ok(command, start, quote);
      }
      default:
        return this.fail(command, start, `Unknown commerce action: ${command.action}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  7. MODULE ADAPTERS — BOOKINGS (8 actions)
  // ═══════════════════════════════════════════════════════════════════════════

  private async executeBookingsAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'create_booking': {
        const booking = await this.bookings.createBooking({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          serviceId: command.parameters.serviceId as string,
          startTime: command.parameters.startTime as string,
          endTime: command.parameters.endTime as string,
          staffId: command.parameters.staffId as string,
          notes: command.parameters.notes as string,
        });
        return this.ok(command, start, booking);
      }
      case 'cancel_booking': {
        const booking = await this.bookings.cancelBooking({
          businessId: command.businessId,
          bookingId: command.parameters.bookingId as string,
          reason: command.parameters.reason as string,
          notifyClient: (command.parameters.notifyClient as boolean) ?? true,
        });
        return this.ok(command, start, booking);
      }
      case 'reschedule_booking': {
        const booking = await this.bookings.rescheduleBooking({
          businessId: command.businessId,
          bookingId: command.parameters.bookingId as string,
          newStartTime: command.parameters.newStartTime as string,
          newEndTime: command.parameters.newEndTime as string,
          notifyClient: (command.parameters.notifyClient as boolean) ?? true,
        });
        return this.ok(command, start, booking);
      }
      case 'confirm_booking': {
        const booking = await this.bookings.confirmBooking({
          businessId: command.businessId,
          bookingId: command.parameters.bookingId as string,
          sendConfirmation: (command.parameters.sendConfirmation as boolean) ?? true,
        });
        return this.ok(command, start, booking);
      }
      case 'add_service': {
        const service = await this.bookings.addService({
          businessId: command.businessId,
          name: command.parameters.name as string,
          duration: command.parameters.duration as number,
          price: command.parameters.price as number,
          description: command.parameters.description as string,
          buffer: (command.parameters.buffer as number) || 0,
        });
        return this.ok(command, start, service);
      }
      case 'update_service': {
        const service = await this.bookings.updateService({
          businessId: command.businessId,
          serviceId: command.parameters.serviceId as string,
          name: command.parameters.name as string,
          duration: command.parameters.duration as number,
          price: command.parameters.price as number,
          active: command.parameters.active as boolean,
        });
        return this.ok(command, start, service);
      }
      case 'set_availability': {
        const avail = await this.bookings.setAvailability({
          businessId: command.businessId,
          staffId: command.parameters.staffId as string,
          dayOfWeek: command.parameters.dayOfWeek as string,
          startTime: command.parameters.startTime as string,
          endTime: command.parameters.endTime as string,
        });
        return this.ok(command, start, avail);
      }
      case 'block_time': {