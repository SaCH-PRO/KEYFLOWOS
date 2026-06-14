import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PostingService, type PostingInput } from './posting.service';

export interface CreateFixedAssetInput {
  name: string;
  category: string;
  purchaseDate: string;
  purchaseCost: number;
  salvageValue?: number;
  usefulLifeMonths: number;
  depreciationMethod?: string;
}

export interface UpdateFixedAssetInput {
  name?: string;
  category?: string;
  salvageValue?: number;
  usefulLifeMonths?: number;
  depreciationMethod?: string;
}

const D = Prisma.Decimal;

@Injectable()
export class FixedAssetService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PostingService) private readonly posting: PostingService,
  ) {}

  async list(businessId: string) {
    return this.prisma.client.fixedAsset.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(businessId: string, id: string) {
    const asset = await this.prisma.client.fixedAsset.findFirst({
      where: { id, businessId },
    });
    if (!asset) throw new NotFoundException('Fixed asset not found');
    return asset;
  }

  async create(businessId: string, input: CreateFixedAssetInput) {
    if (input.usefulLifeMonths <= 0) {
      throw new BadRequestException('Useful life must be greater than 0');
    }
    const cost = new D(String(input.purchaseCost));
    const salvage = new D(String(input.salvageValue ?? 0));
    const nbv = cost.sub(salvage).greaterThan(0) ? cost.sub(salvage) : cost;

    return this.prisma.client.fixedAsset.create({
      data: {
        businessId,
        name: input.name,
        category: input.category,
        purchaseDate: new Date(input.purchaseDate),
        purchaseCost: cost,
        salvageValue: salvage,
        usefulLifeMonths: input.usefulLifeMonths,
        depreciationMethod: input.depreciationMethod ?? 'straight_line',
        accumulatedDepreciation: new D(0),
        netBookValue: nbv,
      },
    });
  }

  async update(businessId: string, id: string, input: UpdateFixedAssetInput) {
    const asset = await this.get(businessId, id);
    if (asset.status === 'DISPOSED') throw new BadRequestException('Cannot update a disposed asset');

    return this.prisma.client.fixedAsset.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.category !== undefined && { category: input.category }),
        ...(input.salvageValue !== undefined && { salvageValue: new D(String(input.salvageValue)) }),
        ...(input.usefulLifeMonths !== undefined && { usefulLifeMonths: input.usefulLifeMonths }),
        ...(input.depreciationMethod !== undefined && { depreciationMethod: input.depreciationMethod }),
      },
    });
  }

  async calculateDepreciation(businessId: string, id: string, asOf?: Date) {
    const asset = await this.get(businessId, id);
    const cost = new D(String(asset.purchaseCost));
    const salvage = new D(String(asset.salvageValue ?? 0));
    const life = asset.usefulLifeMonths;
    const method = asset.depreciationMethod;

    const endDate = asOf ?? new Date();
    const monthsElapsed = Math.max(0, Math.min(
      life,
      (endDate.getFullYear() - asset.purchaseDate.getFullYear()) * 12 +
      (endDate.getMonth() - asset.purchaseDate.getMonth()),
    ));

    let accumulated = new D(0);
    let monthly = new D(0);

    if (method === 'straight_line') {
      monthly = cost.sub(salvage).dividedBy(life);
      accumulated = monthly.times(monthsElapsed);
    } else if (method === 'reducing_balance') {
      const annualRate = new D(0.25); // 25% reducing balance annual rate
      const monthlyRate = annualRate.div(12);
      let book = cost;
      for (let m = 0; m < monthsElapsed; m++) {
        const monthlyDep = book.times(monthlyRate);
        book = book.sub(monthlyDep);
      }
      accumulated = cost.sub(book);
      monthly = accumulated.dividedBy(Math.max(1, monthsElapsed));
    }

    // Cap at cost - salvage
    const maxDep = cost.sub(salvage);
    if (accumulated.greaterThan(maxDep)) accumulated = maxDep;

    const nbv = cost.sub(accumulated);
    const status = nbv.lessThanOrEqualTo(salvage) ? 'FULLY_DEPRECIATED' : asset.status;

    return {
      assetId: asset.id,
      purchaseCost: cost,
      salvageValue: salvage,
      usefulLifeMonths: life,
      monthsElapsed,
      depreciationMethod: method,
      monthlyDepreciation: monthly,
      accumulatedDepreciation: accumulated,
      netBookValue: nbv,
      status,
    };
  }

  async runDepreciation(businessId: string, id: string, asOf?: Date) {
    const asset = await this.get(businessId, id);
    const calc = await this.calculateDepreciation(businessId, id, asOf);

    const currentAccumulated = new D(String(asset.accumulatedDepreciation));
    const delta = new D(String(calc.accumulatedDepreciation)).sub(currentAccumulated);

    const updated = await this.prisma.client.fixedAsset.update({
      where: { id },
      data: {
        accumulatedDepreciation: calc.accumulatedDepreciation,
        netBookValue: calc.netBookValue,
        status: calc.status,
      },
    });

    // Post incremental depreciation to the General Ledger
    if (delta.greaterThan(0)) {
      const depExpenseCoa = await this.resolveCoa(businessId, 'DEPRECIATION_EXPENSE');
      const accDepCoa = await this.resolveCoa(businessId, 'ACCUMULATED_DEPRECIATION');

      const posting: PostingInput = {
        businessId,
        type: 'ADJUSTMENT',
        date: asOf ?? new Date(),
        amount: delta,
        description: `Depreciation — ${asset.name}`,
        sourceType: 'FixedAsset',
        sourceId: asset.id,
        kind: 'depreciation',
        entries: [
          { accountId: depExpenseCoa.id, debit: delta, memo: `Depreciation expense for ${asset.name}` },
          { accountId: accDepCoa.id, credit: delta, memo: `Accumulated depreciation for ${asset.name}` },
        ],
      };
      await this.posting.post(posting);
    }

    return updated;
  }

  async dispose(businessId: string, id: string, proceeds: number, disposalDate?: string) {
    const asset = await this.get(businessId, id);
    if (asset.status === 'DISPOSED') throw new BadRequestException('Already disposed');

    const dDate = disposalDate ? new Date(disposalDate) : new Date();
    if (Number.isNaN(dDate.getTime())) throw new BadRequestException('Invalid disposalDate');

    const cost = new D(String(asset.purchaseCost));
    const accumulated = new D(String(asset.accumulatedDepreciation));
    const nbv = cost.sub(accumulated);
    const proceedsD = new D(String(proceeds));
    const gainLoss = proceedsD.sub(nbv);

    const updated = await this.prisma.client.fixedAsset.update({
      where: { id },
      data: {
        status: 'DISPOSED',
        disposalDate: dDate,
        disposalProceeds: proceedsD,
      },
    });

    // Post disposal transaction to General Ledger
    const cashCoa = await this.resolveCoa(businessId, 'BANK');
    const accDepCoa = await this.resolveCoa(businessId, 'ACCUMULATED_DEPRECIATION');
    const assetCoa = await this.resolveCoa(businessId, 'FIXED_ASSET_EQUIPMENT');
    const gainLossCoa = await this.resolveCoa(businessId, 'GAIN_LOSS_ON_DISPOSAL');

    const entries: PostingInput['entries'] = [
      { accountId: cashCoa.id, debit: proceedsD, memo: `Proceeds from disposal of ${asset.name}` },
      { accountId: accDepCoa.id, debit: accumulated, memo: `Remove accumulated depreciation for ${asset.name}` },
      { accountId: assetCoa.id, credit: cost, memo: `Remove asset cost for ${asset.name}` },
    ];

    if (gainLoss.greaterThan(0)) {
      entries.push({ accountId: gainLossCoa.id, credit: gainLoss, memo: `Gain on disposal of ${asset.name}` });
    } else if (gainLoss.lessThan(0)) {
      entries.push({ accountId: gainLossCoa.id, debit: gainLoss.abs(), memo: `Loss on disposal of ${asset.name}` });
    }

    await this.posting.post({
      businessId,
      type: 'ADJUSTMENT',
      date: dDate,
      amount: cost,
      description: `Disposal — ${asset.name}`,
      sourceType: 'FixedAsset',
      sourceId: asset.id,
      kind: 'disposal',
      entries,
    });

    return updated;
  }

  async remove(businessId: string, id: string) {
    await this.get(businessId, id);
    return this.prisma.client.fixedAsset.delete({ where: { id } });
  }

  private async resolveCoa(businessId: string, systemKey: string) {
    const coa = await this.prisma.client.chartOfAccount.findFirst({
      where: { businessId, systemKey },
      select: { id: true, name: true },
    });
    if (!coa) throw new BadRequestException(`Chart of account with systemKey "${systemKey}" not found. Run chart-of-accounts seeding.`);
    return coa;
  }
}
