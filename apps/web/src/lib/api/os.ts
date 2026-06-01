import { apiGet } from "../api";

export interface HealthScore {
  score: number;
  label: string;
  trend: "up" | "down" | "flat";
}

export interface CommandCenterDto {
  business: {
    id: string;
    name: string;
    currency: string;
  };
  generatedAt: string;
  health: {
    overallScore: number;
    money: HealthScore;
    time: HealthScore;
    people: HealthScore;
    sales: HealthScore;
    operations: HealthScore;
    governance: HealthScore;
  };
  today: {
    priorityCommands: number;
    pendingApprovals: number;
    dueTasks: number;
    meetingsOrBookings: number;
    moneyToCollect: number;
    urgentRisks: number;
  };
  flows: {
    financial: {
      cashBalance: number;
      outstandingInvoices: number;
      overdueInvoices: number;
      billsDue: number;
      taxReserved: number;
    };
    temporal: {
      pendingBookings: number;
      confirmedToday: number;
      overdueTasks: number;
    };
    people: {
      totalContacts: number;
      staleLeads: number;
      highValueCustomers: number;
    };
    sales: {
      openDeals: number;
      pendingQuotes: number;
      pipelineValue: number;
    };
    operations: {
      activeProjects: number;
      blockedTasks: number;
    };
  };
  key: {
    canAutoExecuteCount: number;
    needsApprovalCount: number;
    briefing: string;
  };
}

export async function fetchCommandCenter(businessId: string) {
  return apiGet<CommandCenterDto>(`/os/businesses/${businessId}/command-center`);
}
