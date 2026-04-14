"use client";

import { User, ExternalLink, Mail, Phone, Building } from "lucide-react";

interface ClientTabProps {
  contactId?: string;
}

export function ClientTab({ contactId }: ClientTabProps) {
  if (!contactId) {
    return (
      <div className="text-center py-8 rounded-xl border border-dashed border-border/40">
        <User className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm font-medium">No client linked</p>
        <p className="text-xs text-muted-foreground mt-1">Link a client to this project to track deliverables against their account.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/40 bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--kf-info) / 0.1)" }}>
            <User className="w-5 h-5" style={{ color: "hsl(var(--kf-info))" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Client Linked</p>
            <p className="text-[10px] text-muted-foreground">ID: {contactId.slice(0, 8)}...</p>
          </div>
          <a
            href={`/app/crm/contacts/${contactId}`}
            className="text-xs px-3 py-1.5 rounded-lg font-medium inline-flex items-center gap-1 transition-colors"
            style={{ background: "hsl(var(--kf-info) / 0.1)", color: "hsl(var(--kf-info))" }}
          >
            <ExternalLink className="w-3 h-3" />
            Open in CRM
          </a>
        </div>
      </div>

      <div className="rounded-xl border border-border/40 bg-card p-4 space-y-3">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Quick Info</h4>
        <p className="text-xs text-muted-foreground">Client details are available from the CRM module. Use the link above to view the full client profile.</p>
      </div>
    </div>
  );
}
