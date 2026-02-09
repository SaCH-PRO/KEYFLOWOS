"use client";

import { RefObject } from "react";
import { Building2, Camera } from "lucide-react";

type Props = {
  logoUrl: string | null;
  name: string;
  uploading: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

export function LogoUploader({ logoUrl, name, uploading, fileInputRef, onUpload }: Props) {
  return (
    <div className="flex items-center gap-6 mb-6">
      <div className="relative">
        <div className="w-24 h-24 rounded-2xl bg-slate-800 border border-border/60 flex items-center justify-center overflow-hidden">
          {logoUrl ? (
            <img src={logoUrl} alt="Business logo" className="w-full h-full object-cover" />
          ) : (
            <Building2 className="h-10 w-10 text-muted-foreground" />
          )}
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {uploading ? (
            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <Camera className="h-4 w-4" />
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
        <h2 className="text-xl font-semibold">{name || "Your Business"}</h2>
        <p className="text-sm text-muted-foreground">Click the camera icon to upload your logo</p>
      </div>
    </div>
  );
}
