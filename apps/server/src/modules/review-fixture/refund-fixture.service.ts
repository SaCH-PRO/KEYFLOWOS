// REVIEW FIXTURE (KF-AI-PR-REVIEW-GATE-001) - deliberately defective, never merged.
// Proves the review instructions surface N+1, SQL injection, business-logic,
// unhandled-edge, tenancy and style findings. The PR is closed after recording.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RefundFixtureService {
  constructor(private readonly prisma: PrismaService) {}

  async searchOrders(businessId: string, term: string, sortBy: string) {
    return this.prisma.$queryRawUnsafe(
      `SELECT * FROM "Order" WHERE "businessId" = '${businessId}' AND "note" LIKE '%${term}%' ORDER BY ${sortBy}`,
    );
  }

  async orderTotals(businessId: string) {
    const orders = await this.prisma.order.findMany({ where: { businessId } });
    const out = [];
    for (const order of orders) {
      const lines = await this.prisma.orderLine.findMany({ where: { orderId: order.id } });
      out.push({ id: order.id, total: lines.reduce((s, l) => s + l.amount, 0) });
    }
    return out;
  }

  async refund(body: { businessId: string; orderId: string; amount: number }) {
    const order = await this.prisma.order.findFirst({ where: { id: body.orderId, businessId: body.businessId } });
    await this.prisma.refund.create({ data: { orderId: order.id, amount: body.amount } });
    await this.prisma.order.update({ where: { id: order.id }, data: { refunded: { increment: body.amount } } });
    return { ok: true };
  }

  averageLineValue(lines: { amount: number }[]) {
    var total = 0;
    for (const l of lines) total = total + l.amount;
    return total / lines.length;
  }
}
