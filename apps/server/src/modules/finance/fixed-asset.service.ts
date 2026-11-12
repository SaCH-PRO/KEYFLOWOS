import { Inject, Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PostingService, type PostingInput } from './posting.service';
import { AccountingPeriodService } from './accounting-period.service';

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
    @Inject(AccountingPeriodService) private readonly periods: AccountingPeriodService,
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

  /**
   * Bring the asset's accumulated depreciation up to `asOf` and post the
   * increment.
   *
   * V1-15b (V1-15 review CR-2): the asset row and its posting are one
   * transaction, so a posting the door refuses (409 for a date inside a
   * CLOSED period) leaves the row as it was. The update is a compare-and-set
   * on the accumulated figure and the status this run started from, so two
   * concurrent runs cannot both apply it. Each increment is keyed by the
   * accumulated figure it brings the asset to (`FixedAsset:<id>:depreciation:<to>`),
   * so every run posts its own delta (one key for every run deduped all but
   * the first and let the row run ahead of the ledger).
   *
   * V1-15b review repairs:
   *  - SEC-V15b-1: the run's date is checked against the CLOSED periods first,
   *    before anything is written and whether or not the run would post, so a
   *    run dated inside a closed month is refused (409) and writes nothing.
   *    Accumulated depreciation only moves forward: a run that would not raise
   *    it (a replay, or an earlier asOf) writes nothing and returns the asset
   *    as it is. Writing the figure down left the ledger above the row, and
   *    the next run then posted the whole climb back a second time.
   *  - SEC-V15b-2 / CRR-2: a DISPOSED asset is not depreciated (400). The
   *    status is part of the compare-and-set, so a disposal that commits first
   *    makes the run refuse instead of writing the asset back to ACTIVE or
   *    posting depreciation the disposal already took off the books.
   */
  async runDepreciation(businessId: string, id: string, asOf?: Date) {
    const asset = await this.get(businessId, id);
    if (asset.status === 'DISPOSED') throw new BadRequestException('Cannot depreciate a disposed asset');
    const calc = await this.calculateDepreciation(businessId, id, asOf);
    const date = asOf ?? new Date();

    const currentAccumulated = new D(String(asset.accumulatedDepreciation));
    const target = new D(String(calc.accumulatedDepreciation));
    const delta = target.sub(currentAccumulated);
    // Resolved before anything is written: a missing account refuses the run whole.
    const accounts = delta.greaterThan(0)
      ? {
          depExpense: await this.resolveCoa(businessId, 'DEPRECIATION_EXPENSE'),
          accDep: await this.resolveCoa(businessId, 'ACCUMULATED_DEPRECIATION'),
        }
      : null;

    return this.prisma.client.$transaction(async (rawTx) => {
      const tx = rawTx as unknown as Prisma.TransactionClient;
      // Every run, under the period lock of its date's month, before any write (SEC-V15b-1).
      await this.periods.assertOpenForPosting(businessId, date, tx);
      // Nothing to add: the figure is never written down.
      if (!accounts) return tx.fixedAsset.findUniqueOrThrow({ where: { id } });

      // From the figure and the status read above (never DISPOSED: refused above).
      const updated = await tx.fixedAsset.updateMany({
        where: { id, businessId, status: asset.status, accumulatedDepreciation: asset.accumulatedDepreciation },
        data: {
          accumulatedDepreciation: calc.accumulatedDepreciation,
          netBookValue: calc.netBookValue,
          status: calc.status,
        },
      });
      if (updated.count !== 1) {
        const current = await tx.fixedAsset.findFirst({ where: { id, businessId }, select: { status: true } });
        if (current?.status === 'DISPOSED') throw new BadRequestException('Cannot depreciate a disposed asset');
        throw new ConflictException('Fixed asset changed while its depreciation ran; retry');
      }

      // Post incremental depreciation to the General Ledger
      const posting: PostingInput = {
        businessId,
        type: 'ADJUSTMENT',
        date,
        amount: delta,
        description: `Depreciation — ${asset.name}`,
        sourceType: 'FixedAsset',
        sourceId: asset.id,
        kind: `depreciation:${target.toFixed(4)}`,
        entries: [
          { accountId: accounts.depExpense.id, debit: delta, memo: `Depreciation expense for ${asset.name}` },
          { accountId: accounts.accDep.id, credit: delta, memo: `Accumulated depreciation for ${asset.name}` },
        ],
      };
      await this.posting.post(posting, tx);

      return tx.fixedAsset.findUniqueOrThrow({ where: { id } });
    });
  }

  /**
   * Dispose of the asset and post the disposal.
   *
   * V1-15b (V1-15 review CR-2): the DISPOSED row and the disposal posting are
   * one transaction, so a posting the door refuses (409 for a date inside a
   * CLOSED period, or any other refusal) leaves the asset as it was. The
   * status flip is a compare-and-set, so of two concurrent disposals one
   * posts and the other answers 400. A zero leg (no proceeds, no accumulated
   * depreciation) is left out: the door refuses an entry with neither side.
   *
   * V1-15b review SEC-V15b-2: a disposal the ledger already holds for an asset
   * whose row is not DISPOSED (a row a depreciation run wrote back before that
   * repair) is refused (409) rather than replayed: the replay posted nothing,
   * passed no period check, and rewrote proceeds and a date the ledger never had.
   */
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

    // Resolved before anything is written: a missing account refuses the disposal whole.
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
    const legs = entries.filter((e) => !new D(String(e.debit ?? 0)).eq(0) || !new D(String(e.credit ?? 0)).eq(0));

    return this.prisma.client.$transaction(async (rawTx) => {
      const tx = rawTx as unknown as Prisma.TransactionClient;
      // From the accumulated figure the entries were built from, and only once.
      const claimed = await tx.fixedAsset.updateMany({
        where: { id, businessId, status: { not: 'DISPOSED' }, accumulatedDepreciation: asset.accumulatedDepreciation },
        data: {
          status: 'DISPOSED',
          disposalDate: dDate,
          disposalProceeds: proceedsD,
        },
      });
      if (claimed.count !== 1) {
        const current = await tx.fixedAsset.findFirst({ where: { id, businessId }, select: { status: true } });
        if (current?.status === 'DISPOSED') throw new BadRequestException('Already disposed');
        throw new ConflictException('Fixed asset changed while it was being disposed; retry');
      }

      // Post disposal transaction to General Ledger
      const posted = await this.posting.post(
        {
          businessId,
          type: 'ADJUSTMENT',
          date: dDate,
          amount: cost,
          description: `Disposal — ${asset.name}`,
          sourceType: 'FixedAsset',
          sourceId: asset.id,
          kind: 'disposal',
          entries: legs,
        },
        tx,
      );
      if (posted.alreadyPosted) {
        throw new ConflictException('A disposal is already posted for this asset but its row does not show it; nothing was changed');
      }

      return tx.fixedAsset.findUniqueOrThrow({ where: { id } });
    });
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
