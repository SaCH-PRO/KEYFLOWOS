import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ConstitutionVersionService } from './constitution-version.service';

export interface GenomeIntegrityChangedPayload {
  businessId: string;
  previousIntegrity: number;
  currentIntegrity: number;
  genomeStage: string;
  executiveReadinessScore: number;
}

@Injectable()
export class GenomeIntegrityChangeListener {
  private readonly logger = new Logger(GenomeIntegrityChangeListener.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConstitutionVersionService) private readonly constitution: ConstitutionVersionService,
  ) {}

  @OnEvent('genome.integrity_changed')
  async handleIntegrityChange(payload: GenomeIntegrityChangedPayload): Promise<void> {
    const { businessId, previousIntegrity, currentIntegrity } = payload;
    const delta = currentIntegrity - previousIntegrity;

    if (Math.abs(delta) < 1) {
      return;
    }

    this.logger.log(
      `Genome integrity changed by ${delta >= 0 ? '+' : ''}${Math.round(delta)} points for ${businessId}; auto-versioning constitution.`,
    );

    try {
      const version = await this.constitution.generate(
        businessId,
        {
          changeNotes: `Auto-versioned: genome integrity changed from ${previousIntegrity}% to ${currentIntegrity}% (${delta >= 0 ? '+' : ''}${Math.round(delta)}).`,
        },
        'system',
      );

      await this.prisma.client.businessBlueprint.update({
        where: { businessId },
        data: {
          constitutionVersion: version.version,
          constitutionGeneratedAt: new Date(),
        },
      });
    } catch (err) {
      this.logger.warn(
        `Auto-constitution versioning failed for ${businessId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
