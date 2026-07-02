import { Injectable } from '@nestjs/common';
import { ConnectorCommand, ConnectorResult } from '../key-cortex-connector.types';
import { connectorOk, connectorFail } from '../key-cortex-connector.utils';
import { AnalyticsEngineService } from '../../analytics/analytics-engine.service';
import { LedgerReportingService, ReportBasis } from '../../reports/ledger-reporting.service';
import {
  pnlToCsv,
  cashflowToCsv,
  balanceSheetToCsv,
  taxSummaryToCsv,
  dimensionToCsv,
} from '../../reports/report-formatters';
import { PrismaService } from '../../../core/prisma/prisma.service';

@Injectable()
export class AnalyticsAdapterService {
  constructor(
    private readonly engine: AnalyticsEngineService,
    private readonly ledger: LedgerReportingService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    try {
      switch (command.action) {
        case 'create_dashboard': {
          const dashboard = await this.createDashboard(command.businessId);
          return connectorOk(command, start, dashboard);
        }
        case 'create_report': {
          const report = await this.createReport({
            businessId: command.businessId,
            name: command.parameters.name as string,
            type: command.parameters.type as string,
            from: command.parameters.from as string | undefined,
            to: command.parameters.to as string | undefined,
          });
          return connectorOk(command, start, report);
        }
        case 'create_funnel': {
          const funnel = await this.createFunnel(command.businessId);
          return connectorOk(command, start, funnel);
        }
        case 'track_event': {
          const tracked = await this.trackEvent({
            businessId: command.businessId,
            eventName: command.parameters.eventName as string,
            contactId: command.parameters.contactId as string | undefined,
            properties: command.parameters.properties as Record<string, unknown> | undefined,
            actorId: command.userId,
          });
          return connectorOk(command, start, tracked);
        }
        case 'export_report': {
          const exported = await this.exportReport({
            businessId: command.businessId,
            reportId: command.parameters.reportId as string,
            format: (command.parameters.format as string) || 'csv',
          });
          return connectorOk(command, start, exported);
        }
        default:
          return connectorFail(command, start, `Unknown analytics action: ${command.action}`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return connectorFail(command, start, message);
    }
  }

  async getOverview(businessId: string) {
    return this.engine.getOverview(businessId);
  }

  private async createDashboard(businessId: string) {
    const [overview, metrics, trends] = await Promise.all([
      this.engine.getOverview(businessId, 30),
      this.engine.getAvailableMetrics(businessId),
      Promise.all(
        ['totalRevenue', 'newContacts', 'flowRuns'].map(async (metric) => ({
          metric,
          points: await this.engine.getTrends(businessId, metric, 30),
        })),
      ),
    ]);
    return {
      name: 'KEY Cortex Dashboard',
      overview,
      metrics,
      trends,
      generatedAt: new Date(),
    };
  }

  private async createReport(input: {
    businessId: string;
    name: string;
    type: string;
    from?: string;
    to?: string;
  }) {
    const now = new Date();
    const to = input.to ? new Date(input.to) : now;
    const from = input.from ? new Date(input.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    const basis: ReportBasis = 'accrual';

    switch (input.type?.toLowerCase()) {
      case 'pnl':
      case 'profit_and_loss': {
        const report = await this.ledger.getPnl(input.businessId, from, to, basis);
        return { name: input.name, type: input.type, report };
      }
      case 'cashflow': {
        const report = await this.ledger.getCashflow(input.businessId, from, to, basis);
        return { name: input.name, type: input.type, report };
      }
      case 'balance_sheet': {
        const report = await this.ledger.getBalanceSheet(input.businessId, to);
        return { name: input.name, type: input.type, report };
      }
      case 'tax_summary': {
        const report = await this.ledger.getTaxSummary(input.businessId, from, to);
        return { name: input.name, type: input.type, report };
      }
      case 'revenue_by_customer': {
        const report = await this.ledger.getRevenueBy(input.businessId, 'customer', from, to);
        return { name: input.name, type: input.type, report };
      }
      case 'expense_by_category': {
        const report = await this.ledger.getExpenseBy(input.businessId, 'category', from, to);
        return { name: input.name, type: input.type, report };
      }
      default: {
        const overview = await this.engine.getOverview(input.businessId, 30);
        return { name: input.name, type: input.type || 'overview', overview };
      }
    }
  }

  private async createFunnel(businessId: string) {
    const [overview, metrics] = await Promise.all([
      this.engine.getOverview(businessId, 30),
      this.engine.getAvailableMetrics(businessId),
    ]);
    return {
      name: 'KEY Cortex Funnel',
      stages: [
        { stage: 'contacts', value: (overview as Record<string, unknown>).totalContacts ?? 0 },
        { stage: 'active_leads', value: (overview as Record<string, unknown>).activeLeads ?? 0 },
        { stage: 'quotes', value: (overview as Record<string, unknown>).totalQuotes ?? 0 },
        { stage: 'bookings', value: (overview as Record<string, unknown>).totalBookings ?? 0 },
      ],
      metrics,
      generatedAt: new Date(),
    };
  }

  private async trackEvent(input: {
    businessId: string;
    eventName: string;
    contactId?: string;
    properties?: Record<string, unknown>;
    actorId: string;
  }) {
    const event = await this.prisma.client.businessEvent.create({
      data: {
        businessId: input.businessId,
        eventType: input.eventName,
        subjectType: 'contact',
        subjectId: input.contactId ?? 'unknown',
        actorType: 'ai',
        actorId: input.actorId,
        action: 'track',
        source: 'key_cortex',
        metadata: input.properties ?? {},
      },
    });
    return { tracked: true, eventId: event.id, eventName: input.eventName };
  }

  private async exportReport(input: {
    businessId: string;
    reportId: string;
    format: string;
  }) {
    const [reportType, fromStr, toStr] = input.reportId.split('|');
    const now = new Date();
    const to = toStr ? new Date(toStr) : now;
    const from = fromStr ? new Date(fromStr) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    const basis: ReportBasis = 'accrual';

    let payload: string;
    switch (reportType?.toLowerCase()) {
      case 'cashflow':
        payload = cashflowToCsv(await this.ledger.getCashflow(input.businessId, from, to, basis));
        break;
      case 'balance_sheet':
        payload = balanceSheetToCsv(await this.ledger.getBalanceSheet(input.businessId, to));
        break;
      case 'tax_summary':
        payload = taxSummaryToCsv(await this.ledger.getTaxSummary(input.businessId, from, to));
        break;
      case 'revenue_by_customer':
        payload = dimensionToCsv('Revenue by Customer', await this.ledger.getRevenueBy(input.businessId, 'customer', from, to));
        break;
      case 'expense_by_category':
        payload = dimensionToCsv('Expense by Category', await this.ledger.getExpenseBy(input.businessId, 'category', from, to));
        break;
      case 'pnl':
      default:
        payload = pnlToCsv(await this.ledger.getPnl(input.businessId, from, to, basis));
        break;
    }

    return {
      format: input.format,
      reportId: input.reportId,
      content: payload,
      generatedAt: new Date(),
    };
  }
}
