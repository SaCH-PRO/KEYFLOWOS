"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { apiGet } from "@/lib/api";

interface ResolvedFeatureFlag {
  key: string;
  label: string;
  category: string | null;
  comingSoon: boolean;
  bypass: boolean;
}

type FlagState = "loading" | "locked" | "open";

interface DormantRouteProps {
  featureKey: string;
  title: string;
  children: React.ReactNode;
}

export function DormantRoute({ featureKey, title, children }: DormantRouteProps) {
  const [state, setState] = useState<FlagState>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiGet<{ flags: ResolvedFeatureFlag[] }>(`/api/feature-flags`);
      if (cancelled) return;
      const flag = res.data?.flags?.find((f) => f.key === featureKey);
      if (!flag) {
        setState("open");
        return;
      }
      setState(flag.comingSoon && !flag.bypass ? "locked" : "open");
    })();
    return () => {
      cancelled = true;
    };
  }, [featureKey]);

  if (state === "loading") {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="h-6 w-6 rounded-full border-2 border-muted border-t-foreground animate-spin" />
      </div>
    );
  }

  if (state === "locked") {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-muted flex items-center justify-center">
            <Lock className="h-6 w-6 text-muted-foreground" />
          </div>
          <h1 className="text-xl font-semibold">{title} — Coming Later</h1>
          <p className="text-sm text-muted-foreground">
            We&apos;re focusing KeyflowOS on the operating intelligence loop:
            blueprint, contacts, commerce, calendar, storefront, KEY, and
            procurement. {title} is paused while we land that work.
          </p>
          <Link
            href="/app"
            className="inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-medium bg-foreground text-background hover:opacity-90 transition-opacity"
          >
            Back to KEYFLOW
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
