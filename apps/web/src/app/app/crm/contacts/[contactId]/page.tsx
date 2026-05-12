import { redirect } from "next/navigation";

export default function ContactDetailIndex({ params }: { params: { contactId: string } }) {
  redirect(`/app/crm/contacts/${params.contactId}/overview`);
}
