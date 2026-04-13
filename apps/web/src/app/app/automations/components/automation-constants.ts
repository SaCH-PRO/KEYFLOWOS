export const TRIGGER_GROUPS = [
  {
    group: "CRM / Clients",
    options: [
      { value: "contact.created", label: "Contact Created" },
      { value: "contact.updated", label: "Contact Updated" },
      { value: "contact.stage_changed", label: "Client Stage Changed" },
      { value: "contact.inactive", label: "Contact Inactive (30d)" },
      { value: "contact.no_activity_30d", label: "No Activity for 30 Days" },
      { value: "lead.scored", label: "Lead Score Changed" },
    ],
  },
  {
    group: "Commerce / Revenue",
    options: [
      { value: "invoice.paid", label: "Invoice Paid" },
      { value: "invoice.sent", label: "Invoice Sent" },
      { value: "invoice.overdue", label: "Invoice Overdue" },
      { value: "quote.sent", label: "Quote Sent" },
      { value: "quote.accepted", label: "Quote Accepted" },
      { value: "quote.viewed", label: "Quote Viewed" },
      { value: "quote.not_accepted_xdays", label: "Quote Not Accepted After X Days" },
      { value: "payment.received", label: "Payment Received" },
      { value: "recurring.failed", label: "Recurring Billing Failed" },
    ],
  },
  {
    group: "Bookings / Calendar",
    options: [
      { value: "booking.created", label: "Booking Created" },
      { value: "booking.confirmed", label: "Booking Confirmed" },
      { value: "booking.completed", label: "Booking Completed" },
      { value: "booking.cancelled", label: "Booking Cancelled" },
      { value: "booking.scheduled", label: "Booking Scheduled" },
      { value: "booking.reminder", label: "Booking Reminder (24h)" },
    ],
  },
  {
    group: "Content / Marketing",
    options: [
      { value: "campaign.sent", label: "Campaign Sent" },
      { value: "campaign.opened", label: "Campaign Opened" },
      { value: "campaign.not_opened_14d", label: "Campaign Not Opened (14d)" },
      { value: "post.published", label: "Post Published" },
      { value: "form.submitted", label: "Form Submitted" },
      { value: "subscriber.joined", label: "New Subscriber" },
      { value: "segment.changed", label: "Segment Changed" },
    ],
  },
  {
    group: "Staff / Operations",
    options: [
      { value: "staff.assignment_missing", label: "Staff Assignment Missing" },
    ],
  },
  {
    group: "Time-Based",
    options: [
      { value: "schedule.daily", label: "Daily (9 AM)" },
      { value: "schedule.weekly", label: "Weekly (Monday)" },
      { value: "schedule.monthly", label: "Monthly (1st)" },
    ],
  },
];

export const TRIGGER_OPTIONS = TRIGGER_GROUPS.flatMap((g) => g.options);

export const ACTION_GROUPS = [
  {
    group: "Communication",
    options: [
      { value: "send_email", label: "Send Email" },
      { value: "send_whatsapp", label: "Send WhatsApp" },
      { value: "send_sms", label: "Send SMS" },
      { value: "send_notification", label: "In-App Notification" },
      { value: "notify_staff", label: "Notify Staff" },
    ],
  },
  {
    group: "CRM Actions",
    options: [
      { value: "add_tag", label: "Add Tag" },
      { value: "update_contact", label: "Update Contact" },
      { value: "add_note", label: "Add Note" },
      { value: "move_pipeline", label: "Move Pipeline Stage" },
      { value: "update_segment", label: "Update Segment" },
      { value: "enroll_campaign", label: "Enroll in Campaign" },
      { value: "request_review", label: "Request Review" },
      { value: "log_timeline", label: "Log Timeline Event" },
    ],
  },
  {
    group: "Operations",
    options: [
      { value: "create_task", label: "Create Task" },
      { value: "create_invoice", label: "Create Invoice" },
      { value: "send_quote_reminder", label: "Send Quote Reminder" },
      { value: "update_status", label: "Update Status" },
      { value: "assign_staff", label: "Assign Staff Member" },
      { value: "create_content_draft", label: "Create Content Draft" },
    ],
  },
  {
    group: "Scheduling",
    options: [
      { value: "delay", label: "Wait / Delay" },
      { value: "schedule_followup", label: "Schedule Follow-up" },
      { value: "create_booking_followup", label: "Create Booking Follow-up" },
      { value: "schedule_reengagement", label: "Schedule Re-engagement" },
    ],
  },
];

