"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchContactDetail } from "@/lib/client";
import { Badge } from "@keyflow/ui";
import { User, Mail, Phone, MapPin, Calendar, Star } from "lucide-react";

interface Contact {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  status?: string | null;
  leadScore?: number | null;
  tags?: string[];
  city?: string | null;
  country?: string | null;
  favorite?: boolean;
}

function timeAgo(d: string | null) {
  if (!d) return "Never";
  const diff = Date.now() - new Date(d).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(d).toLocaleDateString();
}

export default function ContactHeader() {
  const { contactId } = useParams();
  const [contact, setContact] = useState<Contact | null>(null);

  useEffect(() => {
    fetchContactDetail(contactId as string).then((res) => {
      if (res.data) setContact(res.data as any);
    });
  }, [contactId]);

  if (!contact) return <div className="h-16 border-b animate-pulse bg-muted/30" />;

  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Unnamed Contact";
  const score = contact.leadScore ?? 0;
  const scoreColor = score >= 80 ? "bg-green-100 text-green-800" : score >= 60 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800";

  return (
    <div className="rounded-xl border border-border/50 bg-card/50 p-4 mb-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <User className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">{name}</h1>
              {contact.favorite && <Star className="h-4 w-4 fill-amber-400 text-amber-400" />}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {contact.status && <Badge>{contact.status}</Badge>}
              {contact.email && (
                <span className="flex items-center gap-1">
                  <Mail className="h-3 w-3" />
                  {contact.email}
                </span>
              )}
              {contact.phone && (
                <span className="flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  {contact.phone}
                </span>
              )}
              {(contact.city || contact.country) && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {[contact.city, contact.country].filter(Boolean).join(", ")}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {contact.leadScore != null && (
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${scoreColor}`}>
              Score: {score}
            </span>
          )}
          {contact.tags && contact.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {contact.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
