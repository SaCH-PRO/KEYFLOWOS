"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useNotes } from "@/components/keyflow/notes-context";

export function NotesQueryParamTrigger() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { openNotes } = useNotes();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    const pageKey = params.get("openNotes");
    if (!pageKey) return;
    const token = `${pathname}?openNotes=${pageKey}`;
    if (handled.current === token) return;
    handled.current = token;
    openNotes({ scope: { kind: "page", pageKey }, tab: "page" });
    const next = new URLSearchParams(params.toString());
    next.delete("openNotes");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [params, pathname, router, openNotes]);

  return null;
}
