'use client';

import { useState, useMemo } from 'react';
import {
  Plug,
  Link2,
  HeartPulse,
  RefreshCw,
  Zap,
  ArrowUpRight,
  Activity,
} from 'lucide-react';
import { api } from '@/trpc/react';
import { cn } from '@/lib/utils';
import type { Provider } from './types';
import { useProviders } from './hooks/useProviders';
import { useSyncStatus } from './hooks/useSyncStatus';
import { useHealth } from './hooks/useHealth';
import { ProviderGrid } from './components/ProviderGrid';
import { SyncStatusPanel } from './components/SyncStatusPanel';
import { HealthMonitor } from './components/HealthMonitor';
import { AiCommandPanel } from './components/AiCommandPanel';
import { ConnectionWizard } from './components/ConnectionWizard';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Key Connector Dashboard — Main page
 * Two-column layout: Provider Grid (2/3) + Sidebar (1/3)
 */
export default function KeyConnectorPage() {
  const { providers, isLoading: providersLoading, refresh: refreshProviders } = useProviders();
  const { syncStatus } = useSyncStatus();
  const { overallScore, overallStatus } = useHealth();

  const [wizardProvider, setWizardProvider] = useState<Provider | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  // Stats
  const stats = useMemo(() => {
    const total = providers.length;
    const connected = providers.filter((p) => p.status === 'connected').length;
    const healthy = providers.filter((p) => p.healthScore >= 70).length;
    const syncing = syncStatus.filter(
      (s) => s.status === 'running' || s.status === 'pending',
    ).length;
    return { total, connected, healthy, syncing };
  }, [providers, syncStatus]);

  const handleConnect = (provider: Provider) => {
    setWizardProvider(provider);
    setWizardOpen(true);
  };

  const handleSelect = (provider: Provider) => {
    // Navigate to provider detail — for now, open wizard
    setWizardProvider(provider);
    setWizardOpen(true);
  };

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      {/* Page Header */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-slate-200 px-6 py-4">
        <div className="max-w-[1440px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-blue-500 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
              <Zap className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900 tracking-tight">
                KEY CONNECTOR
              </h1>
              <p className="text-[11px] text-slate-500">
                Universal Integration Hub
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-500">
              <Activity className="h-3 w-3 text-emerald-500" />
              <span>
                {stats.connected} of {stats.total} active
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Stats Cards Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard
            label="Total Providers"
            value={stats.total}
            icon={Plug}
            iconBg="bg-slate-100"
            iconColor="text-slate-600"
            isLoading={providersLoading}
          />
          <StatCard
            label="Connected"
            value={stats.connected}
            icon={Link2}
            iconBg="bg-emerald-50"
            iconColor="text-emerald-600"
            trend={stats.total > 0 ? `${Math.round((stats.connected / stats.total) * 100)}%` : '0%'}
            isLoading={providersLoading}
          />
          <StatCard
            label="Healthy"
            value={stats.healthy}
            icon={HeartPulse}
            iconBg="bg-blue-50"
            iconColor="text-blue-600"
            trend={overallScore > 0 ? `${overallScore}% score` : undefined}
            isLoading={providersLoading}
          />
          <StatCard
            label="Syncing"
            value={stats.syncing}
            icon={RefreshCw}
            iconBg="bg-amber-50"
            iconColor="text-amber-600"
            isLoading={providersLoading}
          />
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Provider Grid (2/3) */}
          <div className="lg:col-span-2">
            <ProviderGrid
              onConnect={handleConnect}
              onSelect={handleSelect}
            />
          </div>

          {/* Right: Sidebar (1/3) */}
          <div className="space-y-4">
            <SyncStatusPanel />
            <HealthMonitor />
            <AiCommandPanel />
          </div>
        </div>
      </div>

      {/* Connection Wizard Modal */}
      <ConnectionWizard
        provider={wizardProvider}
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSuccess={refreshProviders}
      />
    </div>
  );
}

// ─── Stat Card ───────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: number;
  icon: typeof Plug;
  iconBg: string;
  iconColor: string;
  trend?: string;
  isLoading?: boolean;
}

function StatCard({
  label,
  value,
  icon: Icon,
  iconBg,
  iconColor,
  trend,
  isLoading = false,
}: StatCardProps) {
  return (
    <Card className="border-slate-200 shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-4 sm:p-5">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-7 w-14" />
            <Skeleton className="h-3 w-20" />
          </div>
        ) : (
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
                {label}
              </p>
              <p className="text-2xl font-extrabold text-slate-900 mt-1">{value}</p>
              {trend && (
                <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                  <ArrowUpRight className="h-3 w-3" />
                  {trend}
                </p>
              )}
            </div>
            <div className={cn('h-9 w-9 rounded-lg flex items-center justify-center', iconBg)}>
              <Icon className={cn('h-4 w-4', iconColor)} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
