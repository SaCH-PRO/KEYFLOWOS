"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users,
  UserPlus,
  Trash2,
  CheckCircle2,
  Mail,
  Shield,
  Crown,
  Activity,
  Settings2,
  ChevronRight,
  Zap,
  Eye,
  Edit3,
  Lock,
  Unlock,
  Filter,
} from "lucide-react";
import { Button, Input } from "@keyflow/ui";
import { getStoredBusinessId } from "@/lib/workspace";
import { apiGet, apiPostSimple as apiPost, apiDelete, apiPatch } from "@/lib/api";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import Image from "next/image";

type TeamMember = {
  id: string;
  role: string;
  userId: string;
  permissionScopes: Record<string, string>;
  maxApprovalTier: number;
  activeTasks?: number;
  recentActions?: ActivityItem[];
  user: {
    id: string;
    email: string;
    name: string | null;
    firstName?: string | null;
    lastName?: string | null;
    avatarUrl?: string | null;
  };
};

type ActivityItem = {
  id: string;
  userId: string;
  module: string;
  action: string;
  title: string;
  detail?: string;
  entityType?: string;
  entityId?: string;

  meta?: Record<string, unknown>;
  createdAt: string;
};

type DashboardData = {
  members: TeamMember[];
  totalMembers: number;
  recentActivity: ActivityItem[];
  permissionModules: string[];
};

const ROLES = ["ADMIN", "STAFF"];
const PERMISSION_LEVELS = ["none", "read", "write", "admin"] as const;
const APPROVAL_TIERS = [0, 1, 2, 3, 4];
const TABS = ["members", "activity", "permissions"] as const;
type Tab = typeof TABS[number];

const PERMISSION_MODULES = [
  { key: "crm", label: "CRM / Clients" },
  { key: "revenue", label: "Revenue" },
  { key: "bookings", label: "Bookings" },
  { key: "projects", label: "Projects" },
  { key: "content", label: "Content" },
  { key: "expenses", label: "Expenses" },
  { key: "automations", label: "Automations" },
  { key: "storefront", label: "Storefront" },
  { key: "settings", label: "Settings" },
  { key: "ai", label: "AI / Copilot" },
  { key: "team", label: "Team" },
];

const DEFAULT_SCOPES: Record<string, Record<string, string>> = {
  OWNER: Object.fromEntries(PERMISSION_MODULES.map((m) => [m.key, "admin"])),
  ADMIN: Object.fromEntries(PERMISSION_MODULES.map((m) => [m.key, m.key === "team" ? "write" : "admin"])),
  STAFF: Object.fromEntries(PERMISSION_MODULES.map((m) => [m.key, ["settings", "team", "ai"].includes(m.key) ? "none" : "read"])),
};

const DEFAULT_TIERS: Record<string, number> = { OWNER: 4, ADMIN: 3, STAFF: 0 };

const roleConfig: Record<string, { label: string; color: string; icon: typeof Shield }> = {
  OWNER: { label: "Owner", color: "bg-amber-500/20 text-amber-300 border-amber-500/30", icon: Crown },
  ADMIN: { label: "Admin", color: "bg-blue-500/20 text-blue-300 border-blue-500/30", icon: Shield },
  STAFF: { label: "Staff", color: "bg-muted/40 text-muted-foreground border-border/40", icon: Users },
};

const levelIcon: Record<string, typeof Eye> = {
  none: Lock,
  read: Eye,
  write: Edit3,
  admin: Unlock,
};

const levelColor: Record<string, string> = {
  none: "text-zinc-500",
  read: "text-blue-400",
  write: "text-emerald-400",
  admin: "text-amber-400",
};

const moduleColor: Record<string, string> = {
  team: "text-[#F97316]",
  crm: "text-blue-400",
  revenue: "text-emerald-400",
  bookings: "text-violet-400",
  projects: "text-cyan-400",
  content: "text-pink-400",
  expenses: "text-red-400",
  automations: "text-amber-400",
  ai: "text-purple-400",
  settings: "text-zinc-400",
  storefront: "text-teal-400",
};

