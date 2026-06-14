"use client";

import Link from "next/link";
import { ArrowLeft, HardDrive } from "lucide-react";
import GoogleDriveBrowser from "../../profile/components/google-drive-browser";
import { DriveIntakeQueue } from "./components/drive-intake-queue";
import { getStoredBusinessId } from "@/lib/workspace";

export default function ConnectDrivePage() {
  const businessId = getStoredBusinessId();

  return (
    <div className="space-y-4 max-w-6xl mx-auto p-4">
      <div className="flex items-center gap-2">
        <Link
          href="/app/connect"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Back to Connect
        </Link>
      </div>
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-blue-500/20 to-emerald-500/20 border border-border/40 flex items-center justify-center">
          <HardDrive className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Drive Browser</h1>
          <p className="text-xs text-muted-foreground">
            Browse, upload, and attach files from your connected Google Drive.
          </p>
        </div>
      </div>
      {businessId ? (
        <>
          <GoogleDriveBrowser businessId={businessId} />
          <DriveIntakeQueue businessId={businessId} />
        </>
      ) : (
        <div className="text-sm text-muted-foreground">No active business — pick a workspace first.</div>
      )}
    </div>
  );
}
