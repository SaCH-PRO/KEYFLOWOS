import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export type UnifiedAutonomyMode = 'advisory' | 'assisted' | 'pro_auto' | 'autopilot';

export interface UnifiedAutonomyLevel {
  level: number; // 0–5
  mode: UnifiedAutonomyMode;
  maxAutoRiskTier: number; // 1–4
  label: string;
}

/**
 * Canonical resolver for a business's autonomy level.
 *
 * Precedence:
 *  1. AutopilotSettings.autonomyLevel (typed settings)
 *  2. BusinessBlueprint.aiPreferences.autonomyLevel (operator intent)
 *  3. BusinessSettings.aiAutonomyLevel (legacy string)
 *  4. default level 2 (assisted)
 */
@Injectable()
export class AutonomyLevelService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(businessId: string): Promise<UnifiedAutonomyLevel> {
    const [autopilot, blueprint, settings] = await Promise.all([
      this.prisma.client.autopilotSettings
        .findUnique({ where: { businessId } })
        .catch(() => null),
      this.prisma.client.businessBlueprint
        .findUnique({ where: { businessId } })
        .catch(() => null),
      this.prisma.client.businessSetting
        .findUnique({ where: { businessId } })
        .catch(() => null),
    ]);

    let level = 2;
    let source = 'default';

    if (autopilot?.autonomyLevel !== undefined && autopilot.autonomyLevel !== null) {
      level = this.clampLevel(autopilot.autonomyLevel);
      source = 'autopilot_settings';
    } else if ((blueprint?.aiPreferences as Record<string, unknown> | undefined)?.autonomyLevel !== undefined) {
      const bpLevel = Number((blueprint!.aiPreferences as Record<string, unknown>).autonomyLevel);
      level = this.clampLevel(Number.isFinite(bpLevel) ? bpLevel : 2);
      source = 'business_blueprint';
    } else if (settings?.aiAutonomyLevel) {
      level = this.levelFromString(settings.aiAutonomyLevel);
      source = 'business_settings';
    }

    return {
      level,
      mode: this.modeFromLevel(level),
      maxAutoRiskTier: Math.max(1, Math.min(4, level)),
      label: `${source}:${level}`,
    };
  }

  private clampLevel(level: number): number {
    return Math.max(0, Math.min(5, Number(level) || 2));
  }

  private levelFromString(value: string): number {
    switch (value?.toLowerCase()) {
      case 'manual':
      case 'advisory':
        return 0;
      case 'supervised':
        return 2;
      case 'full':
      case 'autopilot':
        return 4;
      default:
        return 2;
    }
  }

  private modeFromLevel(level: number): UnifiedAutonomyMode {
    if (level <= 0) return 'advisory';
    if (level <= 2) return 'assisted';
    if (level <= 4) return 'pro_auto';
    return 'autopilot';
  }
}
