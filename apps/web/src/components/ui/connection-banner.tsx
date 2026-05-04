"use client";

import { motion } from "framer-motion";
import { CheckCircle2, Loader2, ExternalLink, Link2, Settings } from "lucide-react";
import Link from "next/link";
import { useNavigationContext } from "@/lib/navigation-context";

interface ConnectionBannerProps {
  icon: React.ElementType;
  color: string;
  title: string;
  description: string;
  connected: boolean;
  connectedDetail?: string;
  onConnect: () => void;
  onDisconnect?: () => void;
  loading?: boolean;
  compact?: boolean;
  manageHref?: string;
  taskIntent?: string;
  onManage?: () => void;
}

export function ConnectionBanner({
  icon: Icon,
  color,
  title,
  description,
  connected,
  connectedDetail,
  onConnect,
  onDisconnect,
  loading = false,
  compact = false,
  manageHref,
  taskIntent,
  onManage,
}: ConnectionBannerProps) {
  const { pushContext, setTaskOrigin, current } = useNavigationContext();
  const resolvedManageHref = manageHref ?? "/app/connect";

  function handleManageClick() {
    if (current) setTaskOrigin(current);
    pushContext({ taskIntent: taskIntent ?? `manage-${title.toLowerCase().replace(/\s+/g, "-")}` });
  }

  if (compact) {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-border bg-card/60">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: `${color}18` }}
        >
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{title}</span>
            {connected ? (
              <span className="flex items-center gap-1 text-[11px] text-green-500">
                <CheckCircle2 className="w-3 h-3" />
                Connected
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">Not connected</span>
            )}
          </div>
        </div>
        {!connected ? (
          <button
            onClick={onConnect}
            disabled={loading}
            className="kf-btn-primary !py-1.5 !px-3 text-xs flex items-center gap-1.5"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
            Connect
          </button>
        ) : onManage ? (
          <button
            onClick={onManage}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            <Settings className="w-3 h-3" />
            Manage
          </button>
        ) : (
          <Link
            href={resolvedManageHref}
            onClick={handleManageClick}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            <Settings className="w-3 h-3" />
            Manage
          </Link>
        )}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="kf-card-glass rounded-xl overflow-hidden"
    >
      <div
        className="h-1 w-full"
        style={{ background: `linear-gradient(90deg, ${color}, ${color}66)` }}
      />
      <div className="flex items-center gap-4 p-4">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${color}18` }}
        >
          <Icon className="w-5 h-5" style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold">{title}</h4>
            {connected && (
              <span className="flex items-center gap-1 text-[11px] font-medium text-green-500">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Connected
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {connected && connectedDetail ? connectedDetail : description}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!connected ? (
            <button
              onClick={onConnect}
              disabled={loading}
              className="kf-btn-primary !py-2 !px-4 text-sm flex items-center gap-2"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ExternalLink className="w-4 h-4" />
              )}
              Connect
            </button>
          ) : (
            <div className="flex items-center gap-2">
              {onDisconnect && (
                <button
                  onClick={onDisconnect}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                >
                  Disconnect
                </button>
              )}
              {onManage ? (
                <button
                  onClick={onManage}
                  className="kf-btn-secondary !py-1.5 !px-3 text-xs flex items-center gap-1.5"
                >
                  <Settings className="w-3 h-3" />
                  Manage
                </button>
              ) : (
                <Link
                  href={resolvedManageHref}
                  onClick={handleManageClick}
                  className="kf-btn-secondary !py-1.5 !px-3 text-xs flex items-center gap-1.5"
                >
                  <Settings className="w-3 h-3" />
                  Manage
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

interface ConnectionsSummaryProps {
  connections: Array<{
    name: string;
    icon: React.ElementType;
    color: string;
    connected: boolean;
  }>;
  onManage: () => void;
}

export function ConnectionsSummary({ connections, onManage }: ConnectionsSummaryProps) {
  const connectedCount = connections.filter((c) => c.connected).length;

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card/60">
      <div className="flex -space-x-2">
        {connections.slice(0, 5).map((c) => (
          <div
            key={c.name}
            className="w-7 h-7 rounded-full flex items-center justify-center border-2 border-card"
            style={{ background: c.connected ? `${c.color}25` : "hsl(var(--kf-muted))" }}
            title={`${c.name}: ${c.connected ? "Connected" : "Not connected"}`}
          >
            <c.icon className="w-3 h-3" style={{ color: c.connected ? c.color : "hsl(var(--kf-muted-foreground))" }} />
          </div>
        ))}
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium">
          {connectedCount}/{connections.length} connected
        </span>
      </div>
      <button
        onClick={onManage}
        className="text-xs text-accent1 hover:underline flex items-center gap-1"
      >
        Manage
        <ExternalLink className="w-3 h-3" />
      </button>
    </div>
  );
}
