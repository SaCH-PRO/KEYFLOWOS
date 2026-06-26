-- KEY Cortex & Connector missing models migration
-- Generated: 2026-06-26

-- Cortex sessions
CREATE TABLE IF NOT EXISTS cortex_sessions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    persona TEXT NOT NULL DEFAULT 'jarvis',
    voice TEXT NOT NULL DEFAULT 'echo',
    mood TEXT NOT NULL DEFAULT 'focused',
    preferred_provider TEXT NOT NULL DEFAULT 'openai',
    title TEXT,
    messages JSONB DEFAULT '[]'::JSONB,
    context_snapshot JSONB,
    last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cortex_sessions_business_status ON cortex_sessions(business_id, status);
CREATE INDEX IF NOT EXISTS idx_cortex_sessions_business_last_accessed ON cortex_sessions(business_id, last_accessed_at);
CREATE INDEX IF NOT EXISTS idx_cortex_sessions_business_created ON cortex_sessions(business_id, created_at);

-- Cortex action logs
CREATE TABLE IF NOT EXISTS cortex_action_logs (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    session_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    status TEXT NOT NULL,
    description TEXT,
    result TEXT,
    error TEXT,
    requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
    estimated_impact TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cortex_action_logs_session_created ON cortex_action_logs(session_id, created_at);

-- KEY documents
CREATE TABLE IF NOT EXISTS key_documents (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_size INTEGER NOT NULL DEFAULT 0,
    storage_url TEXT,
    status TEXT NOT NULL DEFAULT 'processing',
    chunks_indexed INTEGER NOT NULL DEFAULT 0,
    metadata JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_key_documents_business_status ON key_documents(business_id, status);
CREATE INDEX IF NOT EXISTS idx_key_documents_business_created ON key_documents(business_id, created_at);

-- KEY evolution logs
CREATE TABLE IF NOT EXISTS key_evolution_logs (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    query TEXT NOT NULL,
    recommendation TEXT NOT NULL,
    recommendation_type TEXT NOT NULL,
    user_action TEXT NOT NULL,
    outcome TEXT,
    outcome_value DOUBLE PRECISION,
    metadata JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_key_evolution_logs_business_user_created ON key_evolution_logs(business_id, user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_key_evolution_logs_business_type ON key_evolution_logs(business_id, recommendation_type);
CREATE INDEX IF NOT EXISTS idx_key_evolution_logs_business_created ON key_evolution_logs(business_id, created_at);

-- KEY call sessions
CREATE TABLE IF NOT EXISTS key_call_sessions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    call_sid TEXT,
    phone_number TEXT NOT NULL,
    direction TEXT NOT NULL,
    status TEXT NOT NULL,
    script TEXT,
    transcript JSONB DEFAULT '[]'::JSONB,
    summary TEXT,
    sentiment TEXT,
    outcome TEXT,
    recording_url TEXT,
    duration_seconds INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_key_call_sessions_business_status ON key_call_sessions(business_id, status);
CREATE INDEX IF NOT EXISTS idx_key_call_sessions_business_created ON key_call_sessions(business_id, created_at);

-- KEY tuning logs
CREATE TABLE IF NOT EXISTS key_tuning_logs (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    adjustments JSONB NOT NULL DEFAULT '[]'::JSONB,
    summary TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_key_tuning_logs_business_created ON key_tuning_logs(business_id, created_at);

-- KEY user preferences
CREATE TABLE IF NOT EXISTS key_user_preferences (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    response_length TEXT NOT NULL DEFAULT 'medium',
    preferred_tone TEXT NOT NULL DEFAULT 'professional',
    active_recommendation_types JSONB NOT NULL DEFAULT '[]'::JSONB,
    ignored_recommendation_types JSONB NOT NULL DEFAULT '[]'::JSONB,
    peak_activity_hours JSONB NOT NULL DEFAULT '[]'::JSONB,
    preferred_communication_style TEXT NOT NULL DEFAULT 'concise',
    acceptance_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_interactions INTEGER NOT NULL DEFAULT 0,
    last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(business_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_key_user_preferences_business_created ON key_user_preferences(business_id, created_at);

-- KEY interaction feedback
CREATE TABLE IF NOT EXISTS key_interaction_feedback (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    session_id TEXT NOT NULL,
    query TEXT NOT NULL,
    response TEXT NOT NULL,
    user_rating INTEGER,
    user_comment TEXT,
    actions_taken JSONB NOT NULL DEFAULT '[]'::JSONB,
    actions_skipped JSONB NOT NULL DEFAULT '[]'::JSONB,
    metadata JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_key_interaction_feedback_session_created ON key_interaction_feedback(session_id, created_at);

-- Sandbox execution logs
CREATE TABLE IF NOT EXISTS sandbox_execution_logs (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id TEXT,
    code TEXT NOT NULL,
    language TEXT NOT NULL,
    success BOOLEAN NOT NULL,
    error_type TEXT,
    error TEXT,
    output TEXT,
    execution_time_ms INTEGER NOT NULL DEFAULT 0,
    metadata JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sandbox_execution_logs_business_language ON sandbox_execution_logs(business_id, language);
CREATE INDEX IF NOT EXISTS idx_sandbox_execution_logs_business_success ON sandbox_execution_logs(business_id, success);
CREATE INDEX IF NOT EXISTS idx_sandbox_execution_logs_business_created ON sandbox_execution_logs(business_id, created_at);

-- AI approval requests
CREATE TABLE IF NOT EXISTS ai_approval_requests (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id TEXT,
    correlation_id TEXT NOT NULL,
    module TEXT NOT NULL,
    action TEXT NOT NULL,
    parameters JSONB DEFAULT '{}'::JSONB,
    command_json JSONB,
    status TEXT NOT NULL DEFAULT 'PENDING',
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    resolved_by TEXT,
    resolution TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_approval_requests_business_status ON ai_approval_requests(business_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_approval_requests_business_user ON ai_approval_requests(business_id, user_id);
CREATE INDEX IF NOT EXISTS idx_ai_approval_requests_correlation ON ai_approval_requests(correlation_id);
CREATE INDEX IF NOT EXISTS idx_ai_approval_requests_business_created ON ai_approval_requests(business_id, created_at);

-- Connector health logs
CREATE TABLE IF NOT EXISTS connector_health_logs (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    connection_id TEXT,
    provider_key TEXT NOT NULL,
    status TEXT NOT NULL,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_connector_health_logs_business_provider_checked ON connector_health_logs(business_id, provider_key, checked_at);
CREATE INDEX IF NOT EXISTS idx_connector_health_logs_business_status ON connector_health_logs(business_id, status);
CREATE INDEX IF NOT EXISTS idx_connector_health_logs_business_created ON connector_health_logs(business_id, created_at);

-- Sync jobs
CREATE TABLE IF NOT EXISTS sync_jobs (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    connection_id TEXT NOT NULL,
    provider_key TEXT NOT NULL,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'scheduled',
    direction TEXT NOT NULL DEFAULT 'bidirectional',
    records_read INTEGER NOT NULL DEFAULT 0,
    records_created INTEGER NOT NULL DEFAULT 0,
    records_updated INTEGER NOT NULL DEFAULT 0,
    records_failed INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    meta JSONB DEFAULT '{}'::JSONB,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_business_status ON sync_jobs(business_id, status);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_connection_started ON sync_jobs(connection_id, started_at);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_business_started ON sync_jobs(business_id, started_at);

-- Business settings
CREATE TABLE IF NOT EXISTS business_settings (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    business_id TEXT NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
    ai_autonomy_level TEXT NOT NULL DEFAULT 'supervised',
    ai_always_require_approval JSONB NOT NULL DEFAULT '[]'::JSONB,
    ai_never_require_approval JSONB NOT NULL DEFAULT '[]'::JSONB,
    ai_spending_threshold DOUBLE PRECISION,
    ai_action_spending_limits JSONB NOT NULL DEFAULT '{}'::JSONB,
    ai_max_auto_executions_per_hour INTEGER NOT NULL DEFAULT 100,
    preferences JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_business_settings_business ON business_settings(business_id);

-- Business genomes
CREATE TABLE IF NOT EXISTS business_genomes (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    business_id TEXT NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
    dna_scores JSONB NOT NULL DEFAULT '{}'::JSONB,
    stage TEXT NOT NULL DEFAULT 'seed',
    current_stage TEXT,
    stage_progress DOUBLE PRECISION NOT NULL DEFAULT 0,
    readiness_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    executive_readiness DOUBLE PRECISION NOT NULL DEFAULT 0,
    growth_trajectory TEXT NOT NULL DEFAULT 'stable',
    recommendations JSONB NOT NULL DEFAULT '[]'::JSONB,
    metadata JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_business_genomes_business ON business_genomes(business_id);

-- Activity logs
CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    description TEXT,
    user_id TEXT,
    metadata JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_logs_business_type ON activity_logs(business_id, type);
CREATE INDEX IF NOT EXISTS idx_activity_logs_business_created ON activity_logs(business_id, created_at);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    assignee_id TEXT,
    due_date TIMESTAMPTZ,
    priority TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'todo',
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tasks_business_status ON tasks(business_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_business_priority ON tasks(business_id, priority);
CREATE INDEX IF NOT EXISTS idx_tasks_business_due_date ON tasks(business_id, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_business_created ON tasks(business_id, created_at);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    recipient_id TEXT NOT NULL,
    content TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'in_app',
    direction TEXT NOT NULL DEFAULT 'outbound',
    status TEXT NOT NULL DEFAULT 'sent',
    read BOOLEAN NOT NULL DEFAULT FALSE,
    sent_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_business_direction ON messages(business_id, direction);
CREATE INDEX IF NOT EXISTS idx_messages_business_status ON messages(business_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_business_created ON messages(business_id, created_at);

-- Flow definitions
CREATE TABLE IF NOT EXISTS flow_definitions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    nodes JSONB NOT NULL DEFAULT '[]'::JSONB,
    edges JSONB NOT NULL DEFAULT '[]'::JSONB,
    trigger JSONB NOT NULL DEFAULT '{}'::JSONB,
    status TEXT NOT NULL DEFAULT 'draft',
    category TEXT NOT NULL DEFAULT 'general',
    tags JSONB NOT NULL DEFAULT '[]'::JSONB,
    created_by TEXT,
    execution_count INTEGER NOT NULL DEFAULT 0,
    last_execution_at TIMESTAMPTZ,
    last_execution_status TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_flow_definitions_business_status ON flow_definitions(business_id, status);
CREATE INDEX IF NOT EXISTS idx_flow_definitions_business_category ON flow_definitions(business_id, category);
CREATE INDEX IF NOT EXISTS idx_flow_definitions_business_updated ON flow_definitions(business_id, updated_at);

-- Flow executions
CREATE TABLE IF NOT EXISTS flow_executions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    flow_id TEXT NOT NULL REFERENCES flow_definitions(id) ON DELETE CASCADE,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    current_node_id TEXT,
    context JSONB DEFAULT '{}'::JSONB,
    results JSONB DEFAULT '[]'::JSONB,
    error TEXT,
    parent_execution_id TEXT,
    iteration_index INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_flow_executions_business_status ON flow_executions(business_id, status);
CREATE INDEX IF NOT EXISTS idx_flow_executions_flow_started ON flow_executions(flow_id, started_at);
CREATE INDEX IF NOT EXISTS idx_flow_executions_business_created ON flow_executions(business_id, created_at);

-- Reports
CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    timeframe TEXT NOT NULL DEFAULT '30d',
    format TEXT NOT NULL DEFAULT 'pdf',
    status TEXT NOT NULL DEFAULT 'generating',
    result_url TEXT,
    metadata JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reports_business_status ON reports(business_id, status);
CREATE INDEX IF NOT EXISTS idx_reports_business_created ON reports(business_id, created_at);

-- Reminders
CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    trigger_time TIMESTAMPTZ NOT NULL,
    recipient_id TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled',
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reminders_business_status ON reminders(business_id, status);
CREATE INDEX IF NOT EXISTS idx_reminders_business_trigger ON reminders(business_id, trigger_time);
CREATE INDEX IF NOT EXISTS idx_reminders_business_created ON reminders(business_id, created_at);

-- Workflows
CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    module TEXT NOT NULL DEFAULT 'general',
    status TEXT NOT NULL DEFAULT 'active',
    trigger_type TEXT,
    steps JSONB NOT NULL DEFAULT '[]'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workflows_business_status ON workflows(business_id, status);
CREATE INDEX IF NOT EXISTS idx_workflows_business_module_status ON workflows(business_id, module, status);
CREATE INDEX IF NOT EXISTS idx_workflows_business_created ON workflows(business_id, created_at);

-- Documents
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'note',
    metadata JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_documents_business_type ON documents(business_id, type);
CREATE INDEX IF NOT EXISTS idx_documents_business_created ON documents(business_id, created_at);

-- Leads
CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    source TEXT NOT NULL DEFAULT 'cortex_ai',
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    estimated_value DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leads_business_status ON leads(business_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_business_email ON leads(business_id, email);
CREATE INDEX IF NOT EXISTS idx_leads_business_created ON leads(business_id, created_at);

-- Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    sent_count INTEGER NOT NULL DEFAULT 0,
    open_count INTEGER NOT NULL DEFAULT 0,
    click_count INTEGER NOT NULL DEFAULT 0,
    metadata JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_campaigns_business_status ON campaigns(business_id, status);
CREATE INDEX IF NOT EXISTS idx_campaigns_business_created ON campaigns(business_id, created_at);

-- Outbound campaigns
CREATE TABLE IF NOT EXISTS outbound_campaigns (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    metadata JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outbound_campaigns_business_status ON outbound_campaigns(business_id, status);
CREATE INDEX IF NOT EXISTS idx_outbound_campaigns_business_created ON outbound_campaigns(business_id, created_at);

-- Add campaign_id to outbound_content if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'outbound_content' AND column_name = 'campaign_id'
    ) THEN
        ALTER TABLE outbound_content ADD COLUMN campaign_id TEXT;
        ALTER TABLE outbound_content ADD CONSTRAINT outbound_content_campaign_fk
            FOREIGN KEY (campaign_id) REFERENCES outbound_campaigns(id) ON DELETE SET NULL;
        CREATE INDEX idx_outbound_content_campaign_id ON outbound_content(campaign_id);
    END IF;
END
$$;

-- CRM tasks
CREATE TABLE IF NOT EXISTS crm_tasks (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    due_date TIMESTAMPTZ,
    priority TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'todo',
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_business_status ON crm_tasks(business_id, status);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_business_contact ON crm_tasks(business_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_business_due_date ON crm_tasks(business_id, due_date);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_business_created ON crm_tasks(business_id, created_at);

-- CRM activities
CREATE TABLE IF NOT EXISTS crm_activities (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    description TEXT,
    metadata JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_activities_business_type ON crm_activities(business_id, type);
CREATE INDEX IF NOT EXISTS idx_crm_activities_business_contact ON crm_activities(business_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_business_created ON crm_activities(business_id, created_at);

-- Helpdesk tickets
CREATE TABLE IF NOT EXISTS helpdesk_tickets (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    requester_id TEXT,
    subject TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    priority TEXT NOT NULL DEFAULT 'medium',
    assigned_to TEXT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_helpdesk_tickets_business_status ON helpdesk_tickets(business_id, status);
CREATE INDEX IF NOT EXISTS idx_helpdesk_tickets_business_priority ON helpdesk_tickets(business_id, priority);
CREATE INDEX IF NOT EXISTS idx_helpdesk_tickets_business_created ON helpdesk_tickets(business_id, created_at);
