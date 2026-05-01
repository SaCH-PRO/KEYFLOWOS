"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  MessageSquare,
  Handshake,
  UserPlus,
  CheckCheck,
  Circle,
  Loader2,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import {
  fetchCommunityNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type CommunityNotificationItem,
} from "@/lib/client";

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

const TYPE_ICONS: Record<string, typeof Bell> = {
  MESSAGE: MessageSquare,
  COLLAB_REQUEST: Handshake,
  COLLAB_RESPONSE: Handshake,
  FOLLOW: UserPlus,
};

const TYPE_COLORS: Record<string, string> = {
  MESSAGE: "text-blue-400 bg-blue-400/10",
  COLLAB_REQUEST: "text-purple-400 bg-purple-400/10",
  COLLAB_RESPONSE: "text-emerald-400 bg-emerald-400/10",
  FOLLOW: "text-amber-400 bg-amber-400/10",
};

interface NotificationsPanelProps {
  businessId: string | null;
  onNavigateToInbox?: () => void;
  onNavigateToRequests?: () => void;
}

export function NotificationsPanel({ businessId, onNavigateToInbox, onNavigateToRequests }: NotificationsPanelProps) {
  const [notifications, setNotifications] = useState<CommunityNotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [markingAll, setMarkingAll] = useState(false);

  const loadNotifications = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetchCommunityNotifications(businessId);
      if (res.data) {
        setNotifications(res.data.data);
        setUnreadCount(res.data.unreadCount);
      }
    } catch {}
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  const handleMarkRead = useCallback(async (notifId: string) => {
    if (!businessId) return;
    try {
      await markNotificationRead(businessId, notifId);
      setNotifications((prev) => prev.map((n) => n.id === notifId ? { ...n, isRead: true } : n));
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {}
  }, [businessId]);

  const handleMarkAllRead = useCallback(async () => {
    if (!businessId) return;
    setMarkingAll(true);
    try {
      await markAllNotificationsRead(businessId);
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch {}
    setMarkingAll(false);
  }, [businessId]);

  const handleNotificationClick = (notif: CommunityNotificationItem) => {
    if (!notif.isRead) handleMarkRead(notif.id);
    if (notif.type === "MESSAGE" && onNavigateToInbox) onNavigateToInbox();
    if ((notif.type === "COLLAB_REQUEST" || notif.type === "COLLAB_RESPONSE") && onNavigateToRequests) onNavigateToRequests();
  };

  return (
    <div className="space-y-3">
      {unreadCount > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {unreadCount} unread notification{unreadCount !== 1 ? "s" : ""}
          </p>
          <button
            onClick={handleMarkAllRead}
            disabled={markingAll}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all disabled:opacity-50"
          >
            {markingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCheck className="w-3 h-3" />}
            Mark all read
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="kf-card border border-border rounded-xl p-3.5 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-muted rounded w-2/3" />
                  <div className="h-2.5 bg-muted rounded w-1/2" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No notifications"
          description="You'll be notified when someone messages you, sends a collaboration request, or follows your business."
        />
      ) : (
        <AnimatePresence mode="popLayout">
          {notifications.map((notif, i) => {
            const Icon = TYPE_ICONS[notif.type] ?? Bell;
            const colorClass = TYPE_COLORS[notif.type] ?? "text-muted-foreground bg-muted/50";

            return (
              <motion.button
                key={notif.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
                onClick={() => handleNotificationClick(notif)}
                className={`w-full kf-card border rounded-xl p-3.5 text-left transition-all group ${
                  notif.isRead
                    ? "border-border opacity-70"
                    : "border-[hsl(var(--kf-accent1))]/20 bg-[hsl(var(--kf-accent1))]/[0.02]"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${colorClass}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {!notif.isRead && (
                        <Circle className="w-1.5 h-1.5 fill-[hsl(var(--kf-accent1))] text-[hsl(var(--kf-accent1))] flex-shrink-0" />
                      )}
                      <p className="text-xs font-medium truncate">{notif.title}</p>
                    </div>
                    {notif.body && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{notif.body}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-1">{timeAgo(notif.createdAt)}</p>
                  </div>
                </div>
              </motion.button>
            );
          })}
        </AnimatePresence>
      )}
    </div>
  );
}
