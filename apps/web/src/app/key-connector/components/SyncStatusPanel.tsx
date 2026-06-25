'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  ArrowDown,
  ArrowUp,
  ArrowLeftRight,
  Clock,
} from 'lucide-react';
import { api } from '@/trpc/react';
import { cn } from '@/lib/utils';
import type { SyncJob, SyncStatus, SyncDirection } from '../types';
import { useSyncStatus } from '../hooks/useSyncStatus';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

const statusIcon = (status: SyncStatus) => {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case 'failed':
    case 'cancelled':
      return <XCircle className="h-4 w-4 text-red-500" />;
    case 'running':
      return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
    default:
      return <Clock className="h-4 w-4 text-slate-400" />;
  }
};

const directionIcon = (direction: SyncDirection) => {
  switch (direction) {
    case 'inbound':
      return <ArrowDown className="h-3 w-3 text-blue-500" />;
    case 'outbound':
      return <ArrowUp className="h-3 w-3 text-purple-500" />;
    case 'bidirectional':
      return <ArrowLeftRight className="h-3 w-3 text-cyan-500" />;
  }
};

export function SyncStatusPanel() {
  const { syncStatus, isLoading, triggerSync, isSyncing, refresh } = useSyncStatus();
  const [syncingAll, setSyncingAll] = useState(false);

  const syncAllMutation = api.keyConnector.triggerSync.useMutation({
    onMutate: () => setSyncingAll(true),
    onSettled: () => {
      setSyncingAll(false);
      refresh();
    },
  });

  // Get latest job per provider
  const latestByProvider = new Map<string, SyncJob>();
  for (const job of syncStatus) {
    const existing = latestByProvider.get(job.providerKey);
    if (!existing || new Date(job.startedAt) > new Date(existing.startedAt)) {
      latestByProvider.set(job.providerKey, job);
    }
  }
  const latestJobs = Array.from(latestByProvider.values());

  const handleSyncAll = () => {
    syncAllMutation.mutate({ providerKey: 'all' });
  };

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-blue-500" />
            Sync Status
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px] px-2.5"
            onClick={handleSyncAll}
            disabled={syncingAll || isSyncing}
          >
            {syncingAll ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3 mr-1" />
            )}
            Sync All
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {isLoading && <SyncSkeleton />}

        {!isLoading && latestJobs.length === 0 && (
          <div className="text-center py-6 text-slate-400 text-xs">
            No sync history yet.
          </div>
        )}

        {!isLoading &&
          latestJobs.map((job) => (
            <div
              key={job.id}
              className="flex items-center gap-3 p-2.5 rounded-lg border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-colors"
            >
              {statusIcon(job.status)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-slate-800 truncate">
                    {job.providerName}
                  </span>
                  <span className="text-slate-300">|</span>
                  {directionIcon(job.direction)}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <Badge
                    variant="outline"
                    className="text-[9px] h-4 px-1 border-slate-200"
                  >
                    R:{job.counts.read} C:{job.counts.created} U:{job.counts.updated} F:{job.counts.failed}
                  </Badge>
                </div>
              </div>
              {job.status === 'running' && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onClick={() => triggerSync(job.providerKey)}
                >
                  <Loader2 className="h-3 w-3 animate-spin" />
                </Button>
              )}
            </div>
          ))}
      </CardContent>
    </Card>
  );
}

function SyncSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg">
          <Skeleton className="h-4 w-4 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}
