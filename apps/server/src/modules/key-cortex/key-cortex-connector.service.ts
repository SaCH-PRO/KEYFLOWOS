            { name: 'userId', type: 'id', description: 'Assignee user ID', required: true },
          ],
          requiresApproval: false,
          examples: ['Assign thread TH-001 to Jane'],
        },
        {
          name: 'snooze_thread',
          description: 'Snooze a conversation thread until a later time.',
          parameters: [
            { name: 'threadId', type: 'id', description: 'UUID of the thread', required: true },
            { name: 'until', type: 'datetime', description: 'Snooze until (ISO 8601)', required: true },
            { name: 'reason', type: 'string', description: 'Why snoozed', required: false },
          ],
          requiresApproval: false,
          examples: ['Snooze thread TH-001 until tomorrow 9 AM'],
        },
      ],
      queries: [
        {
          name: 'get_inbox',
          description: 'Unified inbox with notes, messages, and threads.',
          parameters: [
            { name: 'type', type: 'enum', description: 'Filter by type', enumValues: ['note', 'message', 'mention', 'all'], required: false, default: 'all' },
            { name: 'unreadOnly', type: 'boolean', description: 'Only unread items', required: false },
            { name: 'limit', type: 'number', description: 'Page size', required: false, default: 50 },
            { name: 'offset', type: 'number', description: 'Page offset', required: false, default: 0 },
          ],
          returns: 'InboxItem[]',
          examples: ['Show my inbox', 'List unread messages'],
        },
        {
          name: 'get_thread',
          description: 'Full conversation thread with all messages.',
          parameters: [
            { name: 'threadId', type: 'id', description: 'UUID of the thread', required: true },
          ],
          returns: 'Thread with messages',
          examples: ['Show thread TH-001'],
        },
        {
          name: 'search_notes',
          description: 'Search notes by content or tags.',
          parameters: [
            { name: 'query', type: 'string', description: 'Search query', required: true },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 20 },
          ],
          returns: 'Note[]',
          examples: ['Search notes about "refund"'],
        },
        {
          name: 'get_unread_count',
          description: 'Count of unread inbox items.',
          parameters: [],
          returns: 'number',
          examples: ['How many unread messages do I have?'],
        },
        {
          name: 'get_team_activity',
          description: 'Recent team activity in the inbox.',
          parameters: [
            { name: 'limit', type: 'number', description: 'Max entries', required: false, default: 20 },
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
          ],
          returns: 'ActivityEntry[]',
          examples: ['What has the team been working on?'],
        },
      ],
    },
    // ── 10. GENOME ──────────────────────────────────────────────────────────
    {
      module: 'genome',
      description: 'Business DNA — 7-dimension health scoring, stage detection, readiness assessment.',
      actions: [
        {
          name: 'get_dna',
          description: 'Get the current business DNA scorecard (7 dimensions).',
          parameters: [
            { name: 'businessId', type: 'id', description: 'Business UUID', required: true },
            { name: 'recalculate', type: 'boolean', description: 'Force recalculation', required: false, default: false },
          ],
          requiresApproval: false,
          examples: ['Get DNA scorecard', 'Show business health'],
        },
        {
          name: 'get_stage',
          description: 'Determine the business growth stage.',
          parameters: [
            { name: 'businessId', type: 'id', description: 'Business UUID', required: true },
            { name: 'detailed', type: 'boolean', description: 'Include dimension breakdown', required: false, default: false },
          ],
          requiresApproval: false,
          examples: ['What stage is this business in?', 'Show growth stage details'],
        },
        {
          name: 'get_readiness',
          description: 'Assess readiness for a specific initiative.',
          parameters: [
            { name: 'businessId', type: 'id', description: 'Business UUID', required: true },
            { name: 'initiative', type: 'string', description: 'Initiative name (e.g. "launch_product", "scale_team")', required: true },
          ],
          requiresApproval: false,
          examples: ['Is the business ready to launch a product?', 'Assess scaling readiness'],
        },
        {
          name: 'update_dna',
          description: 'Update a specific DNA dimension score.',
          parameters: [
            { name: 'businessId', type: 'id', description: 'Business UUID', required: true },
            { name: 'dimension', type: 'enum', description: 'Dimension to update', enumValues: ['revenue', 'operations', 'marketing', 'product', 'team', 'finance', 'customer_success'], required: true },
            { name: 'score', type: 'number', description: 'New score 0-100', required: true },
            { name: 'reason', type: 'string', description: 'Reason for update', required: false },
          ],
          requiresApproval: true,
          examples: ['Update marketing DNA score to 85 — campaign performed well'],
        },
        {
          name: 'trigger_assessment',
          description: 'Trigger a full DNA reassessment.',
          parameters: [
            { name: 'businessId', type: 'id', description: 'Business UUID', required: true },
            { name: 'notify', type: 'boolean', description: 'Notify stakeholders', required: false, default: true },
          ],
          requiresApproval: false,
          examples: ['Run full DNA assessment', 'Trigger business health check'],
        },
      ],
      queries: [
        {
          name: 'get_dna',
          description: 'Full DNA scorecard with historical trends.',
          parameters: [
            { name: 'businessId', type: 'id', description: 'Business UUID', required: true },
            { name: 'recalculate', type: 'boolean', description: 'Force recalculation', required: false, default: false },
          ],
          returns: 'DnaScorecard',
          examples: ['Show DNA scorecard', 'Get business health report'],
        },
        {
          name: 'get_stage',
          description: 'Business growth stage with confidence score.',
          parameters: [
            { name: 'businessId', type: 'id', description: 'Business UUID', required: true },
          ],
          returns: 'GrowthStage',
          examples: ['What stage is this business?'],
        },
        {
          name: 'get_readiness',
          description: 'Readiness report for a specific initiative.',
          parameters: [
            { name: 'businessId', type: 'id', description: 'Business UUID', required: true },
            { name: 'initiative', type: 'string', description: 'Initiative name', required: true },
          ],
          returns: 'ReadinessReport',
          examples: ['Is the business ready to scale?'],
        },
        {
          name: 'get_dna_history',
          description: 'Historical DNA score changes.',
          parameters: [
            { name: 'businessId', type: 'id', description: 'Business UUID', required: true },
            { name: 'dimension', type: 'enum', description: 'Filter dimension', enumValues: ['revenue', 'operations', 'marketing', 'product', 'team', 'finance', 'customer_success'], required: false },
            { name: 'from', type: 'date', description: 'Start date', required: false },
          ],
          returns: 'DnaSnapshot[]',
          examples: ['Show DNA history', 'How has revenue DNA changed?'],
        },
      ],
    },
    // ── 11. INTELLIGENCE ────────────────────────────────────────────────────
    {
      module: 'intelligence',
      description: 'AI-powered insights — sentiment analysis, opportunity detection, predictive forecasting.',
      actions: [
        {
          name: 'analyze_sentiment',
          description: 'Analyze sentiment of text or conversation.',
          parameters: [
            { name: 'text', type: 'string', description: 'Text to analyze', required: true },
            { name: 'context', type: 'string', description: 'Additional context', required: false },
          ],
          requiresApproval: false,
          examples: ['Analyze sentiment of "I love this product but shipping was slow"'],
        },
        {
          name: 'detect_opportunities',
          description: 'Scan contacts and conversations for business opportunities.',
          parameters: [
            { name: 'contactIds', type: 'array', description: 'Specific contacts to scan (empty = all)', required: false },
            { name: 'minConfidence', type: 'number', description: 'Minimum confidence threshold 0-1', required: false, default: 0.7 },
            { name: 'types', type: 'array', description: 'Opportunity types to look for', required: false },
          ],
          requiresApproval: false,
          examples: ['Find upsell opportunities among customers', 'Detect churn risk signals'],
        },
        {
          name: 'generate_forecast',
          description: 'Generate a predictive forecast for a business metric.',
          parameters: [
            { name: 'metric', type: 'enum', description: 'Metric to forecast', enumValues: ['revenue', 'churn', 'conversion', 'support_volume', 'pipeline'], required: true },
            { name: 'horizon', type: 'enum', description: 'Forecast horizon', enumValues: ['7d', '30d', '90d', '1y'], required: true },
            { name: 'businessId', type: 'id', description: 'Business UUID', required: true },
          ],
          requiresApproval: false,
          examples: ['Forecast revenue for next 30 days', 'Predict churn risk for Q2'],
        },
        {
          name: 'run_comprehensive_analysis',
          description: 'Run a full business intelligence analysis across all dimensions.',
          parameters: [
            { name: 'businessId', type: 'id', description: 'Business UUID', required: true },
            { name: 'scope', type: 'enum', description: 'Analysis scope', enumValues: ['full', 'financial', 'operational', 'customer', 'growth'], required: false, default: 'full' },
          ],
          requiresApproval: false,
          examples: ['Run full business analysis', 'Analyze customer health'],
        },
      ],
      queries: [
        {
          name: 'get_sentiment_trend',
          description: 'Sentiment trend over time.',
          parameters: [
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
            { name: 'entityType', type: 'enum', description: 'Filter by entity', enumValues: ['contact', 'conversation', 'review'], required: false },
          ],
          returns: 'SentimentTrend',
          examples: ['Show sentiment trend this month'],
        },
        {
          name: 'get_opportunities',
          description: 'List detected opportunities with confidence scores.',
          parameters: [
            { name: 'minConfidence', type: 'number', description: 'Min confidence 0-1', required: false, default: 0.7 },
            { name: 'status', type: 'enum', description: 'Opportunity status', enumValues: ['new', 'in_progress', 'won', 'lost', 'dismissed'], required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 20 },
          ],
          returns: 'Opportunity[]',
          examples: ['Show top opportunities', 'List high-confidence upsells'],
        },
        {
          name: 'get_forecast',
          description: 'Latest forecast for a business metric.',
          parameters: [
            { name: 'metric', type: 'enum', description: 'Metric', enumValues: ['revenue', 'churn', 'conversion', 'support_volume', 'pipeline'], required: true },
            { name: 'horizon', type: 'enum', description: 'Horizon', enumValues: ['7d', '30d', '90d', '1y'], required: true },
            { name: 'businessId', type: 'id', description: 'Business UUID', required: true },
          ],
          returns: 'Forecast',
          examples: ['Show revenue forecast', 'Get churn prediction'],
        },
        {
          name: 'get_insights',
          description: 'Curated AI insights and recommendations.',
          parameters: [
            { name: 'businessId', type: 'id', description: 'Business UUID', required: true },
            { name: 'category', type: 'enum', description: 'Insight category', enumValues: ['revenue', 'churn', 'growth', 'efficiency', 'risk'], required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 10 },
          ],
          returns: 'Insight[]',
          examples: ['Show AI insights', 'Get growth recommendations'],
        },
      ],
    },
    // ── 12. NOTIFICATIONS ───────────────────────────────────────────────────
    {
      module: 'notifications',
      description: 'In-app, push, email, and SMS notifications with preference management.',
      actions: [
        {
          name: 'send_notification',
          description: 'Send a notification to a user.',
          parameters: [
            { name: 'userId', type: 'id', description: 'User UUID', required: true },
            { name: 'title', type: 'string', description: 'Notification title', required: true },
            { name: 'body', type: 'string', description: 'Notification body', required: true },
            { name: 'type', type: 'enum', description: 'Notification type', enumValues: ['info', 'success', 'warning', 'error'], required: false, default: 'info' },
            { name: 'channel', type: 'enum', description: 'Delivery channel', enumValues: ['in_app', 'push', 'email', 'sms'], required: false, default: 'in_app' },
            { name: 'actionUrl', type: 'string', description: 'Deep link URL', required: false },
            { name: 'data', type: 'object', description: 'Additional payload', required: false },
          ],
          requiresApproval: false,
          examples: ['Send notification to Jane: "Invoice INV-001 is overdue"'],
        },
        {
          name: 'mark_all_read',
          description: 'Mark all notifications as read for a user.',
          parameters: [
            { name: 'userId', type: 'id', description: 'User UUID', required: true },
          ],
          requiresApproval: false,
          examples: ['Mark all notifications as read for Jane'],
        },
        {
          name: 'configure_digest',
          description: 'Configure a daily or weekly notification digest.',
          parameters: [
            { name: 'userId', type: 'id', description: 'User UUID', required: true },
            { name: 'frequency', type: 'enum', description: 'Digest frequency', enumValues: ['daily', 'weekly', 'off'], required: true },
            { name: 'time', type: 'string', description: 'Delivery time (HH:MM)', required: false },
            { name: 'categories', type: 'array', description: 'Categories to include', required: false },
          ],
          requiresApproval: false,
          examples: ['Set daily digest for Jane at 9 AM'],
        },
        {
          name: 'create_notification_rule',
          description: 'Create a rule that auto-sends notifications on events.',
          parameters: [
            { name: 'name', type: 'string', description: 'Rule name', required: true },
            { name: 'eventType', type: 'enum', description: 'Trigger event', enumValues: ['invoice_overdue', 'booking_created', 'contact_status_changed', 'task_completed', 'custom'], required: true },
            { name: 'conditions', type: 'object', description: 'Rule conditions', required: false },
            { name: 'recipients', type: 'array', description: 'Recipient user IDs', required: true },
            { name: 'template', type: 'object', description: 'Notification template', required: true },
          ],
          requiresApproval: false,
          examples: ['Create rule: notify manager when invoice goes overdue'],
        },
      ],
      queries: [
        {
          name: 'get_notifications',
          description: 'List notifications for a user.',
          parameters: [
            { name: 'userId', type: 'id', description: 'User UUID', required: true },
            { name: 'unreadOnly', type: 'boolean', description: 'Only unread', required: false },
            { name: 'limit', type: 'number', description: 'Page size', required: false, default: 50 },
            { name: 'offset', type: 'number', description: 'Page offset', required: false, default: 0 },
          ],
          returns: 'Notification[]',
          examples: ['Show my notifications', 'List unread notifications'],
        },
        {
          name: 'get_preferences',
          description: 'Get notification preferences for a user.',
          parameters: [
            { name: 'userId', type: 'id', description: 'User UUID', required: true },
          ],
          returns: 'NotificationPreferences',
          examples: ['What are Jane\'s notification preferences?'],
        },
        {
          name: 'get_unread_count',
          description: 'Unread notification count for a user.',
          parameters: [
            { name: 'userId', type: 'id', description: 'User UUID', required: true },
          ],
          returns: 'number',
          examples: ['How many unread notifications for Jane?'],
        },
        {
          name: 'get_notification_stats',
          description: 'Aggregate notification statistics.',
          parameters: [
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
            { name: 'userId', type: 'id', description: 'Filter by user', required: false },
          ],
          returns: 'NotificationStats',
          examples: ['Show notification stats for this week'],
        },
      ],
    },
    // ── 13. PROJECTS ────────────────────────────────────────────────────────
    {
      module: 'projects',
      description: 'Project management, milestones, tasks, Gantt charts, resource allocation.',
      actions: [
        {
          name: 'create_project',
          description: 'Create a new project.',
          parameters: [
            { name: 'name', type: 'string', description: 'Project name', required: true },
            { name: 'description', type: 'string', description: 'Description', required: false },
            { name: 'clientId', type: 'id', description: 'Client contact UUID', required: false },
            { name: 'startDate', type: 'date', description: 'Start date (ISO 8601)', required: false },
            { name: 'endDate', type: 'date', description: 'Target end date', required: false },
            { name: 'budget', type: 'number', description: 'Budget amount', required: false },
            { name: 'status', type: 'enum', description: 'Initial status', enumValues: ['planning', 'active', 'on_hold', 'completed', 'cancelled'], required: false, default: 'planning' },
          ],
          requiresApproval: false,
          examples: ['Create project "Website Redesign" for Acme Corp'],
        },
        {
          name: 'add_milestone',
          description: 'Add a milestone to a project.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'Project UUID', required: true },
            { name: 'name', type: 'string', description: 'Milestone name', required: true },
            { name: 'dueDate', type: 'date', description: 'Due date (ISO 8601)', required: true },
            { name: 'description', type: 'string', description: 'Description', required: false },
          ],
          requiresApproval: false,
          examples: ['Add milestone "Design Complete" to project PRJ-001'],
        },
        {
          name: 'add_task',
          description: 'Add a task to a project.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'Project UUID', required: true },
            { name: 'title', type: 'string', description: 'Task title', required: true },
            { name: 'description', type: 'string', description: 'Description', required: false },
            { name: 'assignee', type: 'id', description: 'User UUID', required: false },
            { name: 'dueDate', type: 'date', description: 'Due date', required: false },
            { name: 'priority', type: 'enum', description: 'Priority', enumValues: ['low', 'medium', 'high', 'critical'], required: false, default: 'medium' },
          ],
          requiresApproval: false,
          examples: ['Add task "Design homepage" to PRJ-001'],
        },
        {
          name: 'update_task_status',
          description: 'Change the status of a project task.',
          parameters: [
            { name: 'taskId', type: 'id', description: 'Task UUID', required: true },
            { name: 'status', type: 'enum', description: 'New status', enumValues: ['todo', 'in_progress', 'review', 'done', 'blocked'], required: true },
          ],
          requiresApproval: false,
          examples: ['Mark task TK-001 as done'],
        },
        {
          name: 'update_project_status',
          description: 'Change the overall status of a project.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'Project UUID', required: true },
            { name: 'status', type: 'enum', description: 'New status', enumValues: ['planning', 'active', 'on_hold', 'completed', 'cancelled'], required: true },
          ],
          requiresApproval: false,
          examples: ['Mark project PRJ-001 as active'],
        },
        {
          name: 'complete_milestone',
          description: 'Mark a project milestone as completed.',
          parameters: [
            { name: 'milestoneId', type: 'id', description: 'Milestone UUID', required: true },
            { name: 'notes', type: 'string', description: 'Completion notes', required: false },
          ],
          requiresApproval: false,
          examples: ['Complete milestone MS-001'],
        },
        {
          name: 'archive_project',
          description: 'Archive a completed or cancelled project.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'Project UUID', required: true },
          ],
          requiresApproval: false,
          examples: ['Archive project PRJ-001'],
        },
      ],
      queries: [
        {
          name: 'get_project',
          description: 'Full project with milestones, tasks, and team.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'Project UUID', required: true },
          ],
          returns: 'Project with details',
          examples: ['Show project PRJ-001'],
        },
        {
          name: 'list_projects',
          description: 'Paginated project list with optional filters.',
          parameters: [
            { name: 'status', type: 'enum', description: 'Filter by status', enumValues: ['planning', 'active', 'on_hold', 'completed', 'cancelled'], required: false },
            { name: 'clientId', type: 'id', description: 'Filter by client', required: false },
            { name: 'limit', type: 'number', description: 'Page size', required: false, default: 50 },
            { name: 'offset', type: 'number', description: 'Page offset', required: false, default: 0 },
          ],
          returns: 'Project[]',
          examples: ['List active projects', 'Show projects for Acme Corp'],
        },
        {
          name: 'get_task_board',
          description: 'Kanban board view of tasks for a project.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'Project UUID', required: true },
          ],
          returns: 'TaskBoard',
          examples: ['Show task board for PRJ-001'],
        },
        {
          name: 'get_gantt_chart',
          description: 'Gantt chart timeline for a project.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'Project UUID', required: true },
          ],
          returns: 'GanttChart',
          examples: ['Show Gantt chart for PRJ-001'],
        },
        {
          name: 'get_project_stats',
          description: 'Project statistics (completion %, budget burn, risk).',
          parameters: [
            { name: 'projectId', type: 'id', description: 'Project UUID', required: true },
          ],
          returns: 'ProjectStats',
          examples: ['How is PRJ-001 doing?', 'Show project health'],
        },
      ],
    },
    // ── 14. SOCIAL ──────────────────────────────────────────────────────────
    {
      module: 'social',
      description: 'Social media management — scheduling, publishing, engagement, analytics.',
      actions: [
        {
          name: 'schedule_post',
          description: 'Schedule a social media post.',
          parameters: [
            { name: 'platform', type: 'enum', description: 'Social platform', enumValues: ['twitter', 'facebook', 'linkedin', 'instagram', 'tiktok'], required: true },
            { name: 'content', type: 'string', description: 'Post content', required: true },
            { name: 'scheduledAt', type: 'datetime', description: 'Schedule time (ISO 8601)', required: true },
            { name: 'mediaUrls', type: 'array', description: 'Media attachments', required: false },
          ],
          requiresApproval: false,
          examples: ['Schedule Twitter post for tomorrow 9 AM'],
        },
        {
          name: 'publish_now',
          description: 'Publish a social media post immediately.',
          parameters: [
            { name: 'platform', type: 'enum', description: 'Social platform', enumValues: ['twitter', 'facebook', 'linkedin', 'instagram', 'tiktok'], required: true },
            { name: 'content', type: 'string', description: 'Post content', required: true },
            { name: 'mediaUrls', type: 'array', description: 'Media attachments', required: false },
          ],
          requiresApproval: false,
          examples: ['Post to Twitter now'],
        },
        {
          name: 'reply_to_comment',
          description: 'Reply to a comment on a social media post.',
          parameters: [
            { name: 'postId', type: 'id', description: 'Post UUID', required: true },
            { name: 'commentId', type: 'id', description: 'Comment UUID', required: true },
            { name: 'reply', type: 'string', description: 'Reply text', required: true },
          ],
          requiresApproval: false,
          examples: ['Reply to comment on post SP-001'],
        },
        {
          name: 'delete_post',
          description: 'Delete a published or scheduled social media post.',
          parameters: [
            { name: 'postId', type: 'id', description: 'Post UUID', required: true },
          ],
          requiresApproval: false,
          examples: ['Delete post SP-001'],
        },
        {
          name: 'connect_account',
          description: 'Connect a social media account.',
          parameters: [
            { name: 'platform', type: 'enum', description: 'Social platform', enumValues: ['twitter', 'facebook', 'linkedin', 'instagram', 'tiktok'], required: true },
            { name: 'handle', type: 'string', description: 'Account handle', required: true },
            { name: 'accessToken', type: 'string', description: 'OAuth access token', required: true },
          ],
          requiresApproval: false,
          examples: ['Connect Twitter account @acme'],
        },
        {
          name: 'disconnect_account',
          description: 'Disconnect a social media account.',
          parameters: [
            { name: 'accountId', type: 'id', description: 'Account UUID', required: true },
          ],
          requiresApproval: false,
          examples: ['Disconnect Twitter account ACC-001'],
        },
      ],
      queries: [
        {
          name: 'get_scheduled_posts',
          description: 'Upcoming scheduled social posts.',
          parameters: [
            { name: 'platform', type: 'enum', description: 'Filter by platform', enumValues: ['twitter', 'facebook', 'linkedin', 'instagram', 'tiktok'], required: false },
            { name: 'limit', type: 'number', description: 'Max posts', required: false, default: 20 },
          ],
          returns: 'ScheduledPost[]',
          examples: ['Show scheduled posts', 'What is posting to Twitter soon?'],
        },
        {
          name: 'get_social_analytics',
          description: 'Social media performance metrics.',
          parameters: [
            { name: 'platform', type: 'enum', description: 'Filter by platform', enumValues: ['twitter', 'facebook', 'linkedin', 'instagram', 'tiktok'], required: false },
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
          ],
          returns: 'SocialAnalytics',
          examples: ['Show social analytics for last month'],
        },
        {
          name: 'get_engagement_stats',
          description: 'Engagement rate, reach, impressions per platform.',
          parameters: [
            { name: 'platform', type: 'enum', description: 'Filter by platform', enumValues: ['twitter', 'facebook', 'linkedin', 'instagram', 'tiktok'], required: false },
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
          ],
          returns: 'EngagementStats',
          examples: ['Show engagement stats', 'What is our reach on Twitter?'],
        },
        {
          name: 'get_follower_growth',
          description: 'Follower growth over time.',
          parameters: [
            { name: 'platform', type: 'enum', description: 'Filter by platform', enumValues: ['twitter', 'facebook', 'linkedin', 'instagram', 'tiktok'], required: false },
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
          ],
          returns: 'FollowerGrowth',
          examples: ['Show follower growth', 'How many new followers this month?'],
        },
      ],
    },
    // ── 15. ANALYTICS ───────────────────────────────────────────────────────
    {
      module: 'analytics',
      description: 'Dashboards, reports, funnels, event tracking, data exports.',
      actions: [
        {
          name: 'create_dashboard',
          description: 'Create a custom analytics dashboard.',
          parameters: [
            { name: 'name', type: 'string', description: 'Dashboard name', required: true },
            { name: 'widgets', type: 'array', description: 'Widget configs', required: true },
            { name: 'shared', type: 'boolean', description: 'Share with team', required: false, default: false },
          ],
          requiresApproval: false,
          examples: ['Create dashboard "Q1 Performance"'],
        },
        {
          name: 'create_report',
          description: 'Generate an analytics report.',
          parameters: [
            { name: 'name', type: 'string', description: 'Report name', required: true },
            { name: 'type', type: 'enum', description: 'Report type', enumValues: ['revenue', 'pipeline', 'engagement', 'custom'], required: true },
            { name: 'dateFrom', type: 'date', description: 'Start date', required: true },
            { name: 'dateTo', type: 'date', description: 'End date', required: true },
            { name: 'schedule', type: 'enum', description: 'Schedule', enumValues: ['once', 'daily', 'weekly', 'monthly'], required: false, default: 'once' },
          ],
          requiresApproval: false,
          examples: ['Create report "January Revenue"'],
        },
        {
          name: 'create_funnel',
          description: 'Create a conversion funnel.',
          parameters: [
            { name: 'name', type: 'string', description: 'Funnel name', required: true },
            { name: 'steps', type: 'array', description: 'Funnel steps [{name, event, filter?}]', required: true },
          ],
          requiresApproval: false,
          examples: ['Create funnel "Lead to Customer"'],
        },
        {
          name: 'track_event',
          description: 'Track a custom analytics event.',
          parameters: [
            { name: 'eventName', type: 'string', description: 'Event name', required: true },
            { name: 'properties', type: 'object', description: 'Event properties', required: false },
            { name: 'contactId', type: 'id', description: 'Associated contact UUID', required: false },
          ],
          requiresApproval: false,
          examples: ['Track event "button_clicked" with properties {button: "signup"}'],
        },
        {
          name: 'export_data',
          description: 'Export analytics data to CSV or JSON.',
          parameters: [
            { name: 'reportId', type: 'id', description: 'Report UUID', required: true },
            { name: 'format', type: 'enum', description: 'Export format', enumValues: ['csv', 'json', 'xlsx'], required: false, default: 'csv' },
          ],
          requiresApproval: false,
          examples: ['Export report RPT-001 to CSV'],
        },
      ],
      queries: [
        {
          name: 'get_dashboard',
          description: 'Full dashboard with all widgets and data.',
          parameters: [
            { name: 'dashboardId', type: 'id', description: 'Dashboard UUID', required: true },
          ],
          returns: 'Dashboard',
          examples: ['Show dashboard DB-001'],
        },
        {
          name: 'get_report',
          description: 'Generated report with data.',
          parameters: [
            { name: 'reportId', type: 'id', description: 'Report UUID', required: true },
          ],
          returns: 'Report',
          examples: ['Show report RPT-001'],
        },
        {
          name: 'get_funnel',
          description: 'Funnel with conversion rates at each step.',
          parameters: [
            { name: 'funnelId', type: 'id', description: 'Funnel UUID', required: true },
          ],
          returns: 'Funnel',
          examples: ['Show funnel FN-001'],
        },
        {
          name: 'get_event_volume',
          description: 'Event counts over time.',
          parameters: [
            { name: 'eventName', type: 'string', description: 'Event name', required: false },
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
          ],
          returns: 'EventVolume[]',
          examples: ['How many signups this week?'],
        },
        {
          name: 'list_dashboards',
          description: 'List available dashboards.',
          parameters: [],
          returns: 'Dashboard[]',
          examples: ['What dashboards are available?'],
        },
      ],
    },
    // ── 16. FINANCE ─────────────────────────────────────────────────────────
    {
      module: 'finance',
      description: 'Expense tracking, budgeting, P&L, transaction categorization.',
      actions: [
        {
          name: 'record_expense',
          description: 'Record a business expense.',
          parameters: [
            { name: 'amount', type: 'number', description: 'Expense amount', required: true },
            { name: 'category', type: 'enum', description: 'Expense category', enumValues: ['office', 'travel', 'software', 'marketing', 'payroll', 'utilities', 'other'], required: true },
            { name: 'description', type: 'string', description: 'Description', required: true },
            { name: 'date', type: 'date', description: 'Expense date (ISO 8601)', required: false },
            { name: 'receiptUrl', type: 'string', description: 'Receipt image URL', required: false },
          ],
          requiresApproval: false,
          examples: ['Record $500 software expense'],
        },
        {
          name: 'create_budget',
          description: 'Create a budget for a category or period.',
          parameters: [
            { name: 'name', type: 'string', description: 'Budget name', required: true },
            { name: 'amount', type: 'number', description: 'Budget limit', required: true },
            { name: 'category', type: 'enum', description: 'Category', enumValues: ['office', 'travel', 'software', 'marketing', 'payroll', 'utilities', 'other'], required: false },
            { name: 'period', type: 'enum', description: 'Budget period', enumValues: ['weekly', 'monthly', 'quarterly', 'yearly'], required: false, default: 'monthly' },
            { name: 'startDate', type: 'date', description: 'Start date', required: false },
            { name: 'endDate', type: 'date', description: 'End date', required: false },
          ],
          requiresApproval: false,
          examples: ['Create monthly marketing budget of $5,000'],
        },
        {
          name: 'update_budget',
          description: 'Update a budget (amount, period, status).',
          parameters: [
            { name: 'budgetId', type: 'id', description: 'Budget UUID', required: true },
            { name: 'amount', type: 'number', description: 'New amount', required: false },
            { name: 'period', type: 'enum', description: 'New period', enumValues: ['weekly', 'monthly', 'quarterly', 'yearly'], required: false },
            { name: 'isActive', type: 'boolean', description: 'Active status', required: false },
          ],
          requiresApproval: false,
          examples: ['Increase marketing budget to $7,000'],
        },
        {
          name: 'delete_expense',
          description: 'Delete a recorded expense.',
          parameters: [
            { name: 'expenseId', type: 'id', description: 'Expense UUID', required: true },
          ],
          requiresApproval: false,
          examples: ['Delete expense EXP-001'],
        },
        {
          name: 'categorize_transaction',
          description: 'Auto-categorize or manually categorize a transaction.',
          parameters: [
            { name: 'transactionId', type: 'id', description: 'Transaction UUID', required: true },
            { name: 'category', type: 'enum', description: 'Category', enumValues: ['office', 'travel', 'software', 'marketing', 'payroll', 'utilities', 'other'], required: true },
          ],
          requiresApproval: false,
          examples: ['Categorize transaction TXN-001 as software'],
        },
        {
          name: 'generate_pnl',
          description: 'Generate a Profit & Loss statement.',
          parameters: [
            { name: 'dateFrom', type: 'date', description: 'Start date', required: true },
            { name: 'dateTo', type: 'date', description: 'End date', required: true },
            { name: 'format', type: 'enum', description: 'Output format', enumValues: ['summary', 'detailed'], required: false, default: 'summary' },
          ],
          requiresApproval: false,
          examples: ['Generate P&L for Q1 2024'],
        },
      ],
      queries: [
        {
          name: 'get_expenses',
          description: 'List expenses with optional filters.',
          parameters: [
            { name: 'category', type: 'enum', description: 'Filter by category', enumValues: ['office', 'travel', 'software', 'marketing', 'payroll', 'utilities', 'other'], required: false },
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
            { name: 'limit', type: 'number', description: 'Page size', required: false, default: 50 },
            { name: 'offset', type: 'number', description: 'Page offset', required: false, default: 0 },
          ],
          returns: 'Expense[]',
          examples: ['List expenses for January', 'Show travel expenses'],
        },
        {
          name: 'get_budgets',
          description: 'List budgets with utilization.',
          parameters: [
            { name: 'category', type: 'enum', description: 'Filter by category', enumValues: ['office', 'travel', 'software', 'marketing', 'payroll', 'utilities', 'other'], required: false },
            { name: 'isActive', type: 'boolean', description: 'Only active', required: false },
            { name: 'limit', type: 'number', description: 'Page size', required: false, default: 50 },
            { name: 'offset', type: 'number', description: 'Page offset', required: false, default: 0 },
          ],
          returns: 'Budget[]',
          examples: ['List active budgets', 'Show marketing budget'],
        },
        {
          name: 'get_pnl',
          description: 'Latest P&L statement.',
          parameters: [
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
            { name: 'format', type: 'enum', description: 'Format', enumValues: ['summary', 'detailed'], required: false, default: 'summary' },
          ],
          returns: 'PnLStatement',
          examples: ['Show P&L for last month'],
        },
        {
          name: 'get_cash_flow',
          description: 'Cash flow summary (inflows, outflows, net).',
          parameters: [
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
          ],
          returns: 'CashFlow',
          examples: ['Show cash flow for Q1'],
        },
        {
          name: 'get_spending_by_category',
          description: 'Spending breakdown by category.',
          parameters: [
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
          ],
          returns: 'CategorySpending[]',
          examples: ['Show spending by category'],
        },
      ],
    },
    // ── 17. SETTINGS ────────────────────────────────────────────────────────
    {
      module: 'settings',
      description: 'Business configuration — profile, branding, team, integrations.',
      actions: [
        {
          name: 'update_profile',
          description: 'Update business profile information.',
          parameters: [
            { name: 'name', type: 'string', description: 'Business name', required: false },
            { name: 'timezone', type: 'string', description: 'Timezone', required: false },
            { name: 'currency', type: 'string', description: 'Currency code', required: false },
            { name: 'language', type: 'string', description: 'Language', required: false },
            { name: 'industry', type: 'string', description: 'Industry', required: false },
          ],
          requiresApproval: false,
          examples: ['Update business timezone to America/New_York'],
        },
        {
          name: 'update_branding',
          description: 'Update business branding (logo, colors, fonts).',
          parameters: [
            { name: 'primaryColor', type: 'string', description: 'Primary brand color (hex)', required: false },
            { name: 'logoUrl', type: 'string', description: 'Logo image URL', required: false },
            { name: 'faviconUrl', type: 'string', description: 'Favicon URL', required: false },
          ],
          requiresApproval: false,
          examples: ['Update primary color to #FF5733'],
        },
        {
          name: 'add_team_member',
          description: 'Add a team member to the business.',
          parameters: [
            { name: 'email', type: 'string', description: 'Email address', required: true },
            { name: 'role', type: 'enum', description: 'Role', enumValues: ['admin', 'manager', 'editor', 'viewer'], required: true },
            { name: 'firstName', type: 'string', description: 'First name', required: false },
            { name: 'lastName', type: 'string', description: 'Last name', required: false },
          ],
          requiresApproval: false,
          examples: ['Add jane@example.com as manager'],
        },
        {
          name: 'remove_team_member',
          description: 'Remove a team member.',
          parameters: [
            { name: 'userId', type: 'id', description: 'User UUID', required: true },
          ],
          requiresApproval: true,
          examples: ['Remove user USR-001 from team'],
        },
        {
          name: 'update_role',
          description: 'Update a team member role.',
          parameters: [
            { name: 'userId', type: 'id', description: 'User UUID', required: true },
            { name: 'role', type: 'enum', description: 'New role', enumValues: ['admin', 'manager', 'editor', 'viewer'], required: true },
          ],
          requiresApproval: false,
          examples: ['Change Jane to admin'],
        },
        {
          name: 'configure_integration',
          description: 'Configure a third-party integration.',
          parameters: [
            { name: 'integration', type: 'enum', description: 'Integration name', enumValues: ['stripe', 'paypal', 'zapier', 'slack', 'google', 'hubspot', 'salesforce'], required: true },
            { name: 'config', type: 'object', description: 'Integration config', required: true },
            { name: 'enabled', type: 'boolean', description: 'Enable/disable', required: false, default: true },
          ],
          requiresApproval: false,
          examples: ['Configure Stripe integration with API key'],
        },
      ],
      queries: [
        {
          name: 'get_profile',
          description: 'Business profile information.',
          parameters: [],
          returns: 'BusinessProfile',
          examples: ['Show business profile'],
        },
        {
          name: 'get_team',
          description: 'List team members with roles.',
          parameters: [],
          returns: 'TeamMember[]',
          examples: ['Show team members'],
        },
        {
          name: 'get_integrations',
          description: 'List configured integrations.',
          parameters: [],
          returns: 'Integration[]',
          examples: ['What integrations are configured?'],
        },
        {
          name: 'get_audit_log',
          description: 'Business-level audit log.',
          parameters: [
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
            { name: 'userId', type: 'id', description: 'Filter by user', required: false },
            { name: 'action', type: 'string', description: 'Filter by action', required: false },
            { name: 'limit', type: 'number', description: 'Page size', required: false, default: 50 },
          ],
          returns: 'AuditEntry[]',
          examples: ['Show audit log', 'What did Jane do yesterday?'],
        },
        {
          name: 'get_usage_stats',
          description: 'Business usage statistics (API calls, storage, seats).',
          parameters: [],
          returns: 'UsageStats',
          examples: ['Show usage stats'],
        },
      ],
    },
    // ── 19. KEYSTORE ────────────────────────────────────────────────────────
    {
      module: 'keystore',
      description: 'Service marketplace for human-powered deliverables — content, design, development, marketing, consulting.',
      actions: [
        {
          name: 'create_service_order',
          description: 'Request a service from the KeyFlowOS marketplace.',
          parameters: [
            { name: 'listingId', type: 'id', description: 'UUID of the service listing', required: true },
            { name: 'pricingTier', type: 'string', description: 'Selected pricing tier name', required: true },
            { name: 'briefAnswers', type: 'array', description: 'Answers to service brief questions', required: false },
            { name: 'selectedAddons', type: 'array', description: 'Selected addon services', required: false },
            { name: 'notes', type: 'string', description: 'Additional notes', required: false },
            { name: 'contactId', type: 'id', description: 'Associated contact UUID', required: false },
          ],
          requiresApproval: false,
          examples: ['Order a blog post from the content creation service', 'Request logo design from the marketplace'],
        },
        {
          name: 'cancel_service_order',
          description: 'Cancel a pending service order.',
          parameters: [
            { name: 'orderId', type: 'id', description: 'UUID of the order', required: true },
            { name: 'reason', type: 'string', description: 'Cancellation reason', required: false },
          ],
          requiresApproval: false,
          examples: ['Cancel my blog post order', 'Withdraw the design request'],
        },
        {
          name: 'accept_service_quote',
          description: 'Accept a quoted price for a service order.',
          parameters: [
            { name: 'orderId', type: 'id', description: 'UUID of the order', required: true },
            { name: 'notes', type: 'string', description: 'Optional notes', required: false },
          ],
          requiresApproval: false,
          examples: ['Accept the quote for my website project', 'Approve the content creation price'],
        },
        {
          name: 'rate_service_order',
          description: 'Rate a completed service delivery.',
          parameters: [
            { name: 'orderId', type: 'id', description: 'UUID of the order', required: true },
            { name: 'rating', type: 'number', description: 'Rating 1-5', required: true },
            { name: 'review', type: 'string', description: 'Written review', required: false },
          ],
          requiresApproval: false,
          examples: ['Rate my blog post delivery 5 stars', 'Leave a review for the logo design'],
        },
        {
          name: 'send_order_message',
          description: 'Send a message on a service order thread.',
          parameters: [
            { name: 'orderId', type: 'id', description: 'UUID of the order', required: true },
            { name: 'message', type: 'string', description: 'Message text', required: true },
            { name: 'attachments', type: 'array', description: 'File attachments', required: false },
          ],
          requiresApproval: false,
          examples: ['Send a message on order abc123', 'Ask about the delivery timeline'],
        },
        {
          name: 'list_service_listings',
          description: 'Browse available service listings.',
          parameters: [
            { name: 'categoryId', type: 'id', description: 'Filter by category', required: false },
          ],
          requiresApproval: false,
          examples: ['What services are available?', 'Show me content creation services'],
        },
        {
          name: 'get_service_categories',
          description: 'List all service categories.',
          parameters: [],
          requiresApproval: false,
          examples: ['What service categories do you have?', 'Show marketplace categories'],
        },
      ],
      queries: [
        {
          name: 'get_user_orders',
          description: 'List service orders for the current user.',
          parameters: [],
          returns: 'KeystoreServiceOrder[]',
          examples: ['Show my orders', 'What services have I requested?'],
        },
        {
          name: 'get_order_details',
          description: 'Get detailed information about a service order.',
          parameters: [
            { name: 'orderId', type: 'id', description: 'UUID of the order', required: true },
          ],
          returns: 'KeystoreServiceOrder with messages',
          examples: ['Show details of order abc123', 'What is the status of my blog post order?'],
        },
        {
          name: 'get_order_stats',
          description: 'Get marketplace statistics.',
          parameters: [],
          returns: 'OrderStats',
          examples: ['Show marketplace stats', 'How many orders have been placed?'],
        },
        {
          name: 'get_service_categories',
          description: 'List all active service categories.',
          parameters: [],
          returns: 'KeystoreServiceCategory[]',
          examples: ['What categories are available?', 'List service categories'],
        },
        {
          name: 'list_service_listings',
          description: 'Browse available service listings.',
          parameters: [
            { name: 'categoryId', type: 'id', description: 'Filter by category', required: false },
          ],
          returns: 'KeystoreServiceListing[]',
          examples: ['What services are offered?', 'Show design services'],
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
          examples: ['Log that invoice INV-001 was paid'],
        },
        {
          name: 'log_bulk_activity',
          description: 'Record multiple activity events in a batch.',
          parameters: [
            { name: 'events', type: 'array', description: 'Activity events [{entityType, entityId, action, description?}]', required: true },
          ],
          requiresApproval: false,
          examples: ['Bulk log 50 contact imports'],
        },
        {
          name: 'create_audit_note',
          description: 'Add a manual audit note to an entity timeline.',
          parameters: [
            { name: 'entityType', type: 'enum', description: 'Entity type', enumValues: ['contact', 'invoice', 'booking', 'project', 'task', 'automation', 'user'], required: true },
            { name: 'entityId', type: 'id', description: 'Entity UUID', required: true },
            { name: 'note', type: 'string', description: 'Audit note text', required: true },
            { name: 'importance', type: 'enum', description: 'Importance level', enumValues: ['low', 'medium', 'high', 'critical'], required: false, default: 'medium' },
          ],
          requiresApproval: false,
          examples: ['Add audit note: manual data correction performed'],
        },
        {
          name: 'export_audit_log',
          description: 'Export the audit log to CSV or JSON.',
          parameters: [
            { name: 'dateFrom', type: 'date', description: 'Start date', required: true },
            { name: 'dateTo', type: 'date', description: 'End date', required: true },
            { name: 'entityType', type: 'enum', description: 'Filter by entity', enumValues: ['contact', 'invoice', 'booking', 'project', 'task', 'automation', 'user'], required: false },
            { name: 'format', type: 'enum', description: 'Export format', enumValues: ['csv', 'json'], required: false, default: 'csv' },
          ],
          requiresApproval: false,
          examples: ['Export audit log for January to CSV'],
        },
        {
          name: 'delete_old_logs',
          description: 'Purge activity logs older than a retention period.',
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