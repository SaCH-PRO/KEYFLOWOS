import { redirect } from "next/navigation";

export default function LegacyConnectionsRedirect() {
  redirect("/app/connect");
}
