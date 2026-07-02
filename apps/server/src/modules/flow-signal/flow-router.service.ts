import { Injectable } from '@nestjs/common';
import { FlowType } from '@prisma/client';
import type { FlowSignalInput } from './flow-signal.types';

interface RoleHintRule {
  prefix: string;
  roleKey: string;
}

/**
 * Map from normalized signal type prefix to the canonical owner role hint.
 * Order matters — more specific prefixes should appear before generic ones.
 */
const ROLE_HINTS: RoleHintRule[] = [
  { prefix: 'ingestion.', roleKey: 'DATA_ENTRY_CLERK' },
  { prefix: 'document.', roleKey: 'FILE_RECORDS_CLERK' },
  { prefix: 'file.', roleKey: 'FILE_RECORDS_CLERK' },
  { prefix: 'media.transcribe', roleKey: 'TRANSCRIPTIONIST' },
  { prefix: 'audio.', roleKey: 'TRANSCRIPTIONIST' },
  { prefix: 'video.', roleKey: 'TRANSCRIPTIONIST' },
  { prefix: 'meeting.transcript', roleKey: 'NOTETAKER' },
  { prefix: 'calendar.scheduling', roleKey: 'MEETING_SCHEDULER' },
  { prefix: 'booking.requested', roleKey: 'MEETING_SCHEDULER' },
  { prefix: 'meeting.scheduling', roleKey: 'MEETING_SCHEDULER' },
  { prefix: 'expense.', roleKey: 'EXPENSE_REPORT_PROCESSOR' },
  { prefix: 'receipt.', roleKey: 'EXPENSE_REPORT_PROCESSOR' },
  { prefix: 'invoice.', roleKey: 'ACCOUNTS_RECEIVABLE_CLERK' },
  { prefix: 'lead.', roleKey: 'LEAD_QUALIFIER' },
  { prefix: 'deal.', roleKey: 'SALES_COORDINATOR' },
  { prefix: 'demo.', roleKey: 'SALES_COORDINATOR' },
  { prefix: 'opportunity.', roleKey: 'SALES_COORDINATOR' },
  { prefix: 'contract.', roleKey: 'CONTRACT_ADMINISTRATOR' },
  { prefix: 'vendor.', roleKey: 'VENDOR_ONBOARDING_SPECIALIST' },
  { prefix: 'user.', roleKey: 'SAAS_LMS_TRAINING_ADMINISTRATOR' },
  { prefix: 'training.', roleKey: 'SAAS_LMS_TRAINING_ADMINISTRATOR' },
  { prefix: 'course.', roleKey: 'SAAS_LMS_TRAINING_ADMINISTRATOR' },
  { prefix: 'reservation.', roleKey: 'RESERVATION_AGENT' },
  { prefix: 'board.', roleKey: 'BOARD_SECRETARY' },
  { prefix: 'resolution.', roleKey: 'BOARD_SECRETARY' },
  { prefix: 'meeting.minutes', roleKey: 'BOARD_SECRETARY' },
  { prefix: 'project.', roleKey: 'PROJECT_COORDINATOR' },
  { prefix: 'task.', roleKey: 'PROJECT_COORDINATOR' },
  { prefix: 'milestone.', roleKey: 'PROJECT_COORDINATOR' },
  { prefix: 'reminder.', roleKey: 'EXECUTIVE_ASSISTANT' },
  { prefix: 'calendar.conflict', roleKey: 'EXECUTIVE_ASSISTANT' },
  { prefix: 'inbox.', roleKey: 'EXECUTIVE_ASSISTANT' },
  { prefix: 'deadline.', roleKey: 'EXECUTIVE_ASSISTANT' },
  { prefix: 'transaction.', roleKey: 'BOOKKEEPER' },
  { prefix: 'bank.', roleKey: 'BOOKKEEPER' },
  { prefix: 'reconciliation.', roleKey: 'BOOKKEEPER' },
  { prefix: 'lead.qualified', roleKey: 'SDR_BDR' },
  { prefix: 'outreach.', roleKey: 'SDR_BDR' },
  { prefix: 'sequence.', roleKey: 'SDR_BDR' },
  { prefix: 'support.', roleKey: 'L1_L2_CUSTOMER_SUPPORT_AGENT' },
  { prefix: 'ticket.', roleKey: 'L1_L2_CUSTOMER_SUPPORT_AGENT' },
  { prefix: 'helpdesk.', roleKey: 'L1_L2_CUSTOMER_SUPPORT_AGENT' },
  { prefix: 'social.', roleKey: 'SOCIAL_MEDIA_MANAGER_RESPONDER' },
  { prefix: 'mention.', roleKey: 'SOCIAL_MEDIA_MANAGER_RESPONDER' },
  { prefix: 'campaign.', roleKey: 'EMAIL_CONTENT_MARKETER' },
  { prefix: 'content.', roleKey: 'EMAIL_CONTENT_MARKETER' },
  { prefix: 'operations.', roleKey: 'OPERATIONS_COORDINATOR' },
  { prefix: 'project.risk', roleKey: 'PROJECT_MANAGER_ADMINISTRATIVE' },
  { prefix: 'milestone.due', roleKey: 'PROJECT_MANAGER_ADMINISTRATIVE' },
  { prefix: 'budget.variance', roleKey: 'PROJECT_MANAGER_ADMINISTRATIVE' },
  { prefix: 'inventory.', roleKey: 'INVENTORY_MANAGER' },
  { prefix: 'stock.', roleKey: 'INVENTORY_MANAGER' },
  { prefix: 'procurement.', roleKey: 'PROCUREMENT_BUYER' },
  { prefix: 'purchase_order.', roleKey: 'PROCUREMENT_BUYER' },
  { prefix: 'employee.', roleKey: 'HR_ADMINISTRATOR' },
  { prefix: 'hr.', roleKey: 'HR_ADMINISTRATOR' },
  { prefix: 'onboarding.', roleKey: 'HR_ADMINISTRATOR' },
  { prefix: 'candidate.', roleKey: 'RECRUITER' },
  { prefix: 'application.', roleKey: 'RECRUITER' },
  { prefix: 'it.', roleKey: 'IT_SUPPORT_TECHNICIAN' },
  { prefix: 'legal.', roleKey: 'PARALEGAL_CONTRACT_ANALYST' },
  { prefix: 'contract.review', roleKey: 'PARALEGAL_CONTRACT_ANALYST' },
  { prefix: 'appointment.', roleKey: 'MEDICAL_RECEPTIONIST_BILLER_CODER' },
  { prefix: 'claim.', roleKey: 'MEDICAL_RECEPTIONIST_BILLER_CODER' },
  { prefix: 'coding.', roleKey: 'MEDICAL_RECEPTIONIST_BILLER_CODER' },
  { prefix: 'field_service.', roleKey: 'FIELD_SERVICE_DISPATCHER' },
  { prefix: 'dispatch.', roleKey: 'FIELD_SERVICE_DISPATCHER' },
  { prefix: 'technician.', roleKey: 'FIELD_SERVICE_DISPATCHER' },
  { prefix: 'order.', roleKey: 'ECOMMERCE_MANAGER' },
  { prefix: 'listing.', roleKey: 'ECOMMERCE_MANAGER' },
  { prefix: 'product.', roleKey: 'ECOMMERCE_MANAGER' },
  { prefix: 'visitor.', roleKey: 'FRONT_DESK_CONCIERGE' },
  { prefix: 'guest.', roleKey: 'FRONT_DESK_CONCIERGE' },
  { prefix: 'check_in.', roleKey: 'FRONT_DESK_CONCIERGE' },
  { prefix: 'restaurant.', roleKey: 'RESTAURANT_MANAGER' },
  { prefix: 'shift.', roleKey: 'RESTAURANT_MANAGER' },
  { prefix: 'design.', roleKey: 'UX_DESIGNER_TECHNICAL_WRITER_QA' },
  { prefix: 'doc.', roleKey: 'UX_DESIGNER_TECHNICAL_WRITER_QA' },
  { prefix: 'bug.', roleKey: 'UX_DESIGNER_TECHNICAL_WRITER_QA' },
  { prefix: 'qa.', roleKey: 'UX_DESIGNER_TECHNICAL_WRITER_QA' },
];

