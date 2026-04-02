"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Users, UserPlus, Trash2, CheckCircle2, AlertCircle, Mail, Shield, Crown } from "lucide-react";
import { Button, Input, Card, Badge } from "@keyflow/ui";
import { getStoredBusinessId } from "@/lib/workspace";
import { apiGet, apiPostSimple as apiPost, apiDelete, apiPatch } from "@/lib/api";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InfoBadge } from "@/components/ui/info-badge";

type TeamMember = {
  id: string;
  role: string;
  user: {
    id: string;
    email: string;
    name: string | null;
  };
};

const ROLES = ["ADMIN", "STAFF"];

const roleConfig: Record<string, { label: string; color: string; icon: typeof Shield }> = {
  OWNER: { label: "Owner", color: "bg-amber-500/20 text-amber-300 border-amber-500/30", icon: Crown },
  ADMIN: { label: "Admin", color: "bg-blue-500/20 text-blue-300 border-blue-500/30", icon: Shield },
  STAFF: { label: "Staff", color: "bg-muted/40 text-muted-foreground border-border/40", icon: Users },
};

const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25 } },
};

function SkeletonTeam() {
  return (
    <div className="space-y-6 max-w-2xl animate-pulse">
      <div className="kf-card p-6 space-y-4">
        <div className="h-4 w-32 bg-muted/40 rounded" />
        <div className="flex gap-2">
          <div className="h-10 flex-1 bg-muted/20 rounded-xl" />
          <div className="h-10 w-24 bg-muted/20 rounded-xl" />
          <div className="h-10 w-20 bg-muted/30 rounded-xl" />
        </div>
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

export default function TeamSettingsPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("STAFF");
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{ membershipId: string; name: string } | null>(null);

  const loadMembers = async () => {
    const businessId = getStoredBusinessId();
    if (!businessId) { setLoading(false); return; }
    const res = await apiGet<TeamMember[]>(`/identity/businesses/${businessId}/team`);
    if (res.data) setMembers(res.data);
    setLoading(false);
  };

  useEffect(() => { loadMembers(); }, []);

  const handleInvite = async () => {
    const businessId = getStoredBusinessId();
    if (!businessId || !inviteEmail.trim()) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim())) {
      setStatus({ type: "error", message: "Please enter a valid email address" });
      return;
    }
    setInviting(true);
    setStatus(null);
    const res = await apiPost(`/identity/businesses/${businessId}/team`, {
      email: inviteEmail.trim(),
      role: inviteRole,
    });
    setInviting(false);
    if (res.error) {
      setStatus({ type: "error", message: res.error });
    } else {
      setStatus({ type: "success", message: "Team member invited" });
      setInviteEmail("");
      loadMembers();
    }
  };

  const handleRemove = async (membershipId: string) => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    const res = await apiDelete(`/identity/businesses/${businessId}/team/${membershipId}`);
    if (res.error) {
      setStatus({ type: "error", message: res.error });
    } else {
      setStatus({ type: "success", message: "Team member removed" });
      loadMembers();
    }
  };

  const handleRoleChange = async (membershipId: string, newRole: string) => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    const res = await apiPatch(`/identity/businesses/${businessId}/team/${membershipId}`, { role: newRole });
    if (res.error) {
      setStatus({ type: "error", message: res.error });
    } else {
      loadMembers();
    }
  };

  if (loading) return <SkeletonTeam />;

  return (
    <motion.div
      variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } }}
      initial="hidden"
      animate="show"
      className="space-y-6 max-w-2xl"
    >
      {status && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm ${
            status.type === "success"
              ? "border border-emerald-400/40 bg-emerald-900/20 text-emerald-200"
              : "border border-red-400/40 bg-red-900/20 text-red-200"
          }`}
        >
          {status.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          {status.message}
        </motion.div>
      )}

      <motion.div variants={fadeUp} className="kf-card p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <UserPlus className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          Invite Team Member
        </div>
        <p className="text-xs text-muted-foreground">
          Add staff to your business. They will receive access based on their assigned role.
        </p>

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
            className="rounded-xl border border-border/60 bg-muted/10 px-3 py-2 text-sm min-w-[100px]"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            aria-label="Select role"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{r.charAt(0) + r.slice(1).toLowerCase()}</option>
            ))}
          </select>
          <Button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>
            {inviting ? "Inviting..." : "Invite"}
          </Button>
        </div>
      </motion.div>

      <motion.div variants={fadeUp} className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Team Members <InfoBadge title="Roles" body="Admin has full access to all settings and data. Staff can manage day-to-day operations but cannot change billing or team settings." side="right" iconSize={12} />
          </div>
          <span className="text-xs text-muted-foreground px-2.5 py-1 rounded-full bg-muted/30 border border-border/40">
            {members.length} {members.length === 1 ? "member" : "members"}
          </span>
        </div>

        {members.length === 0 ? (
          <motion.div variants={fadeUp} className="kf-card p-8 text-center">
            <Users className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
            <h3 className="text-sm font-medium mb-1">No Team Members Yet</h3>
            <p className="text-xs text-muted-foreground">Invite your first team member above to get started.</p>
          </motion.div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence>
              {members.map((member, idx) => {
                const role = roleConfig[member.role] || roleConfig.STAFF;
                const displayName = member.user.name || member.user.email.split("@")[0];
                const initials = displayName.split(" ").map((n) => n.charAt(0).toUpperCase()).slice(0, 2).join("");

                return (
                  <motion.div
                    key={member.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ delay: idx * 0.03 }}
                    className="flex items-center justify-between rounded-xl border border-border/40 bg-muted/5 px-4 py-3 hover:bg-muted/10 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white text-sm font-bold shadow-sm">
                        {initials}
                      </div>
                      <div>
                        <div className="text-sm font-medium">{displayName}</div>
                        <div className="text-xs text-muted-foreground">{member.user.email}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {member.role === "OWNER" ? (
                        <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border ${role.color}`}>
                          <Crown className="h-3 w-3" />
                          Owner
                        </span>
                      ) : (
                        <>
                          <select
                            className="rounded-xl border border-border/60 bg-muted/10 px-2.5 py-1.5 text-xs"
                            value={member.role}
                            onChange={(e) => handleRoleChange(member.id, e.target.value)}
                            aria-label="Select role"
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>{r.charAt(0) + r.slice(1).toLowerCase()}</option>
                            ))}
                          </select>
                          <Button
                            variant="subtle"
                            size="sm"
                            onClick={() =>
                              setConfirmRemove({
                                membershipId: member.id,
                                name: displayName,
                              })
                            }
                            className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
                            aria-label="Remove team member"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </motion.div>

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
