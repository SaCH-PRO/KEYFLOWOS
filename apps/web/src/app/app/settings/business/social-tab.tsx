"use client";

import {
  Facebook,
  Instagram,
  Twitter,
  Linkedin,
  Youtube,
} from "lucide-react";
import { Input } from "@keyflow/ui";
import { FormState } from "./use-business-settings";

type Props = {
  form: FormState;
  setField: (field: keyof FormState, value: string) => void;
};

export function SocialTab({ form, setField }: Props) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground mb-4">
        Connect your social media accounts to display them on your public booking page and invoices.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1 mb-1">
            <Facebook className="h-3 w-3" />
            Facebook
          </div>
          <Input
            value={form.facebook}
            onChange={(e) => setField("facebook", e.target.value)}
            placeholder="facebook.com/yourbusiness"
          />
        </label>

        <label className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1 mb-1">
            <Instagram className="h-3 w-3" />
            Instagram
          </div>
          <Input
            value={form.instagram}
            onChange={(e) => setField("instagram", e.target.value)}
            placeholder="@yourbusiness"
          />
        </label>

        <label className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1 mb-1">
            <Twitter className="h-3 w-3" />
            Twitter / X
          </div>
          <Input
            value={form.twitter}
            onChange={(e) => setField("twitter", e.target.value)}
            placeholder="@yourbusiness"
          />
        </label>

        <label className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1 mb-1">
            <Linkedin className="h-3 w-3" />
            LinkedIn
          </div>
          <Input
            value={form.linkedin}
            onChange={(e) => setField("linkedin", e.target.value)}
            placeholder="linkedin.com/company/yourbusiness"
          />
        </label>

        <label className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1 mb-1">
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
            </svg>
            TikTok
          </div>
          <Input
            value={form.tiktok}
            onChange={(e) => setField("tiktok", e.target.value)}
            placeholder="@yourbusiness"
          />
        </label>

        <label className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1 mb-1">
            <Youtube className="h-3 w-3" />
            YouTube
          </div>
          <Input
            value={form.youtube}
            onChange={(e) => setField("youtube", e.target.value)}
            placeholder="youtube.com/@yourbusiness"
          />
        </label>
      </div>
    </div>
  );
}
