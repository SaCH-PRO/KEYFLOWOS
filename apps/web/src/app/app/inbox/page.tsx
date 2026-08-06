"use client";

import { redirect } from "next/navigation";

/**
 * One omnichannel inbox.
 *
 * This redirected to /app/inbox/unified, a second inbox reading
 * conversation_threads while /app/key-inbox read key_inbox_threads. Two stores,
 * two screens, two feeds — Gmail and Google Forms landed in one, everything
 * arriving through the intake webhook landed in the other, and neither screen
 * showed the other's messages. The four inbox_* KEY tools could see one half.
 *
 * Both feeds write key_inbox_* now, so /app/inbox/unified was a second view of
 * the same data with less in it (387 lines against 864) and is gone.
 */
export default function InboxPage() {
  redirect("/app/key-inbox");
}
