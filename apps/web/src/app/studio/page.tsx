import { redirect } from "next/navigation";

/**
 * FU-STUDIO-PAGE-SCOPE (owner ruling D-283): /studio sends an old bookmark to the Settings index.
 *
 * /studio was "Business Setup": a list of setup pages (Notifications, Webhooks & API, Payment Gateways, Business
 * Profile, Compliance & Tax and others) offered to every visitor with no module filter, outside the /app shell, so
 * not even signed in. Nothing in the app linked to it (the command palette's "Studio" opens /app/settings), and the
 * server refused the reads behind most of its entries to a member without settings. The page is removed. Its address
 * stays, as a redirect to /app/settings, whose index offers each entry only when the member's modules open it
 * (HubIndex, canOpenModule), and which the middleware sends a signed-out visitor to sign in from.
 */
export default function StudioPage() {
  redirect("/app/settings");
}