export const ACTION_OPTIONS = ACTION_GROUPS.flatMap((g) => g.options);

export const CONDITION_OPTIONS = [
  { value: "", label: "Select condition..." },
  { value: "contact.has_email", label: "Contact has email" },
  { value: "contact.has_phone", label: "Contact has phone number" },
  { value: "contact.is_active", label: "Contact is active" },
  { value: "contact.is_new", label: "Contact was created in last 7 days" },
  { value: "contact.is_vip", label: "Contact is VIP" },
  { value: "contact.no_booking_30d", label: "No booking in last 30 days" },
  { value: "contact.cancelled_twice", label: "Booking cancelled twice" },
  { value: "contact.has_overdue_and_booking", label: "Has overdue invoice AND upcoming booking" },
  { value: "invoice.above_threshold", label: "Invoice total above TTD 500" },
  { value: "quote.specific_package", label: "Quote belongs to specific package" },
  { value: "booking.is_first", label: "First booking for contact" },
  { value: "payment.pending_no_reply", label: "Payment pending and no reply sent" },
  { value: "form.source_website", label: "Form source is website" },
  { value: "segment.stage_changed", label: "Audience segment = stage-changed" },
  { value: "campaign.not_opened_14d", label: "Campaign not opened in 14 days" },
  { value: "no_review_after_booking", label: "No review request sent after booking" },
  { value: "time.business_hours", label: "During business hours only" },
];

export type ActionStep = { type: string; config?: Record<string, string> };

export type FlowComplexity = "easy" | "medium" | "advanced";

export interface AutomationTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  trigger: string;
  actions: ActionStep[];
  businessProblem: string;
  modulesTouched: string[];
  prerequisites: string[];
  expectedOutcome: string;
  complexity: FlowComplexity;
}

