/**
 * FU-CONTACT-TIMELINE-CHANNELS (owner ruling D-277): the conversation thread is the customer's Timeline, filtered by
 * channel (WhatsApp, email, SMS, calls, notes). The filter works on the events GET .../contacts/:c/events served,
 * and nothing else: that read already withholds money-bearing events from a member without revenue read (D-100), so
 * a count here is never of an item the member cannot see. Events of no channel (a payment, a task, a booking, a
 * meeting) are in All only.
 *
 * Which channel an event is, by its stored type (any case), and where the type does not say, by its data.channel or
 * source. This follows the server's own readings of channels (crm-communication.service.ts classifyEventChannel,
 * best-channel.service.ts) but is not an exact copy of either (MIN-5):
 *   - communication.whatsapp / .email / .sms / .call, and whatsapp.*, email.*, sms.*, call.* (sent, logged, missed);
 *     any other communication.* (a meeting, an unknown kind) is no channel here, where classifyEventChannel reads a
 *     meeting as its own channel and an unknown kind as a call;
 *   - message_received (the omnichannel processor's inbound message): its source, when that names a channel;
 *   - message.copied: its data.channel, else WhatsApp; campaign.sent / opened / clicked: its data.channel, else email;
 *   - form.submitted and lead_form.submitted are no channel here (All only), where classifyEventChannel reads them
 *     as inbound email;
 *   - note.*: Notes, except a pasted WhatsApp message's note (source whatsapp_inbound) and, known by its noteId, that
 *     note's later edit or delete (pastedNoteIds), which are WhatsApp.
 */

export type TimelineChannel = "whatsapp" | "email" | "sms" | "call" | "note";
export type ChannelFilter = "all" | TimelineChannel;

/**
 * COR-TCH-1, FU-TIMELINE-LOAD-OLDER (D-284): the events read pages (FU-TIMELINE-EVENTS-PAGING), and the page loads the
 * newest page first and older pages on "Load older" while the read returns a cursor. While older records remain
 * unloaded, the page's counts and empty texts speak of the records it has loaded, never of the whole history.
 */

/** Each filter: its label; what it holds, in words; and what it says with nothing to show. */
export const CHANNEL_FILTERS: ReadonlyArray<{ id: ChannelFilter; label: string; noun: string; empty: string }> = [
  { id: "all", label: "All", noun: "events", empty: "No timeline events yet." },
  { id: "whatsapp", label: "WhatsApp", noun: "WhatsApp messages", empty: "No WhatsApp messages yet." },
  { id: "email", label: "Email", noun: "emails", empty: "No emails yet." },
  { id: "sms", label: "SMS", noun: "SMS messages", empty: "No SMS messages yet." },
  { id: "call", label: "Calls", noun: "calls", empty: "No calls yet." },
  { id: "note", label: "Notes", noun: "notes", empty: "No notes yet." },
];

/**
 * What a filter with nothing to show says: "No calls yet." once the whole history is loaded, or, while older records
 * remain unloaded (`loaded`: how many records are loaded), "No calls in the latest 40 records."
 */