const FINANCIAL_PREFIXES = new Set([
  'invoice.',
  'payment.',
  'expense.',
  'receipt.',
  'bill.',
  'deposit.',
  'transaction.',
  'bank.',
  'reconciliation.',
  'claim.',
  'budget.',
  'refund.',
  'purchase_order.',
  'order.',
  'listing.',
  'stock.',
  'procurement.',
  'restaurant.',
  'vendor.',
]);

const PEOPLE_PREFIXES = new Set([
  'lead.',
  'contact.',
  'customer.',
  'support.',
  'ticket.',
  'helpdesk.',
  'candidate.',
  'employee.',
  'hr.',
  'vendor.',
  'social.',
  'mention.',
  'campaign.',
  'content.',
  'message.',
  'inbox.',
  'visitor.',
  'guest.',
  'check_in.',
  'user.',
  'technician.',
  'application.',
  'outreach.',
  'sequence.',
  'product.',
]);

const TEMPORAL_PREFIXES = new Set([
  'booking.',
  'reservation.',
  'calendar.',
  'meeting.',
  'project.',
  'task.',
  'milestone.',
  'contract.',
  'document.',
  'file.',
  'media.',
  'audio.',
  'video.',
  'training.',
  'course.',
  'board.',
  'resolution.',
  'reminder.',
  'deadline.',
  'appointment.',
  'field_service.',
  'dispatch.',
  'shift.',
  'legal.',
  'design.',
  'doc.',
  'bug.',
  'qa.',
  'operations.',
  'onboarding.',
  'coding.',
  'event.',
  'ingestion.',
]);

