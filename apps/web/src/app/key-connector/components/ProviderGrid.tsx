'use client';

import { useState, useMemo } from 'react';
import { Search, Filter, Loader2 } from 'lucide-react';
import { api } from '@/trpc/react';
import { cn } from '@/lib/utils';
import type { Provider, ProviderCategory } from '../types';
import { useProviders } from '../hooks/useProviders';
import { ProviderCard } from './ProviderCard';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ProviderGridProps {
  onConnect: (provider: Provider) => void;
  onSelect: (provider: Provider) => void;
}

const ALL_CATEGORIES: ProviderCategory[] = [
  'crm',
  'marketing',
  'finance',
  'communication',
  'storage',
  'analytics',
  'ai',
  'ecommerce',
  'social',
  'other',
];

export function ProviderGrid({ onConnect, onSelect }: ProviderGridProps) {
  const { providers, isLoading, error, refresh } = useProviders();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isSyncingMap, setIsSyncingMap] = useState<Record<string, boolean>>({});

  const disconnectMutation = api.keyConnector.disconnectProvider.useMutation({
    onSuccess: () => refresh(),
  });

  const syncMutation = api.keyConnector.triggerSync.useMutation({
    onMutate: (vars) => {
      setIsSyncingMap((prev) => ({ ...prev, [vars.providerKey]: true }));
    },
    onSettled: (_data, _error, vars) => {
      setIsSyncingMap((prev) => ({ ...prev, [vars.providerKey]: false }));
      refresh();
    },
  });

  const handleDisconnect = (providerKey: string) => {
    disconnectMutation.mutate({ providerKey });
  };

  const handleSync = (providerKey: string) => {
    syncMutation.mutate({ providerKey });
  };

  const filtered = useMemo(() => {
    let result = providers;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q),
      );
    }

    if (categoryFilter && categoryFilter !== 'all') {
      result = result.filter((p) => p.category === categoryFilter);
    }

    if (statusFilter && statusFilter !== 'all') {
      result = result.filter((p) => p.status === statusFilter);
    }

    return result;
  }, [providers, search, categoryFilter, statusFilter]);

  // Connected count for the badge
  const connectedCount = providers.filter((p) => p.status === 'connected').length;

  return (
    <div className="space-y-4">
      {/* Header & Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-slate-800">Providers</h2>
          <Badge variant="secondary" className="text-[10px] font-medium">
            {providers.length} total &middot; {connectedCount} connected
          </Badge>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-initial sm:w-48">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <Input
              placeholder="Search providers..."
              className="pl-8 h-8 text-xs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-8 text-xs w-28">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {ALL_CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 text-xs w-28">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="connected">Connected</SelectItem>
              <SelectItem value="disconnected">Disconnected</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="syncing">Syncing</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={refresh}>
            <Loader2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Loading skeletons */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Error state */}
      {error && !isLoading && (
        <div className="flex items-center justify-center h-40 text-red-500 text-sm">
          Failed to load providers: {error.message}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center h-40 text-slate-400">
          <Filter className="h-8 w-8 mb-2" />
          <p className="text-sm">No providers match your filters.</p>
          <Button
            size="sm"
            variant="link"
            className="text-xs mt-1"
            onClick={() => {
              setSearch('');
              setCategoryFilter('all');
              setStatusFilter('all');
            }}
          >
            Clear filters
          </Button>
        </div>
      )}

      {/* Grid */}
      {!isLoading && !error && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              onConnect={onConnect}
              onDisconnect={handleDisconnect}
              onSync={handleSync}
              onSelect={onSelect}
              isSyncingGlobal={isSyncingMap[provider.key]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="rounded-xl border bg-white p-4 space-y-3">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="space-y-1.5 flex-1">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3 w-14" />
        </div>
      </div>
      <Skeleton className="h-1.5 w-full" />
      <div className="flex gap-2 pt-1">
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-16" />
      </div>
    </div>
  );
}