export const MODULE_COLORS: Record<string, string> = {
  CRM: "hsl(var(--kf-info))",
  Clients: "hsl(var(--kf-info))",
  Revenue: "hsl(var(--kf-accent1))",
  Commerce: "hsl(var(--kf-accent1))",
  Bookings: "hsl(var(--kf-accent2))",
  Calendar: "hsl(var(--kf-accent2))",
  Content: "hsl(var(--kf-success))",
  Marketing: "hsl(var(--kf-success))",
  Tasks: "hsl(var(--kf-warning))",
  Staff: "hsl(var(--kf-info))",
  Forms: "hsl(var(--kf-accent2))",
  Segments: "hsl(var(--kf-success))",
};

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: "welcome-email",
    name: "Welcome New Contacts",
    description: "Send a welcome email when a new contact is added to your CRM.",
    category: "CRM",
    trigger: "contact.created",
    actions: [{ type: "send_email" }, { type: "add_tag", config: { tag: "new-contact" } }],
    businessProblem: "New leads receive no immediate acknowledgment",
    modulesTouched: ["CRM", "Content"],
    prerequisites: ["Email configured"],
    expectedOutcome: "Every new contact receives instant welcome, improving first impressions",
    complexity: "easy",
  },
  {
    id: "invoice-receipt",
    name: "Auto-Send Receipt",
    description: "Automatically send a payment receipt when an invoice is paid.",
    category: "Commerce",
    trigger: "invoice.paid",
    actions: [{ type: "send_email" }, { type: "create_task", config: { title: "Follow up with client" } }],
    businessProblem: "Manual receipt sending delays professional communication",
    modulesTouched: ["Revenue", "CRM", "Tasks"],
    prerequisites: ["Invoice system active"],
    expectedOutcome: "Instant professional receipts with automated follow-up task creation",
    complexity: "easy",
  },
  {
    id: "booking-reminder",
    name: "Booking Confirmation",
    description: "Send a confirmation message when a booking is confirmed.",
    category: "Bookings",
    trigger: "booking.confirmed",
    actions: [{ type: "send_email" }, { type: "send_whatsapp" }],
    businessProblem: "Clients forget appointments, increasing no-shows",
    modulesTouched: ["Bookings", "Content"],
    prerequisites: ["Booking system active"],
    expectedOutcome: "Reduce no-shows by 40% with instant multi-channel confirmation",
    complexity: "easy",
  },
  {
    id: "overdue-followup",
    name: "Overdue Invoice Follow-Up",
    description: "Create a follow-up task and notify when an invoice goes overdue.",
    category: "Commerce",
    trigger: "invoice.overdue",
    actions: [{ type: "create_task", config: { title: "Follow up on overdue invoice" } }, { type: "send_notification" }],
    businessProblem: "Overdue invoices go unnoticed, hurting cash flow",
    modulesTouched: ["Revenue", "Tasks"],
    prerequisites: ["Invoice system active"],
    expectedOutcome: "Never miss an overdue invoice — automatic task and alert within minutes",
    complexity: "easy",
  },
  {
    id: "lead-nurture",
    name: "Lead Form to CRM Pipeline",
    description: "When a form is submitted, create a contact and schedule a follow-up.",
    category: "Marketing",
    trigger: "form.submitted",
    actions: [{ type: "add_tag", config: { tag: "lead" } }, { type: "enroll_campaign" }, { type: "schedule_followup" }],
    businessProblem: "Leads from forms are not followed up promptly",
    modulesTouched: ["Forms", "CRM", "Content"],
    prerequisites: ["At least 1 form", "1 campaign"],
    expectedOutcome: "Auto-create contact, tag as lead, enroll in nurture campaign",
    complexity: "medium",
  },
  {
    id: "booking-followup",
    name: "Post-Booking Review Request",
    description: "After a booking is completed, send a feedback/review request email.",
    category: "Bookings",
    trigger: "booking.completed",
    actions: [{ type: "delay", config: { hours: "2" } }, { type: "send_email" }, { type: "request_review" }],
    businessProblem: "Clients leave without giving reviews or feedback",
    modulesTouched: ["Bookings", "CRM", "Content"],
    prerequisites: ["Booking system active"],
    expectedOutcome: "Automated review collection 2 hours after each completed booking",
    complexity: "medium",
  },
  {
    id: "campaign-tag",
    name: "Campaign Engagement Tag",
    description: "Tag contacts when a campaign is sent to track engagement.",
    category: "Marketing",
    trigger: "campaign.sent",
    actions: [{ type: "add_tag", config: { tag: "campaign-target" } }],
    businessProblem: "No way to track which contacts were targeted by campaigns",
    modulesTouched: ["Content", "CRM"],
    prerequisites: ["Campaign system active"],
    expectedOutcome: "Every campaign recipient is tagged for follow-up segmentation",
    complexity: "easy",
  },
  {
    id: "daily-summary",
    name: "Daily Business Summary",
    description: "Generate a daily summary notification of key metrics.",
    category: "Time-Based",
    trigger: "schedule.daily",
    actions: [{ type: "send_notification" }],
    businessProblem: "Owner lacks daily visibility into business performance",
    modulesTouched: ["Revenue", "CRM", "Bookings"],
    prerequisites: [],
    expectedOutcome: "Daily briefing at 9 AM with key business metrics",
    complexity: "easy",
  },
  {
    id: "booking-cancelled-reengagement",
    name: "Cancellation Re-engagement",
    description: "When a booking is cancelled, tag the contact and schedule a re-engagement follow-up.",
    category: "Bookings",
    trigger: "booking.cancelled",
    actions: [{ type: "add_tag", config: { tag: "cancelled" } }, { type: "schedule_reengagement" }, { type: "send_email" }],
    businessProblem: "Cancelled bookings lead to lost revenue with no recovery attempt",
    modulesTouched: ["Bookings", "CRM", "Content"],
    prerequisites: ["Booking system active"],
    expectedOutcome: "Automatic re-engagement attempt for every cancellation, recovering up to 20% of lost bookings",
    complexity: "medium",
  },
  {
    id: "new-subscriber-welcome",
    name: "New Subscriber Welcome",
    description: "Send a welcome email sequence when a new subscriber joins your list.",
    category: "Marketing",
    trigger: "subscriber.joined",
    actions: [{ type: "send_email" }, { type: "add_tag", config: { tag: "subscriber" } }],
    businessProblem: "New subscribers receive no onboarding communication",
    modulesTouched: ["Content", "CRM"],
    prerequisites: ["Email configured"],
    expectedOutcome: "Warm welcome for every subscriber, increasing engagement by 30%",
    complexity: "easy",
  },
  {
    id: "payment-received-thankyou",
    name: "Payment Thank You",
    description: "Send a thank-you email and in-app notification when a payment is received.",
    category: "Commerce",
    trigger: "payment.received",
    actions: [{ type: "send_email" }, { type: "send_notification" }],
    businessProblem: "Payments go unacknowledged, missing a relationship-building moment",
    modulesTouched: ["Revenue", "CRM"],
    prerequisites: ["Payment system active"],
    expectedOutcome: "Instant thank-you for every payment, building trust and loyalty",
    complexity: "easy",
  },
  {
    id: "quote-accepted-project",
    name: "Quote to Project",
    description: "When a quote is accepted, create a project task to begin delivery.",
    category: "Commerce",
    trigger: "quote.accepted",
    actions: [{ type: "create_task", config: { title: "Begin project delivery" } }, { type: "update_status" }, { type: "send_email" }],
    businessProblem: "Accepted quotes don't trigger delivery workflow automatically",
    modulesTouched: ["Revenue", "Tasks", "CRM"],
    prerequisites: ["Quote system active"],
    expectedOutcome: "Seamless quote-to-project handoff with automatic task creation",
    complexity: "medium",
  },
  {
    id: "inactive-contact-reminder",
    name: "Inactive Contact Outreach",
    description: "When a contact has been inactive for 30 days, schedule a check-in.",
    category: "CRM",
    trigger: "contact.inactive",
    actions: [{ type: "add_tag", config: { tag: "needs-attention" } }, { type: "schedule_followup" }],
    businessProblem: "Inactive clients silently churn without any retention attempt",
    modulesTouched: ["CRM", "Tasks"],
    prerequisites: [],
    expectedOutcome: "Proactive outreach to every dormant contact, reducing churn",
    complexity: "easy",
  },
  {
    id: "weekly-review",
    name: "Weekly Business Review",
    description: "Send a weekly performance summary every Monday morning.",
    category: "Time-Based",
    trigger: "schedule.weekly",
    actions: [{ type: "send_notification" }],
    businessProblem: "No regular cadence for reviewing business performance",
    modulesTouched: ["Revenue", "CRM", "Bookings"],
    prerequisites: [],
    expectedOutcome: "Weekly Monday briefing with revenue, clients, and bookings summary",
    complexity: "easy",
  },
  {
    id: "monthly-report",
    name: "Monthly Report Reminder",
    description: "Create a task on the 1st of each month to review and export reports.",
    category: "Time-Based",
    trigger: "schedule.monthly",
    actions: [{ type: "create_task", config: { title: "Review monthly reports" } }, { type: "send_notification" }],
    businessProblem: "Monthly reporting is forgotten or delayed",
    modulesTouched: ["Tasks"],
    prerequisites: [],
    expectedOutcome: "Monthly reminder with auto-created review task on the 1st",
    complexity: "easy",
  },
  {
    id: "booking-24h-reminder",
    name: "24-Hour Appointment Reminder",
    description: "Remind the customer 24 hours before their scheduled appointment.",
    category: "Bookings",
    trigger: "booking.reminder",
    actions: [{ type: "send_email" }, { type: "send_whatsapp" }],
    businessProblem: "No-shows due to forgotten appointments",
    modulesTouched: ["Bookings", "Content"],
    prerequisites: ["Booking system active"],
    expectedOutcome: "Multi-channel reminder 24h before, reducing no-shows significantly",
    complexity: "easy",
  },
  {
    id: "lead-score-alert",
    name: "Hot Lead Alert",
    description: "Get notified and create a follow-up when a lead score changes significantly.",
    category: "CRM",
    trigger: "lead.scored",
    actions: [{ type: "send_notification" }, { type: "create_task", config: { title: "Reach out to hot lead" } }],
    businessProblem: "Hot leads are not prioritized or acted on quickly",
    modulesTouched: ["CRM", "Tasks"],
    prerequisites: ["Lead scoring enabled"],
    expectedOutcome: "Instant alert + auto task when a lead reaches hot status",
    complexity: "medium",
  },
  {
    id: "invoice-sent-followup",
    name: "Invoice Follow-Up Reminder",
    description: "Schedule a follow-up task 3 days after an invoice is sent.",
    category: "Commerce",
    trigger: "invoice.sent",
    actions: [{ type: "delay", config: { hours: "72" } }, { type: "create_task", config: { title: "Follow up on sent invoice" } }],
    businessProblem: "Sent invoices are forgotten without timely follow-up",
    modulesTouched: ["Revenue", "Tasks"],
    prerequisites: ["Invoice system active"],
    expectedOutcome: "Automatic 3-day follow-up task for every sent invoice",
    complexity: "easy",
  },
  {
    id: "quote-followup-reminder",
    name: "Quote Follow-Up Reminders",
    description: "When a quote is sent, automatically create a follow-up task and send a reminder if not accepted.",
    category: "Commerce",
    trigger: "quote.sent",
    actions: [{ type: "create_task", config: { title: "Follow up on quote" } }, { type: "delay", config: { hours: "120" } }, { type: "send_quote_reminder" }],
    businessProblem: "Quotes go stale without follow-up, losing potential revenue",
    modulesTouched: ["Revenue", "Tasks", "Content"],
    prerequisites: ["Quote system active"],
    expectedOutcome: "Auto follow-up task + 5-day reminder for every quote, improving conversion",
    complexity: "medium",
  },
  {
    id: "vip-retention",
    name: "VIP Client Retention",
    description: "When a VIP client has no booking for 30 days, trigger a personalized outreach.",
    category: "CRM",
    trigger: "contact.no_activity_30d",
    actions: [{ type: "add_tag", config: { tag: "vip-at-risk" } }, { type: "send_email" }, { type: "create_task", config: { title: "Personal check-in with VIP" } }],
    businessProblem: "VIP clients silently disengage with no proactive retention",
    modulesTouched: ["CRM", "Content", "Tasks"],
    prerequisites: ["VIP segment configured"],
    expectedOutcome: "Proactive VIP retention with personalized outreach and task assignment",
    complexity: "advanced",
  },
];

