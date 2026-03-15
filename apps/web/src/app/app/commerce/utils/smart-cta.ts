import type { ElementType } from "react";
import {
  Send,
  Bell,
  DollarSign,
  Eye,
  FileText,
  ArrowRightLeft,
  Pencil,
  CheckCircle,
} from "lucide-react";

export type InvoiceActionKey = "finish" | "remind" | "collect" | "view_receipt" | "record_payment" | "view";
export type QuoteActionKey = "send" | "follow_up" | "convert" | "view";
export type SmartActionKey = InvoiceActionKey | QuoteActionKey;

export interface SmartCTA {
  label: string;
  icon: ElementType;
  color: string;
  bgColor: string;
  hoverBgColor: string;
  actionKey: SmartActionKey;
}

export function getInvoiceSmartCTA(status: string): SmartCTA {
  switch (status) {
    case "DRAFT":
      return {
        label: "Finish",
        icon: Pencil,
        color: "text-blue-400",
        bgColor: "bg-blue-500/15",
        hoverBgColor: "hover:bg-blue-500/25",
        actionKey: "finish",
      };
    case "SENT":
      return {
        label: "Remind",
        icon: Bell,
        color: "text-amber-400",
        bgColor: "bg-amber-500/15",
        hoverBgColor: "hover:bg-amber-500/25",
        actionKey: "remind",
      };
    case "OVERDUE":
      return {
        label: "Collect",
        icon: DollarSign,
        color: "text-red-400",
        bgColor: "bg-red-500/15",
        hoverBgColor: "hover:bg-red-500/25",
        actionKey: "collect",
      };
    case "PAID":
      return {
        label: "View receipt",
        icon: Eye,
        color: "text-emerald-400",
        bgColor: "bg-emerald-500/15",
        hoverBgColor: "hover:bg-emerald-500/25",
        actionKey: "view_receipt",
      };
    case "PARTIALLY_PAID":
      return {
        label: "Record payment",
        icon: DollarSign,
        color: "text-amber-400",
        bgColor: "bg-amber-500/15",
        hoverBgColor: "hover:bg-amber-500/25",
        actionKey: "record_payment",
      };
    case "VOID":
      return {
        label: "View",
        icon: Eye,
        color: "text-slate-400",
        bgColor: "bg-slate-500/15",
        hoverBgColor: "hover:bg-slate-500/25",
        actionKey: "view",
      };
    default:
      return {
        label: "View",
        icon: Eye,
        color: "text-muted-foreground",
        bgColor: "bg-muted/15",
        hoverBgColor: "hover:bg-muted/25",
        actionKey: "view",
      };
  }
}

export function getQuoteSmartCTA(status: string): SmartCTA {
  switch (status) {
    case "DRAFT":
      return {
        label: "Send",
        icon: Send,
        color: "text-blue-400",
        bgColor: "bg-blue-500/15",
        hoverBgColor: "hover:bg-blue-500/25",
        actionKey: "send",
      };
    case "SENT":
      return {
        label: "Follow up",
        icon: Bell,
        color: "text-amber-400",
        bgColor: "bg-amber-500/15",
        hoverBgColor: "hover:bg-amber-500/25",
        actionKey: "follow_up",
      };
    case "ACCEPTED":
      return {
        label: "Convert",
        icon: ArrowRightLeft,
        color: "text-emerald-400",
        bgColor: "bg-emerald-500/15",
        hoverBgColor: "hover:bg-emerald-500/25",
        actionKey: "convert",
      };
    case "REJECTED":
      return {
        label: "View",
        icon: Eye,
        color: "text-slate-400",
        bgColor: "bg-slate-500/15",
        hoverBgColor: "hover:bg-slate-500/25",
        actionKey: "view",
      };
    default:
      return {
        label: "View",
        icon: Eye,
        color: "text-muted-foreground",
        bgColor: "bg-muted/15",
        hoverBgColor: "hover:bg-muted/25",
        actionKey: "view",
      };
  }
}

export type SavedViewKey =
  | "all_invoices"
  | "overdue"
  | "sent"
  | "drafts"
  | "recurring"
  | "quotes_awaiting"
  | "paid_this_month"
  | "all_quotes";

interface HasStatus {
  status: string;
  updatedAt?: string | Date | null;
  issueDate?: string | Date | null;
  [key: string]: unknown;
}

export interface SavedView {
  key: SavedViewKey;
  label: string;
  icon: ElementType;
  filterFn: (invoices: HasStatus[], quotes: HasStatus[]) => number;
  section: "invoices" | "quotes" | "schedules";
  statusFilter?: string;
}

export const SAVED_VIEWS: SavedView[] = [
  {
    key: "all_invoices",
    label: "All Invoices",
    icon: FileText,
    section: "invoices",
    filterFn: (inv) => inv.length,
  },
  {
    key: "overdue",
    label: "Overdue",
    icon: Bell,
    section: "invoices",
    statusFilter: "OVERDUE",
    filterFn: (inv) => inv.filter((i) => i.status === "OVERDUE").length,
  },
  {
    key: "sent",
    label: "Sent",
    icon: Send,
    section: "invoices",
    statusFilter: "SENT",
    filterFn: (inv) => inv.filter((i) => i.status === "SENT").length,
  },
  {
    key: "drafts",
    label: "Drafts",
    icon: Pencil,
    section: "invoices",
    statusFilter: "DRAFT",
    filterFn: (inv) => inv.filter((i) => i.status === "DRAFT").length,
  },
  {
    key: "paid_this_month",
    label: "Paid This Month",
    icon: CheckCircle,
    section: "invoices",
    statusFilter: "PAID",
    filterFn: (inv) => {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return inv.filter(
        (i) =>
          i.status === "PAID" && new Date(String(i.updatedAt ?? i.issueDate ?? "")) >= startOfMonth,
      ).length;
    },
  },
  {
    key: "all_quotes",
    label: "All Quotes",
    icon: FileText,
    section: "quotes",
    filterFn: (_inv, quotes) => quotes.length,
  },
  {
    key: "quotes_awaiting",
    label: "Awaiting Response",
    icon: Bell,
    section: "quotes",
    statusFilter: "SENT",
    filterFn: (_inv, quotes) =>
      quotes.filter((q) => q.status === "SENT").length,
  },
  {
    key: "recurring",
    label: "Recurring",
    icon: FileText,
    section: "schedules",
    filterFn: () => 0,
  },
];
