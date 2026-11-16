import { Controller, Get, Param, Post, Body, Query, UseGuards, ParseEnumPipe, Inject, NotFoundException, Req } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { assertMemberModuleLevel, type ModuleLevelActor } from '../../core/auth/member-module-level';
import { PrismaService } from '../../core/prisma/prisma.service';
import { FlowSignalService } from './flow-signal.service';
import { FlowRouterService } from './flow-router.service';
import { RoleFlowService } from './role-flow.service';
import { FlowSignalQuery } from './flow-signal.types';
import { FlowType } from '@prisma/client';
import { HiddenModuleWrites, HiddenModuleWritesExempt } from '../../core/auth/hidden-module-writes.decorator';

type MemberRequest = { user?: ModuleLevelActor };

/**
 * SWP-CENSUS-HIDDEN review repair (COR-HID-1). A signal's status (resolve, action required, snooze) is changed by a
 * member with write on the signal's own module, checked in the handler: revenue for a money signal, automations
 * (KEY flows' own scope, the class gate's) for any other. The class gate's automations write broke the AR Clerk Queue
 * on Money > Overview (/app/financial-flow, a v1 page): a member who may send the overdue-invoice reminder (revenue
 * write) could no longer clear the item, and the queue offered the reminder again.
 */
const SIGNAL_OWN_MODULE =
  "a signal's status needs write on the signal's own module, checked in the handler: revenue for a money signal, automations for any other (SWP-CENSUS-HIDDEN review COR-HID-1)";

@HiddenModuleWrites('key_flows', 'automations')
@Controller('flow-signals/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class FlowSignalController {
  constructor(
    @Inject(FlowSignalService) private readonly flowSignalService: FlowSignalService,
    @Inject(RoleFlowService) private readonly roleFlowService: RoleFlowService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FlowRouterService) private readonly flowRouter: FlowRouterService,
  ) {}

  /**
   * The module whose write a status change of this business's signal needs (404 for a signal it does not hold). A
   * money signal is one in the FINANCIAL flow, or one the flow router files there by its type, module or entity (an
   * invoice.overdue signal stored under PEOPLE or TEMPORAL only is still listed by the AR Clerk Queue).
   */
  private async signalModule(businessId: string, signalId: string): Promise<'revenue' | 'automations'> {
    const signal = await this.prisma.client.flowSignal.findFirst({
      where: { id: signalId, businessId },
      select: { flows: true, type: true, module: true, entityType: true },
    });
    if (!signal) throw new NotFoundException('Flow signal not found');
    const filed = this.flowRouter.route({
      businessId,
      source: 'status-change',
      title: '',
      type: signal.type,
      module: signal.module ?? undefined,
      entityType: signal.entityType ?? undefined,
      flows: [],
    }).flows;
    const money = signal.flows.includes(FlowType.FINANCIAL) || (filed ?? []).includes(FlowType.FINANCIAL);
    return money ? 'revenue' : 'automations';
  }

  @Get()
  async list(
    @Param('businessId') businessId: string,
    @Query('flow') flow?: FlowType,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('ownerRoleHint') ownerRoleHint?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const query: FlowSignalQuery = {
      ...(flow && { flows: flow }),
      ...(type && { type }),
      ...(status && { status: status.split(',') as any }),
      ...(ownerRoleHint && { ownerRoleHint }),
      ...(limit && { limit: Number(limit) }),
      ...(offset && { offset: Number(offset) }),
    };
    return this.flowSignalService.list(businessId, query);
  }

  @Get('role/:roleKey')
  async getRoleQueue(
    @Param('businessId') businessId: string,
    @Param('roleKey') roleKey: string,
  ) {
    return this.roleFlowService.getRoleQueue(businessId, roleKey);
  }

  @HiddenModuleWritesExempt(SIGNAL_OWN_MODULE)
  @Post(':id/resolve')
  async resolve(
    @Param('businessId') businessId: string,
    @Param('id') signalId: string,
    @Req() req?: MemberRequest,
  ) {
    await assertMemberModuleLevel(this.prisma, businessId, req?.user, await this.signalModule(businessId, signalId), 'write');
    return this.flowSignalService.markResolved(businessId, signalId);
  }

  @HiddenModuleWritesExempt(SIGNAL_OWN_MODULE)
  @Post(':id/action-required')
  async actionRequired(
    @Param('businessId') businessId: string,
    @Param('id') signalId: string,
    @Req() req?: MemberRequest,
  ) {
    await assertMemberModuleLevel(this.prisma, businessId, req?.user, await this.signalModule(businessId, signalId), 'write');
    return this.flowSignalService.markActionRequired(businessId, signalId);
  }

  @HiddenModuleWritesExempt(SIGNAL_OWN_MODULE)
  @Post(':id/snooze')
  async snooze(
    @Param('businessId') businessId: string,
    @Param('id') signalId: string,
    @Body('until') until: string,
    @Req() req?: MemberRequest,
  ) {
    await assertMemberModuleLevel(this.prisma, businessId, req?.user, await this.signalModule(businessId, signalId), 'write');
    return this.flowSignalService.snooze(businessId, signalId, new Date(until));
  }
}
