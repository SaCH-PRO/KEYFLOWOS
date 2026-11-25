"use client";

import { usePathname } from "next/navigation";
import { ReactNode } from "react";

interface PageTransitionProps {
  children: ReactNode;
}

/**
 * The page's wrapper in the app shell, keyed by its pathname (each page starts fresh).
 *
 * FU-REQUIRE-AUTH-REMOUNT: no animation. It was <AnimatePresence mode="wait" initial={false}> around a motion.div
 * keyed by the pathname. The leaving wrapper stayed mounted for its exit, and `children` (Next's layout router, which
 * renders the CURRENT route from context) rendered the destination page inside it: the destination page mounted
 * twice, and a page that reads and strips a one-shot URL parameter on mount (/app/bookings?contactId=) lost it to the
 * first instance. And while it animated, the wrapper's transform made it the containing block of unportaled
 * `position: fixed` content (BookingSideSheet). Users never saw that entrance or exit before: RequireAuth remounted
 * the whole shell on every navigation, and `initial={false}` skipped the first child's entrance. So the wrapper is
 * plain: the leaving page unmounts at once, the destination page mounts once, nothing is offset or faded.
 */
export function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname();

  return (
    <div key={pathname} className="h-full">
      {children}
    </div>
  );
}