const FINANCIAL_ENTITY_TYPES = new Set([
  'Invoice',
  'Payment',
  'Expense',
  'Receipt',
  'Bill',
  'Deposit',
  'Transaction',
  'Budget',
  'PurchaseOrder',
  'Order',
  'Listing',
  'Stock',
  'Procurement',
]);

const PEOPLE_ENTITY_TYPES = new Set([
  'Contact',
  'Lead',
  'Account',
  'Customer',
  'Candidate',
  'Employee',
  'Vendor',
  'User',
  'Technician',
  'Application',
  'Guest',
  'Visitor',
]);

const TEMPORAL_ENTITY_TYPES = new Set([
  'Booking',
  'Reservation',
  'Meeting',
  'Project',
  'Task',
  'Milestone',
  'CalendarEvent',
  'Contract',
  'Document',
  'File',
  'Media',
  'Audio',
  'Video',
  'Training',
  'Course',
  'Appointment',
  'Shift',
  'Legal',
  'Design',
  'Doc',
  'Bug',
  'Qa',
]);

@Injectable()
export class FlowRouterService {
  /**
   * Classify a raw signal into one or more flows and attach an owner role hint.
   */
  route(input: FlowSignalInput): FlowSignalInput {
    const flows = this.classifyFlows(input);

    // If the caller already specified flows, merge them in.
    if (input.flows && input.flows.length > 0) {
      for (const flow of input.flows) {
        flows.add(flow);
      }
    }

    const mergedFlows = Array.from(flows);
    const ownerRoleHint = input.ownerRoleHint ?? this.resolveOwnerRoleHint(input.type);

    return {
      ...input,
      flows: mergedFlows,
      ownerRoleHint,
    };
  }

  private classifyFlows(input: FlowSignalInput): Set<FlowType> {
    const flows = new Set<FlowType>();
    const type = input.type ?? '';
    const prefix = type.split('.')[0] + '.';

    if (FINANCIAL_PREFIXES.has(prefix) || input.module === 'finance' || FINANCIAL_ENTITY_TYPES.has(input.entityType ?? '')) {
      flows.add(FlowType.FINANCIAL);
    }

    if (PEOPLE_PREFIXES.has(prefix) || input.module === 'crm' || PEOPLE_ENTITY_TYPES.has(input.entityType ?? '')) {
      flows.add(FlowType.PEOPLE);
    }

    if (TEMPORAL_PREFIXES.has(prefix) || input.module === 'calendar' || input.module === 'project' || TEMPORAL_ENTITY_TYPES.has(input.entityType ?? '')) {
      flows.add(FlowType.TEMPORAL);
    }

    // Signals that carry explicit time bounds are temporal by nature.
    if (input.startsAt != null || input.endsAt != null || input.reminderAt != null) {
      flows.add(FlowType.TEMPORAL);
    }

    // Overdue / due signals have a temporal component and usually require
    // people-facing follow-up (reminders, collections, rescheduling).
    if (type.includes('.overdue') || type.includes('.due') || type.includes('.reminder')) {
      flows.add(FlowType.TEMPORAL);
      flows.add(FlowType.PEOPLE);
    }

    return flows;
  }

  private resolveOwnerRoleHint(type: string): string | undefined {
    for (const rule of ROLE_HINTS) {
      if (type.startsWith(rule.prefix)) {
        return rule.roleKey;
      }
    }
    return undefined;
  }
}
