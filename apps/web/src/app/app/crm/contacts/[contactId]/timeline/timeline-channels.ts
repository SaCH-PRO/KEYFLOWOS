/**
 * FU-CONTACT-TIMELINE-CHANNELS (owner ruling D-277): the conversation thread is the customer's Timeline, filtered by
 * channel (WhatsApp, email, SMS, calls, notes). The filter works on the events GET .../contacts/:c/events served,
 * and nothing else: that read already withholds money-bearing events from a member without revenue read (D-100), so
 * a count here is never of an item the member cannot see. Events of no channel (a payment, a task, a booking, a
 * meeting) are in All only.
 *
 * Which channel an event is, by its stored type (any case) and, where the type does not say, its data.channel, as
 * the server reads channels (crm-communication.service.ts classifyEventChannel, best-channel.service.ts):
 *   - communication.whatsapp / .email / .sms / .call, and whatsapp.*, email.*, sms.*, call.* (sent, logged, missed);
 *   - message.copied: its data.channel, else WhatsApp; campaign.sent / opened / clicked: its data.channel, else email;
 *   - note.*: Notes, except a note a pasted WhatsApp message was saved as (source whatsapp_inbound), which is WhatsApp.
 */

export type TimelineChannel = "whatsapp" | "email" | "sms" | "call" | "note";
export type ChannelFilter = "all" | TimelineChannel;

/**
 * COR-TCH-1: the most events GET .../contacts/:c/events serves. The page sends no limit, so the server reads its
 * default page (crm-timeline.service.ts listContactEvents, `params.limit ?? 20`; crm.controller.ts contactEvents
 * passes none). A read that comes back this full may have left older events out, so the page says it shows the
 * latest ones, and its counts and empty texts speak of those, never of the whole history. Paging is the server's to
 * add (an owner question), not this page's.
 */
export const EVENTS_READ_PAGE = 20;

/** Whether a read of `served` events came back full (older events may exist that it did not serve). */
export function readIsFull(served: number): boolean {
  return served >= EVENTS_READ_PAGE;
}

/** Each filter: its label; what it holds, in words; and what it says with nothing to show. */
export const CHANNEL_FILTERS: ReadonlyArray<{ id: ChannelFilter; label: string; noun: string; empty: string }> = [
  { id: "all", label: "All", noun: "events", empty: "No timeline events yet." },
  { id: "whatsapp", label: "WhatsApp", noun: "WhatsApp messages", empty: "No WhatsApp messages yet." },
  { id: "email", label: "Email", noun: "emails", empty: "No emails yet." },
  { id: "sms", label: "SMS", noun: "SMS messages", empty: "No SMS messages yet." },
  { id: "call", label: "Calls", noun: "calls", empty: "No calls yet." },
  { id: "note", label: "Notes", noun: "notes", empty: "No notes yet." },
];

/** What a filter with nothing to show says: "No calls yet.", or after a full read "No calls in the latest 20 events." */
export function emptyText(filter: ChannelFilter, full: boolean): string {
  const f = CHANNEL_FILTERS.find((c) => c.id === filter) ?? CHANNEL_FILTERS[0];
  return full ? `No ${f.noun} in the latest ${EVENTS_READ_PAGE} events.` : f.empty;
}

/** What the channel of an event is read from. */
export interface ChannelEvent {
  type: string;
  source?: string | null;
  data?: unknown;
}

type MessageChannel = Exclude<TimelineChannel, "note">;
const MESSAGE_CHANNELS: ReadonlySet<string> = new Set<MessageChannel>(["whatsapp", "email", "sms", "call"]);
const CAMPAIGN_TYPES: ReadonlySet<string> = new Set(["campaign.sent", "campaign.opened", "campaign.clicked"]);

/** The source WEDGE-WA-INBOUND-CAPTURE writes on a pasted message's note and event (captureInboundWhatsApp). */
export const PASTED_WHATSAPP_SOURCE = "whatsapp_inbound";

