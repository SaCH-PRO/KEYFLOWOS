import { redirect } from "next/navigation";

export default function PresenceBookingsRedirect() {
  redirect("/app/presence/orders");
}