export const WORKFLOW_ACTION_SUMMARIES: Record<string, string[]> = {
  quote_followup: ["Create Follow-up Task", "Send Reminder Email"],
  lead_form_pipeline: ["Create CRM Contact", "Tag Lead", "Enroll in Campaign"],
  booking_completed_followup: ["Schedule Feedback Request", "Create Follow-up Task"],
  booking_cancelled_reengagement: ["Create Re-engagement Task", "Tag Contact"],
  booking_rescheduled_tracking: ["Log Reschedule Event", "Update Contact"],
  new_product_marketing: ["Generate Marketing Suggestions", "Send Notification"],
  quote_conversion_tracking: ["Cancel Follow-up Tasks", "Log Conversion"],
  product_update_tracking: ["Log Product Change", "Notify Impact"],
  campaign_engagement_scoring: ["Update Engagement Scores"],
};

export function getWorkflowActionSummary(workflowKey: string): string[] {
  return WORKFLOW_ACTION_SUMMARIES[workflowKey] ?? ["Automated action"];
}

export function getTriggerLabel(trigger: string): string {
  return TRIGGER_OPTIONS.find((t) => t.value === trigger)?.label ?? trigger;
}

export function getActionLabel(actionType: string): string {
  return ACTION_OPTIONS.find((a) => a.value === actionType)?.label ?? actionType;
}