function field(data: unknown, key: string): unknown {
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>)[key] : undefined;
}

function code(type: string): { type: string; subject: string; action: string } {
  const lower = type.trim().toLowerCase();
  const [subject = "", action = ""] = lower.split(".");
  return { type: lower, subject, action };
}

function namedChannel(data: unknown): MessageChannel | null {
  const named = field(data, "channel");
  if (typeof named !== "string") return null;
  const channel = named.trim().toLowerCase();
  return MESSAGE_CHANNELS.has(channel) ? (channel as MessageChannel) : null;
}

/** The channel an event belongs to, or null for an event of no channel (it is in All only). */
export function eventChannel(event: ChannelEvent): TimelineChannel | null {
  const { type, subject, action } = code(event.type);
  if (subject === "note") return event.source === PASTED_WHATSAPP_SOURCE ? "whatsapp" : "note";
  // communication.meeting (or any other) is no channel of the filter's.
  if (subject === "communication") return MESSAGE_CHANNELS.has(action) ? (action as MessageChannel) : null;
  if (MESSAGE_CHANNELS.has(subject)) return subject as MessageChannel;
  if (type === "message.copied") return namedChannel(event.data) ?? "whatsapp";
  if (CAMPAIGN_TYPES.has(type)) return namedChannel(event.data) ?? "email";
  return null;
}

/**
 * One pasted WhatsApp message is one item: captureInboundWhatsApp saves it as a note (a note.created event carrying
 * only { noteId }) and logs a communication.whatsapp event carrying the text and that noteId. The note's event is
 * left out when its message's event is in the list; when it is not (a page that ends between them), it stays, as
 * WhatsApp.
 */
export function foldPastedNotes<T extends ChannelEvent>(events: readonly T[]): T[] {
  const carried = new Set<string>();
  for (const event of events) {
    const noteId = field(event.data, "noteId");
    if (code(event.type).type === "communication.whatsapp" && typeof noteId === "string" && noteId) carried.add(noteId);
  }
  return events.filter((event) => {
    if (code(event.type).type !== "note.created" || event.source !== PASTED_WHATSAPP_SOURCE) return true;
    const noteId = field(event.data, "noteId");
    return !(typeof noteId === "string" && carried.has(noteId));
  });
}

/** How many items each filter holds: All is every item, each channel its own. */
export function channelCounts(events: readonly ChannelEvent[]): Record<ChannelFilter, number> {
  const counts: Record<ChannelFilter, number> = { all: events.length, whatsapp: 0, email: 0, sms: 0, call: 0, note: 0 };
  for (const event of events) {
    const channel = eventChannel(event);
    if (channel) counts[channel] += 1;
  }
  return counts;
}

const CHANNEL_WORDS: Record<MessageChannel, string> = { whatsapp: "WhatsApp", email: "Email", sms: "SMS", call: "Call" };
const RECEIVED: Record<MessageChannel, string> = {
  whatsapp: "WhatsApp message received",
  email: "Email received",
  sms: "SMS received",
  call: "Call received",
};

function received(data: unknown): boolean {
  const direction = field(data, "direction");
  const outcome = field(data, "outcome");
  const d = typeof direction === "string" ? direction.trim().toLowerCase() : "";
  return d === "inbound" || d === "in" || (typeof outcome === "string" && outcome.trim().toLowerCase() === "received");
}

/**
 * A logged conversation in plain words ("WhatsApp message received", "Call logged", "Meeting logged"), where the
 * generic event words would say "Communication whatsapp"; null for any other event.
 */
export function conversationTitle(event: ChannelEvent): string | null {
  const { subject, action } = code(event.type);
  if (subject !== "communication") return null;
  if (action === "meeting") return "Meeting logged";
  if (!MESSAGE_CHANNELS.has(action)) return null;
  const channel = action as MessageChannel;
  return received(event.data) ? RECEIVED[channel] : `${CHANNEL_WORDS[channel]} logged`;
}
