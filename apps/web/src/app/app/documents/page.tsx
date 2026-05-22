"use client";

import Link from "next/link";
import { ArrowRight, FileText, HardDrive, FolderOpen } from "lucide-react";

export default function DocumentsPage() {
  return (
    <div className="space-y-6 max-w-5xl mx-auto p-4">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-border/40 flex items-center justify-center">
          <FolderOpen className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Documents</h1>
          <p className="text-sm text-muted-foreground">
            Browse files in your connected Google Drive or jump to your generated outputs.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Link
          href="/app/connect/drive"
          className="rounded-2xl border border-border/40 p-5 bg-gradient-to-br from-blue-500/5 to-emerald-500/5 hover:border-border/70 transition-colors group"
        >
          <div className="flex items-center justify-between">
            <div className="h-10 w-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
              <HardDrive className="h-5 w-5 text-blue-400" />
            </div>
            <ArrowRight className="h-4 w-4 opacity-50 group-hover:opacity-100 transition-opacity" />
          </div>
          <h3 className="text-sm font-semibold mt-3">Drive browser</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Browse, upload, rename and share files from your connected Google Drive — reusable in
            contacts and projects.
          </p>
        </Link>

        <Link
          href="/app/profile?tab=outputs"
          className="rounded-2xl border border-border/40 p-5 bg-gradient-to-br from-purple-500/5 to-pink-500/5 hover:border-border/70 transition-colors group"
        >
          <div className="flex items-center justify-between">
            <div className="h-10 w-10 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center">
              <FileText className="h-5 w-5 text-purple-400" />
            </div>
            <ArrowRight className="h-4 w-4 opacity-50 group-hover:opacity-100 transition-opacity" />
          </div>
          <h3 className="text-sm font-semibold mt-3">Generated documents</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Quotes, invoices, contracts, and other documents generated from KeyFlow templates.
          </p>
        </Link>
      </div>
    </div>
  );
}
