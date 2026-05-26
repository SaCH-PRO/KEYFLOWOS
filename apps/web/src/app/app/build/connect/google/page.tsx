"use client";

import { ModuleShell } from "@/components/ui/module-shell";
import { Activity, Search, Mail, CreditCard, Calculator, Megaphone, Share2, FileText, MessageCircle } from "lucide-react";


const connectTabs = [
  { label: "Overview", href: "/app/build/connect", icon: Activity },
  { label: "Google", href: "/app/build/connect/google", icon: Search },
  { label: "Microsoft", href: "/app/build/connect/microsoft", icon: Mail },
  { label: "Payments", href: "/app/build/connect/payments", icon: CreditCard },
  { label: "Accounting", href: "/app/build/connect/accounting", icon: Calculator },
  { label: "Marketing", href: "/app/build/connect/marketing", icon: Megaphone },
  { label: "Social", href: "/app/build/connect/social", icon: Share2 },
  { label: "Forms", href: "/app/build/connect/forms", icon: FileText },
  { label: "WhatsApp", href: "/app/build/connect/whatsapp", icon: MessageCircle },
];

export default function ConnectGooglePage() {
  return (
    <ModuleShell
      icon={Search}
      title="Google"
      subtitle="Gmail, Calendar, Drive, Forms, Contacts & Business Profile"
      tabs={connectTabs}
    />
  );
}
