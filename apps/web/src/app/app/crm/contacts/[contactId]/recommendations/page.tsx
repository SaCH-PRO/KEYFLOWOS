"use client";

import { useParams } from "next/navigation";

export default function ContactPage() {
  const { contactId } = useParams();
  return (
    <div className="p-4">
      <h3 className="text-lg font-semibold capitalize">recommendations</h3>
      <p className="text-muted-foreground">Contact ID: {contactId}</p>
    </div>
  );
}
