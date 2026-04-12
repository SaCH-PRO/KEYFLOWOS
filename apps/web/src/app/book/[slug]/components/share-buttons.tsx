"use client";

import { useState } from "react";
import { Share2, Copy, Check, MessageCircle, X } from "lucide-react";

type ShareButtonsProps = {
  url: string;
  title: string;
  description?: string;
  primaryColor?: string;
  compact?: boolean;
};

export function ShareButtons({ url, title, description, primaryColor = "#F97316", compact = false }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);

  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);
  const encodedDesc = encodeURIComponent(description || title);

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(`${title} - ${description || ""}\n${url}`)}`;
  const facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodedDesc}&url=${encodedUrl}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const buttonClass = compact
    ? "w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200 hover:scale-110"
    : "w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 hover:scale-110";

  const iconSize = compact ? "w-3.5 h-3.5" : "w-4 h-4";

  return (
    <div className="flex items-center gap-2">
      <a
        href={whatsappUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonClass}
        style={{ backgroundColor: "#25D36620", color: "#25D366" }}
        title="Share on WhatsApp"
      >
        <MessageCircle className={iconSize} />
      </a>
      <a
        href={facebookUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonClass}
        style={{ backgroundColor: "#1877F220", color: "#1877F2" }}
        title="Share on Facebook"
      >
        <svg className={iconSize} fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>
      </a>
      <a
        href={twitterUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonClass}
        style={{ backgroundColor: `${primaryColor}20`, color: primaryColor }}
        title="Share on X"
      >
        <X className={iconSize} />
      </a>
      <button
        onClick={handleCopyLink}
        className={buttonClass}
        style={{
          backgroundColor: copied ? "#10b98120" : "rgba(0,0,0,0.04)",
          color: copied ? "#10b981" : "rgba(0,0,0,0.4)",
        }}
        title="Copy link"
      >
        {copied ? <Check className={iconSize} /> : <Copy className={iconSize} />}
      </button>
    </div>
  );
}

export function ShareStoreButton({ url, storeName, primaryColor = "#F97316" }: { url: string; storeName: string; primaryColor?: string }) {
  const [showMenu, setShowMenu] = useState(false);

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: storeName, text: `Check out ${storeName}!`, url });
        return;
      } catch {}
    }
    setShowMenu(!showMenu);
  };

  return (
    <div className="relative">
      <button
        onClick={handleNativeShare}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 hover:scale-105 active:scale-95"
        style={{
          background: `linear-gradient(135deg, ${primaryColor}20, ${primaryColor}10)`,
          color: primaryColor,
          border: `1px solid ${primaryColor}30`,
        }}
      >
        <Share2 className="w-4 h-4" />
        Share This Store
      </button>
      {showMenu && (
        <div className="absolute top-full mt-2 right-0 z-50 p-3 rounded-xl border border-gray-200 bg-white/95 backdrop-blur-xl shadow-2xl">
          <ShareButtons url={url} title={storeName} description={`Check out ${storeName}!`} primaryColor={primaryColor} compact />
        </div>
      )}
    </div>
  );
}
