'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  Zap,
  Unlink,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Provider } from '../types';
import {
  Card,
  CardContent,
  CardHeader,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';

interface ProviderCardProps {
  provider: Provider;
  onConnect: (provider: Provider) => void;
  onDisconnect: (providerKey: string) => void;
  onSync: (providerKey: string) => void;
  onSelect: (provider: Provider) => void;
  isSyncingGlobal?: boolean;
}

const categoryColors: Record<string, string> = {
  crm: 'bg-blue-100 text-blue-700 border-blue-200',
  marketing: 'bg-purple-100 text-purple-700 border-purple-200',
  finance: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  communication: 'bg-orange-100 text-orange-700 border-orange-200',
  storage: 'bg-slate-100 text-slate-700 border-slate-200',
  analytics: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  ai: 'bg-pink-100 text-pink-700 border-pink-200',
  ecommerce: 'bg-amber-100 text-amber-700 border-amber-200',
  social: 'bg-rose-100 text-rose-700 border-rose-200',
  other: 'bg-gray-100 text-gray-700 border-gray-200',
};

const statusConfig = {
  connected: {
    label: 'Connected',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  disconnected: {
    label: 'Disconnected',
    dot: 'bg-slate-400',
    badge: 'bg-slate-50 text-slate-600 border-slate-200',
  },
  error: {
    label: 'Error',
    dot: 'bg-red-500',
    badge: 'bg-red-50 text-red-700 border-red-200',
  },
  syncing: {
    label: 'Syncing',
    dot: 'bg-blue-500 animate-pulse',
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
  },
};

const healthColor = (score: number): string => {
  if (score >= 90) return 'bg-emerald-500';
  if (score >= 70) return 'bg-yellow-400';
  if (score >= 50) return 'bg-orange-400';
  return 'bg-red-500';
};

export function ProviderCard({
  provider,
  onConnect,
  onDisconnect,
  onSync,
  onSelect,
  isSyncingGlobal = false,
}: ProviderCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const status = statusConfig[provider.status];

  const lastSyncText = provider.lastSyncAt
    ? formatDistanceToNow(new Date(provider.lastSyncAt), { addSuffix: true })
    : 'Never';

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Card
            className={cn(
              'relative cursor-pointer transition-all duration-300 border hover:shadow-lg hover:-translate-y-0.5',
              isHovered && 'border-blue-200 shadow-md',
            )}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={() => onSelect(provider)}
          >
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  {/* Colored icon circle */}
                  <div
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white shadow-sm',
                      healthColor(provider.healthScore),
                    )}
                  >
                    {provider.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 leading-tight">
                      {provider.name}
                    </h3>
                    <Badge
                      variant="outline"
                      className={cn(
                        'mt-1 text-[10px] font-medium px-1.5 py-0',
                        categoryColors[provider.category] ?? categoryColors.other,
                      )}
                    >
                      {provider.category}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={cn('h-2.5 w-2.5 rounded-full', status.dot)} />
                </div>
              </div>
            </CardHeader>

            <CardContent className="pt-0">
              <div className="flex items-center justify-between mb-2">
                <Badge variant="outline" className={cn('text-[10px]', status.badge)}>
                  {status.label}
                </Badge>
                <span className="text-[10px] text-slate-400">
                  Sync {lastSyncText}
                </span>
              </div>

              {/* Health score bar */}
              <div className="space-y-1 mb-3">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">Health</span>
                  <span className={cn('font-semibold', provider.healthScore >= 70 ? 'text-emerald-600' : 'text-red-500')}>
                    {provider.healthScore}%
                  </span>
                </div>
                <Progress
                  value={provider.healthScore}
                  className="h-1.5"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                {provider.status === 'connected' ? (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-[11px] px-2 text-slate-600 hover:text-red-600 hover:bg-red-50"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDisconnect(provider.key);
                      }}
                    >
                      <Unlink className="h-3 w-3 mr-1" />
                      Disconnect
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-[11px] px-2 text-blue-600 hover:bg-blue-50"
                      disabled={isSyncingGlobal || provider.status === 'syncing'}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSync(provider.key);
                      }}
                    >
                      <RefreshCw className={cn('h-3 w-3 mr-1', provider.status === 'syncing' && 'animate-spin')} />
                      {provider.status === 'syncing' ? 'Syncing' : 'Sync'}
                    </Button>
                  </>
                ) : provider.status === 'error' ? (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-[11px] px-2 text-red-600 hover:bg-red-50"
                      onClick={(e) => {
                        e.stopPropagation();
                        onConnect(provider);
                      }}
                    >
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      Reconnect
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-[11px] px-2 text-slate-600 hover:text-red-600 hover:bg-red-50"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDisconnect(provider.key);
                      }}
                    >
                      <Unlink className="h-3 w-3 mr-1" />
                      Disconnect
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px] px-2 text-emerald-600 hover:bg-emerald-50"
                    onClick={(e) => {
                      e.stopPropagation();
                      onConnect(provider);
                    }}
                  >
                    <Zap className="h-3 w-3 mr-1" />
                    Connect
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="text-xs">{provider.description}</p>
          <p className="text-[10px] text-slate-400 mt-1">
            Click to view details
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
