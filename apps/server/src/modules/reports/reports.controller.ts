import {
  BadRequestException,
  Controller, Get, Header, Inject, Param, Query, Res, UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { LedgerReportingService, ReportBasis } from './ledger-reporting.service';
import {
  pnlToCsv, cashflowToCsv, balanceSheetToCsv, taxSummaryToCsv,
  arAgingToCsv, apAgingToCsv, dimensionToCsv,
  pnlToPdf, cashflowToPdf, balanceSheetToPdf, taxSummaryToPdf,
  arAgingToPdf, apAgingToPdf, dimensionToPdf, sendCsv, sendPdf,
} from './report-formatters';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

function parseRange(start?: string, end?: string): { from: Date; to: Date } {
  const now = new Date();
  const from = start ? new Date(start) : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = end ? new Date(end) : now;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new BadRequestException('Invalid startDate/endDate');
  }
  return { from, to };
}

function parseBasis(v?: string): ReportBasis {
  return v === 'cash' ? 'cash' : 'accrual';
}

/** Accept either `startDate`/`endDate` (legacy) or `from`/`to` (FIN4 spec). */
const pickRange = (start?: string, end?: string, from?: string, to?: string) =>
  parseRange(start ?? from, end ?? to);
const pickAsOf = (asOf?: string, to?: string) => asOf ?? to;

@Controller()
@UseGuards(AuthGuard, BusinessGuard)
export class ReportsController {
  constructor(
    @Inject(ReportsService) private readonly reports: ReportsService,
    @Inject(LedgerReportingService) private readonly ledger: LedgerReportingService,
  ) {}

  // ---------- Legacy AI report (frontend back-compat) ----------
  @Get('businesses/:businessId/reports/generate')
  async generateReport(
    @Param('businessId') businessId: string,
    @Query('type') type: string = 'executive',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('compare') compare?: string,
  ) {
    return this.reports.generateReport(businessId, type, startDate, endDate, compare === 'true');
  }

  // ---------- FIN4: Ledger-derived reports ----------

  @Get('businesses/:businessId/reports/pnl')
  async pnl(
    @Param('businessId') businessId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('from') fromQ?: string,
    @Query('to') toQ?: string,
    @Query('basis') basis?: string,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const { from, to } = pickRange(startDate, endDate, fromQ, toQ);
    const r = await this.ledger.getPnl(businessId, from, to, parseBasis(basis));
    if (format === 'csv') return sendCsv(res!, `pnl-${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`, pnlToCsv(r));
    if (format === 'pdf') return sendPdf(res!, `pnl-${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`, await pnlToPdf(r));
    return r;
  }

  @Get('businesses/:businessId/reports/cashflow')
  async cashflow(
    @Param('businessId') businessId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('from') fromQ?: string,
    @Query('to') toQ?: string,
    @Query('basis') basis?: string,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const { from, to } = pickRange(startDate, endDate, fromQ, toQ);
    const r = await this.ledger.getCashflow(businessId, from, to, parseBasis(basis));
    if (format === 'csv') return sendCsv(res!, `cashflow-${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`, cashflowToCsv(r));
    if (format === 'pdf') return sendPdf(res!, `cashflow-${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`, await cashflowToPdf(r));
    return r;
  }

  @Get('businesses/:businessId/reports/balance-sheet')
  async balanceSheet(
    @Param('businessId') businessId: string,
    @Query('asOf') asOf?: string,
    @Query('to') toQ?: string,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const dateStr = pickAsOf(asOf, toQ);
    const date = dateStr ? new Date(dateStr) : new Date();
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Invalid asOf');
    const r = await this.ledger.getBalanceSheet(businessId, date);
    if (format === 'csv') return sendCsv(res!, `balance-sheet-${date.toISOString().slice(0, 10)}`, balanceSheetToCsv(r));
    if (format === 'pdf') return sendPdf(res!, `balance-sheet-${date.toISOString().slice(0, 10)}`, await balanceSheetToPdf(r));
    return r;
  }

