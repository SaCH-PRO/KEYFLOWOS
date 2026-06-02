import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface EntityResolutionInput {
  type: string;
  id: string;
}

export interface EntityResolutionResult {
  type: string;
  id: string;
  label: string;
  subtitle?: string;
  href?: string;
  workspace?: string;
}

@Injectable()
export class EntityResolverService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async resolveMany(businessId: string, entities: EntityResolutionInput[]): Promise<EntityResolutionResult[]> {
    const results: EntityResolutionResult[] = [];
    for (const e of entities) {
      try {
        const resolved = await this.resolveOne(businessId, e.type, e.id);
        results.push(resolved);
      } catch {
        results.push({ type: e.type, id: e.id, label: 'Unknown' });
      }
    }
    return results;
  }

  async resolveOne(businessId: string, type: string, id: string): Promise<EntityResolutionResult> {
    if (!businessId || !type || !id) {
      throw new BadRequestException('Missing businessId, type, or id');
    }

    switch (type) {
      case 'contact':
        return this.resolveContact(businessId, id);
      case 'invoice':
        return this.resolveInvoice(businessId, id);
      case 'quote':
        return this.resolveQuote(businessId, id);
      case 'payment':
        return this.resolvePayment(businessId, id);
      case 'booking':
        return this.resolveBooking(businessId, id);
      case 'project':
        return this.resolveProject(businessId, id);
      case 'task':
        return this.resolveTask(businessId, id);
      case 'product':
        return this.resolveProduct(businessId, id);
      case 'expense':
        return this.resolveExpense(businessId, id);
      case 'deal':
        return this.resolveDeal(businessId, id);
      case 'sequence':
        return this.resolveSequence(businessId, id);
      case 'asset':
        return this.resolveAsset(businessId, id);
      case 'document':
        return this.resolveDocument(businessId, id);
      case 'sop':
        return this.resolveSop(businessId, id);
      case 'command':
        return this.resolveCommand(businessId, id);
      default:
        throw new BadRequestException(`Unknown entity type: ${type}`);
    }
  }

  private async resolveContact(businessId: string, id: string): Promise<EntityResolutionResult> {
    const c = await this.prisma.client.contact.findFirst({
      where: { businessId, id },
      select: { firstName: true, lastName: true, email: true, companyName: true, displayName: true },
    });
    if (!c) throw new NotFoundException();
    const name = c.displayName || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Contact';
    return {
      type: 'contact',
      id,
      label: name,
      subtitle: c.companyName || undefined,
      href: `/app/network/contacts/${id}`,
      workspace: 'contacts',
    };
  }

  private async resolveInvoice(businessId: string, id: string): Promise<EntityResolutionResult> {
    const inv = await this.prisma.client.invoice.findFirst({
      where: { businessId, id },
      select: { invoiceNumber: true, status: true, total: true, currency: true },
    });
    if (!inv) throw new NotFoundException();
    return {
      type: 'invoice',
      id,
      label: inv.invoiceNumber ?? `Invoice #${id.slice(0, 8)}`,
      subtitle: `${inv.status} · ${inv.currency ?? ''}${inv.total ?? 0}`,
      href: `/app/commerce/invoices/${id}`,
      workspace: 'commerce',
    };
  }

  private async resolveQuote(businessId: string, id: string): Promise<EntityResolutionResult> {
    const q = await this.prisma.client.quote.findFirst({
      where: { businessId, id },
      select: { quoteNumber: true, status: true, total: true, currency: true },
    });
    if (!q) throw new NotFoundException();
    return {
      type: 'quote',
      id,
      label: q.quoteNumber ?? `Quote #${id.slice(0, 8)}`,
      subtitle: `${q.status} · ${q.currency ?? ''}${q.total ?? 0}`,
      href: `/app/commerce/quotes/${id}`,
      workspace: 'commerce',
    };
  }

  private async resolvePayment(businessId: string, id: string): Promise<EntityResolutionResult> {
    const p = await this.prisma.client.payment.findFirst({
      where: { businessId, id },
      select: { amount: true, currency: true, status: true, notes: true, reference: true },
    });
    if (!p) throw new NotFoundException();
    return {
      type: 'payment',
      id,
      label: p.reference ?? p.notes ?? `Payment #${id.slice(0, 8)}`,
      subtitle: `${p.status} · ${p.currency ?? ''}${p.amount ?? 0}`,
      href: `/app/payments/${id}`,
      workspace: 'commerce',
    };
  }

  private async resolveBooking(businessId: string, id: string): Promise<EntityResolutionResult> {
    const b = await this.prisma.client.booking.findFirst({
      where: { businessId, id },
      select: { status: true, startTime: true, contact: { select: { firstName: true, lastName: true } } },
    });
    if (!b) throw new NotFoundException();
    const contactName = [b.contact?.firstName, b.contact?.lastName].filter(Boolean).join(' ') || 'Booking';
    return {
      type: 'booking',
      id,
      label: contactName,
      subtitle: `${b.status}${b.startTime ? ' · ' + new Date(b.startTime).toLocaleDateString() : ''}`,
      href: `/app/bookings/${id}`,
      workspace: 'calendar',
    };
  }

  private async resolveProject(businessId: string, id: string): Promise<EntityResolutionResult> {
    const p = await this.prisma.client.project.findFirst({
      where: { businessId, id },
      select: { name: true, status: true },
    });
    if (!p) throw new NotFoundException();
    return {
      type: 'project',
      id,
      label: p.name,
      subtitle: p.status,
      href: `/app/projects/${id}`,
      workspace: 'operations',
    };
  }

  private async resolveTask(businessId: string, id: string): Promise<EntityResolutionResult> {
    const t = await this.prisma.client.projectTask.findFirst({
      where: { project: { businessId }, id },
      select: { title: true, status: true, priority: true },
    });
    if (!t) throw new NotFoundException();
    return {
      type: 'task',
      id,
      label: t.title,
      subtitle: `${t.status} · ${t.priority}`,
      href: `/app/tasks/${id}`,
      workspace: 'operations',
    };
  }

  private async resolveProduct(businessId: string, id: string): Promise<EntityResolutionResult> {
    const p = await this.prisma.client.product.findFirst({
      where: { businessId, id },
      select: { name: true, isActive: true, price: true, currency: true },
    });
    if (!p) throw new NotFoundException();
    return {
      type: 'product',
      id,
      label: p.name,
      subtitle: `${p.isActive ? 'Active' : 'Inactive'} · ${p.currency ?? ''}${p.price ?? 0}`,
      href: `/app/commerce/products/${id}`,
      workspace: 'commerce',
    };
  }

  private async resolveExpense(businessId: string, id: string): Promise<EntityResolutionResult> {
    const e = await this.prisma.client.expense.findFirst({
      where: { businessId, id },
      select: { description: true, amount: true, currency: true, status: true },
    });
    if (!e) throw new NotFoundException();
    return {
      type: 'expense',
      id,
      label: e.description ?? `Expense #${id.slice(0, 8)}`,
      subtitle: `${e.status ?? 'Recorded'} · ${e.currency ?? ''}${e.amount ?? 0}`,
      href: `/app/expenses/${id}`,
      workspace: 'finance',
    };
  }

  private async resolveDeal(businessId: string, id: string): Promise<EntityResolutionResult> {
    const d = await this.prisma.client.deal.findFirst({
      where: { businessId, id },
      select: { title: true, stage: { select: { name: true } }, value: true, currency: true },
    });
    if (!d) throw new NotFoundException();
    return {
      type: 'deal',
      id,
      label: d.title,
      subtitle: `${d.stage?.name ?? ''} · ${d.currency ?? ''}${d.value ?? 0}`,
      href: `/app/network/deals/${id}`,
      workspace: 'contacts',
    };
  }

  private async resolveSequence(businessId: string, id: string): Promise<EntityResolutionResult> {
    const s = await this.prisma.client.crmSequence.findFirst({
      where: { businessId, id },
      select: { name: true, status: true },
    });
    if (!s) throw new NotFoundException();
    return {
      type: 'sequence',
      id,
      label: s.name,
      subtitle: s.status,
      href: `/app/network/sequences/${id}`,
      workspace: 'contacts',
    };
  }

  private async resolveAsset(businessId: string, id: string): Promise<EntityResolutionResult> {
    const a = await this.prisma.client.asset.findFirst({
      where: { businessId, id },
      select: { name: true, type: true },
    });
    if (!a) throw new NotFoundException();
    return {
      type: 'asset',
      id,
      label: a.name,
      subtitle: a.type,
      href: `/app/assets/${id}`,
      workspace: 'operations',
    };
  }

  private async resolveDocument(businessId: string, id: string): Promise<EntityResolutionResult> {
    const d = await this.prisma.client.documentInstance.findFirst({
      where: { businessId, id },
      select: { title: true, status: true },
    });
    if (!d) throw new NotFoundException();
    return {
      type: 'document',
      id,
      label: d.title ?? `Document #${id.slice(0, 8)}`,
      subtitle: d.status ?? undefined,
      href: `/app/documents/${id}`,
      workspace: 'operations',
    };
  }

  private async resolveSop(businessId: string, id: string): Promise<EntityResolutionResult> {
    const s = await this.prisma.client.sopDocument.findFirst({
      where: { businessId, id },
      select: { title: true, department: true },
    });
    if (!s) throw new NotFoundException();
    return {
      type: 'sop',
      id,
      label: s.title,
      subtitle: s.department,
      href: `/app/sops/${id}`,
      workspace: 'operations',
    };
  }

  private async resolveCommand(businessId: string, id: string): Promise<EntityResolutionResult> {
    const c = await this.prisma.client.commandItem.findFirst({
      where: { businessId, id },
      select: { title: true, status: true, priority: true },
    });
    if (!c) throw new NotFoundException();
    return {
      type: 'command',
      id,
      label: c.title,
      subtitle: `${c.status} · priority ${c.priority}`,
      href: `/app/command-center?selected=${id}`,
      workspace: 'cockpit',
    };
  }
}
