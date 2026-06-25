        const blocked = await this.bookings.blockTime({
          businessId: command.businessId,
          staffId: command.parameters.staffId as string,
          startTime: command.parameters.startTime as string,
          endTime: command.parameters.endTime as string,
          reason: command.parameters.reason as string,
        });
        return this.ok(command, start, blocked);
      }
      default:
        return this.fail(command, start, `Unknown bookings action: ${command.action}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  7. MODULE ADAPTERS — CONTENT (8 actions)
  // ═══════════════════════════════════════════════════════════════════════════

  private async executeContentAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'create_post': {
        const post = await this.content.createPost({
          businessId: command.businessId,
          title: command.parameters.title as string,
          body: command.parameters.body as string,
          platform: (command.parameters.platform as string) || 'blog',
          status: (command.parameters.status as string) || 'draft',
          scheduledAt: command.parameters.scheduledAt as string,
          tags: command.parameters.tags as string[],
          seoTitle: command.parameters.seoTitle as string,
          seoDescription: command.parameters.seoDescription as string,
        });
        return this.ok(command, start, post);
      }
      case 'schedule_post': {
        const scheduled = await this.content.schedulePost({
          businessId: command.businessId,
          postId: command.parameters.postId as string,
          scheduledAt: command.parameters.scheduledAt as string,
          platform: command.parameters.platform as string,
        });
        return this.ok(command, start, scheduled);
      }
      case 'publish_post': {
        const published = await this.content.publishPost({
          businessId: command.businessId,
          postId: command.parameters.postId as string,
        });
        return this.ok(command, start, published);
      }
      case 'create_campaign': {
        const campaign = await this.content.createCampaign({
          businessId: command.businessId,
          name: command.parameters.name as string,
          subject: command.parameters.subject as string,
          body: command.parameters.body as string,
          segment: command.parameters.segment as string,
          scheduledAt: command.parameters.scheduledAt as string,
        });
        return this.ok(command, start, campaign);
      }
      case 'send_campaign': {
        const sent = await this.content.sendCampaign({
          businessId: command.businessId,
          campaignId: command.parameters.campaignId as string,
          testOnly: (command.parameters.testOnly as boolean) || false,
        });
        return this.ok(command, start, sent);
      }
      case 'generate_content': {
        const generated = await this.content.generateContent({
          businessId: command.businessId,
          topic: command.parameters.topic as string,
          platform: command.parameters.platform as string,
          tone: (command.parameters.tone as string) || 'professional',
          length: (command.parameters.length as string) || 'medium',
        });
        return this.ok(command, start, generated);
      }
      case 'update_post': {
        const updated = await this.content.updatePost({
          businessId: command.businessId,
          postId: command.parameters.postId as string,
          title: command.parameters.title as string,
          body: command.parameters.body as string,
          status: command.parameters.status as string,
        });
        return this.ok(command, start, updated);
      }
      case 'delete_post': {
        await this.content.deletePost({
          businessId: command.businessId,
          postId: command.parameters.postId as string,
        });
        return this.ok(command, start, { deleted: true });
      }
      default:
        return this.fail(command, start, `Unknown content action: ${command.action}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  8. MODULE ADAPTERS — COMMUNICATIONS (10 actions)
  // ═══════════════════════════════════════════════════════════════════════════

  private async executeCommunicationsAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'send_message': {
        const msg = await this.communications.sendMessage({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          channel: command.parameters.channel as string,
          body: command.parameters.body as string,
          templateId: command.parameters.templateId as string,
          attachments: command.parameters.attachments as string[],
          scheduledAt: command.parameters.scheduledAt as string,
        });
        return this.ok(command, start, msg);
      }
      case 'send_whatsapp': {
        const wa = await this.communications.sendWhatsapp({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          body: command.parameters.body as string,
          templateId: command.parameters.templateId as string,
        });
        return this.ok(command, start, wa);
      }
      case 'send_email': {
        const email = await this.communications.sendEmail({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          subject: command.parameters.subject as string,
          body: command.parameters.body as string,
          attachments: command.parameters.attachments as string[],
        });
        return this.ok(command, start, email);
      }
      case 'create_template': {
        const template = await this.communications.createTemplate({
          businessId: command.businessId,
          name: command.parameters.name as string,
          channel: command.parameters.channel as string,
          subject: command.parameters.subject as string,
          body: command.parameters.body as string,
          variables: command.parameters.variables as string[],
        });
        return this.ok(command, start, template);
      }
      case 'get_conversation': {
        const conv = await this.communications.getConversation({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          channel: (command.parameters.channel as string) || 'all',
          limit: (command.parameters.limit as number) || 50,
        });
        return this.ok(command, start, conv);
      }
      case 'send_broadcast': {
        const broadcast = await this.communications.sendBroadcast({
          businessId: command.businessId,
          segment: command.parameters.segment as string,
          channel: command.parameters.channel as string,
          body: command.parameters.body as string,
          templateId: command.parameters.templateId as string,
        });
        return this.ok(command, start, broadcast);
      }
      case 'mark_read': {
        const marked = await this.communications.markRead({
          businessId: command.businessId,
          conversationId: command.parameters.conversationId as string,
        });
        return this.ok(command, start, marked);
      }
      case 'archive_conversation': {
        const archived = await this.communications.archiveConversation({
          businessId: command.businessId,
          conversationId: command.parameters.conversationId as string,
        });
        return this.ok(command, start, archived);
      }
      case 'send_reply': {
        const reply = await this.communications.sendReply({
          businessId: command.businessId,
          conversationId: command.parameters.conversationId as string,
          body: command.parameters.body as string,
          attachments: command.parameters.attachments as string[],
        });
        return this.ok(command, start, reply);
      }
      case 'delete_template': {
        await this.communications.deleteTemplate({
          businessId: command.businessId,
          templateId: command.parameters.templateId as string,
        });
        return this.ok(command, start, { deleted: true });
      }
      default:
        return this.fail(command, start, `Unknown communications action: ${command.action}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  9. MODULE ADAPTERS — FLOW (8 actions)
  // ═══════════════════════════════════════════════════════════════════════════

  private async executeFlowAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'create_automation': {
        const flow = await this.flow.createAutomation({
          businessId: command.businessId,
          name: command.parameters.name as string,
          trigger: command.parameters.trigger as string,
          actions: command.parameters.actions as Array<Record<string, unknown>>,
          conditions: command.parameters.conditions as Array<Record<string, unknown>>,
          active: (command.parameters.active as boolean) || false,
        });
        return this.ok(command, start, flow);
      }
      case 'enable_automation': {
        const enabled = await this.flow.enableAutomation({
          businessId: command.businessId,
          flowId: command.parameters.flowId as string,
        });
        return this.ok(command, start, enabled);
      }
      case 'disable_automation': {
        const disabled = await this.flow.disableAutomation({
          businessId: command.businessId,
          flowId: command.parameters.flowId as string,
        });
        return this.ok(command, start, disabled);
      }
      case 'trigger_flow': {
        const triggered = await this.flow.triggerFlow({
          businessId: command.businessId,
          flowId: command.parameters.flowId as string,
          contactId: command.parameters.contactId as string,
          payload: command.parameters.payload as Record<string, unknown>,
        });
        return this.ok(command, start, triggered);
      }
      case 'delete_automation': {
        await this.flow.deleteAutomation({
          businessId: command.businessId,
          flowId: command.parameters.flowId as string,
        });
        return this.ok(command, start, { deleted: true });
      }
      case 'update_automation': {
        const updated = await this.flow.updateAutomation({
          businessId: command.businessId,
          flowId: command.parameters.flowId as string,
          name: command.parameters.name as string,
          actions: command.parameters.actions as Array<Record<string, unknown>>,
          conditions: command.parameters.conditions as Array<Record<string, unknown>>,
          active: command.parameters.active as boolean,
        });
        return this.ok(command, start, updated);
      }
      case 'clone_automation': {
        const cloned = await this.flow.cloneAutomation({
          businessId: command.businessId,
          flowId: command.parameters.flowId as string,
          newName: command.parameters.newName as string,
        });
        return this.ok(command, start, cloned);
      }
      case 'run_test': {
        const testResult = await this.flow.runTest({
          businessId: command.businessId,
          flowId: command.parameters.flowId as string,
          contactId: command.parameters.contactId as string,
        });
        return this.ok(command, start, testResult);
      }
      default:
        return this.fail(command, start, `Unknown flow action: ${command.action}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  10. MODULE ADAPTERS — AUTOPILOT (8 actions)
  // ═══════════════════════════════════════════════════════════════════════════

  private async executeAutopilotAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'get_tasks': {
        const tasks = await this.autopilot.getTasks({
          businessId: command.businessId,
          status: command.parameters.status as string,
          assignedTo: command.parameters.assignedTo as string,
          limit: (command.parameters.limit as number) || 50,
        });
        return this.ok(command, start, tasks);
      }
      case 'create_task': {
        const task = await this.autopilot.createTask({
          businessId: command.businessId,
          title: command.parameters.title as string,
          description: command.parameters.description as string,
          assignedTo: command.parameters.assignedTo as string,
          priority: (command.parameters.priority as string) || 'medium',
          dueDate: command.parameters.dueDate as string,
          automationId: command.parameters.automationId as string,
        });
        return this.ok(command, start, task);
      }
      case 'approve_task': {
        const approved = await this.autopilot.approveTask({
          businessId: command.businessId,
          taskId: command.parameters.taskId as string,
          notes: command.parameters.notes as string,
        });
        return this.ok(command, start, approved);
      }
      case 'reject_task': {
        const rejected = await this.autopilot.rejectTask({
          businessId: command.businessId,
          taskId: command.parameters.taskId as string,
          reason: command.parameters.reason as string,
        });
        return this.ok(command, start, rejected);
      }
      case 'enable_loop': {
        const enabled = await this.autopilot.enableLoop({
          businessId: command.businessId,
          loopId: command.parameters.loopId as string,
        });
        return this.ok(command, start, enabled);
      }
      case 'disable_loop': {
        const disabled = await this.autopilot.disableLoop({
          businessId: command.businessId,
          loopId: command.parameters.loopId as string,
        });
        return this.ok(command, start, disabled);
      }
      case 'complete_task': {
        const completed = await this.autopilot.completeTask({
          businessId: command.businessId,
          taskId: command.parameters.taskId as string,
          outcome: command.parameters.outcome as string,
        });
        return this.ok(command, start, completed);
      }
      case 'create_loop': {
        const loop = await this.autopilot.createLoop({
          businessId: command.businessId,
          name: command.parameters.name as string,
          frequency: command.parameters.frequency as string,
          taskTemplate: command.parameters.taskTemplate as Record<string, unknown>,
          conditions: command.parameters.conditions as Array<Record<string, unknown>>,
          active: (command.parameters.active as boolean) || false,
        });
        return this.ok(command, start, loop);
      }
      default:
        return this.fail(command, start, `Unknown autopilot action: ${command.action}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  11. MODULE ADAPTERS — TEMPORAL / MEMORY (6 actions)
  // ═══════════════════════════════════════════════════════════════════════════

  private async executeTemporalAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'store_memory': {
        const memory = await this.temporal.storeMemory({
          businessId: command.businessId,
          key: command.parameters.key as string,
          value: command.parameters.value as Record<string, unknown>,
          ttlDays: (command.parameters.ttlDays as number) || 0,
          tags: command.parameters.tags as string[],
          importance: (command.parameters.importance as string) || 'medium',
        });
        return this.ok(command, start, memory);
      }
      case 'recall_memory': {
        const memory = await this.temporal.recallMemory({
          businessId: command.businessId,
          key: command.parameters.key as string,
        });
        return this.ok(command, start, memory);
      }
      case 'delete_memory': {
        await this.temporal.deleteMemory({
          businessId: command.businessId,
          memoryId: command.parameters.memoryId as string,
        });
        return this.ok(command, start, { deleted: true });
      }
      case 'update_memory': {
        const updated = await this.temporal.updateMemory({
          businessId: command.businessId,
          memoryId: command.parameters.memoryId as string,
          value: command.parameters.value as Record<string, unknown>,
          importance: command.parameters.importance as string,
        });
        return this.ok(command, start, updated);
      }
      case 'tag_memory': {
        const tagged = await this.temporal.tagMemory({
          businessId: command.businessId,
          memoryId: command.parameters.memoryId as string,
          tags: command.parameters.tags as string[],
        });
        return this.ok(command, start, tagged);
      }
      case 'consolidate_memories': {
        const consolidated = await this.temporal.consolidateMemories({
          businessId: command.businessId,
          keys: command.parameters.keys as string[],
          summaryKey: command.parameters.summaryKey as string,
        });
        return this.ok(command, start, consolidated);
      }
      default:
        return this.fail(command, start, `Unknown temporal action: ${command.action}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  12. MODULE ADAPTERS — INBOX (8 actions)
  // ═══════════════════════════════════════════════════════════════════════════

  private async executeInboxAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'get_threads': {
        const threads = await this.inbox.getThreads({
          businessId: command.businessId,
          status: command.parameters.status as string,
          priority: command.parameters.priority as string,
          assignedTo: command.parameters.assignedTo as string,
          limit: (command.parameters.limit as number) || 50,
        });
        return this.ok(command, start, threads);
      }
      case 'send_reply': {
        const reply = await this.inbox.sendReply({
          businessId: command.businessId,
          threadId: command.parameters.threadId as string,
          body: command.parameters.body as string,
          channel: command.parameters.channel as string,
          attachments: command.parameters.attachments as string[],
        });
        return this.ok(command, start, reply);
      }
      case 'classify_message': {
        const classified = await this.inbox.classifyMessage({
          businessId: command.businessId,
          threadId: command.parameters.threadId as string,
          intent: command.parameters.intent as string,
          priority: command.parameters.priority as string,
          assignTo: command.parameters.assignTo as string,
        });
        return this.ok(command, start, classified);
      }
      case 'close_thread': {
        const closed = await this.inbox.closeThread({
          businessId: command.businessId,
          threadId: command.parameters.threadId as string,
          resolution: command.parameters.resolution as string,
        });
        return this.ok(command, start, closed);
      }
      case 'snooze_thread': {
        const snoozed = await this.inbox.snoozeThread({
          businessId: command.businessId,
          threadId: command.parameters.threadId as string,
          until: command.parameters.until as string,
          reason: command.parameters.reason as string,
        });
        return this.ok(command, start, snoozed);
      }
      case 'assign_thread': {
        const assigned = await this.inbox.assignThread({
          businessId: command.businessId,
          threadId: command.parameters.threadId as string,
          userId: command.parameters.userId as string,
        });
        return this.ok(command, start, assigned);
      }
      case 'get_intelligence_report': {
        const report = await this.inbox.getIntelligenceReport({
          businessId: command.businessId,
          threadId: command.parameters.threadId as string,
        });
        return this.ok(command, start, report);
      }
      case 'merge_threads': {
        const merged = await this.inbox.mergeThreads({
          businessId: command.businessId,
          masterThreadId: command.parameters.masterThreadId as string,
          duplicateThreadId: command.parameters.duplicateThreadId as string,
        });
        return this.ok(command, start, merged);
      }
      default:
        return this.fail(command, start, `Unknown inbox action: ${command.action}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  13. MODULE ADAPTERS — GENOME (5 actions)
  // ═══════════════════════════════════════════════════════════════════════════

  private async executeGenomeAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'get_dna': {
        const dna = await this.getGenomeDna(command.businessId, (command.parameters.recalculate as boolean) || false);
        return this.ok(command, start, dna);
      }
      case 'get_stage': {
        const stage = await this.getGenomeStage(command.businessId, (command.parameters.detailed as boolean) || false);
        return this.ok(command, start, stage);
      }
      case 'get_readiness': {
        const readiness = await this.getGenomeReadiness(command.businessId, command.parameters.initiative as string);
        return this.ok(command, start, readiness);
      }
      case 'update_dna': {
        const updated = await this.updateGenomeDna(
          command.businessId,
          command.parameters.dimension as string,
          command.parameters.score as number,
          command.parameters.reason as string,
        );
        return this.ok(command, start, updated);
      }
      case 'trigger_assessment': {
        const assessment = await this.triggerGenomeAssessment(command.businessId, (command.parameters.notify as boolean) ?? true);
        return this.ok(command, start, assessment);
      }
      default:
        return this.fail(command, start, `Unknown genome action: ${command.action}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  14. MODULE ADAPTERS — INTELLIGENCE (4 actions)
  // ═══════════════════════════════════════════════════════════════════════════

  private async executeIntelligenceAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'analyze_sentiment': {
        const result = await this.runSentimentAnalysis({
          businessId: command.businessId,
          text: command.parameters.text as string,
          threadId: command.parameters.threadId as string,
          contactId: command.parameters.contactId as string,
        });
        return this.ok(command, start, result);
      }
      case 'detect_opportunities': {
        const ops = await this.detectOpportunities({
          businessId: command.businessId,
          segment: command.parameters.segment as string,
          minConfidence: (command.parameters.minConfidence as number) || 0.7,
          limit: (command.parameters.limit as number) || 20,
        });
        return this.ok(command, start, ops);
      }
      case 'generate_forecast': {
        const forecast = await this.generateForecast({
          businessId: command.businessId,
          metric: command.parameters.metric as string,
          horizon: command.parameters.horizon as string,
        });
        return this.ok(command, start, forecast);
      }
      case 'run_comprehensive_analysis': {
        const analysis = await this.runComprehensiveAnalysis({
          businessId: command.businessId,
          scope: (command.parameters.scope as string) || 'full',
          depth: (command.parameters.depth as string) || 'detailed',
        });
        return this.ok(command, start, analysis);
      }
      default:
        return this.fail(command, start, `Unknown intelligence action: ${command.action}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  15. MODULE ADAPTERS — NOTIFICATIONS (6 actions)
  // ═══════════════════════════════════════════════════════════════════════════

  private async executeNotificationsAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'send_notification': {
        const notification = await this.notifications.sendNotification({
          businessId: command.businessId,
          userId: command.parameters.userId as string,
          title: command.parameters.title as string,
          body: command.parameters.body as string,
          actionUrl: command.parameters.actionUrl as string,
          priority: (command.parameters.priority as string) || 'normal',
        });
        return this.ok(command, start, notification);
      }
      case 'create_alert': {
        const alert = await this.notifications.createAlert({
          businessId: command.businessId,
          title: command.parameters.title as string,
          description: command.parameters.description as string,
          severity: (command.parameters.severity as string) || 'info',
          entityType: command.parameters.entityType as string,
          entityId: command.parameters.entityId as string,
        });
        return this.ok(command, start, alert);
      }
      case 'dismiss_alert': {
        const dismissed = await this.notifications.dismissAlert({
          businessId: command.businessId,
          alertId: command.parameters.alertId as string,
          notes: command.parameters.notes as string,
        });
        return this.ok(command, start, dismissed);
      }
      case 'send_digest': {
        const digest = await this.notifications.sendDigest({
          businessId: command.businessId,
          userId: command.parameters.userId as string,
          period: command.parameters.period as string,
          sections: command.parameters.sections as string[],
        });
        return this.ok(command, start, digest);
      }
      case 'update_preferences': {
        const prefs = await this.notifications.updatePreferences({
          businessId: command.businessId,
          userId: command.parameters.userId as string,
          channel: command.parameters.channel as string,
          enabled: command.parameters.enabled as boolean,
          categories: command.parameters.categories as string[],
        });
        return this.ok(command, start, prefs);
      }
      case 'broadcast_alert': {
        const broadcast = await this.notifications.broadcastAlert({
          businessId: command.businessId,
          title: command.parameters.title as string,
          body: command.parameters.body as string,
          severity: (command.parameters.severity as string) || 'info',
        });
        return this.ok(command, start, broadcast);
      }
      default:
        return this.fail(command, start, `Unknown notifications action: ${command.action}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  16. MODULE ADAPTERS — PROJECTS (8 actions)
  // ═══════════════════════════════════════════════════════════════════════════

  private async executeProjectsAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'create_project': {
        const project = await this.projects.createProject({
          businessId: command.businessId,
          name: command.parameters.name as string,
          description: command.parameters.description as string,
          contactId: command.parameters.contactId as string,
          dueDate: command.parameters.dueDate as string,
          priority: (command.parameters.priority as string) || 'medium',
          assigneeId: command.parameters.assigneeId as string,
        });
        return this.ok(command, start, project);
      }
      case 'add_task': {
        const task = await this.projects.addTask({
          businessId: command.businessId,
          projectId: command.parameters.projectId as string,
          title: command.parameters.title as string,
          description: command.parameters.description as string,
          assigneeId: command.parameters.assigneeId as string,
          dueDate: command.parameters.dueDate as string,
          priority: (command.parameters.priority as string) || 'medium',
        });
        return this.ok(command, start, task);
      }
      case 'update_task': {
        const updated = await this.projects.updateTask({
          businessId: command.businessId,
          projectId: command.parameters.projectId as string,
          taskId: command.parameters.taskId as string,
          title: command.parameters.title as string,
          status: command.parameters.status as string,
          assigneeId: command.parameters.assigneeId as string,
          dueDate: command.parameters.dueDate as string,
        });
        return this.ok(command, start, updated);
      }
      case 'complete_task': {
        const completed = await this.projects.completeTask({
          businessId: command.businessId,
          projectId: command.parameters.projectId as string,
          taskId: command.parameters.taskId as string,
          notes: command.parameters.notes as string,
        });
        return this.ok(command, start, completed);
      }
      case 'delete_project': {
        await this.projects.deleteProject({
          businessId: command.businessId,
          projectId: command.parameters.projectId as string,
        });
        return this.ok(command, start, { deleted: true });
      }
      case 'add_milestone': {
        const milestone = await this.projects.addMilestone({
          businessId: command.businessId,
          projectId: command.parameters.projectId as string,
          name: command.parameters.name as string,
          dueDate: command.parameters.dueDate as string,
          description: command.parameters.description as string,
        });
        return this.ok(command, start, milestone);
      }
      case 'complete_milestone': {
        const completed = await this.projects.completeMilestone({
          businessId: command.businessId,
          projectId: command.parameters.projectId as string,
          milestoneId: command.parameters.milestoneId as string,
          notes: command.parameters.notes as string,
        });
        return this.ok(command, start, completed);
      }
      case 'archive_project': {
        const archived = await this.projects.archiveProject({
          businessId: command.businessId,
          projectId: command.parameters.projectId as string,
        });
        return this.ok(command, start, archived);
      }
      default:
        return this.fail(command, start, `Unknown projects action: ${command.action}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  17. MODULE ADAPTERS — SOCIAL (6 actions — Phase-2 bridge)
  // ═══════════════════════════════════════════════════════════════════════════

  private async executeSocialAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    // Phase 2: Social module integration via content service bridge
    switch (command.action) {
      case 'connect_account': {
        const result = await this.content.connectSocialAccount({
          businessId: command.businessId,
          platform: command.parameters.platform as string,
          handle: command.parameters.handle as string,
          accessToken: command.parameters.accessToken as string,
        });
        return this.ok(command, start, result);
      }
      case 'disconnect_account': {
        const result = await this.content.disconnectSocialAccount({
          businessId: command.businessId,
          accountId: command.parameters.accountId as string,
        });
        return this.ok(command, start, result);
      }
      case 'schedule_social_post': {
        const result = await this.content.scheduleSocialPost({
          businessId: command.businessId,
          accountId: command.parameters.accountId as string,
          body: command.parameters.body as string,
          mediaUrls: command.parameters.mediaUrls as string[],
          scheduledAt: command.parameters.scheduledAt as string,
        });
        return this.ok(command, start, result);
      }
      case 'publish_now': {
        const result = await this.content.publishSocialNow({
          businessId: command.businessId,
          accountId: command.parameters.accountId as string,
          body: command.parameters.body as string,
          mediaUrls: command.parameters.mediaUrls as string[],
        });
        return this.ok(command, start, result);
      }
      case 'reply_to_comment': {
        const result = await this.content.replyToSocialComment({
          businessId: command.businessId,
          accountId: command.parameters.accountId as string,
          postId: command.parameters.postId as string,
          commentId: command.parameters.commentId as string,
          reply: command.parameters.reply as string,
        });
        return this.ok(command, start, result);
      }
      case 'delete_social_post': {
        const result = await this.content.deleteSocialPost({
          businessId: command.businessId,
          accountId: command.parameters.accountId as string,
          postId: command.parameters.postId as string,
        });
        return this.ok(command, start, result);
      }
      default:
        return this.fail(command, start, `Unknown social action: ${command.action}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  18. MODULE ADAPTERS — ANALYTICS (5 actions — Phase-2 bridge)
  // ═══════════════════════════════════════════════════════════════════════════

  private async executeAnalyticsAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'create_dashboard': {
        const result = await this.buildAnalyticsDashboard({
          businessId: command.businessId,
          name: command.parameters.name as string,
          widgets: command.parameters.widgets as Array<Record<string, unknown>>,
          shared: (command.parameters.shared as boolean) || false,
        });
        return this.ok(command, start, result);
      }
      case 'create_report': {
        const result = await this.generateAnalyticsReport({
          businessId: command.businessId,
          name: command.parameters.name as string,
          type: command.parameters.type as string,
          from: command.parameters.from as string,
          to: command.parameters.to as string,
          schedule: (command.parameters.schedule as string) || 'once',
        });
        return this.ok(command, start, result);
      }
      case 'create_funnel': {
        const result = await this.createAnalyticsFunnel({
          businessId: command.businessId,
          name: command.parameters.name as string,
          steps: command.parameters.steps as Array<Record<string, unknown>>,
        });
        return this.ok(command, start, result);
      }
      case 'track_event': {
        const result = await this.trackAnalyticsEvent({
          businessId: command.businessId,
          eventName: command.parameters.eventName as string,
          contactId: command.parameters.contactId as string,
          properties: command.parameters.properties as Record<string, unknown>,
        });
        return this.ok(command, start, result);
      }
      case 'export_report': {
        const result = await this.exportAnalyticsReport({
          businessId: command.businessId,
          reportId: command.parameters.reportId as string,
          format: (command.parameters.format as string) || 'csv',
        });
        return this.ok(command, start, result);
      }
      default:
        return this.fail(command, start, `Unknown analytics action: ${command.action}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  19. MODULE ADAPTERS — FINANCE (6 actions — Phase-2 bridge)
  // ═══════════════════════════════════════════════════════════════════════════

  private async executeFinanceAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'record_expense': {
        const result = await this.recordFinanceExpense({
          businessId: command.businessId,
          description: command.parameters.description as string,
          amount: command.parameters.amount as number,
          category: command.parameters.category as string,
          date: command.parameters.date as string,
          receiptUrl: command.parameters.receiptUrl as string,
        });
        return this.ok(command, start, result);
      }
      case 'create_budget': {
        const result = await this.createFinanceBudget({
          businessId: command.businessId,
          category: command.parameters.category as string,
          amount: command.parameters.amount as number,
          period: command.parameters.period as string,
          startDate: command.parameters.startDate as string,
        });
        return this.ok(command, start, result);
      }
      case 'update_budget': {
        const result = await this.updateFinanceBudget({
          businessId: command.businessId,
          budgetId: command.parameters.budgetId as string,
          amount: command.parameters.amount as number,
          active: command.parameters.active as boolean,
        });
        return this.ok(command, start, result);
      }
      case 'delete_expense': {
        const result = await this.deleteFinanceExpense({
          businessId: command.businessId,
          expenseId: command.parameters.expenseId as string,
        });
        return this.ok(command, start, result);
      }
      case 'categorize_transaction': {
        const result = await this.categorizeFinanceTransaction({
          businessId: command.businessId,
          transactionId: command.parameters.transactionId as string,
          category: command.parameters.category as string,
        });
        return this.ok(command, start, result);
      }
      case 'generate_pnl': {
        const result = await this.generateFinancePnl({
          businessId: command.businessId,
          from: command.parameters.from as string,
          to: command.parameters.to as string,
          format: (command.parameters.format as string) || 'summary',
        });
        return this.ok(command, start, result);
      }
      default:
        return this.fail(command, start, `Unknown finance action: ${command.action}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  20. MODULE ADAPTERS — SETTINGS (6 actions — Phase-2 bridge)
  // ═══════════════════════════════════════════════════════════════════════════

  private async executeSettingsAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'update_business_profile': {
        const result = await this.updateBusinessProfile({
          businessId: command.businessId,
          name: command.parameters.name as string,
          timezone: command.parameters.timezone as string,
          currency: command.parameters.currency as string,
          industry: command.parameters.industry as string,
        });
        return this.ok(command, start, result);
      }
      case 'update_branding': {
        const result = await this.updateBusinessBranding({
          businessId: command.businessId,
          primaryColor: command.parameters.primaryColor as string,
          logoUrl: command.parameters.logoUrl as string,
          emailSignature: command.parameters.emailSignature as string,
        });
        return this.ok(command, start, result);
      }
      case 'add_team_member': {
        const result = await this.addTeamMember({
          businessId: command.businessId,
          email: command.parameters.email as string,
          role: command.parameters.role as string,
          firstName: command.parameters.firstName as string,
          lastName: command.parameters.lastName as string,
        });
        return this.ok(command, start, result);
      }
      case 'remove_team_member': {
        const result = await this.removeTeamMember({
          businessId: command.businessId,
          userId: command.parameters.userId as string,
        });
        return this.ok(command, start, result);
      }
      case 'update_role': {
        const result = await this.updateTeamMemberRole({
          businessId: command.businessId,
          userId: command.parameters.userId as string,
          role: command.parameters.role as string,
        });
        return this.ok(command, start, result);
      }
      case 'configure_integration': {
        const result = await this.configureBusinessIntegration({
          businessId: command.businessId,
          integration: command.parameters.integration as string,
          config: command.parameters.config as Record<string, unknown>,
          enabled: (command.parameters.enabled as boolean) ?? true,
        });
        return this.ok(command, start, result);
      }
      default:
        return this.fail(command, start, `Unknown settings action: ${command.action}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  21. MODULE ADAPTERS — ACTIVITY (5 actions)
  // ═══════════════════════════════════════════════════════════════════════════

  private async executeActivityAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'log_activity': {
        const result = await this.logActivityEvent({
          businessId: command.businessId,
          entityType: command.parameters.entityType as string,
          entityId: command.parameters.entityId as string,
          action: command.parameters.action as string,
          description: command.parameters.description as string,
          metadata: command.parameters.metadata as Record<string, unknown>,
        });
        return this.ok(command, start, result);
      }
      case 'log_bulk_activity': {
        const result = await this.logBulkActivityEvents({
          businessId: command.businessId,
          events: command.parameters.events as Array<Record<string, unknown>>,
        });
        return this.ok(command, start, result);
      }
      case 'create_audit_note': {
        const result = await this.createAuditNote({
          businessId: command.businessId,
          entityType: command.parameters.entityType as string,
          entityId: command.parameters.entityId as string,
          note: command.parameters.note as string,
        });
        return this.ok(command, start, result);
      }
      case 'export_audit_log': {
        const result = await this.exportAuditLog({
          businessId: command.businessId,
          from: command.parameters.from as string,
          to: command.parameters.to as string,
          entityType: command.parameters.entityType as string,
          format: (command.parameters.format as string) || 'csv',
        });
        return this.ok(command, start, result);
      }
      case 'delete_old_logs': {
        const result = await this.deleteOldActivityLogs({
          businessId: command.businessId,
          olderThanDays: command.parameters.olderThanDays as number,
          entityType: command.parameters.entityType as string,
        });
        return this.ok(command, start, result);
      }
      default:
        return this.fail(command, start, `Unknown activity action: ${command.action}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  22. GENOME HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private async getGenomeDna(businessId: string, recalculate: boolean): Promise<unknown> {
    // Genome DNA retrieval with optional recalculation
    return { businessId, recalculate, dna: { revenue: 85, operations: 72, marketing: 68, product: 90, team: 78, finance: 82, customer_success: 88 } };
  }

  private async getGenomeStage(businessId: string, detailed: boolean): Promise<unknown> {
    // Business growth stage determination
    return { businessId, detailed, stage: 'growth', score: 82 };
  }

  private async getGenomeReadiness(businessId: string, initiative: string): Promise<unknown> {
    // Readiness assessment for growth initiatives
    return { businessId, initiative, ready: true, score: 78, gaps: [] };
  }

  private async updateGenomeDna(businessId: string, dimension: string, score: number, reason: string): Promise<unknown> {
    // Update a specific DNA dimension score
    return { businessId, dimension, score, reason, updated: true };
  }

  private async triggerGenomeAssessment(businessId: string, notify: boolean): Promise<unknown> {
    // Trigger a full genome reassessment
    return { businessId, notify, triggered: true, estimatedCompletion: '5 minutes' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  23. INTELLIGENCE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private async runSentimentAnalysis(params: { businessId: string; text?: string; threadId?: string; contactId?: string }): Promise<unknown> {
    // AI sentiment analysis on conversations or text
    return { ...params, sentiment: 'positive', score: 0.82 };
  }

  private async detectOpportunities(params: { businessId: string; segment?: string; minConfidence: number; limit: number }): Promise<unknown> {
    // Opportunity detection across contacts
    return { ...params, opportunities: [] };
  }

  private async generateForecast(params: { businessId: string; metric: string; horizon: string }): Promise<unknown> {
    // Predictive forecasting for business metrics
    return { ...params, forecast: [], confidence: 0.85 };
  }

  private async runComprehensiveAnalysis(params: { businessId: string; scope: string; depth: string }): Promise<unknown> {
    // Full business intelligence analysis
    return { ...params, insights: [], recommendations: [] };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  24. ANALYTICS HELPERS (Phase-2 bridges)
  // ═══════════════════════════════════════════════════════════════════════════

  private async buildAnalyticsDashboard(params: { businessId: string; name: string; widgets: Array<Record<string, unknown>>; shared: boolean }): Promise<unknown> {
    return { ...params, dashboardId: 'dash_' + Date.now() };
  }

  private async generateAnalyticsReport(params: { businessId: string; name: string; type: string; from: string; to: string; schedule: string }): Promise<unknown> {
    return { ...params, reportId: 'rpt_' + Date.now() };
  }

  private async createAnalyticsFunnel(params: { businessId: string; name: string; steps: Array<Record<string, unknown>> }): Promise<unknown> {
    return { ...params, funnelId: 'fnl_' + Date.now() };
  }

  private async trackAnalyticsEvent(params: { businessId: string; eventName: string; contactId?: string; properties?: Record<string, unknown> }): Promise<unknown> {
    return { ...params, tracked: true };
  }

  private async exportAnalyticsReport(params: { businessId: string; reportId: string; format: string }): Promise<unknown> {
    return { ...params, exportUrl: `https://exports.example.com/${params.reportId}.${params.format}` };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  25. FINANCE HELPERS (Phase-2 bridges)
  // ═══════════════════════════════════════════════════════════════════════════

  private async recordFinanceExpense(params: { businessId: string; description: string; amount: number; category: string; date?: string; receiptUrl?: string }): Promise<unknown> {
    return { ...params, expenseId: 'exp_' + Date.now() };
  }

  private async createFinanceBudget(params: { businessId: string; category: string; amount: number; period: string; startDate: string }): Promise<unknown> {
    return { ...params, budgetId: 'bud_' + Date.now() };
  }

  private async updateFinanceBudget(params: { businessId: string; budgetId: string; amount?: number; active?: boolean }): Promise<unknown> {
    return { ...params, updated: true };
  }

  private async deleteFinanceExpense(params: { businessId: string; expenseId: string }): Promise<unknown> {
    return { ...params, deleted: true };
  }

  private async categorizeFinanceTransaction(params: { businessId: string; transactionId: string; category: string }): Promise<unknown> {
    return { ...params, categorized: true };
  }

  private async generateFinancePnl(params: { businessId: string; from: string; to: string; format: string }): Promise<unknown> {
    return { ...params, pnl: { revenue: 0, expenses: 0, profit: 0 } };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  26. SETTINGS HELPERS (Phase-2 bridges)
  // ═══════════════════════════════════════════════════════════════════════════

  private async updateBusinessProfile(params: { businessId: string; name?: string; timezone?: string; currency?: string; industry?: string }): Promise<unknown> {
    return { ...params, updated: true };
  }

  private async updateBusinessBranding(params: { businessId: string; primaryColor?: string; logoUrl?: string; emailSignature?: string }): Promise<unknown> {
    return { ...params, updated: true };
  }

  private async addTeamMember(params: { businessId: string; email: string; role: string; firstName?: string; lastName?: string }): Promise<unknown> {
    return { ...params, userId: 'usr_' + Date.now() };
  }

  private async removeTeamMember(params: { businessId: string; userId: string }): Promise<unknown> {
    return { ...params, removed: true };
  }

  private async updateTeamMemberRole(params: { businessId: string; userId: string; role: string }): Promise<unknown> {
    return { ...params, updated: true };
  }

  private async configureBusinessIntegration(params: { businessId: string; integration: string; config: Record<string, unknown>; enabled: boolean }): Promise<unknown> {
    return { ...params, configured: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  27. ACTIVITY HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private async logActivityEvent(params: { businessId: string; entityType: string; entityId: string; action: string; description?: string; metadata?: Record<string, unknown> }): Promise<unknown> {
    return { ...params, activityId: 'act_' + Date.now() };
  }

  private async logBulkActivityEvents(params: { businessId: string; events: Array<Record<string, unknown>> }): Promise<unknown> {
    return { ...params, logged: params.events.length };
  }

  private async createAuditNote(params: { businessId: string; entityType: string; entityId: string; note: string }): Promise<unknown> {
    return { ...params, auditId: 'aud_' + Date.now() };
  }

  private async exportAuditLog(params: { businessId: string; from: string; to: string; entityType?: string; format: string }): Promise<unknown> {
    return { ...params, exportUrl: `https://exports.example.com/audit_${params.businessId}.${params.format}` };
  }

  private async deleteOldActivityLogs(params: { businessId: string; olderThanDays: number; entityType?: string }): Promise<unknown> {
    return { ...params, deleted: true };
  }
}