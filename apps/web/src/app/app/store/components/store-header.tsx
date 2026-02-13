"use client";

import { motion } from "framer-motion";
import {
  Store,
  Copy,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";
import { useState } from "react";

type Props = {
  storeEnabled: boolean;
  publicUrl: string;
  onToggleEnabled: () => void;
};

export function StoreHeader({ storeEnabled, publicUrl, onToggleEnabled }: Props) {
  const [linkCopied, setLinkCopied] = useState(false);

  function copyPublicLink() {
    if (!publicUrl) return;
    navigator.clipboard.writeText(publicUrl);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col md:flex-row md:items-center md:justify-between gap-4"
    >
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Online Store</h1>
        <p className="text-muted-foreground mt-1">Your public storefront and booking page</p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={onToggleEnabled}
          className={`kf-btn-secondary inline-flex items-center gap-1.5 text-sm ${
            storeEnabled
              ? "!border-emerald-500/30 !text-emerald-400 !bg-emerald-500/10"
              : "!border-yellow-500/30 !text-yellow-400 !bg-yellow-500/10"
          }`}
        >
          {storeEnabled ? "Published" : "Unpublished"}
        </button>
        <button
          onClick={copyPublicLink}
          disabled={!publicUrl || !storeEnabled}
          className="kf-btn-secondary inline-flex items-center gap-1.5"
          style={{ opacity: !publicUrl || !storeEnabled ? 0.4 : 1 }}
        >
          {linkCopied ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
          {linkCopied ? "Copied!" : "Copy Link"}
        </button>
        <a
          href={publicUrl || "#"}
          target="_blank"
          rel="noopener noreferrer"
          className={`kf-btn-secondary inline-flex items-center gap-1.5 ${
            !publicUrl || !storeEnabled ? "opacity-40 pointer-events-none" : ""
          }`}
        >
          <ExternalLink className="w-4 h-4" /> Open Store
        </a>
      </div>
    </motion.div>
  );
}
