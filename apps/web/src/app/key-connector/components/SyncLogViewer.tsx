'use client';

import { useState, useMemo } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ArrowDown,
  ArrowUp,
  ArrowLeftRight,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Ban,
  Filter,
  Calendar,
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import type { SyncJob, SyncStatus, SyncDirection } from '../types';
import { useSyncStatus } from '../hooks/useSyncStatus';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const STATUS_LABELS: Record<SyncStatus, { label: string; icon: typeof CheckCircle2; color: string; bg: string }> = {
  completed: { label: 'Completed', icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  failed: { label: 'Failed', icon: XCircle, color: 'text-red-600', bg: 'bg-red-50' },
  running: { label: 'Running', icon: Loader2, color: 'text-blue-600', bg: 'bg-blue-50' },
  pending: { label: 'Pending', icon: Clock, color: 'text-slate-500', bg: 'bg-slate-50' },
  cancelled: { label: 'Cancelled', icon: Ban, color: 'text-orange-600', bg: 'bg-orange-50' },
};

const DIRECTION_CONFIG: Record<SyncDirection, { icon: typeof ArrowDown; label: string; color: string }> = {
  inbound: { icon: ArrowDown, label: 'Inbound', color: 'text-blue-600' },
  outbound: { icon: ArrowUp, label: 'Outbound', color: 'text-purple-600' },
  bidirectional: { icon: ArrowLeftRight, label: 'Bi-dir', color: 'text-cyan-600' },
};

const PAGE_SIZE = 10;

interface SyncLogViewerProps {
  providerFilter?: string;
}

export function SyncLogViewer({ providerFilter = 'all' }: SyncLogViewerProps) {
  const { syncStatus, isLoading, error, triggerSync, isSyncing } = useSyncStatus();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [providerFilterLocal, setProviderFilterLocal] = useState<string>(providerFilter);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // Unique providers for filter
  const uniqueProviders = useMemo(() => {
    const keys = new Map<string, string>();
    syncStatus.forEach((s) => keys.set(s.providerKey, s.providerName));
    return Array.from(keys.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [syncStatus]);

  const filtered = useMemo(() => {
    let result = [...syncStatus];

    if (providerFilterLocal && providerFilterLocal !== 'all') {
      result = result.filter((s) => s.providerKey === providerFilterLocal);
    }

    if (statusFilter && statusFilter !== 'all') {
      result = result.filter((s) => s.status === statusFilter);
    }

    // Sort by startedAt desc
    result.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    return result;
  }, [syncStatus, providerFilterLocal, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleExpand = (id: string) => {
    setExpandedRow((prev) => (prev === id ? null : id));
  };

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <CardTitle className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-500" />
            Sync Log
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={providerFilterLocal} onValueChange={(v) => { setProviderFilterLocal(v); setPage(1); }}>
              <SelectTrigger className="h-8 text-xs w-36">
                <SelectValue placeholder="Provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Providers</SelectItem>
                {uniqueProviders.map(([key, name]) => (
                  <SelectItem key={key} value={key}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="h-8 text-xs w-28">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading && <LogSkeleton />}

        {error && !isLoading && (
          <div className="text-center py-8 text-red-500 text-sm">
            Failed to load sync log.
          </div>
        )}

        {!isLoading && !error && filtered.length === 0 && (
          <div className="text-center py-8 text-slate-400 text-sm flex flex-col items-center">
            <Filter className="h-6 w-6 mb-2" />
            No sync jobs found.
          </div>
        )}

        {!isLoading && !error && filtered.length > 0 && (
          <>
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/50">
                    <TableHead className="text-[10px] font-semibold text-slate-600 w-4" />
                    <TableHead className="text-[10px] font-semibold text-slate-600">Provider</TableHead>
                    <TableHead className="text-[10px] font-semibold text-slate-600">Status</TableHead>
                    <TableHead className="text-[10px] font-semibold text-slate-600">Dir</TableHead>
                    <TableHead className="text-[10px] font-semibold text-slate-600">Records</TableHead>
                    <TableHead className="text-[10px] font-semibold text-slate-600">Started</TableHead>
                    <TableHead className="text-[10px] font-semibold text-slate-600">Completed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginated.map((job) => (
                    <>
                      <TableRow
                        key={job.id}
                        className="cursor-pointer hover:bg-slate-50/80"
                        onClick={() => toggleExpand(job.id)}
                      >
                        <TableCell className="py-2">
                          {expandedRow === job.id ? (
                            <ChevronUp className="h-3 w-3 text-slate-400" />
                          ) : (
                            <ChevronDown className="h-3 w-3 text-slate-400" />
                          )}
                        </TableCell>
                        <TableCell className="py-2">
                          <span className="text-[11px] font-medium text-slate-800">
                            {job.providerName}
                          </span>
                        </TableCell>
                        <TableCell className="py-2">
                          <StatusBadge status={job.status} />
                        </TableCell>
                        <TableCell className="py-2">
                          <DirectionIndicator direction={job.direction} />
                        </TableCell>
                        <TableCell className="py-2">
                          <span className="text-[10px] text-slate-600">
                            R:{job.counts.read} C:{job.counts.created} U:{job.counts.updated} F:{job.counts.failed}
                          </span>
                        </TableCell>
                        <TableCell className="py-2">
                          <span className="text-[10px] text-slate-500">
                            {format(new Date(job.startedAt), 'HH:mm:ss')}
                          </span>
                        </TableCell>
                        <TableCell className="py-2">
                          <span className="text-[10px] text-slate-500">
                            {job.completedAt
                              ? format(new Date(job.completedAt), 'HH:mm:ss')
                              : '—'}
                          </span>
                        </TableCell>
                      </TableRow>
                      {expandedRow === job.id && (
                        <TableRow className="bg-slate-50/50">
                          <TableCell colSpan={7} className="py-3">
                            <div className="pl-7 space-y-2">
                              <div className="grid grid-cols-5 gap-2 text-center">
                                <div>
                                  <div className="text-[9px] text-slate-400 uppercase">Read</div>
                                  <div className="text-xs font-semibold text-slate-700">{job.counts.read}</div>
                                </div>
                                <div>
                                  <div className="text-[9px] text-slate-400 uppercase">Created</div>
                                  <div className="text-xs font-semibold text-emerald-600">{job.counts.created}</div>
                                </div>
                                <div>
                                  <div className="text-[9px] text-slate-400 uppercase">Updated</div>
                                  <div className="text-xs font-semibold text-blue-600">{job.counts.updated}</div>
                                </div>
                                <div>
                                  <div className="text-[9px] text-slate-400 uppercase">Failed</div>
                                  <div className="text-xs font-semibold text-red-500">{job.counts.failed}</div>
                                </div>
                                <div>
                                  <div className="text-[9px] text-slate-400 uppercase">Skipped</div>
                                  <div className="text-xs font-semibold text-slate-500">{job.counts.skipped}</div>
                                </div>
                              </div>
                              {job.errorMessage && (
                                <div className="bg-red-50 border border-red-200 rounded-md p-2 text-[10px] text-red-700">
                                  <strong>Error:</strong> {job.errorMessage}
                                  {job.errorDetails && (
                                    <pre className="mt-1 text-[9px] whitespace-pre-wrap">{job.errorDetails}</pre>
                                  )}
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-3">
              <span className="text-[10px] text-slate-400">
                {filtered.length} total &middot; Page {page} of {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[10px] px-2"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  Prev
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[10px] px-2"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: SyncStatus }) {
  const config = STATUS_LABELS[status];
  const Icon = config.icon;
  return (
    <div className={cn('flex items-center gap-1 px-1.5 py-0.5 rounded-full w-fit', config.bg)}>
      <Icon className={cn('h-3 w-3', config.color)} />
      <span className={cn('text-[9px] font-semibold', config.color)}>
        {config.label}
      </span>
    </div>
  );
}

function DirectionIndicator({ direction }: { direction: SyncDirection }) {
  const config = DIRECTION_CONFIG[direction];
  const Icon = config.icon;
  return (
    <div className="flex items-center gap-0.5">
      <Icon className={cn('h-3 w-3', config.color)} />
      <span className="text-[9px] text-slate-500">{config.label}</span>
    </div>
  );
}

function LogSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-2">
          <Skeleton className="h-3 w-3" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  );
}
