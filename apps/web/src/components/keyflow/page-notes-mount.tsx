"use client";

import { useEffect } from "react";
import { useOptionalNotes } from "./notes-context";

/**
 * Drop this component once per workspace page. It registers the page key with
 * the global Notes provider so the global "?" shortcut and the header trigger
 * resolve to the right entry. It does NOT render anything visible.
 */
export function PageNotesMount({ pageKey }: { pageKey: string }) {
  const ctx = useOptionalNotes();
  useEffect(() => {
    if (!ctx) return;
    ctx.registerPage(pageKey);
    return () => ctx.unregisterPage(pageKey);
  }, [ctx, pageKey]);
  return null;
}
