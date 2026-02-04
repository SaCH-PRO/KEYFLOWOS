"use client";

import { WifiOff, RefreshCw } from "lucide-react";

export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
      <div 
        className="h-20 w-20 rounded-2xl flex items-center justify-center mb-6"
        style={{ background: "hsl(var(--kf-accent1) / 0.15)" }}
      >
        <WifiOff className="h-10 w-10" style={{ color: "hsl(var(--kf-accent1))" }} />
      </div>
      
      <h1 className="text-2xl font-bold mb-2">You're Offline</h1>
      <p className="text-muted-foreground mb-6 max-w-md">
        It looks like you've lost your internet connection. Some features may be unavailable until you're back online.
      </p>
      
      <button
        onClick={() => window.location.reload()}
        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-white font-medium transition-all hover:opacity-90"
        style={{ background: "hsl(var(--kf-accent1))" }}
      >
        <RefreshCw className="h-4 w-4" />
        Try Again
      </button>
    </div>
  );
}