export function getActionLabels(actions: unknown): string[] {
  if (!Array.isArray(actions) || actions.length === 0) return ["No actions"];
  return actions.map((a: { type?: string }) => getActionLabel(a.type ?? ""));
}

export function getTriggerModule(trigger: string): string {
  for (const group of TRIGGER_GROUPS) {
    if (group.options.some((o) => o.value === trigger)) {
      const g = group.group;
      if (g.includes("CRM")) return "CRM";
      if (g.includes("Commerce")) return "Revenue";
      if (g.includes("Booking")) return "Bookings";
      if (g.includes("Content") || g.includes("Marketing")) return "Content";
      if (g.includes("Staff")) return "Staff";
      if (g.includes("Time")) return "Time-Based";
    }
  }
  return "General";
}

export function getFlowModules(trigger: string, actions: ActionStep[]): string[] {
  const modules = new Set<string>();
  modules.add(getTriggerModule(trigger));

  for (const action of actions) {
    if (["send_email", "send_whatsapp", "send_sms", "send_notification", "notify_staff"].includes(action.type)) {
      modules.add("Content");
    }
    if (["add_tag", "update_contact", "add_note", "move_pipeline", "update_segment", "enroll_campaign", "request_review", "log_timeline"].includes(action.type)) {
      modules.add("CRM");
    }
    if (["create_task", "assign_staff"].includes(action.type)) {
      modules.add("Tasks");
    }
    if (["create_invoice", "send_quote_reminder", "update_status"].includes(action.type)) {
      modules.add("Revenue");
    }
    if (["create_booking_followup", "schedule_reengagement", "schedule_followup"].includes(action.type)) {
      modules.add("Bookings");
    }
    if (["create_content_draft"].includes(action.type)) {
      modules.add("Content");
    }
  }
  return Array.from(modules);
}

