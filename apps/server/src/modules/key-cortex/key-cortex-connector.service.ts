          context.businessId,
          command.parameters.threadId as string,
          command.parameters.content as string,
        );
        return { success: true, data: reply };
      }

      case 'mark_read': {
        await this.inbox.markRead(
          context.businessId,
          command.parameters.messageId as string,
        );
        return { success: true, data: { marked: true } };
      }

      case 'pin_note': {
        const note = await this.inbox.pinNote(
          context.businessId,
          command.parameters.noteId as string,
        );
        return { success: true, data: note };
      }

      case 'create_task_from_note': {
        const task = await this.inbox.createTaskFromNote(
          context.businessId,
          command.parameters.noteId as string,
          {
            dueDate: command.parameters.dueDate
              ? new Date(command.parameters.dueDate as string)
              : undefined,
            assignee: command.parameters.assignee as string | undefined,
          },
        );
        return { success: true, data: task };
      }

      default: {
        return {
          success: false,
          error: `Unknown Inbox action: ${command.action}`,
        };
      }
    }
  }

  // ── Notifications ──────────────────────────────────────────────────────────
  private async executeNotificationsCommand(
    command: ConnectorCommand,
    context: { businessId: string; userId: string },
  ): Promise<ConnectorCommandResult> {
    switch (command.action) {
      case 'send_notification': {
        await this.notifications.sendNotification(context.businessId, {
          userId: command.parameters.userId as string,
          title: command.parameters.title as string,
          body: command.parameters.body as string,
          type: (command.parameters.type as string) ?? 'info',
          actionUrl: command.parameters.actionUrl as string | undefined,
          data: command.parameters.data as
            | Record<string, unknown>
            | undefined,
        });
        return { success: true, data: { sent: true } };
      }

      case 'mark_all_read': {
        await this.notifications.markAllRead(
          context.businessId,
          command.parameters.userId as string,
        );
        return { success: true, data: { marked: true } };
      }

      case 'configure_digest': {
        const digest = await this.notifications.configureDigest(
          context.businessId,
          command.parameters.userId as string,
          {
            frequency: command.parameters.frequency as string,
            time: command.parameters.time as string | undefined,
            categories: command.parameters.categories as string[] | undefined,
          },
        );
        return { success: true, data: digest };
      }

      default: {
        return {
          success: false,
          error: `Unknown Notifications action: ${command.action}`,
        };
      }
    }
  }

  // ── Projects ───────────────────────────────────────────────────────────────
  private async executeProjectsCommand(
    command: ConnectorCommand,
    context: { businessId: string; userId: string },
  ): Promise<ConnectorCommandResult> {
    switch (command.action) {
      case 'create_project': {
        const project = await this.projects.createProject(
          context.businessId,
          {
            name: command.parameters.name as string,
            description: command.parameters.description as string | undefined,
            status: (command.parameters.status as string) ?? 'planning',
            startDate: command.parameters.startDate
              ? new Date(command.parameters.startDate as string)
              : undefined,
            endDate: command.parameters.endDate
              ? new Date(command.parameters.endDate as string)
              : undefined,
            budget: command.parameters.budget as number | undefined,
            team: command.parameters.team as string[] | undefined,
            clientId: command.parameters.clientId as string | undefined,
          },
        );
        return { success: true, data: project };
      }

      case 'create_project_task': {
        const task = await this.projects.createTask(context.businessId, {
          projectId: command.parameters.projectId as string,
          title: command.parameters.title as string,
          description: command.parameters.description as string | undefined,
          assignee: command.parameters.assignee as string | undefined,
          dueDate: command.parameters.dueDate
            ? new Date(command.parameters.dueDate as string)
            : undefined,
          priority: (command.parameters.priority as string) ?? 'medium',
          status: (command.parameters.status as string) ?? 'todo',
        });
        return { success: true, data: task };
      }

      case 'update_project_status': {
        const project = await this.projects.updateStatus(
          context.businessId,
          command.parameters.projectId as string,
          command.parameters.status as string,
          command.parameters.note as string | undefined,
        );
        return { success: true, data: project };
      }

      case 'add_milestone': {
        const milestone = await this.projects.addMilestone(
          context.businessId,
          command.parameters.projectId as string,
          {
            name: command.parameters.name as string,
            targetDate: new Date(
              command.parameters.targetDate as string,
            ),
            description: command.parameters.description as string | undefined,
          },
        );
        return { success: true, data: milestone };
      }

      default: {
        return {
          success: false,
          error: `Unknown Projects action: ${command.action}`,
        };
      }
    }
  }

  // ── Activity ───────────────────────────────────────────────────────────────
  private async executeActivityCommand(
    command: ConnectorCommand,
    context: { businessId: string; userId: string },
  ): Promise<ConnectorCommandResult> {
    switch (command.action) {
      case 'log_activity': {
        const activity = await this.activity.logActivity(context.businessId, {
          action: command.parameters.action as string,
          entityType: command.parameters.entityType as string | undefined,
          entityId: command.parameters.entityId as string | undefined,
          metadata: command.parameters.metadata as
            | Record<string, unknown>
            | undefined,
        });
        return { success: true, data: activity };
      }

      default: {
        return {
          success: false,
          error: `Unknown Activity action: ${command.action}`,
        };
      }
    }
  }

  // ── Keystore ─────────────────────────────────────────────────────────────
  private async executeKeystoreCommand(command: ConnectorCommand, context: { businessId: string; userId: string }): Promise<ConnectorCommandResult> {
    switch (command.action) {
      case 'create_service_order': { const r = await this.keystore.createOrder(context.businessId, context.userId, { listingId: command.parameters.listingId as string, pricingTier: command.parameters.pricingTier as string, briefAnswers: command.parameters.briefAnswers as any, selectedAddons: command.parameters.selectedAddons as any, notes: command.parameters.notes as string, contactId: command.parameters.contactId as string }); return { success: true, data: r }; }
      case 'cancel_service_order': { const r = await this.keystore.cancelOrder(context.businessId, command.parameters.orderId as string, context.userId, command.parameters.reason as string); return { success: true, data: r }; }
      case 'accept_service_quote': { const r = await this.keystore.acceptQuote(context.businessId, command.parameters.orderId as string, context.userId, { notes: command.parameters.notes as string }); return { success: true, data: r }; }
      case 'rate_service_order': { const r = await this.keystore.rateOrder(context.businessId, command.parameters.orderId as string, context.userId, { rating: command.parameters.rating as number, review: command.parameters.review as string }); return { success: true, data: r }; }
      case 'send_order_message': { const r = await this.keystore.sendMessage(context.businessId, command.parameters.orderId as string, context.userId, { message: command.parameters.message as string, attachments: command.parameters.attachments as any }); return { success: true, data: r }; }
      case 'list_service_listings': { const r = await this.keystore.getListings(context.businessId, command.parameters.categoryId as string); return { success: true, data: r }; }
      case 'get_service_categories': { const r = await this.keystore.getCategories(context.businessId); return { success: true, data: r }; }
      default: { return { success: false, error: `Unknown Keystore action: ${command.action}` }; }
    }
  }

  private async queryKeystore(queryName: string, params: Record<string, unknown>): Promise<ConnectorDataResult> {
    const start = Date.now();
    try {
      switch (queryName) {
        case 'get_user_orders': { const r = await this.keystore.getUserOrders(params.businessId as string, params.userId as string); return { success: true, data: r, latencyMs: Date.now() - start }; }
        case 'get_order_details': { const r = await this.keystore.getOrder(params.businessId as string, params.orderId as string, params.userId as string); return { success: true, data: r, latencyMs: Date.now() - start }; }
        case 'get_order_stats': { const r = await this.keystore.getOrderStats(params.businessId as string); return { success: true, data: r, latencyMs: Date.now() - start }; }
        case 'get_service_categories': { const r = await this.keystore.getCategories(params.businessId as string); return { success: true, data: r, latencyMs: Date.now() - start }; }
        case 'list_service_listings': { const r = await this.keystore.getListings(params.businessId as string, params.categoryId as string); return { success: true, data: r, latencyMs: Date.now() - start }; }
        default: { return { success: false, error: `Unknown Keystore query: ${queryName}`, latencyMs: Date.now() - start }; }
      }
    } catch (error) { const m = error instanceof Error ? error.message : String(error); return { success: false, error: m, latencyMs: Date.now() - start }; }
  }

  // ==========================================================================
  // Per-Module Query Handlers
  // ==========================================================================

  // ── CRM ────────────────────────────────────────────────────────────────────
  private async queryCrm(
    queryName: string,
    params: Record<string, unknown>,
  ): Promise<ConnectorDataResult> {
    const start = Date.now();
    try {
      switch (queryName) {
        case 'list_contacts': {
          const contacts = await this.crm.listContacts(params.businessId as string, {
            limit: params.limit as number | undefined,
            offset: params.offset as number | undefined,
            status: params.status as string | undefined,
            tag: params.tag as string | undefined,
            search: params.search as string | undefined,
            source: params.source as string | undefined,
            sortBy: params.sortBy as string | undefined,
            sortOrder: params.sortOrder as string | undefined,
          });
          return { success: true, data: contacts, latencyMs: Date.now() - start };
        }

        case 'get_contact': {
          const contact = await this.crm.getContact(
            params.businessId as string,
            params.contactId as string,
          );
          return { success: true, data: contact, latencyMs: Date.now() - start };
        }

        case 'get_pipeline': {
          const pipeline = await this.crm.getPipeline(
            params.businessId as string,
            params.pipelineId as string | undefined,
          );
          return { success: true, data: pipeline, latencyMs: Date.now() - start };
        }

        case 'get_lead_sources': {
          const sources = await this.crm.getLeadSources(params.businessId as string);
          return { success: true, data: sources, latencyMs: Date.now() - start };
        }

        case 'get_follow_up_summary': {
          const summary = await this.crm.getFollowUpSummary(
            params.businessId as string,
            params.days as number | undefined,
          );
          return { success: true, data: summary, latencyMs: Date.now() - start };
        }

        default:
          return {
            success: false,
            error: `Unknown CRM query: ${queryName}`,
            latencyMs: Date.now() - start,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message, latencyMs: Date.now() - start };
    }
  }

  // ── Commerce ───────────────────────────────────────────────────────────────
  private async queryCommerce(
    queryName: string,
    params: Record<string, unknown>,
  ): Promise<ConnectorDataResult> {
    const start = Date.now();
    try {
      switch (queryName) {
        case 'list_invoices': {
          const invoices = await this.commerce.listInvoices(params.businessId as string, {
            limit: params.limit as number | undefined,
            status: params.status as string | undefined,
            clientId: params.clientId as string | undefined,
            dateFrom: params.dateFrom as string | undefined,
            dateTo: params.dateTo as string | undefined,
            minAmount: params.minAmount as number | undefined,
            maxAmount: params.maxAmount as number | undefined,
            sortBy: params.sortBy as string | undefined,
            sortOrder: params.sortOrder as string | undefined,
          });
          return { success: true, data: invoices, latencyMs: Date.now() - start };
        }

        case 'get_invoice': {
          const invoice = await this.commerce.getInvoice(
            params.businessId as string,
            params.invoiceId as string,
          );
          return { success: true, data: invoice, latencyMs: Date.now() - start };
        }

        case 'get_revenue_summary': {
          const summary = await this.commerce.getRevenueSummary(
            params.businessId as string,
            {
              period: params.period as string | undefined,
              dateFrom: params.dateFrom as string | undefined,
              dateTo: params.dateTo as string | undefined,
              clientId: params.clientId as string | undefined,
            },
          );
          return { success: true, data: summary, latencyMs: Date.now() - start };
        }

        case 'get_aging_report': {
          const report = await this.commerce.getAgingReport(
            params.businessId as string,
            params.asOfDate as string | undefined,
          );
          return { success: true, data: report, latencyMs: Date.now() - start };
        }

        case 'list_products': {
          const products = await this.commerce.listProducts(params.businessId as string, {
            limit: params.limit as number | undefined,
            category: params.category as string | undefined,
            search: params.search as string | undefined,
          });
          return { success: true, data: products, latencyMs: Date.now() - start };
        }

        default:
          return {
            success: false,
            error: `Unknown Commerce query: ${queryName}`,
            latencyMs: Date.now() - start,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message, latencyMs: Date.now() - start };
    }
  }

  // ── Bookings ───────────────────────────────────────────────────────────────
  private async queryBookings(
    queryName: string,
    params: Record<string, unknown>,
  ): Promise<ConnectorDataResult> {
    const start = Date.now();
    try {
      switch (queryName) {
        case 'list_bookings': {
          const bookings = await this.bookings.listBookings(params.businessId as string, {
            limit: params.limit as number | undefined,
            status: params.status as string | undefined,
            dateFrom: params.dateFrom as string | undefined,
            dateTo: params.dateTo as string | undefined,
            clientId: params.clientId as string | undefined,
          });
          return { success: true, data: bookings, latencyMs: Date.now() - start };
        }

        case 'get_booking': {
          const booking = await this.bookings.getBooking(
            params.businessId as string,
            params.bookingId as string,
          );
          return { success: true, data: booking, latencyMs: Date.now() - start };
        }

        case 'get_upcoming_bookings': {
          const upcoming = await this.bookings.getUpcomingBookings(
            params.businessId as string,
            params.days as number | undefined,
          );
          return { success: true, data: upcoming, latencyMs: Date.now() - start };
        }

        case 'get_availability_slots': {
          const slots = await this.bookings.getAvailabilitySlots(
            params.businessId as string,
            new Date(params.date as string),
            params.durationMinutes as number,
          );
          return { success: true, data: slots, latencyMs: Date.now() - start };
        }

        case 'get_booking_stats': {
          const stats = await this.bookings.getBookingStats(
            params.businessId as string,
            {
              dateFrom: params.dateFrom as string | undefined,
              dateTo: params.dateTo as string | undefined,
            },
          );
          return { success: true, data: stats, latencyMs: Date.now() - start };
        }

        default:
          return {
            success: false,
            error: `Unknown Bookings query: ${queryName}`,
            latencyMs: Date.now() - start,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message, latencyMs: Date.now() - start };
    }
  }

  // ── Content ────────────────────────────────────────────────────────────────
  private async queryContent(
    queryName: string,
    params: Record<string, unknown>,
  ): Promise<ConnectorDataResult> {
    const start = Date.now();
    try {
      switch (queryName) {
        case 'list_posts': {
          const posts = await this.content.listPosts(params.businessId as string, {
            limit: params.limit as number | undefined,
            status: params.status as string | undefined,
            tag: params.tag as string | undefined,
          });
          return { success: true, data: posts, latencyMs: Date.now() - start };
        }

        case 'list_social_posts': {
          const posts = await this.content.listSocialPosts(params.businessId as string, {
            limit: params.limit as number | undefined,
            platform: params.platform as string | undefined,
          });
          return { success: true, data: posts, latencyMs: Date.now() - start };
        }

        case 'get_seo_score': {
          const score = await this.content.getSeoScore(
            params.businessId as string,
            params.contentId as string,
          );
          return { success: true, data: score, latencyMs: Date.now() - start };
        }

        case 'get_content_analytics': {
          const analytics = await this.content.getContentAnalytics(
            params.businessId as string,
            {
              dateFrom: params.dateFrom as string | undefined,
              dateTo: params.dateTo as string | undefined,
            },
          );
          return { success: true, data: analytics, latencyMs: Date.now() - start };
        }

        default:
          return {
            success: false,
            error: `Unknown Content query: ${queryName}`,
            latencyMs: Date.now() - start,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message, latencyMs: Date.now() - start };
    }
  }

  // ── Communications ─────────────────────────────────────────────────────────
  private async queryCommunications(
    queryName: string,
    params: Record<string, unknown>,
  ): Promise<ConnectorDataResult> {
    const start = Date.now();
    try {
      switch (queryName) {
        case 'list_sequences': {
          const sequences = await this.communications.listSequences(params.businessId as string, {
            limit: params.limit as number | undefined,
            status: params.status as string | undefined,
          });
          return { success: true, data: sequences, latencyMs: Date.now() - start };
        }

        case 'list_templates': {
          const templates = await this.communications.listTemplates(params.businessId as string, {
            limit: params.limit as number | undefined,
            type: params.type as string | undefined,
          });
          return { success: true, data: templates, latencyMs: Date.now() - start };
        }

        case 'get_campaign_analytics': {
          const analytics = await this.communications.getCampaignAnalytics(
            params.businessId as string,
            params.campaignId as string,
          );
          return { success: true, data: analytics, latencyMs: Date.now() - start };
        }

        case 'get_email_stats': {
          const stats = await this.communications.getEmailStats(
            params.businessId as string,
            {
              dateFrom: params.dateFrom as string | undefined,
              dateTo: params.dateTo as string | undefined,
            },
          );
          return { success: true, data: stats, latencyMs: Date.now() - start };
        }

        default:
          return {
            success: false,
            error: `Unknown Communications query: ${queryName}`,
            latencyMs: Date.now() - start,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message, latencyMs: Date.now() - start };
    }
  }

  // ── Flow ───────────────────────────────────────────────────────────────────
  private async queryFlow(
    queryName: string,
    params: Record<string, unknown>,
  ): Promise<ConnectorDataResult> {
    const start = Date.now();
    try {
      switch (queryName) {
        case 'list_flows': {
          const flows = await this.flow.listFlows(params.businessId as string, {
            limit: params.limit as number | undefined,
            status: params.status as string | undefined,
          });
          return { success: true, data: flows, latencyMs: Date.now() - start };
        }

        case 'get_flow': {
          const flow = await this.flow.getFlow(
            params.businessId as string,
            params.flowId as string,
          );
          return { success: true, data: flow, latencyMs: Date.now() - start };
        }

        case 'get_flow_execution_log': {
          const log = await this.flow.getFlowExecutionLog(
            params.businessId as string,
            params.flowId as string,
            params.limit as number | undefined,
          );
          return { success: true, data: log, latencyMs: Date.now() - start };
        }

        default:
          return {
            success: false,
            error: `Unknown Flow query: ${queryName}`,
            latencyMs: Date.now() - start,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message, latencyMs: Date.now() - start };
    }
  }

  // ── Autopilot ──────────────────────────────────────────────────────────────
  private async queryAutopilot(
    queryName: string,
    params: Record<string, unknown>,
  ): Promise<ConnectorDataResult> {
    const start = Date.now();
    try {
      switch (queryName) {
        case 'list_loops': {
          const loops = await this.autopilot.listLoops(params.businessId as string, {
            limit: params.limit as number | undefined,
            status: params.status as string | undefined,
          });
          return { success: true, data: loops, latencyMs: Date.now() - start };
        }

        case 'get_loop': {
          const loop = await this.autopilot.getLoop(
            params.businessId as string,
            params.loopId as string,
          );
          return { success: true, data: loop, latencyMs: Date.now() - start };
        }

        case 'list_monitors': {
          const monitors = await this.autopilot.listMonitors(params.businessId as string, {
            limit: params.limit as number | undefined,
            status: params.status as string | undefined,
          });
          return { success: true, data: monitors, latencyMs: Date.now() - start };
        }

        case 'get_execution_log': {
          const log = await this.autopilot.getExecutionLog(params.businessId as string, {
            limit: params.limit as number | undefined,
            entityType: params.entityType as string | undefined,
            status: params.status as string | undefined,
          });
          return { success: true, data: log, latencyMs: Date.now() - start };
        }

        default:
          return {
            success: false,
            error: `Unknown Autopilot query: ${queryName}`,
            latencyMs: Date.now() - start,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message, latencyMs: Date.now() - start };
    }
  }

  // ── Temporal ───────────────────────────────────────────────────────────────
  private async queryTemporal(
    queryName: string,
    params: Record<string, unknown>,
  ): Promise<ConnectorDataResult> {
    const start = Date.now();
    try {
      switch (queryName) {
        case 'search_memories': {
          const memories = await this.temporal.searchMemories(
            params.businessId as string,
            {
              query: params.query as string,
              limit: params.limit as number | undefined,
              category: params.category as string | undefined,
            },
          );
          return { success: true, data: memories, latencyMs: Date.now() - start };
        }

        case 'get_memory_categories': {
          const categories = await this.temporal.getMemoryCategories(
            params.businessId as string,
          );
          return { success: true, data: categories, latencyMs: Date.now() - start };
        }

        case 'rag_query': {
          const result = await this.temporal.ragQuery(
            params.businessId as string,
            {
              documentSetId: params.documentSetId as string,
              question: params.question as string,
              limit: params.limit as number | undefined,
            },
          );
          return { success: true, data: result, latencyMs: Date.now() - start };
        }

        default:
          return {
            success: false,
            error: `Unknown Temporal query: ${queryName}`,
            latencyMs: Date.now() - start,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message, latencyMs: Date.now() - start };
    }
  }

  // ── Inbox ──────────────────────────────────────────────────────────────────
  private async queryInbox(
    queryName: string,
    params: Record<string, unknown>,
  ): Promise<ConnectorDataResult> {
    const start = Date.now();
    try {
      switch (queryName) {
        case 'get_inbox': {
          const inbox = await this.inbox.getInbox(params.businessId as string, {
            limit: params.limit as number | undefined,
            type: params.type as string | undefined,
            unreadOnly: params.unreadOnly as boolean | undefined,
          });
          return { success: true, data: inbox, latencyMs: Date.now() - start };
        }

        case 'get_thread': {
          const thread = await this.inbox.getThread(
            params.businessId as string,
            params.threadId as string,
          );
          return { success: true, data: thread, latencyMs: Date.now() - start };
        }

        case 'search_notes': {
          const notes = await this.inbox.searchNotes(
            params.businessId as string,
            {
              query: params.query as string,
              limit: params.limit as number | undefined,
            },
          );
          return { success: true, data: notes, latencyMs: Date.now() - start };
        }

        case 'get_unread_count': {
          const count = await this.inbox.getUnreadCount(params.businessId as string);
          return { success: true, data: { count }, latencyMs: Date.now() - start };
        }

        default:
          return {
            success: false,
            error: `Unknown Inbox query: ${queryName}`,
            latencyMs: Date.now() - start,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message, latencyMs: Date.now() - start };
    }
  }

  // ── Notifications ──────────────────────────────────────────────────────────
  private async queryNotifications(
    queryName: string,
    params: Record<string, unknown>,
  ): Promise<ConnectorDataResult> {
    const start = Date.now();
    try {
      switch (queryName) {
        case 'list_notifications': {
          const notifications = await this.notifications.listNotifications(
            params.businessId as string,
            {
              userId: params.userId as string,
              limit: params.limit as number | undefined,
              unreadOnly: params.unreadOnly as boolean | undefined,
            },
          );
          return { success: true, data: notifications, latencyMs: Date.now() - start };
        }

        case 'get_notification_preferences': {
          const prefs = await this.notifications.getNotificationPreferences(
            params.businessId as string,
            params.userId as string,
          );
          return { success: true, data: prefs, latencyMs: Date.now() - start };
        }

        case 'get_unread_count': {
          const count = await this.notifications.getUnreadCount(
            params.businessId as string,
            params.userId as string,
          );
          return { success: true, data: { count }, latencyMs: Date.now() - start };
        }

        default:
          return {
            success: false,
            error: `Unknown Notifications query: ${queryName}`,
            latencyMs: Date.now() - start,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message, latencyMs: Date.now() - start };
    }
  }

  // ── Projects ───────────────────────────────────────────────────────────────
  private async queryProjects(
    queryName: string,
    params: Record<string, unknown>,
  ): Promise<ConnectorDataResult> {
    const start = Date.now();
    try {
      switch (queryName) {
        case 'list_projects': {
          const projects = await this.projects.listProjects(params.businessId as string, {
            limit: params.limit as number | undefined,
            status: params.status as string | undefined,
            clientId: params.clientId as string | undefined,
          });
          return { success: true, data: projects, latencyMs: Date.now() - start };
        }

        case 'get_project': {
          const project = await this.projects.getProject(
            params.businessId as string,
            params.projectId as string,
          );
          return { success: true, data: project, latencyMs: Date.now() - start };
        }

        case 'get_project_tasks': {
          const tasks = await this.projects.getProjectTasks(
            params.businessId as string,
            params.projectId as string,
            params.status as string | undefined,
          );
          return { success: true, data: tasks, latencyMs: Date.now() - start };
        }

        case 'get_project_timeline': {
          const timeline = await this.projects.getProjectTimeline(
            params.businessId as string,
            params.projectId as string,
          );
          return { success: true, data: timeline, latencyMs: Date.now() - start };
        }

        default:
          return {
            success: false,
            error: `Unknown Projects query: ${queryName}`,
            latencyMs: Date.now() - start,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message, latencyMs: Date.now() - start };
    }
  }

  // ── Activity ───────────────────────────────────────────────────────────────
  private async queryActivity(
    queryName: string,
    params: Record<string, unknown>,
  ): Promise<ConnectorDataResult> {
    const start = Date.now();
    try {
      switch (queryName) {
        case 'get_activity_feed': {
          const feed = await this.activity.getActivityFeed(params.businessId as string, {
            limit: params.limit as number | undefined,
            entityType: params.entityType as string | undefined,
            entityId: params.entityId as string | undefined,
            dateFrom: params.dateFrom as string | undefined,
            dateTo: params.dateTo as string | undefined,
          });
          return { success: true, data: feed, latencyMs: Date.now() - start };
        }

        case 'get_audit_log': {
          const log = await this.activity.getAuditLog(params.businessId as string, {
            limit: params.limit as number | undefined,
            userId: params.userId as string | undefined,
            actionType: params.actionType as string | undefined,
            dateFrom: params.dateFrom as string | undefined,
            dateTo: params.dateTo as string | undefined,
          });
          return { success: true, data: log, latencyMs: Date.now() - start };
        }

        case 'get_entity_timeline': {
          const timeline = await this.activity.getEntityTimeline(
            params.businessId as string,
            params.entityType as string,
            params.entityId as string,
          );
          return { success: true, data: timeline, latencyMs: Date.now() - start };
        }

        default:
          return {
            success: false,
            error: `Unknown Activity query: ${queryName}`,
            latencyMs: Date.now() - start,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message, latencyMs: Date.now() - start };
    }
  }

  // ==========================================================================
  // Result Wrapper
  // ==========================================================================

  /**
   * Wrap a raw data object into a ConnectorCommandResult with latency.
   */
  private wrapResult(
    data: unknown,
    latencyMs: number,
  ): ConnectorCommandResult {
    return {
      success: true,
      data,
      latencyMs,
    };
  }
}