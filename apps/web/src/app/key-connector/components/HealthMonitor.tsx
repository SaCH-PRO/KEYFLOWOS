'use client';

import {
  HeartPulse,
  AlertTriangle,
  XCircle,
  Activity,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HealthCheck, HealthStatus } from '../types';
import { useHealth } from '../hooks/useHealth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';

const statusConfig: Record<HealthStatus, { label: string; icon: typeof HeartPulse; color: string; ring: string; bg: string }> = {
  healthy: {
    label: 'Healthy',
    icon: HeartPulse,
    color: 'text-emerald-600',
    ring: 'stroke-emerald-500',
    bg: 'bg-emerald-50',
  },
  degraded: {
    label: 'Degraded',
    icon: AlertTriangle,
    color: 'text-yellow-600',
    ring: 'stroke-yellow-500',
    bg: 'bg-yellow-50',
  },
  unhealthy: {
    label: 'Unhealthy',
    icon: XCircle,
    color: 'text-red-600',
    ring: 'stroke-red-500',
    bg: 'bg-red-50',
  },
  unknown: {
    label: 'Unknown',
    icon: Activity,
    color: 'text-slate-400',
    ring: 'stroke-slate-300',
    bg: 'bg-slate-50',
  },
};

export function HealthMonitor() {
  const { healthResults, overallScore, overallStatus, isLoading } = useHealth();
  const config = statusConfig[overallStatus];
  const StatusIcon = config.icon;

  // SVG ring math
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (overallScore / 100) * circumference;

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <HeartPulse className="h-4 w-4 text-rose-500" />
          Health Monitor
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading && <HealthSkeleton />}

        {!isLoading && (
          <>
            {/* Overall score ring */}
            <div className="flex items-center justify-center py-4">
              <div className="relative">
                <svg width="88" height="88" className="-rotate-90">
                  {/* Background ring */}
                  <circle
                    cx="44"
                    cy="44"
                    r={radius}
                    fill="none"
                    className="stroke-slate-100"
                    strokeWidth="8"
                  />
                  {/* Score ring */}
                  <circle
                    cx="44"
                    cy="44"
                    r={radius}
                    fill="none"
                    className={cn('transition-all duration-700', config.ring)}
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={dashOffset}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={cn('text-xl font-extrabold', config.color)}>
                    {overallScore}
                  </span>
                  <span className="text-[9px] text-slate-400 font-medium">
                    /100
                  </span>
                </div>
              </div>
            </div>

            {/* Overall status badge */}
            <div className="flex items-center justify-center mb-4">
              <div className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-full', config.bg)}>
                <StatusIcon className={cn('h-3 w-3', config.color)} />
                <span className={cn('text-[11px] font-semibold', config.color)}>
                  {config.label}
                </span>
              </div>
            </div>

            {/* Per-provider health bars */}
            <div className="space-y-2.5">
              {healthResults.map((check) => (
                <HealthBar key={check.id} check={check} />
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function HealthBar({ check }: { check: HealthCheck }) {
  const config = statusConfig[check.status];

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-medium text-slate-700">{check.providerName}</span>
        <div className="flex items-center gap-2">
          <span className="text-slate-400">{check.latencyMs}ms</span>
          <span className={cn('font-semibold', config.color)}>
            {check.score}%
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Progress
          value={check.score}
          className="h-1 flex-1"
        />
        <div
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            check.status === 'healthy'
              ? 'bg-emerald-500'
              : check.status === 'degraded'
              ? 'bg-yellow-400'
              : 'bg-red-500',
          )}
        />
      </div>
    </div>
  );
}

function HealthSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex justify-center py-4">
        <Skeleton className="h-[88px] w-[88px] rounded-full" />
      </div>
      <div className="flex justify-center">
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      <div className="space-y-2.5 pt-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-1">
            <div className="flex justify-between">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-10" />
            </div>
            <Skeleton className="h-1 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