export function buildNaturalLanguageSummary(
  triggerEvent: string,
  conditions: string[],
  actions: ActionStep[],
  conditionOperator: "AND" | "OR" = "AND"
): string {
  if (!triggerEvent && actions.filter((a) => a.type).length === 0) return "";

  const triggerLabel = getTriggerLabel(triggerEvent);
  const filledConditions = conditions.filter((c) => c);
  const filledActions = actions.filter((a) => a.type);

  let summary = "";

  if (triggerEvent) {
    summary += `When "${triggerLabel}" happens`;
  }

  if (filledConditions.length > 0) {
    const condLabels = filledConditions.map(
      (c) => CONDITION_OPTIONS.find((o) => o.value === c)?.label ?? c
    );
    const joiner = conditionOperator === "AND" ? " and " : " or ";
    summary += `, if ${condLabels.join(joiner).toLowerCase()}`;
  }

  if (filledActions.length > 0) {
    const actionLabels = filledActions.map((a) => getActionLabel(a.type).toLowerCase());
    if (filledActions.some((a) => a.type === "delay")) {
      const delayIdx = filledActions.findIndex((a) => a.type === "delay");
      const delayHours = filledActions[delayIdx]?.config?.hours ?? "1";
      const before = actionLabels.slice(0, delayIdx);
      const after = actionLabels.slice(delayIdx + 1);
      if (before.length > 0) summary += `, then ${before.join(", then ")}`;
      summary += `, wait ${delayHours} hours`;
      if (after.length > 0) summary += `, then ${after.join(", then ")}`;
    } else {
      summary += `, then ${actionLabels.join(", then ")}`;
    }
  }

  return summary + ".";
}

export const COVERAGE_MODULES = [
  { key: "clients", label: "Clients", triggers: ["contact.created", "contact.updated", "contact.stage_changed", "contact.inactive", "contact.no_activity_30d", "lead.scored"] },
  { key: "revenue", label: "Revenue", triggers: ["invoice.paid", "invoice.sent", "invoice.overdue", "quote.sent", "quote.accepted", "quote.viewed", "quote.not_accepted_xdays", "payment.received", "recurring.failed"] },
  { key: "bookings", label: "Bookings", triggers: ["booking.created", "booking.confirmed", "booking.completed", "booking.cancelled", "booking.scheduled", "booking.reminder"] },
  { key: "content", label: "Content", triggers: ["campaign.sent", "campaign.opened", "campaign.not_opened_14d", "post.published", "form.submitted", "subscriber.joined", "segment.changed"] },
];
