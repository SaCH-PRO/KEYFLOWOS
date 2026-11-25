/**
 * FU-BULK-DELETE-UNDO, the web half (owner ruling D-277b, 2026-11-24): "a bulk delete is sent at once, then a toast
 * offers Undo, which restores exactly those customers from Trash in one call. There is no delayed send, so leaving
 * the page can never drop it."
 *
 * The one bulk delete of customers both views share (useContactActions for the list, focus and kanban views,
 * useDatabaseState for the table view), so both behave the same:
 *   - the delete (DELETE /crm/businesses/:b/contacts/bulk) is sent at once, once;
 *   - a refusal is said in the failure kit's words, and nothing claims a delete;
 *   - Undo is offered only when this answer says exactly which ids were deleted: all of those sent (deleted equals
 *     the number sent), or the ids an optional `deletedIds` names (each one sent, as many as `deleted`). The server
 *     soft-deletes only the ids this member may delete and answers the count, so after a partial delete without
 *     `deletedIds` the web cannot know which ids went: it says how many, and offers no Undo that could restore the
 *     wrong set (they are in Trash);
 *   - Undo sends one POST /api/businesses/:b/trash/contact/bulk-restore with exactly those ids, in the delete's
 *     business (a second press sends nothing), says how many could not be restored when some could not, says a
 *     refusal, and then asks the screen to read its list again. It acts only for the session that deleted: after a
 *     sign-out, or with another person signed in, it sends nothing and says so (the contacts stay in Trash);
 *   - an answer (the delete's or the restore's) that lands after the session that sent it ended or changed hands says
 *     nothing and re-reads nothing: sign-out and sign-in dismiss the session's toasts, and an answer still on its way
 *     must not raise a new one on the sign-in page or over the next person's shell (FU-UNDO-TOAST-SIGNOUT, review
 *     SEC-UTS-1 / COR-UTS-2).
 * The toast lives in the app-wide Toaster (components/providers.tsx), not in the screen, so it outlives the screen;
 * what it does after the screen has gone is the restore call itself, which needs nothing from the screen.
 */
import { toast } from "sonner";
import { bulkDeleteContacts, bulkRestoreTrashItems } from "@/lib/client";
import { refusalMessage, showRefusal } from "@/lib/failure-kit";
import { actingMemberNow } from "@/lib/business-settings";

/** How long the toast that offers Undo stays up. */
export const BULK_DELETE_UNDO_MS = 10_000;

export interface ContactsBulkDeleteResult {
  /** How many the server deleted, or null when its answer did not say. */
  deleted: number | null;
  /** Exactly the ids deleted, when known (the ids Undo restores); null when the web cannot know them. */
  deletedIds: string[] | null;
}

const contactsWord = (n: number) => `contact${n === 1 ? "" : "s"}`;

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

/**
 * Whether the session that sent a request (`sentAs`, actingMemberNow() taken before it was sent) is still the one
 * signed in: the same person's token (a rotation keeps it), not a sign-out and not another person.
 */
function sameSessionAs(sentAs: string): boolean {
  const now = actingMemberNow();
  return now !== "none" && now === sentAs;
}

/**
 * Exactly the ids this delete removed, or null when the answer does not say: every id sent when the count is all of
 * them, else the answer's `deletedIds` when each is an id this delete sent and they number `deleted`. Never a guess.
 */
function knownDeletedIds(sent: string[], deleted: number, named: unknown): string[] | null {
  if (Array.isArray(named)) {
    const sentSet = new Set(sent);
    const unique = Array.from(new Set(named));
    if (unique.length === deleted && unique.every((id): id is string => typeof id === "string" && sentSet.has(id))) return unique;
    return null;
  }
  return deleted === sent.length ? sent : null;
}

/**
 * Sends one bulk-restore for `ids` and says how it went. `onRestored` runs after any answer that may have restored
 * something, so the screen re-reads its list. An answer that lands after the session `sentAs` ended or changed hands
 * says nothing and re-reads nothing (review SEC-UTS-1).
 */
