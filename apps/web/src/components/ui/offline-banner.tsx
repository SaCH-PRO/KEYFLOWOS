'use client';

import { useServiceWorker } from '@/hooks/use-service-worker';
import { WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';

export function OfflineBanner() {
  const { isOffline } = useServiceWorker();

  return (
    <div
      className={cn(
        'fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 bg-amber-500 text-white text-sm font-medium px-4 py-2 transition-transform duration-300 ease-in-out',
        isOffline ? 'translate-y-0' : '-translate-y-full pointer-events-none'
      )}
      role="status"
      aria-live="polite"
    >
      <WifiOff className="h-4 w-4 shrink-0" />
      <span>You&apos;re offline. Changes will sync when you reconnect.</span>
    </div>
  );
}
