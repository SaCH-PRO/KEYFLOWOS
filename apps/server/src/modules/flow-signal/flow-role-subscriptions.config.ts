import { FlowType } from '@prisma/client';

export interface FlowRoleDefinition {
  key: string;
  label: string;
  subscriptions: {
    flowType: FlowType;
    typeFilter?: string;
    sourceFilter?: string;
    moduleFilter?: string;
    importanceFilter?: string;
  }[];
}

/**
 * Static role-to-flow subscription map for the 35 R/P employee roles in the
 * KEY FLOWS operating system. Each role is a lens on the canonical FlowSignal
 * stream; this config drives RoleFlowService.getRoleQueue().
 */
export const FLOW_ROLE_SUBSCRIPTIONS: FlowRoleDefinition[] = [
  // R-1 Data Entry Clerk
  {
    key: 'DATA_ENTRY_CLERK',
    label: 'Data Entry Clerk',
    subscriptions: [
      { flowType: FlowType.PEOPLE, typeFilter: 'ingestion.%' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'ingestion.%' },
    ],
  },
  // R-2 File / Records Clerk
  {
    key: 'FILE_RECORDS_CLERK',
    label: 'File / Records Clerk',
    subscriptions: [
      { flowType: FlowType.TEMPORAL, typeFilter: 'document.%' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'file.%' },
    ],
  },
  // R-3 Transcriptionist
  {
    key: 'TRANSCRIPTIONIST',
    label: 'Transcriptionist',
    subscriptions: [
      { flowType: FlowType.TEMPORAL, typeFilter: 'media.transcribe%' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'audio.%' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'video.%' },
    ],
  },
  // R-4 Notetaker
  {
    key: 'NOTETAKER',
    label: 'Notetaker',
    subscriptions: [
      { flowType: FlowType.TEMPORAL, typeFilter: 'meeting.transcript%' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'meeting.ended' },
      { flowType: FlowType.PEOPLE, typeFilter: 'meeting.transcript%' },
    ],
  },
  // R-5 Meeting Scheduler
  {
    key: 'MEETING_SCHEDULER',
    label: 'Meeting Scheduler',
    subscriptions: [
      { flowType: FlowType.TEMPORAL, typeFilter: 'calendar.scheduling%' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'booking.requested' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'meeting.scheduling%' },
    ],
  },
  // R-6 Expense Report Processor
  {
    key: 'EXPENSE_REPORT_PROCESSOR',
    label: 'Expense Report Processor',
    subscriptions: [
      { flowType: FlowType.FINANCIAL, typeFilter: 'expense.%' },
      { flowType: FlowType.FINANCIAL, typeFilter: 'receipt.%' },
    ],
  },
  // R-7 Accounts Receivable Clerk
  {
    key: 'ACCOUNTS_RECEIVABLE_CLERK',
    label: 'Accounts Receivable Clerk',
    subscriptions: [
      { flowType: FlowType.FINANCIAL, typeFilter: 'invoice.%' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'invoice.overdue' },
      { flowType: FlowType.PEOPLE, typeFilter: 'invoice.overdue' },
    ],
  },
  // R-8 Lead Qualifier
  {
    key: 'LEAD_QUALIFIER',
    label: 'Lead Qualifier',
    subscriptions: [
      { flowType: FlowType.PEOPLE, typeFilter: 'lead.%' },
      { flowType: FlowType.PEOPLE, typeFilter: 'form.lead%' },
    ],
  },
  // R-9 Sales Coordinator
  {
    key: 'SALES_COORDINATOR',
    label: 'Sales Coordinator',
    subscriptions: [
      { flowType: FlowType.PEOPLE, typeFilter: 'deal.%' },
      { flowType: FlowType.PEOPLE, typeFilter: 'demo.%' },
      { flowType: FlowType.PEOPLE, typeFilter: 'opportunity.%' },
    ],
  },
  // R-10 Contract Administrator
  {
    key: 'CONTRACT_ADMINISTRATOR',
    label: 'Contract Administrator',
    subscriptions: [
      { flowType: FlowType.TEMPORAL, typeFilter: 'contract.%' },
      { flowType: FlowType.FINANCIAL, typeFilter: 'contract.renewal%' },
    ],
  },
  // R-11 Vendor Onboarding Specialist
  {
    key: 'VENDOR_ONBOARDING_SPECIALIST',
    label: 'Vendor Onboarding Specialist',
    subscriptions: [
      { flowType: FlowType.PEOPLE, typeFilter: 'vendor.%' },
      { flowType: FlowType.FINANCIAL, typeFilter: 'vendor.%' },
    ],
  },
  // R-12 SaaS / LMS / Training Administrator
  {
    key: 'SAAS_LMS_TRAINING_ADMINISTRATOR',
    label: 'SaaS / LMS / Training Administrator',
    subscriptions: [
      { flowType: FlowType.PEOPLE, typeFilter: 'user.%' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'training.%' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'course.%' },
    ],
  },
  // R-13 Reservation Agent
  {
    key: 'RESERVATION_AGENT',
    label: 'Reservation Agent',
    subscriptions: [
      { flowType: FlowType.TEMPORAL, typeFilter: 'reservation.%' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'booking.%' },
    ],
  },
  // R-14 Board Secretary
  {
    key: 'BOARD_SECRETARY',
    label: 'Board Secretary',
    subscriptions: [
      { flowType: FlowType.TEMPORAL, typeFilter: 'board.%' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'resolution.%' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'meeting.minutes%' },
    ],
  },
  // R-15 Project Coordinator
  {
    key: 'PROJECT_COORDINATOR',
    label: 'Project Coordinator',
    subscriptions: [
      { flowType: FlowType.TEMPORAL, typeFilter: 'project.%' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'task.%' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'milestone.%' },
    ],
  },
  // P-1 Executive Assistant
  {
    key: 'EXECUTIVE_ASSISTANT',
    label: 'Executive Assistant',
    subscriptions: [
      { flowType: FlowType.TEMPORAL, typeFilter: 'reminder.%' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'calendar.conflict%' },
      { flowType: FlowType.PEOPLE, typeFilter: 'inbox.%' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'deadline.%' },
    ],
  },
  // P-2 Bookkeeper
  {
    key: 'BOOKKEEPER',
    label: 'Bookkeeper',
    subscriptions: [
      { flowType: FlowType.FINANCIAL, typeFilter: 'transaction.%' },
      { flowType: FlowType.FINANCIAL, typeFilter: 'bank.%' },
      { flowType: FlowType.FINANCIAL, typeFilter: 'reconciliation%' },
    ],
  },
  // P-3 SDR / BDR
  {
    key: 'SDR_BDR',
    label: 'SDR / BDR',
    subscriptions: [
      { flowType: FlowType.PEOPLE, typeFilter: 'lead.qualified' },
      { flowType: FlowType.PEOPLE, typeFilter: 'outreach.%' },
      { flowType: FlowType.PEOPLE, typeFilter: 'sequence.%' },
    ],
  },
  // P-4 L1 / L2 Customer Support Agent
  {
    key: 'L1_L2_CUSTOMER_SUPPORT_AGENT',
    label: 'L1 / L2 Customer Support Agent',
    subscriptions: [
      { flowType: FlowType.PEOPLE, typeFilter: 'support.%' },
      { flowType: FlowType.PEOPLE, typeFilter: 'ticket.%' },
      { flowType: FlowType.PEOPLE, typeFilter: 'helpdesk.%' },
    ],
  },
  // P-5 Social Media Manager / Responder
  {
    key: 'SOCIAL_MEDIA_MANAGER_RESPONDER',
    label: 'Social Media Manager / Responder',
    subscriptions: [
      { flowType: FlowType.PEOPLE, typeFilter: 'social.%' },
      { flowType: FlowType.PEOPLE, typeFilter: 'mention.%' },
    ],
  },
  // P-6 Email Marketer / Content Marketer
  {
    key: 'EMAIL_CONTENT_MARKETER',
    label: 'Email Marketer / Content Marketer',
    subscriptions: [
      { flowType: FlowType.PEOPLE, typeFilter: 'campaign.%' },
      { flowType: FlowType.PEOPLE, typeFilter: 'content.%' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'campaign.%' },
    ],
  },
  // P-7 Operations Coordinator
  {
    key: 'OPERATIONS_COORDINATOR',
    label: 'Operations Coordinator',
    subscriptions: [
      { flowType: FlowType.TEMPORAL, typeFilter: 'operations.%' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'task.assigned' },
    ],
  },
  // P-8 Project Manager (Administrative)
  {
    key: 'PROJECT_MANAGER_ADMINISTRATIVE',
    label: 'Project Manager (Administrative)',
    subscriptions: [
      { flowType: FlowType.TEMPORAL, typeFilter: 'project.risk%' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'milestone.due' },
      { flowType: FlowType.FINANCIAL, typeFilter: 'budget.variance%' },
    ],
  },
  // P-9 Inventory Manager
  {
    key: 'INVENTORY_MANAGER',
    label: 'Inventory Manager',
    subscriptions: [
      { flowType: FlowType.FINANCIAL, typeFilter: 'inventory.%' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'inventory.%' },
      { flowType: FlowType.FINANCIAL, typeFilter: 'stock.%' },
    ],
  },
  // P-10 Procurement Buyer
  {
    key: 'PROCUREMENT_BUYER',
    label: 'Procurement Buyer',
    subscriptions: [
      { flowType: FlowType.FINANCIAL, typeFilter: 'procurement.%' },
      { flowType: FlowType.FINANCIAL, typeFilter: 'purchase_order.%' },
      { flowType: FlowType.PEOPLE, typeFilter: 'vendor.quote%' },
    ],
  },
  // P-11 HR Administrator
  {
    key: 'HR_ADMINISTRATOR',
    label: 'HR Administrator',
    subscriptions: [
      { flowType: FlowType.PEOPLE, typeFilter: 'employee.%' },
      { flowType: FlowType.PEOPLE, typeFilter: 'hr.%' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'onboarding.%' },
    ],
  },
  // P-12 Recruiter (Sourcing / Screening)
  {
    key: 'RECRUITER',
    label: 'Recruiter',
    subscriptions: [
      { flowType: FlowType.PEOPLE, typeFilter: 'candidate.%' },
      { flowType: FlowType.PEOPLE, typeFilter: 'application.%' },
    ],
  },
  // P-13 IT Support Technician
  {
    key: 'IT_SUPPORT_TECHNICIAN',
    label: 'IT Support Technician',
    subscriptions: [
      { flowType: FlowType.PEOPLE, typeFilter: 'it.%' },
      { flowType: FlowType.PEOPLE, typeFilter: 'helpdesk.%' },
    ],
  },
  // P-14 Paralegal / Contract Analyst
  {
    key: 'PARALEGAL_CONTRACT_ANALYST',
    label: 'Paralegal / Contract Analyst',
    subscriptions: [
      { flowType: FlowType.TEMPORAL, typeFilter: 'legal.%' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'contract.review%' },
    ],
  },
  // P-15 Medical Receptionist / Biller / Coder
  {
    key: 'MEDICAL_RECEPTIONIST_BILLER_CODER',
    label: 'Medical Receptionist / Biller / Coder',
    subscriptions: [
      { flowType: FlowType.PEOPLE, typeFilter: 'appointment.%' },
      { flowType: FlowType.FINANCIAL, typeFilter: 'claim.%' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'coding.%' },
    ],
  },
  // P-16 Field Service Dispatcher / Coordinator
  {
    key: 'FIELD_SERVICE_DISPATCHER',
    label: 'Field Service Dispatcher / Coordinator',
    subscriptions: [
      { flowType: FlowType.TEMPORAL, typeFilter: 'field_service.%' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'dispatch.%' },
      { flowType: FlowType.PEOPLE, typeFilter: 'technician.%' },
    ],
  },
  // P-17 E-commerce Manager
  {
    key: 'ECOMMERCE_MANAGER',
    label: 'E-commerce Manager',
    subscriptions: [
      { flowType: FlowType.FINANCIAL, typeFilter: 'order.%' },
      { flowType: FlowType.FINANCIAL, typeFilter: 'listing.%' },
      { flowType: FlowType.PEOPLE, typeFilter: 'product.%' },
    ],
  },
  // P-18 Front Desk / Concierge
  {
    key: 'FRONT_DESK_CONCIERGE',
    label: 'Front Desk / Concierge',
    subscriptions: [
      { flowType: FlowType.PEOPLE, typeFilter: 'visitor.%' },
      { flowType: FlowType.PEOPLE, typeFilter: 'guest.%' },
      { flowType: FlowType.PEOPLE, typeFilter: 'check_in.%' },
    ],
  },
  // P-19 Restaurant Manager (Back Office)
  {
    key: 'RESTAURANT_MANAGER',
    label: 'Restaurant Manager (Back Office)',
    subscriptions: [
      { flowType: FlowType.TEMPORAL, typeFilter: 'restaurant.%' },
      { flowType: FlowType.FINANCIAL, typeFilter: 'restaurant.%' },
      { flowType: FlowType.FINANCIAL, typeFilter: 'shift.%' },
    ],
  },
  // P-20 UX Designer / Technical Writer / QA Engineer
  {
    key: 'UX_DESIGNER_TECHNICAL_WRITER_QA',
    label: 'UX Designer / Technical Writer / QA Engineer',
    subscriptions: [
      { flowType: FlowType.TEMPORAL, typeFilter: 'design.%' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'doc.%' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'bug.%' },
      { flowType: FlowType.TEMPORAL, typeFilter: 'qa.%' },
    ],
  },
];

export function getRoleDefinition(roleKey: string): FlowRoleDefinition | undefined {
  return FLOW_ROLE_SUBSCRIPTIONS.find((r) => r.key === roleKey);
}

export function getAllRoleDefinitions(): FlowRoleDefinition[] {
  return FLOW_ROLE_SUBSCRIPTIONS;
}
