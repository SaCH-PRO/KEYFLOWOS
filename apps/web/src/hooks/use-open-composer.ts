"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

interface OpenComposerOptions {
  contentType?: "social" | "email" | "multi";
  body?: string;
  subject?: string;
}

export function useOpenComposer() {
  const router = useRouter();

  return useCallback((opts?: OpenComposerOptions) => {
    const params = new URLSearchParams();
    params.set("tab", "social");
    params.set("compose", "true");
    if (opts?.contentType) params.set("contentType", opts.contentType);
    if (opts?.body) {
      try { sessionStorage.setItem("kf_composer_body", opts.body); } catch {}
    }
    if (opts?.subject) {
      try { sessionStorage.setItem("kf_composer_subject", opts.subject); } catch {}
    }
    router.push(`/app/marketing?${params.toString()}`);
  }, [router]);
}
