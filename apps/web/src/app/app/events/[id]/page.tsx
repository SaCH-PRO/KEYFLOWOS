"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Calendar,
  MapPin,
  Edit2,
  Plus,
  Trash2,
  Users,
  Ticket,
  CheckCircle,
  LayoutDashboard,
} from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { Surface, Button, Badge, EmptyState } from "@/components/ui-v2";
import {
  getEvent,
  updateEvent,
  deleteEvent,
  createTicketType,
  updateTicketType,
  deleteTicketType,
  listAttendees,
  createAttendee,
  updateAttendee,
  deleteAttendee,
  checkInAttendee,
  undoCheckIn,
  type EventDetail,
  type EventTicketType,
  type AttendeeWithTicketType,
  type CreateTicketTypeBody,
  type CreateAttendeeBody,
} from "@/lib/api/events";
import { getCachedBusiness } from "@/lib/workspace";
import { useEventsWorkspace } from "../hooks/use-events-workspace";
import { EventStatusBadge } from "../components/event-status-badge";
import { EventStats, formatCurrency, computeRevenue } from "../components/event-stats";
import { TicketTypeForm } from "../components/ticket-type-form";
import { AttendeeForm } from "../components/attendee-form";
import { AttendeeRow } from "../components/attendee-row";
import { CheckInPanel } from "../components/check-in-panel";

const TABS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "tickets", label: "Tickets", icon: Ticket },
  { key: "attendees", label: "Attendees", icon: Users },
  { key: "check-in", label: "Check-in", icon: CheckCircle },
];

type TabKey = "overview" | "tickets" | "attendees" | "check-in";

function formatEventDateRange(startsAt: string, endsAt: string | null, timezone: string) {
  const start = new Date(startsAt);
  const end = endsAt ? new Date(endsAt) : null;
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  if (!end) return `${fmt(start)} · ${timezone}`;
  return `${fmt(start)} – ${fmt(end)} · ${timezone}`;
}