function SkeletonTeam() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex gap-2 mb-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-9 w-28 bg-muted/20 rounded-lg" />
        ))}
      </div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 p-4 rounded-xl border border-border/30">
          <div className="w-10 h-10 rounded-full bg-muted/30" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-32 bg-muted/30 rounded" />
            <div className="h-3 w-48 bg-muted/20 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Avatar({ member }: { member: TeamMember }) {
  const name = member.user.firstName && member.user.lastName
    ? `${member.user.firstName} ${member.user.lastName}`
    : member.user.name || member.user.email.split("@")[0];
  const initials = name.split(" ").map((n) => n.charAt(0).toUpperCase()).slice(0, 2).join("");

  if (member.user.avatarUrl) {
    return (
      <Image
        src={member.user.avatarUrl}
        alt={name}
        className="h-10 w-10 rounded-xl object-cover shadow-sm"
       width={40} height={40} unoptimized />
    );
  }

  return (
    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-[#F97316] to-[#14B8A6] flex items-center justify-center text-white text-sm font-bold shadow-sm">
      {initials}
    </div>
  );
}

function getDisplayName(member: TeamMember) {
  if (member.user.firstName && member.user.lastName) return `${member.user.firstName} ${member.user.lastName}`;
  return member.user.name || member.user.email.split("@")[0];
}

function formatTimeAgo(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-TT", { month: "short", day: "numeric" });
}

function ScopesSummary({ scopes }: { scopes: Record<string, string> }) {
  const adminCount = Object.values(scopes).filter((v) => v === "admin").length;
  const writeCount = Object.values(scopes).filter((v) => v === "write").length;
  const readCount = Object.values(scopes).filter((v) => v === "read").length;
  const noneCount = Object.values(scopes).filter((v) => v === "none").length;

  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      {adminCount > 0 && (
        <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">
          {adminCount} admin
        </span>
      )}
      {writeCount > 0 && (
        <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
          {writeCount} write
        </span>
      )}
      {readCount > 0 && (
        <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/20">
          {readCount} read
        </span>
      )}
      {noneCount > 0 && (
        <span className="px-1.5 py-0.5 rounded bg-zinc-500/15 text-zinc-500 border border-zinc-500/20">
          {noneCount} none
        </span>
      )}
    </div>
  );
}

