import { redirect } from "next/navigation";

/**
 * The tab ?tab= opens: each of the customer's tabs by its own name (a folder
 * beside this file; layout.tsx draws them), and the two older names doors
 * still build. A project's client tab links 'Messages' (?tab=communications)
 * and 'Invoices' (?tab=invoices), and the project overview's 'Comms' link the
 * first: names from the single-page contact detail the tabbed layout replaced.
 * A Map, so a name every object inherits (constructor, __proto__) is no tab.
 */
const TAB_FOR = new Map<string, string>([
  ["overview", "overview"],
  ["timeline", "timeline"],
  ["money", "money"],
  ["bookings", "bookings"],
  ["quotes-invoices", "quotes-invoices"],
  ["tasks", "tasks"],
  ["notes", "notes"],
  ["ai-insights", "ai-insights"],
  ["recommendations", "recommendations"],
  ["communications", "timeline"],
  ["invoices", "quotes-invoices"],
]);

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * A customer's main page, /app/crm/contacts/<id>, opens one of their tabs: the
 * one ?tab= names (its first value), else their Overview. The rest of the query
 * is passed on unchanged, so a door such as the Customers list's 'Refer / Link'
 * (?action=refer) reaches the tab with what it asked for.
 *
 * Next 16 hands a page its params and searchParams as Promises, and only as
 * Promises: reading `params.contactId` without awaiting gave `undefined`, so
 * every link to a customer opened /app/crm/contacts/undefined/overview, 'Could
 * not load this contact - Missing id' (BUG-038).
 * src/__tests__/server-page-params.census.test.ts fails for any route module
 * that reads params or searchParams unawaited.
 */
export default async function ContactDetailIndex({
  params,
  searchParams,
}: {
  params: Promise<{ contactId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { contactId } = await params;
  const query = await searchParams;

  let tab = "overview";
  const passOn = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    const values = value === undefined ? [] : Array.isArray(value) ? value : [value];
    if (name === "tab") {
      tab = TAB_FOR.get(values[0] ?? "") ?? "overview";
      continue;
    }
    for (const v of values) passOn.append(name, v);
  }

  const search = passOn.toString();
  redirect(`/app/crm/contacts/${contactId}/${tab}${search ? `?${search}` : ""}`);
}
