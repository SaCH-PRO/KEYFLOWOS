"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, Input } from "@keyflow/ui";
import {
  Membership,
  createBusiness,
  deleteTeamMember,
  fetchBusinesses,
  fetchTeam,
  getActiveBusinessId,
  inviteTeamMember,
  setActiveBusinessId as setActiveBusinessIdStorage,
} from "@/lib/client";

export default function IdentityPage() {
  const [businesses, setBusinesses] = useState<Membership[]>([]);
  const [activeBusinessId, setActiveBusinessId] = useState<string>(() => getActiveBusinessId());
  const [team, setTeam] = useState<Membership[]>([]);
  const [businessName, setBusinessName] = useState("");
  const [invite, setInvite] = useState({ email: "", role: "STAFF" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const res = await fetchBusinesses();
      if (res.error) setError(res.error);
      const items = res.data ?? [];
      setBusinesses(items);
      const stored = getActiveBusinessId();
      const exists = items.some((membership) => membership.business?.id === stored);
      if (exists) {
        setActiveBusinessId(stored);
      } else if (items[0]?.business?.id) {
        setActiveBusinessIdStorage(items[0].business.id);
        setActiveBusinessId(items[0].business.id);
      }
    };
    void load();
  }, []);

  useEffect(() => {
    if (!activeBusinessId) {
      setTeam([]);
      return;
    }
    fetchTeam(activeBusinessId).then((res) => setTeam(res.data ?? []));
  }, [activeBusinessId]);

  const handleCreateBusiness = async () => {
    setError(null);
    if (!businessName.trim()) return;
    const res = await createBusiness({ name: businessName.trim() });
    if (res.error) {
      setError(res.error);
      return;
    }
    if (res.data?.id) {
      setActiveBusinessIdStorage(res.data.id);
      setActiveBusinessId(res.data.id);
    }
    const refreshed = await fetchBusinesses();
    setBusinesses(refreshed.data ?? []);
    setBusinessName("");
  };

  const handleInvite = async () => {
    setError(null);
    if (!activeBusinessId || !invite.email.trim()) return;
    const res = await inviteTeamMember({ businessId: activeBusinessId, email: invite.email.trim(), role: invite.role });
    if (res.error) {
      setError(res.error);
      return;
    }
    setInvite({ email: "", role: "STAFF" });
    const refreshed = await fetchTeam(activeBusinessId);
    setTeam(refreshed.data ?? []);
  };

  const handleRemove = async (membershipId: string) => {
    if (!activeBusinessId) return;
    await deleteTeamMember({ businessId: activeBusinessId, membershipId });
    const refreshed = await fetchTeam(activeBusinessId);
    setTeam(refreshed.data ?? []);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Identity & Teams</h1>
          <p className="text-sm text-muted-foreground">Manage businesses and team memberships.</p>
        </div>
        <Badge tone="info">{businesses.length} businesses</Badge>
      </div>

      {error && <div className="text-xs text-amber-400">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Create business" badge="Owner">
          <div className="flex gap-2">
            <Input label="Business name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
            <Button onClick={handleCreateBusiness}>Create</Button>
          </div>
        </Card>

        <Card title="Businesses" badge="Memberships">
          <div className="space-y-2 text-sm">
            {businesses.map((membership) => (
              <label key={membership.id} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="business"
                  value={membership.business?.id}
                  checked={activeBusinessId === membership.business?.id}
                  onChange={() => {
                    const nextId = membership.business?.id ?? "";
                    setActiveBusinessIdStorage(nextId);
                    setActiveBusinessId(nextId);
                  }}
                />
                <span className="font-semibold">{membership.business?.name ?? "Unnamed"}</span>
                <Badge tone="info">{membership.role}</Badge>
              </label>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Team members" badge={`${team.length}`}>
        <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-2">
            {team.length === 0 && <div className="text-xs text-muted-foreground">No team members yet.</div>}
            {team.map((member) => (
              <div key={member.id} className="flex items-center justify-between rounded-xl border border-border/60 bg-background px-3 py-2 text-sm">
                <div>
                  <div className="font-semibold">{member.user?.name ?? member.user?.email ?? "User"}</div>
                  <div className="text-xs text-muted-foreground">{member.user?.email ?? "-"}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="info">{member.role}</Badge>
                  <Button size="xs" variant="outline" onClick={() => handleRemove(member.id)}>
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Input
              label="Invite email"
              value={invite.email}
              onChange={(e) => setInvite((prev) => ({ ...prev, email: e.target.value }))}
            />
            <label className="text-xs text-muted-foreground">
              Role
              <select
                className="mt-1 w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
                value={invite.role}
                onChange={(e) => setInvite((prev) => ({ ...prev, role: e.target.value }))}
              >
                {["ADMIN", "STAFF"].map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="outline" onClick={handleInvite}>
              Invite member
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
