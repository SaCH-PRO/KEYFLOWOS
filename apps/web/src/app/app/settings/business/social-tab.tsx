"use client";

import { motion } from "framer-motion";
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

const socials = [
  { field: "facebook" as const, label: "Facebook", icon: Facebook, placeholder: "facebook.com/yourbusiness", color: "#1877F2", hint: "Your Facebook page URL" },
  { field: "instagram" as const, label: "Instagram", icon: Instagram, placeholder: "@yourbusiness", color: "#E4405F", hint: "Your Instagram handle" },
  { field: "twitter" as const, label: "Twitter / X", icon: Twitter, placeholder: "@yourbusiness", color: "#1DA1F2", hint: "Your Twitter/X handle" },
  { field: "linkedin" as const, label: "LinkedIn", icon: Linkedin, placeholder: "linkedin.com/company/you", color: "#0A66C2", hint: "Your LinkedIn company page" },
  {
    field: "tiktok" as const, label: "TikTok",
    icon: ({ className }: { className?: string }) => (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
      </svg>
    ),
    placeholder: "@yourbusiness", color: "#000000", hint: "Your TikTok handle",
  },
  { field: "youtube" as const, label: "YouTube", icon: Youtube, placeholder: "youtube.com/@yourbusiness", color: "#FF0000", hint: "Your YouTube channel URL" },
];

const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25 } },
};

export function SocialTab({ form, setField }: Props) {
  const connectedCount = socials.filter((s) => form[s.field]).length;

  return (
    <motion.div variants={{ show: { transition: { staggerChildren: 0.04 } } }} initial="hidden" animate="show" className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Connect your social media accounts to display them on your public booking page and invoices.
          </p>
        </div>
        <div className="shrink-0 ml-4">
          <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-muted/40 border border-border/40">
            {connectedCount}/{socials.length} linked
          </span>
        </div>
      </div>

      <div className="space-y-3">
        {socials.map((s) => {
          const Icon = s.icon;
          const hasValue = Boolean(form[s.field]);
          return (
            <motion.div
              key={s.field}
              variants={fadeUp}
              className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                hasValue
                  ? "border-emerald-500/20 bg-emerald-500/5"
                  : "border-border/40 bg-muted/10"
              }`}
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${s.color}20` }}
              >
                <Icon className="h-5 w-5" style={{ color: s.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <label className="block">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-foreground">{s.label}</span>
                    {hasValue && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">Linked</span>
                    )}
                  </div>
                  <Input
                    value={form[s.field]}
                    onChange={(e) => setField(s.field, e.target.value)}
                    placeholder={s.placeholder}
                    className="text-sm"
                  />
                </label>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
