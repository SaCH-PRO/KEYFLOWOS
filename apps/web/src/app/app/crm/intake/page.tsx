import { redirect } from "next/navigation";

export default function IntakeRedirect() {
  redirect("/app/presence");
}
