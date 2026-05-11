import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

type PrismaFeatureFlagRow = {
  id: string;
  key: string;
  label: string;
  category: string | null;
  comingSoon: boolean;
  bypassEmails: string[];
  createdAt: Date;
  updatedAt: Date;
};

export interface FeatureFlagRecord {
  id: string;
  key: string;
  label: string;
  category: string | null;
  comingSoon: boolean;
  bypassEmails: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedFeatureFlag {
  key: string;
  label: string;
  category: string | null;
  comingSoon: boolean;
  bypass: boolean;
}

interface KnownFlag {
  key: string;
  label: string;
  category: string;
  defaultComingSoon: boolean;
  defaultBypassEmails: string[];
}

const KNOWN_FLAGS: KnownFlag[] = [
  {
    key: 'nav.workspaces.seo',
    label: 'SEO',
    category: 'Workspaces',
    defaultComingSoon: true,
    defaultBypassEmails: ['keyflowos.tt@gmail.com'],
  },
  // ---
  // KEY-0 dormant modules — kept in-tree but hidden from operators while
  // the seven-system overhaul lands. Items here are reachable only by
  // bypass emails. Removed entirely in KEY-9 cleanup if still untouched.
  // ---
  {
    key: 'nav.workspaces.documents',
    label: 'Documents',
    category: 'Workspaces',
    defaultComingSoon: true,
    defaultBypassEmails: ['keyflowos.tt@gmail.com'],
  },
  {
    key: 'nav.public.community',
    label: 'Community',
    category: 'Public',
    defaultComingSoon: true,
    defaultBypassEmails: ['keyflowos.tt@gmail.com'],
  },
  {
    key: 'nav.public.learn',
    label: 'Learn',
    category: 'Public',
    defaultComingSoon: true,
    defaultBypassEmails: ['keyflowos.tt@gmail.com'],
  },
  {
    key: 'nav.public.marketplace',
    label: 'Marketplace',
    category: 'Public',
    defaultComingSoon: true,
    defaultBypassEmails: ['keyflowos.tt@gmail.com'],
  },
];

@Injectable()
export class FeatureFlagsService {
  private readonly logger = new Logger(FeatureFlagsService.name);
  private seeded = false;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async ensureSeeded(): Promise<void> {
    if (this.seeded) return;
    for (const known of KNOWN_FLAGS) {
      try {
        await this.prisma.client.featureFlag.upsert({
          where: { key: known.key },
          create: {
            key: known.key,
            label: known.label,
            category: known.category,
            comingSoon: known.defaultComingSoon,
            bypassEmails: known.defaultBypassEmails.map((e) => e.toLowerCase()),
          },
          update: {},
        });
      } catch (err) {
        this.logger.warn(`Failed to seed feature flag ${known.key}: ${(err as Error).message}`);
      }
    }
    this.seeded = true;
  }

  private toRecord(row: PrismaFeatureFlagRow): FeatureFlagRecord {
    return {
      id: row.id,
      key: row.key,
      label: row.label,
      category: row.category,
      comingSoon: row.comingSoon,
      bypassEmails: row.bypassEmails,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async listAll(): Promise<FeatureFlagRecord[]> {
    await this.ensureSeeded();
    const rows = await this.prisma.client.featureFlag.findMany({
      orderBy: [{ category: 'asc' }, { label: 'asc' }],
    });
    return rows.map((r) => this.toRecord(r));
  }

  async hasBypass(key: string, email: string | null | undefined): Promise<{ exists: boolean; comingSoon: boolean; bypass: boolean }> {
    await this.ensureSeeded();
    const row = await this.prisma.client.featureFlag.findUnique({ where: { key } });
    if (!row) return { exists: false, comingSoon: false, bypass: false };
    const normalized = (email ?? '').trim().toLowerCase();
    return {
      exists: true,
      comingSoon: row.comingSoon,
      bypass: normalized.length > 0 && row.bypassEmails.includes(normalized),
    };
  }

  async resolveForUser(email: string | null | undefined): Promise<ResolvedFeatureFlag[]> {
    const all = await this.listAll();
    const normalized = (email ?? '').trim().toLowerCase();
    return all.map((f) => ({
      key: f.key,
      label: f.label,
      category: f.category,
      comingSoon: f.comingSoon,
      bypass: normalized.length > 0 && f.bypassEmails.includes(normalized),
    }));
  }

  async update(
    key: string,
    patch: { comingSoon?: boolean; bypassEmails?: string[]; label?: string; category?: string | null },
  ): Promise<FeatureFlagRecord> {
    await this.ensureSeeded();
    const data: Record<string, unknown> = {};
    if (typeof patch.comingSoon === 'boolean') data.comingSoon = patch.comingSoon;
    if (Array.isArray(patch.bypassEmails)) {
      data.bypassEmails = patch.bypassEmails
        .map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
        .filter((e) => e.length > 0);
    }
    if (typeof patch.label === 'string' && patch.label.trim().length > 0) data.label = patch.label.trim();
    if (patch.category === null || typeof patch.category === 'string') data.category = patch.category;

    const existing = await this.prisma.client.featureFlag.findUnique({ where: { key } });
    if (!existing) {
      throw new NotFoundException(`Feature flag "${key}" not found`);
    }
    const row = await this.prisma.client.featureFlag.update({ where: { key }, data });
    return this.toRecord(row);
  }
}
