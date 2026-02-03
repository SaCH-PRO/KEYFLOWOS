"use client";

import { useEffect, useState } from "react";
import { Users, UserPlus, Trash2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button, Input, Card, Badge } from "@keyflow/ui";
import { getStoredBusinessId } from "@/lib/workspace";
import { apiGet, apiPostSimple as apiPost, apiDelete, apiPatch } from "@/lib/api";

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

export default function TeamSettingsPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("STAFF");
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const loadMembers = async () => {
    const businessId = getStoredBusinessId();
    if (!businessId) {
      setLoading(false);
      return;
    }
    const res = await apiGet<TeamMember[]>(`/identity/businesses/${businessId}/team`);
    if (res.data) {
      setMembers(res.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadMembers();
  }, []);

  const handleInvite = async () => {
    const businessId = getStoredBusinessId();
    if (!businessId || !inviteEmail.trim()) return;
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

  if (loading) {
    return <div className="text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {status && (
        <div
          className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${
            status.type === "success"
              ? "border border-emerald-400/40 bg-emerald-900/30 text-emerald-200"
              : "border border-red-400/40 bg-red-900/30 text-red-200"
          }`}
        >
          {status.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {status.message}
        </div>
      )}

      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <UserPlus className="h-4 w-4 text-primary" />
          Invite Team Member
        </div>

        <div className="flex gap-2">
          <Input
            className="flex-1"
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="email@example.com"
          />
          <select
            className="rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2 text-sm"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <Button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>
            {inviting ? "Inviting..." : "Invite"}
          </Button>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Users className="h-4 w-4 text-primary" />
          Team Members ({members.length})
        </div>

        <div className="space-y-2">
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No team members yet. Invite someone above.</p>
          ) : (
            members.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between rounded-xl border border-border/60 bg-slate-950/60 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-sm font-semibold">
                    {(member.user.name || member.user.email)[0].toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{member.user.name || member.user.email.split("@")[0]}</div>
                    <div className="text-xs text-muted-foreground">{member.user.email}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {member.role === "OWNER" ? (
                    <Badge variant="default">Owner</Badge>
                  ) : (
                    <>
                      <select
                        className="rounded-lg border border-border/60 bg-slate-950/80 px-2 py-1 text-xs"
                        value={member.role}
                        onChange={(e) => handleRoleChange(member.id, e.target.value)}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemove(member.id)}
                        className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