function MemberCard({
  member,
  onRoleChange,
  onRemove,
  onEditPermissions,
}: {
  member: TeamMember;
  onRoleChange: (id: string, role: string) => void;
  onRemove: (id: string, name: string) => void;
  onEditPermissions: (member: TeamMember) => void;
}) {
  const displayName = getDisplayName(member);
  const role = roleConfig[member.role] || roleConfig.STAFF;

  return (
    <div className="flex items-center justify-between rounded-xl border border-border/40 bg-[#1a1a1e] px-4 py-3 hover:bg-[#1e1e22] transition-colors group">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <Avatar member={member} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{displayName}</div>
          <div className="text-xs text-muted-foreground truncate">{member.user.email}</div>
          <div className="mt-1 flex items-center gap-2">
            <ScopesSummary scopes={member.permissionScopes} />
            {member.maxApprovalTier > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/20 text-[10px]">
                Tier {member.maxApprovalTier}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {member.activeTasks !== undefined && member.activeTasks > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 border border-cyan-500/20">
            {member.activeTasks} tasks
          </span>
        )}
        {member.role === "OWNER" ? (
          <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border ${role.color}`}>
            <Crown className="h-3 w-3" />
            Owner
          </span>
        ) : (
          <>
            <select
              className="rounded-lg border border-border/60 bg-[#111113] px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#F97316]/40"
              value={member.role}
              onChange={(e) => onRoleChange(member.id, e.target.value)}
              aria-label="Select role"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{r.charAt(0) + r.slice(1).toLowerCase()}</option>
              ))}
            </select>
            <Button
              variant="subtle"
              size="sm"
              onClick={() => onEditPermissions(member)}
              className="text-muted-foreground hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label="Edit permissions"
            >
              <Settings2 className="h-4 w-4" />
            </Button>
            <Button
              variant="subtle"
              size="sm"
              onClick={() => onRemove(member.id, displayName)}
              className="text-red-400 hover:text-red-300 hover:bg-red-900/20 opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label="Remove team member"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function PermissionEditor({
  member,
  onSave,
  onClose,
}: {
  member: TeamMember;
  onSave: (membershipId: string, scopes: Record<string, string>, tier: number) => void;
  onClose: () => void;
}) {
  const [scopes, setScopes] = useState<Record<string, string>>({ ...member.permissionScopes });
  const [tier, setTier] = useState(member.maxApprovalTier);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave(member.id, scopes, tier);
    setSaving(false);
  };

  const displayName = getDisplayName(member);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="kf-card p-5 space-y-4 border border-[#F97316]/20"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-[#F97316]" />
          <span className="text-sm font-semibold">Permissions for {displayName}</span>
        </div>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-white transition-colors">
          Cancel
        </button>
      </div>

      <div className="space-y-1">
        <div className="grid grid-cols-[1fr_repeat(4,56px)] gap-1 text-[10px] text-muted-foreground font-medium px-2 pb-1 border-b border-border/30">
          <span>Module</span>
          {PERMISSION_LEVELS.map((level) => {
            const Icon = levelIcon[level];
            return (
              <span key={level} className={`text-center ${levelColor[level]}`}>
                <Icon className="h-3 w-3 mx-auto mb-0.5" />
                {level}
              </span>
            );
          })}
        </div>
        {PERMISSION_MODULES.map((mod) => (
          <div key={mod.key} className="grid grid-cols-[1fr_repeat(4,56px)] gap-1 items-center px-2 py-1.5 rounded-lg hover:bg-muted/10 transition-colors">
            <span className="text-xs">{mod.label}</span>
            {PERMISSION_LEVELS.map((level) => (
              <button
                key={level}
                onClick={() => setScopes((prev) => ({ ...prev, [mod.key]: level }))}
                className={`h-7 w-7 mx-auto rounded-md border transition-all ${
                  scopes[mod.key] === level
                    ? `${levelColor[level]} border-current bg-current/10 ring-1 ring-current/30`
                    : "border-border/30 hover:border-border/60"
                }`}
                aria-label={`Set ${mod.label} to ${level}`}
              >
                {scopes[mod.key] === level && (
                  <CheckCircle2 className="h-3.5 w-3.5 mx-auto" />
                )}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 pt-2 border-t border-border/30">
        <div className="flex items-center gap-2 flex-1">
          <Zap className="h-4 w-4 text-purple-400" />
          <span className="text-xs">Max Approval Tier</span>
          <select
            className="rounded-lg border border-border/60 bg-[#111113] px-2.5 py-1.5 text-xs ml-2 focus:outline-none focus:ring-1 focus:ring-purple-400/40"
            value={tier}
            onChange={(e) => setTier(parseInt(e.target.value))}
          >
            {APPROVAL_TIERS.map((t) => (
              <option key={t} value={t}>
                Tier {t} {t === 0 ? "(None)" : t === 4 ? "(All)" : ""}
              </option>
            ))}
          </select>
        </div>
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? "Saving..." : "Save Permissions"}
        </Button>
      </div>
    </motion.div>
  );
}

function ActivityFeed({
  activities,
  members,
  moduleFilter,
  onModuleFilter,
}: {
  activities: ActivityItem[];
  members: TeamMember[];
  moduleFilter: string;
  onModuleFilter: (m: string) => void;
}) {
  const memberMap = new Map(members.map((m) => [m.userId, m]));
  const modules = [...new Set(activities.map((a) => a.module))];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
        <button
          onClick={() => onModuleFilter("")}
          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
            !moduleFilter ? "border-[#F97316]/40 bg-[#F97316]/10 text-[#F97316]" : "border-border/40 text-muted-foreground hover:border-border/60"
          }`}
        >
          All
        </button>
        {modules.map((m) => (
          <button
            key={m}
            onClick={() => onModuleFilter(m)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors capitalize ${
              moduleFilter === m ? "border-[#F97316]/40 bg-[#F97316]/10 text-[#F97316]" : "border-border/40 text-muted-foreground hover:border-border/60"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {activities.length === 0 ? (
        <div className="kf-card p-8 text-center">
          <Activity className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
          <h3 className="text-sm font-medium mb-1">No Activity Yet</h3>
          <p className="text-xs text-muted-foreground">Team actions will appear here as your team works.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {activities
            .filter((a) => !moduleFilter || a.module === moduleFilter)
            .map((item) => {
              const member = memberMap.get(item.userId);
              const actorName = member ? getDisplayName(member) : "Unknown";
              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/10 transition-colors"
                >
                  <div className="mt-0.5">
                    <Activity className={`h-3.5 w-3.5 ${moduleColor[item.module] || "text-muted-foreground"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs">
                      <span className="font-medium">{actorName}</span>
                      <span className="text-muted-foreground"> {item.title}</span>
                    </div>
                    {item.detail && (
                      <div className="text-[10px] text-muted-foreground mt-0.5">{item.detail}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded capitalize ${moduleColor[item.module] || "text-muted-foreground"} bg-muted/20`}>
                      {item.module}
                    </span>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {formatTimeAgo(item.createdAt)}
                    </span>
                  </div>
                </motion.div>
              );
            })}
        </div>
      )}
    </div>
  );
}

export default function TeamSettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("members");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("STAFF");
  const [inviteScopes, setInviteScopes] = useState<Record<string, string>>({});
  const [inviteTier, setInviteTier] = useState(0);
  const [showInvite, setShowInvite] = useState(false);
  const [showAdvancedInvite, setShowAdvancedInvite] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{ membershipId: string; name: string } | null>(null);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [moduleFilter, setModuleFilter] = useState("");
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);

  const loadDashboard = useCallback(async () => {
    const businessId = getStoredBusinessId();
    if (!businessId) { setLoading(false); return; }
    const res = await apiGet<DashboardData>(`/identity/businesses/${businessId}/team/dashboard`);
    if (res.data) {
      setDashboard(res.data);
      setActivityItems(res.data.recentActivity);
    }
    setLoading(false);
  }, []);

  const loadActivity = useCallback(async (mod?: string) => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    const params = new URLSearchParams({ limit: "50" });
    if (mod) params.set("module", mod);
    const res = await apiGet<{ items: ActivityItem[]; total: number }>(
      `/identity/businesses/${businessId}/team/activity?${params.toString()}`
    );
    if (res.data) setActivityItems(res.data.items);
  }, []);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  useEffect(() => {
    if (activeTab === "activity") loadActivity(moduleFilter || undefined);
  }, [activeTab, moduleFilter, loadActivity]);

  useEffect(() => {
    setInviteScopes(DEFAULT_SCOPES[inviteRole] || DEFAULT_SCOPES.STAFF);
    setInviteTier(DEFAULT_TIERS[inviteRole] ?? 0);
  }, [inviteRole]);

  const handleInvite = async () => {
    const businessId = getStoredBusinessId();
    if (!businessId || !inviteEmail.trim()) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim())) {
      toast.error("Please enter a valid email address");
      return;
    }
    setInviting(true);

    const payload: Record<string, unknown> = {
      email: inviteEmail.trim(),
      role: inviteRole,
      scopes: inviteScopes,
      maxApprovalTier: inviteTier,
    };
    const res = await apiPost(`/identity/businesses/${businessId}/team`, payload);
    setInviting(false);
    if (res.error) {
      toast.error(res.error || "Failed to invite team member");
    } else {
      toast.success("Team member invited");
      setInviteEmail("");
      setShowInvite(false);
      setShowAdvancedInvite(false);
      loadDashboard();
    }
  };

  const handleRemove = async (membershipId: string) => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    const res = await apiDelete(`/identity/businesses/${businessId}/team/${membershipId}`);
    if (res.error) {
      toast.error(res.error || "Failed to remove team member");
    } else {
      toast.success("Team member removed");
      loadDashboard();
    }
  };

  const handleRoleChange = async (membershipId: string, newRole: string) => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    const res = await apiPatch(`/identity/businesses/${businessId}/team/${membershipId}`, { role: newRole });
    if (res.error) {
      toast.error(res.error || "Failed to update role");
    } else {
      toast.success("Role updated");
      loadDashboard();
    }
  };

  const handleSavePermissions = async (membershipId: string, scopes: Record<string, string>, maxApprovalTier: number) => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    const res = await apiPatch(`/identity/businesses/${businessId}/team/${membershipId}/permissions`, {
      scopes,
      maxApprovalTier,
    });
    if (res.error) {
      toast.error(res.error || "Failed to update permissions");
    } else {
      toast.success("Permissions updated");
      setEditingMember(null);
      loadDashboard();
    }
  };

  if (loading) return <SkeletonTeam />;

  const members = dashboard?.members ?? [];
  const ownerCount = members.filter((m) => m.role === "OWNER").length;
  const adminCount = members.filter((m) => m.role === "ADMIN").length;
  const staffCount = members.filter((m) => m.role === "STAFF").length;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-5"
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Users className="h-5 w-5 text-[#F97316]" />
            Team
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage your team, permissions, and activity
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">{ownerCount} owner</span>
            <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">{adminCount} admin</span>
            <span className="px-2 py-0.5 rounded bg-muted/20 text-muted-foreground border border-border/30">{staffCount} staff</span>
          </div>
          <Button size="sm" onClick={() => setShowInvite(!showInvite)}>
            <UserPlus className="h-3.5 w-3.5 mr-1.5" />
            Invite
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {showInvite && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="kf-card p-4 space-y-3 border border-[#F97316]/20">
              <div className="flex items-center gap-2 text-sm font-medium">
                <UserPlus className="h-4 w-4 text-[#F97316]" />
                Invite Team Member
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-10"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@email.com"
                    aria-label="Team member email"
                    onKeyDown={(e) => e.key === "Enter" && handleInvite()}
                  />
                </div>
                <select
                  className="rounded-lg border border-border/60 bg-[#111113] px-3 py-2 text-sm min-w-[100px] focus:outline-none focus:ring-1 focus:ring-[#F97316]/40"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  aria-label="Select role"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{r.charAt(0) + r.slice(1).toLowerCase()}</option>
                  ))}
                </select>
                <Button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>
                  {inviting ? "Inviting..." : "Send Invite"}
                </Button>
              </div>
              <div className="pt-1">
                <button
                  onClick={() => setShowAdvancedInvite(!showAdvancedInvite)}
                  className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-white transition-colors"
                >
                  <ChevronRight className={`h-3 w-3 transition-transform ${showAdvancedInvite ? "rotate-90" : ""}`} />
                  {showAdvancedInvite ? "Hide" : "Set"} permissions &amp; approval tier
                </button>
              </div>

              <AnimatePresence>
                {showAdvancedInvite && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden space-y-3 pt-2 border-t border-border/30"
                  >
                    <div className="text-[10px] text-muted-foreground font-medium">Permission Preview</div>
                    <div className="space-y-0.5">
                      <div className="grid grid-cols-[1fr_repeat(4,48px)] gap-1 text-[10px] text-muted-foreground font-medium px-2 pb-1">
                        <span>Module</span>
                        {PERMISSION_LEVELS.map((level) => (
                          <span key={level} className={`text-center ${levelColor[level]}`}>{level}</span>
                        ))}
                      </div>
                      {PERMISSION_MODULES.map((mod) => (
                        <div key={mod.key} className="grid grid-cols-[1fr_repeat(4,48px)] gap-1 items-center px-2 py-1 rounded hover:bg-muted/10">
                          <span className="text-[11px]">{mod.label}</span>
                          {PERMISSION_LEVELS.map((level) => (
                            <button
                              key={level}
                              onClick={() => setInviteScopes((prev) => ({ ...prev, [mod.key]: level }))}
                              className={`h-6 w-6 mx-auto rounded border transition-all ${
                                inviteScopes[mod.key] === level
                                  ? `${levelColor[level]} border-current bg-current/10 ring-1 ring-current/30`
                                  : "border-border/30 hover:border-border/60"
                              }`}
                              aria-label={`Set ${mod.label} to ${level}`}
                            >
                              {inviteScopes[mod.key] === level && <CheckCircle2 className="h-3 w-3 mx-auto" />}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <Zap className="h-3.5 w-3.5 text-purple-400" />
                      <span className="text-[11px]">Approval Tier</span>
                      <select
                        className="rounded-lg border border-border/60 bg-[#111113] px-2 py-1 text-[11px] ml-1 focus:outline-none focus:ring-1 focus:ring-purple-400/40"
                        value={inviteTier}
                        onChange={(e) => setInviteTier(parseInt(e.target.value))}
                      >
                        {APPROVAL_TIERS.map((t) => (
                          <option key={t} value={t}>Tier {t}{t === 0 ? " (None)" : t === 4 ? " (All)" : ""}</option>
                        ))}
                      </select>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center gap-1 border-b border-border/30 -mx-1">
        {TABS.map((tab) => {
          const tabIcons = { members: Users, activity: Activity, permissions: Shield };
          const TabIcon = tabIcons[tab];
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium capitalize border-b-2 transition-colors ${
                activeTab === tab
                  ? "border-[#F97316] text-white"
                  : "border-transparent text-muted-foreground hover:text-white hover:border-border/60"
              }`}
            >
              <TabIcon className="h-3.5 w-3.5" />
              {tab}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === "members" && (
          <motion.div
            key="members"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-3"
          >
            {members.length === 0 ? (
              <div className="kf-card p-8 text-center">
                <Users className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
                <h3 className="text-sm font-medium mb-1">No Team Members Yet</h3>
                <p className="text-xs text-muted-foreground">Invite your first team member to get started.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {members.map((member) => (
                  <MemberCard
                    key={member.id}
                    member={member}
                    onRoleChange={handleRoleChange}
                    onRemove={(id, name) => setConfirmRemove({ membershipId: id, name })}
                    onEditPermissions={(m) => setEditingMember(m)}
                  />
                ))}
              </div>
            )}

            <AnimatePresence>
              {editingMember && (
                <PermissionEditor
                  member={editingMember}
                  onSave={handleSavePermissions}
                  onClose={() => setEditingMember(null)}
                />
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {activeTab === "activity" && (
          <motion.div
            key="activity"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <ActivityFeed
              activities={activityItems}
              members={members}
              moduleFilter={moduleFilter}
              onModuleFilter={(m) => setModuleFilter(m)}
            />
          </motion.div>
        )}

        {activeTab === "permissions" && (
          <motion.div
            key="permissions"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-4"
          >
            <div className="kf-card p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Shield className="h-4 w-4 text-[#F97316]" />
                Permission Overview
              </div>
              <p className="text-xs text-muted-foreground">
                Each module can be set to none, read, write, or admin access per team member. Approval tiers control which AI actions a member can approve.
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/30">
                      <th className="text-left py-2 px-2 text-muted-foreground font-medium">Member</th>
                      <th className="text-center py-2 px-1 text-muted-foreground font-medium">Role</th>
                      <th className="text-center py-2 px-1 text-muted-foreground font-medium">Tier</th>
                      {PERMISSION_MODULES.map((mod) => (
                        <th key={mod.key} className="text-center py-2 px-1 text-muted-foreground font-medium whitespace-nowrap">
                          {mod.label.split(" ")[0]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member) => {
                      const displayName = getDisplayName(member);
                      return (
                        <tr key={member.id} className="border-b border-border/20 hover:bg-muted/5">
                          <td className="py-2 px-2 font-medium truncate max-w-[120px]">{displayName}</td>
                          <td className="py-2 px-1 text-center">
                            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] border ${(roleConfig[member.role] || roleConfig.STAFF).color}`}>
                              {member.role}
                            </span>
                          </td>
                          <td className="py-2 px-1 text-center">
                            <span className="text-purple-400">{member.maxApprovalTier}</span>
                          </td>
                          {PERMISSION_MODULES.map((mod) => {
                            const level = member.permissionScopes[mod.key] || "none";
                            const Icon = levelIcon[level];
                            return (
                              <td key={mod.key} className="py-2 px-1 text-center">
                                <Icon className={`h-3.5 w-3.5 mx-auto ${levelColor[level]}`} />
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="kf-card p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Zap className="h-4 w-4 text-purple-400" />
                Approval Tier Guide
              </div>
              <div className="grid grid-cols-5 gap-2">
                {APPROVAL_TIERS.map((t) => (
                  <div
                    key={t}
                    className="rounded-lg border border-border/30 p-3 text-center space-y-1"
                  >
                    <div className="text-lg font-bold text-purple-400">{t}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {t === 0 && "No approvals"}
                      {t === 1 && "Low-risk only"}
                      {t === 2 && "Standard ops"}
                      {t === 3 && "High-impact"}
                      {t === 4 && "Critical / All"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={!!confirmRemove}
        title="Remove Team Member"
        message={`Are you sure you want to remove ${confirmRemove?.name ?? "this member"} from your team? This action cannot be undone.`}
        confirmLabel="Remove"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => {
          if (confirmRemove) handleRemove(confirmRemove.membershipId);
          setConfirmRemove(null);
        }}
        onCancel={() => setConfirmRemove(null)}
      />
    </motion.div>
  );
}
