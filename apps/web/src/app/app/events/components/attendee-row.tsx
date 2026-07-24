"use client";

import { Mail, Phone, Ticket, Trash2, Edit2, CheckCircle2, CreditCard } from "lucide-react";
import { Surface, Badge, Button } from "@/components/ui-v2";
import type { AttendeeStatus, AttendeeWithTicketType } from "@/lib/api/events";

interface AttendeeRowProps {
  attendee: AttendeeWithTicketType;
  onEdit: () => void;
  onDelete: () => void;
}

const statusColors: Record<AttendeeStatus, "teal" | "rose" | "mint" | "sky"> = {
  REGISTERED: "teal",
  CANCELLED: "rose",
  CHECKED_IN: "mint",
  REFUNDED: "sky",
};

export function AttendeeRow({ attendee, onEdit, onDelete }: AttendeeRowProps) {
  return (
    <Surface variant="default" className="p-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-display text-body font-semibold text-foreground">
              {attendee.name || attendee.email}
            </h4>
            <Badge color={statusColors[attendee.status]}>{attendee.status.replace("_", " ")}</Badge>
            {attendee.ticketType && (
              <Badge color="orange" className="flex items-center gap-1">
                <Ticket className="w-3 h-3" />
                {attendee.ticketType.name}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-1.5 text-caption text-muted-foreground">
            <span className="flex items-center gap-1">
              <Mail className="w-3 h-3" />
              {attendee.email}
            </span>
            {attendee.phone && (
              <span className="flex items-center gap-1">
                <Phone className="w-3 h-3" />
                {attendee.phone}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {attendee.ticketType && Number(attendee.ticketType.price) > 0 && attendee.paymentId && (
            <a
              href={`/widgets/pay/${attendee.paymentId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              <CreditCard className="w-4 h-4" />
              Pay
            </a>
          )}
          <Button variant="ghost" onClick={onEdit} leftIcon={<Edit2 className="w-4 h-4" />}>
            Edit
          </Button>
          <Button variant="ghost" onClick={onDelete} leftIcon={<Trash2 className="w-4 h-4 text-rose" />}>
            Delete
          </Button>
        </div>
      </div>
    </Surface>
  );
}

interface CheckInAttendeeRowProps {
  attendee: AttendeeWithTicketType;
  onCheckIn: () => void;
  onUndo: () => void;
  loading?: boolean;
}

export function CheckInAttendeeRow({ attendee, onCheckIn, onUndo, loading }: CheckInAttendeeRowProps) {
  const checkedIn = attendee.status === "CHECKED_IN" || !!attendee.checkedInAt;

  return (
    <Surface variant="default" className="p-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-display text-body font-semibold text-foreground">
              {attendee.name || attendee.email}
            </h4>
            {checkedIn ? (
              <Badge color="mint" className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                Checked in
              </Badge>
            ) : (
              <Badge color="teal">Registered</Badge>
            )}
            {attendee.ticketType && (
              <Badge color="orange" className="flex items-center gap-1">
                <Ticket className="w-3 h-3" />
                {attendee.ticketType.name}
              </Badge>
            )}
          </div>
          <p className="text-caption text-muted-foreground mt-1">{attendee.email}</p>
        </div>
        {checkedIn ? (
          <Button variant="soft" onClick={onUndo} isLoading={loading}>
            Undo check-in
          </Button>
        ) : (
          <Button variant="primary" onClick={onCheckIn} isLoading={loading}>
            Check in
          </Button>
        )}
      </div>
    </Surface>
  );
}
