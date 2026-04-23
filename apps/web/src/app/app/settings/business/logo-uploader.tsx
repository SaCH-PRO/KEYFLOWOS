"use client";

import { RefObject } from "react";
import { Building2, Camera, Upload } from "lucide-react";

type Props = {
  logoUrl: string | null;
  name: string;
  uploading: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

export function LogoUploader({ logoUrl, name, uploading, fileInputRef, onUpload }: Props) {
  return (
    <div className="flex items-center gap-5">
      <div className="relative group">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] border-2 border-border/30 flex items-center justify-center overflow-hidden shadow-lg">
          {logoUrl ? (
            <img src={logoUrl} alt="Business logo" className="w-full h-full object-cover" />
          ) : (
            <span className="text-2xl font-bold text-white">
              {name?.charAt(0)?.toUpperCase() || "K"}
            </span>
          )}
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="absolute inset-0 rounded-2xl bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity cursor-pointer"
        >
          {uploading ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Camera className="h-5 w-5 text-white" />
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={onUpload}
          className="hidden"
        />
      </div>
      <div>
        <h2 className="text-lg font-semibold">{name || "Your Business"}</h2>
        <p className="text-sm text-muted-foreground">Hover over logo to change it</p>
      </div>
    </div>
  );
}