export function emptyText(filter: ChannelFilter, loaded: number | null): string {
  const f = CHANNEL_FILTERS.find((c) => c.id === filter) ?? CHANNEL_FILTERS[0];
  return loaded === null ? f.empty : `No ${f.noun} in the latest ${loaded} records.`;
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

/** An inbound message the omnichannel processor logged (omnichannel-processor.service.ts): its channel is its source. */
const MESSAGE_RECEIVED = "message_received";

function sourceChannel(source: string | null | undefined): MessageChannel | null {
  const channel = typeof source === "string" ? source.trim().toLowerCase() : "";
  return MESSAGE_CHANNELS.has(channel) ? (channel as MessageChannel) : null;
}

function namedChannel(data: unknown): MessageChannel | null {
  const named = field(data, "channel");
  if (typeof named !== "string") return null;
  const channel = named.trim().toLowerCase();
  return MESSAGE_CHANNELS.has(channel) ? (channel as MessageChannel) : null;
}

/**
 * SEC-TCH-C1: a WhatsApp event captureInboundWhatsApp wrote, which alone may say which note is a pasted message. Any
 * member with crm write can log a communication.whatsapp event (POST .../events, source crm) naming any note id; only
 * the capture writes source whatsapp_inbound.
 */
function isCapturedMessage(event: ChannelEvent): boolean {
  return code(event.type).type === "communication.whatsapp" && event.source === PASTED_WHATSAPP_SOURCE;
}

/**
 * MIN-3: the ids of the notes the page shows to be pasted WhatsApp messages: the noteId of a communication.whatsapp
 * event or a note.created that captureInboundWhatsApp wrote (both carry source whatsapp_inbound; SEC-TCH-C1: one with
 * any other source names nothing). A note's later note.updated / note.deleted carry only { noteId } (source system), so they are known to be a
 * pasted message's only through this; a pasted note whose two events are both off the page is not known, and its
 * edit stays under Notes.
 */
export function pastedNoteIds(events: readonly ChannelEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    const { type } = code(event.type);
    const noteId = field(event.data, "noteId");
    if (typeof noteId !== "string" || !noteId) continue;
    const pastedNote = type === "note.created" && event.source === PASTED_WHATSAPP_SOURCE;
    if (isCapturedMessage(event) || pastedNote) ids.add(noteId);
  }
  return ids;
}

/**
 * The channel an event belongs to, or null for an event of no channel (it is in All only). `pasted`: the ids of the
 * notes that are pasted WhatsApp messages (pastedNoteIds), so that such a note's edit or delete is WhatsApp too.
 */
export function eventChannel(event: ChannelEvent, pasted: ReadonlySet<string> = new Set()): TimelineChannel | null {
  const { type, subject, action } = code(event.type);
  if (subject === "note") {
    if (event.source === PASTED_WHATSAPP_SOURCE) return "whatsapp";
    // A note.created says what it is by its own source (captureInboundWhatsApp writes whatsapp_inbound): only a later
    // edit or delete, which carries no such source, is known by its noteId.
    if (action === "created" || action === "added") return "note";
    const noteId = field(event.data, "noteId");
    return typeof noteId === "string" && pasted.has(noteId) ? "whatsapp" : "note";
  }
  // communication.meeting (or any other) is no channel of the filter's.
  if (subject === "communication") return MESSAGE_CHANNELS.has(action) ? (action as MessageChannel) : null;
  if (MESSAGE_CHANNELS.has(subject)) return subject as MessageChannel;
  if (type === MESSAGE_RECEIVED) return sourceChannel(event.source);
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
    if (isCapturedMessage(event) && typeof noteId === "string" && noteId) carried.add(noteId);
  }
  return events.filter((event) => {
    if (code(event.type).type !== "note.created" || event.source !== PASTED_WHATSAPP_SOURCE) return true;
    const noteId = field(event.data, "noteId");
    return !(typeof noteId === "string" && carried.has(noteId));
  });
}

/** How many items each filter holds: All is every item, each channel its own. */
export function channelCounts(events: readonly ChannelEvent[], pasted: ReadonlySet<string> = new Set()): Record<ChannelFilter, number> {
  const counts: Record<ChannelFilter, number> = { all: events.length, whatsapp: 0, email: 0, sms: 0, call: 0, note: 0 };
  for (const event of events) {
    const channel = eventChannel(event, pasted);
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
  const { type, subject, action } = code(event.type);
  if (type === MESSAGE_RECEIVED) {
    const channel = sourceChannel(event.source);
    return channel ? RECEIVED[channel] : null;
  }
  if (subject !== "communication") return null;
  if (action === "meeting") return "Meeting logged";
  if (!MESSAGE_CHANNELS.has(action)) return null;
  const channel = action as MessageChannel;
  return received(event.data) ? RECEIVED[channel] : `${CHANNEL_WORDS[channel]} logged`;
}