  @Get('businesses/:businessId/reports/tax-summary')
  async taxSummary(
    @Param('businessId') businessId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('from') fromQ?: string,
    @Query('to') toQ?: string,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const { from, to } = pickRange(startDate, endDate, fromQ, toQ);
    const r = await this.ledger.getTaxSummary(businessId, from, to);
    if (format === 'csv') return sendCsv(res!, `tax-${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`, taxSummaryToCsv(r));
    if (format === 'pdf') return sendPdf(res!, `tax-${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`, await taxSummaryToPdf(r));
    return r;
  }

  @Get('businesses/:businessId/reports/ar-aging')
  async arAging(
    @Param('businessId') businessId: string,
    @Query('asOf') asOf?: string,
    @Query('to') toQ?: string,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const dateStr = pickAsOf(asOf, toQ);
    const date = dateStr ? new Date(dateStr) : new Date();
    const r = await this.ledger.getArAging(businessId, date);
    if (format === 'csv') return sendCsv(res!, `ar-aging-${date.toISOString().slice(0, 10)}`, arAgingToCsv(r));
    if (format === 'pdf') return sendPdf(res!, `ar-aging-${date.toISOString().slice(0, 10)}`, await arAgingToPdf(r));
    return r;
  }

  @Get('businesses/:businessId/reports/ap-aging')
  async apAging(
    @Param('businessId') businessId: string,
    @Query('asOf') asOf?: string,
    @Query('to') toQ?: string,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const dateStr = pickAsOf(asOf, toQ);
    const date = dateStr ? new Date(dateStr) : new Date();
    const r = await this.ledger.getApAging(businessId, date);
    if (format === 'csv') return sendCsv(res!, `ap-aging-${date.toISOString().slice(0, 10)}`, apAgingToCsv(r));
    if (format === 'pdf') return sendPdf(res!, `ap-aging-${date.toISOString().slice(0, 10)}`, await apAgingToPdf(r));
    return r;
  }

  @Get('businesses/:businessId/reports/revenue-by')
  async revenueBy(
    @Param('businessId') businessId: string,
    @Query('dimension') dimension?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('from') fromQ?: string,
    @Query('to') toQ?: string,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (!dimension || !['customer', 'product', 'service', 'source'].includes(dimension)) {
      throw new BadRequestException('dimension query param required: customer | product | service | source');
    }
    const { from, to } = pickRange(startDate, endDate, fromQ, toQ);
    const rows = await this.ledger.getRevenueBy(businessId, dimension as 'customer' | 'product' | 'service' | 'source', from, to);
    const title = `Revenue by ${dimension}`;
    if (format === 'csv') return sendCsv(res!, `revenue-by-${dimension}`, dimensionToCsv(title, rows));
    if (format === 'pdf') return sendPdf(res!, `revenue-by-${dimension}`, await dimensionToPdf(title, `${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`, rows));
    return { dimension, rows };
  }

  @Get('businesses/:businessId/reports/expense-by')
  async expenseBy(
    @Param('businessId') businessId: string,
    @Query('dimension') dimension?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('from') fromQ?: string,
    @Query('to') toQ?: string,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (!dimension || !['vendor', 'category', 'project'].includes(dimension)) {
      throw new BadRequestException('dimension query param required: vendor | category | project');
    }
    const { from, to } = pickRange(startDate, endDate, fromQ, toQ);
    const rows = await this.ledger.getExpenseBy(businessId, dimension as 'vendor' | 'category' | 'project', from, to);
    const title = `Expense by ${dimension}`;
    if (format === 'csv') return sendCsv(res!, `expense-by-${dimension}`, dimensionToCsv(title, rows));
    if (format === 'pdf') return sendPdf(res!, `expense-by-${dimension}`, await dimensionToPdf(title, `${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`, rows));
    return { dimension, rows };
  }
}
