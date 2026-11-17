/**
 * FAILURE-KIT (re-cut v1 plan, step 3, lane web): status-labels.ts, raw codes said in plain words.
 *
 * WHY this test exists: screens print stored codes as they are. The customer invoice page, the quote drawer and the
 * ledger show "PARTIALLY_PAID" (BUG-091, BUG-132, BUG-134); the contact timeline shows "Note.Created" and
 * "Contact.Created" (BUG-129); a select-type custom field shows "gluten_free" (BUG-127). Product principle "One name
 * per thing, in plain words": one map turns a code into its label, so the screen packets that adopt it say the same
 * word for the same status ("Part-paid", as the invoice list and detail already do).
 *
 * Required here: the three shapes (UPPER_SNAKE status, dotted event type, snake_case value) map to plain labels; a
 * label that is already plain is left as it is; an unknown code is still readable; nothing returns the raw code.
 *
 * Review repair (FK-COR-3): a code that means different things in different places has no one global word.
 * PARTIAL is an invoice status (part-paid), a purchase-order status (part-received: the inventory screen's
 * PO_STATUS_CONFIG and the marketplace PO filter say "Partial") and an integration sync result. The global word is
 * the neutral "Partial"; the invoice word "Part-paid" is asked for by domain (FK-SL-05).
 */
import { describe, it, expect } from "vitest";
import { eventLabel, humanizeCode, plainLabel, statusLabel, STATUS_LABELS } from "@/lib/status-labels";

describe("FAILURE-KIT status-labels: raw codes in plain words (BUG-091, BUG-127, BUG-129, BUG-132, BUG-134)", () => {
  it("[FK-SL-01] RED-BEFORE: PARTIALLY_PAID, Note.Created and gluten_free are said in plain words", () => {
    expect(plainLabel("PARTIALLY_PAID")).toBe("Part-paid");
    expect(plainLabel("Note.Created")).toBe("Note added");
    expect(plainLabel("gluten_free")).toBe("Gluten free");
  });

  it("[FK-SL-02] invoice, quote and booking statuses, in any letter case, use the words the screens already use", () => {
    expect(statusLabel("PARTIALLY_PAID")).toBe("Part-paid");
    expect(statusLabel("partially_paid")).toBe("Part-paid");
    expect(statusLabel("PARTIAL", "invoice")).toBe("Part-paid");
    expect(statusLabel("OVERDUE")).toBe("Overdue");
    expect(statusLabel("VOID")).toBe("Void");
    expect(statusLabel("DRAFT")).toBe("Draft");
    expect(statusLabel("REJECTED")).toBe("Rejected");
    expect(statusLabel("NO_SHOW")).toBe("No-show");
    expect(statusLabel("PAST_DUE")).toBe("Past due");
    expect(statusLabel("IN_PROGRESS")).toBe("In progress");
    expect(statusLabel("FULLY_CREDITED")).toBe("Credited");
    expect(statusLabel("PARTIALLY_REFUNDED")).toBe("Part-refunded");
    expect(statusLabel("CANCELED")).toBe(statusLabel("CANCELLED"));
    for (const [code, label] of Object.entries(STATUS_LABELS)) {
      expect(label, code).not.toMatch(/_/);
      expect(label, code).not.toBe(code);
    }
  });

  it("[FK-SL-03] event types: Entity.Action and entity.action say what happened, customers by their v1 name", () => {
    expect(eventLabel("Note.Created")).toBe("Note added");
    expect(eventLabel("note.added")).toBe("Note added");
    expect(eventLabel("Contact.Created")).toBe("Customer added");
    expect(eventLabel("Contact.Updated")).toBe("Customer updated");
    expect(eventLabel("message.copied")).toBe("Message copied");
    expect(eventLabel("Invoice.Paid")).toBe("Invoice paid");
    expect(eventLabel("booking.no_show")).toBe("Booking no-show");
    expect(eventLabel("crm.contact.created")).toBe("Customer added");
    expect(plainLabel("Contact.Created")).toBe("Customer added");
  });

  it("[FK-SL-04] stored values and unknown codes are still readable; plain words are left alone; empty is empty", () => {
    expect(humanizeCode("gluten_free")).toBe("Gluten free");
    expect(humanizeCode("SOME_NEW_STATE")).toBe("Some new state");
    expect(humanizeCode("PartiallyFailed")).toBe("Partially failed");
    expect(humanizeCode("inProgress")).toBe("In progress");
    expect(humanizeCode("follow-up")).toBe("Follow-up");
    expect(plainLabel("gluten_free")).toBe("Gluten free");
    expect(plainLabel("Paid")).toBe("Paid");
    expect(plainLabel("Gluten free")).toBe("Gluten free");
    expect(plainLabel("Part-paid")).toBe("Part-paid");
    expect(plainLabel("  OVERDUE ")).toBe("Overdue");
    expect(plainLabel(null)).toBe("");
    expect(plainLabel(undefined)).toBe("");
    expect(plainLabel("")).toBe("");
    expect(statusLabel(null)).toBe("");
    expect(eventLabel(undefined)).toBe("");
  });

  it("[FK-SL-05] RED-BEFORE: PARTIAL is not a global 'Part-paid': a part-received purchase order and a partial sync read 'Partial'; an invoice reads 'Part-paid'", () => {
    expect(statusLabel("PARTIAL")).toBe("Partial");
    expect(plainLabel("PARTIAL")).toBe("Partial");
    expect(statusLabel("partial")).toBe("Partial");
    expect(statusLabel("PARTIAL", "invoice")).toBe("Part-paid");
    expect(statusLabel("PARTIALLY_PAID", "invoice")).toBe("Part-paid");
    // The invoice map adds to the global one; it changes nothing else.
    for (const code of ["OVERDUE", "VOID", "DRAFT", "PAID", "FULLY_CREDITED", "SOME_NEW_STATE"]) {
      expect(statusLabel(code, "invoice"), code).toBe(statusLabel(code));
    }
    expect(STATUS_LABELS).not.toHaveProperty("PARTIAL");
  });
});