export default function EventDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const { businessId, loading: workspaceLoading, error: workspaceError } = useEventsWorkspace();

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [attendees, setAttendees] = useState<AttendeeWithTicketType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [actionLoading, setActionLoading] = useState(false);

  const [ticketFormOpen, setTicketFormOpen] = useState(false);
  const [editingTicket, setEditingTicket] = useState<EventTicketType | null>(null);
  const [attendeeFormOpen, setAttendeeFormOpen] = useState(false);
  const [editingAttendee, setEditingAttendee] = useState<AttendeeWithTicketType | null>(null);
  const [checkInLoadingIds, setCheckInLoadingIds] = useState<Record<string, boolean>>({});

  const businessCurrency = getCachedBusiness()?.currency ?? "TTD";

  const load = useCallback(async () => {
    if (!businessId || !eventId) return;
    setLoading(true);
    setError(null);
    const [eventRes, attendeesRes] = await Promise.all([
      getEvent(businessId, eventId),
      listAttendees(businessId, eventId),
    ]);
    if (eventRes.error || !eventRes.data) {
      setError(eventRes.error ?? "Event not found");
      toast.error(eventRes.error ?? "Event not found");
    } else {
      setEvent(eventRes.data);
    }
    setAttendees(attendeesRes.data ?? []);
    setLoading(false);
  }, [businessId, eventId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates async/server data into local state
    void load();
  }, [load]);

  async function handleUpdateEvent(partial: Parameters<typeof updateEvent>[2]) {
    if (!businessId || !eventId) return;
    setActionLoading(true);
    const { data, error } = await updateEvent(businessId, eventId, partial);
    if (error || !data) {
      toast.error(error ?? "Failed to update event");
    } else {
      setEvent(data);
      toast.success("Event updated");
    }
    setActionLoading(false);
  }

  async function handleDeleteEvent() {
    if (!businessId || !eventId) return;
    if (!confirm("Are you sure you want to delete this event?")) return;
    setActionLoading(true);
    const { error } = await deleteEvent(businessId, eventId);
    if (error) {
      toast.error(error);
      setActionLoading(false);
    } else {
      toast.success("Event deleted");
      router.push("/app/events");
    }
  }

  async function handleCreateTicketType(body: CreateTicketTypeBody) {
    if (!businessId || !eventId) return { error: "Missing workspace" };
    const { data, error } = await createTicketType(businessId, eventId, body);
    if (error || !data) return { error: error ?? "Failed" };
    await load();
    setTicketFormOpen(false);
    toast.success("Ticket type created");
    return {};
  }

  async function handleUpdateTicketType(ticketTypeId: string, body: CreateTicketTypeBody) {
    if (!businessId || !eventId) return { error: "Missing workspace" };
    const { data, error } = await updateTicketType(businessId, eventId, ticketTypeId, body);
    if (error || !data) return { error: error ?? "Failed" };
    await load();
    setEditingTicket(null);
    toast.success("Ticket type updated");
    return {};
  }

  async function handleDeleteTicketType(ticketTypeId: string) {
    if (!businessId || !eventId) return;
    if (!confirm("Delete this ticket type?")) return;
    const { error } = await deleteTicketType(businessId, eventId, ticketTypeId);
    if (error) {
      toast.error(error);
    } else {
      await load();
      toast.success("Ticket type deleted");
    }
  }

  async function handleCreateAttendee(body: CreateAttendeeBody) {
    if (!businessId || !eventId) return { error: "Missing workspace" };
    const { data, error } = await createAttendee(businessId, eventId, body);
    if (error || !data) return { error: error ?? "Failed" };
    await load();
    setAttendeeFormOpen(false);
    toast.success("Attendee added");
    return {};
  }

  async function handleUpdateAttendee(attendeeId: string, body: CreateAttendeeBody) {
    if (!businessId || !eventId) return { error: "Missing workspace" };
    const { data, error } = await updateAttendee(businessId, eventId, attendeeId, body);
    if (error || !data) return { error: error ?? "Failed" };
    await load();
    setEditingAttendee(null);
    toast.success("Attendee updated");
    return {};
  }

  async function handleDeleteAttendee(attendeeId: string) {
    if (!businessId || !eventId) return;
    if (!confirm("Delete this attendee?")) return;
    const { error } = await deleteAttendee(businessId, eventId, attendeeId);
    if (error) {
      toast.error(error);
    } else {
      await load();
      toast.success("Attendee deleted");
    }
  }

  async function handleCheckIn(attendeeId: string) {
    if (!businessId || !eventId) return;
    setCheckInLoadingIds((prev) => ({ ...prev, [attendeeId]: true }));
    const { error } = await checkInAttendee(businessId, eventId, attendeeId);
    if (error) {
      toast.error(error);
    } else {
      await load();
      toast.success("Checked in");
    }
    setCheckInLoadingIds((prev) => ({ ...prev, [attendeeId]: false }));
  }

  async function handleUndoCheckIn(attendeeId: string) {
    if (!businessId || !eventId) return;
    setCheckInLoadingIds((prev) => ({ ...prev, [attendeeId]: true }));
    const { error } = await undoCheckIn(businessId, eventId, attendeeId);
    if (error) {
      toast.error(error);
    } else {
      await load();
      toast.success("Check-in undone");
    }
    setCheckInLoadingIds((prev) => ({ ...prev, [attendeeId]: false }));
  }

  if (workspaceLoading || (!businessId && !workspaceError)) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (workspaceError || !businessId) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center px-6">
        <h2 className="font-display text-title font-semibold text-foreground">Workspace not found</h2>
        <p className="text-body text-muted-foreground mt-2">{workspaceError ?? "Please sign in again."}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center px-6">
        <h2 className="font-display text-title font-semibold text-foreground">Event not found</h2>
        <p className="text-body text-muted-foreground mt-2">{error ?? "This event does not exist."}</p>
        <Button variant="primary" className="mt-6" onClick={() => router.push("/app/events")}>
          Back to events
        </Button>
      </div>
    );
  }

  const currency = event.ticketTypes[0]?.currency ?? businessCurrency;
  const revenue = computeRevenue(event.ticketTypes);

  return (
    <WorkspaceShell
      icon={Calendar}
      title={event.name}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5" />
            {event.location ?? "No location"}
          </span>
          <span>{formatEventDateRange(event.startsAt, event.endsAt, event.timezone)}</span>
        </span>
      }
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={(key) => setActiveTab(key as TabKey)}
      headerRight={
        <div className="flex items-center gap-2 flex-wrap">
          <EventStatusBadge status={event.status} />
          {event.isPublished ? (
            <Button
              variant="soft"
              onClick={() => handleUpdateEvent({ isPublished: false })}
              isLoading={actionLoading}
            >
              Unpublish
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => handleUpdateEvent({ isPublished: true })}
              isLoading={actionLoading}
            >
              Publish
            </Button>
          )}
          {event.status === "CANCELLED" ? (
            <Button
              variant="soft"
              onClick={() => handleUpdateEvent({ status: "DRAFT" })}
              isLoading={actionLoading}
            >
              Activate
            </Button>
          ) : (
            <Button
              variant="ghost"
              onClick={() => handleUpdateEvent({ status: "CANCELLED" })}
              isLoading={actionLoading}
            >
              Cancel
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => router.push(`/app/events/${event.id}/edit`)}
            leftIcon={<Edit2 className="w-4 h-4" />}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            onClick={handleDeleteEvent}
            isLoading={actionLoading}
            leftIcon={<Trash2 className="w-4 h-4 text-rose" />}
          >
            Delete
          </Button>
        </div>
      }
    >
      {activeTab === "overview" && (
        <div className="space-y-6 animate-reveal">
          <EventStats event={event} businessCurrency={businessCurrency} />

          <Surface variant="default" className="p-5 sm:p-6">
            <h3 className="font-display text-heading font-semibold text-foreground mb-4">Event details</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-body">
              <div>
                <p className="text-caption text-muted-foreground uppercase tracking-wide">Description</p>
                <p className="text-foreground mt-1">{event.description ?? "No description"}</p>
              </div>
              <div>
                <p className="text-caption text-muted-foreground uppercase tracking-wide">Timezone</p>
                <p className="text-foreground mt-1">{event.timezone}</p>
              </div>
              <div>
                <p className="text-caption text-muted-foreground uppercase tracking-wide">Published</p>
                <p className="text-foreground mt-1">{event.isPublished ? "Yes" : "No"}</p>
              </div>
              <div>
                <p className="text-caption text-muted-foreground uppercase tracking-wide">Created</p>
                <p className="text-foreground mt-1">{new Date(event.createdAt).toLocaleDateString()}</p>
              </div>
            </div>
          </Surface>

          <Surface variant="default" className="p-5 sm:p-6">
            <h3 className="font-display text-heading font-semibold text-foreground mb-4">Ticket types</h3>
            {event.ticketTypes.length === 0 ? (
              <p className="text-body text-muted-foreground">No ticket types yet.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {event.ticketTypes.map((tt) => (
                  <Surface key={tt.id} variant="accent" className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-display text-body font-semibold text-foreground">{tt.name}</h4>
                      <Badge color={tt.isActive ? "teal" : "muted"}>{tt.isActive ? "Active" : "Inactive"}</Badge>
                    </div>
                    <p className="text-caption text-muted-foreground mt-1 line-clamp-2">
                      {tt.description ?? "No description"}
                    </p>
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/60">
                      <span className="font-display text-title font-semibold text-foreground">
                        {parseFloat(tt.price).toFixed(2)} {tt.currency}
                      </span>
                      <span className="text-caption text-muted-foreground">
                        {tt.quantitySold}/{tt.quantity ?? "∞"} sold
                      </span>
                    </div>
                    {(tt.salesStartAt || tt.salesEndAt) && (
                      <p className="text-caption text-muted-foreground mt-2">
                        {tt.salesStartAt && new Date(tt.salesStartAt).toLocaleDateString()} —{" "}
                        {tt.salesEndAt && new Date(tt.salesEndAt).toLocaleDateString()}
                      </p>
                    )}
                  </Surface>
                ))}
              </div>
            )}
          </Surface>

          <Surface variant="default" className="p-5 sm:p-6">
            <h3 className="font-display text-heading font-semibold text-foreground mb-4">Attendee summary</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Surface variant="accent" className="p-4 text-center">
                <p className="text-caption text-muted-foreground uppercase tracking-wide">Registered</p>
                <p className="font-display text-title font-semibold text-foreground mt-1">{event._count.attendees}</p>
              </Surface>
              <Surface variant="accent" className="p-4 text-center">
                <p className="text-caption text-muted-foreground uppercase tracking-wide">Checked in</p>
                <p className="font-display text-title font-semibold text-foreground mt-1">{event._count.checkIns}</p>
              </Surface>
              <Surface variant="accent" className="p-4 text-center">
                <p className="text-caption text-muted-foreground uppercase tracking-wide">Revenue</p>
                <p className="font-display text-title font-semibold text-foreground mt-1">
                  {formatCurrency(revenue, currency)}
                </p>
              </Surface>
            </div>
          </Surface>
        </div>
      )}

      {activeTab === "tickets" && (
        <div className="space-y-5 animate-reveal">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-heading font-semibold text-foreground">Ticket types</h3>
            <Button variant="primary" onClick={() => setTicketFormOpen(true)} leftIcon={<Plus className="w-4 h-4" />}>
              Add ticket type
            </Button>
          </div>

          {ticketFormOpen && (
            <TicketTypeForm
              eventId={event.id}
              businessCurrency={businessCurrency}
              onCancel={() => setTicketFormOpen(false)}
              onSubmit={handleCreateTicketType}
            />
          )}

          {editingTicket && (
            <TicketTypeForm
              eventId={event.id}
              businessCurrency={businessCurrency}
              initialData={editingTicket}
              onCancel={() => setEditingTicket(null)}
              onSubmit={(body) => handleUpdateTicketType(editingTicket.id, body)}
            />
          )}

          {event.ticketTypes.length === 0 ? (
            <EmptyState
              icon={Ticket}
              title="No ticket types"
              description="Add ticket types so attendees can register for your event."
              actionLabel="Add ticket type"
              onAction={() => setTicketFormOpen(true)}
            />
          ) : (
            <div className="space-y-3">
              {event.ticketTypes.map((tt) => (
                <Surface key={tt.id} variant="default" className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-display text-body font-semibold text-foreground">{tt.name}</h4>
                        <Badge color={tt.isActive ? "teal" : "muted"}>{tt.isActive ? "Active" : "Inactive"}</Badge>
                      </div>
                      <p className="text-caption text-muted-foreground mt-1">{tt.description ?? "No description"}</p>
                      <p className="text-caption text-muted-foreground mt-1">
                        {parseFloat(tt.price).toFixed(2)} {tt.currency} · {tt.quantitySold}/{tt.quantity ?? "∞"} sold
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" onClick={() => setEditingTicket(tt)} leftIcon={<Edit2 className="w-4 h-4" />}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => handleDeleteTicketType(tt.id)}
                        leftIcon={<Trash2 className="w-4 h-4 text-rose" />}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </Surface>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "attendees" && (
        <div className="space-y-5 animate-reveal">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-heading font-semibold text-foreground">Attendees</h3>
            <Button variant="primary" onClick={() => setAttendeeFormOpen(true)} leftIcon={<Plus className="w-4 h-4" />}>
              Add attendee
            </Button>
          </div>

          {attendeeFormOpen && (
            <AttendeeForm
              ticketTypes={event.ticketTypes}
              onCancel={() => setAttendeeFormOpen(false)}
              onSubmit={handleCreateAttendee}
            />
          )}

          {editingAttendee && (
            <AttendeeForm
              ticketTypes={event.ticketTypes}
              initialData={editingAttendee}
              onCancel={() => setEditingAttendee(null)}
              onSubmit={(body) => handleUpdateAttendee(editingAttendee.id, body)}
            />
          )}

          {attendees.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No attendees"
              description="Add attendees manually or sell tickets to populate this list."
              actionLabel="Add attendee"
              onAction={() => setAttendeeFormOpen(true)}
            />
          ) : (
            <div className="space-y-3">
              {attendees.map((attendee) => (
                <AttendeeRow
                  key={attendee.id}
                  attendee={attendee}
                  onEdit={() => setEditingAttendee(attendee)}
                  onDelete={() => handleDeleteAttendee(attendee.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "check-in" && (
        <div className="animate-reveal">
          <CheckInPanel
            attendees={attendees}
            onCheckIn={handleCheckIn}
            onUndo={handleUndoCheckIn}
            loadingIds={checkInLoadingIds}
          />
        </div>
      )}
    </WorkspaceShell>
  );
}
