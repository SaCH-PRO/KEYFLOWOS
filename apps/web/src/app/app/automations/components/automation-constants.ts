export const TRIGGER_GROUPS = [
  {
    group: "Commerce",
    options: [
      { value: "invoice.paid", label: "Invoice Paid" },
      { value: "invoice.sent", label: "Invoice Sent" },
      { value: "invoice.overdue", label: "Invoice Overdue" },
      { value: "quote.accepted", label: "Quote Accepted" },
      { value: "payment.received", label: "Payment Received" },
    ],
  },
  {
    group: "Bookings",
    options: [
      { value: "booking.created", label: "Booking Created" },
      { value: "booking.confirmed", label: "Booking Confirmed" },
      { value: "booking.completed", label: "Booking Completed" },
      { value: "booking.cancelled", label: "Booking Cancelled" },
      { value: "booking.reminder", label: "Booking Reminder (24h)" },
    ],
  },
  {
    group: "CRM",
    options: [
      { value: "contact.created", label: "Contact Created" },
      { value: "contact.updated", label: "Contact Updated" },
      { value: "contact.inactive", label: "Contact Inactive (30d)" },
      { value: "lead.scored", label: "Lead Score Changed" },
    ],
  },
  {
    group: "Marketing",
    options: [
      { value: "campaign.sent", label: "Campaign Sent" },
      { value: "form.submitted", label: "Form Submitted" },
      { value: "subscriber.joined", label: "New Subscriber" },
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
    ],
  },
  {
    group: "Operations",
    options: [
      { value: "create_task", label: "Create Task" },
      { value: "create_invoice", label: "Create Invoice" },
      { value: "update_status", label: "Update Status" },
      { value: "assign_staff", label: "Assign Staff Member" },
    ],
  },
  {
    group: "CRM",
    options: [
      { value: "add_tag", label: "Add Tag" },
      { value: "update_contact", label: "Update Contact" },
      { value: "add_note", label: "Add Note" },
      { value: "move_pipeline", label: "Move Pipeline Stage" },
    ],
  },
  {
    group: "Scheduling",
    options: [
      { value: "delay", label: "Wait / Delay" },
      { value: "schedule_followup", label: "Schedule Follow-up" },
    ],
  },
];

export const ACTION_OPTIONS = ACTION_GROUPS.flatMap((g) => g.options);

export type ActionStep = { type: string; config?: Record<string, string> };

export interface AutomationTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  trigger: string;
  actions: ActionStep[];
}

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: "welcome-email",
    name: "Welcome New Contacts",
    description: "Send a welcome email when a new contact is added to your CRM.",
    category: "CRM",
    trigger: "contact.created",
    actions: [{ type: "send_email" }, { type: "add_tag" }],
  },
  {
    id: "invoice-receipt",
    name: "Auto-Send Receipt",
    description: "Automatically send a payment receipt when an invoice is paid.",
    category: "Commerce",
    trigger: "invoice.paid",
    actions: [{ type: "send_email" }, { type: "create_task" }],
  },
  {
    id: "booking-reminder",
    name: "Booking Confirmation",
    description: "Send a confirmation message when a booking is confirmed.",
    category: "Bookings",
    trigger: "booking.confirmed",
    actions: [{ type: "send_email" }, { type: "send_whatsapp" }],
  },
  {
    id: "overdue-followup",
    name: "Overdue Invoice Follow-Up",
    description: "Create a follow-up task and notify when an invoice goes overdue.",
    category: "Commerce",
    trigger: "invoice.overdue",
    actions: [{ type: "create_task" }, { type: "send_notification" }],
  },
  {
    id: "lead-nurture",
    name: "Lead Nurture Sequence",
    description: "When a form is submitted, create a contact and schedule a follow-up.",
    category: "Marketing",
    trigger: "form.submitted",
    actions: [{ type: "add_tag" }, { type: "schedule_followup" }],
  },
  {
    id: "booking-followup",
    name: "Post-Booking Review Request",
    description: "After a booking is completed, send a feedback request.",
    category: "Bookings",
    trigger: "booking.completed",
    actions: [{ type: "send_email" }, { type: "create_task" }],
  },
  {
    id: "campaign-tag",
    name: "Campaign Engagement Tag",
    description: "Tag contacts when a campaign is sent to track engagement.",
    category: "Marketing",
    trigger: "campaign.sent",
    actions: [{ type: "add_tag" }],
  },
  {
    id: "daily-summary",
    name: "Daily Business Summary",
    description: "Generate a daily summary notification of key metrics.",
    category: "Time-Based",
    trigger: "schedule.daily",
    actions: [{ type: "send_notification" }],
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
