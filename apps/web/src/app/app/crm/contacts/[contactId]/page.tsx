import { redirect } from "next/navigation";

/**
 * A customer's main page, /app/crm/contacts/<id>, opens their Overview.
 *
 * Next 16 hands a page its params as a Promise, and only as a Promise: reading
 * `params.contactId` without awaiting gave `undefined`, so every link to a
 * customer opened /app/crm/contacts/undefined/overview, 'Could not load this
 * contact - Missing id' (BUG-038). src/__tests__/server-page-params.census.test.ts
 * fails for any route module that reads params or searchParams unawaited.
 */
export default async function ContactDetailIndex({ params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params;
  redirect(`/app/crm/contacts/${contactId}/overview`);
}
