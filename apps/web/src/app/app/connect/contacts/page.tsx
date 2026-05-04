import { permanentRedirect } from "next/navigation";

export const dynamic = "force-static";

export default function ConnectContactsRedirectPage() {
  permanentRedirect("/app/crm/pipeline?view=table");
}