async function restoreFromTrash(businessId: string, ids: string[], sentAs: string, onRestored?: () => void): Promise<void> {
  const res = await bulkRestoreTrashItems(businessId, "contact", ids);
  if (!sameSessionAs(sentAs)) return;
  if (showRefusal(res, { what: "restore these contacts" })) return;
  const data = res.data;
  const restored = isCount(data?.restoredCount) ? data.restoredCount : Array.isArray(data?.restored) ? data.restored.length : null;
  const failedCount = isCount(data?.failedCount) ? data.failedCount : Array.isArray(data?.failed) ? data.failed.length : 0;
  if (restored === null || restored > ids.length) {
    toast.warning("Undo was sent, but the answer did not say how many were restored.", {
      description: "Check the list and Trash.",
    });
  } else if (restored === ids.length && failedCount === 0) {
    toast.success(`Restored ${restored} ${contactsWord(restored)}`);
  } else {
    // Review COR-P37-4: a failure count is named only when the answer counts failures; never "0 could not be restored".
    const title = restored === ids.length ? `Restored ${restored} ${contactsWord(restored)}.` : `Restored ${restored} of ${ids.length} contacts.`;
    const failures = failedCount > 0 ? ` ${failedCount} could not be restored.` : "";
    toast.warning(`${title}${failures}`, { description: "Any not restored are still in Trash." });
  }
  onRestored?.();
}

/**
 * Deletes `ids` (sent at once), says what happened, and offers Undo when the ids deleted are known. Resolves null when
 * the delete was refused (nothing was deleted), else what was deleted. `onRestored` runs after an Undo.
 */
export async function deleteContactsWithUndo(input: {
  businessId: string;
  ids: string[];
  onRestored?: () => void;
}): Promise<ContactsBulkDeleteResult | null> {
  const sent = Array.from(new Set(input.ids));
  // Review SEC-P37W-1: the toast lives in the app-wide Toaster and outlives a sign-out (sign-out and sign-in navigate
  // in place), so Undo acts only for the session that deleted: the person the session token names when the delete
  // is sent (actingMemberNow(), as the business settings store tells one member's writes from the next's).
  const deletedAs = actingMemberNow();
  const res = await bulkDeleteContacts({ businessId: input.businessId, contactIds: sent });
  // Review SEC-UTS-1 / COR-UTS-2: answered after the session that sent it ended or changed hands. What was deleted is
  // still resolved, but nothing is said: that session's toasts were dismissed, and this one would be shown to whoever
  // is here now (the sign-in page, or another person's shell).
  const quiet = !sameSessionAs(deletedAs);
  const refusal = { what: "delete these contacts" };
  if (quiet ? refusalMessage(res, refusal) !== null : showRefusal(res, refusal)) return null;

  const deleted = isCount(res.data?.deleted) ? res.data.deleted : null;
  if (deleted === null || deleted > sent.length) {
    if (!quiet) toast.warning("The delete was sent, but the answer did not say how many were deleted.", {
      description: "Check the list and Trash.",
    });
    return { deleted: null, deletedIds: null };
  }
  if (deleted === 0) {
    if (!quiet) toast.warning(`None of the ${sent.length} selected ${contactsWord(sent.length)} were deleted.`, {
      description: "They may be deleted already, or you may not be allowed to delete them.",
    });
    return { deleted: 0, deletedIds: [] };
  }

  const deletedIds = knownDeletedIds(sent, deleted, res.data?.deletedIds);
  const title = deleted === sent.length
    ? `Deleted ${deleted} ${contactsWord(deleted)}`
    : `Deleted ${deleted} of ${sent.length} contacts. ${sent.length - deleted} could not be deleted.`;
  const inTrash = `${deleted === 1 ? "It is" : "They are"} in Trash.`;

  if (!deletedIds) {
    if (!quiet) toast.warning(title, { description: `${inTrash} Restore from Trash if this was a mistake.` });
    return { deleted, deletedIds: null };
  }
  if (quiet) return { deleted, deletedIds };

  let undoSent = false;
  const undo = () => {
    // One restore per delete, however often Undo is pressed.
    if (undoSent) return;
    undoSent = true;
    const now = actingMemberNow();
    if (now === "none" || now !== deletedAs) {
      toast.warning("Nothing was restored: this Undo belonged to an earlier session.", {
        description: `The ${contactsWord(deletedIds.length)} ${deletedIds.length === 1 ? "is" : "are"} still in Trash.`,
      });
      return;
    }
    // The delete's business, whatever business is selected now (review SEC-P37W-2).
    void restoreFromTrash(input.businessId, deletedIds, deletedAs, input.onRestored);
  };
  const offer = { description: inTrash, duration: BULK_DELETE_UNDO_MS, action: { label: "Undo", onClick: undo } };
  if (deleted === sent.length) toast.success(title, offer);
  else toast.warning(title, offer);
  return { deleted, deletedIds };
}
